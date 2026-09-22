//! Keycast: the keys pressed and the cursor's clicks drawn over the screen
//! for a recording or a screen share (`pal_core::keycast` is the pure
//! part: the caps for an event, the feed that coalesces repeats). The
//! events come off the shared key monitor (keytap.rs), so expansion and
//! keycast on together cost one monitor; the capability is
//! `core/keycast.{status, start, stop, toggle}` for the `keycast`
//! extension, whose rows, links and bar item are the way in.
//!
//! The overlay is its own window (`keycast`, `index.html?keycast`, made
//! here like the bar popover's): an NSPanel like the HUD's
//! (`panel::keycast_install`: never key, the mouse passing through, every
//! Space, above everything, kept alive hidden), sized to the whole display
//! under the cursor and moved to another when the cursor crosses. The page
//! (KeycastPage.tsx) draws the key strip at the configured corner and the
//! cursor ring with its click ripples; this side sends it the feed after
//! every key (`pal://keycast`, `{ kind: "keys" }`), the cursor at most
//! every [`MOVE_MS`] (`{ kind: "cursor" }`) and every click
//! (`{ kind: "click" }`), all in the window's own CSS pixels.
//!
//! What is never shown: anything typed while a secure text field has the
//! keyboard (`Event::secure`, `IsSecureEventInputEnabled`: a password
//! prompt, `sudo`), and with `shortcuts_only` plain typing (a key without
//! cmd, ctrl or alt that is not a navigation or function key). pal's own
//! panel is invisible to a global monitor, so what is typed into pal is
//! never drawn either. Starting asks for Input Monitoring once when it is
//! missing (`permissions::request_once`), the way expansion does; the
//! extension's row says so and asks again on Enter.
//!
//! Settings are the extension's (`extensions/keycast/pal.json`, read the
//! way expansion reads snippets'): the default mode, the strip's corner,
//! scale, hold and length, `shortcuts_only`, the ring's colour and whether
//! clicks ripple. Whether it is on and in which mode is runtime state, not
//! config: `keycast/active` and `keycast/mode` are published as states so
//! the bar item follows. Linux: no portable input tap (Wayland hands input
//! to the focused client only), so `status` says `available: false` and
//! the extension shows one row.

// Off macOS the window is never made and `start` refuses; the state and the settings still compile and their tests run.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pal_core::config::{spec_defaults, Config};
use pal_core::keycast::{caps, click_caps, Entry, Feed, KeyEvent, Options, Phase};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

use crate::keytap::{self, Event, Kind, Wants};
use crate::{events, lock, panel, permissions, settings};

pub const WINDOW: &str = "keycast";
/// Where the overlay can be drawn and the keys watched.
pub const SUPPORTED: bool = cfg!(target_os = "macos");
/// The cursor is sent to the page at most this often: 50 a second reads
/// smooth under a CSS transition, and the monitor delivers far more.
const MOVE_MS: Duration = Duration::from_millis(20);
/// How often a move checks which display the cursor is on.
const FOLLOW_MS: Duration = Duration::from_millis(250);
const UNAVAILABLE: &str = "Keycast is not available on Linux: there is no portable input tap (Wayland hands input to the focused app only)";

/// The extension's manifest, compiled in: its `settings` defaults are the
/// overlay's too, so a key absent from the file means what Settings shows.
const MANIFEST: &str = include_str!("../../../extensions/keycast/pal.json");

/// What the overlay draws: the key strip, the cursor ring, or both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Keys,
    Cursor,
    Both,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s.trim() {
            "keys" => Some(Mode::Keys),
            "cursor" => Some(Mode::Cursor),
            "both" => Some(Mode::Both),
            _ => None,
        }
    }

    fn keys(self) -> bool {
        matches!(self, Mode::Keys | Mode::Both)
    }

    fn cursor(self) -> bool {
        matches!(self, Mode::Cursor | Mode::Both)
    }

    fn name(self) -> &'static str {
        match self {
            Mode::Keys => "keys",
            Mode::Cursor => "cursor",
            Mode::Both => "both",
        }
    }

    /// What the monitor has to deliver for the mode and the settings: keys
    /// and the clicks that carry modifiers for the strip, clicks for the
    /// ripples, the moves only while there is a ring to ride them, and
    /// scrolls and gestures only where the strip is drawn and wanted.
    fn wants(self, s: &Settings) -> Wants {
        let strip = self.keys() && s.gestures;
        Wants { keys: self.keys(), clicks: true, moves: self.cursor() && s.ring, scrolls: strip, gestures: strip }
    }
}

