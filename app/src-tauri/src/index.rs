//! The host's items in the Rust index: every palette is listed into
//! `pal_core::index::Index` as the host reports it loaded (an input palette
//! is not: its rows come from the host per keystroke), keystrokes are
//! answered from there with frecency applied, and a pick goes to the host,
//! its effects run, then into the frecency store. The palettes themselves
//! are rows of one synthetic source, `pal/palettes`, so the root search
//! finds them.
//!
//! The config file has a say: a palette with `enabled = false` is kept in
//! the registry (so re-enabling needs no host round trip to know it) but
//! has no items in the index and no palette row; an `alias` is an extra
//! keyword on its row. `apply_config` re-applies both when the file changes.
//!
//! A live palette (`live`, not `input`) is listed again every time the panel
//! shows (`on_shown`), after the paint, so its rows are current at the root.
//! A palette with `filters` is listed once per filter the user picks
//! (`filter`), the bucket swapped for that filter's rows and each list kept
//! until the palette lists again. An item's lazy detail (`detail`) is one
//! host round trip, cached there.
//!
//! Two synthetic sources besides `pal/palettes`: `pal/welcome`
//! (`crate::welcome`) leads the empty query on a fresh profile and is left
//! out of every other one; its picks are the shell's and never remembered.
//!
//! Every default listing also goes to disk (`crate::cache`), and at startup,
//! before the host is spawned, `restore_cache` puts every cached palette
//! back: items, meta and palette row, flagged `stale`. When the host then
//! reports an extension loaded, each palette is listed again now (no `ttl`,
//! as before), left as it is (`ttl` declared and the cached listing younger
//! than it), or queued for one sequential low-priority pass after `host/ready`
//! (`ttl` declared and exceeded). `index_refresh` forces a listing at any
//! time. `stale` on the wire is "a listing is pending for this source" and
//! the footer says "updating" while it is.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pal_core::config::Config;
use pal_core::frecency::{Frecency, Key};
use pal_core::index::{Hit, Index, Item, QueryOpts, Source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::host::Host;
use crate::{cache, effects, hotkey, settings, welcome};

const DEFAULT_LIMIT: usize = 200;
/// A live palette slower than this on show keeps its old rows for this show.
const LIVE_RELIST_TIMEOUT: Duration = Duration::from_millis(2000);
/// After `host/ready`, before the pass over the palettes whose cached
/// listing is older than their `ttl`: the panel has painted and the
/// no-`ttl` listings are in flight by then.
const REFRESH_DELAY: Duration = Duration::from_millis(1000);

/// Whether that pass has run: until it has, an expired palette waits for
/// it; after, an expired palette (an extension reloaded) lists at once.
static REFRESHED: AtomicBool = AtomicBool::new(false);

fn unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// A palette as the host describes it (`PaletteMeta` in host/protocol.ts).
/// The optional fields ride to the UI untouched through `SourceView`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct PaletteMeta {
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub live: bool,
    #[serde(default)]
    pub input: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// Open with the detail pane showing.
    #[serde(default, rename = "showDetail", skip_serializing_if = "std::ops::Not::not")]
    pub show_detail: bool,
    /// `"lazy"`: the palette answers `detail(id)`; the UI asks per item.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// `[{ id, title }]`, first the default; opaque here, the UI's dropdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<Value>,
    /// Seconds a listing stays good for: a cached one younger than this is
    /// not listed again on load. Absent: listed again on every load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl: Option<f64>,
}

impl PaletteMeta {
    /// Whether a listing taken at `listed_at` is still within `ttl`.
    /// Without a `ttl` nothing is.
    fn fresh(&self, listed_at: Option<u64>, now: u64) -> bool {
        match (self.ttl, listed_at) {
            (Some(ttl), Some(at)) => (now.saturating_sub(at) as f64) <= ttl,
            _ => false,
        }
    }

    /// The filter a plain list runs with: the first declared one.
    fn default_filter(&self) -> Option<String> {
        self.filters.as_ref()?.get(0)?.get("id")?.as_str().map(str::to_string)
    }

    /// Listed again on every show.
    fn relists_on_show(&self) -> bool {
        self.live && !self.input
    }
}

