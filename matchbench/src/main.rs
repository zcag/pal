//! Matching and ranking experiment for pal: should the corpus live in the
//! Rust core with nucleo doing the matching, the webview rendering the top N?
//! Prints markdown tables; `notes/matching.md` is written from this output.
//!
//! Usage: `cargo run --release -p matchbench [corpus.jsonl]`
mod corpus;
mod engines;

use std::sync::Arc;
use std::time::{Duration, Instant};

use nucleo::pattern::{CaseMatching, Normalization, Pattern};
use nucleo::{Config, Matcher};

use corpus::{Hit, Item, Positions};
use engines::{Engine, Parallel, Ranked, Substring, Weighted, TOP};

const QUERIES: &[&str] = &[
    "c", "ch", "chr", "chro", "chrom", "chrome", "ha", "grafana", "😀", "smile", "xqzv", "smiling face eyes",
];
const RANK_QUERIES: &[&str] = &["chrome", "ha", "slack", "term", "cast tv"];
const WARMUP: usize = 5;
const ITERS: usize = 40;

/// Median and p95 of `iters` timed runs after `warmup` untimed ones.
fn bench<R>(mut f: impl FnMut() -> R) -> (Duration, Duration, R) {
    for _ in 0..WARMUP {
        f();
    }
    let mut ts = Vec::with_capacity(ITERS);
    let mut last = None;
    for _ in 0..ITERS {
        let t = Instant::now();
        let r = f();
        ts.push(t.elapsed());
        last = Some(r);
    }
    ts.sort_unstable();
    (ts[ITERS / 2], ts[ITERS * 95 / 100], last.unwrap())
}

fn us(d: Duration) -> String {
    let u = d.as_secs_f64() * 1e6;
    if u >= 1000.0 {
        format!("{:.2} ms", u / 1000.0)
    } else {
        format!("{u:.0} us")
    }
}

fn hits<'a>(items: &'a [Item], ranked: &Ranked, pos: &[Positions]) -> Vec<Hit<'a>> {
    ranked
        .top
        .iter()
        .zip(pos)
        .map(|(&(i, score), p)| {
            let it = &items[i as usize];
            Hit {
                id: &it.id,
                name: &it.name,
                subtitle: it.subtitle.as_deref(),
                icon: it.icon.as_deref(),
                palette: &it.palette,
                score,
                name_pos: p.name.clone(),
                sub_pos: p.subtitle.clone(),
            }
        })
        .collect()
}

/// One engine over every query: rank (fresh pattern each time), highlight
/// the head, serialise it. Prints one markdown table.
fn run_engine(e: &mut dyn Engine, items: &[Item]) {
    println!("\n### {}\n", e.name());
    println!("| query | matches | top {TOP} + scores | highlight {TOP} | json {TOP} | bytes | total |");
    println!("|---|---:|---:|---:|---:|---:|---:|");
    for q in QUERIES {
        let (tm, tm95, ranked) = bench(|| e.query(q, false));
        let (th, _, pos) = bench(|| e.highlight(&ranked.top));
        let (tj, _, json) = bench(|| serde_json::to_string(&hits(items, &ranked, &pos)).unwrap());
        let total = tm + th + tj;
        println!(
            "| `{q}` | {} | {} (p95 {}) | {} | {} | {} | {} |",
            ranked.total,
            us(tm),
            us(tm95),
            us(th),
            us(tj),
            json.len(),
            us(total)
        );
    }
}

/// The parallel engine again, typing `chrome` one key at a time with
/// `append = true`, which lets nucleo rescore only the previous matches.
fn run_incremental(e: &mut Parallel) {
    println!("\n### {} incremental (append = true, typing `chrome`)\n", e.name());
    println!("| query | median | p95 |");
    println!("|---|---:|---:|");
    let steps = ["c", "ch", "chr", "chro", "chrom", "chrome"];
    let mut times: Vec<Vec<Duration>> = vec![Vec::new(); steps.len()];
    for _ in 0..WARMUP + ITERS {
        for (k, q) in steps.iter().enumerate() {
            let t = Instant::now();
            e.query(q, k > 0);
            times[k].push(t.elapsed());
        }
    }
    for (k, q) in steps.iter().enumerate() {
        let ts = &mut times[k][WARMUP..];
        ts.sort_unstable();
        println!("| `{q}` | {} | {} |", us(ts[ts.len() / 2]), us(ts[ts.len() * 95 / 100]));
    }
}

