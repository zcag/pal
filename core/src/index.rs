//! The item index: every listed item of every palette in one place, matched
//! and ranked here so a keystroke costs one scan in Rust and only the top N
//! cross to the webview. Tiering is the `weighted` engine from `matchbench`
//! (notes/matching.md): name, keywords and subtitle are separate
//! nucleo-matcher fields, one thread, synchronous, plus the source's own
//! path ([`PathField`], `tod address` for a todo in Todos) as a last
//! field that can never answer alone. On top of the match:
//! a source's [`Tier`] (primary up, catalog down), a bonus for a row
//! that has the typed word, the exact-name bonus, and per source a cut of
//! the rows that only scatter the query once one has the word, then a cap,
//! so no source crowds the top N; the ladder is under [`EXACT_BONUS`].

use std::cmp::Ordering;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32String};
use schemars::JsonSchema;
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
    /// Opaque here: a path, a glyph, a URL, a tile, whatever the extension sent; the UI resolves it.
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

/// A source's tier at the root: what its rows are to the user when typed
/// for next to everything else's. `primary` is what is reached by name
/// (apps, windows, bookmarks); `normal` is what is browsed (containers,
/// pull requests); `catalog` is a big static list where any query matches
/// dozens of rows (emoji, icons, unicode). A palette declares it in its
/// manifest, the config file can override it. See [`Tier::bonus`] for what
/// it does to the score and [`Caps`] for the root's per-source cap.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Primary,
    #[default]
    Normal,
    Catalog,
}

impl Tier {
    /// Added to every matched row of a source of this tier on a typed
    /// query (the empty query is ordered by use, not by tier): the tier
    /// bonus. Sized with the other adjustments, all in nucleo's units of
    /// about 16 per matched char (the ladder is under [`EXACT_BONUS`]);
    /// measured on the fixture corpus and the real index
    /// (`fixture_heads_and_timing`, `corpus_heads`; notes/decisions.md
    /// "Root ordering" has the tables).
    pub const fn bonus(self) -> f32 {
        match self {
            Tier::Primary => PRIMARY_BONUS,
            Tier::Normal => 0.0,
            Tier::Catalog => -CATALOG_PENALTY,
        }
    }

    /// What a row of this tier named what was typed gets: [`EXACT_BONUS`],
    /// except in a catalog, where an exact name is one glyph among
    /// thousands of short names (`git`, `c`, `chrome` are all icon names)
    /// and [`CATALOG_EXACT_BONUS`] puts it under the primary hits that
    /// contain the query and above the normal ones.
    pub const fn exact_bonus(self) -> f32 {
        match self {
            Tier::Catalog => CATALOG_EXACT_BONUS,
            _ => EXACT_BONUS,
        }
    }
}

/// [`Tier::bonus`] for a primary source.
pub const PRIMARY_BONUS: f32 = 150.0;
/// Taken off every catalog row, see [`Tier::bonus`].
pub const CATALOG_PENALTY: f32 = 150.0;
/// Added to a row where every word of the query starts a word of the
/// name or of a keyword (case-insensitive): the typed letters are a word
/// the user knows, not collected across a bundle id or the middle of a
/// long title. Equal to the tier spread (primary to catalog), so a catalog
/// row that has the word and a primary row that only scatters it are level
/// and the match score decides (`smile`: the emoji above `System
/// Information`, which spells it out of `com.apple.SystemProfiler`), while
/// a primary row that has the word is above a catalog one that does by the
/// whole spread plus what use can add.
pub const WORD_BONUS: f32 = 300.0;
/// [`Tier::exact_bonus`] for a catalog row: with its tier and word
/// bonuses the row nets 400, between a primary word hit (450) and a
/// normal one (300), so `chrome` puts Google Chrome first and the glyph
/// after the primary rows that have the word, `git` keeps the glyph under
/// the GitHub palettes and GitHub Desktop and above every normal row.
pub const CATALOG_EXACT_BONUS: f32 = 250.0;

/// How many rows one source may put in a typed query's answer, by tier.
/// The rest of its matches are counted in [`Ranked::more`], for a row that
/// drills into the palette (where nothing is capped). `[general]
/// root_caps` in the config file. Before the cap, a source with a row that
/// has the typed word loses its rows that only scatter the letters (the
/// same `more` row keeps them reachable): `spo` is Spotify, not Spotify and
/// six apps that spell it out of their bundle ids; `sp` still lists every
/// app whose name starts with it, up to the cap, so fuzzy typing is intact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Caps {
    pub primary: usize,
    pub normal: usize,
    pub catalog: usize,
}

impl Default for Caps {
    fn default() -> Self {
        Self { primary: 8, normal: 6, catalog: 3 }
    }
}

impl Caps {
    pub const fn of(&self, tier: Tier) -> usize {
        match tier {
            Tier::Primary => self.primary,
            Tier::Normal => self.normal,
            Tier::Catalog => self.catalog,
        }
    }
}

/// A source's [`Tier`], see [`QueryOpts::tier`].
pub type TierOf<'a> = &'a dyn Fn(&Source) -> Tier;

pub struct QueryOpts<'a> {
    /// At most this many hits; the best ones when there are more.
    pub limit: usize,
    /// Only these sources; `None` is all of them.
    pub sources: Option<&'a [Source]>,
    /// Added to every candidate's match score (0 for the empty query) before
    /// the top-N select, so a weak match with a large boost still climbs.
    /// Frecency plugs in here.
    pub boost: Option<Boost<'a>>,
    /// Each source's tier: its [`Tier::bonus`] goes on every matched row
    /// (typed queries only) and picks its cap from `caps`. `None` is
    /// `Tier::Normal` for every source: no bonus, the normal cap.
    pub tier: Option<TierOf<'a>>,
    /// Per-source caps on a typed query, by tier; `None` caps nothing (a
    /// palette's own level lists everything). The empty query is never
    /// capped.
    pub caps: Option<Caps>,
    /// With `caps`: a source with a row that has the typed word keeps only
    /// those rows ([`Caps`]). `[general] root_cut`; off, the cap alone.
    pub cut: bool,
}

impl Default for QueryOpts<'_> {
    fn default() -> Self {
        Self { limit: 200, sources: None, boost: None, tier: None, caps: None, cut: true }
    }
}

/// One source's matches a cap left out of [`Ranked::hits`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct More {
    pub source: Source,
    /// Matched rows of the source not in the hits.
    pub count: usize,
}

/// A query's answer: the hits, grouped by source in the order of each
/// source's best hit (the section order at the root, best first inside a
/// section), and per capped source how many matches the cap dropped.
/// Derefs to the hits.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Ranked {
    pub hits: Vec<Hit>,
    /// Sources with hits here and more matches behind the cap, in the order
    /// of their sections.
    pub more: Vec<More>,
}

