//! The item index: every listed item of every palette in one place, matched
//! and ranked here so a keystroke costs one scan in Rust and only the top N
//! cross to the webview. Ranking is the `weighted` engine from `matchbench`
//! (notes/matching.md): name, keywords and subtitle are separate
//! nucleo-matcher fields, one thread, synchronous.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
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

/// One ranked result. `(source, id)` is the handle the UI acts on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hit {
    pub source: Source,
    pub id: String,
    /// Match score plus boost; only comparable within one query.
    pub score: f32,
    /// Matched positions in the name, ascending, one per grapheme cluster
    /// (nucleo's unit: a flag or a family emoji is one position, not two or
    /// seven code points). Split the name with `Intl.Segmenter` to apply
    /// them; `[...name]` drifts after such a cluster.
    pub name_positions: Vec<u32>,
}

/// Per-candidate score adjustment, see [`QueryOpts::boost`].
pub type Boost<'a> = &'a dyn Fn(&Source, &str) -> f32;

pub struct QueryOpts<'a> {
    /// At most this many hits; the best ones when there are more.
    pub limit: usize,
    /// Only these sources; `None` is all of them.
    pub sources: Option<&'a [Source]>,
    /// Added to every candidate's match score (0 for the empty query) before
    /// the top-N select, so a weak match with a large boost still climbs.
    /// Frecency plugs in here.
    pub boost: Option<Boost<'a>>,
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

impl Entry {
    /// The item is called `q`: its name, or one of its keywords (an alias),
    /// equals it case-insensitively, whitespace trimmed.
    fn is_exactly(&self, q: &str) -> bool {
        eq_ignore_case(self.item.name.trim(), q) || self.item.keywords.iter().any(|k| eq_ignore_case(k.trim(), q))
    }
}

/// Case-insensitive equality by Unicode lowercase, no normalisation (an
/// accent is part of the name). Stops at the first differing char, so a
/// scan over every match costs about one comparison each.
fn eq_ignore_case(a: &str, b: &str) -> bool {
    a.chars().flat_map(char::to_lowercase).eq(b.chars().flat_map(char::to_lowercase))
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
    /// Rows came from [`Index::restore`] (a cache) and no fresh list has
    /// replaced them yet, or a refresh was marked as pending.
    stale: bool,
    /// Unix seconds of the last `replace` (or what `restore` was told).
    listed_at: Option<u64>,
}

/// What the index knows about one source, for the UI's section labels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceInfo {
    pub source: Source,
    pub live: bool,
    pub len: usize,
    /// See [`Index::restore`]: rows are a cached listing until a fresh one lands.
    pub stale: bool,
    /// Unix seconds of the listing the rows came from; `None` for a source
    /// that only ever `extend`ed or was created by `set_live`.
    pub listed_at: Option<u64>,
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

impl Bucket {
    fn push(&mut self, item: Item) {
        self.ids.entry(item.id.clone()).or_insert(self.entries.len());
        self.entries.push(item.into());
    }

    fn fill(&mut self, items: Vec<Item>) {
        self.entries.clear();
        self.ids.clear();
        for item in items {
            self.push(item);
        }
    }

    fn info(&self) -> SourceInfo {
        SourceInfo { source: self.source.clone(), live: self.live, len: self.entries.len(), stale: self.stale, listed_at: self.listed_at }
    }
}

