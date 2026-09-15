//! Three ways to match the corpus. All return the top N `(item index, score)`
//! sorted best first, then compute highlight positions for those.
use std::sync::Arc;

use nucleo::pattern::{CaseMatching, Normalization, Pattern};
use nucleo::{Config, Matcher, Nucleo, Utf32Str, Utf32String};

use crate::corpus::{Item, Positions};

pub const TOP: usize = 200;

/// The top N `(item index, score)` plus the total number of matches.
pub struct Ranked {
    pub top: Vec<(u32, u32)>,
    pub total: usize,
}

pub trait Engine {
    fn name(&self) -> String;
    /// Rank for `q`. `append` promises `q` extends the previous query by
    /// keystrokes; only the parallel engine uses it (incremental rescoring).
    fn query(&mut self, q: &str, append: bool) -> Ranked;
    /// Highlight positions for an already ranked slice, under the last query.
    fn highlight(&mut self, ranked: &[(u32, u32)]) -> Vec<Positions>;
}

/// Keep the best `TOP` of a match list: partial select, then sort that head.
/// Order: score desc, then shorter name, then corpus order.
fn top_n(mut hits: Vec<(u32, u32)>, items: &[Item]) -> Ranked {
    let key = |&(idx, score): &(u32, u32)| (std::cmp::Reverse(score), items[idx as usize].name.len(), idx);
    let total = hits.len();
    if total > TOP {
        hits.select_nth_unstable_by_key(TOP, key);
        hits.truncate(TOP);
    }
    hits.sort_unstable_by_key(key);
    Ranked { top: hits, total }
}

fn utf32(s: &str) -> Utf32String {
    Utf32String::from(s)
}

// --- nucleo, parallel worker over one joined column ------------------------

/// The Helix pattern: `Injector::push` every item, `pattern.reparse` per
/// keystroke, `tick` until the worker settles, read the snapshot.
pub struct Parallel {
    nuc: Nucleo<u32>,
    matcher: Matcher,
    items: Arc<Vec<Item>>,
    threads: Option<usize>,
    prefer_prefix: bool,
}

impl Parallel {
    pub fn new(items: Arc<Vec<Item>>, threads: Option<usize>, prefer_prefix: bool) -> Self {
        let mut config = Config::DEFAULT;
        config.prefer_prefix = prefer_prefix;
        let nuc = Nucleo::new(config.clone(), Arc::new(|| {}), threads, 1);
        Self { nuc, matcher: Matcher::new(config), items, threads, prefer_prefix }
    }

    /// Push `range` of the corpus through the injector; returns the push time
    /// and the time until the worker has scored them under the current
    /// pattern (that is the streaming case pal has while a feed is arriving).
    pub fn inject(&mut self, range: std::ops::Range<usize>) -> (std::time::Duration, std::time::Duration) {
        let inj = self.nuc.injector();
        let t = std::time::Instant::now();
        for idx in range {
            inj.push(idx as u32, |&i, cols| cols[0] = utf32(&self.items[i as usize].haystack()));
        }
        let push = t.elapsed();
        let t = std::time::Instant::now();
        self.settle();
        (push, t.elapsed())
    }

    fn settle(&mut self) {
        while self.nuc.tick(10).running {}
    }
}

impl Engine for Parallel {
    fn name(&self) -> String {
        let t = self.threads.map_or("all".to_string(), |n| n.to_string());
        format!("nucleo par ({t} thr{})", if self.prefer_prefix { ", prefer_prefix" } else { "" })
    }

    fn query(&mut self, q: &str, append: bool) -> Ranked {
        self.nuc.pattern.reparse(0, q, CaseMatching::Smart, Normalization::Smart, append);
        self.settle();
        let snap = self.nuc.snapshot();
        let total = snap.matched_item_count() as usize;
        let pat = snap.pattern().column_pattern(0);
        // The snapshot hands back items in rank order but not their scores;
        // re-score the head (200 short strings, microseconds).
        let top = snap
            .matched_items(0..total.min(TOP) as u32)
            .map(|it| (*it.data, pat.score(it.matcher_columns[0].slice(..), &mut self.matcher).unwrap_or(0)))
            .collect();
        Ranked { top, total }
    }

    fn highlight(&mut self, ranked: &[(u32, u32)]) -> Vec<Positions> {
        let snap = self.nuc.snapshot();
        let pat = snap.pattern().column_pattern(0);
        let mut idx = Vec::new();
        ranked
            .iter()
            .map(|&(i, _)| {
                idx.clear();
                let hay = &snap.get_item(i).expect("ranked item is in the snapshot").matcher_columns[0];
                pat.indices(hay.slice(..), &mut self.matcher, &mut idx);
                idx.sort_unstable();
                idx.dedup();
                Positions::from_haystack(&self.items[i as usize], &idx)
            })
            .collect()
    }
}

// --- nucleo-matcher, single thread, weighted fields ------------------------

/// Score name, each keyword and the subtitle separately. Every query word
/// (nucleo atom) must land in some field; each word takes its best weighted
/// field and the item's score is the sum. So `chrome browser` matches an item
/// whose name has `chrome` and whose keywords have `browser`, which one
/// pattern over one field would reject.
pub struct Fields {
    name: Utf32String,
    keywords: Vec<Utf32String>,
    subtitle: Option<Utf32String>,
}

pub struct Weighted {
    matcher: Matcher,
    pat: Pattern,
    items: Arc<Vec<Item>>,
    fields: Vec<Fields>,
}

/// Weights in percent of the nucleo field score.
const W_NAME: u32 = 100;
const W_KEYWORD: u32 = 80;
const W_SUBTITLE: u32 = 50;

