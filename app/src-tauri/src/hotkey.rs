//! Global hotkeys: `general.hotkey` shows the panel, `palettes.<id>.hotkey`
//! shows it straight inside that palette, `palettes.<id>.item_hotkeys`
//! (`<item id> = "<keys>"`) run one item of the palette with the panel down,
//! as if picked (`index::run_pick`: the host's `pick`, then its effects),
//! `bar.items.<key>.hotkey` opens a bar item's popover engaged (or runs
//! its open action, `bar::popover::on_hotkey`), `sidebar.hotkey` engages
//! the sidebar (`sidebar::on_hotkey`), and `palettes.<id>.hold` (or the
//! chord the palette's manifest suggests) is the switcher's chord: it and
//! its `shift+` variant both register, every press goes to
//! `switcher::press` (begin, then step; the release is the switcher's own
//! poll). The chords the Dock owns (`cmd+tab` and `cmd+shift+tab`, the App
//! Switcher's) are the exception: macOS accepts their registration and
//! still hands the press to the Dock (measured on hornet), so those go
//! through a `CGEventTap` instead ([`tap`]: the key down is swallowed and
//! `pressed` runs as if registered), which needs Input Monitoring; until
//! it is granted the chord waits, asked for once and listed in the
//! Overview ([`Outcome::hold_blocked`]), and the grant re-applies
//! (`permissions::watch`).
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
//! `general.hotkey` may name several combinations (`["cmd+space",
//! "ctrl+space"]`); every one registers as [`Target::Root`], and one the
//! OS or Spotlight holds costs the others nothing. Their fate is kept as
//! an [`Outcome`], one [`RootOutcome`] per entry (`hotkey_status`, in
//! `settings_get`, and [`events::HOTKEY`] when it changes), because a
//! registration that fails used to reach stderr only. The one failure a
//! Mac user hits is `cmd+space`: Spotlight holds it, the system takes it
//! first, and the fix is a tick in System Settings, so the entry also
//! says what Spotlight is bound to (`pal_core::spotlight`) and, while a
//! wanted root hotkey is failing on Spotlight's key, [`watch`] polls that
//! binding every [`POLL`] and re-applies the moment it is freed.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pal_core::config::{Config, Hotkeys};
use pal_core::index::Source;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::host::Host;
use crate::{events, index, lock, settings};

const FALLBACK: &str = "ctrl+space";
const POLL: Duration = Duration::from_secs(2);

/// What a registered shortcut does: toggle the panel, open it in a
/// palette (by its `extension/palette` key, what the UI scopes on), pick
/// one item of a palette without the panel, open a bar item's popover
/// (by its `extension/id` key), engage the sidebar, or drive the switcher
/// over a palette (`mods` are the chord's own, what the release poll
/// watches; `back` for the `shift+` variant, which steps up).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Target {
    Root,
    Palette(String),
    Item(Source, String),
    Bar(String),
    Sidebar,
    Hold { source: Source, mods: Modifiers, back: bool },
}

/// One entry of `general.hotkey` and how its registration went.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct RootOutcome {
    /// The entry as configured, trimmed.
    pub wanted: String,
    /// The OS took the registration and Spotlight does not hold the key.
    pub registered: bool,
    /// The OS's refusal, the parse error a fallback covered, or
    /// "Spotlight takes this key first".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// What Spotlight's "Show Spotlight search" is bound to, when it is on
    /// and this entry is the same combination (`cmd+space` on a stock
    /// Mac): the guidance in Settings keys on this. Read only when a root
    /// hotkey changed or failed; `None` off macOS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spotlight: Option<String>,
}

/// How the last `apply` went for the root hotkeys (`general.hotkey`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Outcome {
    /// One per configured entry, in the file's order; empty when off.
    pub hotkeys: Vec<RootOutcome>,
    /// At least one entry works. Also true for no entries (nothing to
    /// register) and, when every entry failed, false even though the
    /// previous root hotkeys are kept so pal stays reachable.
    pub registered: bool,
    /// A hold chord the Dock owns (`cmd+tab`), as configured, waiting on
    /// Input Monitoring for its event tap: the Overview's row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hold_blocked: Option<String>,
}

