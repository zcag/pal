//! The dialog jump: `pal_core::dialog` for the bridge and the page.
//! `core/dialog.current` (the files extension asks it per listing, so its
//! rows can lead with "Use in dialog") and the `dialog_detect` command (the
//! root's hint section) share one detection per show: `on_shown` bumps a
//! sequence, the first caller after it pays the AX read (~70 ms on hornet,
//! off the main thread), the rest read the cache. Typing the path is the
//! `dialog` effect in effects.rs.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use pal_core::dialog::{self, Dialog};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::lock;

static SHOWN: AtomicU64 = AtomicU64::new(1);
static CACHE: Mutex<Option<(u64, Option<Dialog>)>> = Mutex::new(None);

/// The panel is showing again: the app in front may have changed.
pub fn on_shown() {
    SHOWN.fetch_add(1, Ordering::Relaxed);
}

/// The open or save panel in front, detected once per show.
pub fn current() -> Option<Dialog> {
    let seq = SHOWN.load(Ordering::Relaxed);
    let mut cache = lock(&CACHE);
    if let Some((at, d)) = cache.as_ref() {
        if *at == seq {
            return d.clone();
        }
    }
    let t0 = std::time::Instant::now();
    let d = dialog::detect();
    if let Some(d) = &d {
        eprintln!("dialog	{} {} panel	{:.1}ms", d.app, d.kind.name(), t0.elapsed().as_secs_f64() * 1000.0);
    }
    *cache = Some((seq, d.clone()));
    d
}

/// The page's ask on a show of the empty root: the panel, or null.
#[tauri::command]
pub async fn dialog_detect() -> Option<Dialog> {
    tauri::async_runtime::spawn_blocking(current).await.ok().flatten()
}

pub fn call(_app: &AppHandle, func: &str, _params: Value) -> Result<Value, String> {
    match func {
        "current" => Ok(json!(current())),
        _ => Err(format!("unknown dialog.{func}")),
    }
}
