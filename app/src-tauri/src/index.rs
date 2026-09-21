//! The host's items in the Rust index: every palette is listed into
//! `pal_core::index::Index` as the host reports it loaded (an input palette
//! is not: its rows come from the host per keystroke), keystrokes are
//! answered from there with frecency applied, and a pick goes to the host,
//! its effects run, then into the frecency store. The palettes themselves
//! are rows of one synthetic source, `pal/palettes`, so the root search
//! finds them. What the host said about each palette, and what the config
//! file says on top, is the registry (`crate::registry`).
//!
//! The config file has a say: a palette with `enabled = false` is kept in
//! the registry (so re-enabling needs no host round trip to know it) but
//! has no items in the index and no palette row; an `alias` is an extra
//! keyword on its row; `tier` overrides the manifest's. `apply_config`
//! re-applies all three when the file changes.
//!
//! A typed root query ranks with each palette's tier (`Registered::tier`,
//! the palette rows primary), a small ladder over the palettes `[general]
//! root_first` names (`Ranking`), cuts a source that has a row with the
//! word to those rows (`root_cut`) and caps every source at `[general]
//! root_caps` rows; what the cut and the cap left out is a "N more in X"
//! row after the section (`more_row`), which a pick turns into a `push`
//! into the palette.
//!
//! A live palette (`live`, not `input`) is listed again every time the panel
//! shows (`on_shown`), after the paint, so its rows are current at the root;
//! not twice within `LIVE_RELIST_GAP`, and with a `ttl` only once its rows
//! are older than that (`relist_due`).
//! A palette with `filters` is listed once per filter the user picks
//! (`filter`), the bucket swapped for that filter's rows and each list kept
//! until the palette lists again. An item's lazy detail (`detail`) is one
//! host round trip, cached there.
//!
//! Synthetic sources besides `pal/palettes`: `pal/welcome`
//! (`crate::welcome`) leads the empty query on a fresh profile and is left
//! out of every other one; its picks are the shell's and never remembered.
//! `pal/commands` (`crate::commands`) is pal's own rows; `pal/fallback`
//! (`crate::fallback`) is never in the index: its rows are built per query
//! for the root's fallback section and picked here by id.
//!
//! The empty unscoped query leads with a "Frequent" section (`frequent`):
//! the frecency store's best rows, at most `FREQUENT_MAX`, grouped under
//! `HitView::group` and dropped from their own sections. A pick at the root
//! also goes into the search history (`Frecency::record_history`) when
//! `general.search_history` is on, whatever the source.
//!
//! Every default listing also goes to disk (`crate::cache`), and at startup,
//! before the host is spawned, `restore_cache` puts every cached palette
//! back: items, meta and palette row, flagged `stale`. When the host then
//! reports an extension loaded, each palette is listed again now (no `ttl`,
//! as before), left as it is (`ttl` declared and the cached listing younger
//! than it), held for the first panel show (`lazy` in its meta and the
//! panel not shown yet this run: the cached rows stay at the root, the
//! listing runs from `on_shown`, and from then on the palette is treated
//! like any other), or queued for one sequential low-priority pass after
//! `host/ready` (`ttl` declared and exceeded). `load_plan` is that
//! decision. `index_refresh` forces a listing at any time. `stale` on the
//! wire is "a listing is pending for this source" and the footer says
//! "updating" while it is.
//!
//! Locks: the index (`with_index`), the registry (`Palettes::with`) and
//! frecency are `std` mutexes held for one closure each, never across an
//! await. Where two are held at once the order is registry, then index
//! (`sources`), or frecency, then index (`query`); nothing takes them the
//! other way round.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pal_core::config::Config;
use pal_core::frecency::{Frecency, Key};
use pal_core::index::{Hit, Index, Item, QueryOpts, Ranked, Source, Tier};
#[cfg(test)]
use pal_core::index::Caps;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::host::Host;
use crate::registry::{palette_rows, palettes_source, synthetic_meta, Palettes, Registered};
use crate::{cache, commands, effects, events, fallback, hotkey, lock, registry, settings, welcome};

pub use crate::registry::{palette_id, PaletteMeta};

const DEFAULT_LIMIT: usize = 200;
/// A live palette slower than this on show keeps its old rows for this
/// show: the relist is background work after the paint, and a palette
/// that takes longer than a show is worth is better stale than late.
const LIVE_RELIST_TIMEOUT: Duration = Duration::from_secs(2);
/// A live palette relisted for a show this recently is not relisted for
/// the next one: a double show (toggle, toggle) or a relist still in
/// flight would only queue a second run of the same extension.
const LIVE_RELIST_GAP: Duration = Duration::from_secs(2);
/// After `host/ready`, before the pass over the palettes whose cached
/// listing is older than their `ttl`: the panel has painted and the
/// no-`ttl` listings are in flight by then.
const REFRESH_DELAY: Duration = Duration::from_secs(1);

/// Whether that pass has run: until it has, an expired palette waits for
/// it; after, an expired palette (an extension reloaded) lists at once.
static REFRESHED: AtomicBool = AtomicBool::new(false);

/// Whether the panel has shown this run: until it has, a `lazy` palette's
/// listing waits (`Registered::awaits_show`); after, it lists like any
/// other, and an extension reloaded later lists at once.
static SHOWN: AtomicBool = AtomicBool::new(false);

/// What `sync_extension` does with one palette the host just reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Load {
    /// List it now (an input palette's empty bucket counts).
    Now,
    /// The cached (or last) listing is within its `ttl`: it stands.
    Fresh,
    /// A cached listing past its `ttl` at startup: the pass after `host/ready`.
    AfterReady,
    /// A `lazy` palette before the first show: the cached rows stand until then.
    AfterShow,
}

/// The decision, pure: `stale` and `listed_at` describe the bucket the
/// index has for it (a restored cache is stale with a `listed_at`), `now`
/// unix seconds, `shown` and `refreshed` the two run-wide flags. A fresh
/// cache stands whatever else is true; a lazy palette waits for the show
/// before the expired-cache pass gets a say, since that pass is process
/// start as far as a prompt or a network call is concerned.
fn load_plan(m: &PaletteMeta, stale: bool, listed_at: Option<u64>, now: u64, shown: bool, refreshed: bool) -> Load {
    if m.input {
        Load::Now
    } else if m.fresh(listed_at, now) {
        Load::Fresh
    } else if m.lazy && !shown {
        Load::AfterShow
    } else if stale && m.ttl.is_some() && !refreshed {
        Load::AfterReady
    } else {
        Load::Now
    }
}

/// When each live palette's last show relist was issued (`on_shown`), for
/// `LIVE_RELIST_GAP`. A few entries: a Vec, so the static is const.
static RELISTED: Mutex<Vec<(Source, Instant)>> = Mutex::new(Vec::new());

/// The live palettes a show relist is still running for: the switcher's
/// commit waits on the one it holds (`relist_pending`), briefly.
static IN_FLIGHT: Mutex<Vec<Source>> = Mutex::new(Vec::new());

/// Whether a show relist for `source` is in flight.
pub fn relist_pending(source: &Source) -> bool {
    lock(&IN_FLIGHT).contains(source)
}

/// Whether a live palette lists again on this show: not within
/// `LIVE_RELIST_GAP` of its last show relist (`since_relist`, `None` for
/// never this run), and with a `ttl` only once its rows (`listed_at`, unix
/// seconds) are older than that; without one every show, as before.
fn relist_due(m: &PaletteMeta, since_relist: Option<Duration>, listed_at: Option<u64>, now: u64) -> bool {
    !since_relist.is_some_and(|d| d < LIVE_RELIST_GAP) && !m.fresh(listed_at, now)
}

fn unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