/// `[extensions.keycast]` as the overlay reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    pub mode: String,
    pub position: String,
    pub scale: f64,
    pub hold: f64,
    pub max: u64,
    pub shortcuts_only: bool,
    pub ring: bool,
    pub ring_color: String,
    pub ripples: bool,
    pub gestures: bool,
}

impl Settings {
    /// From a loaded config: the manifest's defaults under the file's
    /// keys; a value of the wrong type is logged and the defaults stand in.
    pub fn from(config: &Config) -> Settings {
        let manifest: Value = serde_json::from_str(MANIFEST).expect("bundled pal.json parses");
        let defaults = spec_defaults(&manifest["settings"]);
        let table = config.extension_settings("keycast", &defaults, &manifest["settings"]);
        table.try_into().unwrap_or_else(|e| {
            eprintln!("keycast\tbad settings\t{e}; using the defaults");
            defaults.try_into().expect("manifest defaults fit Settings")
        })
    }

    fn options(&self) -> Options {
        Options { hold_ms: (self.hold.max(0.2) * 1000.0) as u64, max: self.max.clamp(1, 12) as usize }
    }

    fn mode(&self) -> Mode {
        Mode::parse(&self.mode).unwrap_or(Mode::Both)
    }
}

/// The live state: on or off, the mode, the strip's feed and the pacing
/// of what goes to the page.
struct State {
    active: bool,
    mode: Mode,
    settings: Settings,
    feed: Feed,
    last_move: Instant,
    last_follow: Instant,
    /// The display the window covers, by name; `None` until placed.
    display: Option<String>,
}

pub struct Keycast(Mutex<State>);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// What `status` answers and every `start`/`stop`/`toggle` answers with.
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    pub active: bool,
    pub mode: Mode,
    pub input_monitoring: bool,
    pub settings: Settings,
}

/// What the page is told on every change of state or settings.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Payload<'a> {
    State { active: bool, mode: Mode, settings: &'a Settings },
    Keys { entries: Vec<Entry> },
    Cursor { x: f64, y: f64 },
    Click { button: &'static str, x: f64, y: f64, down: bool },
    /// The display the window now covers: the work area's insets from its
    /// edges (top, right, bottom, left; the menu bar, the Dock), CSS pixels,
    /// so the strip keeps clear of them.
    Display { inset: [f64; 4] },
}

/// Startup: the settings as loaded, the window (macOS), nothing watched yet.
pub fn install(app: &AppHandle) {
    let settings = Settings::from(&settings::config(app));
    let now = Instant::now();
    let st = State { active: false, mode: settings.mode(), feed: Feed::new(settings.options()), settings, last_move: now, last_follow: now, display: None };
    app.manage(Keycast(Mutex::new(st)));
    if !SUPPORTED {
        eprintln!("keycast\tnot available off macOS (no portable input tap)");
        return;
    }
    let builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html?keycast".into()))
        .title("pal Keycast")
        .inner_size(800.0, 600.0)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focusable(false)
        .shadow(false)
        .accept_first_mouse(false)
        .visible(false);
    match builder.build() {
        Ok(w) => panel::keycast_install(&w),
        Err(e) => eprintln!("keycast\twindow failed\t{e}"),
    }
}

/// A config reload: the settings are re-read; the feed and the page follow.
pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    let (before, after) = (Settings::from(prev), Settings::from(next));
    if before == after {
        return;
    }
    let Some(st) = app.try_state::<Keycast>() else { return };
    let mut s = lock(&st.0);
    s.feed.opts = after.options();
    let wants = (s.mode.wants(&before), s.mode.wants(&after));
    s.settings = after;
    if s.active {
        let p = Payload::State { active: true, mode: s.mode, settings: &s.settings };
        events::emit_to(app, WINDOW, events::KEYCAST, p);
        if wants.0 != wants.1 {
            drop(s);
            keytap::subscribe(app, "keycast", wants.1, on_event);
        }
    }
}

