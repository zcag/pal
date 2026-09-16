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
//! One JSON file, `frecency.json` under the config's profile dir
//! ([`ConfigFile::data_dir`](crate::config::ConfigFile::data_dir):
//! `~/Library/Application Support/pal/<profile>/` on macOS,
//! `~/.local/share/pal/<profile>/` on Linux, `$XDG_DATA_HOME` first on
//! both). Loaded once; a file that does not
//! parse is moved to `frecency.json.bak` and the store starts empty, with
//! [`Frecency::notice`] saying so. Writes are debounced by [`SAVE_DEBOUNCE`]
//! on a background thread and land via temp file + rename. Call
//! [`Frecency::flush`] before exit so the last pick is not lost to the
//! debounce; it also reports a write that failed since the last one.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::fs;
use crate::index::Source;

/// Age buckets and their weights, youngest first. A visit older than the
/// last bucket weighs [`OLDER_WEIGHT`].
pub const BUCKETS: [(Duration, f32); 4] = [
    (Duration::from_hours(4), 100.0),
    (Duration::from_hours(24), 70.0),
    (Duration::from_hours(3 * 24), 50.0),
    (Duration::from_hours(7 * 24), 30.0),
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
/// The file's name under the profile's data dir.
pub const FILE_NAME: &str = "frecency.json";

/// What the index knows an item by: its source `(extension, palette)` and
/// the item's own id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Key {
    pub extension: String,
    pub palette: String,
    pub id: String,
}

impl Key {
    /// `(extension, palette, id)`, see [`Source`].
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
        self.parts().hash(h);
    }
}

