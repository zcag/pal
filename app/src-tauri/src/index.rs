//! The host's items in the Rust index: every palette is listed into
//! `pal_core::index::Index` as the host reports it loaded, keystrokes are
//! answered from there with frecency applied, and a pick goes to the host
//! then into the frecency store.

use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

use pal_core::frecency::{Frecency, Key};
use pal_core::index::{Hit, Index, Item, QueryOpts, Source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::host::Host;

const DEFAULT_LIMIT: usize = 200;

/// A palette as the host describes it (`PaletteMeta` in host/protocol.ts).
#[derive(Debug, Clone, Deserialize)]
pub struct PaletteMeta {
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub live: bool,
}

/// Titles by source, in load order. The index holds the items and the
/// `live` flag; this is the rest of what the host said about a palette.
#[derive(Default)]
pub struct Palettes(Mutex<Vec<Registered>>);

#[derive(Clone)]
struct Registered {
    source: Source,
    title: String,
}

pub fn install(app: &AppHandle) {
    app.manage(Mutex::new(Index::new()));
    app.manage(Mutex::new(Frecency::open()));
    app.manage(Palettes::default());
}

/// Runs `f` with the index locked; the registry is locked the same way
/// through `Palettes::with`. Neither is held across an await.
fn with_index<T>(app: &AppHandle, f: impl FnOnce(&mut Index) -> T) -> T {
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
}

// ---- host notifications --------------------------------------------------

/// Called on the host's reader task for every notification.
pub fn on_notification(app: &AppHandle, host: &Arc<Host>, method: &str, params: &Value) {
    match method {
        "extension/loaded" => {
            let ext = params["extension"].as_str().unwrap_or_default().to_string();
            let Ok(metas) = serde_json::from_value::<Vec<PaletteMeta>>(params["palettes"].clone()) else { return };
            tauri::async_runtime::spawn(sync_extension(app.clone(), host.clone(), ext, metas));
        }
        "extension/error" => {
            let ext = params["extension"].as_str().unwrap_or_default();
            remove_extension(app, ext);
        }
        // The host is up: drop sources whose extension it no longer has
        // (deleted while it was down), so a restart cannot leave strays.
        "host/ready" => {
            let live: Vec<String> = serde_json::from_value(params["extensions"].clone()).unwrap_or_default();
            let stale: Vec<String> = Palettes::with(app, |reg| {
                reg.iter().map(|r| r.source.extension.clone()).filter(|e| !live.contains(e)).collect()
            });
            for ext in stale {
                remove_extension(app, &ext);
            }
        }
        _ => {}
    }
}

async fn sync_extension(app: AppHandle, host: Arc<Host>, ext: String, metas: Vec<PaletteMeta>) {
    Palettes::with(&app, |reg| {
        reg.retain(|r| r.source.extension != ext);
        reg.extend(metas.iter().map(|m| Registered { source: Source::new(&ext, &m.name), title: m.title.clone() }));
    });
    for m in metas {
        let source = Source::new(&ext, &m.name);
        let t0 = Instant::now();
        let params = json!({ "extension": ext, "palette": m.name });
        let items = match host.request("list", params).await {
            Ok(v) => serde_json::from_value::<Vec<Item>>(v["items"].clone()).unwrap_or_else(|e| {
                eprintln!("index\t{ext}/{}\tbad items\t{e}", m.name);
                Vec::new()
            }),
            Err(e) => {
                eprintln!("index\t{ext}/{}\tlist failed\t{e}", m.name);
                continue;
            }
        };
        let n = items.len();
        with_index(&app, |ix| {
            ix.set_live(source.clone(), m.live);
            ix.replace(source, items);
        });
        eprintln!("index\t{ext}/{}\t{n} items\t{:.1}ms\t{:.1}ms since host spawn", m.name, t0.elapsed().as_secs_f64() * 1000.0, host.uptime_ms());
        let _ = app.emit("pal://index", ());
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

#[derive(Serialize)]
pub struct SourceView {
    extension: String,
    palette: String,
    title: String,
    live: bool,
    count: usize,
}

/// Off the main thread: the scan is well under a millisecond, but a
/// `replace` holding the lock must never stall a paint.
#[tauri::command(async)]
pub fn query(
    q: String,
    limit: Option<usize>,
    sources: Option<Vec<Source>>,
    index: State<'_, Mutex<Index>>,
    frecency: State<'_, Mutex<Frecency>>,
) -> Vec<HitView> {
    let fre = frecency.lock().unwrap();
    let boost = fre.boost(&q, SystemTime::now());
    let mut ix = index.lock().unwrap();
    let opts = QueryOpts { limit: limit.unwrap_or(DEFAULT_LIMIT), sources: sources.as_deref(), boost: Some(&boost) };
    ix.query(&q, opts)
        .into_iter()
        .map(|hit| HitView { item: ix.get(&hit.source, &hit.id).cloned().expect("hit names an indexed item"), hit })
        .collect()
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
            title: reg.iter().find(|r| r.source == s.source).map_or_else(|| s.source.palette.clone(), |r| r.title.clone()),
            extension: s.source.extension,
            palette: s.source.palette,
            live: s.live,
            count: s.len,
        })
        .collect()
}

/// Runs the item through the host, then remembers the pick and the query
/// that led to it. Returns the host's envelope as is.
#[tauri::command]
pub async fn pick(
    source: Source,
    id: String,
    action: Option<String>,
    query: String,
    host: State<'_, Arc<Host>>,
    frecency: State<'_, Mutex<Frecency>>,
) -> Result<Value, String> {
    let params = json!({ "extension": source.extension, "palette": source.palette, "id": id, "action": action });
    let t0 = Instant::now();
    let r = host.request("pick", params).await?;
    eprintln!("pick\t{}/{}\t{id}\t{:.1}ms", source.extension, source.palette, t0.elapsed().as_secs_f64() * 1000.0);
    let key = Key::from_source(&source, id);
    let mut fre = frecency.lock().unwrap();
    fre.record(&key, SystemTime::now());
    fre.record_query(&key, &query);
    Ok(r)
}
