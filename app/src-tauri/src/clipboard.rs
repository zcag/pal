//! The clipboard capability: `pal_core::clipboard` opened at startup and
//! watching, served to extensions over the bridge (`clipboard.list` and the
//! rest), to the webview as `icon://localhost/clip` images, and to a pick
//! as the `paste` effect. Every recorded copy is a `pal://clipboard` event.

use std::path::PathBuf;

use pal_core::clipboard::{self as cb, Clipboard, Kind, Retention, WatchHandle};
use pal_core::config::{spec_defaults, ConfigFile};
use pal_core::icons;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// The extension's manifest, compiled in: its `settings` defaults are the
/// recorder's too, so a key absent from the file means what the settings
/// view shows for it.
const MANIFEST: &str = include_str!("../../../extensions/clipboard/pal.json");

pub struct State {
    store: Clipboard,
    _watch: WatchHandle,
}

/// `[extensions.clipboard]` over the manifest's defaults, the same values
/// the extension gets. Read once at startup: retention and the exclude
/// list are fixed for the run.
#[derive(Deserialize)]
struct Settings {
    exclude_apps: Vec<String>,
    max_entries: usize,
    max_age_days: u64,
}

/// A value of the wrong type in the file (`max_entries = "many"`) is logged
/// and the manifest's defaults stand in.
fn settings() -> Settings {
    let manifest: Value = serde_json::from_str(MANIFEST).expect("bundled pal.json parses");
    let defaults = spec_defaults(&manifest["settings"]);
    let table = ConfigFile::locate().load().config.extension_settings("clipboard", &defaults);
    table.try_into().unwrap_or_else(|e| {
        eprintln!("clipboard\tsettings\t{e}");
        defaults.try_into().expect("manifest defaults fit Settings")
    })
}

pub fn install(app: &AppHandle) {
    let settings = settings();
    // The manifest says `min: 1`; a hand-written 0 would empty the history on the next copy.
    let store = match Clipboard::open_at(&cb::default_dir(), Retention::days(settings.max_entries.max(1), settings.max_age_days)) {
        Ok(s) => s,
        Err(e) => return eprintln!("clipboard\topen failed\t{e}"),
    };
    let handle = app.clone();
    let watch = store.start_watching(settings.exclude_apps, move |e| {
        let _ = handle.emit("pal://clipboard", json!({ "id": e.id, "kind": e.kind }));
    });
    app.manage(State { store, _watch: watch });
}

fn store(app: &AppHandle) -> Result<Clipboard, String> {
    app.try_state::<State>().map(|s| s.store.clone()).ok_or_else(|| "clipboard unavailable".to_string())
}

fn err(e: cb::Error) -> String {
    e.to_string()
}

#[derive(Deserialize)]
struct ListParams {
    #[serde(default)]
    query: String,
    kind: Option<Kind>,
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Deserialize)]
struct IdParams {
    id: i64,
    #[serde(default)]
    pinned: bool,
}

/// `clipboard.<func>` over the bridge; results are the core's `Entry` as is.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let store = store(app)?;
    fn arg<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
        serde_json::from_value(v).map_err(|e| format!("bad params: {e}"))
    }
    match func {
        "list" => {
            let p: ListParams = arg(params)?;
            let rows = store.list(&p.query, p.kind, p.limit.unwrap_or(100), p.offset.unwrap_or(0)).map_err(err)?;
            Ok(serde_json::to_value(rows).unwrap())
        }
        "get" => {
            let p: IdParams = arg(params)?;
            Ok(serde_json::to_value(store.get(p.id).map_err(err)?).unwrap())
        }
        "pin" => {
            let p: IdParams = arg(params)?;
            store.pin(p.id, p.pinned).map_err(err).map(|_| Value::Null)
        }
        "delete" => {
            let p: IdParams = arg(params)?;
            store.delete(p.id).map_err(err).map(|_| Value::Null)
        }
        "clear" => store.clear().map_err(err).map(|_| Value::Null),
        "copy" => {
            let p: IdParams = arg(params)?;
            store.copy(p.id).map_err(err).map(|_| Value::Null)
        }
        _ => Err(format!("unknown clipboard.{func}")),
    }
}

// ---- copy and paste effects ----------------------------------------------

/// The `copy` effect: through the core's writer, so the watcher records it
/// like any other copy.
pub fn copy_text(text: &str) -> Result<(), String> {
    cb::write_text(text).map_err(err)
}

/// `{ entry: id }` from history, or `{ text }` straight from the extension.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum Paste {
    Entry { entry: i64 },
    Text { text: String },
}

/// Into the frontmost app; the caller has hidden the panel.
pub fn paste(app: &AppHandle, what: Paste) -> Result<(), String> {
    match what {
        Paste::Entry { entry } => store(app)?.paste(entry).map_err(err),
        Paste::Text { text } => cb::paste_text(&text).map_err(err),
    }
}

// ---- images --------------------------------------------------------------

/// The entry's PNG: the file itself for `size` 0, else a fitted thumbnail.
pub fn image(app: &AppHandle, id: i64, size: u32) -> Option<PathBuf> {
    let store = store(app).map_err(|e| eprintln!("clipboard\timage {id}\t{e}")).ok()?;
    let path = store.get(id).map_err(|e| eprintln!("clipboard\timage {id}\t{e}")).ok()?.image?;
    if size == 0 {
        return Some(path);
    }
    icons::thumbnail(&path, size).map_err(|e| eprintln!("clipboard\tthumbnail {id}\t{e}")).ok()
}
