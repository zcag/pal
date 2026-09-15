//! The clipboard capability: `pal_core::clipboard` opened at startup and
//! watching, served to extensions over the bridge (`clipboard.list` and the
//! rest), to the webview as `icon://localhost/clip` images, and to a pick
//! as the `paste` effect. Every recorded copy is a `pal://clipboard` event.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use pal_core::clipboard::{self as cb, Clipboard, Kind, Retention, WatchHandle};
use pal_core::config::ConfigFile;
use pal_core::icons;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// Copies made while these are frontmost are never recorded (Raycast's
/// default list), on top of the concealed-type convention the core honours.
const DEFAULT_EXCLUDE: [&str; 2] = ["com.apple.keychainaccess", "com.apple.Passwords"];

pub struct State {
    store: Clipboard,
    _watch: WatchHandle,
}

/// `[extensions.clipboard]` in the config file, the free-form table every
/// extension gets. Missing keys are the core's defaults.
#[derive(Default, Deserialize)]
#[serde(default)]
struct Settings {
    exclude_apps: Option<Vec<String>>,
    max_entries: Option<usize>,
    max_age_days: Option<u64>,
}

pub fn install(app: &AppHandle) {
    let settings: Settings = ConfigFile::locate()
        .load()
        .config
        .extensions
        .get("clipboard")
        .and_then(|t| t.clone().try_into().ok())
        .unwrap_or_default();
    let mut retention = Retention::default();
    if let Some(n) = settings.max_entries {
        retention.max_entries = n;
    }
    if let Some(d) = settings.max_age_days {
        retention.max_age = std::time::Duration::from_secs(d * 24 * 3600);
    }
    let store = match Clipboard::open_at(&cb::default_dir(), retention) {
        Ok(s) => s,
        Err(e) => return eprintln!("clipboard\topen failed\t{e}"),
    };
    let exclude = settings.exclude_apps.unwrap_or_else(|| DEFAULT_EXCLUDE.iter().map(|s| s.to_string()).collect());
    let handle = app.clone();
    let watch = store.start_watching(exclude, move |e| {
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

// ---- paste effect --------------------------------------------------------

/// `{ entry: id }` from history, or `{ text }` straight from the extension.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum Paste {
    Entry { entry: i64 },
    Text { text: String },
}

/// Whether a paste can be delivered; when not, the system prompt once per
/// run, and the toast the pick should show instead.
pub fn paste_blocked() -> Option<Value> {
    static ASKED: AtomicBool = AtomicBool::new(false);
    if cb::accessibility_trusted() {
        return None;
    }
    if !ASKED.swap(true, Ordering::Relaxed) {
        cb::request_accessibility();
    }
    Some(json!({ "toast": { "title": "Paste needs Accessibility", "message": "Grant pal in System Settings > Privacy & Security > Accessibility", "style": "failure" } }))
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
