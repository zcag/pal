//! Frecency: which items the user actually picks, and what they typed to
//! reach them.
//!
//! The index calls [`Frecency::boost`] once per keystroke and reads one
//! number per match between scoring and the top-N select (`notes/matching.md`,
//! "Frecency hook"); for the empty query [`Frecency::top`] orders the corpus
//! on its own. Every pick goes through [`Frecency::record`] and
//! [`Frecency::record_query`].
//!
//! # Score
//!
//! Firefox-style. Each of the last [`MAX_VISITS`] visits gets a weight by
//! age ([`BUCKETS`]: 100 under 4 h, 70 under a day, 50 under 3 days, 30
//! under a week, [`OLDER_WEIGHT`] beyond) and `recency` is their mean over
//! 100, so 0.1 to 1. `frequency` is the total visit count on a log scale,
//! saturating at [`COUNT_SATURATION`] visits, so 0 to 1 with the first few
//! picks mattering most. `frecency = recency * frequency`, 0 to 1. On top of
//! that, if the query the user is typing is one of the last [`MAX_QUERIES`]
//! queries that led to this item, [`QUERY_EXACT_BONUS`] is added for an
//! exact (case-insensitive) match or [`QUERY_PREFIX_BONUS`] when the typed
//! text is a prefix of a remembered query. The result is in `0..=MAX_SCORE`.
//!
//! # Composing with the match score
//!
//! [`Index::query`](crate::index::Index::query) adds the boost to the match
//! score before its top-N select, so [`Frecency::boost`] hands it the score
//! above times [`BOOST_SCALE`]: `0..=MAX_SCORE * BOOST_SCALE`, or 0 to 200
//! in nucleo's units of about 16 per matched char (~40 for `ch`, ~170 for
//! `chrome`). Additive on purpose: at one or two typed letters the matcher
//! knows little and a used item should win outright (+30 beats every `c`
//! hit), while at six letters the same +30 is two chars' worth and only an
//! item reached by this very query (+100 exact, +60 prefix) or used heavily
//! and recently (up to +100) can overtake an untouched exact hit. A factor
//! would give frecency the same say at every query length, which is not
//! what a launcher wants. For the empty query the match score is 0 and
//! the boost orders the list on its own, insertion order breaking ties.
//!
//! # Not for `live` palettes
//!
//! Palettes whose order is arrival order (OTP codes, tabs, calculator
//! output) must not be ranked by this table: a stale row floats to the top
//! (v1 `polish.md` rule 7). The index decides that per palette; this module
//! only scores what it is asked about. Ids must be stable for the same
//! reason (rule 12): a new id is a new item with no history.
//!
//! # File
//!
//! One JSON file, `$XDG_DATA_HOME/pal/frecency.json` (`dirs::data_dir()`
//! otherwise, so `~/Library/Application Support/pal/` on macOS). Loaded
//! once; a file that does not parse is moved to `frecency.json.bak` and the
//! store starts empty. Writes are debounced by [`SAVE_DEBOUNCE`] on a
//! background thread and land via temp file + rename. Call
//! [`Frecency::flush`] before exit so the last pick is not lost to the
//! debounce.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::index::Source;

/// Age buckets and their weights, youngest first. A visit older than the
/// last bucket weighs [`OLDER_WEIGHT`].
pub const BUCKETS: [(Duration, f32); 4] = [
    (Duration::from_secs(4 * 3600), 100.0),
    (Duration::from_secs(24 * 3600), 70.0),
    (Duration::from_secs(3 * 24 * 3600), 50.0),
    (Duration::from_secs(7 * 24 * 3600), 30.0),
];
pub const OLDER_WEIGHT: f32 = 10.0;
/// Visits remembered per item; recency is averaged over these.
pub const MAX_VISITS: usize = 10;
/// Visit count at which the frequency term reaches 1.
pub const COUNT_SATURATION: u32 = 32;
/// Queries remembered per item, most recent first.
pub const MAX_QUERIES: usize = 3;
pub const QUERY_EXACT_BONUS: f32 = 1.0;
pub const QUERY_PREFIX_BONUS: f32 = 0.6;
/// Upper bound of [`Frecency::score`]: frecency (1) plus the exact bonus.
pub const MAX_SCORE: f32 = 1.0 + QUERY_EXACT_BONUS;
/// Match-score units per point of [`Frecency::score`] in
/// [`Frecency::boost`]; nucleo gives about 16 per matched char.
pub const BOOST_SCALE: f32 = 100.0;
/// Items kept; past this the lowest-scoring one is evicted on insert.
pub const MAX_KEYS: usize = 5000;
/// Quiet time after the last change before the file is written.
pub const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
const FILE_VERSION: u32 = 1;