/// Metas by source, in load order. The index holds the items and the
/// `live` flag; this is the rest of what the host said about a palette.
#[derive(Default)]
pub struct Palettes(Mutex<Vec<Registered>>);

#[derive(Clone)]
struct Registered {
    source: Source,
    meta: PaletteMeta,
    /// The extension's title (its manifest), the palette row's subtitle.
    ext_title: String,
    /// `palettes.<id>.enabled` as last applied; off means no items, no row.
    enabled: bool,
    /// The filter whose rows are in the bucket now (`None`: no filters).
    filter: Option<String>,
    /// Each filter's rows as last listed, dropped when the palette lists again.
    filtered: HashMap<String, Vec<Item>>,
    /// Its cached listing is past its `ttl`: waiting for `refresh_expired`.
    deferred: bool,
}

/// The palette's key in the config file, `palettes.<id>`: the extension's
/// name when the palette is named like it (`emoji`, `apps`), else
/// `<extension>-<palette>` (`clipboard-history`). Readable in the file and
/// needs no quoting; the registry resolves it back, so a clash between a
/// hyphenated extension name and a palette is the one case it cannot tell
/// apart.
pub fn palette_id(source: &Source) -> String {
    if source.extension == source.palette {
        source.extension.clone()
    } else {
        format!("{}-{}", source.extension, source.palette)
    }
}

/// Every palette the host reported, enabled or not, with its config id.
pub fn registered_palettes(app: &AppHandle) -> Vec<(String, Source)> {
    Palettes::with(app, |reg| reg.iter().map(|r| (palette_id(&r.source), r.source.clone())).collect())
}

impl Palettes {
    /// Whether picks from this source are not worth remembering.
    fn is_transient(&self, source: &Source) -> bool {
        let regs = self.0.lock().unwrap();
        regs.iter().any(|r| &r.source == source && (r.meta.live || r.meta.input))
    }
}

/// The source whose items are the palettes; its ids are `extension/palette`.
pub fn palettes_source() -> Source {
    Source::new("pal", "palettes")
}

/// The meta of a synthetic source (`pal/*`), which no extension reported.
fn synthetic_meta(source: &Source) -> Option<PaletteMeta> {
    let title = match source {
        s if *s == palettes_source() => "Palettes",
        s if *s == welcome::source() => "Welcome",
        _ => return None,
    };
    Some(PaletteMeta { name: source.palette.clone(), title: title.into(), ..Default::default() })
}

fn palette_row(r: &Registered, config: &Config) -> Item {
    let m = &r.meta;
    let mut keywords = vec![m.name.clone()];
    if r.source.extension != m.name {
        keywords.push(r.source.extension.clone());
    }
    let p = config.palette(&palette_id(&r.source));
    if let Some(alias) = p.alias.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        keywords.push(alias.to_string());
    }
    Item {
        id: format!("{}/{}", r.source.extension, r.source.palette),
        name: m.title.clone(),
        subtitle: Some(r.ext_title.clone()).filter(|t| t != &m.title),
        keywords,
        icon: p.icon.clone().or_else(|| m.icon.clone()).map(Value::String),
        section: None,
        extra: Default::default(),
    }
}

/// `data` is the config's profile dir (`ConfigFile::data_dir`): the
/// frecency file and the index cache live under it.
pub fn install(app: &AppHandle, data: &Path) {
    app.manage(Mutex::new(Index::new()));
    let frecency = Frecency::open_in(data);
    if let Some(n) = frecency.notice() {
        eprintln!("frecency\t{n}");
    }
    app.manage(Mutex::new(frecency));
    app.manage(Palettes::default());
    app.manage(cache::Saver::new(data.join(cache::DIR_NAME)));
    welcome::install(app, data);
}

/// The index cache directory of this run.
fn cache_dir(app: &AppHandle) -> PathBuf {
    app.state::<Arc<cache::Saver>>().dir().to_path_buf()
}

