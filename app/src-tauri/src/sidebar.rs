//! The sidebar: one live palette docked to a screen edge (`[sidebar]`;
//! `docs/design/switcher.md`, "The sidebar"). A second window of the
//! popover's kind, `sidebar` (`index.html?bar&sidebar`: the popover page
//! in sidebar mode, `panel::bar_install` under this label), driven by
//! the popover's pure `Machine` with one key, [`KEY`]: what the popover
//! gets from a bar item's hover and click, the sidebar gets from its
//! strip and its page, so the hover delay and grace, the peek then
//! engage, the resign-hides rules are the popover's table unchanged.
//!
//! - Placement: docked, not anchored (`dock`): [`INSET`] from the edge
//!   and the top of the work area of the display `display` names,
//!   resolved at each show (`popover::displays`); `width` from the
//!   config, the height the page reports (`bar_size`) up to the work
//!   area.
//! - Peek: the strip (`panel::strip_place`), a [`STRIP`] px panel of
//!   pal's own along the edge, one per display the config can mean
//!   (every display for `cursor`); its tracking area is
//!   `Input::Enter/Exit(KEY)`, the window's own (`on_pointer`) is
//!   `PopoverEnter/Exit`. The strips follow display changes
//!   (`NSApplicationDidChangeScreenParametersNotification`) and go with
//!   `peek = false` or no palette.
//! - Engage: a click into the peek (the page's `bar_engage`, fed as
//!   `Input::Key`: engage a peek, nothing otherwise), the hotkey
//!   (`hotkey::Target::Sidebar`), a key during a peek (the popover's
//!   monitor, `popover::keys`, with its Input Monitoring caveat). Escape,
//!   a hiding effect (`effects::hide_first`) and a click outside (the
//!   panel resigning key) hide.
//! - Each show relists the palette (`index::relist_live`) and tells
//!   `views` the window is visible, so a live view palette gets
//!   `view/shown`; the page re-renders on `pal://index` as the popover
//!   does. Picks are the palette's usual `index::pick` from this window
//!   (compact, `views::is_compact`); nothing goes to `bar/action`.
//! - Linux: the config is read and validated, nothing is built
//!   (`bar::SUPPORTED`), one log line says so.

use std::sync::Mutex;

use pal_core::config::{Config, Edge, Sidebar as SidebarConfig};
use pal_core::index::Source;
use serde_json::json;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::bar::popover::{self, keys, Action, Display, Input, Machine, Payload};
use crate::registry::Palettes;
use crate::{events, index, lock, panel, settings};

pub const WINDOW: &str = "sidebar";
/// The machine's one key: the sidebar has no bar item, so this stands in.
const KEY: &str = "sidebar";
/// From the docked edge and the top of the work area to the window.
pub const INSET: f64 = 8.0;
/// The peek strip's width, along the edge.
pub const STRIP: f64 = 2.0;
const MIN_HEIGHT: f64 = 80.0;

// ---- placement (pure) ----------------------------------------------------

/// The frame `(x, y, w, h)` of a sidebar `width` wide docked to `edge` of
/// `d`, [`INSET`] from that edge and from the top, `content` tall (what
/// the page measured) within the work area less the insets, at least
/// [`MIN_HEIGHT`]; never wider than the work area allows.
pub fn dock(d: &Display, edge: Edge, width: f64, content: f64) -> (f64, f64, f64, f64) {
    let w = width.min(d.w - 2.0 * INSET).max(1.0);
    let h = content.clamp(MIN_HEIGHT, (d.h - 2.0 * INSET).max(MIN_HEIGHT));
    let x = match edge {
        Edge::Left => d.x + INSET,
        Edge::Right => d.x + d.w - INSET - w,
    };
    (x, d.y + INSET, w, h)
}

/// The strip's frame along `edge` of `d`: [`STRIP`] wide, the work area's height.
pub fn strip(d: &Display, edge: Edge) -> (f64, f64, f64, f64) {
    let x = match edge {
        Edge::Left => d.x,
        Edge::Right => d.x + d.w - STRIP,
    };
    (x, d.y, STRIP, d.h)
}

