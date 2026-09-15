//! The global hotkey: `general.hotkey` from the config file, swapped live
//! when the file changes. On Linux this only reaches X11 clients (the
//! global-hotkey crate is X11-only); Wayland goes through `pal-app toggle`.

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

fn parse(s: &str) -> Shortcut {
    s.parse().unwrap_or_else(|e| {
        eprintln!("hotkey\t{s:?}: {e}; using {FALLBACK}");
        FALLBACK.parse().unwrap()
    })
}

fn apply(app: &AppHandle, wanted: &str) {
    let next = parse(wanted);
    let registered = app.state::<Registered>();
    let mut current = registered.0.lock().unwrap();
    if *current == Some(next) {
        return;
    }
    let shortcuts = app.global_shortcut();
    if let Some(old) = current.take() {
        let _ = shortcuts.unregister(old);
    }
    match shortcuts.register(next) {
        Ok(()) => *current = Some(next),
        Err(e) => eprintln!("hotkey\tregister {next} failed\t{e}"),
    }
}
