//! The item index: every listed item of every palette in one place, matched
//! and ranked here so a keystroke costs one scan in Rust and only the top N
//! cross to the webview. Ranking is the `weighted` engine from `matchbench`
//! (notes/matching.md): name, keywords and subtitle are separate
//! nucleo-matcher fields, one thread, synchronous.

use std::cmp::Ordering;
use std::collections::HashMap;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32String};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One listed item as an extension sends it. A working shape, not the final
/// contract: the fields the index reads are typed, the rest passes through.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,
    /// Opaque for now: a path, a glyph, a URL, whatever the extension sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// Everything else, untouched, for the UI and the action that runs it.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

/// Where a set of items comes from: one palette of one extension.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Source {
    pub extension: String,
    pub palette: String,
}

impl Source {
    pub fn new(extension: impl Into<String>, palette: impl Into<String>) -> Self {
        Self { extension: extension.into(), palette: palette.into() }
    }
}

/// One ranked result. `(source, id)` is the handle the UI acts on;
/// `name_positions` are char indexes into the name for highlighting.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hit {
    pub source: Source,
    pub id: String,
    pub score: f32,
    pub name_positions: Vec<u32>,
}

pub struct QueryOpts<'a> {
    pub limit: usize,
    /// Only these sources; `None` is all of them.
    pub sources: Option<&'a [Source]>,
    /// Added to every candidate's match score (0 for the empty query) before
    /// the top-N select, so a weak match with a large boost still climbs.
    /// Frecency plugs in here.
    #[allow(clippy::type_complexity)]
    pub boost: Option<&'a dyn Fn(&Source, &str) -> f32>,
}

impl Default for QueryOpts<'_> {
    fn default() -> Self {
        Self { limit: 200, sources: None, boost: None }
    }
}

struct Entry {
    item: Item,
    name: Utf32String,
    keywords: Vec<Utf32String>,
    subtitle: Option<Utf32String>,
}

impl From<Item> for Entry {
    fn from(item: Item) -> Self {
        Self {
            name: Utf32String::from(item.name.as_str()),
            keywords: item.keywords.iter().map(|k| Utf32String::from(k.as_str())).collect(),
            subtitle: item.subtitle.as_deref().map(Utf32String::from),
            item,
        }
    }
}

struct Bucket {
    source: Source,
    entries: Vec<Entry>,
    /// id to position; the first item wins when an extension repeats an id.
    ids: HashMap<String, usize>,
    /// Ordered by arrival, not by use: `QueryOpts::boost` skips it.
    live: bool,
}

/// What the index knows about one source, for the UI's section labels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceInfo {
    pub source: Source,
    pub live: bool,
    pub len: usize,
}

impl Bucket {
    fn push(&mut self, item: Item) {
        self.ids.entry(item.id.clone()).or_insert(self.entries.len());
        self.entries.push(item.into());
    }
}

/// Items grouped by source, in the order sources first appeared. `query`
/// takes `&mut self`: the matcher and the parsed pattern are scratch that
/// every query reuses, and the index will sit behind a `Mutex` in the app
/// anyway (Tauri state must be `Sync`), so interior mutability here would
/// only add a second lock and hide that a query writes.
pub struct Index {
    buckets: Vec<Bucket>,
    matcher: Matcher,
    pat: Pattern,
}

impl Default for Index {
    fn default() -> Self {
        Self::new()
    }
}

impl Index {
    pub fn new() -> Self {
        Self { buckets: Vec::new(), matcher: Matcher::new(Config::DEFAULT), pat: Pattern::default() }
    }

    /// Swap a source's items for `items` (a palette re-listed). The source
    /// keeps its place in the order; a new source goes last.
    pub fn replace(&mut self, source: Source, items: Vec<Item>) {
        let bucket = self.bucket(source);
        bucket.entries.clear();
        bucket.ids.clear();
        items.into_iter().for_each(|i| bucket.push(i));
    }

    /// Append `items` to a source (a palette still streaming its list).
    pub fn extend(&mut self, source: Source, items: Vec<Item>) {
        let bucket = self.bucket(source);
        items.into_iter().for_each(|i| bucket.push(i));
    }