/// Whether the overlay is on, for the Overview's Input Monitoring row.
pub fn active(app: &AppHandle) -> bool {
    app.try_state::<Keycast>().is_some_and(|st| lock(&st.0).active)
}

pub fn status(app: &AppHandle) -> Status {
    let st = app.state::<Keycast>();
    let s = lock(&st.0);
    Status { available: SUPPORTED, reason: (!SUPPORTED).then_some(UNAVAILABLE), active: s.active, mode: s.mode, input_monitoring: permissions::input_monitoring(), settings: s.settings.clone() }
}

/// `keycast/active` and `keycast/mode` for the states table, off the
/// calling thread as the built-ins are (states.rs: the fan-out takes the
/// bar registry, which may be waiting on the main thread).
fn publish(app: &AppHandle, active: bool, mode: Mode) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for (name, v) in [("active", json!(active)), ("mode", json!(active.then(|| mode.name())))] {
            if let Err(e) = crate::states::publish(&app, "keycast", name, v) {
                eprintln!("keycast\tstates\t{e}");
            }
        }
    });
}

/// On, in `mode` (the setting's default without one): the window placed
/// on the cursor's display and shown, the monitor subscribed for what the
/// mode draws. Already on: the mode switches in place.
pub fn start(app: &AppHandle, mode: Option<Mode>) -> Result<Status, String> {
    if !SUPPORTED {
        return Err(UNAVAILABLE.into());
    }
    let st = app.state::<Keycast>();
    let (was, mode, wants) = {
        let mut s = lock(&st.0);
        let mode = mode.unwrap_or_else(|| s.settings.mode());
        let was = s.active;
        s.active = true;
        s.mode = mode;
        s.feed.clear();
        s.display = None;
        (was, mode, mode.wants(&s.settings))
    };
    eprintln!("keycast\t{}\t{}", if was { "mode" } else { "start" }, mode.name());
    if !permissions::input_monitoring() {
        permissions::request_once(app, "input_monitoring");
    }
    keytap::subscribe(app, "keycast", wants, on_event);
    tell_page(app);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        follow(&handle);
        panel::keycast_show(&handle);
    });
    publish(app, true, mode);
    Ok(status(app))
}

/// Off: the monitor unsubscribed, the window hidden, the strip emptied.
pub fn stop(app: &AppHandle) -> Status {
    let st = app.state::<Keycast>();
    let (was, mode) = {
        let mut s = lock(&st.0);
        let was = std::mem::replace(&mut s.active, false);
        s.feed.clear();
        (was, s.mode)
    };
    if was {
        eprintln!("keycast\tstop");
        keytap::unsubscribe(app, "keycast");
        tell_page(app);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || panel::keycast_hide(&handle));
        publish(app, false, mode);
    }
    status(app)
}

/// `pal://keycast/toggle?mode=`: off to on in the mode (or the default);
/// on in that mode, or on with no mode named, to off; on in another mode
/// switches.
pub fn toggle(app: &AppHandle, mode: Option<Mode>) -> Result<Status, String> {
    let (active, current) = {
        let st = app.state::<Keycast>();
        let s = lock(&st.0);
        (s.active, s.mode)
    };
    match (active, mode) {
        (false, m) => start(app, m),
        (true, Some(m)) if m != current => start(app, Some(m)),
        (true, _) => Ok(stop(app)),
    }
}

/// The page's picture of the state and the settings.
fn tell_page(app: &AppHandle) {
    let st = app.state::<Keycast>();
    let s = lock(&st.0);
    events::emit_to(app, WINDOW, events::KEYCAST, Payload::State { active: s.active, mode: s.mode, settings: &s.settings });
}

pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let mode = match params.get("mode").and_then(Value::as_str) {
        Some(m) => Some(Mode::parse(m).ok_or_else(|| format!("unknown mode {m}: keys, cursor or both"))?),
        None => None,
    };
    let s = match func {
        "status" => status(app),
        "start" => start(app, mode)?,
        "stop" => stop(app),
        "toggle" => toggle(app, mode)?,
        _ => return Err(format!("unknown keycast.{func}")),
    };
    serde_json::to_value(s).map_err(|e| e.to_string())
}

// ---- events -----------------------------------------------------------------