impl Outcome {
    /// One line for the diagnostics: `off`, or every entry with its fate
    /// (`cmd+space registered, ctrl+space failed: HotKey already registered`),
    /// and the hold chord waiting on Input Monitoring when one is.
    pub fn summary(&self) -> String {
        let roots = if self.hotkeys.is_empty() {
            "off".to_string()
        } else {
            self.hotkeys
                .iter()
                .map(|h| if h.registered { format!("{} registered", h.wanted) } else { format!("{} failed: {}", h.wanted, h.error.as_deref().unwrap_or("unknown")) })
                .collect::<Vec<_>>()
                .join(", ")
        };
        match &self.hold_blocked {
            Some(h) => format!("{roots}; hold {h} needs Input Monitoring"),
            None => roots,
        }
    }
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

/// Spotlight's binding `held` when it is the combination `wanted` names,
/// so an entry carries exactly the conflict and nothing else.
fn spotlight_conflict(held: Option<&str>, wanted: &Shortcut) -> Option<String> {
    held.filter(|s| s.parse::<Shortcut>().is_ok_and(|s| s == *wanted)).map(String::from)
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
        let each = outcome.hotkeys.iter().map(|h| format!("{:?} {}", h.wanted, if h.registered { "ok" } else { h.error.as_deref().unwrap_or("failed") })).collect::<Vec<_>>().join("; ");
        eprintln!("hotkey	status	registered={}	{}", outcome.registered, if each.is_empty() { "off".into() } else { each });
        events::emit(app, events::HOTKEY, outcome.clone());
    }
    if outcome.hotkeys.iter().any(|h| !h.registered && h.spotlight.is_some()) {
        watch(app);
    }
}

/// Poll Spotlight's binding every [`POLL`] while a root hotkey wants it
/// and failed, and re-apply the config as soon as it is something else
/// (the user unticked it in System Settings). One poll at a time; ends
/// when no entry says so any more (registered, or the hotkeys changed).
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
            let Some(held) = o.hotkeys.iter().find(|h| !h.registered && h.spotlight.is_some()).and_then(|h| h.spotlight.clone()) else {
                eprintln!("hotkey\tspotlight poll\tstopped\tregistered={}", o.registered);
                break;
            };
            let now = tauri::async_runtime::spawn_blocking(pal_core::spotlight::hotkey).await.unwrap_or_default();
            if now.as_deref() != Some(held.as_str()) {
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
        Some(Target::Hold { source, mods, back }) => crate::switcher::press(app, &source, mods, back),
        // Off the main thread: the anchor is a `sketchybar --query`.
        Some(Target::Bar(key)) => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || crate::bar::popover::on_hotkey(&app, &key));
        }
        Some(Target::Sidebar) => crate::sidebar::on_hotkey(app),
        Some(Target::Item(source, id)) => {
            let Some(host) = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()) else { return };
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = index::run_pick(&app, &host, &source, &index::Pick { id: &id, ..Default::default() }).await {
                    eprintln!("hotkey\titem pick failed\t{}/{}\t{id}\t{e}", source.extension, source.palette);
                }
            });
        }
        None => {}
    }
}

/// The palette a hold chord is registered for (`Target::Hold`; any one,
/// should several have a chord), for `pal switch` beginning from idle.
pub fn hold_target(app: &AppHandle) -> Option<Source> {
    lock(&app.state::<Registered>().map).values().find_map(|t| match t {
        Target::Hold { source, .. } => Some(source.clone()),
        _ => None,
    })
}

/// A hold chord's `shift+` variant, the one that steps back: `None` when
/// the chord has shift already (it registers alone and only steps down).
fn shifted(s: &Shortcut) -> Option<Shortcut> {
    (!s.mods.contains(Modifiers::SHIFT)).then(|| Shortcut::new(Some(s.mods | Modifiers::SHIFT), s.key))
}

/// One entry of `general.hotkey` as parsed: its key, or the parse error.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Root {
    wanted: String,
    key: Option<Shortcut>,
    error: Option<String>,
}

/// Every non-empty entry parsed. An entry that does not parse is reported
/// and skipped; when none parses at all the first falls back to
/// [`FALLBACK`] rather than leaving pal unreachable, and says so.
fn parse_roots(hotkeys: &Hotkeys) -> Vec<Root> {
    let mut roots: Vec<Root> = hotkeys
        .list()
        .into_iter()
        .map(|s| match s.parse() {
            Ok(k) => Root { wanted: s.into(), key: Some(k), error: None },
            Err(e) => {
                eprintln!("hotkey\tbad general.hotkey\t{s:?}: {e}");
                Root { wanted: s.into(), key: None, error: Some(format!("{s:?} does not parse ({e})")) }
            }
        })
        .collect();
    if !roots.is_empty() && roots.iter().all(|r| r.key.is_none()) {
        let first = &mut roots[0];
        eprintln!("hotkey\tno root hotkey parses; using {FALLBACK}");
        first.key = Some(FALLBACK.parse().expect("FALLBACK parses"));
        first.error = first.error.take().map(|e| format!("{e}; using {FALLBACK}"));
    }
    roots
}