    pub fn remove(&mut self, source: &Source) {
        self.buckets.retain(|b| &b.source != source);
    }

    /// Mark a source live (see `Bucket::live`); creates it empty if new.
    pub fn set_live(&mut self, source: Source, live: bool) {
        self.bucket(source).live = live;
    }

    pub fn sources(&self) -> Vec<SourceInfo> {
        self.buckets.iter().map(|b| SourceInfo { source: b.source.clone(), live: b.live, len: b.entries.len() }).collect()
    }

    pub fn len(&self) -> usize {
        self.buckets.iter().map(|b| b.entries.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn get(&self, source: &Source, id: &str) -> Option<&Item> {
        let b = self.buckets.iter().find(|b| &b.source == source)?;
        b.ids.get(id).map(|&i| &b.entries[i].item)
    }

    fn bucket(&mut self, source: Source) -> &mut Bucket {
        let i = match self.buckets.iter().position(|b| b.source == source) {
            Some(i) => i,
            None => {
                self.buckets.push(Bucket { source, entries: Vec::new(), ids: HashMap::new(), live: false });
                self.buckets.len() - 1
            }
        };
        &mut self.buckets[i]
    }

    /// Rank `q` over the index: best `opts.limit` hits, best first. The empty
    /// query lists everything in insertion order (plus boost).
    pub fn query(&mut self, q: &str, opts: QueryOpts) -> Vec<Hit> {
        self.pat.reparse(q, CaseMatching::Smart, Normalization::Smart);
        let matching = !self.pat.atoms.is_empty();
        let mut cands = Vec::new();
        'scan: for (b, bucket) in self.buckets.iter().enumerate() {
            if opts.sources.is_some_and(|s| !s.contains(&bucket.source)) {
                continue;
            }
            for (e, entry) in bucket.entries.iter().enumerate() {
                // Without matching or boost the scan order is the result order.
                if !matching && opts.boost.is_none() && cands.len() == opts.limit {
                    break 'scan;
                }
                let score = if matching {
                    match score(&self.pat, &mut self.matcher, entry) {
                        Some(s) => s as f32,
                        None => continue,
                    }
                } else {
                    0.0
                };
                let boost = if bucket.live { None } else { opts.boost };
                let score = score + boost.map_or(0.0, |f| f(&bucket.source, &entry.item.id));
                // Name length only breaks ties between matches; the empty
                // query keeps insertion order.
                let len = if matching { entry.name.len() as u32 } else { 0 };
                cands.push(Cand { score, len, b: b as u32, e: e as u32 });
            }
        }
        if cands.len() > opts.limit {
            cands.select_nth_unstable_by(opts.limit, Cand::cmp);
            cands.truncate(opts.limit);
        }
        cands.sort_unstable_by(Cand::cmp);

        let mut buf = Vec::new();
        cands
            .into_iter()
            .map(|c| {
                let bucket = &self.buckets[c.b as usize];
                let entry = &bucket.entries[c.e as usize];
                let mut name_positions = Vec::new();
                // Per word, not `Pattern::indices` over the whole pattern:
                // a word that landed in a keyword must not blank the
                // highlight of the words that landed in the name.
                for atom in &self.pat.atoms {
                    buf.clear();
                    if atom.indices(entry.name.slice(..), &mut self.matcher, &mut buf).is_some() {
                        name_positions.append(&mut buf);
                    }
                }
                name_positions.sort_unstable();
                name_positions.dedup();
                Hit { source: bucket.source.clone(), id: entry.item.id.clone(), score: c.score, name_positions }
            })
            .collect()
    }
}

/// A scored candidate; `(b, e)` is its insertion order.
struct Cand {
    score: f32,
    len: u32,
    b: u32,
    e: u32,
}

impl Cand {
    /// Score desc, then shorter name, then insertion order. nucleo scores a
    /// word-start match the same as a start-of-string one, so exact over
    /// prefix over "second word" is decided by the length here, not the score.
    fn cmp(a: &Self, b: &Self) -> Ordering {
        b.score.total_cmp(&a.score).then(a.len.cmp(&b.len)).then((a.b, a.e).cmp(&(b.b, b.e)))
    }
}

/// Percent of the nucleo field score. A keyword is what the extension says
/// the item is also called, so it counts nearly as much as the name; a
/// subtitle is a description, where a match is weak evidence.
const W_NAME: u32 = 100;
const W_KEYWORD: u32 = 80;
const W_SUBTITLE: u32 = 50;

/// Every query word must land in some field; each takes its best weighted
/// field and the item's score is the sum. So `cast tv` matches an item named
/// `cast` with keyword `tv`, which one pattern over one field would reject.
fn score(pat: &Pattern, matcher: &mut Matcher, f: &Entry) -> Option<u32> {
    let mut total = 0;
    for atom in &pat.atoms {
        let mut best = None;
        let mut consider = |s: Option<u16>, w: u32| {
            if let Some(s) = s {
                let s = s as u32 * w / 100;
                if best.is_none_or(|b| s > b) {
                    best = Some(s);
                }
            }
        };
        consider(atom.score(f.name.slice(..), matcher), W_NAME);
        for kw in &f.keywords {
            consider(atom.score(kw.slice(..), matcher), W_KEYWORD);
        }
        if let Some(sub) = &f.subtitle {
            consider(atom.score(sub.slice(..), matcher), W_SUBTITLE);
        }
        total += best?;
    }
    Some(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, name: &str, subtitle: Option<&str>, keywords: &[&str]) -> Item {
        Item {
            id: id.into(),
            name: name.into(),
            subtitle: subtitle.map(Into::into),
            keywords: keywords.iter().map(|k| k.to_string()).collect(),
            icon: None,
            section: None,
            extra: Default::default(),
        }
    }

    fn src(palette: &str) -> Source {
        Source::new("t", palette)
    }

    fn index() -> Index {
        let mut ix = Index::new();
        ix.replace(
            src("apps"),
            vec![
                item("chrome.app", "Google Chrome", Some("Applications"), &["com.google.Chrome"]),
                item("terminal.app", "Terminal", Some("macOS"), &["com.apple.Terminal"]),
                item("ghostty.app", "Ghostty", Some("Applications"), &["terminal", "shell"]),
                item("handler.app", "Claude Code URL Handler", Some("Applications"), &[]),
            ],
        );
        ix.replace(
            src("icons"),
            vec![
                item("i1", "chrome", None, &["nf-dev"]),
                item("i2", "chromecast", None, &["nf-md"]),
                item("i3", "cast", None, &["chromecast", "tv"]),
                item("i4", "cast_audio", None, &["nf-md"]),
                item("i5", "hand", None, &["nf-fa"]),
                item("i6", "hat", None, &["nf-fa"]),
                item("i7", "terminal_bash", None, &["nf-md"]),
            ],
        );
        ix.replace(src("bookmarks"), vec![item("ha", "ha", Some("Home Assistant"), &["assistant", "home"])]);
        ix
    }

    fn ids(hits: &[Hit]) -> Vec<&str> {
        hits.iter().map(|h| h.id.as_str()).collect()
    }

    fn pos(hits: &[Hit], id: &str) -> usize {
        hits.iter().position(|h| h.id == id).unwrap_or_else(|| panic!("{id} not in {:?}", ids(hits)))
    }

    #[test]
    fn exact_name_first_then_name_over_keyword() {
        let hits = index().query("chrome", QueryOpts::default());
        assert_eq!(ids(&hits)[..3], ["i1", "i2", "chrome.app"]);
        assert!(pos(&hits, "chrome.app") < pos(&hits, "i3"));
    }

    #[test]
    fn short_exact_name_beats_longer_names() {
        let hits = index().query("ha", QueryOpts::default());
        assert_eq!(hits[0].id, "ha");
        assert!(pos(&hits, "i6") < pos(&hits, "handler.app"));
    }

    #[test]
    fn name_match_over_keyword_only() {
        let hits = index().query("term", QueryOpts::default());
        assert_eq!(ids(&hits)[..2], ["terminal.app", "i7"]);
        assert!(pos(&hits, "i7") < pos(&hits, "ghostty.app"));
    }

    #[test]
    fn every_word_must_land() {
        let hits = index().query("cast tv", QueryOpts::default());
        assert_eq!(ids(&hits), ["i3"]);
        assert!(index().query("cast xqzv", QueryOpts::default()).is_empty());
    }

    #[test]
    fn no_match_is_empty() {
        assert!(index().query("xqzv", QueryOpts::default()).is_empty());
    }

    #[test]
    fn empty_query_is_insertion_order() {
        let mut ix = index();
        let all = ix.query("", QueryOpts::default());
        assert_eq!(all.len(), ix.len());
        assert_eq!(ids(&all)[..5], ["chrome.app", "terminal.app", "ghostty.app", "handler.app", "i1"]);
        assert_eq!(all.last().unwrap().id, "ha");
        assert!(all.iter().all(|h| h.score == 0.0 && h.name_positions.is_empty()));
        let three = ix.query("", QueryOpts { limit: 3, ..Default::default() });
        assert_eq!(ids(&three), ["chrome.app", "terminal.app", "ghostty.app"]);
    }

    #[test]
    fn boost_reorders_matches_and_empty_state() {
        let mut ix = index();
        let favour = |id: &'static str| move |_: &Source, i: &str| if i == id { 1000.0 } else { 0.0 };
        let hand = favour("i5");
        let hits = ix.query("ha", QueryOpts { boost: Some(&hand), ..Default::default() });
        assert_eq!(ids(&hits)[..2], ["i5", "ha"]);
        let bookmark = favour("ha");
        let hits = ix.query("", QueryOpts { boost: Some(&bookmark), limit: 2, ..Default::default() });
        assert_eq!(ids(&hits), ["ha", "chrome.app"]);
    }

    #[test]
    fn live_source_ignores_boost() {
        let mut ix = index();
        let favour = |_: &Source, id: &str| if id == "i5" || id == "ha" { 1000.0 } else { 0.0 };
        ix.set_live(src("icons"), true);
        let hits = ix.query("ha", QueryOpts { boost: Some(&favour), ..Default::default() });
        // The bookmark still climbs; the live icon keeps its matched rank.
        assert_eq!(hits[0].id, "ha");
        assert_eq!(hits[pos(&hits, "i5")].score, hits[pos(&hits, "i6")].score);
        let hits = ix.query("", QueryOpts { boost: Some(&favour), limit: 3, ..Default::default() });
        assert_eq!(ids(&hits), ["ha", "chrome.app", "terminal.app"]);
        assert_eq!(ix.sources().iter().map(|s| (s.source.palette.as_str(), s.live, s.len)).collect::<Vec<_>>(), [("apps", false, 4), ("icons", true, 7), ("bookmarks", false, 1)]);
        // Flagging before any items arrive creates the source in place.
        ix.set_live(src("otp"), true);
        ix.replace(src("otp"), vec![item("o1", "code", None, &[])]);
        assert_eq!(ix.sources().last().map(|s| (s.live, s.len)), Some((true, 1)));
    }

    #[test]
    fn sources_filter() {
        let apps = [src("apps")];
        let hits = index().query("chrome", QueryOpts { sources: Some(&apps), ..Default::default() });
        assert_eq!(ids(&hits), ["chrome.app"]);
    }

    #[test]
    fn replace_extend_remove() {
        let mut ix = index();
        assert_eq!(ix.len(), 12);
        ix.replace(src("icons"), vec![item("n1", "new", None, &[])]);
        assert_eq!(ix.len(), 6);
        assert!(ix.get(&src("icons"), "i1").is_none());
        assert_eq!(ix.get(&src("icons"), "n1").unwrap().name, "new");
        // A replaced source keeps its place in the order.
        assert_eq!(ids(&ix.query("", QueryOpts::default()))[4..], ["n1", "ha"]);
        ix.extend(src("icons"), vec![item("n2", "newer", None, &[])]);
        ix.extend(src("late"), vec![item("l1", "late", None, &[])]);
        assert_eq!(ids(&ix.query("", QueryOpts::default()))[4..], ["n1", "n2", "ha", "l1"]);
        assert_eq!(ix.get(&src("late"), "l1").unwrap().name, "late");
        ix.remove(&src("apps"));
        assert_eq!(ix.len(), 4);
        assert!(ix.get(&src("apps"), "chrome.app").is_none());
        assert_eq!(ids(&ix.query("", QueryOpts::default())), ["n1", "n2", "ha", "l1"]);
        ix.remove(&src("nope"));
        assert_eq!(ix.len(), 4);
    }

    #[test]
    fn positions_index_the_name() {
        let mut ix = index();
        let hits = ix.query("chrome", QueryOpts::default());
        assert_eq!(hits[pos(&hits, "chrome.app")].name_positions, [7, 8, 9, 10, 11, 12]);
        // Keyword-only hit: nothing to highlight in the name.
        assert!(hits[pos(&hits, "i3")].name_positions.is_empty());
        // Fuzzy: the positions spell the query, in order.
        let hits = ix.query("gchr", QueryOpts::default());
        let p = &hits[pos(&hits, "chrome.app")].name_positions;
        let name: Vec<char> = "Google Chrome".chars().collect();
        let spelled: String = p.iter().map(|&i| name[i as usize].to_ascii_lowercase()).collect();
        assert_eq!(spelled, "gchr");
        assert!(p.windows(2).all(|w| w[0] < w[1]));
        // Cross-field: the word in the name is highlighted, the keyword one is not.
        let hits = ix.query("cast tv", QueryOpts::default());
        assert_eq!(hits[0].name_positions, [0, 1, 2, 3]);
    }

    #[test]
    fn item_round_trips_with_extra() {
        let raw = r#"{"id":"x","name":"X","exec":"open x","icon":"/a.app","nested":{"a":1}}"#;
        let it: Item = serde_json::from_str(raw).unwrap();
        assert_eq!(it.extra["exec"], "open x");
        assert_eq!(it.icon, Some(Value::String("/a.app".into())));
        let back: Value = serde_json::to_value(&it).unwrap();
        assert_eq!(back, serde_json::from_str::<Value>(raw).unwrap());
    }

    /// Ranking heads from notes/matching.md over the real corpus, plus the
    /// per-keystroke cost. `cargo test -p pal-core --release -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn fixture_heads_and_timing() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../app/fixtures/all.jsonl");
        let Ok(text) = std::fs::read_to_string(path) else {
            eprintln!("no fixture at {path}, skipping");
            return;
        };
        let mut ix = Index::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let mut row: serde_json::Map<String, Value> = serde_json::from_str(line).unwrap();
            let palette = row.remove("palette").and_then(|p| p.as_str().map(String::from)).unwrap();
            let it: Item = serde_json::from_value(Value::Object(row)).unwrap();
            ix.extend(Source::new("fixture", palette), vec![it]);
        }
        assert_eq!(ix.len(), 14719);
        let name = |ix: &Index, h: &Hit| ix.get(&h.source, &h.id).unwrap().name.clone();

