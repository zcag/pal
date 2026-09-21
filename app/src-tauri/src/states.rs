//! The live states table (`pal_core::states`, `docs/design/states.md`):
//! the built-ins fed from what the app already watches, the manual and
//! published layers persisted in `<data dir>/states.json` (which also
//! carries every resolved value, so `pal state` reads it in its own
//! process the way `pal bar list` reads bar.json), the expiry timer, and
//! the fan-out of a change: the bar items whose
//! `show_when`/`hide_when` read it are re-placed and those that asked for
//! `state:<name>` render; the pages hear `pal://states`; the host hears
//! `states/changed` for `state.onChange`.
//!
//! `core/states.{get, set, list, eval}` are the SDK's; `manual`, `reset`,
//! `declare` and `undeclare` are the States palette's (extensions/states),
//! which is the one extension that manages states rather than reads them.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pal_core::config::Config;
use pal_core::states::{Entry, Persisted, States};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::{events, lock, settings};

/// `<data dir>/states.json`: the layers that survive a relaunch plus the
/// resolved table for the CLI.
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Feed {
    #[serde(flatten)]
    pub persisted: Persisted,
    pub entries: Vec<Entry>,
    pub diagnostics: Vec<pal_core::config::Diagnostic>,
}

/// The feed as last written, for the CLI's own process.
pub fn read_feed() -> Feed {
    std::fs::read(feed_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub struct Live {
    states: Mutex<States>,
    /// Bumped on every change to the manual layer, to cancel the sleeping expiry task.
    gen: AtomicU64,
}

pub fn feed_path() -> PathBuf {
    pal_core::fs::data_dir().join("states.json")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut States) -> T) -> T {
    let st = app.state::<Live>();
    let mut s = lock(&st.states);
    f(&mut s)
}

pub fn install(app: &AppHandle) {
    let mut states = States::default();
    states.load(read_feed().persisted);
    let config = settings::config(app);
    states.configure(&config.states, &config.bar.conditions());
    for d in states.diagnostics() {
        eprintln!("states\t{:?}\t{}\t{}", d.level, d.path, d.message);
    }
    app.manage(Live { states: Mutex::new(states), gen: AtomicU64::new(0) });
    write_feed(app);
    builtins::install(app);
    arm_expiry(app);
}

/// The config was reloaded: `[states]` or a `show_when`/`hide_when` changed.
pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    if prev.states == next.states && prev.bar.conditions() == next.bar.conditions() {
        return;
    }
    let changed = with(app, |s| {
        let c = s.configure(&next.states, &next.bar.conditions());
        for d in s.diagnostics() {
            eprintln!("states\t{:?}\t{}\t{}", d.level, d.path, d.message);
        }
        c
    });
    // Every conditioned item is re-placed: a condition may have been added or removed without a value changing.
    crate::bar::on_states_changed(app, &changed, true);
    fan_out(app, changed);
}

/// A change went through: write the feed, re-place and re-render the bar
/// items reading it, tell the pages and the host.
fn fan_out(app: &AppHandle, changed: Vec<String>) {
    write_feed(app);
    if changed.is_empty() {
        return;
    }
    let values: serde_json::Map<String, Value> = with(app, |s| changed.iter().map(|n| (n.clone(), s.get(n).cloned().unwrap_or(Value::Null))).collect());
    eprintln!("states\tchanged\t{}", serde_json::to_string(&values).unwrap_or_default());
    crate::bar::on_states_changed(app, &changed, false);
    events::emit(app, events::STATES, json!({ "states": values }));
    if let Some(host) = app.try_state::<Arc<Host>>() {
        let host = host.inner().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = host.notify("states/changed", json!({ "states": values })).await {
                eprintln!("states\tpush failed\t{e}");
            }
        });
    }
}

fn write_feed(app: &AppHandle) {
    let feed = with(app, |s| Feed { persisted: s.persisted(), entries: s.list(), diagnostics: s.diagnostics().to_vec() });
    if let Err(e) = pal_core::fs::write_atomic(&feed_path(), serde_json::to_vec_pretty(&feed).unwrap_or_default()) {
        eprintln!("states\tfeed write failed\t{e}");
    }
}

/// `pal state set`: the manual layer, until `until` (unix ms) or reset.
pub fn set_manual(app: &AppHandle, name: &str, value: Value, until: Option<u64>) -> Result<(), String> {
    let changed = with(app, |s| s.set_manual(name, value, until))?;
    app.state::<Live>().gen.fetch_add(1, Ordering::SeqCst);
    fan_out(app, changed);
    crate::bar::on_states_held(app);
    arm_expiry(app);
    Ok(())
}