/// The map after registering what `wanted` adds and dropping what
/// `current` had that it no longer wants, plus the refusal for every
/// root the OS would not give. A key already held only changes target in
/// the map (re-registering is a no-op for the plugin). Roots register
/// before anything is dropped, and when none of the wanted roots could be
/// had the roots already held stay, so pal remains reachable.
fn reconcile(current: &HashMap<Shortcut, Target>, wanted: &HashMap<Shortcut, Target>, mut register: impl FnMut(&Shortcut) -> Result<(), String>, mut unregister: impl FnMut(&Shortcut) -> Result<(), String>) -> (HashMap<Shortcut, Target>, HashMap<Shortcut, String>) {
    let mut next: HashMap<Shortcut, Target> = HashMap::new();
    let mut failed: HashMap<Shortcut, String> = HashMap::new();
    for (s, target) in wanted {
        if current.contains_key(s) {
            next.insert(*s, target.clone());
            continue;
        }
        match register(s) {
            Ok(()) => {
                eprintln!("hotkey\tregistered\t{s}\t{target:?}");
                next.insert(*s, target.clone());
            }
            Err(e) => {
                eprintln!("hotkey\tregister failed\t{s}\t{e}");
                if *target == Target::Root {
                    failed.insert(*s, e);
                }
            }
        }
    }
    if wanted.values().any(|t| *t == Target::Root) && !next.values().any(|t| *t == Target::Root) {
        for (s, _) in current.iter().filter(|(_, t)| **t == Target::Root) {
            next.insert(*s, Target::Root);
        }
    }
    for s in current.keys() {
        if !next.contains_key(s) {
            match unregister(s) {
                Ok(()) => eprintln!("hotkey\tunregistered\t{s}"),
                Err(e) => eprintln!("hotkey\tunregister failed\t{s}\t{e}"),
            }
        }
    }
    (next, failed)
}

/// The outcome for `roots` given the map after a reconcile, the roots it
/// refused, and Spotlight's binding (`None` when it was not read).
fn judge(roots: &[Root], map: &HashMap<Shortcut, Target>, failed: &HashMap<Shortcut, String>, held: Option<&str>) -> Outcome {
    let hotkeys: Vec<RootOutcome> = roots
        .iter()
        .map(|r| {
            let mut o = RootOutcome { wanted: r.wanted.clone(), registered: false, error: r.error.clone(), spotlight: None };
            match r.key {
                Some(k) if failed.contains_key(&k) => o.error = failed.get(&k).cloned(),
                Some(k) if map.get(&k) == Some(&Target::Root) => {
                    o.spotlight = spotlight_conflict(held, &k);
                    // The OS took it, and Spotlight still gets the press first.
                    o.registered = o.spotlight.is_none();
                    if !o.registered {
                        o.error.get_or_insert_with(|| "Spotlight takes this key first".into());
                    }
                }
                _ => {}
            }
            o
        })
        .collect();
    let registered = hotkeys.is_empty() || hotkeys.iter().any(|h| h.registered);
    Outcome { hotkeys, registered, hold_blocked: None }
}

/// A chord the Dock takes before any registration: `cmd+tab` and its
/// `shift+` variant, the App Switcher's. These go through the event tap.
fn dock_owned(s: &Shortcut) -> bool {
    s.key == Code::Tab && (s.mods == Modifiers::SUPER || s.mods == Modifiers::SUPER | Modifiers::SHIFT)
}

