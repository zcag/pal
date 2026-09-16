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
}

impl Outcome {
    /// One line for the diagnostics: `off`, or every entry with its fate
    /// (`cmd+space registered, ctrl+space failed: HotKey already registered`).
    pub fn summary(&self) -> String {
        if self.hotkeys.is_empty() {
            return "off".into();
        }
        self.hotkeys
            .iter()
            .map(|h| if h.registered { format!("{} registered", h.wanted) } else { format!("{} failed: {}", h.wanted, h.error.as_deref().unwrap_or("unknown")) })
            .collect::<Vec<_>>()
            .join(", ")
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
    Outcome { hotkeys, registered }
}

/// Register what the config wants and drop what it no longer does. A
/// palette's hotkeys are only registered once the palette exists, a bar
/// item's whatever its state (the item may be hidden or not yet
/// rendered; its hotkey still opens it). In a clash the root hotkeys win
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
        // Spotlight (a `defaults` run) is read only when one was.
        drop(_applying);
        let held = outcome(app).hotkeys.iter().any(|h| h.spotlight.is_some()).then(pal_core::spotlight::hotkey).flatten();
        record(app, judge(&roots, &current, &HashMap::new(), held.as_deref()));
        return;
    }
    let shortcuts = app.global_shortcut();
    let (next, failed) = reconcile(&current, &wanted, |s| shortcuts.register(*s).map_err(|e| e.to_string()), |s| shortcuts.unregister(*s).map_err(|e| e.to_string()));
    *lock(&registered.map) = next.clone();
    drop(_applying);
    // Spotlight is read only for a root that changed or failed, which is
    // where this is: the early return above covers the rest.
    let held = (!roots.is_empty()).then(pal_core::spotlight::hotkey).flatten();
    record(app, judge(&roots, &next, &failed, held.as_deref()));
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
        let o = judge(&[], &HashMap::new(), &HashMap::new(), None);
        assert!(o.registered && o.hotkeys.is_empty());
        assert_eq!(o.summary(), "off");
        let junk = parse_roots(&Hotkeys::from("junk"));
        let o = judge(&junk, &map(&[(FALLBACK, Target::Root)]), &HashMap::new(), None);
        assert!(o.hotkeys[0].registered, "the fallback is what registered");
        assert!(o.hotkeys[0].error.as_deref().unwrap().ends_with("using ctrl+space"));
    }
}