/// `data` is the config's profile dir (`ConfigFile::data_dir`): the
/// frecency file and the index cache live under it.
pub fn install(app: &AppHandle, data: &Path) {
    app.manage(Mutex::new(Index::new()));
    let frecency = Frecency::open_in(data);
    if let Some(n) = frecency.notice() {
        eprintln!("frecency\tnotice\t{n}");
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
            let mut r = Registered::new(source, e.meta, e.ext_title, &config);
            r.filter = r.meta.default_filter();
            if r.enabled {
                sources += 1;
                items += e.items.len();
                if let Some(f) = &r.filter {
                    r.filtered.insert(f.clone(), e.items.clone());
                }
                with_index(app, |ix| ix.restore(r.source.clone(), e.items, Some(e.listed_at), r.meta.live));
            }
            reg.push(r);
        }
    });
    sync_palette_rows(app);
    commands::install(app);
    hotkey::apply(app, &config);
    eprintln!("cache\tloaded\t{sources} sources {items} items in {:.1}ms\t{:.1}ms since start", ms(t0), crate::since_start_ms());
}

/// Runs `f` with the index locked (see the module docs on lock order).
pub(crate) fn with_index<T>(app: &AppHandle, f: impl FnOnce(&mut Index) -> T) -> T {
    let st = app.state::<Mutex<Index>>();
    let mut ix = lock(&st);
    f(&mut ix)
}

/// On exit: frecency to its file, the cache saver's pending writes to
/// theirs. The host is already down by then (`crate::quit`).
pub fn flush(app: &AppHandle) {
    if let Err(e) = lock(&app.state::<Mutex<Frecency>>()).flush() {
        eprintln!("frecency\tflush failed\t{e}");
    }
    app.state::<Arc<cache::Saver>>().flush();
}

// ---- host notifications --------------------------------------------------

/// Called on the host's reader task for every notification, so nothing
/// here blocks: the listings are spawned. The settings registry
/// (`settings::Extensions`) learns about every extension here too, loaded
/// or not, so the settings window can show one whose code failed.
pub fn on_notification(app: &AppHandle, host: &Arc<Host>, method: &str, params: &Value) {
    match method {
        // `extension` is the instance key (`gmail@work`, or the name for
        // the default and for a non-`multi` extension); `name` and
        // `instance` say which extension and which copy (settings.rs
        // `register` keeps them). The registry's title stays the
        // extension's ("Gmail": the palette row's subtitle); the palette
        // titles the host sends already carry the instance's.
        "extension/loaded" => {
            let ext = params["extension"].as_str().unwrap_or_default().to_string();
            let metas = match serde_json::from_value::<Vec<PaletteMeta>>(params["palettes"].clone()) {
                Ok(m) => m,
                Err(e) => return eprintln!("index\t{ext}\tbad palettes\t{e}"),
            };
            let name = params["name"].as_str().unwrap_or(pal_core::config::instance::name_of(&ext));
            let title = params["manifest"]["title"].as_str().unwrap_or(name).to_string();
            settings::register(app, &ext, params, true);
            // A fixed extension's "failed to load" row goes.
            commands::sync_failed_rows(app);
            // Its bar items: the manifest's `bar` merged with the code's keys by the host; the instance's label rides on the tooltip.
            crate::bar::on_extension_loaded(app, &ext, crate::bar::manifest_bars(&params["bar"]), settings::instance_label(app, &ext));
            // A reloaded module hears about its levels already open (a lyrics view up while its file was saved).
            crate::views::resend(app, &ext);
            tauri::async_runtime::spawn(sync_extension(app.clone(), host.clone(), ext, title, metas));
        }
        "extension/error" => {
            let ext = params["extension"].as_str().unwrap_or_default();
            settings::register(app, ext, params, false);
            remove_extension(app, ext);
            // Said once, as a row at the root (and in Settings): never a toast on a show.
            commands::sync_failed_rows(app);
        }
        // Its directory went away while the host was up: nothing to keep.
        "extension/removed" => {
            let ext = params["extension"].as_str().unwrap_or_default();
            settings::forget(app, ext);
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
            // `known`, not `live`: a failed extension stays listed in
            // Settings, where its error is shown.
            settings::retain(app, &known);
            commands::sync_failed_rows(app);
            let (app, host, dir) = (app.clone(), host.clone(), cache_dir(app));
            tauri::async_runtime::spawn(async move {
                // File removals off the reader task.
                if let Ok(gone) = tauri::async_runtime::spawn_blocking(move || cache::prune(&dir, &known)).await {
                    if !gone.is_empty() {
                        eprintln!("cache\tpruned\t{}", gone.join(","));
                    }
                }
                refresh_expired(app, host).await;
            });
        }
        _ => {}
    }
}

/// Re-lists `pal/palettes` from the registry: the enabled ones, with their
/// aliases and icon overrides from the config.
fn sync_palette_rows(app: &AppHandle) {
    let config = settings::config(app);
    let rows = Palettes::with(app, |reg| palette_rows(reg, &config));
    with_index(app, |ix| ix.replace(palettes_source(), rows));
}

async fn sync_extension(app: AppHandle, host: Arc<Host>, ext: String, ext_title: String, metas: Vec<PaletteMeta>) {
    let config = settings::config(&app);
    // A palette the extension no longer declares (a script plugin removed
    // while pal was down, a renamed palette): out of the registry, the
    // index and the cache, or its rows would stay at the root with no
    // tier and nothing to pick them (`no palette scripts/iconnerd`).
    let gone: Vec<Source> = Palettes::with(&app, |reg| {
        let gone = reg.iter().filter(|r| r.source.extension == ext && !metas.iter().any(|m| m.name == r.source.palette)).map(|r| r.source.clone()).collect();
        registry::replace_extension(reg, &ext, &ext_title, &metas, &config);
        gone
    });
    if !gone.is_empty() {
        with_index(&app, |ix| gone.iter().for_each(|s| ix.remove(s)));
        let dir = cache_dir(&app);
        for s in &gone {
            cache::remove(&dir, s);
        }
        eprintln!("index\t{ext}\tdropped {} gone palette(s): {}", gone.len(), gone.iter().map(|s| s.palette.as_str()).collect::<Vec<_>>().join(","));
    }
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
        match load_plan(&m, stale, listed_at, now, SHOWN.load(Ordering::SeqCst), REFRESHED.load(Ordering::SeqCst)) {
            Load::Now => list_palette(&app, &host, &source, &m, "load").await,
            Load::Fresh => {
                // The cached (or last) listing stands.
                with_index(&app, |ix| {
                    ix.set_live(source.clone(), m.live);
                    ix.set_stale(source.clone(), false);
                });
                eprintln!("index\t{}/{}\tfresh\t{}s old of ttl {}s", source.extension, source.palette, now.saturating_sub(listed_at.unwrap_or(now)), m.ttl.unwrap_or(0.0));
            }
            Load::AfterReady => {
                // Expired cache at startup: the sequential pass after host/ready.
                set_deferred(&app, &source, true);
                eprintln!("index\t{}/{}\texpired\trefresh after ready", source.extension, source.palette);
            }
            Load::AfterShow => {
                // The cached rows (if any) stay at the root; `on_shown` lists it. The
                // bucket keeps `live` so a restored live palette relists on later shows.
                with_index(&app, |ix| {
                    if ix.source(&source).is_some() {
                        ix.set_live(source.clone(), m.live);
                    }
                });
                set_awaits_show(&app, &source, true);
                eprintln!("index\t{}/{}\tlazy, waits for a show", source.extension, source.palette);
            }
        }
    }
    events::emit(&app, events::INDEX, ());
}

fn set_deferred(app: &AppHandle, source: &Source, deferred: bool) {
    Palettes::with(app, |reg| reg.iter_mut().filter(|r| &r.source == source).for_each(|r| r.deferred = deferred));
}

fn set_awaits_show(app: &AppHandle, source: &Source, awaits: bool) {
    Palettes::with(app, |reg| reg.iter_mut().filter(|r| &r.source == source).for_each(|r| r.awaits_show = awaits));
}