/// The displays `display` names among `ds` (the primary first, `under`
/// the cursor's): every one for `cursor`, the first for `primary`, the
/// one of that name (any case) else the cursor's with a log line.
pub fn chosen(display: &str, ds: &[Display], under: usize) -> Vec<usize> {
    match display.trim() {
        "" | "cursor" => (0..ds.len()).collect(),
        "primary" => (!ds.is_empty()).then_some(0).into_iter().collect(),
        name => match ds.iter().position(|d| d.name.eq_ignore_ascii_case(name)) {
            Some(i) => vec![i],
            None => {
                eprintln!("sidebar\tno display named {name:?} (have {}); using the cursor's", ds.iter().map(|d| format!("{:?}", d.name)).collect::<Vec<_>>().join(", "));
                (under < ds.len()).then_some(under).into_iter().collect()
            }
        },
    }
}

// ---- runtime -------------------------------------------------------------

#[derive(Default)]
struct Sidebar {
    machine: Mutex<Machine>,
    /// Engaged or not, while showing.
    showing: Mutex<Option<bool>>,
    height: Mutex<f64>,
}

/// Whether there is a sidebar to run: the platform has the window and the config names a palette.
fn enabled(app: &AppHandle) -> bool {
    crate::bar::SUPPORTED && settings::config(app).sidebar.palette().is_some()
}

pub fn install(app: &AppHandle) {
    app.manage(Sidebar::default());
    *lock(&app.state::<Sidebar>().height) = 480.0;
    if !crate::bar::SUPPORTED {
        return eprintln!("sidebar\tnot on Linux yet; [sidebar] is read, no window is built");
    }
    watch_displays(app);
    apply(app);
}

/// The config was reloaded: a changed `[sidebar]` hides what is showing
/// (the palette or the edge may have moved; the next show is fresh) and
/// applies the rest. The hotkey is `hotkey::apply`'s.
pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    if prev.sidebar == next.sidebar || !crate::bar::SUPPORTED {
        return;
    }
    eprintln!("sidebar\tconfig\t{}", next.sidebar.palette().unwrap_or("off"));
    hide(app);
    apply(app);
}

/// The window (built on first need, so a sidebar switched off costs no
/// webview) and the strips, per the config now.
fn apply(app: &AppHandle) {
    if enabled(app) {
        ensure_window(app);
    }
    place_strips(app);
}

fn ensure_window(app: &AppHandle) {
    if app.get_webview_window(WINDOW).is_some() {
        return;
    }
    let width = settings::config(app).sidebar.width;
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if handle.get_webview_window(WINDOW).is_some() {
            return;
        }
        let builder = WebviewWindowBuilder::new(&handle, WINDOW, WebviewUrl::App("index.html?bar&sidebar".into()))
            .title("pal Sidebar")
            .inner_size(width, 480.0)
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .visible(false);
        match builder.build() {
            Ok(w) => panel::bar_install(&w),
            Err(e) => eprintln!("sidebar\twindow failed\t{e}"),
        }
    });
}

fn feed(app: &AppHandle, input: Input) {
    if !enabled(app) && !matches!(input, Input::Escape | Input::Resign) {
        return;
    }
    let actions = {
        let st = app.state::<Sidebar>();
        let mut m = lock(&st.machine);
        let before = m.state.clone();
        let actions = m.step(input.clone());
        if !actions.is_empty() || !matches!(input, Input::Delay(_) | Input::Grace(_)) {
            eprintln!("sidebar\t{input:?}\t{before:?} -> {:?}\t{actions:?}", m.state);
        }
        actions
    };
    for a in actions {
        match a {
            Action::ArmDelay(_, gen) => popover::arm(app, popover::hover_delay(app), move |app| feed(app, Input::Delay(gen))),
            Action::ArmGrace(gen) => popover::arm(app, popover::hover_grace(app), move |app| feed(app, Input::Grace(gen))),
            Action::Show(_, engaged) => show(app, engaged),
            Action::Engage(_) => engage(app),
            Action::Hide => hide_now(app),
        }
    }
}

/// The registered palette `key` names: its source and title; the key
/// split, and as the title, when the host has not reported it (yet).
fn palette_of(app: &AppHandle, key: &str) -> (Source, String) {
    Palettes::with(app, |reg| reg.iter().find(|r| index::palette_key(&r.source) == key).map(|r| (r.source.clone(), r.meta.title.clone()))).unwrap_or_else(|| {
        let (e, p) = key.split_once('/').unwrap_or((key, ""));
        (Source::new(e, p), key.to_string())
    })
}