/// Register what the config wants and drop what it no longer does. A
/// palette's hotkeys are only registered once the palette exists, a bar
/// item's whatever its state (the item may be hidden or not yet
/// rendered; its hotkey still opens it), the sidebar's while it has a
/// palette. In a clash the root hotkeys win over a palette's, a
/// palette's over a hold chord, a hold chord over a bar item's, a bar
/// item's over a palette item's, any of them over the sidebar's; a hotkey
/// another app holds is reported and skipped, the rest still apply. A
/// hold chord is the config's `hold`, else the one the manifest suggests;
/// `""` in the config is off.
pub fn apply(app: &AppHandle, config: &Config) {
    let mut wanted: HashMap<Shortcut, Target> = HashMap::new();
    let parse = |what: String, h: &str| match h.trim().parse::<Shortcut>() {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("hotkey\tbad {what}\t{h:?}: {e}; ignored");
            None
        }
    };
    if let Some(h) = config.sidebar.hotkey.as_deref().filter(|h| !h.trim().is_empty() && config.sidebar.palette().is_some()) {
        if let Some(s) = parse("sidebar.hotkey".into(), h) {
            wanted.insert(s, Target::Sidebar);
        }
    }
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
    // `general.app_switcher`: the chord the tap turns into the Dock's own
    // switcher (a Tab chord); a hold chord that is the same is dropped, the
    // App Switcher's claim on it being the point.
    let system = config.general.app_switcher.as_deref().map(str::trim).filter(|h| !h.is_empty()).and_then(|h| parse("general.app_switcher".into(), h)).filter(|s| {
        let tab = s.key == Code::Tab && !s.mods.is_empty();
        if !tab {
            eprintln!("hotkey	general.app_switcher	{s}	not a Tab chord with a modifier; ignored");
        }
        tab
    });
    // The Dock-owned hold chord as configured, for the Overview when its tap waits on the permission.
    let mut owned: Option<String> = None;
    for (id, source, suggested) in crate::registry::registered_holds(app) {
        let p = config.palette(&id);
        let Some(h) = p.hold.as_deref().or(suggested.as_deref()).map(str::trim).filter(|h| !h.is_empty()) else { continue };
        if let Some(s) = parse(format!("palettes.{id}.hold"), h) {
            if system.is_some_and(|sys| sys == s || shifted(&sys) == Some(s)) {
                eprintln!("hotkey	palettes.{id}.hold	{h}	is general.app_switcher's; pal's switcher needs another chord");
                continue;
            }
            if dock_owned(&s) {
                owned = Some(h.to_lowercase());
            }
            if let Some(back) = shifted(&s) {
                wanted.insert(back, Target::Hold { source: source.clone(), mods: s.mods, back: true });
            }
            wanted.insert(s, Target::Hold { source, mods: s.mods, back: false });
        }
    }
    for (id, source) in &palettes {
        if let Some(h) = config.palette(id).hotkey.as_deref().filter(|h| !h.trim().is_empty()) {
            if let Some(s) = parse(format!("palettes.{id}.hotkey"), h) {
                wanted.insert(s, Target::Palette(format!("{}/{}", source.extension, source.palette)));
            }
        }
    }
    let roots = parse_roots(&config.general.hotkey);
    for k in roots.iter().filter_map(|r| r.key) {
        wanted.insert(k, Target::Root);
    }
    let registered = app.state::<Registered>();
    let _applying = lock(&registered.applying);
    let current = lock(&registered.map).clone();
    if current == wanted {
        // Nothing to (un)register. A root the OS took but Spotlight was
        // holding is re-judged here (the poll's re-apply lands here too);
        // Spotlight (a `defaults` run) is read only when one was. The tap
        // is re-tried: a permission granted since lands here too.
        drop(_applying);
        let held = outcome(app).hotkeys.iter().any(|h| h.spotlight.is_some()).then(pal_core::spotlight::hotkey).flatten();
        let mut o = judge(&roots, &current, &HashMap::new(), held.as_deref());
        o.hold_blocked = tap::apply(app, current.keys().filter(|s| dock_owned(s)).copied().collect(), system, owned.as_deref()).then_some(owned).flatten();
        record(app, o);
        return;
    }
    let shortcuts = app.global_shortcut();
    // A Dock-owned chord is in the map for `pressed` without a registration: the tap delivers it.
    let (next, failed) = reconcile(&current, &wanted, |s| if dock_owned(s) { Ok(()) } else { shortcuts.register(*s).map_err(|e| e.to_string()) }, |s| if dock_owned(s) { Ok(()) } else { shortcuts.unregister(*s).map_err(|e| e.to_string()) });
    *lock(&registered.map) = next.clone();
    drop(_applying);
    // Spotlight is read only for a root that changed or failed, which is
    // where this is: the early return above covers the rest.
    let held = (!roots.is_empty()).then(pal_core::spotlight::hotkey).flatten();
    let mut o = judge(&roots, &next, &failed, held.as_deref());
    o.hold_blocked = tap::apply(app, next.keys().filter(|s| dock_owned(s)).copied().collect(), system, owned.as_deref()).then_some(owned).flatten();
    record(app, o);
}

/// The event tap for the Dock-owned chords (macOS): a session-level
/// active tap at the head of the chain on key downs (and modifier
/// changes, which pass through), its source on the main run loop. A key
/// down that is one of the watched chords runs [`pressed`] and is
/// swallowed (the App Switcher never sees it); an autorepeat of it is
/// swallowed without a press, as a Carbon hot key repeats nothing; every
/// other event passes. The system disables a tap whose callback runs
/// long; it is re-enabled from the callback itself. A keyboard tap
/// delivers nothing without Input Monitoring (`IOHIDCheckAccess`), so
/// without it none is installed: the chord is logged, asked for once
/// (the prompt and the pane, as expansion asks) and reported.
#[cfg(target_os = "macos")]
mod tap {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::{Mutex, OnceLock};

    use objc2_core_foundation::{kCFRunLoopCommonModes, CFMachPort, CFRetained, CFRunLoop, CFRunLoopSource};
    use objc2_core_graphics::{CGEvent, CGEventField, CGEventFlags, CGEventMask, CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy, CGEventType};
    use tauri::AppHandle;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    use crate::{lock, permissions};

    /// The virtual key code of Tab.
    const TAB: i64 = 48;