/// The cursor in the overlay window's CSS pixels: the OS position less
/// the window's, over its scale.
fn cursor(app: &AppHandle) -> Option<(f64, f64)> {
    let w = app.get_webview_window(WINDOW)?;
    let c = app.cursor_position().ok()?;
    let p = w.outer_position().ok()?;
    let scale = w.scale_factor().unwrap_or(1.0);
    Some((((c.x - p.x as f64) / scale * 10.0).round() / 10.0, ((c.y - p.y as f64) / scale * 10.0).round() / 10.0))
}

/// The display under `cursor` (physical pixels) among `monitors`, by a
/// hit test of our own: tauri's `monitor_from_point` answered none for
/// a cursor plainly inside the one display on hornet (seen 2026-09-22,
/// from a monitor block on the main thread), and the popover's
/// `displays` already hit-tests this way. The first when none holds it.
fn display_under(monitors: Vec<tauri::Monitor>, cursor: Option<(f64, f64)>) -> Option<tauri::Monitor> {
    let hit = cursor.and_then(|(x, y)| {
        monitors.iter().position(|m| {
            let (px, py) = (m.position().x as f64, m.position().y as f64);
            x >= px && x < px + m.size().width as f64 && y >= py && y < py + m.size().height as f64
        })
    });
    let mut monitors = monitors;
    match hit {
        Some(i) => Some(monitors.swap_remove(i)),
        None => monitors.into_iter().next(),
    }
}

/// The window over the display under the cursor (main thread): moved and
/// sized to it when the cursor is on another than the one it covers.
fn follow(app: &AppHandle) {
    let cursor = app.cursor_position().ok().map(|c| (c.x, c.y));
    let Some(m) = display_under(app.available_monitors().unwrap_or_default(), cursor) else { return };
    let name = m.name().cloned().unwrap_or_default();
    let st = app.state::<Keycast>();
    {
        let mut s = lock(&st.0);
        s.last_follow = Instant::now();
        if s.display.as_deref() == Some(name.as_str()) {
            return;
        }
        s.display = Some(name.clone());
    }
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let _ = w.set_size(*m.size());
    let _ = w.set_position(PhysicalPosition::new(m.position().x, m.position().y));
    let (p, size, wa, scale) = (m.position(), m.size(), m.work_area(), m.scale_factor());
    let px = |v: i32| v as f64 / scale;
    let inset = [px(wa.position.y - p.y), px(p.x + size.width as i32 - wa.position.x - wa.size.width as i32), px(p.y + size.height as i32 - wa.position.y - wa.size.height as i32), px(wa.position.x - p.x)];
    eprintln!("keycast\tdisplay\t{name}\t{}x{}\tinset {inset:?}", size.width, size.height);
    events::emit_to(app, WINDOW, events::KEYCAST, Payload::Display { inset });
}

/// The page's first question on load: where things stand, so a page that
/// loads (or reloads) while the overlay is on draws it at once.
#[tauri::command]
pub fn keycast_state(app: AppHandle) -> Status {
    status(&app)
}

