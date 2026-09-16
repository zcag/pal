//! Global hotkeys: `general.hotkey` shows the panel, `palettes.<id>.hotkey`
//! shows it straight inside that palette, `palettes.<id>.item_hotkeys`
//! (`<item id> = "<keys>"`) run one item of the palette with the panel down,
//! as if picked (`index::run_pick`: the host's `pick`, then its effects),
//! and `bar.items.<key>.hotkey` opens a bar item's popover engaged (or runs
//! its open action, `bar::popover::on_hotkey`).
//! All come from the config file and are swapped live when it changes
//! (`settings::on_reload`) or a palette arrives (`index::sync_extension`). An empty `general.hotkey` means none
//! (a compositor keybind runs `pal toggle` instead). On Linux this only
//! reaches X11 clients (the global-hotkey crate is X11-only); Wayland goes
//! through `pal toggle`. The plugin hops to the main thread itself and
//! waits for it, so `apply` may run on the watcher's thread, but must not
//! hold the map `pressed` reads while it does: a press being handled on
//! the main thread would wait for the map, and the plugin's hop for the
//! main thread. Hence two locks: `map` for the lookup, `applying` to
//! serialise the applies.
//!
//! The root hotkey's fate is kept as an [`Outcome`] (`hotkey_status`, in
//! `settings_get`, and [`events::HOTKEY`] when it changes), because a
//! registration that fails used to reach stderr only. The one failure a
//! Mac user hits is `cmd+space`: Spotlight holds it, the system takes it
//! first, and the fix is a tick in System Settings, so the outcome also
//! says what Spotlight is bound to (`pal_core::spotlight`) and, while a
//! wanted root hotkey is failing on Spotlight's key, [`watch`] polls that
//! binding every [`POLL`] and re-applies the moment it is freed.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pal_core::config::Config;
use pal_core::index::Source;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::host::Host;
use crate::{events, index, lock, settings};

const FALLBACK: &str = "ctrl+space";
const POLL: Duration = Duration::from_secs(2);

/// What a registered shortcut does: toggle the panel, open it in a
/// palette (by its `extension/palette` key, what the UI scopes on), pick
/// one item of a palette without the panel, or open a bar item's popover
/// (by its `extension/id` key).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Target {
    Root,
    Palette(String),
    Item(Source, String),
    Bar(String),
}

/// How the last `apply` went for the root hotkey (`general.hotkey`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Outcome {
    /// `general.hotkey` as configured, trimmed; empty when off.
    pub wanted: String,
    /// The OS took the registration. Also true for an empty `wanted`
    /// (nothing to register) and, on a failure, false even though the
    /// previous root hotkey is kept so pal stays reachable.
    pub registered: bool,
    /// The OS's refusal, or the parse error a fallback covered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// What Spotlight's "Show Spotlight search" is bound to, when it is on
    /// and pal wanted the same combination (`cmd+space` on a stock Mac):
    /// the guidance in Settings keys on this. Read only when the root
    /// hotkey changed or failed; `None` off macOS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spotlight: Option<String>,
}

#[derive(Default)]
struct Registered {
    map: Mutex<HashMap<Shortcut, Target>>,
    applying: Mutex<()>,
    outcome: Mutex<Outcome>,
}

pub fn install(app: &AppHandle) {
    app.manage(Registered::default());
}

/// The last outcome, a copy.
pub fn outcome(app: &AppHandle) -> Outcome {
    lock(&app.state::<Registered>().outcome).clone()
}

#[tauri::command]
pub fn hotkey_status(app: AppHandle) -> Outcome {
    outcome(&app)
}

/// Spotlight's binding when it is the combination `wanted` names, so the
/// outcome carries exactly the conflict and nothing else.
fn spotlight_conflict(wanted: &Shortcut) -> Option<String> {
    pal_core::spotlight::hotkey().filter(|s| s.parse::<Shortcut>().is_ok_and(|s| s == *wanted))
}