/// What the index knows an item by: its source `(extension, palette)` and
/// the item's own id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Key {
    pub extension: String,
    pub palette: String,
    pub id: String,
}

impl Key {
    pub fn new(extension: impl Into<String>, palette: impl Into<String>, id: impl Into<String>) -> Self {
        Self { extension: extension.into(), palette: palette.into(), id: id.into() }
    }

    /// The index's handle for a hit.
    pub fn from_source(source: &Source, id: impl Into<String>) -> Self {
        Self::new(source.extension.clone(), source.palette.clone(), id)
    }

    pub fn source(&self) -> Source {
        Source::new(self.extension.clone(), self.palette.clone())
    }
}

/// Lets the map be probed with three borrowed `&str`s and no allocation:
/// `HashMap<Key, _>::get(&(ext, pal, id) as &dyn KeyLike)`.
trait KeyLike {
    fn parts(&self) -> (&str, &str, &str);
}

impl KeyLike for Key {
    fn parts(&self) -> (&str, &str, &str) {
        (&self.extension, &self.palette, &self.id)
    }
}

impl KeyLike for (&str, &str, &str) {
    fn parts(&self) -> (&str, &str, &str) {
        *self
    }
}

impl Hash for Key {
    fn hash<H: Hasher>(&self, h: &mut H) {
        self.parts().hash(h)
    }
}

impl Hash for dyn KeyLike + '_ {
    fn hash<H: Hasher>(&self, h: &mut H) {
        self.parts().hash(h)
    }
}

impl PartialEq for dyn KeyLike + '_ {
    fn eq(&self, other: &Self) -> bool {
        self.parts() == other.parts()
    }
}

impl Eq for dyn KeyLike + '_ {}