/// The low-priority pass after startup: every palette `sync_extension`
/// deferred (its cached listing older than its `ttl`), one after the
/// other, each with the host's request timeout. `REFRESHED` flips before
/// the pass reads the registry, so a palette deferred after that point
/// lists itself at once instead of waiting for a pass that will not see
/// it. A palette listed by other means meanwhile (`keep`, a config change)
/// is no longer deferred and is skipped.
async fn refresh_expired(app: AppHandle, host: Arc<Host>) {
    tokio::time::sleep(REFRESH_DELAY).await;
    let t0 = Instant::now();
    REFRESHED.store(true, Ordering::SeqCst);
    let todo: Vec<(Source, PaletteMeta)> = Palettes::with(&app, |reg| reg.iter().filter(|r| r.enabled && r.deferred).map(|r| (r.source.clone(), r.meta.clone())).collect());
    let mut n = 0;
    for (source, m) in &todo {
        if Palettes::with(&app, |reg| reg.iter().any(|r| &r.source == source && r.deferred)) {
            list_palette(&app, &host, source, m, "refresh").await;
            n += 1;
        }
    }
    eprintln!("index\trefresh pass\t{n} palettes\t{:.1}ms\t{:.1}ms since start", ms(t0), crate::since_start_ms());
}

/// One `list` of a palette, with `filter` when it has one; `refresh` tells
/// the extension the user asked for a fresh listing (its own cache steps
/// aside). `None` when the host failed or answered junk (logged); the
/// bucket is then left alone.
async fn fetch(host: &Arc<Host>, source: &Source, filter: Option<&str>, refresh: bool) -> Option<Vec<Item>> {
    let params = json!({ "extension": source.extension, "palette": source.palette, "filter": filter, "refresh": refresh.then_some(true) });
    match host.request("list", params).await {
        Ok(mut v) => Some(serde_json::from_value::<Vec<Item>>(v["items"].take()).unwrap_or_else(|e| {
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
/// cache file (debounced) so the next start has it. A source no longer
/// registered (its extension errored or went while the list was in
/// flight) gets nothing: `remove_extension` has already dropped it and
/// the rows would be strays.
fn store(app: &AppHandle, source: &Source, m: &PaletteMeta, items: Vec<Item>) {
    let filter = m.default_filter();
    let ext_title = Palettes::with(app, |reg| {
        let r = reg.iter_mut().find(|r| &r.source == source)?;
        r.filtered.clear();
        if let Some(f) = &filter {
            r.filtered.insert(f.clone(), items.clone());
        }
        r.filter = filter;
        r.deferred = false;
        r.awaits_show = false;
        Some(r.ext_title.clone())
    });
    let Some(ext_title) = ext_title else {
        return eprintln!("index\t{}/{}\tlisted after removal; dropped", source.extension, source.palette);
    };
    let entry = cache::Entry::new(unix_secs(), ext_title, m.clone(), items.clone());
    with_index(app, |ix| {
        ix.set_live(source.clone(), m.live);
        ix.replace(source.clone(), items);
    });
    app.state::<Arc<cache::Saver>>().save(source.clone(), entry);
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
                // Only an existing bucket: `set_stale` would create one.
                with_index(app, |ix| {
                    if ix.source(source).is_some() {
                        ix.set_stale(source.clone(), false);
                    }
                });
                set_deferred(app, source, false);
                set_awaits_show(app, source, false);
                events::emit(app, events::INDEX, ());
                return;
            }
        }
    };
    let n = items.len();
    store(app, source, m, items);
    eprintln!("index\t{}/{}\t{n} items\t{:.1}ms\t{:.1}ms since host spawn\t{why}", source.extension, source.palette, ms(t0), host.uptime_ms());
    events::emit(app, events::INDEX, ());
}

/// The panel is showing: the `lazy` palettes still waiting for their
/// first listing of the run get it (`list_palette`, the host's own
/// timeout, one task each, `why` = `show`), and every live palette that
/// is due lists again (`relist`). Spawned, so the show never waits on it;
/// the paint has the old rows, the next keystroke (or the `pal://index`
/// re-query) the new ones. A lazy live palette on its first show goes the
/// lazy way only. `held` (`extension/palette`, the switcher's) is due
/// whatever the gap says: its order is the point.
pub fn on_shown(app: &AppHandle, held: Option<&str>) {
    SHOWN.store(true, Ordering::SeqCst);
    // The welcome rows follow the permission and the marker; a no-op once hidden.
    welcome::sync(app);
    let waiting: Vec<(Source, PaletteMeta)> = Palettes::with(app, |reg| {
        reg.iter_mut().filter(|r| r.enabled && r.awaits_show).map(|r| { r.awaits_show = false; (r.source.clone(), r.meta.clone()) }).collect()
    });
    let lazy_now: Vec<Source> = waiting.iter().map(|(s, _)| s.clone()).collect();
    if !waiting.is_empty() {
        eprintln!("index\tfirst show\tlisting {}", lazy_now.iter().map(|s| format!("{}/{}", s.extension, s.palette)).collect::<Vec<_>>().join(", "));
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let host = app.state::<Arc<Host>>().inner().clone();
            let tasks: Vec<_> = waiting
                .into_iter()
                .map(|(source, m)| {
                    let (app, host) = (app.clone(), host.clone());
                    tauri::async_runtime::spawn(async move { list_palette(&app, &host, &source, &m, "show").await })
                })
                .collect();
            for t in tasks {
                let _ = t.await;
            }
        });
    }
    let live: Vec<(Source, PaletteMeta)> = Palettes::with(app, |reg| {
        reg.iter().filter(|r| r.enabled && r.meta.relists_on_show() && !lazy_now.contains(&r.source)).map(|r| (r.source.clone(), r.meta.clone())).collect()
    });
    relist(app, live, held);
}

/// The sidebar is showing `key` (`extension/palette`, sidebar.rs): that
/// palette alone goes the panel's way, its first listing of the run if
/// it was waiting for a show, else the live relist above, past the gap
/// like the switcher's (the sidebar shows to be read, so it reads fresh).
pub fn relist_live(app: &AppHandle, key: &str) {
    let found = Palettes::with(app, |reg| {
        reg.iter_mut().find(|r| r.enabled && palette_key(&r.source) == key).map(|r| {
            let waiting = std::mem::take(&mut r.awaits_show);
            (r.source.clone(), r.meta.clone(), waiting)
        })
    });
    let Some((source, m, waiting)) = found else { return eprintln!("index\tsidebar\t{key}\tno such palette to list") };
    if waiting {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let host = app.state::<Arc<Host>>().inner().clone();
            list_palette(&app, &host, &source, &m, "show").await;
        });
    } else if m.relists_on_show() {
        relist(app, vec![(source, m)], Some(key));
    }
}

/// `extension/palette`, the key the page and the config name a palette by.
pub fn palette_key(s: &Source) -> String {
    format!("{}/{}", s.extension, s.palette)
}

/// The live palettes among `live` that are due (`relist_due`) list again,
/// all at once, each given `LIVE_RELIST_TIMEOUT`, and the page is told
/// once; `forced` (`extension/palette`) is due whatever the gap says.
/// Spawned, so the show never waits on it.
fn relist(app: &AppHandle, live: Vec<(Source, PaletteMeta)>, forced: Option<&str>) {
    let now = unix_secs();
    let ages: Vec<Option<u64>> = with_index(app, |ix| live.iter().map(|(s, _)| ix.source(s).and_then(|i| i.listed_at)).collect());
    let mut relisted = lock(&RELISTED);
    let (live, skipped): (Vec<_>, Vec<_>) = live.into_iter().zip(ages).partition(|((source, m), listed_at)| {
        let since = relisted.iter().find(|(s, _)| s == source).map(|(_, t)| t.elapsed());
        relist_due(m, since, *listed_at, now) || forced == Some(palette_key(source).as_str())
    });
    for ((source, _), _) in &live {
        relisted.retain(|(s, _)| s != source);
        relisted.push((source.clone(), Instant::now()));
    }
    drop(relisted);
    if !skipped.is_empty() {
        eprintln!("index\tshow relist\tskipped {}", skipped.iter().map(|((s, _), _)| format!("{}/{}", s.extension, s.palette)).collect::<Vec<_>>().join(", "));
    }
    let live: Vec<(Source, PaletteMeta)> = live.into_iter().map(|(l, _)| l).collect();
    if live.is_empty() {
        return;
    }
    lock(&IN_FLIGHT).extend(live.iter().map(|(s, _)| s.clone()));
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
                    (ms(t), r)
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
        eprintln!("index\tshow relist\t{:.1}ms\t{}", ms(t0), lines.join(", "));
        events::emit(&app, events::INDEX, ());
        lock(&IN_FLIGHT).retain(|s| !live.iter().any(|(l, _)| l == s));
    });
}