impl std::ops::Deref for Ranked {
    type Target = [Hit];
    fn deref(&self) -> &[Hit] {
        &self.hits
    }
}

impl IntoIterator for Ranked {
    type Item = Hit;
    type IntoIter = std::vec::IntoIter<Hit>;
    fn into_iter(self) -> Self::IntoIter {
        self.hits.into_iter()
    }
}

struct Entry {
    item: Item,
    name: Utf32String,
    keywords: Vec<Utf32String>,
    subtitle: Option<Utf32String>,
    /// The trimmed name and keywords, Unicode-lowercased, NUL between
    /// them: what [`is_exactly`](Self::is_exactly) and
    /// [`starts_words`](Self::starts_words) look in, built once per item
    /// so a scan over every match costs one `str` search per query word.
    /// No normalisation: an accent is part of the name (`emile` is not
    /// `Émile` here, though nucleo matches it).
    lower: String,
}

impl Entry {
    /// The item is called `q` (already lowercased and trimmed): its name
    /// equals it, or one of its keywords does and `q` is two chars or
    /// more. A one-letter keyword is a tag (a repo's language `c`, a
    /// symbol's letter), not an alias, and every repo written in C would
    /// otherwise be "named" `c`.
    fn is_exactly(&self, q: &str) -> bool {
        let mut segs = self.lower.split('\0');
        segs.next() == Some(q) || (q.chars().nth(1).is_some() && segs.any(|s| s == q))
    }

    /// Every word of the query starts a word of the name or of a keyword,
    /// or (`path`, per word, from the source) of the source's path.
    /// `chr` starts `Google Chrome` and `chrome_close`, not `Clipboard
    /// History` (scattered) nor `Digital Color Meter` (inside a word).
    fn starts_words(&self, words: &[String], path: &[bool]) -> bool {
        words.iter().enumerate().all(|(i, w)| path.get(i) == Some(&true) || starts_word(&self.lower, w))
    }
}

/// `w` (lowercased) starts a word of `hay` (lowercased): it is at the
/// start, or after a char that is neither a letter nor a digit.
fn starts_word(hay: &str, w: &str) -> bool {
    hay.match_indices(w).any(|(i, _)| hay[..i].chars().next_back().is_none_or(|c| !c.is_alphanumeric()))
}

impl From<Item> for Entry {
    fn from(item: Item) -> Self {
        let lower = std::iter::once(item.name.as_str()).chain(item.keywords.iter().map(String::as_str)).map(|s| s.trim().to_lowercase()).collect::<Vec<_>>().join("\0");
        Self {
            name: Utf32String::from(item.name.as_str()),
            keywords: item.keywords.iter().map(|k| Utf32String::from(k.as_str())).collect(),
            subtitle: item.subtitle.as_deref().map(Utf32String::from),
            lower,
            item,
        }
    }
}

/// A source's path: the words the palette itself is reached by (its
/// extension's title, its own, its keywords and alias), matched as a
/// weak field of every row of the source so a query can name the palette
/// and the row at once (`tod address` for a todo, `gh conflicts` for a
/// pull request). See [`W_PATH`] for the rules that keep it from
/// answering on its own.
struct PathField {
    text: Utf32String,
    /// Lowercased, for the word-start test [`W_PATH`] requires.
    lower: String,
}

struct Bucket {
    source: Source,
    entries: Vec<Entry>,
    /// The words that name this source, see [`PathField`]; `None` until
    /// [`Index::set_path`] says (every query then ignores the path).
    path: Option<PathField>,
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