/// Put every cached palette back before the host is spawned: registry
/// entry (enabled per the config), items in the index flagged stale, the
/// palette rows, the palettes' hotkeys. Needs the settings installed. The
/// order is the empty query's order until frecency has a say: the welcome
/// rows (a fresh profile), the palette rows, then apps, then the rest by
/// name.
pub fn restore_cache(app: &AppHandle) {
    let t0 = Instant::now();
    let mut cached = cache::read_all(&cache_dir(app));
    let rank = |s: &Source| (s.extension != "apps", s.extension.clone(), s.palette.clone());
    cached.sort_by_key(|(s, _)| rank(s));
    let config = settings::config(app);
    let (mut sources, mut items) = (0, 0);
    welcome::sync(app);
    with_index(app, |ix| ix.replace(palettes_source(), Vec::new()));
    Palettes::with(app, |reg| {
        for (source, e) in cached {
            let enabled = config.palette(&palette_id(&source)).enabled;
            let filter = e.meta.default_filter();
            let mut filtered = HashMap::new();
            if enabled {
                sources += 1;
                items += e.items.len();
                if let Some(f) = &filter {
                    filtered.insert(f.clone(), e.items.clone());
                }
                with_index(app, |ix| ix.restore(source.clone(), e.items, Some(e.listed_at), e.meta.live));
            }
            reg.push(Registered { source, meta: e.meta, ext_title: e.ext_title, enabled, filter, filtered, deferred: false });
        }
    });
    sync_palette_rows(app);
    hotkey::apply(app, &config);
    eprintln!("cache\tloaded {sources} sources {items} items in {:.1}ms\t{:.1}ms since start", t0.elapsed().as_secs_f64() * 1000.0, crate::since_start_ms());
}

/// Runs `f` with the index locked; the registry is locked the same way
/// through `Palettes::with`. Neither is held across an await.
pub(crate) fn with_index<T>(app: &AppHandle, f: impl FnOnce(&mut Index) -> T) -> T {
    let st = app.state::<Mutex<Index>>();
    let mut ix = st.lock().unwrap();
    f(&mut ix)
}

impl Palettes {
    fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Vec<Registered>) -> T) -> T {
        let st = app.state::<Palettes>();
        let mut reg = st.0.lock().unwrap();
        f(&mut reg)
    }
}

pub fn flush(app: &AppHandle) {
    if let Err(e) = app.state::<Mutex<Frecency>>().lock().unwrap().flush() {
        eprintln!("frecency\tflush failed\t{e}");
    }
    app.state::<Arc<cache::Saver>>().flush();
}

// ---- host notifications --------------------------------------------------

/// Called on the host's reader task for every notification. The settings
/// registry (`settings::Extensions`) learns about every extension here too,
/// loaded or not, so the settings window can show one whose code failed.
pub fn on_notification(app: &AppHandle, host: &Arc<Host>, method: &str, params: &Value) {
    match method {
        "extension/loaded" => {
            let ext = params["extension"].as_str().unwrap_or_default().to_string();
            let Ok(metas) = serde_json::from_value::<Vec<PaletteMeta>>(params["palettes"].clone()) else { return };
            let title = params["manifest"]["title"].as_str().unwrap_or(&ext).to_string();
            settings::register(app, &ext, params, true);
            tauri::async_runtime::spawn(sync_extension(app.clone(), host.clone(), ext, title, metas));
        }
        "extension/error" => {
            let ext = params["extension"].as_str().unwrap_or_default();
            settings::register(app, ext, params, false);
            remove_extension(app, ext);
        }
        // The host is up: drop sources whose extension it no longer has
        // (deleted while it was down), so a restart cannot leave strays,
        // and their cache files (`known` is every extension on disk, loaded
        // or not: one that failed to load keeps its cache for when it is
        // fixed). Then the pass over the expired cached palettes.
        "host/ready" => {
            let live: Vec<String> = serde_json::from_value(params["extensions"].clone()).unwrap_or_default();
            let known: Vec<String> = serde_json::from_value(params["known"].clone()).unwrap_or_else(|_| live.clone());
            let stale: Vec<String> = Palettes::with(app, |reg| {
                reg.iter().map(|r| r.source.extension.clone()).filter(|e| !live.contains(e)).collect()
            });
            for ext in stale {
                remove_extension(app, &ext);
            }
            settings::retain(app, &live);
            let gone = cache::prune(&cache_dir(app), &known);
            if !gone.is_empty() {
                eprintln!("cache\tpruned\t{}", gone.join(","));
            }
            tauri::async_runtime::spawn(refresh_expired(app.clone(), host.clone()));
        }
        _ => {}
    }
}