/// The config changed: palettes switched off leave the index, ones switched
/// on are listed again, rows get their aliases, and extensions whose
/// resolved settings changed are told and re-listed (a folders setting
/// changes what `list` returns).
pub async fn apply_config(app: AppHandle, host: Arc<Host>, prev: Config, next: Config) {
    let (off, on) = Palettes::with(&app, |reg| registry::toggle_enabled(reg, &next));
    with_index(&app, |ix| off.iter().for_each(|s| ix.remove(s)));
    sync_palette_rows(&app);
    events::emit(&app, events::INDEX, ());
    let changed = settings::changed_extensions(&app, &prev, &next);
    let ids = |v: &[Source]| v.iter().map(palette_id).collect::<Vec<_>>().join(",");
    let on_sources: Vec<Source> = on.iter().map(|(s, _)| s.clone()).collect();
    let instances = settings::changed_instances(&prev, &next);
    eprintln!("config\tapplied\toff=[{}] on=[{}] settings=[{}] instances=[{}]", ids(&off), ids(&on_sources), changed.join(","), instances.join(","));
    settings::push(&app, &host, &changed).await;
    // `[instances.*]` of an extension moved: the host reloads every instance of it (one added, removed, parked or retitled).
    for name in &instances {
        if let Err(e) = host.notify("instances/changed", serde_json::json!({ "extension": name })).await {
            eprintln!("config\tinstances/changed\t{name}\tfailed\t{e}");
        }
    }
    crate::bar::on_settings_changed(&app, &changed);
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
    crate::bar::remove_extension(app, ext);
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
    events::emit(app, events::INDEX, ());
}

// ---- commands ------------------------------------------------------------

/// One row for the UI: the hit plus the item it names, so a keystroke's
/// reply is self-contained. `group` names the root section the row goes
/// under when it is not its palette's ("Frequent"); the UI groups by it.
#[derive(Serialize)]
pub struct HitView {
    #[serde(flatten)]
    hit: Hit,
    item: Item,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
}

impl HitView {
    pub fn new(hit: Hit, item: Item) -> Self {
        Self { hit, item, group: None }
    }

    /// The root section the row goes under instead of its palette's.
    pub fn set_group(&mut self, group: &str) {
        self.group = Some(group.to_string());
    }

    #[cfg(test)]
    pub fn item_id(&self) -> &str {
        &self.item.id
    }
}

/// The empty root's "Frequent" section: the best-scoring items of the
/// frecency store, at most this many.
pub const FREQUENT_MAX: usize = 5;
/// The section's title, what the UI shows over the rows.
pub const FREQUENT: &str = "Frequent";

/// The "Frequent" rows of the empty root: the store's top keys, in its
/// order, that name an indexed row of a non-synthetic source (a palette
/// row is already in the Palettes section, pal's commands too, a welcome
/// row is not history), at most [`FREQUENT_MAX`]. The hits carry no match
/// positions; the UI groups them under [`FREQUENT`] and drops them from
/// their own sections (`dedupe`). Asked for more keys than rows so a store
/// full of gone items still fills the section.
fn frequent(ix: &Index, fre: &Frecency, now: SystemTime) -> Vec<HitView> {
    let skip = [palettes_source(), commands::source(), welcome::source()];
    fre.top(FREQUENT_MAX * 8, now)
        .into_iter()
        .filter(|k| !skip.iter().any(|s| s.extension == k.extension && s.palette == k.palette))
        .filter_map(|k| {
            let source = k.source();
            let item = ix.get(&source, &k.id).cloned()?;
            Some(HitView { hit: Hit { source, id: k.id, score: 0.0, name_positions: Vec::new() }, item, group: Some(FREQUENT.into()) })
        })
        .take(FREQUENT_MAX)
        .collect()
}

/// The "Needs attention" rows of the empty root: the failed extensions'
/// rows of the commands source (`commands::failed_rows`), under
/// [`commands::ATTENTION`] and dropped from the pal section (`dedupe`).
fn attention(ix: &Index) -> Vec<HitView> {
    let source = commands::source();
    commands::failed_ids(ix)
        .into_iter()
        .filter_map(|id| {
            let item = ix.get(&source, &id).cloned()?;
            Some(HitView { hit: Hit { source: source.clone(), id, score: 0.0, name_positions: Vec::new() }, item, group: Some(commands::ATTENTION.into()) })
        })
        .collect()
}

/// The rest of the empty root without the rows a leading section already shows.
fn dedupe(hits: Vec<HitView>, frequent: &[HitView]) -> Vec<HitView> {
    hits.into_iter().filter(|h| !frequent.iter().any(|f| f.hit.source == h.hit.source && f.hit.id == h.hit.id)).collect()
}

/// One row for one thing at the root: a palette that lists what another
/// palette of its extension lists too (Today beside My Schedule, Recent
/// Notes beside Notes, Unread beside Chats, Decks beside Pages: the same
/// ids, since a pick lands on the same thing) would put the item under
/// two sections. The first hit stays (the hits come grouped by source,
/// the best-ranked section first), the later copies go. Never a "more"
/// row (`MORE_ID` is one id for every capped source).
fn dedupe_across_palettes(hits: Vec<HitView>) -> Vec<HitView> {
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    hits.into_iter().filter(|h| h.hit.id == MORE_ID || seen.insert((h.hit.source.extension.clone(), h.hit.id.clone()))).collect()
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
    /// `[palettes.<id>] alias`, trimmed, for the UI's alias-and-space jump.
    #[serde(skip_serializing_if = "Option::is_none")]
    alias: Option<String>,
}

/// Added to a palette row's score on a typed query, over the primary tier
/// the palette rows rank as (`root_tier`), so `clip` lists Clipboard
/// History above the Clipper app and the icon rows that match as well: a
/// palette row is the way into everything behind it (Raycast lists its
/// commands first for the same reason). One tier step: with the word
/// bonus a palette row that has the typed word sits at 600 against a
/// primary row's 450 (the ladder is under `pal_core::index::EXACT_BONUS`),
/// and a palette row that only scatters the letters (`chr` across
/// `Clipboard History`) sits at 300, under every primary row that has the
/// word, which the old flat 500 put above Google Chrome. Under the exact
/// bonus by far: a row named what was typed keeps its lead over a hot
/// palette row by 500. The empty query is untouched: it is ordered by
/// insertion and use, and the palettes are inserted first anyway.
/// `[general] root_first`, `root_first_step` and `root_cut` as the query
/// reads them (`settings::root_ranking`): the palettes that lead their
/// band, `step` points apart, and whether a source with a row that has
/// the word shows only those.
#[derive(Debug, Clone, PartialEq)]
pub struct Ranking {
    pub first: Vec<Source>,
    pub step: f32,
    pub cut: bool,
}

impl Default for Ranking {
    fn default() -> Self {
        Self { first: pal_core::config::DEFAULT_ROOT_FIRST.iter().filter_map(|k| k.split_once('/').map(|(e, p)| Source::new(e, p))).collect(), step: 30.0, cut: true }
    }
}

impl Ranking {
    /// What `source` gets on a typed query: `step` for the last of `first`, twice that for the one before, nothing for the rest.
    pub fn bonus(&self, source: &Source) -> f32 {
        self.first.iter().position(|s| s == source).map_or(0.0, |i| self.step * (self.first.len() - i) as f32)
    }
}