/// The shared monitor's delivery (main thread): keys and modified clicks
/// into the strip, clicks and moves to the ring.
fn on_event(app: &AppHandle, ev: &Event) {
    let st = app.state::<Keycast>();
    let mut s = lock(&st.0);
    if !s.active {
        return;
    }
    let mode = s.mode;
    match ev.kind {
        Kind::KeyDown => {
            if ev.secure || !mode.keys() {
                return;
            }
            let key = KeyEvent { code: ev.code, mods: ev.mods, chars: ev.chars.clone(), base: ev.base.clone() };
            let Some(c) = caps(&key, s.settings.shortcuts_only) else { return };
            s.feed.push(c, now_ms());
            let entries = s.feed.entries().iter().cloned().collect();
            drop(s);
            follow(app);
            events::emit_to(app, WINDOW, events::KEYCAST, Payload::Keys { entries });
        }
        Kind::MouseDown(b) | Kind::MouseUp(b) => {
            let down = matches!(ev.kind, Kind::MouseDown(_));
            let mut entries = None;
            if down && mode.keys() && !ev.secure {
                if let Some(c) = click_caps(b, ev.mods) {
                    s.feed.push(c, now_ms());
                    entries = Some(s.feed.entries().iter().cloned().collect());
                }
            }
            drop(s);
            if down {
                follow(app);
            }
            if let Some(entries) = entries {
                events::emit_to(app, WINDOW, events::KEYCAST, Payload::Keys { entries });
            }
            if mode.cursor() {
                if let Some((x, y)) = cursor(app) {
                    events::emit_to(app, WINDOW, events::KEYCAST, Payload::Click { button: b.name(), x, y, down });
                }
            }
        }
        Kind::MouseMoved => {
            if !mode.cursor() || s.last_move.elapsed() < MOVE_MS {
                return;
            }
            s.last_move = Instant::now();
            let refollow = s.last_follow.elapsed() >= FOLLOW_MS;
            drop(s);
            if refollow {
                follow(app);
            }
            if let Some((x, y)) = cursor(app) {
                events::emit_to(app, WINDOW, events::KEYCAST, Payload::Cursor { x, y });
            }
        }
        // A scroll or a gesture on the strip: the same gates as a key (the strip drawn, no secure field), the feed decides whether anything moved.
        Kind::Scroll | Kind::Gesture(_) => {
            if ev.secure || !mode.keys() || !s.settings.gestures {
                return;
            }
            let now = now_ms();
            // One line at the start of a trackpad stretch and at a gesture's edges (never per event, never per wheel notch): what the trackpad actually delivers to a global monitor.
            match (ev.scroll, ev.gesture) {
                (Some(sc), _) if sc.phase == Phase::Began => eprintln!("keycast\tscroll\tbegan\t{:.1},{:.1}", sc.dx, sc.dy),
                (_, Some(g)) if g.phase != Phase::Changed => eprintln!("keycast\tgesture\t{:?}\t{:?}\t{:.3}\t{:.0},{:.0}", g.kind, g.phase, g.amount, g.dx, g.dy),
                _ => {}
            }
            let changed = match (ev.scroll, ev.gesture) {
                (Some(sc), _) => s.feed.scroll(&sc, now),
                (_, Some(g)) => s.feed.gesture(&g, now),
                _ => false,
            };
            if !changed {
                return;
            }
            let entries = s.feed.entries().iter().cloned().collect();
            drop(s);
            events::emit_to(app, WINDOW, events::KEYCAST, Payload::Keys { entries });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_defaults_fit_the_overlay() {
        let s = Settings::from(&Config::default());
        assert_eq!(s.mode(), Mode::Both);
        assert_eq!(s.position, "bottom-center");
        assert_eq!(s.scale, 1.0);
        assert_eq!(s.options(), Options { hold_ms: 2000, max: 5 });
        assert!(!s.shortcuts_only);
        assert!(s.ring && s.ripples && s.gestures);
        assert_eq!(s.ring_color, "blue");
    }

    #[test]
    fn the_file_overrides_the_defaults_and_the_feed_options_are_clamped() {
        let mut c = Config::default();
        let t: toml::Table = toml::from_str("mode = \"keys\"\nhold = 0.05\nmax = 40\nshortcuts_only = true\nring_color = \"pink\"").unwrap();
        c.extensions.insert("keycast".into(), t);
        let s = Settings::from(&c);
        assert_eq!(s.mode(), Mode::Keys);
        assert!(s.shortcuts_only);
        assert_eq!(s.ring_color, "pink");
        assert_eq!(s.options(), Options { hold_ms: 200, max: 12 });
    }

    #[test]
    fn modes_parse_and_say_what_they_watch() {
        assert_eq!(Mode::parse("keys"), Some(Mode::Keys));
        assert_eq!(Mode::parse(" both "), Some(Mode::Both));
        assert_eq!(Mode::parse("ring"), None);
        let s = Settings::from(&Config::default());
        assert_eq!(Mode::Keys.wants(&s), Wants { keys: true, clicks: true, moves: false, scrolls: true, gestures: true }, "clicks with modifiers, scrolls and gestures go on the strip");
        assert_eq!(Mode::Cursor.wants(&s), Wants { keys: false, clicks: true, moves: true, scrolls: false, gestures: false }, "no strip, nothing to name a scroll on");
        assert_eq!(Mode::Both.wants(&s), Wants { keys: true, clicks: true, moves: true, scrolls: true, gestures: true });
        let quiet = Settings { ring: false, gestures: false, ..s };
        assert_eq!(Mode::Both.wants(&quiet), Wants { keys: true, clicks: true, moves: false, scrolls: false, gestures: false }, "no ring, no moves; gestures off, none watched");
    }
}