/// `pal state reset`: the manual layer goes.
pub fn reset(app: &AppHandle, name: &str) {
    let changed = with(app, |s| s.reset(name));
    app.state::<Live>().gen.fetch_add(1, Ordering::SeqCst);
    fan_out(app, changed);
    crate::bar::on_states_held(app);
    arm_expiry(app);
}

/// An extension's `state.set`: lands under `<who>/<name>`; `null` withdraws.
pub fn publish(app: &AppHandle, who: &str, name: &str, value: Value) -> Result<(), String> {
    if name.contains('/') {
        return Err("an extension publishes under its own name: pass the bare state name".into());
    }
    let full = format!("{who}/{name}");
    let changed = with(app, |s| s.publish(&full, who, value))?;
    fan_out(app, changed);
    Ok(())
}

/// A built-in's value; not persisted.
fn builtin(app: &AppHandle, name: &str, value: Value) {
    match with(app, |s| s.publish(name, "builtin", value)) {
        Ok(changed) => fan_out(app, changed),
        Err(e) => eprintln!("states\tbuiltin {name}\t{e}"),
    }
}

/// The panel showed or hid (lib.rs): the `panel` built-in.
pub fn on_panel(app: &AppHandle, shown: bool) {
    if app.try_state::<Live>().is_some() {
        builtin(app, "panel", json!(shown));
    }
}

/// The resolved value, `None` when no such state.
pub fn get(app: &AppHandle, name: &str) -> Option<Value> {
    with(app, |s| s.get(name).cloned())
}

pub fn list(app: &AppHandle) -> Vec<Entry> {
    with(app, |s| s.list())
}

/// Whether the bar item `key` shows by its `show_when`/`hide_when`.
pub fn shows(app: &AppHandle, key: &str) -> bool {
    app.try_state::<Live>().is_none_or(|st| lock(&st.states).shows(key))
}

/// The bar items whose condition reads one of `changed`.
pub fn bar_items_reading(app: &AppHandle, changed: &[String]) -> Vec<String> {
    with(app, |s| s.bar_items_reading(changed))
}

/// `pal state eval`.
pub fn eval(app: &AppHandle, expr: &str) -> Result<Value, String> {
    with(app, |s| s.eval(expr))
}

/// One sleeping task until the nearest `until`; a change to the manual
/// layer bumps `gen` and the woken task, finding itself stale, does nothing.
fn arm_expiry(app: &AppHandle) {
    let Some(until) = with(app, |s| s.next_expiry()) else { return };
    let gen = app.state::<Live>().gen.load(Ordering::SeqCst);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(until.saturating_sub(now_ms()).max(1))).await;
        if handle.state::<Live>().gen.load(Ordering::SeqCst) != gen {
            return;
        }
        let changed = with(&handle, |s| s.expire(now_ms()));
        fan_out(&handle, changed);
        crate::bar::on_states_held(&handle);
        arm_expiry(&handle);
    });
}

