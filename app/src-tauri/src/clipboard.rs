//! The clipboard capability: `pal_core::clipboard` opened at startup and
//! watching, served to extensions over the bridge (`clipboard.list` and the
//! rest), to the webview as `icon://localhost/clip` images, and to a pick
//! as the `paste` effect. Every recorded copy is a `pal://clipboard` event.

use std::path::PathBuf;
use std::time::Duration;

use pal_core::clipboard::{self as cb, Clipboard, Kind, Retention, WatchHandle};
use pal_core::icons;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::{events, settings};

pub struct State {
    store: Clipboard,
    _watch: WatchHandle,
}

/// `[features.clipboard]` (`core/features/clipboard.json`). Read once at
/// startup: retention and the exclude list are fixed for the run.
#[derive(Deserialize)]
struct Settings {
    exclude_apps: Vec<String>,
    max_entries: usize,
    max_age_days: u64,
}

fn settings(app: &AppHandle) -> Settings {
    settings::config(app).feature("clipboard")
}

pub fn install(app: &AppHandle) {
    let settings = settings(app);
    // The manifest says `min: 1`; a hand-written 0 would empty the history on the next copy.
    let store = match Clipboard::open_at(&cb::default_dir(), Retention::days(settings.max_entries.max(1), settings.max_age_days)) {
        Ok(s) => s,
        Err(e) => return eprintln!("clipboard\topen failed\t{e}"),
    };
    store.hide_apps(settings.exclude_apps.clone());
    let handle = app.clone();
    let watch = store.start_watching(settings.exclude_apps, move |e| {
        events::emit(&handle, events::CLIPBOARD, json!({ "id": e.id, "kind": e.kind }));
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
    /// `rename`: the name, `null` or blank to clear it.
    #[serde(default)]
    name: Option<String>,
}

fn arg<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("bad params: {e}"))
}

/// `clipboard.<func>` over the bridge (on a blocking thread, `host::serve`);
/// results are the core's `Entry` as is.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let store = store(app)?;
    match func {
        "list" => {
            let p: ListParams = arg(params)?;
            let rows = store.list(&p.query, p.kind, p.limit.unwrap_or(100), p.offset.unwrap_or(0)).map_err(err)?;
            serde_json::to_value(rows).map_err(|e| e.to_string())
        }
        "get" => {
            let p: IdParams = arg(params)?;
            serde_json::to_value(store.get(p.id).map_err(err)?).map_err(|e| e.to_string())
        }
        "pin" => {
            let p: IdParams = arg(params)?;
            store.pin(p.id, p.pinned).map_err(err).map(|_| Value::Null)
        }
        "rename" => {
            let p: IdParams = arg(params)?;
            store.rename(p.id, p.name.as_deref()).map_err(err).map(|_| Value::Null)
        }
        "delete" => {
            let p: IdParams = arg(params)?;
            store.delete(p.id).map_err(err).map(|_| Value::Null)
        }
        "clear" => store.clear().map_err(err).map(|_| Value::Null),
        // What is on the clipboard now, as history recorded it (`null` when history has no entry for it).
        "current" => serde_json::to_value(store.current().map_err(err)?).map_err(|e| e.to_string()),
        "copy" => {
            let p: IdParams = arg(params)?;
            store.copy(p.id).map_err(err).map(|_| Value::Null)
        }
        _ => Err(format!("unknown clipboard.{func}")),
    }
}

// ---- copy and paste effects ----------------------------------------------

/// The `copy` effect's payload: a string, or `{ text, concealed?,
/// clear_after? }` (protocol.ts `CopyText`). Concealed: marked for
/// clipboard managers to skip and kept out of pal's history; with
/// `clear_after` seconds the previous clipboard comes back once they are
/// up, if the secret is still there.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum Copy {
    Text(String),
    Options {
        text: String,
        #[serde(default)]
        concealed: bool,
        #[serde(default)]
        clear_after: Option<u64>,
    },
}

impl Copy {
    /// The clear delay, on a concealed copy that asked for one (0 is none).
    pub fn clear_after(&self) -> Option<Duration> {
        match self {
            Copy::Options { concealed: true, clear_after: Some(s), .. } if *s > 0 => Some(Duration::from_secs(*s)),
            _ => None,
        }
    }
}

/// The `copy` effect: a plain copy goes through the core's writer, so the
/// watcher records it like any other; a concealed one through the marked
/// write the watcher skips.
pub fn copy(what: Copy) -> Result<(), String> {
    match (&what, what.clear_after()) {
        (Copy::Text(text), _) | (Copy::Options { text, concealed: false, .. }, _) => cb::write_text(text).map_err(err),
        (Copy::Options { text, .. }, Some(delay)) => cb::write_text_concealed_for(text, delay).map_err(err),
        (Copy::Options { text, .. }, None) => cb::write_text_concealed(text).map_err(err),
    }
}

/// The `copy_files` effect: the files themselves (file URLs on macOS,
/// `text/uri-list` on Linux), so a paste in Finder or a file manager
/// copies them and a paste in a text field gets their paths.
pub fn copy_files(paths: Vec<PathBuf>) -> Result<(), String> {
    cb::write_files(paths).map_err(err)
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
    let store = store(app).map_err(|e| eprintln!("clipboard\timage failed\t{id}: {e}")).ok()?;
    let path = store.get(id).map_err(|e| eprintln!("clipboard\timage failed\t{id}: {e}")).ok()?.image?;
    if size == 0 {
        return Some(path);
    }
    icons::thumbnail(&path, size).map_err(|e| eprintln!("clipboard\tthumbnail failed\t{id}: {e}")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_envelope_shapes() {
        assert!(matches!(serde_json::from_value::<Paste>(json!({ "entry": 7 })), Ok(Paste::Entry { entry: 7 })));
        assert!(matches!(serde_json::from_value::<Paste>(json!({ "text": "hi" })), Ok(Paste::Text { text }) if text == "hi"));
        assert!(serde_json::from_value::<Paste>(json!(true)).is_err());
        assert!(serde_json::from_value::<Paste>(json!({ "entry": "7" })).is_err(), "an id is a number");
    }

    #[test]
    fn copy_envelope_shapes() {
        let c: Copy = serde_json::from_value(json!("hi")).unwrap();
        assert!(matches!(c, Copy::Text(ref t) if t == "hi") && c.clear_after().is_none());
        let c: Copy = serde_json::from_value(json!({ "text": "s", "concealed": true, "clear_after": 30 })).unwrap();
        assert_eq!(c.clear_after(), Some(Duration::from_secs(30)));
        let c: Copy = serde_json::from_value(json!({ "text": "s", "concealed": true, "clear_after": 0 })).unwrap();
        assert_eq!(c.clear_after(), None, "0 is never");
        let c: Copy = serde_json::from_value(json!({ "text": "s", "clear_after": 30 })).unwrap();
        assert_eq!(c.clear_after(), None, "a plain copy does not clear");
        assert!(serde_json::from_value::<Copy>(json!({ "concealed": true })).is_err(), "text is required");
        assert!(serde_json::from_value::<Copy>(json!(7)).is_err());
    }

    #[test]
    fn manifest_defaults_fit_the_recorder() {
        let s: Settings = pal_core::config::Config::default().feature("clipboard");
        assert!(s.max_entries >= 1 && s.max_age_days >= 1);
        assert!(!s.exclude_apps.is_empty(), "password managers are excluded by default");
    }
}