        let hits = ix.query("chrome", QueryOpts::default());
        assert_eq!(name(&ix, &hits[0]), "chrome");
        let gc = hits.iter().position(|h| h.source.palette == "apps" && name(&ix, h) == "Google Chrome").unwrap();
        let cast = hits.iter().position(|h| h.source.palette == "cmds" && h.id == "cast").unwrap();
        assert!(gc < 5 && gc < cast, "Google Chrome {gc}, cast {cast}");
        let hits = ix.query("ha", QueryOpts::default());
        assert_eq!((hits[0].source.palette.as_str(), hits[0].id.as_str()), ("bookmarks", "ha"));
        let hits = ix.query("term", QueryOpts::default());
        assert_eq!((hits[0].source.palette.as_str(), name(&ix, &hits[0]).as_str()), ("apps", "Terminal"));
        let hits = ix.query("slack", QueryOpts::default());
        assert_eq!((hits[0].source.palette.as_str(), name(&ix, &hits[0]).as_str()), ("apps", "Slack"));

        for q in ["c", "chrome", "ha", ""] {
            let mut t = Vec::new();
            for _ in 0..205 {
                let s = std::time::Instant::now();
                std::hint::black_box(ix.query(q, QueryOpts::default()));
                t.push(s.elapsed());
            }
            t.drain(..5);
            t.sort();
            eprintln!("{q:>8}: median {:?}  p95 {:?}", t[t.len() / 2], t[t.len() * 95 / 100]);
        }
    }
}