impl<'a> Borrow<dyn KeyLike + 'a> for Key {
    fn borrow(&self) -> &(dyn KeyLike + 'a) {
        self
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Entry {
    /// Total picks, beyond what `visits` remembers.
    count: u32,
    /// Unix seconds of the last [`MAX_VISITS`] picks, oldest first.
    visits: Vec<u64>,
    /// Lowercased, most recent first, at most [`MAX_QUERIES`].
    queries: Vec<String>,
}

impl Entry {
    fn last_visit(&self) -> u64 {
        self.visits.last().copied().unwrap_or(0)
    }

    fn frecency(&self, now: u64) -> f32 {
        if self.visits.is_empty() || self.count == 0 {
            return 0.0;
        }
        let recency = self.visits.iter().map(|&v| bucket_weight(now.saturating_sub(v))).sum::<f32>()
            / self.visits.len() as f32
            / 100.0;
        let frequency =
            ((1.0 + self.count as f32).ln() / (1.0 + COUNT_SATURATION as f32).ln()).min(1.0);
        recency * frequency
    }

    /// `query` already lowercased and non-empty.
    fn query_bonus(&self, query: &str) -> f32 {
        let mut bonus: f32 = 0.0;
        for q in &self.queries {
            if q == query {
                return QUERY_EXACT_BONUS;
            }
            if q.starts_with(query) {
                bonus = QUERY_PREFIX_BONUS;
            }
        }
        bonus
    }
}

fn bucket_weight(age_secs: u64) -> f32 {
    let age = Duration::from_secs(age_secs);
    BUCKETS.iter().find(|(limit, _)| age < *limit).map_or(OLDER_WEIGHT, |(_, w)| *w)
}

fn secs(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn normalise_query(q: &str) -> Option<String> {
    let q = q.trim();
    (!q.is_empty()).then(|| q.to_lowercase())
}

#[derive(Serialize, Deserialize)]
struct FileEntry {
    #[serde(flatten)]
    key: Key,
    #[serde(flatten)]
    entry: Entry,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    items: Vec<FileEntry>,
}

enum Save {
    Snapshot(String),
    Flush(mpsc::Sender<()>),
}

/// The store. Cheap to query, owns its file.
pub struct Frecency {
    entries: HashMap<Key, Entry>,
    path: Option<PathBuf>,
    saver: Option<mpsc::Sender<Save>>,
}

impl Frecency {
    /// No file: nothing is loaded or saved.
    pub fn in_memory() -> Self {
        Self { entries: HashMap::new(), path: None, saver: None }
    }

    /// The default location, see the module docs.
    pub fn open() -> Self {
        Self::load(Self::default_path())
    }

    pub fn default_path() -> PathBuf {
        let base = std::env::var_os("XDG_DATA_HOME")
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .or_else(dirs::data_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("pal").join("frecency.json")
    }

    /// Load `path`, or start empty when it is missing. A file that does not
    /// parse is renamed to `<path>.bak` first so nothing is silently lost.
    pub fn load(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let entries = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<File>(&bytes) {
                Ok(file) => file.items.into_iter().map(|e| (e.key, e.entry)).collect(),
                Err(_) => {
                    let _ = std::fs::rename(&path, bak_path(&path));
                    HashMap::new()
                }
            },
            Err(_) => HashMap::new(),
        };
        Self { entries, path: Some(path), saver: None }
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// A pick of `key` at `at`.
    pub fn record(&mut self, key: &Key, at: SystemTime) {
        let at = secs(at);
        if !self.entries.contains_key(key) && self.entries.len() >= MAX_KEYS {
            self.evict_lowest(at);
        }
        let e = self.entries.entry(key.clone()).or_default();
        e.count = e.count.saturating_add(1);
        e.visits.push(at);
        if e.visits.len() > MAX_VISITS {
            e.visits.drain(..e.visits.len() - MAX_VISITS);
        }
        self.changed();
    }

    /// What the user typed before picking `key`. Empty queries are ignored.
    pub fn record_query(&mut self, key: &Key, query: &str) {
        let Some(q) = normalise_query(query) else { return };
        let e = self.entries.entry(key.clone()).or_default();
        e.queries.retain(|old| *old != q);
        e.queries.insert(0, q);
        e.queries.truncate(MAX_QUERIES);
        self.changed();
    }

    pub fn forget(&mut self, key: &Key) {
        if self.entries.remove(key).is_some() {
            self.changed();
        }
    }

    pub fn clear(&mut self) {
        if !self.entries.is_empty() {
            self.entries.clear();
            self.changed();
        }
    }

    /// `0..=MAX_SCORE`, 0 for an unknown key. Formula in the module docs.
    pub fn score(&self, key: &Key, query: &str, now: SystemTime) -> f32 {
        self.score_for(&key.extension, &key.palette, &key.id, query, now)
    }

    /// [`score`](Self::score) by parts, no allocation.
    pub fn score_for(&self, extension: &str, palette: &str, id: &str, query: &str, now: SystemTime) -> f32 {
        self.lookup(extension, palette, id, normalise_query(query).as_deref(), secs(now))
    }

    /// The `QueryOpts::boost` hook for one keystroke: `query` and `now`
    /// fixed, one hash lookup and no allocation per match, in match-score
    /// units (see the module docs).
    ///
    /// ```ignore
    /// let b = frecency.boost(q, SystemTime::now());
    /// index.query(q, QueryOpts { boost: Some(&b), ..Default::default() });
    /// ```
    pub fn boost(&self, query: &str, now: SystemTime) -> impl Fn(&Source, &str) -> f32 + '_ {
        let query = normalise_query(query);
        let now = secs(now);
        move |source, id| self.lookup(&source.extension, &source.palette, id, query.as_deref(), now) * BOOST_SCALE
    }

    /// `query` already normalised.
    fn lookup(&self, extension: &str, palette: &str, id: &str, query: Option<&str>, now: u64) -> f32 {
        let Some(e) = self.entries.get(&(extension, palette, id) as &dyn KeyLike) else { return 0.0 };
        e.frecency(now) + query.map_or(0.0, |q| e.query_bonus(q))
    }

    /// The best `limit` keys for the empty query, best first.
    pub fn top(&self, limit: usize, now: SystemTime) -> Vec<Key> {
        let now = secs(now);
        let mut ranked: Vec<(&Key, f32, u64)> =
            self.entries.iter().map(|(k, e)| (k, e.frecency(now), e.last_visit())).collect();
        ranked.sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then(b.2.cmp(&a.2)).then(a.0.parts().cmp(&b.0.parts())));
        ranked.into_iter().take(limit).map(|(k, ..)| k.clone()).collect()
    }

    /// Write now if there is a file, waiting for any pending debounced save
    /// first so the newest state wins.
    pub fn flush(&mut self) -> std::io::Result<()> {
        let Some(path) = &self.path else { return Ok(()) };
        if let Some(tx) = &self.saver {
            let (ack, done) = mpsc::channel();
            if tx.send(Save::Flush(ack)).is_ok() {
                let _ = done.recv();
                return Ok(());
            }
        }
        write_atomic(path, &self.snapshot())
    }

    fn changed(&mut self) {
        if self.path.is_none() {
            return;
        }
        let snapshot = self.snapshot();
        if self.saver.as_ref().is_none_or(|tx| tx.send(Save::Snapshot(snapshot.clone())).is_err()) {
            let (tx, rx) = mpsc::channel();
            let path = self.path.clone().expect("checked above");
            std::thread::spawn(move || saver(&path, &rx));
            let _ = tx.send(Save::Snapshot(snapshot));
            self.saver = Some(tx);
        }
    }

    fn snapshot(&self) -> String {
        let items = self
            .entries
            .iter()
            .map(|(k, e)| FileEntry { key: k.clone(), entry: e.clone() })
            .collect();
        serde_json::to_string(&File { version: FILE_VERSION, items }).expect("plain data")
    }

    fn evict_lowest(&mut self, now: u64) {
        let lowest = self
            .entries
            .iter()
            .map(|(k, e)| (k, e.frecency(now), e.last_visit()))
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.2.cmp(&b.2)))
            .map(|(k, ..)| k.clone());
        if let Some(k) = lowest {
            self.entries.remove(&k);
        }
    }
}