/// Items grouped by source, in the order sources first appeared. `query`
/// takes `&mut self`: the matcher is scratch that every query reuses, and
/// the index will sit behind a `Mutex` in the app anyway (Tauri state must
/// be `Sync`), so interior mutability here would only add a second lock and
/// hide that a query writes.
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
    /// keeps its place in the order; a new source goes last. The rows are
    /// fresh: `stale` clears and `listed_at` is now.
    pub fn replace(&mut self, source: Source, items: Vec<Item>) {
        let bucket = self.bucket(source);
        bucket.stale = false;
        bucket.listed_at = Some(unix_now());
        bucket.fill(items);
    }

    /// Like [`replace`](Self::replace) but with rows from a cache: the
    /// source is `stale` until a real listing replaces them, and
    /// `listed_at` is the cached listing's time, so the caller can tell
    /// how old they are. Marks the source `live` like a listing would.
    pub fn restore(&mut self, source: Source, items: Vec<Item>, listed_at: Option<u64>, live: bool) {
        let bucket = self.bucket(source);
        bucket.stale = true;
        bucket.listed_at = listed_at;
        bucket.live = live;
        bucket.fill(items);
    }

    /// A source's items as listed, in order, for a cache to write; empty
    /// for a source the index does not have.
    pub fn snapshot(&self, source: &Source) -> Vec<Item> {
        self.buckets.iter().find(|b| &b.source == source).map(|b| b.entries.iter().map(|e| e.item.clone()).collect()).unwrap_or_default()
    }

    /// Flag a source's rows as (not) awaiting a fresh listing. Creates the
    /// source empty if new.
    pub fn set_stale(&mut self, source: Source, stale: bool) {
        self.bucket(source).stale = stale;
    }

    /// One source's info, `None` when the index does not have it.
    pub fn source(&self, source: &Source) -> Option<SourceInfo> {
        self.buckets.iter().find(|b| &b.source == source).map(Bucket::info)
    }

    /// Append `items` to a source (a palette still streaming its list).
    pub fn extend(&mut self, source: Source, items: Vec<Item>) {
        let bucket = self.bucket(source);
        for item in items {
            bucket.push(item);
        }
    }

    /// Drop a source and its items; it goes last if it comes back.
    pub fn remove(&mut self, source: &Source) {
        self.buckets.retain(|b| &b.source != source);
    }

    /// Mark a source live: its order is arrival order, so `QueryOpts::boost`
    /// does not apply to it. Creates the source empty if new.
    pub fn set_live(&mut self, source: Source, live: bool) {
        self.bucket(source).live = live;
    }

    /// Every source in order, with its item count.
    pub fn sources(&self) -> Vec<SourceInfo> {
        self.buckets.iter().map(Bucket::info).collect()
    }

    /// Items across all sources.
    pub fn len(&self) -> usize {
        self.buckets.iter().map(|b| b.entries.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The item a [`Hit`] names; the first one when a source repeated an id.
    pub fn get(&self, source: &Source, id: &str) -> Option<&Item> {
        let b = self.buckets.iter().find(|b| &b.source == source)?;
        b.ids.get(id).map(|&i| &b.entries[i].item)
    }

    fn bucket(&mut self, source: Source) -> &mut Bucket {
        let i = match self.buckets.iter().position(|b| b.source == source) {
            Some(i) => i,
            None => {
                self.buckets.push(Bucket { source, entries: Vec::new(), ids: HashMap::new(), live: false, stale: false, listed_at: None });
                self.buckets.len() - 1
            }
        };
        &mut self.buckets[i]
    }

    /// Rank `q` over the index: best `opts.limit` hits, best first. The empty
    /// query lists everything in insertion order (plus boost). Words match
    /// fuzzily and independently; `!`, `^`, `'` and `$` are ordinary text,
    /// not fzf operators (Spotlight and Raycast have none, and a bookmark
    /// called `!important` must be findable). An item named what was typed
    /// (or with a keyword saying so) gets [`EXACT_BONUS`] and leads.
    pub fn query(&mut self, q: &str, opts: QueryOpts) -> Vec<Hit> {
        self.pat = Pattern::new(q, CaseMatching::Smart, Normalization::Smart, AtomKind::Fuzzy);
        let matching = !self.pat.atoms.is_empty();
        let exact_q = q.trim();
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
                let score = if matching && entry.is_exactly(exact_q) { score + EXACT_BONUS } else { score };
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

/// Added to the score of an item named what was typed (name or keyword,
/// case-insensitive), so it ranks above every fuzzy hit whatever their
/// history: what you typed *is* this item (Raycast does the same with names
/// and aliases). Sized against the two other adjustments: a frecency boost
/// tops out at 200 (`frecency::MAX_SCORE * BOOST_SCALE`), and nucleo gives
/// about 16 per matched char, so a hot fuzzy hit is at most 200 plus a
/// fraction of the query's own score above an untouched exact hit (a
/// keyword-exact hit scores 80% of a name hit: 33 apart at `chrome`). 1000
/// clears that for any query a launcher sees; at 16 per char the spread
/// would need a 50-char query to approach it. The welcome source's 1e9 is
/// only ever added on the empty query, where nothing is exact. Among exact
/// hits the score (with its boost) and then the name length still order.
///
/// No prefix bonus, on purpose: nucleo scores a word-start match the same
/// as a prefix or an exact one (`ha` is 62 for `ha`, `hat` and `Claude
/// Code URL Handler` alike, fixture corpus), so a bonus that mattered
/// against a boosted item would have to be at least the boost, and a used
/// item overtaking an untouched prefix hit is what the frecency scale is
/// designed to do (`frecency.rs`, "Composing with the match score"). The
/// length tie-break already puts the prefix hit first among equals.
pub const EXACT_BONUS: f32 = 1000.0;

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
    fn fzf_operators_are_plain_text() {
        let mut ix = index();
        ix.extend(src("bookmarks"), vec![item("imp", "!important", None, &[]), item("dollar", "$HOME", None, &[])]);
        assert_eq!(ids(&ix.query("!imp", QueryOpts::default())), ["imp"], "not a negation");
        assert_eq!(ids(&ix.query("$ho", QueryOpts::default())), ["dollar"]);
        assert_eq!(ids(&ix.query("chrome$", QueryOpts::default())), Vec::<&str>::new(), "not a suffix anchor");
        assert!(ix.query("^chrome", QueryOpts::default()).is_empty(), "not a prefix anchor");
        assert!(ix.query("'chrome", QueryOpts::default()).is_empty(), "not a substring mode");
        assert!(ix.query("   ", QueryOpts::default()).len() == ix.len(), "whitespace is the empty query");
    }

    #[test]
    fn limit_cuts_after_ranking() {
        let mut ix = index();
        assert!(ix.query("", QueryOpts { limit: 0, ..Default::default() }).is_empty());
        assert!(ix.query("chrome", QueryOpts { limit: 0, ..Default::default() }).is_empty());
        let all = ix.query("nf", QueryOpts::default());
        let one = ix.query("nf", QueryOpts { limit: 1, ..Default::default() });
        assert_eq!(ids(&one), ids(&all)[..1], "the head of the full ranking, not the first scanned");
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
    fn exact_name_beats_a_boosted_fuzzy_hit() {
        let mut ix = index();
        // The frecency maximum on the emoji `hand`: without the bonus it leads.
        let hand = |_: &Source, i: &str| if i == "i5" { 200.0 } else { 0.0 };
        let hits = ix.query("ha", QueryOpts { boost: Some(&hand), ..Default::default() });
        assert_eq!(ids(&hits)[..2], ["ha", "i5"]);
        assert_eq!(hits[0].score, hits[1].score - 200.0 + EXACT_BONUS);
        // Case-insensitive, trimmed; a keyword is an alias. (An upper-case
        // query is case-sensitive to the matcher, nucleo's Smart case, and
        // the bonus only goes to a match; `TERMINAL` finds nothing at all.)
        let hits = ix.query("  terminal ", QueryOpts { boost: Some(&hand), ..Default::default() });
        assert_eq!(ids(&hits)[..2], ["terminal.app", "ghostty.app"], "name exact first, keyword exact second");
        assert!(hits[1].score > hits[2].score + 500.0, "the keyword alias got the bonus too");
        assert!(ix.query("TERMINAL", QueryOpts::default()).is_empty());
        // A multi-word name: the whole trimmed query is compared.
        let hits = ix.query("google chrome", QueryOpts::default());
        assert_eq!(hits[0].id, "chrome.app");
        assert!(hits[0].score > EXACT_BONUS);
        // Ties among exact hits: score (with boost) first, then name length.
        let mut ix = index();
        ix.extend(src("icons"), vec![item("i8", "Chrome", None, &[]), item("i9", "chrome ", None, &[])]);
        let hits = ix.query("chrome", QueryOpts::default());
        assert_eq!(ids(&hits)[..3], ["i1", "i8", "i9"], "equal scores: insertion order");
        let i9 = |_: &Source, i: &str| if i == "i9" { 10.0 } else { 0.0 };
        let hits = ix.query("chrome", QueryOpts { boost: Some(&i9), ..Default::default() });
        assert_eq!(ids(&hits)[..3], ["i9", "i1", "i8"]);
        // No accent folding for exactness: `Émile` is not `emile`.
        ix.extend(src("icons"), vec![item("e", "Émile", None, &[])]);
        let hits = ix.query("emile", QueryOpts::default());
        assert!(hits[0].score < EXACT_BONUS);
        assert!(ix.query("émile", QueryOpts::default())[0].score > EXACT_BONUS);
        // Live sources get it too: exactness is the match, not the history.
        ix.set_live(src("icons"), true);
        assert!(ix.query("hand", QueryOpts::default())[0].score > EXACT_BONUS);
    }

    #[test]
    fn prefix_and_word_start_score_alike_length_decides() {
        // Measured on the fixture too (`ha`: 62 for `ha`, `hat` and `Claude
        // Code URL Handler`): nucleo has no prefix preference, the length
        // tie-break orders them, and a boost of any size flips a non-exact
        // one. That is why there is an EXACT_BONUS and no prefix bonus.
        let mut ix = index();
        let hits = ix.query("ha", QueryOpts::default());
        let (hat, handler) = (pos(&hits, "i6"), pos(&hits, "handler.app"));
        assert_eq!(hits[hat].score, hits[handler].score);
        assert!(hat < handler);
        let one = |_: &Source, i: &str| if i == "handler.app" { 1.0 } else { 0.0 };
        let hits = ix.query("ha", QueryOpts { boost: Some(&one), ..Default::default() });
        assert!(pos(&hits, "handler.app") < pos(&hits, "i6"));
        assert_eq!(hits[0].id, "ha", "the exact hit still leads");
    }

    #[test]
    fn boost_reorders_matches_and_empty_state() {
        let mut ix = index();
        let favour = |id: &'static str| move |_: &Source, i: &str| if i == id { 1000.0 } else { 0.0 };
        let hand = favour("i5");
        let hits = ix.query("han", QueryOpts { boost: Some(&hand), ..Default::default() });
        assert_eq!(ids(&hits)[..2], ["i5", "handler.app"]);
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
    fn snapshot_restore_round_trip() {
        let ix = index();
        let items = ix.snapshot(&src("icons"));
        assert_eq!(items.len(), 7);
        assert_eq!(items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["i1", "i2", "i3", "i4", "i5", "i6", "i7"], "listing order");
        assert!(ix.snapshot(&src("nope")).is_empty());
        // A listing is fresh and dated; a restored one is stale, dated as told.
        let info = ix.source(&src("icons")).unwrap();
        assert!(!info.stale && info.listed_at.is_some_and(|t| t > 0));
        let mut fresh = Index::new();
        fresh.restore(src("icons"), items, Some(1234), true);
        let info = fresh.source(&src("icons")).unwrap();
        assert_eq!((info.stale, info.listed_at, info.live, info.len), (true, Some(1234), true, 7));
        assert_eq!(fresh.snapshot(&src("icons")), ix.snapshot(&src("icons")));
        assert_eq!(ids(&fresh.query("chrome", QueryOpts::default())), ["i1", "i2", "i3"], "restored rows match like listed ones");
        // A real listing clears the flag and re-dates; set_stale flags a pending refresh.
        fresh.replace(src("icons"), vec![item("n1", "new", None, &[])]);
        let info = fresh.source(&src("icons")).unwrap();
        assert!(!info.stale && info.listed_at.is_some_and(|t| t > 1234));
        fresh.set_stale(src("icons"), true);
        assert!(fresh.source(&src("icons")).unwrap().stale);
        assert!(fresh.source(&src("nope")).is_none());
        // Restore keeps a source's place, like replace.
        fresh.restore(src("a"), vec![], None, false);
        fresh.restore(src("icons"), vec![], None, false);
        assert_eq!(fresh.sources().iter().map(|s| s.source.palette.as_str()).collect::<Vec<_>>(), ["icons", "a"]);
        assert_eq!(fresh.sources()[1].listed_at, None);
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
    fn positions_count_grapheme_clusters() {
        let mut ix = Index::new();
        ix.replace(src("x"), vec![item("tr", "\u{1F1F9}\u{1F1F7} Türkiye", None, &[]), item("e", "Émile", None, &[])]);
        let hits = ix.query("tür", QueryOpts::default());
        assert_eq!(hits[pos(&hits, "tr")].name_positions, [2, 3, 4], "the flag is one cluster, two code points");
        // Normalisation: an unaccented query still matches, and positions
        // point at the accented letters.
        let hits = ix.query("emi", QueryOpts::default());
        assert_eq!(hits[pos(&hits, "e")].name_positions, [0, 1, 2]);
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

        // Exact over a hot fuzzy hit (frecency maximum), the case from
        // notes/decisions.md: a picked emoji against the bookmark `ha`.
        let hot = |s: &Source, id: &str| if s.palette == "emoji" && id == "\u{1FA89}" { 200.0 } else { 0.0 };
        let hits = ix.query("ha", QueryOpts { boost: Some(&hot), ..Default::default() });
        assert_eq!((hits[0].source.palette.as_str(), hits[0].id.as_str()), ("bookmarks", "ha"));
        assert_eq!(name(&ix, &hits[1]), "harp");
        let hot = |s: &Source, id: &str| if s.palette == "apps" && id.ends_with("Google Chrome.app") { 200.0 } else { 0.0 };
        let hits = ix.query("chrome", QueryOpts { boost: Some(&hot), ..Default::default() });
        assert_eq!(name(&ix, &hits[0]), "chrome", "an exact icon name outranks the hot app");
        assert_eq!(name(&ix, &hits[2]), "Google Chrome");

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