/// Store the outcome; every window hears of a change, and a root hotkey
/// failing on Spotlight's key starts the poll that retries once it is freed.
fn record(app: &AppHandle, outcome: Outcome) {
    let changed = {
        let st = app.state::<Registered>();
        let mut cur = lock(&st.outcome);
        let changed = *cur != outcome;
        *cur = outcome.clone();
        changed
    };
    if changed {
        eprintln!("hotkey	status	{:?}	registered={}	{}", outcome.wanted, outcome.registered, outcome.error.as_deref().or(outcome.spotlight.as_deref().map(|_| "spotlight holds it")).unwrap_or("ok"));
        events::emit(app, events::HOTKEY, outcome.clone());
    }
    if !outcome.registered && outcome.spotlight.is_some() {
        watch(app);
    }
}

/// Poll Spotlight's binding every [`POLL`] while the root hotkey wants it
/// and failed, and re-apply the config as soon as it is something else
/// (the user unticked it in System Settings). One poll at a time; ends
/// when the outcome no longer says so (registered, or the hotkey changed).
fn watch(app: &AppHandle) {
    static POLLING: AtomicBool = AtomicBool::new(false);
    if POLLING.swap(true, Ordering::Relaxed) {
        return;
    }
    eprintln!("hotkey\tspotlight poll\tstarted");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            let o = outcome(&app);
            let (Some(held), false) = (o.spotlight.as_deref(), o.registered) else {
                eprintln!("hotkey\tspotlight poll\tstopped\tregistered={}", o.registered);
                break;
            };
            let now = tauri::async_runtime::spawn_blocking(pal_core::spotlight::hotkey).await.unwrap_or_default();
            if now.as_deref() != Some(held) {
                eprintln!("hotkey	spotlight released	{held}	now {}", now.as_deref().unwrap_or("off"));
                let (config, handle) = (settings::config(&app), app.clone());
                if tauri::async_runtime::spawn_blocking(move || apply(&handle, &config)).await.is_err() {
                    break;
                }
            }
        }
        POLLING.store(false, Ordering::Relaxed);
    });
}

/// The plugin's handler, on the main thread: look the shortcut up and act.
/// An item pick goes to the runtime (the host round trip and the effect's
/// hide-and-settle must not sit on the main thread); its failure is a log
/// line, since nothing is on screen to show it.
pub fn pressed(app: &AppHandle, shortcut: &Shortcut) {
    let target = lock(&app.state::<Registered>().map).get(shortcut).cloned();
    match target {
        Some(Target::Root) => crate::toggle(app),
        Some(Target::Palette(key)) => crate::show_in(app, Some(key)),
        // Off the main thread: the anchor is a `sketchybar --query`.
        Some(Target::Bar(key)) => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || crate::bar::popover::on_hotkey(&app, &key));
        }
        Some(Target::Item(source, id)) => {
            let Some(host) = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()) else { return };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = index::run_pick(&app, &host, &source, &id, None, None, None).await {
                    eprintln!("hotkey\titem pick failed\t{}/{}\t{id}\t{e}", source.extension, source.palette);
                }
            });
        }
        None => {}
    }
}

/// `None` for an empty setting; a string that does not parse falls back
/// rather than leaving pal unreachable, and says so in the error.
fn parse_root(s: &str) -> Option<(Shortcut, Option<String>)> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    Some(match s.parse() {
        Ok(k) => (k, None),
        Err(e) => {
            eprintln!("hotkey\tbad general.hotkey\t{s:?}: {e}; using {FALLBACK}");
            (FALLBACK.parse().expect("FALLBACK parses"), Some(format!("{s:?} does not parse ({e}); using {FALLBACK}")))
        }
    })
}