/// The id of the row the root appends after a capped source's hits ("12
/// more in Emoji", `more_row`): a pick on it opens the palette, nothing is
/// remembered. Not an id an extension can list (`:` is not in any
/// bundled id scheme, and the source's own rows are looked up first).
pub const MORE_ID: &str = "pal:more";

/// The root's boost over `fre_boost` (a frecency, `Frecency::boost`): the
/// welcome rows lead the empty query outright, the `root_first` palettes
/// get their ladder (`Ranking::bonus`) on a typed one, everything else is
/// its frecency. A palette row has no bonus of its own any more: the
/// palettes are primary, so one that has the word sits with the apps that
/// do, under the app named for it (shorter name, then the apps' rung).
fn root_boost<'a>(q: &str, ranking: &'a Ranking, fre_boost: &'a dyn Fn(&Source, &str) -> f32) -> impl Fn(&Source, &str) -> f32 + 'a {
    let welcome = welcome::source();
    let typed = !q.trim().is_empty();
    move |s: &Source, id: &str| {
        if *s == welcome {
            welcome::BOOST
        } else {
            (if typed { ranking.bonus(s) } else { 0.0 }) + fre_boost(s, id)
        }
    }
}

/// The root's tiers: each registered palette's (`Registered::tier`), the
/// palette rows and pal's own commands (`crate::commands`) primary (they
/// are reached by name), anything else normal.
fn root_tier(tiers: &[(Source, Tier)]) -> impl Fn(&Source) -> Tier + '_ {
    let (palettes, commands) = (palettes_source(), commands::source());
    move |s: &Source| if *s == palettes || *s == commands { Tier::Primary } else { tiers.iter().find(|(t, _)| t == s).map_or(Tier::Normal, |(_, t)| *t) }
}

/// The trailing row of a capped section: `count` more rows of `source`
/// matched than the cap let through; `title` is the palette's. Muted in
/// the UI (`more: true` in the item), Enter opens the palette.
fn more_row(source: &Source, title: &str, count: usize) -> HitView {
    let name = format!("{count} more in {title}");
    let item = Item { id: MORE_ID.into(), name, subtitle: None, keywords: Vec::new(), icon: Some(json!("\u{203a}")), section: None, extra: [("more".to_string(), json!(true))].into_iter().collect() };
    HitView::new(Hit { source: source.clone(), id: MORE_ID.into(), score: 0.0, name_positions: Vec::new() }, item)
}

/// Off the main thread: the scan is well under a millisecond, but a
/// `replace` holding the lock must never stall a paint.
///
/// The welcome rows are for the unscoped empty query only, where they lead
/// whatever frecency says; a query with text is answered from every other
/// source.
/// What the panel's page last searched: one source inside a palette,
/// none at the root. Read by `permissions::attended`: an extension's ask
/// from a listing is honoured only while its palette is what is showing.
static SHOWING: Mutex<Option<Source>> = Mutex::new(None);

/// The palette the page is inside, as of its last query; `None` at the root.
pub fn showing() -> Option<Source> {
    lock(&SHOWING).clone()
}

/// Picks in flight, by extension: an ask from a pick is the user's own
/// doing (Enter on the row that offered it) and is honoured wherever the
/// panel is.
static PICKING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Whether a pick of `extension`'s is being answered right now.
pub fn picking(extension: &str) -> bool {
    lock(&PICKING).iter().any(|e| e == extension)
}

#[tauri::command(async)]
pub fn query(
    app: AppHandle,
    q: String,
    limit: Option<usize>,
    sources: Option<Vec<Source>>,
    index: State<'_, Mutex<Index>>,
    frecency: State<'_, Mutex<Frecency>>,
    palettes: State<'_, Palettes>,
) -> Vec<HitView> {
    static FIRST: Once = Once::new();
    *lock(&SHOWING) = sources.as_ref().and_then(|s| (s.len() == 1).then(|| s[0].clone()));
    // The registry first, then frecency, then the index (the module docs on lock order); nothing held across.
    // Tiers and titles in one pass: the titles serve the "more" rows, and
    // taking the registry again under the index guard would invert the order
    // `sync_palette_rows` takes them in (a deadlock seen in the scratch instance).
    let (tiers, titles) = {
        let reg = palettes.lock();
        let tiers: Vec<(Source, Tier)> = reg.iter().map(|r| (r.source.clone(), r.tier)).collect();
        let titles: Vec<(Source, String)> = reg.iter().map(|r| (r.source.clone(), r.meta.title.clone())).collect();
        (tiers, titles)
    };
    let tier = root_tier(&tiers);
    // Caps at the root only: a palette's own level lists everything.
    let caps = sources.is_none().then(|| settings::root_caps(&app));
    let ranking = settings::root_ranking(&app);
    let fre = lock(&frecency);
    let fre_boost = fre.boost(&q, SystemTime::now());
    let boost = root_boost(&q, &ranking, &fre_boost);
    let welcome = welcome::source();
    let mut ix = lock(&index);
    let sources = match sources {
        None if !q.is_empty() => Some(ix.sources().into_iter().map(|s| s.source).filter(|s| *s != welcome).collect()),
        s => s,
    };
    // The empty unscoped root leads with what needs attention (a failed extension's row) and the Frequent section, after the welcome rows, which outscore everything.
    let empty_root = sources.is_none() && q.trim().is_empty();
    let frequent = if empty_root { frequent(&ix, &fre, SystemTime::now()) } else { Vec::new() };
    let attention = if empty_root { attention(&ix) } else { Vec::new() };
    let opts = QueryOpts { limit: limit.unwrap_or(DEFAULT_LIMIT), sources: sources.as_deref(), boost: Some(&boost), tier: Some(&tier), caps, cut: ranking.cut };
    let ranked = ix.query(&q, opts);
    let mut hits = views(&ix, ranked, &titles);
    if sources.is_none() {
        hits = dedupe_across_palettes(hits);
    }
    for lead in [attention, frequent] {
        if lead.is_empty() {
            continue;
        }
        hits = dedupe(hits, &lead);
        let at = hits.iter().position(|h| h.hit.source != welcome && h.group.as_deref() != Some(commands::ATTENTION)).unwrap_or(hits.len());
        hits.splice(at..at, lead);
    }
    FIRST.call_once(|| eprintln!("query\tfirst answer\t{q:?} {} hits of {} items\t{:.1}ms since start", hits.len(), ix.len(), crate::since_start_ms()));
    hits
}

/// The reply's rows: each hit beside its item, and after the last hit of
/// every capped source its "more" row (the hits come grouped by source).
/// A hit always names an indexed item; `filter_map` rather than a panic
/// on the invariant, since a panic here is the whole keystroke lost.
fn views(ix: &Index, ranked: Ranked, titles: &[(Source, String)]) -> Vec<HitView> {
    let mut hits: Vec<HitView> = ranked.hits.into_iter().filter_map(|hit| Some(HitView::new(hit.clone(), ix.get(&hit.source, &hit.id).cloned()?))).collect();
    for m in ranked.more.iter().rev() {
        let Some(end) = hits.iter().rposition(|h| h.hit.source == m.source) else { continue };
        let title = titles.iter().find(|(s, _)| *s == m.source).map_or(m.source.palette.as_str(), |(_, t)| t.as_str());
        hits.insert(end + 1, more_row(&m.source, title, m.count));
    }
    hits
}

#[tauri::command(async)]
pub fn sources(app: AppHandle, index: State<'_, Mutex<Index>>, palettes: State<'_, Palettes>) -> Vec<SourceView> {
    let config = settings::config(&app);
    let reg = palettes.lock();
    lock(&index)
        .sources()
        .into_iter()
        .map(|s| SourceView {
            meta: reg.iter().find(|r| r.source == s.source).map(|r| r.meta.clone()).or_else(|| synthetic_meta(&s.source)).unwrap_or_default(),
            alias: config.palette(&palette_id(&s.source)).alias.as_deref().map(str::trim).filter(|a| !a.is_empty()).map(str::to_string),
            extension: s.source.extension,
            palette: s.source.palette,
            count: s.len,
            stale: s.stale,
            listed_at: s.listed_at,
        })
        .collect()
}

