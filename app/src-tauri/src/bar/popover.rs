//! The popover: pal's one rich surface for bar items on every target, the
//! fourth window `bar` (`index.html?bar`), an NSPanel like the main one
//! (`panel::bar_install`) with the Launcher on one level and no root. It
//! opens under the anchor rect a target reported (a tray icon's frame, a
//! sketchybar item's `bounding_rects`), or at the panel's usual place from
//! a hotkey; 420 wide, as tall as its content up to 480, clamped to the
//! display the anchor is on.
//!
//! Peek and engage (`docs/design/bar.md`, Hover): the pointer resting on
//! an item for `hover_delay` opens a peek, shown without key focus and
//! closed `hover_grace` after the pointer has left both the item and the
//! popover (the popover's own tracking area reports it). A click, the
//! item's hotkey or a key pressed while a peek is up engages it: key, and
//! up until Escape, a hiding effect or a click outside (resign key). The
//! rules are the pure [`Machine`], tested as a table; this module runs its
//! actions (timers, the window, the page's `pal://bar` event) and reads
//! the key that engages a peek through an `NSEvent` monitor (below).
//!
//! **Key while peeking.** A non-key panel receives no key events, and an
//! Accessory app that is not active gets none either, so a local monitor
//! (`addLocalMonitorForEventsMatchingMask`) sees nothing during a peek:
//! measured on hornet 2026-09-16 with the scratch bundle (both monitors
//! installed, an F13 pressed during a peek, `key via local monitor` never
//! logged). The global monitor (`addGlobalMonitorForEventsMatchingMask`,
//! keyDown) observes without swallowing, and fires only for a process
//! with the **Input Monitoring** grant (`IOHIDCheckAccess(
//! kIOHIDRequestTypeListenEvent)`; a separate pane from Accessibility,
//! which pal asks for paste): measured with a probe from a trusted
//! terminal (`ax=true inputMonitoring=0`: F13 delivered) against the
//! unlisted scratch bundle (`input_monitoring=false`: nothing). A
//! `CGEventTap` needs the same grant and could swallow, so it buys
//! nothing. Decision: the global monitor, installed for the length of a
//! peek and removed after; without the grant a key during a peek reaches
//! the front app as before and the peek stays until the pointer leaves,
//! so click and hotkey remain the engage paths. The first key engages; it
//! is not replayed into the page (a global monitor cannot swallow it, and
//! the app in front already handled it), which is what the spec asks:
//! the first key engages, the grammar takes over from the next. pal does
//! not ask for Input Monitoring itself yet (an open question for the
//! permissions module).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{entry, split_key, Rect};
use crate::{events, lock, panel, settings};

pub const WINDOW: &str = "bar";
pub const WIDTH: f64 = 420.0;
pub const MAX_HEIGHT: f64 = 480.0;
/// Between the anchor's bottom edge and the popover.
pub const GAP: f64 = 8.0;

// ---- placement (pure) ----------------------------------------------------

/// A display's work area in logical points, top-left origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Display {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Display {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

/// Top-left for a `size` popover centred under `anchor`, [`GAP`] down,
/// clamped to the work area of the display holding the anchor's centre
/// (the first display when none does). With no anchor: centred on
/// `fallback` (the display under the cursor), a fifth of the way down,
/// where the panel goes.
pub fn place(anchor: Option<Rect>, size: (f64, f64), displays: &[Display], fallback: usize) -> (f64, f64) {
    let (w, h) = size;
    let Some(first) = displays.first() else { return (0.0, 0.0) };
    match anchor {
        Some(a) => {
            let (cx, cy) = (a.x + a.w / 2.0, a.y + a.h / 2.0);
            let d = displays.iter().find(|d| d.contains(cx, cy)).unwrap_or(first);
            let x = (cx - w / 2.0).clamp(d.x, (d.x + d.w - w).max(d.x));
            let y = (a.y + a.h + GAP).clamp(d.y, (d.y + d.h - h).max(d.y));
            (x, y)
        }
        None => {
            let d = displays.get(fallback).unwrap_or(first);
            ((d.x + (d.w - w) / 2.0).max(d.x), d.y + (d.h * 0.2).round())
        }
    }
}

// ---- the state machine (pure) -------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum State {
    #[default]
    Hidden,
    /// Shown without key focus for `key`.
    Peek(String),
    /// Key, until Escape, a hiding effect or a click outside.
    Engaged(String),
}