impl Drop for Frecency {
    fn drop(&mut self) {
        // Dropping the sender ends the saver, which writes whatever it holds.
        // Nothing waits for it: on a real exit call `flush` first.
        self.saver.take();
    }
}

/// Debounce loop: after a snapshot arrives, keep swallowing newer ones
/// until [`SAVE_DEBOUNCE`] passes with none, then write the last. A flush
/// writes immediately and acks. Disconnect writes and exits.
fn saver(path: &Path, rx: &mpsc::Receiver<Save>) {
    let mut pending: Option<String> = None;
    loop {
        let msg = match pending {
            None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            Some(_) => rx.recv_timeout(SAVE_DEBOUNCE),
        };
        match msg {
            Ok(Save::Snapshot(s)) => pending = Some(s),
            Ok(Save::Flush(ack)) => {
                if let Some(s) = pending.take() {
                    let _ = write_atomic(path, &s);
                }
                let _ = ack.send(());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(s) = pending.take() {
                    let _ = write_atomic(path, &s);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(s) = pending.take() {
                    let _ = write_atomic(path, &s);
                }
                return;
            }
        }
    }
}

fn bak_path(path: &Path) -> PathBuf {
    let mut p = path.as_os_str().to_owned();
    p.push(".bak");
    PathBuf::from(p)
}

/// Temp file next to the target, then rename, so a reader never sees a
/// half-written file. Same shape as the config writer.
fn write_atomic(target: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = target.with_extension(format!("json.tmp{}", std::process::id()));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, target).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: u64 = 3600;
    const D: u64 = 24 * H;

    fn t(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn key(id: &str) -> Key {
        Key::new("ext", "pal", id)
    }

    /// One visit `age` seconds before `now`, scored at `now`.
    fn one_visit_at(age: u64) -> f32 {
        let now = 1000 * D;
        let mut f = Frecency::in_memory();
        f.record(&key("a"), t(now - age));
        f.score(&key("a"), "", t(now))
    }

    #[test]
    fn recency_buckets() {
        let freq1 = (2.0f32).ln() / (1.0 + COUNT_SATURATION as f32).ln();
        let expect = |w: f32| w / 100.0 * freq1;
        assert!((one_visit_at(0) - expect(100.0)).abs() < 1e-5);
        assert!((one_visit_at(4 * H - 1) - expect(100.0)).abs() < 1e-5);
        assert!((one_visit_at(4 * H) - expect(70.0)).abs() < 1e-5);
        assert!((one_visit_at(D) - expect(50.0)).abs() < 1e-5);
        assert!((one_visit_at(3 * D) - expect(30.0)).abs() < 1e-5);
        assert!((one_visit_at(7 * D) - expect(OLDER_WEIGHT)).abs() < 1e-5);
        assert!((one_visit_at(400 * D) - expect(OLDER_WEIGHT)).abs() < 1e-5);
    }

    #[test]
    fn count_saturates_and_visits_are_capped() {
        let mut f = Frecency::in_memory();
        let now = t(D);
        for _ in 0..COUNT_SATURATION {
            f.record(&key("a"), now);
        }
        let at_sat = f.score(&key("a"), "", now);
        assert!((at_sat - 1.0).abs() < 1e-6, "{at_sat}");
        for _ in 0..1000 {
            f.record(&key("a"), now);
        }
        assert!((f.score(&key("a"), "", now) - 1.0).abs() < 1e-6);
        assert!(f.score(&key("a"), "", now) <= MAX_SCORE);
        assert_eq!(f.entries[&key("a")].visits.len(), MAX_VISITS);
        assert_eq!(f.entries[&key("a")].count, COUNT_SATURATION + 1000);
    }

    #[test]
    fn unknown_key_scores_zero() {
        let f = Frecency::in_memory();
        assert_eq!(f.score(&key("nope"), "x", t(D)), 0.0);
        assert_eq!(f.boost("x", t(D))(&Source::new("a", "b"), "c"), 0.0);
    }

    #[test]
    fn query_bonus_exact_and_prefix() {
        let mut f = Frecency::in_memory();
        let now = t(D);
        f.record(&key("chrome"), now);
        f.record_query(&key("chrome"), "  Chrome ");
        let base = f.score(&key("chrome"), "", now);
        assert!(base > 0.0);
        assert!((f.score(&key("chrome"), "chrome", now) - (base + QUERY_EXACT_BONUS)).abs() < 1e-6);
        assert!((f.score(&key("chrome"), "CHR", now) - (base + QUERY_PREFIX_BONUS)).abs() < 1e-6);
        // Typing past a remembered query is not a prefix of it.
        assert!((f.score(&key("chrome"), "chromecast", now) - base).abs() < 1e-6);
        assert!((f.score(&key("chrome"), "slack", now) - base).abs() < 1e-6);
        assert!((f.score_for("ext", "pal", "chrome", "ch", now) - (base + QUERY_PREFIX_BONUS)).abs() < 1e-6);
    }

    #[test]
    fn queries_keep_last_n_most_recent_first() {
        let mut f = Frecency::in_memory();
        for q in ["a", "b", "c", "d", "b"] {
            f.record_query(&key("x"), q);
        }
        assert_eq!(f.entries[&key("x")].queries, ["b", "d", "c"]);
        f.record_query(&key("x"), "   ");
        assert_eq!(f.entries[&key("x")].queries, ["b", "d", "c"]);
    }

    #[test]
    fn top_orders_by_score_then_last_visit() {
        let mut f = Frecency::in_memory();
        let now = 100 * D;
        f.record(&key("old-many"), t(now - 30 * D));
        f.record(&key("old-many"), t(now - 30 * D));
        f.record(&key("old-many"), t(now - 30 * D));
        f.record(&key("fresh"), t(now - 60));
        f.record(&key("fresh"), t(now - 60));
        f.record(&key("yesterday"), t(now - 2 * D));
        f.record(&key("yesterday"), t(now - 2 * D));
        let top: Vec<_> = f.top(10, t(now)).into_iter().map(|k| k.id).collect();
        assert_eq!(top, ["fresh", "yesterday", "old-many"]);
        assert_eq!(f.top(1, t(now)).len(), 1);
        assert_eq!(f.top(0, t(now)).len(), 0);
    }

    #[test]
    fn boost_through_the_index() {
        use crate::index::{Index, Item, QueryOpts};
        let mut ix = Index::new();
        let apps = Source::new("t", "apps");
        let item = |id: &str, name: &str| Item {
            id: id.into(),
            name: name.into(),
            subtitle: None,
            keywords: vec![],
            icon: None,
            section: None,
            extra: Default::default(),
        };
        ix.replace(
            apps.clone(),
            vec![item("chrome.app", "Google Chrome"), item("chromium.app", "Chromium"), item("slack.app", "Slack")],
        );
        let ids = |hits: &[crate::index::Hit]| hits.iter().map(|h| h.id.clone()).collect::<Vec<_>>();
        let now = t(100 * D);
        let mut f = Frecency::in_memory();

        let first = |ix: &mut Index, f: &Frecency, q: &str| {
            let b = f.boost(q, now);
            ids(&ix.query(q, QueryOpts { boost: Some(&b), ..Default::default() }))
        };

        // Untouched: the shorter exact-prefix name wins.
        assert_eq!(first(&mut ix, &f, "chrom")[0], "chromium.app");

        // Picked once via "chrom": the remembered query lifts it past.
        let chrome = Key::from_source(&apps, "chrome.app");
        f.record(&chrome, now);
        f.record_query(&chrome, "chrom");
        assert_eq!(first(&mut ix, &f, "chrom")[0], "chrome.app");

        // Empty query: boost alone orders, insertion order breaks ties.
        assert_eq!(first(&mut ix, &f, ""), ["chrome.app", "chromium.app", "slack.app"]);
        let b = f.boost("", now);
        let hit = &ix.query("", QueryOpts { boost: Some(&b), ..Default::default() })[0];
        assert!((hit.score - f.score(&chrome, "", now) * BOOST_SCALE).abs() < 1e-4);
    }

    #[test]
    fn forget_and_clear() {
        let mut f = Frecency::in_memory();
        f.record(&key("a"), t(D));
        f.record(&key("b"), t(D));
        f.forget(&key("a"));
        assert_eq!(f.score(&key("a"), "", t(D)), 0.0);
        assert_eq!(f.len(), 1);
        f.clear();
        assert!(f.is_empty());
    }

    #[test]
    fn persistence_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("frecency.json");
        let now = t(5 * D);
        {
            let mut f = Frecency::load(&path);
            assert!(f.is_empty());
            f.record(&key("a"), t(5 * D - 60));
            f.record(&key("a"), now);
            f.record_query(&key("a"), "Aa");
            f.record(&Key::new("other", "p", "b"), t(4 * D));
            f.flush().unwrap();
        }
        let f = Frecency::load(&path);
        assert_eq!(f.len(), 2);
        assert_eq!(f.entries[&key("a")].count, 2);
        assert_eq!(f.entries[&key("a")].visits, [5 * D - 60, 5 * D]);
        assert_eq!(f.entries[&key("a")].queries, ["aa"]);
        assert!(f.score(&Key::new("other", "p", "b"), "", now) > 0.0);
        assert!(!dir.path().join("nested").join("frecency.json.bak").exists());
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"version\":1"), "{text}");
    }

    #[test]
    fn debounced_save_lands_without_flush() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frecency.json");
        let mut f = Frecency::load(&path);
        f.record(&key("a"), t(D));
        f.record(&key("b"), t(D));
        let deadline = std::time::Instant::now() + SAVE_DEBOUNCE * 20;
        while !path.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        // The second record arrived inside the window, so one write holds both.
        let g = Frecency::load(&path);
        assert_eq!(g.len(), 2);
    }

    #[test]
    fn corrupt_file_starts_empty_and_keeps_bak() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frecency.json");
        std::fs::write(&path, b"{ this is not json").unwrap();
        let mut f = Frecency::load(&path);
        assert!(f.is_empty());
        assert_eq!(std::fs::read(bak_path(&path)).unwrap(), b"{ this is not json");
        assert!(!path.exists());
        f.record(&key("a"), t(D));
        f.flush().unwrap();
        assert_eq!(Frecency::load(&path).len(), 1);
    }

    #[test]
    fn eviction_at_cap_drops_lowest() {
        let mut f = Frecency::in_memory();
        let now = 100 * D;
        for i in 1..MAX_KEYS {
            f.record(&key(&format!("k{i}")), t(now - 60));
        }
        // The weakest: one visit, long ago.
        f.record(&key("weak"), t(now - 60 * D));
        assert_eq!(f.len(), MAX_KEYS);
        f.record(&key("new"), t(now));
        assert_eq!(f.len(), MAX_KEYS);
        assert_eq!(f.score(&key("weak"), "", t(now)), 0.0);
        assert!(f.score(&key("new"), "", t(now)) > 0.0);
        assert!(f.score(&key("k1"), "", t(now)) > 0.0);
        // A known key at the cap updates in place, nothing is evicted.
        f.record(&key("k1"), t(now));
        assert_eq!(f.len(), MAX_KEYS);
    }

    #[test]
    fn score_monotonic_in_count_and_recency() {
        let now = 100 * D;
        let mut prev = 0.0;
        let mut f = Frecency::in_memory();
        for _ in 0..200 {
            f.record(&key("a"), t(now));
            let s = f.score(&key("a"), "", t(now));
            assert!(s >= prev, "count: {s} < {prev}");
            assert!(s <= MAX_SCORE);
            prev = s;
        }
        let mut prev = f32::INFINITY;
        for age in (0..30 * D).step_by(H as usize / 2) {
            let s = one_visit_at(age);
            assert!(s <= prev, "age {age}: {s} > {prev}");
            assert!(s > 0.0);
            prev = s;
        }
        // A visit stamped in the future (clock skew) counts as now.
        let mut g = Frecency::in_memory();
        g.record(&key("a"), t(now + D));
        assert!((g.score(&key("a"), "", t(now)) - one_visit_at(0)).abs() < 1e-6);
    }
}