fn show(app: &AppHandle, engaged: bool) {
    let cfg = settings::config(app).sidebar;
    let Some(key) = cfg.palette() else { return };
    let (source, title) = palette_of(app, key);
    let first = {
        let st = app.state::<Sidebar>();
        let mut s = lock(&st.showing);
        let first = s.is_none();
        *s = Some(engaged);
        first
    };
    // A fresh show: the page starts its level over and reports its view anew; shown again while up, it keeps what it has.
    crate::views::set_visible(app, WINDOW, true, first);
    let payload = Payload::Show { key: KEY.into(), title, engaged, urgent: false, tooltip: None, menu: json!({ "palette": source.palette, "extension": source.extension }), item: json!({}), effect: None, sidebar: true };
    events::emit_to(app, WINDOW, events::BAR, payload);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        place_window(&handle);
        panel::bar_show(&handle, WINDOW, engaged);
        if engaged {
            keys::stop(WINDOW);
        } else {
            keys::start(WINDOW, |app| feed(app, Input::Key), &handle);
        }
    });
    eprintln!("sidebar\t{}\t{key}", if engaged { "engaged" } else { "peek" });
    // The window in front when the sidebar came up: first in the windows palette, as on the panel's show (the bridge's `list` waits for the stamp).
    crate::windows::stamp_focused();
    index::relist_live(app, key);
}

fn engage(app: &AppHandle) {
    if let Some(s) = lock(&app.state::<Sidebar>().showing).as_mut() {
        *s = true;
    }
    events::emit_to(app, WINDOW, events::BAR, Payload::Engage { engage: true });
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        keys::stop(WINDOW);
        panel::bar_show(&handle, WINDOW, true);
    });
    eprintln!("sidebar\tengaged");
}

fn hide_now(app: &AppHandle) {
    let was = lock(&app.state::<Sidebar>().showing).take();
    crate::views::set_visible(app, WINDOW, false, false);
    events::emit_to(app, WINDOW, events::BAR, Payload::Hide { hide: true });
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        keys::stop(WINDOW);
        panel::bar_hide(&handle, WINDOW);
    });
    if was.is_some() {
        eprintln!("sidebar\thidden");
    }
}

/// The display to show on, per the config, now.
fn display(app: &AppHandle, cfg: &SidebarConfig) -> Option<Display> {
    let (ds, under) = popover::displays(app);
    let i = match cfg.display.trim() {
        "" | "cursor" => under,
        other => chosen(other, &ds, under).into_iter().next()?,
    };
    ds.into_iter().nth(i)
}

/// Size and place the window for the config and the page's height (main thread).
fn place_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let cfg = settings::config(app).sidebar;
    let Some(d) = display(app, &cfg) else { return };
    let h = *lock(&app.state::<Sidebar>().height);
    popover::set_frame(&w, dock(&d, cfg.edge, cfg.width, h));
}

/// The strips where the config wants them (none with `peek = false` or no palette).
fn place_strips(app: &AppHandle) {
    let cfg = settings::config(app).sidebar;
    if !cfg.peek || cfg.palette().is_none() {
        return panel::strip_remove(app);
    }
    let (ds, under) = popover::displays(app);
    let rects: Vec<_> = chosen(&cfg.display, &ds, under).into_iter().map(|i| strip(&ds[i], cfg.edge)).collect();
    eprintln!("sidebar\tstrip\t{:?}\t{} display(s)", cfg.edge, rects.len());
    panel::strip_place(app, rects, on_strip);
}

/// Displays came or went, or changed shape: the strips move, and so does a showing sidebar.
#[cfg(target_os = "macos")]
fn watch_displays(app: &AppHandle) {
    use objc2_app_kit::NSApplicationDidChangeScreenParametersNotification;
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let h = handle.clone();
        let block = block2::RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| on_displays_changed(&h));
        // SAFETY: the observation lasts the process; its token is leaked on purpose (as bar/mod.rs does for the workspace's).
        let token = unsafe { NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(Some(NSApplicationDidChangeScreenParametersNotification), None, None, &block) };
        std::mem::forget(token);
    });
}

#[cfg(not(target_os = "macos"))]
fn watch_displays(_app: &AppHandle) {}

/// The screen notification's handler (macOS; nothing watches displays elsewhere yet).
#[cfg(target_os = "macos")]
fn on_displays_changed(app: &AppHandle) {
    eprintln!("sidebar\tdisplays changed");
    place_strips(app);
    if is_visible(app) {
        place_window(app);
    }
}