/// "Reset ranking for this item": the row's frecency (visits and the
/// queries that led to it) is forgotten, so it ranks as never picked. The
/// page re-queries on the index event. Answers whether there was history.
#[tauri::command]
pub fn frecency_forget(app: AppHandle, source: Source, id: String, frecency: State<'_, Mutex<Frecency>>) -> bool {
    let had = lock(&frecency).forget(&Key::from_source(&source, id.clone()));
    eprintln!("frecency\tforget\t{}/{}\t{id}\t{}", source.extension, source.palette, if had { "dropped" } else { "nothing" });
    events::emit(&app, events::INDEX, ());
    had
}

/// The search history, newest first (empty with `general.search_history = false`).
#[tauri::command]
pub fn search_history(app: AppHandle, frecency: State<'_, Mutex<Frecency>>) -> Vec<String> {
    if !settings::config(&app).general.search_history {
        return Vec::new();
    }
    lock(&frecency).history().to_vec()
}

/// "Clear Search History": the queries go, the items' own history stays.
#[tauri::command]
pub fn search_history_clear(frecency: State<'_, Mutex<Frecency>>) {
    lock(&frecency).clear_history();
    eprintln!("frecency\thistory cleared");
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
    events::emit(&app, events::INDEX, ());
    let t0 = Instant::now();
    for (source, m) in &targets {
        list_palette(&app, &host, source, m, "forced").await;
    }
    eprintln!("index\trefresh forced\t{} palettes\t{:.1}ms", targets.len(), ms(t0));
    Ok(())
}

/// Runs the item through the host and its effects here (`copy`, `open`,
/// `paste`), then remembers the pick and the query that led to it. Returns
/// the host's envelope, as `effects::apply` left it. A palette row is the
/// UI's to push: only remembered. A welcome row is the shell's
/// (`welcome::pick`) and never remembered.
///
/// `args` are the level's (`Effect.push`), handed back so the extension
/// knows which listing the id came from; `values` are a form's fields on
/// its submit (`Effect.form`), both riding in the extension's ctx. A
/// `keep` (stay open, list again)
/// on an indexed palette lists it again here, so the page's next query
/// already has the new rows; an input palette's page lists by itself.
/// What the page sends for a pick: the row, the action, the query that led
/// there, and the level's `args`/`values`.
#[derive(Deserialize)]
pub struct PickRequest {
    pub source: Source,
    pub id: String,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub args: Option<Value>,
    #[serde(default)]
    pub values: Option<Value>,
    /// Every marked row for an `Action.multi` pick (`id` is the first); the extension gets them as `ctx.ids`.
    #[serde(default)]
    pub ids: Option<Vec<String>>,
}

/// `window` is the one the pick came from (the panel, or the bar popover):
/// a hiding effect hides that one.
#[tauri::command]
pub async fn pick(app: AppHandle, window: tauri::Window, req: PickRequest, host: State<'_, Arc<Host>>) -> Result<Value, String> {
    let PickRequest { source, id, action, query, args, values, ids } = req;
    if source == welcome::source() {
        return welcome::pick(&app, &id).await;
    }
    // The "N more in X" row: into the palette, remembered as nothing.
    if id == MORE_ID && args.is_none() && with_index(&app, |ix| ix.get(&source, &id).is_none()) {
        return Ok(json!({ "push": { "extension": source.extension, "palette": source.palette } }));
    }
    let r = if source == palettes_source() {
        json!({ "keep": true })
    } else if source == commands::source() {
        commands::pick(&app, &id, action.as_deref(), values.as_ref()).await?
    } else if source == fallback::source() {
        fallback::pick(&app, &id, &query).await?
    } else {
        run_pick_from(&app, &host, &source, &Pick { id: &id, action: action.as_deref(), args: args.as_ref(), values: values.as_ref(), ids: ids.as_deref() }, window.label()).await?
    };
    let history_on = settings::config(&app).general.search_history;
    let frecency = app.state::<Mutex<Frecency>>();
    let mut fre = lock(&frecency);
    // Live and input palettes carry transient ids (a clipboard entry, a calc
    // result); remembering those would only fill the store with junk. A
    // drill-in level's ids are its parent's business, and a multi pick is
    // a batch, not a choice.
    if args.is_none() && ids.is_none() && !app.state::<Palettes>().is_transient(&source) && !commands::inert(&source, &id) && !fallback::inert(&source, &id) {
        let key = Key::from_source(&source, id);
        fre.record(&key, SystemTime::now());
        fre.record_query(&key, &query);
    }
    // The search history is what was typed at the root before any pick, a
    // calc result or a fallback row included: the query is what is recalled.
    if args.is_none() && history_on {
        fre.record_history(&query);
    }
    Ok(r)
}

/// What a pick names: the row, the action, the args of the push that
/// opened the level, a form's values, the marked ids of a multi pick.
#[derive(Default)]
pub struct Pick<'a> {
    pub id: &'a str,
    pub action: Option<&'a str>,
    pub args: Option<&'a Value>,
    pub values: Option<&'a Value>,
    pub ids: Option<&'a [String]>,
}

/// The pick itself: the host's `pick`, its effects, and the relist a
/// `keep` asks for. Shared by the `pick` command and an item hotkey
/// (`hotkey::pressed`), which runs a pick with the panel down.
pub async fn run_pick(app: &AppHandle, host: &Arc<Host>, source: &Source, pick: &Pick<'_>) -> Result<Value, String> {
    run_pick_from(app, host, source, pick, crate::WINDOW).await
}