/// What reaches the machine: the targets' hover and click, the popover's
/// own pointer tracking, the timers it armed (with the generation that
/// armed them; a stale one is ignored), the hotkey, a key during a peek,
/// the ways out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    Enter(String),
    Exit(String),
    PopoverEnter,
    PopoverExit,
    Delay(u64),
    Grace(u64),
    Click(String),
    Hotkey(String),
    Key,
    Escape,
    Resign,
    Gone(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Start `hover_delay`; feed `Delay(gen)` when it ends.
    ArmDelay(String, u64),
    /// Start `hover_grace`; feed `Grace(gen)` when it ends.
    ArmGrace(u64),
    /// Show the popover on `key`, key (engaged) or not (a peek).
    Show(String, bool),
    /// Make the showing peek key.
    Engage(String),
    Hide,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Armed {
    Delay(String),
    Grace,
}

#[derive(Debug, Default)]
pub struct Machine {
    pub state: State,
    over_item: Option<String>,
    over_popover: bool,
    gen: u64,
    armed: Option<Armed>,
}

impl Machine {
    fn disarm(&mut self) {
        self.gen += 1;
        self.armed = None;
    }

    fn arm_delay(&mut self, key: &str) -> Action {
        self.disarm();
        self.armed = Some(Armed::Delay(key.to_string()));
        Action::ArmDelay(key.to_string(), self.gen)
    }

    fn arm_grace(&mut self) -> Action {
        self.disarm();
        self.armed = Some(Armed::Grace);
        Action::ArmGrace(self.gen)
    }

    fn hide(&mut self) -> Vec<Action> {
        self.disarm();
        self.state = State::Hidden;
        self.over_popover = false;
        vec![Action::Hide]
    }

    pub fn step(&mut self, input: Input) -> Vec<Action> {
        use State::*;
        let is_click = matches!(input, Input::Click(_));
        match input {
            Input::Enter(k) => {
                if matches!(self.state, Engaged(_)) {
                    return vec![];
                }
                self.over_item = Some(k.clone());
                match &self.state {
                    Peek(cur) if *cur == k => {
                        self.disarm();
                        vec![]
                    }
                    _ => vec![self.arm_delay(&k)],
                }
            }
            Input::Exit(k) => {
                if self.over_item.as_deref() == Some(&k) {
                    self.over_item = None;
                }
                if matches!(self.state, Engaged(_)) {
                    return vec![];
                }
                if self.armed == Some(Armed::Delay(k)) {
                    self.disarm();
                }
                match self.state {
                    Peek(_) if !self.over_popover && self.over_item.is_none() => vec![self.arm_grace()],
                    _ => vec![],
                }
            }
            Input::PopoverEnter => {
                if self.state == Hidden {
                    return vec![];
                }
                self.over_popover = true;
                if self.armed == Some(Armed::Grace) {
                    self.disarm();
                }
                vec![]
            }
            Input::PopoverExit => {
                if self.state == Hidden {
                    return vec![];
                }
                self.over_popover = false;
                match self.state {
                    Peek(_) if self.over_item.is_none() => vec![self.arm_grace()],
                    _ => vec![],
                }
            }
            Input::Delay(g) => match (&self.armed, g == self.gen) {
                (Some(Armed::Delay(k)), true) => {
                    let k = k.clone();
                    self.armed = None;
                    self.state = Peek(k.clone());
                    self.over_popover = false;
                    vec![Action::Show(k, false)]
                }
                _ => vec![],
            },
            Input::Grace(g) => match (&self.armed, g == self.gen, &self.state) {
                (Some(Armed::Grace), true, Peek(_)) => self.hide(),
                _ => vec![],
            },
            Input::Click(k) | Input::Hotkey(k) => {
                self.disarm();
                match &self.state {
                    Peek(cur) if *cur == k => {
                        self.state = Engaged(k.clone());
                        vec![Action::Engage(k)]
                    }
                    Engaged(cur) if *cur == k && is_click => self.hide(),
                    _ => {
                        self.state = Engaged(k.clone());
                        self.over_popover = false;
                        vec![Action::Show(k, true)]
                    }
                }
            }
            Input::Key => match &self.state {
                Peek(k) => {
                    let k = k.clone();
                    self.disarm();
                    self.state = Engaged(k.clone());
                    vec![Action::Engage(k)]
                }
                _ => vec![],
            },
            Input::Escape => match self.state {
                Hidden => vec![],
                _ => self.hide(),
            },
            Input::Resign => match self.state {
                Engaged(_) => self.hide(),
                _ => vec![],
            },
            Input::Gone(k) => match &self.state {
                Peek(cur) | Engaged(cur) if *cur == k => self.hide(),
                _ => vec![],
            },
        }
    }
}

// ---- runtime -------------------------------------------------------------

#[derive(Debug, Clone)]
struct Showing {
    key: String,
    engaged: bool,
    anchor: Option<Rect>,
    /// `bar/open` answered a level (`push`, `view`, `show`) instead of the item's `menu`.
    effect: Option<Value>,
}

#[derive(Default)]
pub struct Popover {
    machine: Mutex<Machine>,
    anchors: Mutex<HashMap<String, (Rect, &'static str)>>,
    showing: Mutex<Option<Showing>>,
    height: Mutex<f64>,
}

/// What the page gets on `pal://bar`: the item to show on one level, or
/// `engage` / `hide`.
#[derive(Clone, Serialize)]
#[serde(untagged)]
enum Payload {
    Show {
        key: String,
        title: String,
        engaged: bool,
        urgent: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        tooltip: Option<String>,
        menu: Value,
        item: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        effect: Option<Value>,
    },
    Engage {
        engage: bool,
    },
    Hide {
        hide: bool,
    },
}

pub fn install(app: &AppHandle) {
    app.manage(Popover::default());
    *lock(&app.state::<Popover>().height) = MAX_HEIGHT;
    let builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html?bar".into()))
        .title("pal Bar")
        .inner_size(WIDTH, MAX_HEIGHT)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .visible(false);
    match builder.build() {
        Ok(w) => panel::bar_install(&w),
        Err(e) => eprintln!("bar\tpopover\twindow failed\t{e}"),
    }
}

fn feed(app: &AppHandle, input: Input) {
    let actions = {
        let st = app.state::<Popover>();
        let mut m = lock(&st.machine);
        let before = m.state.clone();
        let actions = m.step(input.clone());
        if !actions.is_empty() || !matches!(input, Input::Delay(_) | Input::Grace(_)) {
            eprintln!("bar\tpopover\t{input:?}\t{before:?} -> {:?}\t{actions:?}", m.state);
        }
        actions
    };
    for a in actions {
        run(app, a);
    }
}

fn run(app: &AppHandle, action: Action) {
    let config = settings::config(app);
    match action {
        Action::ArmDelay(_, gen) => arm(app, Duration::from_millis(config.bar.hover_delay), Input::Delay(gen)),
        Action::ArmGrace(gen) => arm(app, Duration::from_millis(config.bar.hover_grace), Input::Grace(gen)),
        Action::Show(key, engaged) => show(app, &key, engaged, None),
        Action::Engage(key) => engage(app, &key),
        Action::Hide => hide_now(app),
    }
}

fn arm(app: &AppHandle, after: Duration, then: Input) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(after).await;
        feed(&app, then);
    });
}