/// Re-lists `pal/palettes` from the registry: the enabled ones, with their
/// aliases and icon overrides from the config.
fn sync_palette_rows(app: &AppHandle) {
    let config = settings::config(app);
    let rows: Vec<Item> = Palettes::with(app, |reg| reg.iter().filter(|r| r.enabled).map(|r| palette_row(r, &config)).collect());
    with_index(app, |ix| ix.replace(palettes_source(), rows));
}

async fn sync_extension(app: AppHandle, host: Arc<Host>, ext: String, ext_title: String, metas: Vec<PaletteMeta>) {
    let config = settings::config(&app);
    Palettes::with(&app, |reg| {
        reg.retain(|r| r.source.extension != ext);
        reg.extend(metas.iter().map(|m| {
            let source = Source::new(&ext, &m.name);
            let enabled = config.palette(&palette_id(&source)).enabled;
            Registered { source, meta: m.clone(), ext_title: ext_title.clone(), enabled, filter: None, filtered: HashMap::new(), deferred: false }
        }));
    });
    sync_palette_rows(&app);
    hotkey::apply(&app, &config);
    let now = unix_secs();
    for m in metas {
        let source = Source::new(&ext, &m.name);
        if !config.palette(&palette_id(&source)).enabled {
            continue;
        }
        let info = with_index(&app, |ix| ix.source(&source));
        let (stale, listed_at) = info.as_ref().map_or((false, None), |i| (i.stale, i.listed_at));
        if m.input {
            list_palette(&app, &host, &source, &m, "load").await;
        } else if m.fresh(listed_at, now) {
            // The cached (or last) listing stands.
            with_index(&app, |ix| {
                ix.set_live(source.clone(), m.live);
                ix.set_stale(source.clone(), false);
            });
            eprintln!("index\t{}/{}\tfresh\t{}s old of ttl {}s", source.extension, source.palette, now.saturating_sub(listed_at.unwrap_or(now)), m.ttl.unwrap_or(0.0));
        } else if stale && m.ttl.is_some() && !REFRESHED.load(Ordering::Relaxed) {
            // Expired cache at startup: the sequential pass after host/ready.
            Palettes::with(&app, |reg| reg.iter_mut().filter(|r| r.source == source).for_each(|r| r.deferred = true));
            eprintln!("index\t{}/{}\texpired\trefresh after ready", source.extension, source.palette);
        } else {
            list_palette(&app, &host, &source, &m, "load").await;
        }
    }
    let _ = app.emit("pal://index", ());
}

/// The low-priority pass after startup: every palette `sync_extension`
/// deferred (its cached listing older than its `ttl`), one after the
/// other, each with the host's request timeout. Runs once per host start;
/// a palette listed by other means meanwhile (`keep`, a config change) is
/// no longer deferred and is skipped.
async fn refresh_expired(app: AppHandle, host: Arc<Host>) {
    tokio::time::sleep(REFRESH_DELAY).await;
    let t0 = Instant::now();
    let todo: Vec<(Source, PaletteMeta)> = Palettes::with(&app, |reg| reg.iter().filter(|r| r.enabled && r.deferred).map(|r| (r.source.clone(), r.meta.clone())).collect());
    let mut n = 0;
    for (source, m) in &todo {
        if Palettes::with(&app, |reg| reg.iter().any(|r| &r.source == source && r.deferred)) {
            list_palette(&app, &host, source, m, "refresh").await;
            n += 1;
        }
    }
    REFRESHED.store(true, Ordering::Relaxed);
    eprintln!("index\trefresh pass\t{n} palettes\t{:.1}ms\t{:.1}ms since start", t0.elapsed().as_secs_f64() * 1000.0, crate::since_start_ms());
}