    /// The words that name a source ([`PathField`]): its extension's
    /// title, its palette's, their keywords and the alias, in any order.
    /// Empty clears it. Creates the source empty if new.
    pub fn set_path(&mut self, source: Source, path: impl AsRef<str>) {
        let path = path.as_ref().trim();
        self.bucket(source).path = (!path.is_empty()).then(|| PathField { text: Utf32String::from(path), lower: path.to_lowercase() });
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
                self.buckets.push(Bucket { source, entries: Vec::new(), path: None, ids: HashMap::new(), live: false, stale: false, listed_at: None });
                self.buckets.len() - 1
            }
        };
        &mut self.buckets[i]
    }

    /// Tier `q` over the index: the best `opts.limit` hits, grouped by
    /// source in the order of each source's best hit (best first inside a
    /// source). The empty query lists everything in insertion order (plus
    /// boost), uncapped. Words match fuzzily and independently; `!`, `^`,
    /// `'` and `$` are ordinary text, not fzf operators (Spotlight and
    /// Raycast have none, and a bookmark called `!important` must be
    /// findable). An item named what was typed (or with a keyword saying
    /// so) gets [`EXACT_BONUS`] and leads. With `opts.tier` every matched
    /// row carries its source's tier bonus ([`Tier::bonus`]); with
    /// `opts.caps` a source that has a row with the word keeps only those
    /// ([`Caps`]), then keeps at most its cap's worth of hits, the best
    /// ones, chosen before the top-N select so a catalog cannot crowd the
    /// rest out, and the count it lost is in [`Ranked::more`].
    pub fn query(&mut self, q: &str, opts: QueryOpts) -> Ranked {
        self.pat = Pattern::new(q, CaseMatching::Smart, Normalization::Smart, AtomKind::Fuzzy);
        let matching = !self.pat.atoms.is_empty();
        let typed = q.trim().to_lowercase();
        // The atoms' own words, lowercased: what the path is tested with,
        // in the atoms' order so a word's path hit is found by its index.
        let words: Vec<String> = self.pat.atoms.iter().map(|a| a.needle_text().to_string().to_lowercase()).collect();
        let mut cands = Vec::new();
        // Per scanned bucket: where its candidates sit in `cands`, and its tier.
        let mut spans: Vec<(usize, std::ops::Range<usize>, Tier)> = Vec::new();
        'scan: for (b, bucket) in self.buckets.iter().enumerate() {
            if opts.sources.is_some_and(|s| !s.contains(&bucket.source)) {
                continue;
            }
            let tier = opts.tier.map_or(Tier::Normal, |f| f(&bucket.source));
            let bonus = if matching { tier.bonus() } else { 0.0 };
            // The path is one haystack for the whole source, so it is
            // matched once here, not per row: per query word, what it
            // scores in the path, and `None` where it does not start a
            // word of it ([`W_PATH`]).
            let path: Vec<Option<u32>> = match &bucket.path {
                Some(p) if matching => self.pat.atoms.iter().zip(&words).map(|(atom, w)| starts_word(&p.lower, w).then(|| atom.score(p.text.slice(..), &mut self.matcher).map(|s| s as u32 * W_PATH / 100)).flatten()).collect(),
                _ => Vec::new(),
            };
            let path_word: Vec<bool> = path.iter().map(Option::is_some).collect();
            let start = cands.len();
            for (e, entry) in bucket.entries.iter().enumerate() {
                // Without matching or boost the scan order is the result order.
                if !matching && opts.boost.is_none() && cands.len() == opts.limit {
                    break 'scan;
                }
                let score = if matching {
                    match score(&self.pat, &mut self.matcher, entry, &path) {
                        Some(s) => s as f32,
                        None => continue,
                    }
                } else {
                    0.0
                };
                let boost = if bucket.live { None } else { opts.boost };
                let mut score = score + boost.map_or(0.0, |f| f(&bucket.source, &entry.item.id)) + bonus;
                let word = matching && entry.starts_words(&words, &path_word);
                if word {
                    score += WORD_BONUS;
                    if entry.is_exactly(&typed) {
                        score += tier.exact_bonus();
                    }
                }
                // Name length only breaks ties between matches; the empty
                // query keeps insertion order.
                let len = if matching { entry.name.len() as u32 } else { 0 };
                cands.push(Cand { score, len, word, b: b as u32, e: e as u32 });
            }
            spans.push((b, start..cands.len(), tier));
        }
        // The cut and the cap: a source with a row that has the word keeps
        // only those, then its best `cap` of them; the rest is dropped here
        // so the top-N below is chosen among what may show.
        let caps = if matching { opts.caps } else { None };
        if let Some(caps) = caps {
            let mut kept = Vec::with_capacity(cands.len());
            for (_, range, tier) in &spans {
                let (cap, slice) = (caps.of(*tier), &mut cands[range.clone()]);
                let at = if opts.cut && slice.iter().any(|c| c.word) {
                    slice.sort_unstable_by_key(|c| !c.word);
                    slice.iter().position(|c| !c.word).unwrap_or(slice.len())
                } else {
                    slice.len()
                };
                let slice = &mut slice[..at];
                if slice.len() > cap {
                    if cap > 0 {
                        slice.select_nth_unstable_by(cap, Cand::cmp);
                    }
                    kept.extend_from_slice(&slice[..cap]);
                } else {
                    kept.extend_from_slice(slice);
                }
            }
            cands = kept;
        }
        if cands.len() > opts.limit {
            cands.select_nth_unstable_by(opts.limit, Cand::cmp);
            cands.truncate(opts.limit);
        }
        cands.sort_unstable_by(Cand::cmp);
        // Sections: a source's hits together, sources in the order of their
        // best hit (what the UI groups by; done here so the order is one
        // rule). `first` is a bucket's place by that rule; the stable sort
        // keeps the ranking inside a source.
        let mut first = vec![usize::MAX; self.buckets.len()];
        for (i, c) in cands.iter().enumerate() {
            let b = c.b as usize;
            if first[b] == usize::MAX {
                first[b] = i;
            }
        }
        cands.sort_by_key(|c| first[c.b as usize]);
        let mut more = Vec::new();
        if caps.is_some() {
            let mut shown = vec![0; self.buckets.len()];
            cands.iter().for_each(|c| shown[c.b as usize] += 1);
            let mut cut: Vec<(usize, usize)> = spans.iter().filter(|(b, r, _)| shown[*b] > 0 && r.len() > shown[*b]).map(|(b, r, _)| (*b, r.len() - shown[*b])).collect();
            cut.sort_by_key(|(b, _)| first[*b]);
            more = cut.into_iter().map(|(b, count)| More { source: self.buckets[b].source.clone(), count }).collect();
        }

        let mut buf = Vec::new();
        let hits = cands
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
            .collect();
        Ranked { hits, more }
    }
}

/// Added to the score of an item named what was typed (name or keyword,
/// case-insensitive), so it ranks above every other hit whatever their
/// history: what you typed *is* this item (Raycast does the same with names
/// and aliases). The ladder of every adjustment, in nucleo's units of about
/// 16 per matched char, for one query and the same match score; a frecency
/// boost (`frecency::MAX_SCORE * BOOST_SCALE`, at most 200, "hot" below)
/// comes on top of any of them except on a live source:
///
/// | row | adjustment | hot |
/// | --- | ---: | ---: |
/// | exact primary | 1450 | 1650 |
/// | exact normal (name, or a keyword alias) | 1300 | 1500 |
/// | primary, has the word (a palette row too) | 450 | 650 |
/// | exact catalog | 400 | 600 |
/// | normal, has the word | 300 | 500 |
/// | primary, scattered; catalog, has the word | 150 | 350 |
/// | normal, scattered | 0 | 200 |
/// | catalog, scattered | -150 | 50 |
///
/// The app adds a small ladder on top of a few primary sources it wants
/// first among equals (`[general] root_first`: tabs, windows, pal's own
/// commands, apps, the palette rows, at most 125), which orders rows of one band and never
/// crosses one.
///
/// "Has the word": every query word starts a word of the name or a
/// keyword ([`WORD_BONUS`]). So: an exact name wins across tiers (1300
/// against a hot primary row's 650, the closest), except a catalog's,
/// which is one glyph among thousands of short names and sits under the
/// primary hits that have the word; a primary hit that has the word is
/// above every catalog hit however hot (450 against 350); a catalog row
/// the user picks a lot climbs above the normal rows that scatter the
/// query (350 against 300 even for the ones that have the word) but not
/// above a primary one; and a row that has the word is above one that
/// scatters it whatever their tiers unless the scattered one is primary
/// and the other a catalog, where they are level and the match score
/// decides. The match score itself spans about 26 per typed char (prefix)
/// down to 16 with gap penalties (scattered), so a band of 150 holds for
/// queries a launcher sees. The welcome source's 1e9 is only ever added
/// on the empty query, where nothing is exact. Among equals the name
/// length and then insertion order decide.
///
/// The word bonus is the prefix bonus notes/matching.md rejected,
/// re-measured with tiers: nucleo scores a word-start match the same as a
/// prefix or an exact one (`ha` is 62 for `ha`, `hat` and `Claude Code
/// URL Handler` alike, fixture corpus), and among those the length
/// tie-break already puts the prefix first; what a bonus has to separate,
/// now that a tier can add 150 to a row, is a hit on a word the user
/// typed from one that collects the letters across a bundle id or a long
/// title, which the flat score does not tell apart by enough.
pub const EXACT_BONUS: f32 = 1000.0;