/// Register what the config wants and drop what it no longer does. A
/// palette's hotkeys are only registered once the palette exists, a bar
/// item's whatever its state (the item may be hidden or not yet
/// rendered; its hotkey still opens it). In a clash the root hotkey wins
/// over a palette's, a palette's over a bar item's, a bar item's over a
/// palette item's; a hotkey another app holds is reported and skipped,
/// the rest still apply.
pub fn apply(app: &AppHandle, config: &Config) {
    let mut wanted: HashMap<Shortcut, Target> = HashMap::new();
    let parse = |what: String, h: &str| match h.trim().parse::<Shortcut>() {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("hotkey\tbad {what}\t{h:?}: {e}; ignored");
            None
        }
    };
    let palettes = crate::registry::registered_palettes(app);
    for (id, source) in &palettes {
        for (item, h) in &config.palette(id).item_hotkeys {
            if let Some(s) = parse(format!("palettes.{id}.item_hotkeys.{item}"), h) {
                wanted.insert(s, Target::Item(source.clone(), item.clone()));
            }
        }
    }
    for (key, item) in &config.bar.items {
        if let Some(h) = item.hotkey.as_deref().filter(|h| !h.trim().is_empty() && item.enabled) {
            if let Some(s) = parse(format!("bar.items.{key}.hotkey"), h) {
                wanted.insert(s, Target::Bar(key.clone()));
            }
        }
    }
    for (id, source) in &palettes {
        if let Some(h) = config.palette(id).hotkey.as_deref().filter(|h| !h.trim().is_empty()) {
            if let Some(s) = parse(format!("palettes.{id}.hotkey"), h) {
                wanted.insert(s, Target::Palette(format!("{}/{}", source.extension, source.palette)));
            }
        }
    }
    let root = parse_root(&config.general.hotkey);
    if let Some((root, _)) = &root {
        wanted.insert(*root, Target::Root);
    }
    let registered = app.state::<Registered>();
    let _applying = lock(&registered.applying);
    let current = lock(&registered.map).clone();
    if current == wanted {
        // Nothing to (un)register. A root the OS took but Spotlight was
        // holding is re-judged here (the poll's re-apply lands here too).
        let mut o = outcome(app);
        if let (Some(_), Some((root, _))) = (&o.spotlight, &root) {
            o.spotlight = spotlight_conflict(root);
            if o.spotlight.is_none() {
                o.registered = true;
                o.error = None;
            }
            drop(_applying);
            record(app, o);
        }
        return;
    }
    let mut outcome = Outcome { wanted: config.general.hotkey.trim().into(), registered: true, error: root.as_ref().and_then(|(_, e)| e.clone()), spotlight: None };
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
                    outcome.registered = false;
                    outcome.error = Some(e.to_string());
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
    drop(_applying);
    // Spotlight is read (a `defaults` run) only for a root that changed or
    // failed, which is where this is: the early return above covers the rest.
    if let Some((root, _)) = &root {
        if let Some(s) = spotlight_conflict(root) {
            outcome.spotlight = Some(s);
            if outcome.registered {
                // The OS took it, and Spotlight still gets the press first.
                outcome.registered = false;
                outcome.error.get_or_insert_with(|| "Spotlight takes this key first".into());
            }
        }
    }
    record(app, outcome);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_hotkey_parses_or_falls_back() {
        assert_eq!(parse_root(""), None, "empty is off");
        assert_eq!(parse_root("  "), None);
        assert_eq!(parse_root("ctrl+space"), Some(("ctrl+space".parse().unwrap(), None)));
        assert_eq!(parse_root(" alt+p "), Some(("alt+p".parse().unwrap(), None)), "trimmed");
        let (key, err) = parse_root("not a key").unwrap();
        assert_eq!(key, FALLBACK.parse().unwrap(), "junk keeps pal reachable");
        assert!(err.unwrap().contains(FALLBACK), "and the outcome says which key it got instead");
    }

    #[test]
    fn spotlight_conflict_only_for_the_same_combination() {
        // The read itself is the machine's; `None` from `hotkey()` (off, or Linux) is never a conflict.
        let held = pal_core::spotlight::hotkey();
        let wanted: Shortcut = "ctrl+alt+shift+f19".parse().unwrap();
        assert_eq!(spotlight_conflict(&wanted), None);
        if let Some(h) = held {
            assert_eq!(spotlight_conflict(&h.parse().unwrap()).as_deref(), Some(h.as_str()));
        }
    }
}