/// One `list` of a palette, with `filter` when it has one; `refresh` tells
/// the extension the user asked for a fresh listing (its own cache steps
/// aside). `None` when the host failed or answered junk (logged); the
/// bucket is then left alone.
async fn fetch(host: &Arc<Host>, source: &Source, filter: Option<&str>, refresh: bool) -> Option<Vec<Item>> {
    let params = json!({ "extension": source.extension, "palette": source.palette, "filter": filter, "refresh": refresh.then_some(true) });
    match host.request("list", params).await {
        Ok(v) => Some(serde_json::from_value::<Vec<Item>>(v["items"].clone()).unwrap_or_else(|e| {
            eprintln!("index\t{}/{}\tbad items\t{e}", source.extension, source.palette);
            Vec::new()
        })),
        Err(e) => {
            eprintln!("index\t{}/{}\tlist failed\t{e}", source.extension, source.palette);
            None
        }
    }
}

/// Puts a fresh default list in the index: the bucket, the filter cache
/// starts over with it (the other filters' rows may be stale), and the
/// cache file (debounced) so the next start has it.
fn store(app: &AppHandle, source: &Source, m: &PaletteMeta, items: Vec<Item>) {
    let filter = m.default_filter();
    let ext_title = Palettes::with(app, |reg| {
        let r = reg.iter_mut().find(|r| &r.source == source)?;
        r.filtered.clear();
        if let Some(f) = &filter {
            r.filtered.insert(f.clone(), items.clone());
        }
        r.filter = filter.clone();
        r.deferred = false;
        Some(r.ext_title.clone())
    });
    let entry = ext_title.map(|t| cache::Entry::new(unix_secs(), t, m.clone(), items.clone()));
    with_index(app, |ix| {
        ix.set_live(source.clone(), m.live);
        ix.replace(source.clone(), items);
    });
    if let Some(entry) = entry {
        app.state::<Arc<cache::Saver>>().save(source.clone(), entry);
    }
}

/// Asks the host for the palette's items and puts them in the index. An
/// input palette is in the index as an empty source: `sources` lists it, a
/// root query never finds its rows. `why` tags the log line (`load`,
/// `refresh`, `forced`, `config`, `keep`). A failed list leaves the bucket
/// as it is but clears `stale`: nothing is pending for it any more.
async fn list_palette(app: &AppHandle, host: &Arc<Host>, source: &Source, m: &PaletteMeta, why: &str) {
    let t0 = Instant::now();
    let items = if m.input {
        Vec::new()
    } else {
        match fetch(host, source, m.default_filter().as_deref(), why == "forced").await {
            Some(items) => items,
            None => {
                with_index(app, |ix| ix.set_stale(source.clone(), false));
                Palettes::with(app, |reg| reg.iter_mut().filter(|r| &r.source == source).for_each(|r| r.deferred = false));
                let _ = app.emit("pal://index", ());
                return;
            }
        }
    };
    let n = items.len();
    store(app, source, m, items);
    eprintln!("index\t{}/{}\t{n} items\t{:.1}ms\t{:.1}ms since host spawn\t{why}", source.extension, source.palette, t0.elapsed().as_secs_f64() * 1000.0, host.uptime_ms());
    let _ = app.emit("pal://index", ());
}

/// The panel is showing: list every live palette again, all at once, each
/// given `LIVE_RELIST_TIMEOUT`, and tell the page once. Spawned, so the
/// show never waits on it; the paint has the old rows, the next keystroke
/// (or the `pal://index` re-query) the new ones.
pub fn on_shown(app: &AppHandle) {
    // The welcome rows follow the permission and the marker; a no-op once hidden.
    welcome::sync(app);
    let live: Vec<(Source, PaletteMeta)> = Palettes::with(app, |reg| {
        reg.iter().filter(|r| r.enabled && r.meta.relists_on_show()).map(|r| (r.source.clone(), r.meta.clone())).collect()
    });
    if live.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let t0 = Instant::now();
        let host = app.state::<Arc<Host>>().inner().clone();
        // One task per palette: the requests are in flight together.
        let tasks: Vec<_> = live
            .iter()
            .map(|(source, m)| {
                let (host, source, filter) = (host.clone(), source.clone(), m.default_filter());
                tauri::async_runtime::spawn(async move {
                    let t = Instant::now();
                    let r = tokio::time::timeout(LIVE_RELIST_TIMEOUT, fetch(&host, &source, filter.as_deref(), false)).await;
                    (t.elapsed().as_secs_f64() * 1000.0, r)
                })
            })
            .collect();
        let mut lines = Vec::new();
        for ((source, m), task) in live.iter().zip(tasks) {
            let Ok((ms, r)) = task.await else { continue };
            match r {
                Ok(Some(items)) => {
                    lines.push(format!("{}/{} {} items {ms:.1}ms", source.extension, source.palette, items.len()));
                    store(&app, source, m, items);
                }
                Ok(None) => lines.push(format!("{}/{} failed", source.extension, source.palette)),
                Err(_) => lines.push(format!("{}/{} timed out after {ms:.0}ms", source.extension, source.palette)),
            }
        }
        eprintln!("index\tshow relist\t{:.1}ms\t{}", t0.elapsed().as_secs_f64() * 1000.0, lines.join(", "));
        let _ = app.emit("pal://index", ());
    });
}