/// A scored candidate; `(b, e)` is its insertion order.
#[derive(Clone, Copy)]
struct Cand {
    score: f32,
    len: u32,
    /// Has the typed word (`WORD_BONUS`): what the per-source cut keeps.
    word: bool,
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
/// The same for a word that landed in the source's path ([`PathField`]):
/// the palette is where the row is, not what it is, so it counts least.
/// Two rules keep the path from answering on its own, since it is the
/// same haystack for every row of a source: a word only lands there when
/// it **starts** a word of the path (`tod` reaches Todos, `mail` does not
/// reach Gmail: that is what the manifest's keywords are for), and at
/// least one word of the query must land in the row itself, so `tod`
/// alone still lists the palette rather than every todo in it while `tod
/// address` finds the todo.
const W_PATH: u32 = 40;

/// Every query word must land in some field; each takes its best weighted
/// field and the item's score is the sum. So `cast tv` matches an item named
/// `cast` with keyword `tv`, which one pattern over one field would reject.
/// `path` is what each word scored in the source's path (empty for a
/// source with none), the last resort for a word that landed nowhere else.
fn score(pat: &Pattern, matcher: &mut Matcher, f: &Entry, path: &[Option<u32>]) -> Option<u32> {
    let (mut total, mut own) = (0, false);
    for (i, atom) in pat.atoms.iter().enumerate() {
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
        own |= best.is_some();
        total += best.or_else(|| path.get(i).copied().flatten())?;
    }
    own.then_some(total)
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

    fn score_of(hits: &[Hit], id: &str) -> f32 {
        hits[pos(hits, id)].score
    }

    /// The sources in the order their sections appear, each one's hits contiguous.
    fn sections(hits: &[Hit]) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        for h in hits {
            let p = h.source.palette.as_str();
            if out.last() != Some(&p) {
                assert!(!out.contains(&p), "{p} is split: {:?}", hits.iter().map(|h| (&h.source.palette, &h.id)).collect::<Vec<_>>());
                out.push(p);
            }
        }
        out
    }

    #[test]
    fn exact_name_first_then_name_over_keyword() {
        let hits = index().query("chrome", QueryOpts::default());
        assert_eq!(ids(&hits)[..2], ["i1", "i2"]);
        // Sections: the icon named `chrome` leads, so its source's hits come
        // first, the app's after; the scores still say name over keyword.
        assert_eq!(sections(&hits), ["icons", "apps"]);
        assert!(score_of(&hits, "chrome.app") > score_of(&hits, "i3"));
        assert_eq!(score_of(&hits, "i2"), score_of(&hits, "chrome.app"), "a name prefix and a word-start match score alike");
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
        assert_eq!(ids(&hits), ["terminal.app", "ghostty.app", "i7"], "apps first (Terminal is the best hit), Ghostty with it, the icon after");
        assert!(score_of(&hits, "i7") > score_of(&hits, "ghostty.app"), "a name match over a keyword-only one");
    }

    #[test]
    fn sections_follow_the_best_hit() {
        let mut ix = index();
        // `ha`: the bookmark is exact, then the icons (hat, hand: shorter
        // names than the app's), then the app.
        let hits = ix.query("ha", QueryOpts::default());
        assert_eq!(sections(&hits), ["bookmarks", "icons", "apps"]);
        assert_eq!(ids(&hits), ["ha", "i6", "i5", "i2", "i3", "handler.app"], "the fuzzy `h.a` icons ride in their section");
        // A boost that lifts the app's row lifts its section.
        let handler = |_: &Source, i: &str| if i == "handler.app" { 10.0 } else { 0.0 };
        let hits = ix.query("ha", QueryOpts { boost: Some(&handler), ..Default::default() });
        assert_eq!(sections(&hits), ["bookmarks", "apps", "icons"]);
        // The empty query is insertion order, which is grouped already.
        assert_eq!(sections(&ix.query("", QueryOpts::default())), ["apps", "icons", "bookmarks"]);
        assert!(ix.query("", QueryOpts::default()).more.is_empty());
        // A live source listed again between two keystrokes (the show
        // relist) with the same rows changes nothing: the order is a
        // function of the rows, not of when they arrived.
        ix.set_live(src("apps"), true);
        let before = ix.query("ha", QueryOpts { boost: Some(&handler), ..Default::default() });
        let rows = ix.snapshot(&src("apps"));
        ix.replace(src("apps"), rows);
        assert_eq!(ix.query("ha", QueryOpts { boost: Some(&handler), ..Default::default() }), before);
    }

    /// The bundled tiers: apps primary, icons catalog, the rest normal.
    fn tier(s: &Source) -> Tier {
        match s.palette.as_str() {
            "apps" => Tier::Primary,
            "icons" => Tier::Catalog,
            _ => Tier::Normal,
        }
    }