impl Hash for dyn KeyLike + '_ {
    fn hash<H: Hasher>(&self, h: &mut H) {
        self.parts().hash(h);
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
    /// The newest visit, whichever order they arrived in (a clock that went
    /// back can append an older stamp).
    fn last_visit(&self) -> u64 {
        self.visits.iter().copied().max().unwrap_or(0)
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
    Flush(mpsc::Sender<std::io::Result<()>>),
}

/// The store. Cheap to query, owns its file.
pub struct Frecency {
    entries: HashMap<Key, Entry>,
    path: Option<PathBuf>,
    saver: Option<mpsc::Sender<Save>>,
    notice: Option<String>,
}

impl Frecency {
    /// No file: nothing is loaded or saved.
    pub fn in_memory() -> Self {
        Self { entries: HashMap::new(), path: None, saver: None, notice: None }
    }

    /// [`FILE_NAME`] under `dir`, see the module docs.
    pub fn open_in(dir: &Path) -> Self {
        Self::load(dir.join(FILE_NAME))
    }

    /// Load `path`, or start empty when it is missing. A file that does not
    /// parse (or was written by another file version) is renamed to
    /// `<path>.bak` first so nothing is silently lost; a file that cannot be
    /// read at all is left alone and the store runs in memory for this
    /// session, so a later save cannot replace history nobody has seen.
    /// Either way [`notice`](Self::notice) says what happened.
    pub fn load(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let mut store = Self { entries: HashMap::new(), path: Some(path.clone()), saver: None, notice: None };
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return store,
            Err(e) => {
                store.path = None;
                store.notice = Some(format!("{}: {e}; history is off for this session", path.display()));
                return store;
            }
        };
        let why = match serde_json::from_slice::<File>(&bytes) {
            Ok(file) if file.version == FILE_VERSION => {
                store.entries = file.items.into_iter().map(|e| (e.key, e.entry)).collect();
                return store;
            }
            Ok(file) => format!("file version {} (this pal writes {FILE_VERSION})", file.version),
            Err(e) => e.to_string(),
        };
        let bak = bak_path(&path);
        store.notice = Some(match std::fs::rename(&path, &bak) {
            Ok(()) => format!("{}: {why}; moved to {} and starting empty", path.display(), bak.display()),
            Err(e) => format!("{}: {why}; could not move it aside ({e}), starting empty", path.display()),
        });
        store
    }

    /// Where saves go; `None` for [`in_memory`](Self::in_memory) or after a
    /// file that could not be read.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Why the store started empty when it should not have, for the app to
    /// log. `None` on a clean start.
    pub fn notice(&self) -> Option<&str> {
        self.notice.as_deref()
    }

    /// Items with history.
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

    /// What the user typed before picking `key`. Empty queries are ignored,
    /// and so is a key without a recorded pick: a query only means something
    /// as the way to one.
    pub fn record_query(&mut self, key: &Key, query: &str) {
        let Some(q) = normalise_query(query) else { return };
        let Some(e) = self.entries.get_mut(key) else { return };
        e.queries.retain(|old| *old != q);
        e.queries.insert(0, q);
        e.queries.truncate(MAX_QUERIES);
        self.changed();
    }

    /// Drop one item's history (a "remove from recents" action).
    pub fn forget(&mut self, key: &Key) {
        if self.entries.remove(key).is_some() {
            self.changed();
        }
    }

    /// Drop all history.
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

    /// Write now if there is a file, through the saver so a pending
    /// debounced save cannot land after it. Returns that write's result, or
    /// the last debounced write's failure when nothing was pending, so a
    /// directory that stopped taking writes is reported here rather than
    /// never.
    pub fn flush(&mut self) -> std::io::Result<()> {
        let Some(path) = &self.path else { return Ok(()) };
        if let Some(tx) = &self.saver {
            let (ack, done) = mpsc::channel();
            if tx.send(Save::Flush(ack)).is_ok() {
                if let Ok(result) = done.recv() {
                    return result;
                }
            }
            // The saver is gone (it panicked); `changed` starts a new one.
        }
        fs::write_atomic(path, self.snapshot())
    }

    fn changed(&mut self) {
        let Some(path) = &self.path else { return };
        let mut snapshot = Save::Snapshot(self.snapshot());
        if let Some(tx) = &self.saver {
            match tx.send(snapshot) {
                Ok(()) => return,
                Err(mpsc::SendError(back)) => snapshot = back,
            }
        }
        let (tx, rx) = mpsc::channel();
        let target = path.clone();
        let spawned = std::thread::Builder::new().name("pal-frecency-save".into()).spawn(move || saver(&target, &rx));
        match spawned {
            Ok(_) => {
                let _ = tx.send(snapshot);
                self.saver = Some(tx);
            }
            // No thread to be had: write here; if the disk is the problem
            // too, the next `flush` fails on its own write and says so.
            Err(_) => {
                if let Save::Snapshot(s) = snapshot {
                    let _ = fs::write_atomic(path, s);
                }
            }
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
/// writes immediately and acks with the result. Disconnect writes and exits.
fn saver(path: &Path, rx: &mpsc::Receiver<Save>) {
    let mut pending: Option<String> = None;
    // A debounced write that failed, kept for the next flush to report.
    let mut failed: Option<std::io::Error> = None;
    loop {
        let msg = match pending {
            None => rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            Some(_) => rx.recv_timeout(SAVE_DEBOUNCE),
        };
        match msg {
            Ok(Save::Snapshot(s)) => pending = Some(s),
            Ok(Save::Flush(ack)) => {
                let result = match pending.take() {
                    Some(s) => {
                        failed = None;
                        fs::write_atomic(path, s)
                    }
                    None => failed.take().map_or(Ok(()), Err),
                };
                let _ = ack.send(result);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(s) = pending.take() {
                    failed = fs::write_atomic(path, s).err();
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(s) = pending.take() {
                    let _ = fs::write_atomic(path, s);
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
        f.record_query(&key("x"), "a");
        assert!(f.is_empty(), "a query without a pick is nothing to remember");
        f.record(&key("x"), t(D));
        for q in ["a", "b", "c", "d", "b"] {
            f.record_query(&key("x"), q);
        }
        assert_eq!(f.entries[&key("x")].queries, ["b", "d", "c"]);
        f.record_query(&key("x"), "   ");
        assert_eq!(f.entries[&key("x")].queries, ["b", "d", "c"]);
    }

    #[test]
    fn last_visit_survives_a_clock_going_back() {
        let mut f = Frecency::in_memory();
        let now = 100 * D;
        f.record(&key("a"), t(now - 10));
        f.record(&key("a"), t(now - 3 * D));
        f.record(&key("b"), t(now - 60));
        assert_eq!(f.entries[&key("a")].last_visit(), now - 10);
        let top: Vec<_> = f.top(2, t(now)).into_iter().map(|k| k.id).collect();
        assert_eq!(top[0], "a", "two visits beat one; the older stamp does not make it look stale");
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
        assert!(f.notice().is_some_and(|n| n.contains("frecency.json.bak")), "{:?}", f.notice());
        assert_eq!(std::fs::read(bak_path(&path)).unwrap(), b"{ this is not json");
        assert!(!path.exists());
        f.record(&key("a"), t(D));
        f.flush().unwrap();
        let g = Frecency::load(&path);
        assert_eq!((g.len(), g.notice()), (1, None));
    }

    #[test]
    fn other_file_version_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frecency.json");
        std::fs::write(&path, r#"{"version":2,"items":[]}"#).unwrap();
        let f = Frecency::load(&path);
        assert!(f.notice().is_some_and(|n| n.contains("version 2")), "{:?}", f.notice());
        assert!(bak_path(&path).exists());
    }

    #[test]
    fn unreadable_file_runs_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let mut f = Frecency::load(dir.path());
        assert!(f.path().is_none());
        assert!(f.notice().is_some_and(|n| n.contains("history is off")), "{:?}", f.notice());
        f.record(&key("a"), t(D));
        f.flush().unwrap();
        assert!(dir.path().is_dir(), "nothing was written over it");
    }

    #[test]
    fn flush_reports_a_failed_debounced_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frecency.json");
        let mut f = Frecency::load(&path);
        f.record(&key("a"), t(D));
        f.flush().unwrap();
        // Make the directory a file: the next rename has nowhere to go.
        std::fs::remove_dir_all(dir.path()).unwrap();
        std::fs::write(dir.path(), "").unwrap();
        f.record(&key("b"), t(D));
        std::thread::sleep(SAVE_DEBOUNCE * 3);
        assert!(f.flush().is_err(), "the debounced write failed and flush says so");
        assert!(f.flush().is_ok(), "reported once");
        std::fs::remove_file(dir.path()).unwrap();
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
