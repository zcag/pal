//! Global hotkeys: `general.hotkey` shows the panel, `palettes.<id>.hotkey`
//! shows it straight inside that palette. All come from the config file and
//! are swapped live when it changes (`settings::on_reload`) or a palette
//! arrives (`index::sync_extension`). An empty `general.hotkey` means none
//! (a compositor keybind runs `pal toggle` instead). On Linux this only
//! reaches X11 clients (the global-hotkey crate is X11-only); Wayland goes
//! through `pal toggle`. The plugin hops to the main thread itself and
//! waits for it, so `apply` may run on the watcher's thread, but must not
//! hold the map `pressed` reads while it does: a press being handled on
//! the main thread would wait for the map, and the plugin's hop for the
//! main thread. Hence two locks: `map` for the lookup, `applying` to
//! serialise the applies.

use std::collections::HashMap;
use std::sync::Mutex;

use pal_core::config::Config;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::lock;

const FALLBACK: &str = "ctrl+space";

/// What a registered shortcut does: toggle the panel, or open it in a
/// palette (by its `extension/palette` key, what the UI scopes on).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Target {
    Root,
    Palette(String),
}

#[derive(Default)]
struct Registered {
    map: Mutex<HashMap<Shortcut, Target>>,
    applying: Mutex<()>,
}

pub fn install(app: &AppHandle) {
    app.manage(Registered::default());
}

/// The plugin's handler, on the main thread: look the shortcut up and act.
pub fn pressed(app: &AppHandle, shortcut: &Shortcut) {
    let target = lock(&app.state::<Registered>().map).get(shortcut).cloned();
    match target {
        Some(Target::Root) => crate::toggle(app),
        Some(Target::Palette(key)) => crate::show_in(app, Some(key)),
        None => {}
    }
}

/// `None` for an empty setting; a string that does not parse falls back
/// rather than leaving pal unreachable.
fn parse_root(s: &str) -> Option<Shortcut> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.parse().unwrap_or_else(|e| {
        eprintln!("hotkey\tbad general.hotkey\t{s:?}: {e}; using {FALLBACK}");
        FALLBACK.parse().expect("FALLBACK parses")
    }))
}

/// Register what the config wants and drop what it no longer does. A
/// palette's hotkey is only registered once the palette exists. The root
/// hotkey wins a clash with a palette's; a hotkey another app holds is
/// reported and skipped, the rest still apply.
pub fn apply(app: &AppHandle, config: &Config) {
    let mut wanted: HashMap<Shortcut, Target> = HashMap::new();
    for (id, source) in crate::registry::registered_palettes(app) {
        if let Some(h) = config.palette(&id).hotkey.as_deref().map(str::trim).filter(|h| !h.is_empty()) {
            match h.parse::<Shortcut>() {
                Ok(s) => {
                    wanted.insert(s, Target::Palette(format!("{}/{}", source.extension, source.palette)));
                }
                Err(e) => eprintln!("hotkey\tbad palettes.{id}.hotkey\t{h:?}: {e}; ignored"),
            }
        }
    }
    if let Some(root) = parse_root(&config.general.hotkey) {
        wanted.insert(root, Target::Root);
    }
    let registered = app.state::<Registered>();
    let _applying = lock(&registered.applying);
    let current = lock(&registered.map).clone();
    if current == wanted {
        return;
    }
    let shortcuts = app.global_shortcut();
    // Register the new ones first: if another app holds the new root
    // hotkey, the old one stays and pal remains reachable.
    let mut next: HashMap<Shortcut, Target> = HashMap::new();
    for (s, target) in &wanted {
        if current.get(s) == Some(target) {
            next.insert(*s, target.clone());
            continue;
        }
        if current.contains_key(s) {
            // Same keys, other target: re-registering is a no-op for the
            // plugin, only our map changes.
            next.insert(*s, target.clone());
            continue;
        }
        match shortcuts.register(*s) {
            Ok(()) => {
                eprintln!("hotkey\tregistered\t{s}\t{target:?}");
                next.insert(*s, target.clone());
            }
            Err(e) => {
                eprintln!("hotkey\tregister failed\t{s}\t{e}");
                // A root hotkey that cannot be had: keep the previous one.
                if *target == Target::Root {
                    if let Some((old, _)) = current.iter().find(|(_, t)| **t == Target::Root) {
                        next.insert(*old, Target::Root);
                    }
                }
            }
        }
    }
    for s in current.keys() {
        if !next.contains_key(s) {
            match shortcuts.unregister(*s) {
                Ok(()) => eprintln!("hotkey\tunregistered\t{s}"),
                Err(e) => eprintln!("hotkey\tunregister failed\t{s}\t{e}"),
            }
        }
    }
    *lock(&registered.map) = next;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_hotkey_parses_or_falls_back() {
        assert_eq!(parse_root(""), None, "empty is off");
        assert_eq!(parse_root("  "), None);
        assert_eq!(parse_root("ctrl+space"), Some("ctrl+space".parse().unwrap()));
        assert_eq!(parse_root(" alt+p "), Some("alt+p".parse().unwrap()), "trimmed");
        assert_eq!(parse_root("not a key"), Some(FALLBACK.parse().unwrap()), "junk keeps pal reachable");
    }
}