    #[test]
    fn tier_bonus_orders_sections_but_exact_and_use_cross_tiers() {
        let mut ix = index();
        ix.extend(src("docker"), vec![item("d1", "hazel", None, &[])]);
        let opts = || QueryOpts { tier: Some(&tier), ..Default::default() };
        // A primary prefix hit above every catalog prefix hit: Google Chrome above the `chrome` glyph.
        let hits = ix.query("chr", opts());
        assert_eq!(sections(&hits), ["apps", "icons"]);
        assert_eq!(hits[0].id, "chrome.app");
        assert_eq!(score_of(&hits, "chrome.app") - score_of(&hits, "i1"), PRIMARY_BONUS + CATALOG_PENALTY, "same match, two tiers apart");
        // An exact catalog name is under the primary hit that contains the
        // query and above a normal one that does; an exact name elsewhere wins.
        ix.extend(src("docker"), vec![item("d2", "chromedriver", None, &[])]);
        let hits = ix.query("chrome", opts());
        assert_eq!(ids(&hits)[..3], ["chrome.app", "i1", "i2"]);
        assert_eq!(sections(&hits), ["apps", "icons", "docker"]);
        assert_eq!(score_of(&hits, "chrome.app") - score_of(&hits, "i1"), PRIMARY_BONUS + CATALOG_PENALTY - CATALOG_EXACT_BONUS);
        assert_eq!(score_of(&hits, "i1") - score_of(&hits, "d2"), CATALOG_EXACT_BONUS - CATALOG_PENALTY);
        ix.extend(src("docker"), vec![item("d3", "Chrome", None, &[])]);
        let hits = ix.query("chrome", opts());
        assert_eq!(hits[0].id, "d3", "an exact normal name over the primary hit");
        assert_eq!(sections(&hits), ["docker", "apps", "icons"]);
        assert!(score_of(&hits, "d3") > score_of(&hits, "chrome.app") + 500.0 + 200.0, "and over a hot palette row");
        ix.replace(src("docker"), vec![item("d1", "hazel", None, &[])]);
        // Tiers order the sections: primary, normal, catalog, at the same match.
        let hits = ix.query("ha", opts());
        assert_eq!(sections(&hits), ["bookmarks", "apps", "docker", "icons"], "the exact bookmark, then the tiers");
        assert_eq!(ids(&hits), ["ha", "handler.app", "d1", "i6", "i5", "i2", "i3"]);
        // The hottest catalog row (the frecency maximum, 200) climbs above
        // the normal-tier fuzzy hit but not above the primary one.
        let hot = |_: &Source, i: &str| if i == "i5" { 200.0 } else { 0.0 };
        let hits = ix.query("ha", QueryOpts { boost: Some(&hot), ..opts() });
        assert_eq!(ids(&hits), ["ha", "handler.app", "i5", "i6", "i2", "i3", "d1"]);
        assert!(score_of(&hits, "i5") < score_of(&hits, "handler.app") && score_of(&hits, "i5") > score_of(&hits, "d1"));
        // A live primary source keeps its tier (windows): no frecency, but the bonus.
        ix.set_live(src("apps"), true);
        let hits = ix.query("ha", QueryOpts { boost: Some(&hot), ..opts() });
        assert_eq!(ids(&hits)[..2], ["ha", "handler.app"]);
        // The empty query is untouched by tier: insertion order, no bonus.
        let all = ix.query("", opts());
        assert_eq!(ids(&all)[..4], ["chrome.app", "terminal.app", "ghostty.app", "handler.app"]);
        assert!(all.iter().all(|h| h.score == 0.0));
        // The ladder the constants rely on (the table under EXACT_BONUS); the
        // frecency maximum (200) and the app's palette bonus (150) as numbers.
        let ladder = [
            (PRIMARY_BONUS + CATALOG_PENALTY > 200.0, "a hot catalog row never passes a primary hit that has the word"),
            (CATALOG_PENALTY < 200.0, "a hot scattered catalog row passes a normal one"),
            (WORD_BONUS == PRIMARY_BONUS + CATALOG_PENALTY, "a catalog word hit and a primary scattered one are level"),
            (EXACT_BONUS > 150.0 + 200.0 + PRIMARY_BONUS + WORD_BONUS, "an exact name above a hot palette row"),
            (-CATALOG_PENALTY + WORD_BONUS + CATALOG_EXACT_BONUS < PRIMARY_BONUS + WORD_BONUS, "an exact catalog name under a primary word hit"),
            (-CATALOG_PENALTY + WORD_BONUS + CATALOG_EXACT_BONUS > WORD_BONUS, "and above a normal one"),
        ];
        for (holds, why) in ladder {
            assert!(std::hint::black_box(holds), "{why}");
        }
    }

    #[test]
    fn word_hits_over_scattered_ones() {
        let mut ix = index();
        ix.extend(src("apps"), vec![item("sysinfo.app", "System Information", None, &["com.apple.SystemProfiler"])]);
        ix.extend(src("icons"), vec![item("i9", "smiley", None, &[])]);
        // Flat: the glyph's prefix match outscores the scattered keyword one anyway.
        let hits = ix.query("smile", QueryOpts::default());
        assert_eq!(ids(&hits), ["i9", "sysinfo.app"]);
        assert!(score_of(&hits, "i9") > WORD_BONUS && score_of(&hits, "sysinfo.app") < WORD_BONUS);
        // With tiers the scattered primary hit would climb 300 over the catalog one; the substring bonus holds it level, and the match decides.
        let hits = ix.query("smile", QueryOpts { tier: Some(&tier), ..Default::default() });
        assert_eq!(ids(&hits), ["i9", "sysinfo.app"]);
        // Accents are not folded for the bonus (nucleo still matches).
        ix.extend(src("icons"), vec![item("e", "Émile", None, &[])]);
        let hits = ix.query("emile", QueryOpts::default());
        assert!(score_of(&hits, "e") < WORD_BONUS);
        assert!(score_of(&ix.query("émile", QueryOpts::default()), "e") > EXACT_BONUS);
        // A one-letter keyword is a tag, not an alias; a one-letter name is exact.
        ix.extend(src("docker"), vec![item("repo", "kimi-in-c", None, &["c"]), item("letter", "c", None, &[])]);
        let hits = ix.query("c", QueryOpts::default());
        assert!(score_of(&hits, "repo") < EXACT_BONUS && score_of(&hits, "letter") > EXACT_BONUS);
        assert!(score_of(&ix.query("nf", QueryOpts::default()), "i1") < EXACT_BONUS, "two-letter keyword `nf-dev` is not `nf` either");
        // Case-insensitive, trimmed, keywords count; a word start, not any substring.
        let hits = ix.query(" SYSTEMPROF ", QueryOpts::default());
        assert!(hits.is_empty(), "nucleo's smart case: an upper-case query is case-sensitive");
        assert!(score_of(&ix.query("com.apple", QueryOpts::default()), "sysinfo.app") > WORD_BONUS, "a keyword's start");
        assert!(score_of(&ix.query("apple", QueryOpts::default()), "sysinfo.app") > WORD_BONUS, "after a dot");
        assert!(score_of(&ix.query("profiler", QueryOpts::default()), "sysinfo.app") < WORD_BONUS, "inside SystemProfiler");
        assert!(score_of(&ix.query("info", QueryOpts::default()), "sysinfo.app") > WORD_BONUS, "the second word");
        assert!(score_of(&ix.query("tion", QueryOpts::default()), "sysinfo.app") < WORD_BONUS, "inside a word");
        // Every query word must start a word, in any order.
        assert!(score_of(&ix.query("info sys", QueryOpts::default()), "sysinfo.app") > WORD_BONUS);
        assert!(score_of(&ix.query("sys formation", QueryOpts::default()), "sysinfo.app") < WORD_BONUS);
    }