impl Weighted {
    pub fn new(items: Arc<Vec<Item>>) -> Self {
        let fields = items
            .iter()
            .map(|i| Fields {
                name: utf32(&i.name),
                keywords: i.keywords.iter().flatten().map(|k| utf32(k)).collect(),
                subtitle: i.subtitle.as_deref().map(utf32),
            })
            .collect();
        Self { matcher: Matcher::new(Config::DEFAULT), pat: Pattern::default(), items, fields }
    }

    fn score(&mut self, f: &Fields) -> Option<u32> {
        let mut total = 0;
        for atom in &self.pat.atoms {
            let mut best = None;
            let mut consider = |s: Option<u16>, w: u32| {
                if let Some(s) = s {
                    let s = s as u32 * w / 100;
                    if best.is_none_or(|b| s > b) {
                        best = Some(s);
                    }
                }
            };
            consider(atom.score(f.name.slice(..), &mut self.matcher), W_NAME);
            for kw in &f.keywords {
                consider(atom.score(kw.slice(..), &mut self.matcher), W_KEYWORD);
            }
            if let Some(sub) = &f.subtitle {
                consider(atom.score(sub.slice(..), &mut self.matcher), W_SUBTITLE);
            }
            total += best?;
        }
        Some(total)
    }
}

impl Engine for Weighted {
    fn name(&self) -> String {
        "nucleo-matcher single, weighted fields".into()
    }

    fn query(&mut self, q: &str, _append: bool) -> Ranked {
        self.pat.reparse(q, CaseMatching::Smart, Normalization::Smart);
        let fields = std::mem::take(&mut self.fields);
        let hits = fields
            .iter()
            .enumerate()
            .filter_map(|(i, f)| self.score(f).map(|s| (i as u32, s)))
            .collect();
        self.fields = fields;
        top_n(hits, &self.items)
    }

    fn highlight(&mut self, ranked: &[(u32, u32)]) -> Vec<Positions> {
        let mut idx: Vec<u32> = Vec::new();
        let fields = std::mem::take(&mut self.fields);
        let out = ranked
            .iter()
            .map(|&(i, _)| {
                let f = &fields[i as usize];
                let mut pos = Positions::default();
                idx.clear();
                // Each word highlights the name if it matches there, else the
                // subtitle; a keyword hit has nothing visible to highlight.
                for atom in &self.pat.atoms {
                    if atom.indices(f.name.slice(..), &mut self.matcher, &mut idx).is_some() {
                        pos.name.append(&mut idx);
                    } else if let Some(sub) = &f.subtitle {
                        if atom.indices(sub.slice(..), &mut self.matcher, &mut idx).is_some() {
                            pos.subtitle.append(&mut idx);
                        }
                    }
                    idx.clear();
                }
                pos.name.sort_unstable();
                pos.name.dedup();
                pos.subtitle.sort_unstable();
                pos.subtitle.dedup();
                pos
            })
            .collect();
        self.fields = fields;
        out
    }
}

// --- plain substring baseline ----------------------------------------------

/// Case-insensitive substring per query word over lowercased fields; every
/// word must land somewhere. Scores by where it landed (name prefix > name
/// word start > name infix > keyword > subtitle). No index: a scan over
/// 14.7k short strings is already memchr-bound, a trigram index would only
/// pay off at a corpus 10x this.
pub struct Substring {
    items: Arc<Vec<Item>>,
    lower: Vec<(String, String, String)>,
    words: Vec<String>,
}

impl Substring {
    pub fn new(items: Arc<Vec<Item>>) -> Self {
        let lower = items
            .iter()
            .map(|i| {
                (
                    i.name.to_lowercase(),
                    i.keywords.iter().flatten().map(|k| k.to_lowercase()).collect::<Vec<_>>().join(" "),
                    i.subtitle.as_deref().unwrap_or("").to_lowercase(),
                )
            })
            .collect();
        Self { items, lower, words: Vec::new() }
    }

    fn word_score(w: &str, (name, kw, sub): &(String, String, String)) -> Option<u32> {
        if let Some(p) = name.find(w) {
            return Some(if p == 0 {
                40
            } else if name.as_bytes()[p - 1] == b' ' || name.as_bytes()[p - 1] == b'_' {
                30
            } else {
                20
            });
        }
        if kw.contains(w) {
            return Some(15);
        }
        if sub.contains(w) {
            return Some(10);
        }
        None
    }
}

impl Engine for Substring {
    fn name(&self) -> String {
        "substring baseline".into()
    }

    fn query(&mut self, q: &str, _append: bool) -> Ranked {
        self.words = q.split_whitespace().map(str::to_lowercase).collect();
        let hits = self
            .lower
            .iter()
            .enumerate()
            .filter_map(|(i, l)| {
                let mut total = 0;
                for w in &self.words {
                    total += Self::word_score(w, l)?;
                }
                Some((i as u32, total))
            })
            .collect();
        top_n(hits, &self.items)
    }

    fn highlight(&mut self, ranked: &[(u32, u32)]) -> Vec<Positions> {
        ranked
            .iter()
            .map(|&(i, _)| {
                let name = &self.lower[i as usize].0;
                let mut pos = Positions::default();
                for w in &self.words {
                    if let Some(b) = name.find(w.as_str()) {
                        let start = name[..b].chars().count() as u32;
                        pos.name.extend(start..start + w.chars().count() as u32);
                    }
                }
                pos.name.sort_unstable();
                pos.name.dedup();
                pos
            })
            .collect()
    }
}

/// Utf32Str is what `Matcher::fuzzy_indices` takes; kept as a helper so the
/// ranking printout can show the raw name score next to the field score.
pub fn name_score(matcher: &mut Matcher, pat: &Pattern, name: &str) -> Option<u32> {
    let mut buf = Vec::new();
    pat.score(Utf32Str::new(name, &mut buf), matcher)
}