/// The config changed: palettes switched off leave the index, ones switched
/// on are listed again, rows get their aliases, and extensions whose
/// resolved settings changed are told and re-listed (a folders setting
/// changes what `list` returns).
pub async fn apply_config(app: AppHandle, host: Arc<Host>, prev: Config, next: Config) {
    let (off, on): (Vec<Source>, Vec<(Source, PaletteMeta)>) = Palettes::with(&app, |reg| {
        let (mut off, mut on) = (Vec::new(), Vec::new());
        for r in reg.iter_mut() {
            let wanted = next.palette(&palette_id(&r.source)).enabled;
            if wanted == r.enabled {
                continue;
            }
            r.enabled = wanted;
            if wanted {
                on.push((r.source.clone(), r.meta.clone()));
            } else {
                off.push(r.source.clone());
            }
        }
        (off, on)
    });
    with_index(&app, |ix| off.iter().for_each(|s| ix.remove(s)));
    sync_palette_rows(&app);
    let _ = app.emit("pal://index", ());
    let changed = settings::changed_extensions(&app, &prev, &next);
    let ids = |v: &[Source]| v.iter().map(palette_id).collect::<Vec<_>>().join(",");
    eprintln!("config\tapplied\toff=[{}] on=[{}] settings=[{}]", ids(&off), ids(&on.iter().map(|(s, _)| s.clone()).collect::<Vec<_>>()), changed.join(","));
    settings::push(&app, &host, &changed).await;
    for (source, meta) in on {
        list_palette(&app, &host, &source, &meta, "config").await;
    }
    let relist: Vec<(Source, PaletteMeta)> = Palettes::with(&app, |reg| {
        reg.iter().filter(|r| r.enabled && changed.contains(&r.source.extension)).map(|r| (r.source.clone(), r.meta.clone())).collect()
    });
    for (source, meta) in relist {
        list_palette(&app, &host, &source, &meta, "config").await;
    }
}

fn remove_extension(app: &AppHandle, ext: &str) {
    let gone: Vec<Source> = Palettes::with(app, |reg| {
        let gone = reg.iter().filter(|r| r.source.extension == ext).map(|r| r.source.clone()).collect();
        reg.retain(|r| r.source.extension != ext);
        gone
    });
    if gone.is_empty() {
        return;
    }
    with_index(app, |ix| gone.iter().for_each(|s| ix.remove(s)));
    sync_palette_rows(app);
    let _ = app.emit("pal://index", ());
}

// ---- commands ------------------------------------------------------------

/// One row for the UI: the hit plus the item it names, so a keystroke's
/// reply is self-contained.
#[derive(Serialize)]
pub struct HitView {
    #[serde(flatten)]
    hit: Hit,
    item: Item,
}

/// One source for the UI: the meta as the host gave it, plus the count and
/// whether a listing is pending (`stale`, see the module docs).
#[derive(Serialize)]
pub struct SourceView {
    extension: String,
    palette: String,
    #[serde(flatten)]
    meta: PaletteMeta,
    count: usize,
    stale: bool,
    /// Unix seconds of the listing the rows came from.
    #[serde(skip_serializing_if = "Option::is_none")]
    listed_at: Option<u64>,
}

