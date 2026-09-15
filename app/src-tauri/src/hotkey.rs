//! The global hotkey: `general.hotkey` from the config file, swapped live
//! when the file changes; empty means none (a compositor keybind runs
//! `pal-app toggle` instead). On Linux this only reaches X11 clients (the
//! global-hotkey crate is X11-only); Wayland goes through `pal-app toggle`.
//! The plugin hops to the main thread itself, so `apply` may run on the
//! watcher's thread.

use std::sync::Mutex;

use pal_core::config::{ConfigFile, Watcher};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

const FALLBACK: &str = "ctrl+space";

struct Registered(Mutex<Option<Shortcut>>);
/// Dropping the watcher stops it, so the app owns it.
struct Watch(#[allow(dead_code)] Watcher);

pub fn install(app: &AppHandle) {
    let file = ConfigFile::locate();
    app.manage(Registered(Mutex::new(None)));
    apply(app, &file.load().config.general.hotkey);
    let handle = app.clone();
    match file.watch(move |loaded| apply(&handle, &loaded.config.general.hotkey)) {
        Ok(w) => {
            app.manage(Watch(w));
        }
        Err(e) => eprintln!("hotkey\twatch failed\t{e}"),
    }
}

/// `None` for an empty setting; a string that does not parse falls back
/// rather than leaving pal unreachable.
fn parse(s: &str) -> Option<Shortcut> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.parse().unwrap_or_else(|e| {
        eprintln!("hotkey\t{s:?}: {e}; using {FALLBACK}");
        FALLBACK.parse().expect("FALLBACK parses")
    }))
}

fn apply(app: &AppHandle, wanted: &str) {
    let next = parse(wanted);
    let registered = app.state::<Registered>();
    let mut current = registered.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if *current == next {
        return;
    }
    let shortcuts = app.global_shortcut();
    // Register the new one first: if another app holds it, the old one
    // stays and pal remains reachable.
    if let Some(next) = next {
        if let Err(e) = shortcuts.register(next) {
            eprintln!("hotkey\tregister {next} failed\t{e}; keeping {}", current.map_or("none".to_string(), |c| c.to_string()));
            return;
        }
    }
    if let Some(old) = current.take() {
        if let Err(e) = shortcuts.unregister(old) {
            eprintln!("hotkey\tunregister {old} failed\t{e}");
        }
    }
    *current = next;
}