    /// The chords the tap swallows and hands to `pressed`; read on every key down.
    static WATCHED: Mutex<Vec<Shortcut>> = Mutex::new(Vec::new());
    /// `general.app_switcher`: the chord (without shift) the tap turns into
    /// the Dock's own switcher, and whether a Cmd is virtually down for it.
    static SYSTEM: Mutex<Option<Shortcut>> = Mutex::new(None);
    static FORWARDING: Mutex<bool> = Mutex::new(false);
    static APP: OnceLock<AppHandle> = OnceLock::new();
    /// Stamped on every event the tap posts (`EventSourceUserData`), so the tap lets its own through.
    const TAG: i64 = 0x70616c;
    /// The virtual key code of the left Command key.
    const COMMAND: u16 = 55;

    thread_local! {
        /// The tap and its run loop source; the main thread's, like the run loop.
        static TAP: RefCell<Option<(CFRetained<CFMachPort>, CFRetained<CFRunLoopSource>)>> = const { RefCell::new(None) };
    }

    /// The chord a key down is (Tab with the four modifiers that count;
    /// the rest of the flags, fn or the numeric pad, are ignored).
    fn chord(code: i64, flags: CGEventFlags) -> Option<Shortcut> {
        if code != TAB {
            return None;
        }
        let pairs = [(CGEventFlags::MaskCommand, Modifiers::SUPER), (CGEventFlags::MaskShift, Modifiers::SHIFT), (CGEventFlags::MaskAlternate, Modifiers::ALT), (CGEventFlags::MaskControl, Modifiers::CONTROL)];
        let mods = pairs.iter().filter(|(f, _)| flags.contains(*f)).fold(Modifiers::empty(), |m, (_, x)| m | *x);
        Some(Shortcut::new(Some(mods), Code::Tab))
    }