// ---- what the strip, the page, the panel and the hotkey feed -------------

/// The strip's tracking area: the pointer at the edge, or gone from it.
fn on_strip(app: &AppHandle, entered: bool) {
    feed(app, if entered { Input::Enter(KEY.into()) } else { Input::Exit(KEY.into()) });
}

/// The window's own tracking area (`panel::bar_install`).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn on_pointer(app: &AppHandle, entered: bool) {
    feed(app, if entered { Input::PopoverEnter } else { Input::PopoverExit });
}

/// The panel resigned key (a click outside, another app came forward).
pub fn on_resign(app: &AppHandle) {
    feed(app, Input::Resign);
}

/// A click into the peeking page (`bar_engage`): engaged, as a key would.
pub fn on_click(app: &AppHandle) {
    feed(app, Input::Key);
}

/// `[sidebar] hotkey`: engaged, from hidden or a peek; shown again while engaged.
pub fn on_hotkey(app: &AppHandle) {
    feed(app, Input::Hotkey(KEY.into()));
}

/// Escape in the page, a hiding effect, a config change: down.
pub fn hide(app: &AppHandle) {
    feed(app, Input::Escape);
}

pub fn is_visible(app: &AppHandle) -> bool {
    lock(&app.state::<Sidebar>().showing).is_some()
}

/// The page measured its content: the window follows, up to the work area.
pub fn set_height(app: &AppHandle, height: f64) {
    *lock(&app.state::<Sidebar>().height) = height.max(MIN_HEIGHT);
    if is_visible(app) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || place_window(&handle));
    }
}

/// `cmd+r` reaching the shell from the sidebar's own level: the palette lists again.
pub fn refresh(app: &AppHandle) {
    if let Some(key) = settings::config(app).sidebar.palette() {
        index::relist_live(app, key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(x: f64, y: f64, w: f64, h: f64, name: &str) -> Display {
        Display { x, y, w, h, name: name.into() }
    }

    #[test]
    fn docks_to_either_edge_with_the_inset_and_follows_the_content_within_the_work_area() {
        let main = d(0.0, 25.0, 1512.0, 957.0, "Built-in Retina Display");
        assert_eq!(dock(&main, Edge::Right, 320.0, 400.0), (1512.0 - 8.0 - 320.0, 33.0, 320.0, 400.0));
        assert_eq!(dock(&main, Edge::Left, 320.0, 400.0), (8.0, 33.0, 320.0, 400.0));
        // Taller than the work area: cut to it less the insets; shorter than the minimum: raised to it.
        assert_eq!(dock(&main, Edge::Right, 320.0, 5000.0).3, 957.0 - 16.0);
        assert_eq!(dock(&main, Edge::Right, 320.0, 10.0).3, MIN_HEIGHT);
        // On the second display its own origin counts; a width past the work area is cut to it.
        let right = d(1512.0, 0.0, 2560.0, 1440.0, "DELL U2720Q");
        assert_eq!(dock(&right, Edge::Left, 320.0, 300.0), (1520.0, 8.0, 320.0, 300.0));
        assert_eq!(dock(&d(0.0, 0.0, 200.0, 400.0, ""), Edge::Right, 320.0, 300.0), (8.0, 8.0, 184.0, 300.0));
        // The strip hugs the edge over the work area's full height.
        assert_eq!(strip(&main, Edge::Right), (1510.0, 25.0, 2.0, 957.0));
        assert_eq!(strip(&right, Edge::Left), (1512.0, 0.0, 2.0, 1440.0));
    }

    #[test]
    fn the_display_setting_picks_every_display_the_primary_or_one_by_name() {
        let ds = [d(0.0, 25.0, 1512.0, 957.0, "Built-in Retina Display"), d(1512.0, 0.0, 2560.0, 1440.0, "DELL U2720Q")];
        assert_eq!(chosen("cursor", &ds, 1), [0, 1], "the cursor may be on any: a strip on each");
        assert_eq!(chosen("", &ds, 1), [0, 1]);
        assert_eq!(chosen("primary", &ds, 1), [0]);
        assert_eq!(chosen("dell u2720q", &ds, 0), [1], "by name, any case");
        assert_eq!(chosen("LG", &ds, 1), [1], "unknown: the cursor's");
        assert!(chosen("primary", &[], 0).is_empty() && chosen("LG", &[], 0).is_empty(), "no display: nothing");
    }
}
