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

use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime};

use pal_core::config::Config;
use pal_core::frecency::{Frecency, Key};
use pal_core::index::{Hit, Index, Item, QueryOpts, Source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::host::Host;
use crate::{effects, hotkey, settings};

const DEFAULT_LIMIT: usize = 200;

/// A palette as the host describes it (`PaletteMeta` in host/protocol.ts).
/// The optional fields ride to the UI untouched through `SourceView`.
#[derive(Debug, Clone, Deserialize, Serialize)]
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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub detail: bool,
}

/// Metas by source, in load order. The index holds the items and the
/// `live` flag; this is the rest of what the host said about a palette.
#[derive(Default)]
pub struct Palettes(Mutex<Vec<Registered>>);

#[derive(Clone)]
struct Registered {
    source: Source,
    meta: PaletteMeta,
    /// `palettes.<id>.enabled` as last applied; off means no items, no row.
    enabled: bool,
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
        subtitle: None,
        keywords,
        icon: p.icon.clone().or_else(|| m.icon.clone()).map(Value::String),
        section: None,
        extra: Default::default(),
    }
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

/// Called on the host's reader task for every notification. The settings
/// registry (`settings::Extensions`) learns about every extension here too,
/// loaded or not, so the settings window can show one whose code failed.
pub fn on_notification(app: &AppHandle, host: &Arc<Host>, method: &str, params: &Value) {
    match method {
        "extension/loaded" => {
            let ext = params["extension"].as_str().unwrap_or_default().to_string();
            let Ok(metas) = serde_json::from_value::<Vec<PaletteMeta>>(params["palettes"].clone()) else { return };
            settings::register(app, &ext, params, true);
            tauri::async_runtime::spawn(sync_extension(app.clone(), host.clone(), ext, metas));
        }
        "extension/error" => {
            let ext = params["extension"].as_str().unwrap_or_default();
            settings::register(app, ext, params, false);
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
            settings::retain(app, &live);
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

async fn sync_extension(app: AppHandle, host: Arc<Host>, ext: String, metas: Vec<PaletteMeta>) {
    let config = settings::config(&app);
    Palettes::with(&app, |reg| {
        reg.retain(|r| r.source.extension != ext);
        reg.extend(metas.iter().map(|m| {
            let source = Source::new(&ext, &m.name);
            let enabled = config.palette(&palette_id(&source)).enabled;
            Registered { source, meta: m.clone(), enabled }
        }));
    });
    sync_palette_rows(&app);
    hotkey::apply(&app, &config);
    for m in metas {
        let source = Source::new(&ext, &m.name);
        if config.palette(&palette_id(&source)).enabled {
            list_palette(&app, &host, &source, &m).await;
        }
    }
}

/// Asks the host for the palette's items and puts them in the index. An
/// input palette is in the index as an empty source: `sources` lists it, a
/// root query never finds its rows.
async fn list_palette(app: &AppHandle, host: &Arc<Host>, source: &Source, m: &PaletteMeta) {
    let t0 = Instant::now();
    let params = json!({ "extension": source.extension, "palette": source.palette });
    let items = if m.input {
        Vec::new()
    } else {
        match host.request("list", params).await {
            Ok(v) => serde_json::from_value::<Vec<Item>>(v["items"].clone()).unwrap_or_else(|e| {
                eprintln!("index\t{}/{}\tbad items\t{e}", source.extension, source.palette);
                Vec::new()
            }),
            Err(e) => {
                eprintln!("index\t{}/{}\tlist failed\t{e}", source.extension, source.palette);
                return;
            }
        }
    };
    let n = items.len();
    with_index(app, |ix| {
        ix.set_live(source.clone(), m.live);
        ix.replace(source.clone(), items);
    });
    eprintln!("index\t{}/{}\t{n} items\t{:.1}ms\t{:.1}ms since host spawn", source.extension, source.palette, t0.elapsed().as_secs_f64() * 1000.0, host.uptime_ms());
    let _ = app.emit("pal://index", ());
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
        list_palette(&app, &host, &source, &meta).await;
    }
    let relist: Vec<(Source, PaletteMeta)> = Palettes::with(&app, |reg| {
        reg.iter().filter(|r| r.enabled && changed.contains(&r.source.extension)).map(|r| (r.source.clone(), r.meta.clone())).collect()
    });
    for (source, meta) in relist {
        list_palette(&app, &host, &source, &meta).await;
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

/// One source for the UI: the meta as the host gave it, plus the count.
#[derive(Serialize)]
pub struct SourceView {
    extension: String,
    palette: String,
    #[serde(flatten)]
    meta: PaletteMeta,
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
    let palettes_meta = PaletteMeta { name: "palettes".into(), title: "Palettes".into(), live: false, input: false, icon: None, view: None, columns: None, placeholder: None, detail: false };
    index
        .lock()
        .unwrap()
        .sources()
        .into_iter()
        .map(|s| SourceView {
            meta: reg.iter().find(|r| r.source == s.source).map_or_else(|| palettes_meta.clone(), |r| r.meta.clone()),
            extension: s.source.extension,
            palette: s.source.palette,
            count: s.len,
        })
        .collect()
}

/// Runs the item through the host and its effects here (`copy`, `open`,
/// `paste`), then remembers the pick and the query that led to it. Returns
/// the host's envelope, as `effects::apply` left it. A palette row is the
/// UI's to push: only remembered.
#[tauri::command]
pub async fn pick(
    app: AppHandle,
    source: Source,
    id: String,
    action: Option<String>,
    query: String,
    host: State<'_, Arc<Host>>,
    frecency: State<'_, Mutex<Frecency>>,
) -> Result<Value, String> {
    let r = if source == palettes_source() {
        json!({ "keep": true })
    } else {
        let params = json!({ "extension": source.extension, "palette": source.palette, "id": id, "action": action });
        let t0 = Instant::now();
        let r = host.request("pick", params).await?;
        eprintln!("pick\t{}/{}\t{id}\t{:.1}ms", source.extension, source.palette, t0.elapsed().as_secs_f64() * 1000.0);
        effects::apply(&app, r).await?
    };
    // Live and input palettes carry transient ids (a clipboard entry, a calc
    // result); remembering those would only fill the store with junk.
    if !app.state::<Palettes>().is_transient(&source) {
        let key = Key::from_source(&source, id);
        let mut fre = frecency.lock().unwrap();
        fre.record(&key, SystemTime::now());
        fre.record_query(&key, &query);
    }
    Ok(r)
}