/// The item's title for the popover: the manifest's.
fn title_of(app: &AppHandle, key: &str) -> String {
    entry(app, key).map(|e| e.manifest.title).filter(|t| !t.is_empty()).unwrap_or_else(|| split_key(key).map_or(key.to_string(), |(_, id)| id.to_string()))
}

fn payload(app: &AppHandle, key: &str, engaged: bool, effect: Option<&Value>) -> Option<Payload> {
    let e = entry(app, key)?;
    let item = e.last.unwrap_or_default();
    Some(Payload::Show {
        key: key.to_string(),
        title: title_of(app, key),
        engaged,
        urgent: item.urgent,
        tooltip: item.tooltip.clone(),
        menu: item.menu.clone().unwrap_or(Value::Null),
        item: serde_json::to_value(&item).unwrap_or(Value::Null),
        effect: effect.cloned(),
    })
}

fn show(app: &AppHandle, key: &str, engaged: bool, effect: Option<Value>) {
    let st = app.state::<Popover>();
    let anchor = lock(&st.anchors).get(key).map(|(r, _)| *r);
    let Some(p) = payload(app, key, engaged, effect.as_ref()) else { return };
    let first = {
        let mut s = lock(&st.showing);
        let first = s.as_ref().is_none_or(|s| s.key != key);
        *s = Some(Showing { key: key.to_string(), engaged, anchor, effect });
        first
    };
    events::emit_to(app, WINDOW, events::BAR, p);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        place_window(&handle);
        if engaged {
            panel::bar_show(&handle, true);
            keys::stop(&handle);
        } else {
            panel::bar_show(&handle, false);
            keys::start(&handle);
        }
    });
    eprintln!("bar\tpopover\t{}\t{key}", if engaged { "engaged" } else { "peek" });
    if first {
        super::shown(app, key);
    }
}