    #[test]
    fn caps_keep_each_source_to_its_tier() {
        let mut ix = index();
        let caps = Caps { primary: 8, normal: 6, catalog: 2 };
        let opts = |limit| QueryOpts { tier: Some(&tier), caps: Some(caps), limit, ..Default::default() };
        // `nf` lands in six icons' keywords: two shown, four more.
        let r = ix.query("nf", opts(200));
        assert_eq!(ids(&r), ["i6", "i5"], "the best two of the source (shortest names), not the first two scanned");
        assert_eq!(r.more, [More { source: src("icons"), count: 4 }]);
        // The cap is chosen before the limit: a limit of 1 still counts what the source lost.
        let r = ix.query("nf", opts(1));
        assert_eq!(ids(&r), ["i6"]);
        assert_eq!(r.more, [More { source: src("icons"), count: 5 }]);
        // Sources under their cap report nothing; `more` follows the section order.
        ix.extend(src("bookmarks"), vec![item("b2", "nf-guide", None, &[]), item("b3", "nf-notes", None, &[])]);
        let r = ix.query("nf", opts(200));
        assert_eq!(sections(&r), ["bookmarks", "icons"]);
        assert_eq!(r.more, [More { source: src("icons"), count: 4 }]);
        let r = ix.query("nf", QueryOpts { caps: Some(Caps { normal: 1, ..caps }), ..opts(200) });
        assert_eq!(ids(&r), ["b2", "i6", "i5"]);
        assert_eq!(r.more, [More { source: src("bookmarks"), count: 1 }, More { source: src("icons"), count: 4 }]);
        // A cap of zero hides the source; nothing to hang its count on.
        let r = ix.query("nf", QueryOpts { caps: Some(Caps { catalog: 0, ..caps }), ..opts(200) });
        assert_eq!(sections(&r), ["bookmarks"]);
        assert!(r.more.is_empty());
        // Without caps, or on the empty query, nothing is dropped.
        assert_eq!(ix.query("nf", QueryOpts { tier: Some(&tier), ..Default::default() }).len(), 8);
        let all = ix.query("", opts(200));
        assert_eq!(all.len(), ix.len());
        assert!(all.more.is_empty());
        assert_eq!(Caps::default(), Caps { primary: 8, normal: 6, catalog: 3 });
    }

    #[test]
    fn the_cut_keeps_the_rows_that_have_the_word_once_one_does() {
        let mut ix = index();
        // Spotify has the word; Spotlight too; the rest spell `spo` out of a bundle id or across a title.
        ix.extend(src("apps"), vec![
            item("spotify.app", "Spotify", None, &["com.spotify.client"]),
            item("spotlight.app", "Spotlight", None, &[]),
            item("sposter.app", "Screen Poster", None, &["com.sp.poster"]),
            item("scripts.app", "Script Editor", None, &["com.apple.ScriptEditor2", "osascript"]),
        ]);
        let opts = |cut| QueryOpts { tier: Some(&tier), caps: Some(Caps::default()), cut, ..Default::default() };
        let r = ix.query("spo", opts(true));
        assert_eq!(ids(&r), ["spotify.app", "spotlight.app"], "only the rows that have the word");
        assert_eq!(r.more, [More { source: src("apps"), count: 2 }], "the scattered ones are still counted for the drill row");
        let r = ix.query("spo", opts(false));
        assert_eq!(ids(&r)[..2], ["spotify.app", "spotlight.app"]);
        assert_eq!(r.len(), 4, "off, the cap alone decides");
        // No row has the word: fuzzy matching is untouched.
        let r = ix.query("scpt", opts(true));
        assert_eq!(ids(&r), ["scripts.app", "sposter.app"], "both scatter it (`com.sp.poster`), both stay");
        assert!(r.more.is_empty());
        // The cut is the root's (with caps); a palette's own level lists everything.
        assert_eq!(ix.query("spo", QueryOpts { tier: Some(&tier), sources: Some(&[src("apps")]), ..Default::default() }).len(), 4);
    }