/// Off the main thread: the scan is well under a millisecond, but a
/// `replace` holding the lock must never stall a paint.
///
/// The welcome rows are for the unscoped empty query only, where they lead
/// whatever frecency says; a query with text is answered from every other
/// source.
#[tauri::command(async)]
pub fn query(
    q: String,
    limit: Option<usize>,
    sources: Option<Vec<Source>>,
    index: State<'_, Mutex<Index>>,
    frecency: State<'_, Mutex<Frecency>>,
) -> Vec<HitView> {
    let fre = frecency.lock().unwrap();
    let fre_boost = fre.boost(&q, SystemTime::now());
    let welcome = welcome::source();
    let boost = |s: &Source, id: &str| if *s == welcome { welcome::BOOST } else { fre_boost(s, id) };
    let mut ix = index.lock().unwrap();
    let sources = match sources {
        None if !q.is_empty() => Some(ix.sources().into_iter().map(|s| s.source).filter(|s| *s != welcome).collect()),
        s => s,
    };
    let opts = QueryOpts { limit: limit.unwrap_or(DEFAULT_LIMIT), sources: sources.as_deref(), boost: Some(&boost) };
    let hits: Vec<HitView> = ix
        .query(&q, opts)
        .into_iter()
        .map(|hit| HitView { item: ix.get(&hit.source, &hit.id).cloned().expect("hit names an indexed item"), hit })
        .collect();
    static FIRST: Once = Once::new();
    FIRST.call_once(|| eprintln!("query\tfirst answer\t{q:?}\t{} hits of {} items\t{:.1}ms since start", hits.len(), ix.len(), crate::since_start_ms()));
    hits
}

#[tauri::command(async)]
pub fn sources(index: State<'_, Mutex<Index>>, palettes: State<'_, Palettes>) -> Vec<SourceView> {
    let reg = palettes.0.lock().unwrap();
    index
        .lock()
        .unwrap()
        .sources()
        .into_iter()
        .map(|s| SourceView {
            meta: reg.iter().find(|r| r.source == s.source).map(|r| r.meta.clone()).or_else(|| synthetic_meta(&s.source)).unwrap_or_default(),
            extension: s.source.extension,
            palette: s.source.palette,
            count: s.len,
            stale: s.stale,
            listed_at: s.listed_at,
        })
        .collect()
}

/// List `source` again now, or every enabled indexed palette when `None`
/// (one after the other), whatever their `ttl`: the user asked. The
/// targets are flagged stale first, so the footer says "updating" while
/// the listings run; the flag clears as each lands. The extension is told
/// (`refresh: true` in the ctx) so its own cache steps aside.
#[tauri::command]
pub async fn index_refresh(app: AppHandle, source: Option<Source>, host: State<'_, Arc<Host>>) -> Result<(), String> {
    let targets: Vec<(Source, PaletteMeta)> = Palettes::with(&app, |reg| {
        reg.iter()
            .filter(|r| r.enabled && !r.meta.input && source.as_ref().is_none_or(|s| s == &r.source))
            .map(|r| (r.source.clone(), r.meta.clone()))
            .collect()
    });
    with_index(&app, |ix| targets.iter().for_each(|(s, _)| ix.set_stale(s.clone(), true)));
    let _ = app.emit("pal://index", ());
    let t0 = Instant::now();
    for (source, m) in &targets {
        list_palette(&app, &host, source, m, "forced").await;
    }
    eprintln!("index\trefresh forced\t{} palettes\t{:.1}ms", targets.len(), t0.elapsed().as_secs_f64() * 1000.0);
    Ok(())
}