fn engage(app: &AppHandle, key: &str) {
    if let Some(s) = lock(&app.state::<Popover>().showing).as_mut() {
        s.engaged = true;
    }
    events::emit_to(app, WINDOW, events::BAR, Payload::Engage { engage: true });
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        keys::stop(&handle);
        panel::bar_show(&handle, true);
    });
    eprintln!("bar\tpopover\tengaged\t{key}");
}

fn hide_now(app: &AppHandle) {
    let was = lock(&app.state::<Popover>().showing).take();
    events::emit_to(app, WINDOW, events::BAR, Payload::Hide { hide: true });
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        keys::stop(&handle);
        panel::bar_hide(&handle);
    });
    if let Some(s) = was {
        eprintln!("bar\tpopover\thidden\t{}", s.key);
    }
}

/// Every display's work area in logical points, and the index of the one
/// under the cursor.
fn displays(app: &AppHandle) -> (Vec<Display>, usize) {
    let all = app.available_monitors().unwrap_or_default();
    let cursor = app.cursor_position().ok();
    let mut under = 0;
    let out: Vec<Display> = all
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let s = m.scale_factor();
            let a = m.work_area();
            if let Some(c) = cursor {
                let (px, py) = (m.position().x as f64, m.position().y as f64);
                if c.x >= px && c.x < px + m.size().width as f64 && c.y >= py && c.y < py + m.size().height as f64 {
                    under = i;
                }
            }
            Display { x: a.position.x as f64 / s, y: a.position.y as f64 / s, w: a.size.width as f64 / s, h: a.size.height as f64 / s }
        })
        .collect();
    (out, under)
}

/// Size and place the window for what is showing (main thread).
fn place_window(app: &AppHandle) {
    let st = app.state::<Popover>();
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let anchor = lock(&st.showing).as_ref().and_then(|s| s.anchor);
    let h = lock(&st.height).clamp(80.0, MAX_HEIGHT);
    let _ = w.set_size(LogicalSize::new(WIDTH, h));
    let (ds, under) = displays(app);
    let (x, y) = place(anchor, (WIDTH, h), &ds, under);
    let _ = w.set_position(LogicalPosition::new(x, y));
}

// ---- what the targets, the CLI and the page feed ---------------------------

fn remember(app: &AppHandle, key: &str, rect: Option<Rect>, anchor: &'static str) {
    if let Some(r) = rect {
        eprintln!("bar\tanchor\t{key}\t{},{},{},{}\t{anchor}", r.x, r.y, r.w, r.h);
        lock(&app.state::<Popover>().anchors).insert(key.to_string(), (r, anchor));
    }
}

fn hoverable(app: &AppHandle, key: &str) -> bool {
    let config = settings::config(app);
    config.bar.item(key).enabled && entry(app, key).and_then(|e| e.last).is_some_and(|i| i.has_menu() && !i.hidden)
}

/// A click on the item: opens its popover engaged, or `bar/open` when it
/// has no `menu`. `anchor` names the target for the extension's ctx.
pub fn on_click(app: &AppHandle, key: &str, rect: Option<Rect>, anchor: &'static str) {
    remember(app, key, rect, anchor);
    let Some(e) = entry(app, key) else { return eprintln!("bar\tclick\t{key}\tunknown item") };
    if e.last.as_ref().is_some_and(|i| i.has_menu()) {
        feed(app, Input::Click(key.to_string()));
    } else {
        let (app, key) = (app.clone(), key.to_string());
        tauri::async_runtime::spawn(async move {
            if let Err(e) = super::open(&app, &key, anchor, rect).await {
                eprintln!("bar\topen\t{key}\tfailed\t{e}");
            }
        });
    }
}

