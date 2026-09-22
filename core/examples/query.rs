//! What the root would answer for a query, against a real index cache:
//! every cached palette as a source with its manifest tier, a
//! `pal/palettes` row per palette, the `root_first` ladder and the
//! profile's frecency, so a ranking question can be asked without the app.
//!
//! `cargo run -p pal-core --example query -- "mail inbox" "tod address"`
//! `PAL_PROFILE=~/Library/Application\ Support/pal/other cargo run ...`
//! `-n 20` prints that many hits a query (default 12), `--no-path` asks
//! without the sources' paths, to see what a path match is worth.
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::SystemTime;

use pal_core::frecency::Frecency;
use pal_core::index::{Caps, Index, Item, QueryOpts, Source, Tier};
use serde_json::Value;

/// `general.root_first` as the app defaults it, and its step.
const FIRST: [&str; 4] = ["browser-tabs/tabs", "windows/windows", "apps/apps", "pal/palettes"];
const STEP: f32 = 30.0;

fn profile() -> PathBuf {
    if let Ok(p) = std::env::var("PAL_PROFILE") {
        return PathBuf::from(p);
    }
    let data = if cfg!(target_os = "macos") { dirs::home_dir().map(|h| h.join("Library/Application Support")) } else { dirs::data_dir() };
    data.expect("no data dir").join("pal/default")
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut n = 12;
    if let Some(i) = args.iter().position(|a| a == "-n") {
        n = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(n);
        args.drain(i..=i + 1);
    }
    let paths = !args.iter().any(|a| a == "--no-path");
    args.retain(|a| a != "--no-path");
    if args.is_empty() {
        eprintln!("usage: query [-n 12] <query>...");
        std::process::exit(2);
    }
    let profile = profile();
    let mut ix = Index::new();
    let mut tiers: HashMap<Source, Tier> = HashMap::new();
    let mut rows = Vec::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(profile.join("index"))
        .unwrap_or_else(|e| panic!("{}: {e}", profile.join("index").display()))
        .flatten()
        .flat_map(|e| std::fs::read_dir(e.path()).ok())
        .flatten()
        .flatten()
        .map(|e| e.path())
        .collect();
    files.sort();
    for f in files {
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        let ext = f.parent().unwrap().file_name().unwrap().to_string_lossy().to_string();
        let pal = f.file_stem().unwrap().to_string_lossy().to_string();
        let (src, meta) = (Source::new(&ext, &pal), &v["meta"]);
        let title = meta["title"].as_str().unwrap_or(&pal).to_string();
        let ext_title = v["ext_title"].as_str().unwrap_or(&ext).to_string();
        tiers.insert(src.clone(), serde_json::from_value(meta["tier"].clone()).unwrap_or_default());
        // The palette's row as `registry::palette_row` builds it.
        let mut keywords = vec![pal.clone()];
        if ext != pal {
            keywords.push(ext.clone());
        }
        if let Some((_, suffix)) = ext.split_once('@') {
            keywords.push(suffix.to_string());
        }
        for k in meta["keywords"].as_array().into_iter().flatten().filter_map(|k| k.as_str()) {
            if !keywords.iter().any(|h| h == k) {
                keywords.push(k.into());
            }
        }
        rows.push(Item {
            id: format!("{ext}/{pal}"),
            name: title.clone(),
            subtitle: Some(ext_title.clone()).filter(|t| *t != title),
            keywords: keywords.clone(),
            icon: None,
            section: None,
            extra: Default::default(),
        });
        ix.replace(src.clone(), serde_json::from_value(v["items"].clone()).unwrap_or_default());
        // The source's path as `registry::palette_path` builds it: the two titles, then the keywords.
        let mut path = vec![ext_title];
        if title != path[0] {
            path.push(title);
        }
        for k in keywords {
            if !path.iter().any(|w| w.eq_ignore_ascii_case(&k)) {
                path.push(k);
            }
        }
        if paths {
            ix.set_path(src.clone(), path.join(" "));
        }
        if meta["live"].as_bool() == Some(true) {
            ix.set_live(src, true);
        }
    }
    let palettes = Source::new("pal", "palettes");
    ix.replace(palettes.clone(), rows);
    tiers.insert(palettes, Tier::Primary);
    let fre = Frecency::open_in(&profile);
    eprintln!("{} items in {} sources, {} frecency entries ({})", ix.len(), ix.sources().len(), fre.len(), profile.display());

    let tier = |s: &Source| tiers.get(s).copied().unwrap_or_default();
    for q in &args {
        let fre_boost = fre.boost(q, SystemTime::now());
        let boost = |s: &Source, id: &str| FIRST.iter().position(|f| *f == format!("{}/{}", s.extension, s.palette)).map_or(0.0, |i| STEP * (FIRST.len() - i) as f32) + fre_boost(s, id);
        let t0 = std::time::Instant::now();
        let r = ix.query(q, QueryOpts { boost: Some(&boost), tier: Some(&tier), caps: Some(Caps::default()), ..Default::default() });
        let took = t0.elapsed();
        println!("\n{q:?}  {} hits, {:.2} ms", r.len(), took.as_secs_f64() * 1000.0);
        for h in r.iter().take(n) {
            let item = ix.get(&h.source, &h.id).unwrap();
            let sub = item.subtitle.as_deref().map_or(String::new(), |s| format!("  ({})", trunc(s, 30)));
            println!("  {:>7.0}  {:<24} {}{sub}", h.score, format!("{}/{}", h.source.extension, h.source.palette), trunc(&item.name, 60));
        }
        for m in &r.more {
            println!("      .  {} more in {}/{}", m.count, m.source.extension, m.source.palette);
        }
    }
}

fn trunc(s: &str, n: usize) -> String {
    let s = s.replace('\n', " ");
    if s.chars().count() <= n {
        s
    } else {
        format!("{}...", s.chars().take(n - 1).collect::<String>())
    }
}