fn run_inject(items: &Arc<Vec<Item>>, threads: Option<usize>) {
    let n = items.len();
    // A corpus with 2k extra rows appended, to time the streaming case.
    let mut ext = (**items).clone();
    ext.extend(items.iter().take(2000).cloned().map(|mut i| {
        i.id.push_str("#dup");
        i
    }));
    let ext = Arc::new(ext);
    let label = threads.map_or("all".into(), |t| t.to_string());
    println!("\n### injector, nucleo par ({label} thr)\n");
    println!("| step | push (Utf32String per item) | worker settles |");
    println!("|---|---:|---:|");
    let mut best = [Duration::MAX; 4];
    for _ in 0..5 {
        let mut p = Parallel::new(ext.clone(), threads, false);
        let (push, settle) = p.inject(0..n);
        best[0] = best[0].min(push);
        best[1] = best[1].min(settle);
        p.query("chrome", false);
        let (push, settle) = p.inject(n..n + 2000);
        best[2] = best[2].min(push);
        best[3] = best[3].min(settle);
    }
    println!("| load {n} items, empty pattern | {} | {} |", us(best[0]), us(best[1]));
    println!("| append 2000 while `chrome` is active | {} | {} |", us(best[2]), us(best[3]));
    let t = Instant::now();
    let _p = Parallel::new(items.clone(), threads, false);
    println!("\nConstruction (rayon pool of {label} threads, no items): {}", us(t.elapsed()));
}

fn print_ranking(e: &mut dyn Engine, items: &[Item]) {
    println!("\n### {}\n", e.name());
    let mut matcher = Matcher::new(Config::DEFAULT);
    for q in RANK_QUERIES {
        let ranked = e.query(q, false);
        let pat = Pattern::parse(q, CaseMatching::Smart, Normalization::Smart);
        println!("`{q}` ({} matches):", ranked.total);
        for (rank, &(i, score)) in ranked.top.iter().take(10).enumerate() {
            let it = &items[i as usize];
            let name_raw = engines::name_score(&mut matcher, &pat, &it.name).map_or("-".into(), |s| s.to_string());
            let kw = it.keywords.as_ref().map(|k| k.join(",")).unwrap_or_default();
            let kw = if kw.chars().count() > 40 { format!("{}..", kw.chars().take(40).collect::<String>()) } else { kw };
            println!("  {:>2}. {score:>4} (name {name_raw:>3}) {:<34} {:<9} {kw}", rank + 1, it.name, it.palette);
        }
    }
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "app/fixtures/all.jsonl".into());
    let t = Instant::now();
    let items = Arc::new(corpus::load(&path));
    println!("Loaded {} items from {path} in {}", items.len(), us(t.elapsed()));
    println!("Host: {} threads available", std::thread::available_parallelism().map_or(0, |n| n.get()));

    println!("\n## Per keystroke (fresh pattern each query, median of {ITERS} after {WARMUP} warmup)");
    let mut par = Parallel::new(items.clone(), None, false);
    par.inject(0..items.len());
    run_engine(&mut par, &items);
    run_incremental(&mut par);

    for threads in [4, 1] {
        let mut p = Parallel::new(items.clone(), Some(threads), false);
        p.inject(0..items.len());
        run_engine(&mut p, &items);
    }

    let mut weighted = Weighted::new(items.clone());
    run_engine(&mut weighted, &items);

    let mut sub = Substring::new(items.clone());
    run_engine(&mut sub, &items);

    println!("\n## Injector");
    run_inject(&items, None);
    run_inject(&items, Some(4));

    println!("\n## Ranking, top 10");
    print_ranking(&mut par, &items);
    let mut parp = Parallel::new(items.clone(), Some(4), true);
    parp.inject(0..items.len());
    print_ranking(&mut parp, &items);
    print_ranking(&mut weighted, &items);
    print_ranking(&mut sub, &items);
}