/// Runs the item through the host and its effects here (`copy`, `open`,
/// `paste`), then remembers the pick and the query that led to it. Returns
/// the host's envelope, as `effects::apply` left it. A palette row is the
/// UI's to push: only remembered. A welcome row is the shell's
/// (`welcome::pick`) and never remembered.
///
/// `args` are the level's (`Effect.push`), handed back so the extension
/// knows which listing the id came from. A `keep` (stay open, list again)
/// on an indexed palette lists it again here, so the page's next query
/// already has the new rows; an input palette's page lists by itself.
#[tauri::command]
pub async fn pick(
    app: AppHandle,
    source: Source,
    id: String,
    action: Option<String>,
    query: String,
    args: Option<Value>,
    host: State<'_, Arc<Host>>,
) -> Result<Value, String> {
    if source == welcome::source() {
        return welcome::pick(&app, &id).await;
    }
    let r = if source == palettes_source() {
        json!({ "keep": true })
    } else {
        let params = json!({ "extension": source.extension, "palette": source.palette, "id": id, "action": action, "args": args });
        let t0 = Instant::now();
        let r = host.request("pick", params).await?;
        eprintln!("pick\t{}/{}\t{id}\t{:.1}ms", source.extension, source.palette, t0.elapsed().as_secs_f64() * 1000.0);
        let r = effects::apply(&app, r).await?;
        if r.get("keep").is_some() && args.is_none() {
            let meta = Palettes::with(&app, |reg| reg.iter().find(|r| r.source == source && r.enabled && !r.meta.input).map(|r| r.meta.clone()));
            if let Some(m) = meta {
                list_palette(&app, &host, &source, &m, "keep").await;
            }
        }
        r
    };
    // Live and input palettes carry transient ids (a clipboard entry, a calc
    // result); remembering those would only fill the store with junk. A
    // drill-in level's ids are its parent's business.
    if args.is_none() && !app.state::<Palettes>().is_transient(&source) {
        let key = Key::from_source(&source, id);
        let frecency = app.state::<Mutex<Frecency>>();
        let mut fre = frecency.lock().unwrap();
        fre.record(&key, SystemTime::now());
        fre.record_query(&key, &query);
    }
    Ok(r)
}

/// The detail pane's content for one item, from the extension (`detail(id)`),
/// as `{ markdown?, metadata? }`; `{}` when it has none to add. The host
/// caches per item until the palette lists again.
#[tauri::command]
pub async fn detail(source: Source, id: String, args: Option<Value>, host: State<'_, Arc<Host>>) -> Result<Value, String> {
    let t0 = Instant::now();
    let params = json!({ "extension": source.extension, "palette": source.palette, "id": id, "args": args });
    let r = host.request("detail", params).await;
    eprintln!("detail\t{}/{}\t{id}\t{:.1}ms{}", source.extension, source.palette, t0.elapsed().as_secs_f64() * 1000.0, r.as_ref().err().map(|e| format!("\t{e}")).unwrap_or_default());
    r
}

/// Puts `filter`'s rows in the palette's bucket: the ones listed for it
/// before, else a `list` with it now (kept until the palette lists again).
/// A no-op when the bucket already holds them, so the page can ask on every
/// query. Emits `pal://index` when the bucket changed.
#[tauri::command]
pub async fn filter(app: AppHandle, source: Source, filter: String, host: State<'_, Arc<Host>>) -> Result<(), String> {
    let (meta, cached) = Palettes::with(&app, |reg| {
        let r = reg.iter().find(|r| r.source == source && r.enabled && !r.meta.input && r.meta.filters.is_some());
        (r.map(|r| r.meta.clone()), r.and_then(|r| if r.filter.as_deref() == Some(&filter) { Some(None) } else { r.filtered.get(&filter).cloned().map(Some) }))
    });
    let Some(meta) = meta else { return Ok(()) };
    let items = match cached {
        Some(None) => return Ok(()),
        Some(Some(items)) => items,
        None => {
            let t0 = Instant::now();
            let items = fetch(&host, &source, Some(&filter), false).await.ok_or("list failed")?;
            eprintln!("index\t{}/{}\tfilter {filter}\t{} items\t{:.1}ms", source.extension, source.palette, items.len(), t0.elapsed().as_secs_f64() * 1000.0);
            items
        }
    };
    Palettes::with(&app, |reg| {
        if let Some(r) = reg.iter_mut().find(|r| r.source == source) {
            r.filtered.insert(filter.clone(), items.clone());
            r.filter = Some(filter);
        }
    });
    with_index(&app, |ix| {
        ix.set_live(source.clone(), meta.live);
        ix.replace(source, items);
    });
    let _ = app.emit("pal://index", ());
    Ok(())
}