/// The pointer entered (`entered`) or left the item on a target.
pub fn on_hover(app: &AppHandle, key: &str, rect: Option<Rect>, entered: bool, anchor: &'static str) {
    if entered {
        remember(app, key, rect, anchor);
        if hoverable(app, key) {
            feed(app, Input::Enter(key.to_string()));
        }
    } else {
        feed(app, Input::Exit(key.to_string()));
    }
}

/// The item's hotkey: engaged on its level, under the icon when a target
/// draws it (sketchybar first: an auto-hidden menu bar's items sit above
/// the screen), else at the panel's place; `bar/open` for an item with no menu.
pub fn on_hotkey(app: &AppHandle, key: &str) {
    let rect = [super::Kind::Sketchybar, super::Kind::Menubar].iter().find_map(|k| super::target(*k).anchor(app, key));
    if let Some(r) = rect {
        remember(app, key, Some(r), "hotkey");
    }
    let Some(e) = entry(app, key) else { return };
    if e.last.as_ref().is_some_and(|i| i.has_menu()) {
        feed(app, Input::Hotkey(key.to_string()));
    } else {
        let (app, key) = (app.clone(), key.to_string());
        tauri::async_runtime::spawn(async move {
            if let Err(e) = super::open(&app, &key, "hotkey", rect).await {
                eprintln!("bar\topen\t{key}\tfailed\t{e}");
            }
        });
    }
}

/// `bar/open` answered a level: show it engaged.
pub fn open_effect(app: &AppHandle, key: &str, rect: Option<Rect>, effect: &Value) {
    remember(app, key, rect, "open");
    {
        let st = app.state::<Popover>();
        let mut m = lock(&st.machine);
        m.disarm();
        m.state = State::Engaged(key.to_string());
    }
    show(app, key, true, Some(effect.clone()));
}

/// The popover's own tracking area.
pub fn on_pointer(app: &AppHandle, entered: bool) {
    feed(app, if entered { Input::PopoverEnter } else { Input::PopoverExit });
}

/// The panel resigned key (a click outside, another app came forward).
pub fn on_resign(app: &AppHandle) {
    feed(app, Input::Resign);
}

/// Escape, a hiding effect, `pal bar` asking: down.
pub fn hide(app: &AppHandle) {
    feed(app, Input::Escape);
}

pub fn is_visible(app: &AppHandle) -> bool {
    lock(&app.state::<Popover>().showing).is_some()
}

/// The item rendered again while its popover shows: the page gets the
/// new state and replaces its level in place.
pub fn on_item_changed(app: &AppHandle, key: &str) {
    let showing = lock(&app.state::<Popover>().showing).clone();
    let Some(s) = showing.filter(|s| s.key == key) else { return };
    if let Some(p) = payload(app, key, s.engaged, s.effect.as_ref()) {
        events::emit_to(app, WINDOW, events::BAR, p);
    }
}

pub fn on_item_gone(app: &AppHandle, key: &str) {
    feed(app, Input::Gone(key.to_string()));
}

/// The page measured its content: the window follows, up to the maximum.
pub fn set_height(app: &AppHandle, height: f64) {
    *lock(&app.state::<Popover>().height) = height.clamp(80.0, MAX_HEIGHT);
    if is_visible(app) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || place_window(&handle));
    }
}

// ---- commands ------------------------------------------------------------