    #[test]
    fn the_path_scopes_a_query_but_never_answers_it() {
        let mut ix = index();
        ix.extend(src("todos"), vec![item("t1", "Estonia visa: pick the trip week", None, &["personal"]), item("t2", "Pay the invoice", None, &[])]);
        ix.set_path(src("todos"), "odak Todos todo tasks");
        // The palette's name takes the word the row does not have; the row still has to answer for the rest.
        assert_eq!(ids(&ix.query("tod estonia", QueryOpts::default())), ["t1"]);
        assert_eq!(ids(&ix.query("todos invoice", QueryOpts::default())), ["t2"]);
        assert!(ix.query("tod", QueryOpts::default()).iter().all(|h| h.source != src("todos")), "the path alone lists nothing: `tod` is the palette's row, not every todo in it");
        assert!(ix.query("odak tasks", QueryOpts::default()).is_empty(), "two words, both only the path");
        // Only at a word start, and only the source's own path.
        assert!(ix.query("dos estonia", QueryOpts::default()).is_empty(), "`dos` is inside `Todos`, not a word of it");
        assert!(ix.query("tod chrome", QueryOpts::default()).is_empty(), "another source's rows are not in this path");
        // The word bonus counts a path word like any other: the scoped row leads what only scatters the letters.
        ix.extend(src("notes"), vec![item("n1", "Trip to Denmark", Some("estonia and other visas"), &[])]);
        let r = ix.query("tod estonia", QueryOpts::default());
        assert_eq!(ids(&r), ["t1", "n1"]);
        assert!(r[0].score >= r[1].score + WORD_BONUS, "{} against {}", r[0].score, r[1].score);
        // Cleared again, the source is matched by its rows alone.
        ix.set_path(src("todos"), "");
        assert!(ix.query("tod estonia", QueryOpts::default()).iter().all(|h| h.source != src("todos")));
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

    /// The ten root queries of notes/decisions.md ("Root ordering"), with
    /// their top five and the sections, printed for the table there.
    const ROOT_QUERIES: [&str; 10] = ["chr", "chrome", "ha", "term", "smile", "arrow", "git", "slack", "c", "a"];

    /// Prints each query's top five (`name [source score]`) and its
    /// sections with their counts and what the cap left out; returns the
    /// answers for assertions.
    fn print_heads(ix: &mut Index, label: &str, opts: &dyn Fn() -> QueryOpts<'static>) -> Vec<Ranked> {
        eprintln!("== {label}");
        let mut out = Vec::new();
        for q in ROOT_QUERIES {
            let r = ix.query(q, opts());
            let mut per: Vec<(String, usize)> = Vec::new();
            for h in r.iter() {
                let k = format!("{}/{}", h.source.extension, h.source.palette);
                match per.iter_mut().find(|(s, _)| *s == k) {
                    Some(p) => p.1 += 1,
                    None => per.push((k, 1)),
                }
            }
            let more = |k: &str| r.more.iter().find(|m| format!("{}/{}", m.source.extension, m.source.palette) == k).map_or(String::new(), |m| format!("+{}", m.count));
            let top: Vec<String> = r.iter().take(5).map(|h| format!("{} [{}/{} {:.0}]", ix.get(&h.source, &h.id).unwrap().name, h.source.extension, h.source.palette, h.score)).collect();
            eprintln!("{q:>7}: {} hits; {}\n         sections: {}", r.len(), top.join(" | "), per.iter().map(|(s, n)| format!("{s} {n}{}", more(s))).collect::<Vec<_>>().join(", "));
            out.push(r);
        }
        out
    }

    /// The fixture corpus (`app/fixtures/all.jsonl`, 14719 rows) as one
    /// source per palette, `None` without the file.
    fn fixture_index() -> Option<Index> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../app/fixtures/all.jsonl");
        let Ok(text) = std::fs::read_to_string(path) else {
            eprintln!("no fixture at {path}, skipping");
            return None;
        };
        let mut ix = Index::new();
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let mut row: serde_json::Map<String, Value> = serde_json::from_str(line).unwrap();
            let palette = row.remove("palette").and_then(|p| p.as_str().map(String::from)).unwrap();
            let it: Item = serde_json::from_value(Value::Object(row)).unwrap();
            ix.extend(Source::new("fixture", palette), vec![it]);
        }
        assert_eq!(ix.len(), 14719);
        Some(ix)
    }

    /// The fixture's tiers as the bundled manifests would set them.
    fn fixture_tier(s: &Source) -> Tier {
        match s.palette.as_str() {
            "apps" | "bookmarks" | "tabs" => Tier::Primary,
            "iconnerd" | "emoji" | "chars" | "colors" => Tier::Catalog,
            _ => Tier::Normal,
        }
    }

    /// Tiering heads from notes/matching.md over the fixture corpus, before
    /// and after tiers and caps, plus the per-keystroke cost.
    /// `cargo test -p pal-core --release -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn fixture_heads_and_timing() {
        let Some(mut ix) = fixture_index() else { return };
        let name = |ix: &Index, h: &Hit| ix.get(&h.source, &h.id).unwrap().name.clone();
        let at = |ix: &Index, r: &Ranked, palette: &str, name: &str| r.iter().position(|h| h.source.palette == palette && ix.get(&h.source, &h.id).unwrap().name == name);

        // Flat, as before tiers: name over keyword, exact first.
        let hits = ix.query("chrome", QueryOpts::default());
        assert_eq!(name(&ix, &hits[0]), "chrome");
        let gc = hits.iter().position(|h| h.source.palette == "apps" && name(&ix, h) == "Google Chrome").unwrap();
        let cast = hits.iter().position(|h| h.source.palette == "cmds" && h.id == "cast").unwrap();
        assert!(gc < cast, "Google Chrome {gc}, cast {cast}");
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
        let gc = hits.iter().find(|h| h.source.palette == "apps").unwrap();
        assert!(hits.iter().all(|h| h.score < EXACT_BONUS || h.score >= gc.score + 200.0), "the hot app is under the exact glyphs only");
        assert!(hits.iter().filter(|h| h.score < EXACT_BONUS).all(|h| h.score <= gc.score), "and above every other hit");

        // The root: tiers and caps. The heads notes/decisions.md lists.
        print_heads(&mut ix, "fixture, flat", &QueryOpts::default);
        let root = || QueryOpts { tier: Some(&fixture_tier), caps: Some(Caps::default()), ..Default::default() };
        let r = print_heads(&mut ix, "fixture, tiers + caps", &root);
        let [chr, chrome, ha, term, smile, arrow, git, slack, c, a] = &r[..] else { unreachable!() };
        assert_eq!(at(&ix, chr, "apps", "Google Chrome"), Some(0), "a primary prefix hit above every glyph named chrome*");
        assert_eq!(chr.iter().filter(|h| h.source.palette == "iconnerd").count(), 3, "the catalog cap");
        assert!(chr.more.iter().any(|m| m.source.palette == "iconnerd" && m.count > 50), "{:?}", chr.more);
        assert_eq!(at(&ix, chrome, "apps", "Google Chrome"), Some(0), "the app above the glyph named chrome");
        assert_eq!(name(&ix, &chrome[1]), "chrome", "the exact catalog name right after the primary rows that have the word");
        assert_eq!((ha[0].source.palette.as_str(), ha[0].id.as_str()), ("bookmarks", "ha"));
        assert_eq!(name(&ix, &term[0]), "Terminal");
        assert!(name(&ix, &smile[0]).contains("smil"), "{}", name(&ix, &smile[0]));
        assert!(smile.iter().take(10).any(|h| h.source.palette == "emoji"), "an emoji in the top ten for `smile`");
        assert!(arrow.iter().take(10).any(|h| h.source.palette == "emoji"));
        let glyph = git.iter().position(|h| h.source.palette == "iconnerd").unwrap();
        assert!(glyph < 10, "the glyph named git in the top ten: {glyph}");
        assert!(git.iter().skip(glyph).all(|h| fixture_tier(&h.source) != Tier::Primary || h.score < PRIMARY_BONUS + WORD_BONUS), "only primary rows that have the word are above it");
        assert_eq!(name(&ix, &slack[0]), "Slack");
        assert_eq!(c[0].source.palette, "apps", "one letter: the primary section leads, no glyph named `c` above it");
        assert_eq!(a[0].source.palette, "apps");
        assert!(c.iter().all(|h| h.score < EXACT_BONUS), "a one-letter keyword is not an alias");
        for r in &r {
            for s in ["iconnerd", "emoji"] {
                assert!(r.iter().filter(|h| h.source.palette == s).count() <= 3, "{s} over its cap");
            }
        }
        // Use crosses tiers: the hottest glyph lands above the normal-tier rows but under the primary ones.
        let hand_id = ix.snapshot(&Source::new("fixture", "iconnerd")).into_iter().find(|i| i.name == "hand").unwrap().id;
        let hot = |s: &Source, id: &str| if s.palette == "iconnerd" && id == hand_id { 200.0 } else { 0.0 };
        let hits = ix.query("ha", QueryOpts { boost: Some(&hot), ..root() });
        let hand = hits.iter().find(|h| h.source.palette == "iconnerd" && h.id == hand_id).expect("the hot glyph is in the answer").score;
        let best = |t: Tier| hits.iter().filter(|h| fixture_tier(&h.source) == t).map(|h| h.score).fold(f32::MIN, f32::max);
        assert!(hand < best(Tier::Primary) && hand > best(Tier::Normal), "hand {hand}, primary {}, normal {}", best(Tier::Primary), best(Tier::Normal));
        let order: Vec<&str> = hits.iter().map(|h| h.source.palette.as_str()).collect();
        let at = |p: &str| order.iter().position(|s| *s == p).unwrap();
        assert!(at("bookmarks") < at("apps") && at("apps") < at("iconnerd") && at("iconnerd") < at("cmds"), "{order:?}");

        let flat = QueryOpts::default;
        let timed: [(&str, &dyn Fn() -> QueryOpts<'static>); 2] = [("flat", &flat), ("root", &root)];
        for (label, opts) in timed {
            for q in ["c", "chrome", "ha", ""] {
                let mut t = Vec::new();
                for _ in 0..205 {
                    let s = std::time::Instant::now();
                    std::hint::black_box(ix.query(q, opts()));
                    t.push(s.elapsed());
                }
                t.drain(..5);
                t.sort();
                eprintln!("{label} {q:>8}: median {:?}  p95 {:?}", t[t.len() / 2], t[t.len() * 95 / 100]);
            }
        }
    }

    /// The same over a real index cache (`$PAL_CORPUS`, an
    /// `index/` directory under the profile's data dir): every cached
    /// palette as a source, a `pal/palettes` row per palette with the
    /// app's bonus and tier, tiers from the bundled manifests (`extensions/<ext>/
    /// pal.json`) and the scripts rule for the v1 catalogs. Prints only.
    /// `PAL_CORPUS=~/Library/Application\ Support/pal/default/index cargo
    /// test -p pal-core --release -- --ignored --nocapture corpus_heads`.
    #[test]
    #[ignore]
    fn corpus_heads() {
        let Ok(dir) = std::env::var("PAL_CORPUS") else {
            eprintln!("PAL_CORPUS unset, skipping");
            return;
        };
        let mut ix = Index::new();
        let mut rows = Vec::new();
        let mut tiers: HashMap<Source, Tier> = HashMap::new();
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().flat_map(|e| std::fs::read_dir(e.path()).ok()).flatten().flatten().map(|e| e.path()).collect();
        files.sort();
        // The restore cost: the files read and parsed, the items into the index.
        let (t0, mut bytes, mut parse, mut fill) = (std::time::Instant::now(), 0, std::time::Duration::ZERO, std::time::Duration::ZERO);
        for f in &files {
            let text = std::fs::read_to_string(f).unwrap();
            bytes += text.len();
            let t = std::time::Instant::now();
            let v: Value = serde_json::from_str(&text).unwrap();
            let items: Vec<Item> = serde_json::from_value(v["items"].clone()).unwrap();
            parse += t.elapsed();
            let t = std::time::Instant::now();
            ix.replace(Source::new("restore", f.file_stem().unwrap().to_string_lossy()), items);
            fill += t.elapsed();
        }
        eprintln!("restore: {} files {:.1} MB in {:?} (parse {parse:?}, fill {fill:?})", files.len(), bytes as f64 / 1e6, t0.elapsed());
        ix = Index::new();
        for f in files {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
            let ext = f.parent().unwrap().file_name().unwrap().to_string_lossy().to_string();
            let pal = f.file_stem().unwrap().to_string_lossy().to_string();
            let src = Source::new(&ext, &pal);
            let title = v["meta"]["title"].as_str().unwrap_or(&pal).to_string();
            let manifest = std::fs::read_to_string(format!("{}/../extensions/{ext}/pal.json", env!("CARGO_MANIFEST_DIR"))).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            let tier = match (ext.as_str(), pal.as_str()) {
                ("scripts", "iconnerd" | "iconkde" | "chars") => Tier::Catalog,
                _ => manifest.and_then(|m| serde_json::from_value(m["palettes"][&pal]["tier"].clone()).ok()).unwrap_or_default(),
            };
            tiers.insert(src.clone(), tier);
            let mut keywords = vec![pal.clone()];
            if ext != pal {
                keywords.push(ext.clone());
            }
            rows.push(Item { id: format!("{ext}/{pal}"), name: title, subtitle: v["ext_title"].as_str().map(String::from), keywords, icon: None, section: None, extra: Default::default() });
            ix.replace(src.clone(), serde_json::from_value(v["items"].clone()).unwrap());
            if v["meta"]["live"].as_bool() == Some(true) {
                ix.set_live(src, true);
            }
        }
        let palettes = Source::new("pal", "palettes");
        ix.replace(palettes.clone(), rows);
        tiers.insert(palettes.clone(), Tier::Primary);
        eprintln!("{} items in {} sources; primary {:?}; catalog {:?}", ix.len(), ix.sources().len(), tiers.iter().filter(|(_, r)| **r == Tier::Primary).map(|(s, _)| format!("{}/{}", s.extension, s.palette)).collect::<Vec<_>>(), tiers.iter().filter(|(_, r)| **r == Tier::Catalog).map(|(s, _)| format!("{}/{}", s.extension, s.palette)).collect::<Vec<_>>());
        let tiers: &'static HashMap<Source, Tier> = Box::leak(Box::new(tiers));
        let palettes: &'static Source = Box::leak(Box::new(palettes));
        let tier = move |s: &Source| tiers.get(s).copied().unwrap_or_default();
        let boost = move |s: &Source, _: &str| if s == palettes { 150.0 } else { 0.0 };
        let tier: TierOf<'static> = Box::leak(Box::new(tier));
        let boost: Boost<'static> = Box::leak(Box::new(boost));
        print_heads(&mut ix, "cache, flat + palette bonus", &move || QueryOpts { boost: Some(boost), ..Default::default() });
        let root = move || QueryOpts { boost: Some(boost), tier: Some(tier), caps: Some(Caps::default()), ..Default::default() };
        print_heads(&mut ix, "cache, tiers + caps + palette bonus", &root);
        // Per keystroke on the real index, and what the reply weighs on the
        // wire: every hit serialised beside its item, as the app's `HitView`.
        for q in ["c", "chr", "git", "ha", ""] {
            let mut t = Vec::new();
            for _ in 0..105 {
                let s = std::time::Instant::now();
                std::hint::black_box(ix.query(q, root()));
                t.push(s.elapsed());
            }
            t.drain(..5);
            t.sort();
            let r = ix.query(q, root());
            let mut per: Vec<(String, usize, usize)> = Vec::new();
            for h in r.iter() {
                let bytes = serde_json::to_vec(h).unwrap().len() + serde_json::to_vec(ix.get(&h.source, &h.id).unwrap()).unwrap().len();
                let k = format!("{}/{}", h.source.extension, h.source.palette);
                match per.iter_mut().find(|(s, _, _)| *s == k) {
                    Some(p) => { p.1 += 1; p.2 += bytes }
                    None => per.push((k, 1, bytes)),
                }
            }
            let wire: usize = per.iter().map(|p| p.2).sum();
            per.sort_by_key(|p| std::cmp::Reverse(p.2));
            let top: Vec<String> = per.iter().take(4).map(|(s, n, b)| format!("{s} {n} rows {:.1} KB", *b as f64 / 1024.0)).collect();
            eprintln!("{q:>7}: median {:?}  p95 {:?}  {} hits  {:.1} KB on the wire  ({})", t[t.len() / 2], t[t.len() * 95 / 100], r.len(), wire as f64 / 1024.0, top.join(", "));
        }
    }
}