/// [`run_pick`] with the window the pick came from, for its hiding effects.
pub async fn run_pick_from(app: &AppHandle, host: &Arc<Host>, source: &Source, pick: &Pick<'_>, window: &str) -> Result<Value, String> {
    let Pick { id, action, args, values, ids } = *pick;
    let mut params = json!({ "extension": source.extension, "palette": source.palette, "id": id, "action": action, "args": args, "values": values, "ids": ids });
    if crate::views::is_compact(window) {
        params["compact"] = Value::Bool(true);
    }
    let t0 = Instant::now();
    lock(&PICKING).push(source.extension.clone());
    let r = host.request("pick", params).await;
    {
        let mut picking = lock(&PICKING);
        if let Some(i) = picking.iter().position(|e| *e == source.extension) {
            picking.remove(i);
        }
    }
    let r = r?;
    eprintln!("pick\t{}/{}\t{id}\t{:.1}ms", source.extension, source.palette, ms(t0));
    let r = effects::apply_from(app, r, window).await?;
    if r.get("keep").is_some() && args.is_none() {
        let meta = Palettes::with(app, |reg| reg.iter().find(|r| r.source == *source && r.enabled && !r.meta.input).map(|r| r.meta.clone()));
        if let Some(m) = meta {
            list_palette(app, host, source, &m, "keep").await;
        }
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
    eprintln!("detail\t{}/{}\t{id}\t{:.1}ms{}", source.extension, source.palette, ms(t0), r.as_ref().err().map(|e| format!("\t{e}")).unwrap_or_default());
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
            eprintln!("index\t{}/{}\tfilter {filter}\t{} items\t{:.1}ms", source.extension, source.palette, items.len(), ms(t0));
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
    events::emit(&app, events::INDEX, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_view_flattens_the_meta_and_skips_empty_optionals() {
        let meta = PaletteMeta { name: "history".into(), title: "Clipboard".into(), live: true, ttl: Some(30.0), ..Default::default() };
        let v = serde_json::to_value(SourceView { extension: "clipboard".into(), palette: "history".into(), meta, count: 3, stale: true, listed_at: None, alias: None }).unwrap();
        assert_eq!(v, json!({ "extension": "clipboard", "palette": "history", "name": "history", "title": "Clipboard", "live": true, "input": false, "ttl": 30.0, "count": 3, "stale": true }));
    }

    #[test]
    fn lazy_palette_waits_for_the_first_show_and_keeps_its_cached_rows() {
        let lazy = PaletteMeta { name: "items".into(), title: "1Password".into(), lazy: true, ..Default::default() };
        // Before the first show: waits, cached rows or not, expired ttl or not.
        assert_eq!(load_plan(&lazy, false, None, 100, false, false), Load::AfterShow, "a first run: nothing cached, still no listing at start");
        assert_eq!(load_plan(&lazy, true, Some(10), 100, false, false), Load::AfterShow, "a restored cache stands until the show");
        let budgeted = PaletteMeta { ttl: Some(60.0), ..lazy.clone() };
        assert_eq!(load_plan(&budgeted, true, Some(10), 100, false, false), Load::AfterShow, "past its ttl: the show, not the after-ready pass");
        assert_eq!(load_plan(&budgeted, true, Some(90), 100, false, false), Load::Fresh, "within its ttl: the cache stands, lazy or not");
        // After the first show it is any other palette: an extension reload lists at once.
        assert_eq!(load_plan(&lazy, false, None, 100, true, true), Load::Now);
        assert_eq!(load_plan(&budgeted, true, Some(10), 100, true, false), Load::AfterReady, "expired at startup once shown: the pass");
        // The other kinds are as before.
        let plain = PaletteMeta { name: "p".into(), title: "P".into(), ..Default::default() };
        assert_eq!(load_plan(&plain, true, Some(10), 100, false, false), Load::Now, "no ttl: listed on every load");
        assert_eq!(load_plan(&PaletteMeta { ttl: Some(60.0), ..plain.clone() }, true, Some(10), 100, false, false), Load::AfterReady);
        assert_eq!(load_plan(&PaletteMeta { input: true, lazy: true, ..plain.clone() }, false, None, 100, false, false), Load::Now, "an input palette's empty bucket costs nothing");
        // The rows a restore put in the index answer a query while the palette waits, flagged stale.
        let mut ix = Index::new();
        let source = Source::new("onepassword", "items");
        ix.restore(source.clone(), vec![row("a", "Bank login", &[]), row("b", "Router", &[])], Some(10), false);
        assert_eq!(load_plan(&lazy, true, Some(10), 100, false, false), Load::AfterShow);
        let hits = ix.query("bank", QueryOpts::default()).hits;
        assert_eq!(hits.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), ["a"]);
        let info = ix.source(&source).unwrap();
        assert!(info.stale, "a listing is pending, the footer says updating");
        assert_eq!(info.len, 2);
        // The meta carries the flag on the wire only when set.
        assert_eq!(serde_json::to_value(&lazy).unwrap()["lazy"], true);
        assert!(serde_json::to_value(&plain).unwrap().get("lazy").is_none());
        let parsed: PaletteMeta = serde_json::from_value(json!({ "name": "x", "title": "X", "live": true, "input": false, "lazy": true })).unwrap();
        assert!(parsed.lazy && parsed.relists_on_show());
    }

    #[test]
    fn live_relist_is_due_unless_just_done_or_within_ttl() {
        let live = PaletteMeta { name: "otp".into(), title: "OTP".into(), live: true, ..Default::default() };
        // No ttl: every show, whatever the rows' age.
        assert!(relist_due(&live, None, None, 100));
        assert!(relist_due(&live, None, Some(10), 100));
        assert!(relist_due(&live, Some(LIVE_RELIST_GAP), Some(100), 100), "the gap is a strict bound");
        // A show relist issued under the gap ago: a double show, skipped.
        assert!(!relist_due(&live, Some(Duration::from_millis(300)), None, 100));
        assert!(!relist_due(&live, Some(LIVE_RELIST_GAP - Duration::from_millis(1)), None, 100));
        // With a ttl: only once the rows are older than it; never-listed rows are due.
        let budgeted = PaletteMeta { ttl: Some(60.0), ..live.clone() };
        assert!(!relist_due(&budgeted, None, Some(100), 160));
        assert!(relist_due(&budgeted, None, Some(100), 161));
        assert!(relist_due(&budgeted, None, None, 161));
        // Both gates hold at once.
        assert!(!relist_due(&budgeted, Some(Duration::from_secs(1)), Some(100), 161));
    }

    fn row(id: &str, name: &str, keywords: &[&str]) -> Item {
        Item { id: id.into(), name: name.into(), subtitle: None, keywords: keywords.iter().map(|k| k.to_string()).collect(), icon: None, section: None, extra: Default::default() }
    }

    /// The root over an index of icon rows (a catalog), one palette row and
    /// one app (primary): the ids in reply order, "N more in X" rows included.
    fn root(q: &str, fre: &Frecency, caps: Option<Caps>) -> Vec<String> {
        let mut ix = Index::new();
        ix.replace(palettes_source(), vec![row("clipboard/history", "Clipboard History", &["history", "clipboard"])]);
        ix.replace(Source::new("iconnerd", "icons"), vec![row("nf-clip", "clipboard", &[]), row("nf-clip2", "clipboard_text", &[]), row("nf-hist", "history", &[]), row("nf-clipper", "clipper_board", &[])]);
        ix.replace(Source::new("apps", "apps"), vec![row("clipper.app", "Clipper", &[])]);
        let tiers = [(Source::new("iconnerd", "icons"), Tier::Catalog), (Source::new("apps", "apps"), Tier::Primary)];
        let tier = root_tier(&tiers);
        let fre_boost = fre.boost(q, SystemTime::now());
        let ranking = Ranking::default();
        let boost = root_boost(q, &ranking, &fre_boost);
        let ranked = ix.query(q, QueryOpts { boost: Some(&boost), tier: Some(&tier), caps, ..Default::default() });
        views(&ix, ranked, &[(Source::new("iconnerd", "icons"), "Nerd Icons".into())]).into_iter().map(|h| h.item.id).collect()
    }

    fn ranked(q: &str, fre: &Frecency) -> Vec<String> {
        root(q, fre, None)
    }

    #[test]
    fn apps_lead_palette_rows_lead_catalogs_on_a_typed_query_but_not_an_exact_name() {
        let mut fre = Frecency::in_memory();
        // The app and the palette row both have the word and are primary; the app's rung on the `root_first` ladder is above the palette row's, so it leads. The icon (a catalog) is under both however short its name.
        assert_eq!(ranked("clip", &fre)[..2], ["clipper.app", "clipboard/history"]);
        assert_eq!(ranked("clipboard", &fre)[0], "clipboard/history", "an exact keyword on the palette row too");
        // A hot icon row (the frecency maximum is 200) still loses to the palette row and to the app.
        let now = SystemTime::now();
        for _ in 0..20 {
            fre.record(&Key::new("iconnerd", "icons", "nf-clip"), now);
        }
        assert_eq!(ranked("clip", &fre)[..3], ["clipper.app", "clipboard/history", "nf-clip"]);
        // An item named what was typed keeps its lead (EXACT_BONUS over the ladder plus a frecency and the tier).
        assert_eq!(ranked("Clipper", &fre)[0], "clipper.app");
        // Both exact (`history` is the palette row's keyword): the palette row's full exact bonus over the catalog's.
        assert_eq!(ranked("history", &fre)[0], "clipboard/history");
        // The empty query is ordered by use, no bonus: the hot icon row leads there.
        assert_eq!(ranked("", &fre)[0], "nf-clip");
        // The sizing the ladder relies on: its top rung plus a hot row stays under an exact name, and under the word bonus on its own.
        let (max_frecency, exact, word) = (pal_core::frecency::MAX_SCORE * pal_core::frecency::BOOST_SCALE, pal_core::index::EXACT_BONUS, pal_core::index::WORD_BONUS);
        let r = Ranking::default();
        let top = r.bonus(&Source::new("browser-tabs", "tabs"));
        assert_eq!((top, r.bonus(&Source::new("windows", "windows")), r.bonus(&Source::new("apps", "apps")), r.bonus(&palettes_source()), r.bonus(&Source::new("files", "files"))), (120.0, 90.0, 60.0, 30.0, 0.0));
        assert!(Tier::Primary.bonus() + word + top + max_frecency < exact);
        assert!(top < word && top < Tier::Primary.bonus(), "a rung never lifts a scattered row over one that has the word, nor a normal row over a primary");
        // Off the ladder, the palette row and the app tie on the bonuses and the shorter name leads.
        let flat = Ranking { first: Vec::new(), ..r };
        assert_eq!(flat.bonus(&Source::new("apps", "apps")), 0.0);
    }

    #[test]
    fn one_row_for_one_thing_across_two_palettes_of_an_extension() {
        let mut ix = Index::new();
        // Today and My Schedule list the same event under the same id; Recent Notes and Notes the same note.
        ix.replace(Source::new("calendar", "schedule"), vec![row("standup@1", "Standup", &[]), row("dentist@1", "Dentist", &[])]);
        ix.replace(Source::new("calendar", "today"), vec![row("standup@1", "Standup", &[])]);
        ix.replace(Source::new("obsidian", "recent"), vec![row("note:a.md", "Standup notes", &[])]);
        ix.replace(Source::new("obsidian", "notes"), vec![row("note:a.md", "Standup notes", &[]), row("note:b.md", "Standup agenda", &[])]);
        // Another extension's row with the same id is another thing.
        ix.replace(Source::new("other", "p"), vec![row("standup@1", "Standup (other)", &[])]);
        let ranked = ix.query("standup", QueryOpts::default());
        let all = views(&ix, ranked, &[]);
        let keys = |hits: &[HitView]| hits.iter().map(|h| format!("{}/{}:{}", h.hit.source.extension, h.hit.source.palette, h.hit.id)).collect::<Vec<_>>();
        assert_eq!(all.iter().filter(|h| h.hit.id == "standup@1" && h.hit.source.extension == "calendar").count(), 2, "the index answers both");
        let once = dedupe_across_palettes(all);
        let k = keys(&once);
        assert_eq!(k.iter().filter(|k| k.starts_with("calendar/") && k.ends_with(":standup@1")).count(), 1);
        assert_eq!(k.iter().filter(|k| k.starts_with("obsidian/") && k.ends_with(":note:a.md")).count(), 1);
        assert!(k.contains(&"other/p:standup@1".to_string()), "another extension's id is not the same thing");
        assert!(k.contains(&"obsidian/notes:note:b.md".to_string()));
        // The kept copy is the first: the better-ranked section's.
        let first_calendar = once.iter().find(|h| h.hit.source.extension == "calendar" && h.hit.id == "standup@1").unwrap();
        assert_eq!(first_calendar.hit.source.palette, "schedule", "sections come in the order of their best hit; equal scores keep insertion order");
        // "more" rows share one id across sources and are never folded.
        let more = vec![more_row(&Source::new("a", "x"), "X", 2), more_row(&Source::new("a", "y"), "Y", 3)];
        assert_eq!(dedupe_across_palettes(more).len(), 2);
    }

    #[test]
    fn capped_sections_end_in_a_more_row() {
        let fre = Frecency::in_memory();
        let caps = Some(Caps { primary: 8, normal: 6, catalog: 2 });
        // Three icons match `clip`, all with the word; the catalog cap shows two, then the row into the palette, after the app and the palette row.
        assert_eq!(root("clip", &fre, caps), ["clipper.app", "clipboard/history", "nf-clip", "nf-clipper", MORE_ID]);
        assert_eq!(root("clip", &fre, None).len(), 5, "uncapped: everything");
        assert_eq!(root("", &fre, caps).len(), 6, "the empty query is never capped");
        let m = more_row(&Source::new("iconnerd", "icons"), "Nerd Icons", 12);
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["id"], MORE_ID);
        assert_eq!(v["source"], json!({ "extension": "iconnerd", "palette": "icons" }));
        assert_eq!(v["item"]["name"], "12 more in Nerd Icons");
        assert_eq!(v["item"]["more"], true, "the UI mutes it by this");
        assert!(v["name_positions"].as_array().unwrap().is_empty());
    }

    #[test]
    fn root_tiers_come_from_the_registry_and_the_palette_rows_are_primary() {
        let tiers = [(Source::new("emoji", "emoji"), Tier::Catalog)];
        let tier = root_tier(&tiers);
        assert_eq!(tier(&Source::new("emoji", "emoji")), Tier::Catalog);
        assert_eq!(tier(&Source::new("docker", "docker")), Tier::Normal, "unregistered: normal");
        assert_eq!(tier(&palettes_source()), Tier::Primary);
        assert_eq!(tier(&commands::source()), Tier::Primary, "pal's own commands too");
    }

    #[test]
    fn frequent_rows_lead_the_empty_root_and_leave_their_sections() {
        let mut ix = Index::new();
        ix.replace(palettes_source(), vec![row("apps/apps", "Applications", &[])]);
        ix.replace(commands::source(), vec![row("settings", "Settings", &[])]);
        ix.replace(Source::new("apps", "apps"), vec![row("a", "A", &[]), row("b", "B", &[]), row("c", "C", &[])]);
        ix.replace(Source::new("emoji", "emoji"), vec![row("smile", "smile", &[])]);
        let mut fre = Frecency::in_memory();
        let now = SystemTime::now();
        // Palette rows and pal's commands are picked too, but never Frequent rows; a gone item (no row) is skipped.
        for (key, n) in [(Key::new("apps", "apps", "b"), 5), (Key::new("pal", "palettes", "apps/apps"), 9), (Key::new("pal", "commands", "settings"), 9), (Key::new("emoji", "emoji", "smile"), 2), (Key::new("apps", "apps", "gone"), 7)] {
            for _ in 0..n {
                fre.record(&key, now);
            }
        }
        let f = frequent(&ix, &fre, now);
        assert_eq!(f.iter().map(|h| h.hit.id.as_str()).collect::<Vec<_>>(), ["b", "smile"], "by frecency, indexed rows of real palettes only");
        assert!(f.iter().all(|h| h.group.as_deref() == Some(FREQUENT) && h.hit.name_positions.is_empty()));
        let v = serde_json::to_value(&f[0]).unwrap();
        assert_eq!(v["group"], FREQUENT);
        assert_eq!(v["item"]["name"], "B");
        // The rest of the empty root without them.
        let all: Vec<HitView> = ix.query("", QueryOpts::default()).hits.into_iter().map(|h| HitView::new(h.clone(), ix.get(&h.source, &h.id).cloned().unwrap())).collect();
        let rest = dedupe(all, &f);
        assert_eq!(rest.iter().map(|h| h.hit.id.as_str()).collect::<Vec<_>>(), ["apps/apps", "settings", "a", "c"]);
        // A capped store: at most FREQUENT_MAX rows.
        for i in 0..20 {
            ix.extend(Source::new("apps", "apps"), vec![row(&format!("x{i}"), "X", &[])]);
            fre.record(&Key::new("apps", "apps", format!("x{i}")), now);
        }
        assert_eq!(frequent(&ix, &fre, now).len(), FREQUENT_MAX);
        assert!(serde_json::to_value(HitView::new(Hit { source: Source::new("e", "p"), id: "a".into(), score: 0.0, name_positions: vec![] }, row("a", "A", &[]))).unwrap().get("group").is_none(), "no group unless set");
    }

    #[test]
    fn hit_view_is_the_hit_beside_its_item() {
        let item: Item = serde_json::from_value(json!({ "id": "a", "name": "A", "exec": "x" })).unwrap();
        let hit = Hit { source: Source::new("e", "p"), id: "a".into(), score: 1.5, name_positions: vec![0] };
        let v = serde_json::to_value(HitView::new(hit, item)).unwrap();
        assert_eq!(v["source"], json!({ "extension": "e", "palette": "p" }));
        assert_eq!(v["id"], "a");
        assert_eq!(v["name_positions"], json!([0]));
        assert_eq!(v["item"]["exec"], "x", "the item's extra fields ride along");
    }
}