    /// One keyboard event posted as the HID system's: a key, or a modifier's
    /// `flagsChanged` (`modifier`), with `flags`, tagged as pal's own.
    fn post(key: u16, down: bool, modifier: bool, flags: CGEventFlags) {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState);
        let Some(e) = CGEvent::new_keyboard_event(source.as_deref(), key, down) else { return };
        if modifier {
            CGEvent::set_type(Some(&e), CGEventType::FlagsChanged);
        }
        CGEvent::set_flags(Some(&e), flags);
        CGEvent::set_integer_value_field(Some(&e), CGEventField::EventSourceUserData, TAG);
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&e));
    }

    /// The Dock's switcher driven from `general.app_switcher`: the first press
    /// puts a Cmd down for the Dock (a `flagsChanged`), every press is a
    /// Cmd+Tab (Cmd+Shift+Tab for the chord's `shift+` variant), and the
    /// chord's modifiers coming up lets the Cmd up, which the Dock takes as
    /// the switch. Measured on hornet 2026-09-22: posted this way, the Dock
    /// opens, steps and commits as for the keys themselves.
    fn forward_press(back: bool) {
        let mut on = lock(&FORWARDING);
        let first = !*on;
        if first {
            // The chord's own modifiers are let go of first, for the Dock: it
            // reads the combined modifier state, and with the option still
            // down a posted Cmd+Tab is Cmd+Option+Tab to it, which is nobody's
            // (measured on hornet 2026-09-22 with the modifier held).
            if let Some(sys) = *lock(&SYSTEM) {
                for (m, key) in [(Modifiers::ALT, 58u16), (Modifiers::CONTROL, 59), (Modifiers::SHIFT, 56)] {
                    if sys.mods.contains(m) {
                        post(key, false, true, CGEventFlags::empty());
                    }
                }
            }
            post(COMMAND, true, true, CGEventFlags::MaskCommand);
            *on = true;
            eprintln!("hotkey\tapp switcher\tcmd down for the Dock");
        }
        drop(on);
        let flags = if back { CGEventFlags::MaskCommand | CGEventFlags::MaskShift } else { CGEventFlags::MaskCommand };
        // Off the tap's callback, a beat after the Cmd: the Dock wants the modifier to have landed before the Tab (posted back to back from the callback, it opened nothing).
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(if first { 30 } else { 5 }));
            post(TAB as u16, true, false, flags);
            post(TAB as u16, false, false, flags);
        });
    }

    fn forward_release() {
        let mut on = lock(&FORWARDING);
        if *on {
            post(COMMAND, false, true, CGEventFlags::empty());
            *on = false;
            eprintln!("hotkey\tapp switcher\tcmd up");
        }
    }

    /// Whether `flags` still hold every modifier of `s` (the chord is held).
    fn holds(flags: CGEventFlags, s: &Shortcut) -> bool {
        let pairs = [(CGEventFlags::MaskCommand, Modifiers::SUPER), (CGEventFlags::MaskShift, Modifiers::SHIFT), (CGEventFlags::MaskAlternate, Modifiers::ALT), (CGEventFlags::MaskControl, Modifiers::CONTROL)];
        pairs.iter().filter(|(_, m)| s.mods.contains(*m)).all(|(f, _)| flags.contains(*f))
    }

    unsafe extern "C-unwind" fn callback(_proxy: CGEventTapProxy, ty: CGEventType, event: NonNull<CGEvent>, _info: *mut c_void) -> *mut CGEvent {
        if ty == CGEventType::TapDisabledByTimeout || ty == CGEventType::TapDisabledByUserInput {
            TAP.with(|t| {
                if let Some((port, _)) = &*t.borrow() {
                    CGEvent::tap_enable(port, true);
                }
            });
            eprintln!("hotkey\ttap\tre-enabled after {ty:?}");
            return event.as_ptr();
        }
        // SAFETY: the system hands a live event to the tap's callback.
        let e = unsafe { event.as_ref() };
        if CGEvent::integer_value_field(Some(e), CGEventField::EventSourceUserData) == TAG {
            return event.as_ptr();
        }
        let flags = CGEvent::flags(Some(e));
        if ty == CGEventType::FlagsChanged {
            let held = lock(&SYSTEM).filter(|s| holds(flags, s)).is_some();
            if !held {
                forward_release();
            } else if *lock(&FORWARDING) {
                // Shift pressed for the step back (or any modifier) while the chord is held: the Dock reads the Cmd state off every `flagsChanged`, so this one says Cmd too.
                CGEvent::set_flags(Some(e), flags | CGEventFlags::MaskCommand);
            }
            return event.as_ptr();
        }
        if ty == CGEventType::KeyDown {
            let code = CGEvent::integer_value_field(Some(e), CGEventField::KeyboardEventKeycode);
            let Some(s) = chord(code, flags) else { return event.as_ptr() };
            let repeat = CGEvent::integer_value_field(Some(e), CGEventField::KeyboardEventAutorepeat) != 0;
            let system = *lock(&SYSTEM);
            if let Some(sys) = system.filter(|sys| *sys == s || super::shifted(sys) == Some(s)) {
                if !repeat {
                    forward_press(s != sys);
                }
                return std::ptr::null_mut();
            }
            if lock(&WATCHED).contains(&s) {
                if !repeat {
                    if let Some(app) = APP.get() {
                        super::pressed(app, &s);
                    }
                }
                return std::ptr::null_mut();
            }
        }
        event.as_ptr()
    }

    /// Follow `chords` (`label`: the chord as configured, for the log):
    /// none removes the tap; some install it (once) with Input Monitoring,
    /// and without it ask once and answer true, the chord blocked. Any
    /// thread: the tap itself is made and removed on the main one.
    pub fn apply(app: &AppHandle, chords: Vec<Shortcut>, system: Option<Shortcut>, label: Option<&str>) -> bool {
        let _ = APP.set(app.clone());
        let label = label.map(str::to_string).or_else(|| system.map(|s| format!("app switcher {s}"))).unwrap_or_else(|| "cmd+tab".into());
        *lock(&WATCHED) = chords.clone();
        *lock(&SYSTEM) = system;
        if chords.is_empty() && system.is_none() {
            forward_release();
            remove(app);
            return false;
        }
        if !permissions::input_monitoring() {
            eprintln!("switcher\t{label} needs Input Monitoring");
            permissions::ask(app, "input_monitoring", "The app switcher");
            remove(app);
            return true;
        }
        let _ = app.run_on_main_thread(move || {
            TAP.with(|t| {
                if t.borrow().is_some() {
                    return;
                }
                let mask: CGEventMask = (1 << CGEventType::KeyDown.0) | (1 << CGEventType::FlagsChanged.0);
                // SAFETY: the callback has the signature the tap expects and reads nothing from `user_info`.
                let Some(port) = (unsafe { CGEvent::tap_create(CGEventTapLocation::SessionEventTap, CGEventTapPlacement::HeadInsertEventTap, CGEventTapOptions::Default, mask, Some(callback), std::ptr::null_mut()) }) else {
                    return eprintln!("hotkey\ttap\trefused\t{label}");
                };
                let (Some(source), Some(main)) = (CFMachPort::new_run_loop_source(None, Some(&port), 0), CFRunLoop::main()) else {
                    return eprintln!("hotkey\ttap\tno run loop source");
                };
                // SAFETY: a CoreFoundation constant, read only.
                main.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
                CGEvent::tap_enable(&port, true);
                eprintln!("hotkey\ttap\tinstalled\t{label}");
                *t.borrow_mut() = Some((port, source));
            });
        });
        false
    }

    fn remove(app: &AppHandle) {
        let _ = app.run_on_main_thread(|| {
            TAP.with(|t| {
                if let Some((port, source)) = t.borrow_mut().take() {
                    if let Some(main) = CFRunLoop::main() {
                        // SAFETY: as above.
                        main.remove_source(Some(&source), unsafe { kCFRunLoopCommonModes });
                    }
                    CGEvent::tap_enable(&port, false);
                    port.invalidate();
                    eprintln!("hotkey\ttap\tremoved");
                }
            });
        });
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_key_down_is_the_chord_of_its_flags() {
            let key = |s: &str| s.parse::<Shortcut>().unwrap();
            assert_eq!(chord(TAB, CGEventFlags::MaskCommand), Some(key("cmd+tab")));
            assert_eq!(chord(TAB, CGEventFlags::MaskCommand | CGEventFlags::MaskShift | CGEventFlags::MaskNonCoalesced), Some(key("cmd+shift+tab")), "stray flags are ignored");
            assert_eq!(chord(TAB, CGEventFlags::MaskAlternate), Some(key("alt+tab")), "not owned, but it is what it is: WATCHED decides");
            assert_eq!(chord(0, CGEventFlags::MaskCommand), None, "cmd+a is nobody's");
        }
    }
}