/// `core/states.{get, set, list, eval}` from the host (bridge.rs).
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let ext = params["extension"].as_str().ok_or("states: no extension")?;
    match func {
        "get" => match params["name"].as_str() {
            Some(name) => Ok(get(app, name).unwrap_or(Value::Null)),
            None => Ok(with(app, |s| serde_json::to_value(s.values()).unwrap_or_default())),
        },
        "set" => {
            let name = params["name"].as_str().ok_or("states.set: no name")?;
            publish(app, ext, name, params["value"].clone())?;
            Ok(Value::Null)
        }
        "list" => Ok(serde_json::to_value(list(app)).unwrap_or_default()),
        "eval" => eval(app, params["expr"].as_str().ok_or("states.eval: no expr")?),
        // The States palette's own: a value by hand, its reset, and a `[states.<name>]` table written or removed.
        "manual" => {
            let name = params["name"].as_str().ok_or("states.manual: no name")?;
            let until = params["until"].as_u64();
            set_manual(app, name, params["value"].clone(), until)?;
            Ok(Value::Null)
        }
        "reset" => {
            reset(app, params["name"].as_str().ok_or("states.reset: no name")?);
            Ok(Value::Null)
        }
        "declare" => {
            let name = params["name"].as_str().ok_or("states.declare: no name")?;
            if !pal_core::states::is_bare(name) || pal_core::states::BUILTINS.contains(&name) {
                return Err(format!("not a name for a state of yours: {name}"));
            }
            let changes = ["expr", "default", "description"].into_iter().map(|k| (format!("states.{name}.{k}"), params.get(k).filter(|v| !v.is_null()).cloned()));
            let mut changes: Vec<_> = changes.collect();
            // An empty table declares the state: keep `default = false` when nothing else is set, so the table is not empty.
            if changes.iter().all(|(_, v)| v.is_none()) {
                changes[1].1 = Some(json!(false));
            }
            settings::file(app).set_many(changes).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "undeclare" => {
            let name = params["name"].as_str().ok_or("states.undeclare: no name")?;
            settings::file(app).unset(&format!("states.{name}")).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err(format!("unknown states.{func}")),
    }
}

/// `--for`: `90s`, `25m`, `1h30m`, `2h`, `1d`; a bare number is minutes. Seconds.
pub fn parse_duration(s: &str) -> Option<u64> {
    let s: String = s.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_lowercase();
    if s.is_empty() {
        return None;
    }
    if let Ok(n) = s.parse::<u64>() {
        return Some(n * 60);
    }
    let mut total = 0u64;
    let mut rest = s.as_str();
    while !rest.is_empty() {
        let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        let (digits, tail) = rest.split_at(end);
        let n: u64 = digits.parse().ok()?;
        let unit_end = tail.find(|c: char| c.is_ascii_digit()).unwrap_or(tail.len());
        let (unit, next) = tail.split_at(unit_end);
        total += n * match unit {
            "s" | "sec" | "secs" => 1,
            "m" | "min" | "mins" => 60,
            "h" | "hr" | "hrs" => 3600,
            "d" | "day" | "days" => 86_400,
            _ => return None,
        };
        rest = next;
    }
    Some(total)
}

/// `--until HH:MM`: that time today, or tomorrow when it has passed. Unix ms.
pub fn parse_until(s: &str) -> Option<u64> {
    let (h, m) = s.trim().split_once(':')?;
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    if !(0..24).contains(&h) || !(0..60).contains(&m) {
        return None;
    }
    let (now_h, now_m) = { let t = builtins::local_time(); (t.0, t.1) };
    let mut delta = (h * 60 + m) - (now_h * 60 + now_m);
    if delta <= 0 {
        delta += 24 * 60;
    }
    Some(now_ms() + delta as u64 * 60_000)
}

/// `pal state watch`: `name<TAB>value` per change, from the feed file
/// (the instance rewrites it on every change), until killed.
pub fn watch_feed() -> i32 {
    use notify::Watcher as _;
    let path = feed_path();
    let (tx, rx) = std::sync::mpsc::channel();
    let mut w = match notify::recommended_watcher(move |_| { let _ = tx.send(()); }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("pal\twatch: {e}");
            return 1;
        }
    };
    let dir = path.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let _ = std::fs::create_dir_all(&dir);
    if let Err(e) = w.watch(&dir, notify::RecursiveMode::NonRecursive) {
        eprintln!("pal\twatch: {e}");
        return 1;
    }
    let mut last: std::collections::BTreeMap<String, Value> = read_feed().entries.into_iter().map(|e| (e.name, e.value)).collect();
    while rx.recv().is_ok() {
        // The burst of a write settles; one read after it.
        while rx.recv_timeout(Duration::from_millis(50)).is_ok() {}
        let now: std::collections::BTreeMap<String, Value> = read_feed().entries.into_iter().map(|e| (e.name, e.value)).collect();
        for (k, v) in &now {
            if last.get(k) != Some(v) {
                println!("{k}\t{v}");
            }
        }
        for k in last.keys().filter(|k| !now.contains_key(*k)) {
            println!("{k}\tnull");
        }
        last = now;
    }
    0
}

// ---- built-ins -----------------------------------------------------------

mod builtins {
    use super::*;