#[tauri::command]
pub fn bar_hide(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
pub fn bar_size(app: AppHandle, height: f64) {
    set_height(&app, height);
}

/// A row picked in the popover's menu level (or a segment): `bar/action`.
#[tauri::command]
pub async fn bar_action(app: AppHandle, key: String, action: String) -> Result<Value, String> {
    let anchor = lock(&app.state::<Popover>().anchors).get(&key).map_or("hotkey", |(_, a)| a);
    super::action(&app, &key, &action, anchor, WINDOW).await
}

/// `cmd+r` in the popover: render the item again.
#[tauri::command]
pub fn bar_refresh(app: AppHandle, key: String) {
    super::render(&app, &key, "update");
}

// ---- the key that engages a peek ------------------------------------------

#[cfg(target_os = "macos")]
mod keys {
    use std::cell::RefCell;
    use std::ptr::NonNull;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use tauri::AppHandle;

    thread_local! {
        static MONITORS: RefCell<Vec<Retained<AnyObject>>> = const { RefCell::new(Vec::new()) };
    }

    use crate::permissions::input_monitoring;

    /// Install the monitors for a peek (main thread). Both the global and
    /// the local one are tried; the log says which delivered.
    pub fn start(app: &AppHandle) {
        stop(app);
        let listen = input_monitoring();
        let h = app.clone();
        let global = block2::RcBlock::new(move |_: NonNull<NSEvent>| {
            eprintln!("bar\tpopover\tkey via global monitor");
            super::feed(&h, super::Input::Key);
        });
        let h = app.clone();
        let local = block2::RcBlock::new(move |e: NonNull<NSEvent>| -> *mut NSEvent {
            eprintln!("bar\tpopover\tkey via local monitor");
            super::feed(&h, super::Input::Key);
            e.as_ptr()
        });
        let mut got = Vec::new();
        unsafe {
            if let Some(m) = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &global) {
                got.push(m);
            }
            if let Some(m) = NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &local) {
                got.push(m);
            }
        }
        eprintln!("bar\tpopover\tkey monitors\t{} installed\tinput_monitoring={listen}", got.len());
        MONITORS.with(|m| *m.borrow_mut() = got);
    }

    pub fn stop(_app: &AppHandle) {
        MONITORS.with(|m| {
            for mon in m.borrow_mut().drain(..) {
                unsafe { NSEvent::removeMonitor(&mon) };
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod keys {
    use tauri::AppHandle;
    pub fn start(_app: &AppHandle) {}
    pub fn stop(_app: &AppHandle) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use Action::*;
    use Input::*;

    fn k(s: &str) -> String {
        s.to_string()
    }

    #[test]
    fn peek_then_grace_closes() {
        let mut m = Machine::default();
        assert_eq!(m.step(Enter(k("a"))), [ArmDelay(k("a"), 1)]);
        assert_eq!(m.step(Delay(1)), [Show(k("a"), false)]);
        assert_eq!(m.state, State::Peek(k("a")));
        // Leaving the item arms the grace; crossing into the popover cancels it.
        assert_eq!(m.step(Exit(k("a"))), [ArmGrace(2)]);
        assert_eq!(m.step(PopoverEnter), []);
        assert_eq!(m.step(Grace(2)), [], "a cancelled grace is stale");
        assert_eq!(m.step(PopoverExit), [ArmGrace(4)]);
        assert_eq!(m.step(Grace(4)), [Hide]);
        assert_eq!(m.state, State::Hidden);
        assert_eq!(m.step(PopoverEnter), [], "pointer events on a hidden popover are noise");
        assert_eq!(m.step(PopoverExit), []);
    }

    #[test]
    fn a_pass_by_never_shows_and_a_key_engages_a_peek() {
        let mut m = Machine::default();
        assert_eq!(m.step(Enter(k("a"))), [ArmDelay(k("a"), 1)]);
        assert_eq!(m.step(Exit(k("a"))), [], "left before the delay: nothing armed");
        assert_eq!(m.step(Delay(1)), [], "the stale delay is ignored");
        assert_eq!(m.state, State::Hidden);
        assert_eq!(m.step(Key), [], "no peek, no engage");
        assert_eq!(m.step(Enter(k("a"))), [ArmDelay(k("a"), 3)]);
        assert_eq!(m.step(Delay(3)), [Show(k("a"), false)]);
        assert_eq!(m.step(Key), [Engage(k("a"))]);
        assert_eq!(m.state, State::Engaged(k("a")));
        assert_eq!(m.step(Exit(k("a"))), [], "engaged: the pointer leaving means nothing");
        assert_eq!(m.step(PopoverExit), []);
        assert_eq!(m.step(Enter(k("b"))), [], "a hover on another item while engaged is ignored");
        assert_eq!(m.step(Resign), [Hide]);
        assert_eq!(m.state, State::Hidden);
    }

    #[test]
    fn click_and_hotkey_engage_and_a_second_click_toggles() {
        let mut m = Machine::default();
        assert_eq!(m.step(Click(k("a"))), [Show(k("a"), true)]);
        assert_eq!(m.step(Resign), [Hide]);
        assert_eq!(m.step(Hotkey(k("b"))), [Show(k("b"), true)]);
        assert_eq!(m.step(Hotkey(k("c"))), [Show(k("c"), true)], "another item's hotkey switches");
        assert_eq!(m.step(Click(k("c"))), [Hide], "a click on the engaged item closes it");
        assert_eq!(m.step(Hotkey(k("c"))), [Show(k("c"), true)]);
        assert_eq!(m.step(Hotkey(k("c"))), [Show(k("c"), true)], "a hotkey repeat re-shows, never toggles closed");
        assert_eq!(m.step(Escape), [Hide]);
        assert_eq!(m.step(Escape), [], "nothing to hide");
        // A click while peeking the same item engages in place; on another it switches.
        let Some(ArmDelay(_, g)) = m.step(Enter(k("a"))).first().cloned() else { panic!("a delay is armed") };
        assert_eq!(m.step(Delay(g)), [Show(k("a"), false)]);
        assert_eq!(m.step(Click(k("a"))), [Engage(k("a"))]);
        assert_eq!(m.step(Click(k("b"))), [Show(k("b"), true)]);
        assert_eq!(m.state, State::Engaged(k("b")));
    }

    #[test]
    fn a_peek_moves_to_the_next_item_and_a_gone_item_hides() {
        let mut m = Machine::default();
        m.step(Enter(k("a")));
        assert_eq!(m.step(Delay(1)), [Show(k("a"), false)]);
        assert_eq!(m.step(Exit(k("a"))), [ArmGrace(2)]);
        assert_eq!(m.step(Enter(k("b"))), [ArmDelay(k("b"), 3)], "entering another item arms its delay (the grace is dropped)");
        assert_eq!(m.step(Grace(2)), [], "stale");
        assert_eq!(m.step(Delay(3)), [Show(k("b"), false)]);
        assert_eq!(m.state, State::Peek(k("b")));
        assert_eq!(m.step(Enter(k("b"))), [], "re-entering the peeked item just cancels any grace");
        assert_eq!(m.step(Gone(k("a"))), [], "not the one showing");
        assert_eq!(m.step(Gone(k("b"))), [Hide]);
        assert_eq!(m.state, State::Hidden);
        m.step(Click(k("a")));
        assert_eq!(m.step(Gone(k("a"))), [Hide], "engaged or not");
    }

    #[test]
    fn placement_centres_under_the_anchor_and_clamps_per_display() {
        let main = Display { x: 0.0, y: 25.0, w: 1512.0, h: 957.0 };
        let right = Display { x: 1512.0, y: 0.0, w: 2560.0, h: 1440.0 };
        let ds = [main, right];
        let size = (WIDTH, 300.0);
        // Centred under a mid-bar icon, GAP below it.
        assert_eq!(place(Some(Rect { x: 700.0, y: 0.0, w: 24.0, h: 24.0 }), size, &ds, 0), (700.0 + 12.0 - WIDTH / 2.0, 24.0 + GAP));
        // Near the right edge of the main display: clamped inside it.
        assert_eq!(place(Some(Rect { x: 1480.0, y: 0.0, w: 24.0, h: 24.0 }), size, &ds, 0), (1512.0 - WIDTH, 25.0 + 7.0));
        // On the second display, near its left edge: its own area, not the first's.
        assert_eq!(place(Some(Rect { x: 1520.0, y: 0.0, w: 20.0, h: 24.0 }), size, &ds, 0), (1512.0, 32.0));
        // Too tall for what is left below: pushed up to fit.
        let tall = (WIDTH, 480.0);
        let (_, y) = place(Some(Rect { x: 100.0, y: 900.0, w: 20.0, h: 24.0 }), tall, &ds, 0);
        assert_eq!(y, 25.0 + 957.0 - 480.0);
        // An anchor on no display: the first one's rules.
        assert_eq!(place(Some(Rect { x: -5000.0, y: -5000.0, w: 1.0, h: 1.0 }), size, &ds, 1).0, 0.0);
        // No anchor (a hotkey): the panel's place on the display under the cursor.
        assert_eq!(place(None, size, &ds, 1), (1512.0 + (2560.0 - WIDTH) / 2.0, 288.0));
        assert_eq!(place(None, size, &ds, 0), ((1512.0 - WIDTH) / 2.0, 25.0 + 191.0));
        assert_eq!(place(None, size, &[], 0), (0.0, 0.0), "no display at all: the origin");
    }
}