/// No Dock off macOS: nothing is owned, nothing to tap.
#[cfg(not(target_os = "macos"))]
mod tap {
    pub fn apply(_app: &tauri::AppHandle, _chords: Vec<tauri_plugin_global_shortcut::Shortcut>, _system: Option<tauri_plugin_global_shortcut::Shortcut>, _label: Option<&str>) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(s: &str) -> Shortcut {
        s.parse().unwrap()
    }

    fn root(s: &str) -> Root {
        Root { wanted: s.into(), key: Some(key(s)), error: None }
    }

    #[test]
    fn root_hotkeys_parse_or_fall_back() {
        assert!(parse_roots(&Hotkeys::from("")).is_empty(), "empty is off");
        assert!(parse_roots(&Hotkeys::from([" ", ""])).is_empty());
        assert_eq!(parse_roots(&Hotkeys::from("ctrl+space")), [root("ctrl+space")]);
        assert_eq!(parse_roots(&Hotkeys::from([" alt+p ", "cmd+space"])), [root("alt+p"), root("cmd+space")], "trimmed, in order");
        let [junk] = parse_roots(&Hotkeys::from("not a key")).try_into().unwrap();
        assert_eq!((junk.wanted.as_str(), junk.key), ("not a key", Some(key(FALLBACK))), "junk alone keeps pal reachable");
        assert!(junk.error.unwrap().contains(FALLBACK), "and the entry says which key it got instead");
        let [ok, junk] = parse_roots(&Hotkeys::from(["ctrl+space", "nope"])).try_into().unwrap();
        assert_eq!(ok, root("ctrl+space"));
        assert_eq!(junk.key, None, "junk next to a good entry gets no fallback");
        assert!(junk.error.unwrap().contains("does not parse"));
    }

    #[test]
    fn a_hold_chord_gets_its_shift_variant_unless_it_has_shift() {
        assert_eq!(shifted(&key("alt+tab")), Some(key("shift+alt+tab")));
        assert_eq!(shifted(&key("cmd+ctrl+space")), Some(key("cmd+ctrl+shift+space")));
        assert_eq!(shifted(&key("shift+f13")), None, "shift already: the one chord, no variant");
        assert_eq!(shifted(&key("f13")), Some(key("shift+f13")), "no modifier still gets a back step");
    }

    #[test]
    fn the_dock_owns_cmd_tab_and_its_shift_variant_only() {
        assert!(dock_owned(&key("cmd+tab")));
        assert!(dock_owned(&key("cmd+shift+tab")));
        assert!(dock_owned(&shifted(&key("cmd+tab")).unwrap()));
        assert!(!dock_owned(&key("alt+tab")));
        assert!(!dock_owned(&key("cmd+alt+tab")));
        assert!(!dock_owned(&key("cmd+space")));
    }

    #[test]
    fn spotlight_conflict_only_for_the_same_combination() {
        assert_eq!(spotlight_conflict(None, &key("cmd+space")), None, "off, or Linux: never a conflict");
        assert_eq!(spotlight_conflict(Some("cmd+space"), &key("ctrl+space")), None);
        assert_eq!(spotlight_conflict(Some("cmd+space"), &key("Command+Space")).as_deref(), Some("cmd+space"));
    }

    type Call = Box<dyn FnMut(&Shortcut) -> Result<(), String>>;