    /// The clock on the minute boundary (`hour`, `minute`, `weekday`,
    /// `date`), `host` and `theme` once and on the minute, `idle` and
    /// `network` on the minute; macOS adds `front_app`, `awake_since`
    /// and `locked` from notifications.
    pub fn install(app: &AppHandle) {
        builtin(app, "host", hostname());
        builtin(app, "panel", json!(false));
        clock(app);
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let ms = now_ms();
                tokio::time::sleep(Duration::from_millis(60_000 - ms % 60_000)).await;
                clock(&handle);
            }
        });
        #[cfg(target_os = "macos")]
        macos::install(app);
    }

    fn clock(app: &AppHandle) {
        let (hour, minute, weekday, date) = local_time();
        builtin(app, "hour", json!(hour));
        builtin(app, "minute", json!(minute));
        builtin(app, "weekday", json!(weekday));
        builtin(app, "date", json!(date));
        builtin(app, "theme", theme(app));
        builtin(app, "idle", idle());
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || builtin(&handle, "network", network()));
    }

    fn hostname() -> Value {
        std::process::Command::new("hostname").arg("-s").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty()).map_or(Value::Null, Value::String)
    }

    /// `(hour, minute, weekday, date)` in local time; libc's `localtime_r` is
    /// the one portable reader of the zone without a crate.
    pub fn local_time() -> (i64, i64, &'static str, String) {
        const DAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as libc::time_t).unwrap_or(0);
        // SAFETY: `localtime_r` writes the struct it is given; a zeroed tm is a valid out-parameter.
        let tm = unsafe {
            let mut tm: libc::tm = std::mem::zeroed();
            libc::localtime_r(&t, &mut tm);
            tm
        };
        (tm.tm_hour as i64, tm.tm_min as i64, DAYS[(tm.tm_wday.clamp(0, 6)) as usize], format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday))
    }

    fn theme(app: &AppHandle) -> Value {
        match app.get_webview_window(crate::WINDOW).and_then(|w| w.theme().ok()) {
            Some(tauri::Theme::Dark) => json!("dark"),
            Some(_) => json!("light"),
            None => Value::Null,
        }
    }

    fn network() -> Value {
        match pal_core::wifi::status() {
            Ok(s) => match s.current {
                Some(c) => c.ssid.map_or(json!("wifi"), Value::String),
                None => json!("none"),
            },
            Err(_) => Value::Null,
        }
    }

    #[cfg(target_os = "macos")]
    fn idle() -> Value {
        use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};
        // kCGAnyInputEventType is ~0.
        json!(CGEventSource::seconds_since_last_event_type(CGEventSourceStateID::CombinedSessionState, CGEventType(!0)) as i64)
    }

    #[cfg(not(target_os = "macos"))]
    fn idle() -> Value {
        Value::Null
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        use objc2_app_kit::{NSWorkspace, NSWorkspaceDidActivateApplicationNotification, NSWorkspaceDidWakeNotification};
        use objc2_foundation::{ns_string, NSDistributedNotificationCenter, NSNotification, NSNotificationCenter, NSString};

        pub fn install(app: &AppHandle) {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                builtin(&handle, "front_app", front_app());
                builtin(&handle, "locked", json!(false));
                let observe = |center: &NSNotificationCenter, name: &NSString, f: Box<dyn Fn() + 'static>| {
                    let block = block2::RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| f());
                    // Leaked on purpose: the observation lasts the process.
                    let token = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) };
                    std::mem::forget(token);
                };
                let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
                let h = handle.clone();
                observe(&workspace, unsafe { NSWorkspaceDidActivateApplicationNotification }, Box::new(move || builtin(&h, "front_app", front_app())));
                let h = handle.clone();
                observe(&workspace, unsafe { NSWorkspaceDidWakeNotification }, Box::new(move || builtin(&h, "awake_since", json!(now_ms()))));
                let dist = NSDistributedNotificationCenter::defaultCenter();
                for (name, locked) in [(ns_string!("com.apple.screenIsLocked"), true), (ns_string!("com.apple.screenIsUnlocked"), false)] {
                    let h = handle.clone();
                    observe(&dist, name, Box::new(move || builtin(&h, "locked", json!(locked))));
                }
            });
        }

        fn front_app() -> Value {
            let Some(a) = NSWorkspace::sharedWorkspace().frontmostApplication() else { return Value::Null };
            a.bundleIdentifier().or_else(|| a.localizedName()).map_or(Value::Null, |s| Value::String(s.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations() {
        assert_eq!(parse_duration("90s"), Some(90));
        assert_eq!(parse_duration("25m"), Some(1500));
        assert_eq!(parse_duration("1h30m"), Some(5400));
        assert_eq!(parse_duration("2h"), Some(7200));
        assert_eq!(parse_duration("1d"), Some(86_400));
        assert_eq!(parse_duration("25"), Some(1500), "a bare number is minutes");
        assert_eq!(parse_duration("1 h"), Some(3600));
        assert_eq!(parse_duration("x"), None);
        assert_eq!(parse_duration("1w"), None);
    }

    #[test]
    fn until_is_within_a_day() {
        let u = parse_until("18:00").unwrap();
        let d = u.saturating_sub(now_ms());
        assert!(d > 0 && d <= 24 * 3_600_000);
        assert_eq!(parse_until("25:00"), None);
        assert_eq!(parse_until("noon"), None);
    }
}