    /// A fake OS: refuses the keys in `taken`, records every call.
    fn os(taken: &[&str]) -> (Call, Arc<Mutex<Vec<String>>>, Call) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let (l1, l2) = (log.clone(), log.clone());
        let taken: Vec<Shortcut> = taken.iter().map(|t| key(t)).collect();
        let register = move |s: &Shortcut| {
            l1.lock().unwrap().push(format!("+{s}"));
            if taken.contains(s) { Err("HotKey already registered".into()) } else { Ok(()) }
        };
        let unregister = move |s: &Shortcut| {
            l2.lock().unwrap().push(format!("-{s}"));
            Ok(())
        };
        (Box::new(register), log, Box::new(unregister))
    }

    fn map(entries: &[(&str, Target)]) -> HashMap<Shortcut, Target> {
        entries.iter().map(|(s, t)| (key(s), t.clone())).collect()
    }

    #[test]
    fn two_roots_where_one_is_taken_registers_the_other_and_reports_the_one() {
        let current = map(&[("alt+space", Target::Root)]);
        let wanted = map(&[("cmd+space", Target::Root), ("ctrl+space", Target::Root), ("ctrl+alt+v", Target::Palette("clipboard/history".into()))]);
        let (register, log, unregister) = os(&["ctrl+space"]);
        let (next, failed) = reconcile(&current, &wanted, register, unregister);
        assert_eq!(next, map(&[("cmd+space", Target::Root), ("ctrl+alt+v", Target::Palette("clipboard/history".into()))]), "the taken root is not in the map, the rest are");
        assert_eq!(failed.get(&key("ctrl+space")).map(String::as_str), Some("HotKey already registered"));
        assert!(log.lock().unwrap().contains(&"-alt+Space".to_string()), "the old root goes once a new one is held: {:?}", log.lock().unwrap());
        let o = judge(&[root("cmd+space"), root("ctrl+space")], &next, &failed, None);
        assert!(o.registered, "one works, so pal is reachable");
        assert_eq!(o.hotkeys[0], RootOutcome { wanted: "cmd+space".into(), registered: true, error: None, spotlight: None });
        assert_eq!(o.hotkeys[1], RootOutcome { wanted: "ctrl+space".into(), registered: false, error: Some("HotKey already registered".into()), spotlight: None });
        assert_eq!(o.summary(), "cmd+space registered, ctrl+space failed: HotKey already registered");
    }

    #[test]
    fn every_root_refused_keeps_the_previous_ones() {
        let current = map(&[("alt+space", Target::Root)]);
        let wanted = map(&[("cmd+space", Target::Root), ("ctrl+space", Target::Root)]);
        let (register, log, unregister) = os(&["cmd+space", "ctrl+space"]);
        let (next, failed) = reconcile(&current, &wanted, register, unregister);
        assert_eq!(next, current, "the old root stays registered");
        assert!(!log.lock().unwrap().iter().any(|l| l.starts_with('-')), "nothing unregistered: {:?}", log.lock().unwrap());
        assert_eq!(failed.len(), 2);
        let o = judge(&[root("cmd+space"), root("ctrl+space")], &next, &failed, None);
        assert!(!o.registered);
        assert!(o.hotkeys.iter().all(|h| !h.registered && h.error.is_some()));
    }

    #[test]
    fn spotlight_holding_one_root_fails_that_entry_only() {
        let wanted = map(&[("cmd+space", Target::Root), ("ctrl+space", Target::Root)]);
        let (register, _log, unregister) = os(&[]);
        let (next, failed) = reconcile(&HashMap::new(), &wanted, register, unregister);
        assert!(failed.is_empty(), "macOS accepts the registration for Spotlight's key");
        let o = judge(&[root("cmd+space"), root("ctrl+space")], &next, &failed, Some("cmd+space"));
        assert!(o.registered);
        assert_eq!(o.hotkeys[0], RootOutcome { wanted: "cmd+space".into(), registered: false, error: Some("Spotlight takes this key first".into()), spotlight: Some("cmd+space".into()) });
        assert!(o.hotkeys[1].registered && o.hotkeys[1].spotlight.is_none());
        // Spotlight let go: the same map re-judged says both work.
        let o = judge(&[root("cmd+space"), root("ctrl+space")], &next, &failed, Some("alt+space"));
        assert!(o.hotkeys.iter().all(|h| h.registered && h.error.is_none()));
    }

    #[test]
    fn no_roots_is_registered_and_off() {
        let mut o = judge(&[], &HashMap::new(), &HashMap::new(), None);
        assert!(o.registered && o.hotkeys.is_empty());
        assert_eq!(o.summary(), "off");
        o.hold_blocked = Some("cmd+tab".into());
        assert_eq!(o.summary(), "off; hold cmd+tab needs Input Monitoring");
        let junk = parse_roots(&Hotkeys::from("junk"));
        let o = judge(&junk, &map(&[(FALLBACK, Target::Root)]), &HashMap::new(), None);
        assert!(o.hotkeys[0].registered, "the fallback is what registered");
        assert!(o.hotkeys[0].error.as_deref().unwrap().ends_with("using ctrl+space"));
    }
}
