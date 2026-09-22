//! Open windows: list them; focus, close, minimise or unminimise one,
//! toggle its full screen; read and set a window's frame, the displays,
//! and the focused window, which is what the layouts in [`layout`] need
//! ([`apply`] runs one, the state verbs included).
//!
//! One [`Window`] shape on every platform; the backend behind it is picked at
//! runtime ([`backend`]):
//!
//! - **macOS**: `CGWindowListCopyWindowInfo` for the list (layer 0, owner
//!   pid, bounds, on-screen) merged with `NSRunningApplication` for the app's
//!   name, bundle id and `.app` path, and with the Accessibility API
//!   ([`crate::ax::element`]) for what CoreGraphics does not say: the title
//!   of another app's window (CoreGraphics only gives it with Screen
//!   Recording permission) and whether it is minimised. The AX window for a
//!   CoreGraphics one is found by frame (title breaks a tie), both APIs
//!   report in the same coordinate space. `AXWindows` only lists windows on
//!   the current Space, so a window elsewhere keeps its CoreGraphics row
//!   (name only with Screen Recording) and `focus` on it activates the app,
//!   which is what switches Spaces. Focus is `activateWithOptions` on the
//!   app plus `AXRaise` on the window; close presses the window's close
//!   button; minimise sets `AXMinimized`, full screen flips
//!   `AXFullScreen`. Without Accessibility the list still works, focus
//!   falls back to activating the app ([`activate`] is that step on its
//!   own), and close / minimise / fullscreen / set_frame fail with
//!   [`Error::NeedsAccessibility`]. A frame is read from CoreGraphics and
//!   written through `AXPosition` / `AXSize`; the displays are `NSScreen`'s
//!   `frame` and `visibleFrame` (menu bar and Dock taken out) flipped into
//!   the same top-left space; the focused window is the frontmost app's
//!   `AXFocusedWindow`. `hidden` is the app's `isHidden`. The order is
//!   most recently used: a focus history ([`note_focus`], newest first,
//!   bounded) that [`focus`] stamps with its target and the app stamps
//!   with [`focused`] on every activation and on the panel's show; the
//!   windows in it come first by recency, the rest follow in
//!   CoreGraphics' front to back order ([`order_by_history`]).
//! - **Linux**: Hyprland (`hyprctl clients -j`, `dispatch focuswindow` /
//!   `closewindow`, minimise = move to the `special:minimized` workspace,
//!   full screen = `focuswindow` then `dispatch fullscreen 0`, which only
//!   takes the active window;
//!   frames from `clients -j`, set with `movewindowpixel exact` /
//!   `resizewindowpixel exact` after floating a tiled window; displays from
//!   `monitors -j` with `reserved` taken out; focused = `activewindow -j`),
//!   Sway (`swaymsg -t get_tree`, `[con_id=N] focus` / `kill` / `move
//!   scratchpad` / `fullscreen toggle`; `floating enable`, `move absolute
//!   position`, `resize set`;
//!   displays from `get_outputs` and `get_workspaces`; focused = the tree's
//!   `focused` node), or X11 (`wmctrl -lpx`, `-i -a` / `-i -c`, minimise via
//!   `xdotool` when present, full screen `-i -r <id> -b toggle,fullscreen`;
//!   frames `wmctrl -lG`, set `-i -r <id> -e`;
//!   displays from `xrandr --listmonitors` and the work area of `wmctrl -d`;
//!   focused via `xprop -root _NET_ACTIVE_WINDOW`). Detected from the
//!   session's environment, then by which tool answers; [`Error::Unavailable`]
//!   when none does.
//!
//! Spaces ([`spaces`], [`go_space`]): on macOS the window server's, read
//! through the private `CGS*` calls CoreGraphics re-exports from SkyLight
//! (what yabai reads with SIP on; no permission), which is also where a
//! window's desktop number (`Window::workspace`) comes from. There is no
//! public call to switch, so `go_space` raises a window on the target
//! (the desktop follows it; the focus history picks which) and steps an
//! empty space's way with Mission Control's ctrl+arrows. Linux: Hyprland's
//! `workspaces -j` / `dispatch workspace`, Sway's `get_workspaces` /
//! `workspace`, X11's `wmctrl -d` / `-s`.
//!
//! [`app_icon_source`] gives the path [`crate::icons::app_icon`] renders: the
//! `.app` bundle, or the `.desktop` file whose id or `StartupWMClass` is the
//! window's class.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

pub mod layout;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no window {0}")]
    NotFound(String),
    /// macOS: the action reaches into another app, which needs Accessibility permission for pal.
    #[error("{0} needs Accessibility permission")]
    NeedsAccessibility(&'static str),
    /// No window manager pal can talk to, or no tool for this action on it.
    #[error("windows unavailable: {0}")]
    Unavailable(String),
    /// The window manager or the app refused.
    #[error("{0}")]
    Failed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    /// Backend-specific and stable while the window lives: the CoreGraphics
    /// window number, a Hyprland address, a Sway container id, an X11 id.
    pub id: String,
    /// What the user calls the program: the app's name, or the window class.
    pub app: String,
    pub title: String,
    /// Bundle id on macOS; `app_id` / `WM_CLASS` on Linux.
    pub bundle_or_class: String,
    pub pid: i32,
    pub minimized: bool,
    /// The app is hidden (macOS `NSRunningApplication.isHidden`, the
    /// state Hide app puts it in); always false on Linux.
    pub hidden: bool,
    /// Visible right now (not minimised, hidden, or on another space).
    pub on_screen: bool,
    /// Which display, only when there is more than one.
    pub monitor: Option<String>,
    /// Workspace / space name where the backend has them.
    pub workspace: Option<String>,
}

/// Where a window or a display sits and how big it is: global top-left
/// origin, y down, in points on macOS (the space `CGWindowListCopyWindowInfo`
/// and AX report in) and in logical pixels on Linux.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }

    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Area shared with `other`, 0 when apart.
    pub fn overlap(&self, other: &Rect) -> f64 {
        let w = (self.x + self.w).min(other.x + other.w) - self.x.max(other.x);
        let h = (self.y + self.h).min(other.y + other.h) - self.y.max(other.y);
        if w > 0.0 && h > 0.0 {
            w * h
        } else {
            0.0
        }
    }

    pub fn rounded(&self) -> Rect {
        Rect { x: self.x.round(), y: self.y.round(), w: self.w.round(), h: self.h.round() }
    }

    /// Equal within `slack` on every side: what a window manager reports
    /// back after a set can be off by a point or a border.
    pub fn about(&self, other: &Rect, slack: f64) -> bool {
        (self.x - other.x).abs() <= slack && (self.y - other.y).abs() <= slack && (self.w - other.w).abs() <= slack && (self.h - other.h).abs() <= slack
    }
}

/// One display. `visible_frame` is `frame` minus what the system keeps
/// (the menu bar and the Dock on macOS, `reserved` on Hyprland, bars on
/// Sway, the work area on X11): where a window may go.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Display {
    /// Backend-specific: the CoreGraphics display id, a Hyprland or Sway
    /// output name, an X11 monitor name.
    pub id: String,
    pub frame: Rect,
    pub visible_frame: Rect,
    /// The one with the menu bar (macOS) or the first the backend lists.
    pub primary: bool,
}

/// Which window manager answers: `macos`, `hyprland`, `sway`, `x11`, or
/// `none`.
pub fn backend() -> &'static str {
    platform::backend()
}

/// Every window of every regular app, most recently used first where the
/// backend knows (Hyprland's focus history; pal's own on macOS, the rest
/// front to back); minimised ones included.
pub fn list() -> Result<Vec<Window>> {
    platform::list()
}

/// Bring the window to the front, restoring it when minimised. Stamps the
/// focus history, so the window picked is the next "previous".
pub fn focus(id: &str) -> Result<()> {
    platform::focus(id)?;
    note_focus(id);
    Ok(())
}

/// The focus history behind the macOS order: window ids newest first, one
/// entry each, with when they took focus. Stamped by [`focus`] and by the
/// app ([`note_focus`]); bounded, so a long session keeps it small.
static HISTORY: LazyLock<Mutex<VecDeque<(String, Instant)>>> = LazyLock::new(Default::default);
const HISTORY_CAP: usize = 64;

/// Record that `id` just took focus: the app calls this with what
/// [`focused`] returns on every app activation and when the panel shows
/// (the window the user was in when they pressed the hotkey).
pub fn note_focus(id: &str) {
    let mut h = HISTORY.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    h.retain(|(i, _)| i != id);
    h.push_front((id.to_string(), Instant::now()));
    h.truncate(HISTORY_CAP);
}

/// `windows` reordered by `history`: the ones in it first, the most recent
/// stamp first, then the rest in the order given (a stable sort, so the
/// backend's front to back order holds among them).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn order_by_history(mut windows: Vec<Window>, history: &VecDeque<(String, Instant)>) -> Vec<Window> {
    let stamp = |w: &Window| history.iter().find(|(id, _)| *id == w.id).map(|(_, at)| *at);
    windows.sort_by_key(|w| std::cmp::Reverse(stamp(w)));
    windows
}

/// Bring the window's application to the front, not the window itself:
/// the app shows whichever window it last had in front. What `focus` is
/// left with without Accessibility on macOS, as a step of its own; on Linux
/// the window manager has no app level, so it is `focus`. Returns the app's
/// name, for the feedback that says which app came up.
pub fn activate(id: &str) -> Result<String> {
    platform::activate(id)
}

/// Close it the way its close button would.
pub fn close(id: &str) -> Result<()> {
    platform::close(id)
}

pub fn minimize(id: &str) -> Result<()> {
    platform::minimize(id)
}

/// Bring a minimised window back, in front: [`focus`] restores as part of
/// raising on every backend, so that is what this is.
pub fn unminimize(id: &str) -> Result<()> {
    focus(id)
}

/// Toggle the window's full screen (macOS `AXFullScreen`, a Space of its
/// own; the compositor's fullscreen on Linux).
pub fn fullscreen(id: &str) -> Result<()> {
    platform::fullscreen(id)
}

/// The file whose icon is the window's app's, for `icons::app_icon`.
pub fn app_icon_source(w: &Window) -> Option<PathBuf> {
    platform::app_icon_source(w)
}

/// Where the window is right now.
pub fn frame(id: &str) -> Result<Rect> {
    platform::frame(id)
}

/// Move and resize it. The app or the window manager may not honour every
/// pixel (a minimum size, a tiled layout): what it ended up with is not
/// checked here.
pub fn set_frame(id: &str, rect: Rect) -> Result<()> {
    platform::set_frame(id, rect)
}

/// Every display, the primary first.
pub fn displays() -> Result<Vec<Display>> {
    platform::displays()
}

/// The window with keyboard focus: the frontmost app's focused window on
/// macOS (its front window when Accessibility is not granted), the
/// compositor's active window on Linux. `None` when nothing has focus (the
/// desktop, a bare workspace).
pub fn focused() -> Result<Option<Window>> {
    platform::focused()
}

/// One Space (macOS), workspace (Hyprland, Sway) or desktop (X11).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Space {
    /// What [`go_space`] takes, stable while the space exists: the managed
    /// space id on macOS, Hyprland's workspace id, Sway's workspace name,
    /// X11's desktop number.
    pub id: String,
    /// The number the desktop shows: Mission Control's, 1-based across
    /// displays and over the desktops only (0 for a full-screen app's
    /// space, which it does not number); Hyprland's and Sway's number; X11's
    /// desktop number + 1.
    pub index: usize,
    /// The backend's own name where it has one (a Hyprland or Sway
    /// workspace), else none.
    pub name: Option<String>,
    /// In front on its display.
    pub current: bool,
    /// The space left most recently ([`note_space`]), while it exists and
    /// is not in front: where "back" goes.
    pub previous: bool,
    /// A full-screen app's own space (macOS).
    pub fullscreen: bool,
    /// Which display, only when there is more than one (as `Window.monitor`).
    pub monitor: Option<String>,
    /// The windows on it, ids as [`list`] gives them, in the backend's order.
    pub windows: Vec<String>,
}

/// Every space of every display in the order the desktop shows them,
/// with the windows on each ([`Space::windows`]).
pub fn spaces() -> Result<Vec<Space>> {
    let mut spaces = platform::spaces()?;
    let history = SPACES.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(prev) = previous_space(&spaces, &history) {
        spaces.iter_mut().for_each(|s| s.previous = s.id == prev);
    }
    Ok(spaces)
}

/// Bring the space in front. macOS has no public call for it: a window
/// there is raised (the desktop follows a raised window to its space, an
/// absolute move: the most recently used window there by the focus
/// history, else the biggest), and an empty space is reached by
/// Mission Control's own ctrl+arrow shortcuts, one press per space
/// between, which needs Accessibility like paste. Linux asks the
/// compositor. The space left is stamped as the previous one.
pub fn go_space(id: &str) -> Result<()> {
    let spaces = spaces()?;
    let target = spaces.iter().find(|s| s.id == id).ok_or_else(|| Error::NotFound(format!("space {id}")))?;
    if target.current {
        return Ok(());
    }
    if let Some(from) = spaces.iter().find(|s| s.current && s.monitor == target.monitor) {
        note_space(&from.id);
    }
    platform::go_space(&spaces, target)
}

/// The spaces in front lately, newest first, one entry each: stamped by
/// [`go_space`] with the space it leaves and by the app on every Space
/// change ([`note_space`] with the one that came up), so a swipe counts
/// too. Bounded: a session is long, the useful past is one step.
static SPACES: LazyLock<Mutex<VecDeque<String>>> = LazyLock::new(Default::default);
const SPACES_CAP: usize = 8;

/// Record that the space `id` is, or was until now, in front.
pub fn note_space(id: &str) {
    let mut h = SPACES.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    h.retain(|i| i != id);
    h.push_front(id.to_string());
    h.truncate(SPACES_CAP);
}

/// The space "back" goes to: the newest in `history` that still exists
/// and is not in front on its display (the stamps are the current space
/// on the way in and the one left on the way out, so the front of the
/// history is often where we are).
fn previous_space(spaces: &[Space], history: &VecDeque<String>) -> Option<String> {
    history.iter().find(|id| spaces.iter().any(|s| s.id == **id && !s.current)).cloned()
}

/// What [`apply`] did: `layout` is the one applied, which with
/// `Options::cycle` may be the next of the family asked for.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Applied {
    pub id: String,
    pub layout: layout::Layout,
    pub from: Rect,
    pub to: Rect,
}

/// The frame a window had before pal started moving it, with the frame pal
/// last gave it: a run of layouts counts as one move (each one compares the
/// current frame with `last`; a hand move in between starts a new run), so
/// `restore` goes back to where the user had put it.
struct Move {
    original: Rect,
    last: Rect,
}

/// In memory only: pal's own moves this run.
static MOVES: LazyLock<Mutex<HashMap<String, Move>>> = LazyLock::new(Default::default);

/// The window the `minimize` layout last put away, for `unminimize`.
static MINIMIZED: LazyLock<Mutex<Option<String>>> = LazyLock::new(Default::default);

/// The window `unminimize` brings back: the one pal's `minimize` last put
/// away while it is still minimised, else the first minimised window in
/// `all` (most recently used first, or front to back: the most recently
/// active one either way).
fn to_unminimize(last: Option<&str>, all: &[Window]) -> Option<String> {
    let still = |id: &str| all.iter().any(|w| w.id == id && w.minimized);
    last.filter(|id| still(id)).map(str::to_string).or_else(|| all.iter().find(|w| w.minimized).map(|w| w.id.clone()))
}

/// A frame read back within this of the one set counts as unmoved.
const MOVE_SLACK: f64 = 2.0;

/// What `restore` will go back to once the window at `from` is moved: the
/// remembered original while `from` is still where pal last put it, else
/// `from` itself (the user moved it since, so this starts a new run).
fn original_of(moves: &HashMap<String, Move>, id: &str, from: Rect) -> Rect {
    match moves.get(id) {
        Some(m) if m.last.about(&from, MOVE_SLACK) => m.original,
        _ => from,
    }
}

/// Put the window (`id`, else the focused one) where `layout` says
/// ([`layout::target`]), remembering the frame it left for `restore`; or,
/// for the state verbs, flip its full screen, minimise it, or bring back
/// the last one minimised (`unminimize` picks its own window when none is
/// given: [`to_unminimize`]).
pub fn apply(id: Option<&str>, layout: layout::Layout, opts: &layout::Options) -> Result<Applied> {
    use layout::Layout as L;
    let id = match (id, layout) {
        (Some(id), _) => id.to_string(),
        (None, L::Unminimize) => {
            let last = MINIMIZED.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
            to_unminimize(last.as_deref(), &list()?).ok_or_else(|| Error::Failed("no minimised window".into()))?
        }
        (None, _) => focused()?.ok_or_else(|| Error::Failed("no window has focus".into()))?.id,
    };
    let from = frame(&id)?;
    if matches!(layout, L::Fullscreen | L::Minimize | L::Unminimize) {
        match layout {
            L::Fullscreen => fullscreen(&id)?,
            L::Minimize => {
                minimize(&id)?;
                *MINIMIZED.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(id.clone());
            }
            _ => unminimize(&id)?,
        }
        return Ok(Applied { id, layout, from, to: from });
    }
    let (layout, to, remember) = if layout == L::Restore {
        let original = MOVES.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get(&id).map(|m| m.original);
        (layout, original.ok_or_else(|| Error::Failed("nothing to restore: pal has not moved that window".into()))?, None)
    } else {
        let displays = displays()?;
        if layout.changes_display() && displays.len() < 2 {
            return Err(Error::Failed("only one display".into()));
        }
        // With `cycle`, a half or a third asked for again steps to the next size of its family.
        let layout = if opts.cycle { layout::next_in_family(layout, &from, &displays, opts) } else { layout };
        let to = layout::target(layout, &from, &displays, opts).ok_or_else(|| Error::Failed("no display to lay the window out on".into()))?;
        let original = original_of(&MOVES.lock().unwrap_or_else(std::sync::PoisonError::into_inner), &id, from);
        (layout, to, Some(Move { original, last: to }))
    };
    set_frame(&id, to)?;
    let mut moves = MOVES.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    match remember {
        Some(m) => {
            moves.insert(id.clone(), m);
        }
        None => {
            moves.remove(&id);
        }
    }
    Ok(Applied { id, layout, from, to })
}

#[cfg(test)]
mod state_tests {
    use super::*;

    #[test]
    fn unminimize_takes_the_last_one_pal_minimised_else_the_front_minimised_window() {
        let w = |id: &str, minimized: bool| Window { id: id.into(), app: "a".into(), title: "t".into(), bundle_or_class: "b".into(), pid: 1, minimized, hidden: false, on_screen: !minimized, monitor: None, workspace: None };
        let all = vec![w("1", false), w("2", true), w("3", true)];
        assert_eq!(to_unminimize(Some("3"), &all).as_deref(), Some("3"), "pal's own, still minimised");
        assert_eq!(to_unminimize(Some("1"), &all).as_deref(), Some("2"), "pal's own was restored by hand since: the front minimised one");
        assert_eq!(to_unminimize(Some("gone"), &all).as_deref(), Some("2"));
        assert_eq!(to_unminimize(None, &all).as_deref(), Some("2"));
        assert_eq!(to_unminimize(None, &[w("1", false)]), None);
    }

    #[test]
    fn a_run_of_layouts_keeps_the_first_original_and_a_hand_move_starts_a_new_one() {
        let r = |x: f64| Rect { x, y: 0.0, w: 100.0, h: 100.0 };
        let mut moves = HashMap::new();
        assert_eq!(original_of(&moves, "w", r(10.0)), r(10.0), "first move: where it is now");
        moves.insert("w".into(), Move { original: r(10.0), last: r(500.0) });
        assert_eq!(original_of(&moves, "w", r(501.0)), r(10.0), "still where pal put it (within slack): the run goes on");
        assert_eq!(original_of(&moves, "w", r(300.0)), r(300.0), "moved by hand since: a new run from here");
        assert_eq!(original_of(&moves, "other", r(7.0)), r(7.0));
    }

    #[test]
    fn the_previous_space_is_the_newest_stamped_one_not_in_front() {
        let sp = |id: &str, current: bool| Space { id: id.into(), index: 1, name: None, current, previous: false, fullscreen: false, monitor: None, windows: vec![] };
        let spaces = vec![sp("web", false), sp("term", true), sp("misc", false)];
        let h = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<VecDeque<_>>();
        assert_eq!(previous_space(&spaces, &h(&["term", "web"])).as_deref(), Some("web"), "the one in front is skipped");
        assert_eq!(previous_space(&spaces, &h(&["gone", "misc", "web"])).as_deref(), Some("misc"), "a space that closed is skipped");
        assert_eq!(previous_space(&spaces, &h(&["term"])), None);
        assert_eq!(previous_space(&spaces, &VecDeque::new()), None);
    }

    #[test]
    fn history_orders_by_recency_and_leaves_the_rest_in_the_backend_order() {
        let w = |id: &str| Window { id: id.into(), app: "a".into(), title: "t".into(), bundle_or_class: "b".into(), pid: 1, minimized: false, hidden: false, on_screen: true, monitor: None, workspace: None };
        let ids = |ws: &[Window]| ws.iter().map(|w| w.id.clone()).collect::<Vec<_>>();
        let t0 = Instant::now();
        let at = |ms: u64| t0 + std::time::Duration::from_millis(ms);
        let front_to_back = vec![w("1"), w("2"), w("3"), w("4"), w("5")];
        assert_eq!(ids(&order_by_history(front_to_back.clone(), &VecDeque::new())), ["1", "2", "3", "4", "5"], "no history: the backend's order");
        // Newest first, as `note_focus` keeps it; a stamp for a window that is gone is ignored.
        let history: VecDeque<_> = [("4", at(30)), ("gone", at(20)), ("2", at(10))].into_iter().map(|(id, at)| (id.to_string(), at)).collect();
        assert_eq!(ids(&order_by_history(front_to_back, &history)), ["4", "2", "1", "3", "5"]);
    }
}

/// Run a tool and give back its stdout, [`Error::Failed`] with stderr when it
/// exits non-zero, [`Error::Unavailable`] when it is not installed.
#[cfg(not(target_os = "macos"))]
fn run(bin: &str, args: &[&str]) -> Result<String> {
    let out = std::process::Command::new(bin).args(args).output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::Unavailable(format!("{bin} is not installed")),
        _ => Error::Io(e),
    })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        return Err(Error::Failed(format!("{bin} {}: {err}", args.join(" "))));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::ax::element::Element;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication, NSScreen, NSWorkspace};
    use objc2_core_foundation::CFRetained;
    use objc2_core_graphics::{CGWindowListCopyWindowInfo, CGWindowListOption};
    use objc2_foundation::{MainThreadMarker, NSArray, NSDictionary, NSNumber, NSRect, NSString};
    use std::ptr::NonNull;

    // Spaces are the window server's, behind the private `CGS*` entry
    // points CoreGraphics re-exports from SkyLight (the same ones yabai
    // reads with SIP on; any process may call them, no permission). The
    // display list is an array of dictionaries, one per display: `Display
    // Identifier`, `Current Space` (`ManagedSpaceID`) and `Spaces` in
    // Mission Control's order, each with `ManagedSpaceID` and `type` (0 a
    // desktop, 4 a full-screen app's space). A window's spaces come back
    // as an array of ids; the mask 7 asks for every kind. Verified on
    // macOS 26.4: a desktop's windows answer their space, the furniture
    // (Chrome's helper windows, tooltips) none.
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C-unwind" {
        fn CGSMainConnectionID() -> i32;
        fn CGSCopyManagedDisplaySpaces(cid: i32) -> Option<NonNull<objc2_core_foundation::CFArray>>;
        fn CGSCopySpacesForWindows(cid: i32, mask: i32, wids: NonNull<objc2_core_foundation::CFArray>) -> Option<NonNull<objc2_core_foundation::CFArray>>;
    }
    const EVERY_SPACE: i32 = 7;
    const FULLSCREEN_SPACE: i64 = 4;

    /// One space of the window server, as [`CGSCopyManagedDisplaySpaces`]
    /// lists them: per display, in Mission Control's order.
    struct ManagedSpace {
        id: u64,
        display: String,
        current: bool,
        fullscreen: bool,
    }

    fn managed_spaces() -> Vec<ManagedSpace> {
        // SAFETY: a copy the caller owns, an array of dictionaries (toll-free
        // bridged), read only.
        let Some(arr) = (unsafe { CGSCopyManagedDisplaySpaces(CGSMainConnectionID()) }) else { return vec![] };
        let arr: CFRetained<objc2_core_foundation::CFArray> = unsafe { CFRetained::from_raw(arr) };
        // Untyped dictionaries throughout (a `downcast` of a nested one gives `NSDictionary<AnyObject, AnyObject>` too), so keys go in as objects.
        let arr: &NSArray<NSDictionary<AnyObject, AnyObject>> = unsafe { &*CFRetained::as_ptr(&arr).as_ptr().cast() };
        let key = |d: &NSDictionary<AnyObject, AnyObject>, k: &str| d.objectForKey(&*NSString::from_str(k));
        let num = |d: &NSDictionary<AnyObject, AnyObject>, k: &str| key(d, k).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.longLongValue());
        let mut out = vec![];
        for d in arr {
            let display = key(&d, "Display Identifier").and_then(|v| v.downcast::<NSString>().ok()).map(|s| s.to_string()).unwrap_or_default();
            let current = key(&d, "Current Space").and_then(|v| v.downcast::<NSDictionary>().ok()).and_then(|c| num(&c, "ManagedSpaceID"));
            let Some(spaces) = key(&d, "Spaces").and_then(|v| v.downcast::<NSArray>().ok()) else { continue };
            for s in spaces.iter().filter_map(|s| s.downcast::<NSDictionary>().ok()) {
                let Some(id) = num(&s, "ManagedSpaceID") else { continue };
                out.push(ManagedSpace { id: id as u64, display: display.clone(), current: Some(id) == current, fullscreen: num(&s, "type") == Some(FULLSCREEN_SPACE) });
            }
        }
        out
    }

    /// The spaces a window is on: one for a window of a desktop, several
    /// for a sticky one, none for the furniture.
    fn spaces_of_window(id: u32) -> Vec<u64> {
        let wids = NSArray::from_retained_slice(&[NSNumber::new_u32(id)]);
        // SAFETY: NSArray is toll-free bridged to CFArray; the copy returned is ours.
        let Some(arr) = (unsafe { CGSCopySpacesForWindows(CGSMainConnectionID(), EVERY_SPACE, NonNull::from(&*wids).cast()) }) else { return vec![] };
        let arr: CFRetained<objc2_core_foundation::CFArray> = unsafe { CFRetained::from_raw(arr) };
        let arr: &NSArray<NSNumber> = unsafe { &*CFRetained::as_ptr(&arr).as_ptr().cast() };
        arr.iter().map(|n| n.longLongValue() as u64).collect()
    }

    /// Mission Control's number for each desktop (1-based across displays,
    /// the full-screen spaces unnumbered), keyed by managed space id.
    fn desktop_numbers(spaces: &[ManagedSpace]) -> HashMap<u64, usize> {
        spaces.iter().filter(|s| !s.fullscreen).enumerate().map(|(i, s)| (s.id, i + 1)).collect()
    }

    /// `Window::workspace` for a window: the desktop's number.
    fn workspace_of(numbers: &HashMap<u64, usize>, wid: u32) -> Option<String> {
        spaces_of_window(wid).iter().find_map(|s| numbers.get(s)).map(|n| n.to_string())
    }

    pub fn spaces() -> Result<Vec<Space>> {
        let managed = managed_spaces();
        if managed.is_empty() {
            return Err(Error::Unavailable("the window server listed no spaces".into()));
        }
        let numbers = desktop_numbers(&managed);
        let displays: Vec<String> = managed.iter().map(|s| s.display.clone()).fold(vec![], |mut v, d| {
            if !v.contains(&d) {
                v.push(d);
            }
            v
        });
        // Windows worth listing (an app a person switches to, window-sized), each on its spaces.
        let mut on: HashMap<u64, Vec<String>> = HashMap::new();
        for cg in cg_windows() {
            if running(cg.pid).is_none() || cg.frame.w < MIN_SIDE || cg.frame.h < MIN_SIDE {
                continue;
            }
            for s in spaces_of_window(cg.id) {
                on.entry(s).or_default().push(cg.id.to_string());
            }
        }
        Ok(managed
            .into_iter()
            .map(|s| Space {
                index: numbers.get(&s.id).copied().unwrap_or(0),
                name: None,
                current: s.current,
                previous: false,
                fullscreen: s.fullscreen,
                monitor: (displays.len() > 1).then(|| format!("Display {}", displays.iter().position(|d| *d == s.display).unwrap_or(0) + 1)),
                windows: on.remove(&s.id).unwrap_or_default(),
                id: s.id.to_string(),
            })
            .collect())
    }

    /// The window to raise so the desktop follows it to `target`: the most
    /// recently used one there by the focus history, else the biggest;
    /// never a hidden app's (raising unhides it).
    fn landing(target: &Space) -> Option<String> {
        let cg = cg_windows();
        let shown = |id: &str| id.parse::<u32>().ok().and_then(|n| cg.iter().find(|w| w.id == n)).filter(|w| running(w.pid).is_some_and(|a| !a.isHidden()));
        let history = HISTORY.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((id, _)) = history.iter().find(|(id, _)| target.windows.iter().any(|w| w == id) && shown(id).is_some()) {
            return Some(id.clone());
        }
        target.windows.iter().filter_map(|id| shown(id).map(|w| (w.frame.w * w.frame.h, id))).max_by(|a, b| a.0.total_cmp(&b.0)).map(|(_, id)| id.clone())
    }

    pub fn go_space(spaces: &[Space], target: &Space) -> Result<()> {
        if let Some(id) = landing(target) {
            return super::focus(&id);
        }
        // Nothing to aim at: Mission Control's ctrl+left / ctrl+right, one
        // press per space between, along this display's strip.
        let strip: Vec<&Space> = spaces.iter().filter(|s| s.monitor == target.monitor).collect();
        let from = strip.iter().position(|s| s.current).ok_or_else(|| Error::Failed("no space is in front on that display".into()))?;
        let to = strip.iter().position(|s| s.id == target.id).unwrap_or(from);
        let (key, n) = if to > from { ("ctrl+right", to - from) } else { ("ctrl+left", from - to) };
        for i in 0..n {
            if i > 0 {
                std::thread::sleep(std::time::Duration::from_millis(SPACE_STEP_MS));
            }
            crate::clipboard::send_key(key).map_err(|e| match e {
                crate::clipboard::Error::NeedsAccessibility => Error::NeedsAccessibility("switching to an empty space"),
                e => Error::Failed(e.to_string()),
            })?;
        }
        Ok(())
    }

    /// Between two ctrl+arrow presses: Mission Control drops a press that
    /// lands mid-animation.
    const SPACE_STEP_MS: u64 = 250;

    /// A CoreGraphics and an AX frame agree within this many points.
    const FRAME_SLACK: f64 = 2.0;
    /// A CoreGraphics window with no AX counterpart is listed only when
    /// both sides are at least this: tab strips and 0x0 placeholders are not
    /// windows.
    const MIN_SIDE: f64 = 50.0;

    /// One row of `CGWindowListCopyWindowInfo`, the fields pal reads.
    struct CgWindow {
        id: u32,
        pid: i32,
        /// Empty without Screen Recording permission.
        name: String,
        frame: Rect,
        on_screen: bool,
    }

    pub fn backend() -> &'static str {
        "macos"
    }

    /// Layer-0, visible-alpha windows of other processes, front to back.
    fn cg_windows() -> Vec<CgWindow> {
        let Some(arr) = CGWindowListCopyWindowInfo(CGWindowListOption::OptionAll | CGWindowListOption::ExcludeDesktopElements, 0) else {
            return vec![];
        };
        // SAFETY: CFArray of CFDictionary is toll-free bridged to NSArray of NSDictionary.
        let arr: &NSArray<NSDictionary<NSString, AnyObject>> = unsafe { &*CFRetained::as_ptr(&arr).as_ptr().cast() };
        let me = std::process::id() as i32;
        arr.iter()
            .filter_map(|d| {
                let num = |k: &str| d.objectForKey(&NSString::from_str(k)).and_then(|v| v.downcast::<NSNumber>().ok());
                let text = |k: &str| d.objectForKey(&NSString::from_str(k)).and_then(|v| v.downcast::<NSString>().ok()).map(|s| s.to_string());
                if num("kCGWindowLayer")?.integerValue() != 0 || num("kCGWindowAlpha").is_some_and(|a| a.doubleValue() <= 0.0) {
                    return None;
                }
                let pid = num("kCGWindowOwnerPID")?.integerValue() as i32;
                let name = text("kCGWindowName").unwrap_or_default();
                if pid == me && name != OWN_WINDOW {
                    return None;
                }
                let bounds = d.objectForKey(&NSString::from_str("kCGWindowBounds"))?.downcast::<NSDictionary>().ok()?;
                let b = |k: &str| bounds.objectForKey(&*NSString::from_str(k)).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.doubleValue());
                Some(CgWindow {
                    id: num("kCGWindowNumber")?.integerValue() as u32,
                    pid,
                    name,
                    frame: Rect { x: b("X")?, y: b("Y")?, w: b("Width")?, h: b("Height")? },
                    on_screen: num("kCGWindowIsOnscreen").is_some_and(|n| n.boolValue()),
                })
            })
            .collect()
    }

    /// One AX window with its attributes read once, for matching.
    struct AxWindow {
        el: Element,
        title: String,
        frame: Option<Rect>,
        minimized: bool,
    }

    fn ax_windows(pid: i32) -> Vec<AxWindow> {
        let Some(app) = Element::app(pid) else { return vec![] };
        app.windows()
            .into_iter()
            .map(|el| AxWindow { title: el.title().unwrap_or_default(), frame: el.frame(), minimized: el.minimized(), el })
            .collect()
    }

    /// The AX window that is `cg`: same frame, the title breaking a tie
    /// (CoreGraphics' name can lag the app's, so it is not required to
    /// agree). Removed from `pool` so two identical windows each get their
    /// own.
    fn take_match(pool: &mut Vec<AxWindow>, cg: &CgWindow) -> Option<AxWindow> {
        let same = |ax: &AxWindow| ax.frame.is_some_and(|f| f.about(&cg.frame, FRAME_SLACK));
        let i = pool.iter().position(|ax| same(ax) && ax.title == cg.name).or_else(|| pool.iter().position(same))?;
        Some(pool.remove(i))
    }

    /// `NSScreen.screens`, the one with the menu bar first, `frame` and
    /// `visibleFrame` flipped from AppKit's bottom-left origin into the
    /// top-left space the window list reports in (the primary screen's
    /// height is the hinge). The id is the CoreGraphics display id
    /// (`NSScreenNumber`).
    pub fn displays() -> Result<Vec<Display>> {
        // SAFETY: `[NSScreen screens]` and the two frame getters read the
        // display configuration and are what tao (Tauri's monitor list,
        // which pal's panel placement relies on) calls from any thread the
        // same way; the marker is objc2's blanket rule for AppKit classes.
        // This runs on the bridge's blocking thread and in the example
        // binary, never on a thread that could race an AppKit event loop.
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let screens = NSScreen::screens(mtm);
        let Some(first) = screens.iter().next() else { return Err(Error::Unavailable("no display".into())) };
        let hinge = first.frame().size.height;
        let flip = |r: NSRect| Rect { x: r.origin.x, y: hinge - r.origin.y - r.size.height, w: r.size.width, h: r.size.height };
        let key = NSString::from_str("NSScreenNumber");
        Ok(screens
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let id = s.deviceDescription().objectForKey(&key).and_then(|v| v.downcast::<NSNumber>().ok()).map_or(0, |n| n.unsignedIntValue());
                Display { id: id.to_string(), frame: flip(s.frame()), visible_frame: flip(s.visibleFrame()), primary: i == 0 }
            })
            .collect())
    }

    fn monitor_of(displays: &[Display], f: &Rect) -> Option<String> {
        if displays.len() < 2 {
            return None;
        }
        let (cx, cy) = f.center();
        let i = displays.iter().position(|d| d.frame.contains(cx, cy))?;
        Some(format!("Display {}", i + 1))
    }

    /// The app behind a window, when it is one a person switches to: a
    /// regular app, or an accessory one (a menu bar app with a settings
    /// window, pal itself) whose window is then kept only when named.
    fn running(pid: i32) -> Option<Retained<NSRunningApplication>> {
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid).filter(|a| matches!(a.activationPolicy(), NSApplicationActivationPolicy::Regular | NSApplicationActivationPolicy::Accessory))
    }

    /// pal's one window worth switching back to; the panel, the HUD, the
    /// bar windows and Large Type are not windows to a person.
    const OWN_WINDOW: &str = "pal Settings";

    /// One row: the AX title when there is one, else CoreGraphics' name,
    /// else the app's.
    fn row(cg: &CgWindow, app: &NSRunningApplication, title: String, minimized: bool, hidden: bool, displays: &[Display], workspace: Option<String>) -> Window {
        let name = app.localizedName().map(|s| s.to_string()).unwrap_or_default();
        Window {
            id: cg.id.to_string(),
            title: if title.is_empty() { name.clone() } else { title },
            app: name,
            bundle_or_class: app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default(),
            pid: cg.pid,
            minimized,
            hidden,
            on_screen: cg.on_screen,
            monitor: monitor_of(displays, &cg.frame),
            workspace,
        }
    }

    pub fn list() -> Result<Vec<Window>> {
        let displays = displays().unwrap_or_default();
        let numbers = desktop_numbers(&managed_spaces());
        let cg = cg_windows();
        // Per app: whether it is hidden (read once), and its AX windows
        // still unmatched. Each AX read is a round trip to that app's main
        // thread, 10-30 ms for a napping one, so the apps are asked side
        // by side.
        let mut apps: Vec<(i32, Retained<NSRunningApplication>, bool, Vec<AxWindow>)> = vec![];
        let mut pids: Vec<i32> = vec![];
        for w in &cg {
            if !pids.contains(&w.pid) {
                if let Some(app) = running(w.pid) {
                    pids.push(w.pid);
                    let hidden = app.isHidden();
                    apps.push((w.pid, app, hidden, vec![]));
                }
            }
        }
        if crate::ax::trusted() {
            let ax: Vec<Vec<AxWindow>> = std::thread::scope(|s| {
                let handles: Vec<_> = pids.iter().map(|&pid| s.spawn(move || ax_windows(pid))).collect();
                handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
            });
            for (entry, ax) in apps.iter_mut().zip(ax) {
                entry.3 = ax;
            }
        }
        let mut out = vec![];
        for cg in cg {
            let Some(i) = apps.iter().position(|(p, ..)| *p == cg.pid) else { continue };
            let (_, app, hidden, pool) = &mut apps[i];
            let regular = app.activationPolicy() == NSApplicationActivationPolicy::Regular;
            let (title, minimized) = match take_match(pool, &cg) {
                // An accessory app's window counts only while Accessibility
                // lists it with a title: a settings window closed to hidden
                // or a capture overlay kept around sits in CoreGraphics'
                // list all the same, unnamed or unlisted by AX.
                Some(ax) if !regular && ax.title.is_empty() => continue,
                Some(ax) => (if ax.title.is_empty() { cg.name.clone() } else { ax.title }, ax.minimized),
                // No AX window for it: on another Space (`AXWindows` only
                // lists the current one), or the app answers AX with
                // nothing. Keep it if it looks like a window (named, or on
                // screen, and not one of the 0x0 / strip-shaped helpers);
                // never an accessory app's.
                None if !regular || (cg.name.is_empty() && !cg.on_screen) || cg.frame.w < MIN_SIDE || cg.frame.h < MIN_SIDE => continue,
                None => (cg.name.clone(), false),
            };
            let workspace = workspace_of(&numbers, cg.id);
            out.push(row(&cg, app, title, minimized, *hidden, &displays, workspace));
        }
        Ok(order_by_history(out, &HISTORY.lock().unwrap_or_else(std::sync::PoisonError::into_inner)))
    }

    /// The frontmost app's focused window: over AX when pal may look, else
    /// its front window in the CoreGraphics order. `None` when the front
    /// app has no window (Finder with the desktop, an app with all
    /// windows minimised).
    pub fn focused() -> Result<Option<Window>> {
        let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() else { return Ok(None) };
        let pid = app.processIdentifier();
        if pid == std::process::id() as i32 {
            return Ok(None);
        }
        let displays = displays().unwrap_or_default();
        let cg = cg_windows();
        let ax = if crate::ax::trusted() { Element::app(pid).and_then(|a| a.focused_window()) } else { None };
        let (cg, title, minimized) = match ax {
            Some(win) => {
                let frame = win.frame();
                let title = win.title().unwrap_or_default();
                let same = |w: &&CgWindow| frame.is_some_and(|f| f.about(&w.frame, FRAME_SLACK));
                let mine = || cg.iter().filter(|w| w.pid == pid);
                let hit = mine().find(|w| same(w) && w.name == title).or_else(|| mine().find(same));
                match hit {
                    Some(w) => (w, title, win.minimized()),
                    None => return Ok(None),
                }
            }
            None => match cg.iter().find(|w| w.pid == pid && w.on_screen && w.frame.w >= MIN_SIDE && w.frame.h >= MIN_SIDE) {
                Some(w) => (w, w.name.clone(), false),
                None => return Ok(None),
            },
        };
        let workspace = workspace_of(&desktop_numbers(&managed_spaces()), cg.id);
        Ok(Some(row(cg, &app, title, minimized, app.isHidden(), &displays, workspace)))
    }

    pub fn frame(id: &str) -> Result<Rect> {
        Ok(find(id)?.frame)
    }

    pub fn set_frame(id: &str, rect: Rect) -> Result<()> {
        let cg = find(id)?;
        ax_of(&cg, "set_frame")?.set_frame(rect).then_some(()).ok_or_else(|| Error::Failed("the app refused the new frame".into()))
    }

    fn find(id: &str) -> Result<CgWindow> {
        let n: u32 = id.parse().map_err(|_| Error::NotFound(id.into()))?;
        cg_windows().into_iter().find(|w| w.id == n).ok_or_else(|| Error::NotFound(id.into()))
    }

    /// The AX window behind a CoreGraphics one, when pal may look. An app
    /// can list nothing over AX (napping on another space, no AX support):
    /// [`Error::Failed`], not `NotFound`, since the window is there.
    fn ax_of(cg: &CgWindow, what: &'static str) -> Result<Element> {
        if !crate::ax::trusted() {
            return Err(Error::NeedsAccessibility(what));
        }
        take_match(&mut ax_windows(cg.pid), cg).map(|ax| ax.el).ok_or_else(|| Error::Failed("the app does not expose that window to Accessibility".into()))
    }

    pub fn focus(id: &str) -> Result<()> {
        let cg = find(id)?;
        // The window first, so the app comes forward showing it rather than
        // whichever window it last had in front.
        let raised = match ax_of(&cg, "focus") {
            Ok(win) => {
                if win.minimized() {
                    win.set_minimized(false);
                }
                win.raise()
            }
            // App-level activation is what is left without the permission,
            // or when the app does not expose the window.
            Err(Error::NeedsAccessibility(_) | Error::Failed(_)) => true,
            Err(e) => return Err(e),
        };
        activate_app(&cg, id)?;
        raised.then_some(()).ok_or_else(|| Error::Failed("the app came forward but refused to raise that window".into()))
    }

    pub fn activate(id: &str) -> Result<String> {
        activate_app(&find(id)?, id)
    }

    /// Unhide and activate the app owning `cg`; its name on success.
    fn activate_app(cg: &CgWindow, id: &str) -> Result<String> {
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(cg.pid).ok_or_else(|| Error::NotFound(id.into()))?;
        app.unhide();
        #[allow(deprecated)] // `activate()` (14+) does not take focus from another app without a cooperative handoff.
        if !app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps) {
            return Err(Error::Failed("the app refused to activate".into()));
        }
        Ok(app.localizedName().map(|s| s.to_string()).unwrap_or_default())
    }

    pub fn close(id: &str) -> Result<()> {
        let cg = find(id)?;
        ax_of(&cg, "close")?.close().then_some(()).ok_or_else(|| Error::Failed("no close button on that window".into()))
    }

    pub fn minimize(id: &str) -> Result<()> {
        let cg = find(id)?;
        ax_of(&cg, "minimize")?.set_minimized(true).then_some(()).ok_or_else(|| Error::Failed("the window cannot be minimised".into()))
    }

    pub fn fullscreen(id: &str) -> Result<()> {
        let cg = find(id)?;
        let win = ax_of(&cg, "fullscreen")?;
        let on = win.fullscreen().ok_or_else(|| Error::Failed("the window cannot go full screen".into()))?;
        win.set_fullscreen(!on).then_some(()).ok_or_else(|| Error::Failed("the app refused to change full screen".into()))
    }

    pub fn app_icon_source(w: &Window) -> Option<PathBuf> {
        let url = NSRunningApplication::runningApplicationWithProcessIdentifier(w.pid)?.bundleURL()?;
        Some(PathBuf::from(url.path()?.to_string()))
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use crate::fs::on_path as has;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Backend {
        Hyprland,
        Sway,
        X11,
    }

    /// `hyprctl` needs `HYPRLAND_INSTANCE_SIGNATURE`, which a pal started
    /// from a systemd user service does not inherit; the running instance
    /// is the newest directory under `$XDG_RUNTIME_DIR/hypr`.
    fn hyprland_signature() -> Option<String> {
        if let Some(s) = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").filter(|s| !s.is_empty()) {
            return Some(s.to_string_lossy().into_owned());
        }
        let dir = PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR")?).join("hypr");
        let mut dirs: Vec<_> = std::fs::read_dir(dir).ok()?.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).ok()));
        Some(dirs.first()?.file_name().to_string_lossy().into_owned())
    }

    fn detect() -> Option<Backend> {
        if has("hyprctl") && hyprland_signature().is_some() {
            return Some(Backend::Hyprland);
        }
        if has("swaymsg") && std::env::var_os("SWAYSOCK").is_some() {
            return Some(Backend::Sway);
        }
        if has("wmctrl") && std::env::var_os("DISPLAY").is_some() {
            return Some(Backend::X11);
        }
        None
    }

    fn need() -> Result<Backend> {
        detect().ok_or_else(|| Error::Unavailable("no Hyprland, Sway or X11 (wmctrl) session".into()))
    }

    pub fn backend() -> &'static str {
        match detect() {
            Some(Backend::Hyprland) => "hyprland",
            Some(Backend::Sway) => "sway",
            Some(Backend::X11) => "x11",
            None => "none",
        }
    }

    fn hyprctl(args: &[&str]) -> Result<String> {
        let sig = hyprland_signature().ok_or_else(|| Error::Unavailable("no Hyprland instance".into()))?;
        let out = std::process::Command::new("hyprctl").env("HYPRLAND_INSTANCE_SIGNATURE", sig).args(args).output()?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        // A dispatch answers "ok" on stdout, anything else is its complaint.
        if !out.status.success() || (args.first() == Some(&"dispatch") && text != "ok") {
            return Err(Error::Failed(format!("hyprctl {}: {}", args.join(" "), if text.is_empty() { String::from_utf8_lossy(&out.stderr).trim().to_string() } else { text })));
        }
        Ok(text)
    }

    /// `swaymsg` exits 0 with `[{"success": false, "error": ...}]` on a bad command.
    fn swaymsg(cmd: &str) -> Result<()> {
        let out = run("swaymsg", &["-t", "command", cmd])?;
        let v: serde_json::Value = serde_json::from_str(&out).unwrap_or_default();
        match v.get(0) {
            Some(r) if r.get("success").and_then(|s| s.as_bool()) == Some(true) => Ok(()),
            Some(r) => Err(Error::Failed(format!("swaymsg {cmd}: {}", r.get("error").and_then(|e| e.as_str()).unwrap_or("failed")))),
            None => Err(Error::Failed(format!("swaymsg {cmd}: no reply"))),
        }
    }

    pub fn list() -> Result<Vec<Window>> {
        Ok(match need()? {
            Backend::Hyprland => parse_hyprland(&hyprctl(&["clients", "-j"])?, &hyprctl(&["monitors", "-j"])?),
            Backend::Sway => parse_sway(&run("swaymsg", &["-t", "get_tree"])?),
            Backend::X11 => parse_wmctrl(&run("wmctrl", &["-lpx"])?),
        })
    }

    fn find(id: &str) -> Result<Window> {
        list()?.into_iter().find(|w| w.id == id).ok_or_else(|| Error::NotFound(id.into()))
    }

    pub fn focus(id: &str) -> Result<()> {
        match need()? {
            Backend::Hyprland => {
                let w = find(id)?;
                if w.minimized {
                    // Back onto the workspace in front, which also focuses it.
                    let ws: serde_json::Value = serde_json::from_str(&hyprctl(&["activeworkspace", "-j"])?).unwrap_or_default();
                    let ws = ws.get("id").and_then(|i| i.as_i64()).ok_or_else(|| Error::Failed("no active workspace".into()))?;
                    hyprctl(&["dispatch", "movetoworkspace", &format!("{ws},address:{id}")])?;
                }
                hyprctl(&["dispatch", "focuswindow", &format!("address:{id}")]).map(drop)
            }
            Backend::Sway => {
                let w = find(id)?;
                swaymsg(&format!("[con_id={id}] {}", if w.minimized { "scratchpad show" } else { "focus" }))
            }
            Backend::X11 => run("wmctrl", &["-i", "-a", id]).map(drop),
        }
    }

    /// No app level under a window manager: the window itself, named by its app.
    pub fn activate(id: &str) -> Result<String> {
        let w = find(id)?;
        focus(id)?;
        Ok(w.app)
    }

    pub fn close(id: &str) -> Result<()> {
        match need()? {
            Backend::Hyprland => hyprctl(&["dispatch", "closewindow", &format!("address:{id}")]).map(drop),
            Backend::Sway => swaymsg(&format!("[con_id={id}] kill")),
            Backend::X11 => run("wmctrl", &["-i", "-c", id]).map(drop),
        }
    }

    pub fn minimize(id: &str) -> Result<()> {
        match need()? {
            Backend::Hyprland => hyprctl(&["dispatch", "movetoworkspacesilent", &format!("special:minimized,address:{id}")]).map(drop),
            Backend::Sway => swaymsg(&format!("[con_id={id}] move scratchpad")),
            Backend::X11 if has("xdotool") => run("xdotool", &["windowminimize", id]).map(drop),
            Backend::X11 => Err(Error::Unavailable("minimise on X11 needs xdotool".into())),
        }
    }

    /// Hyprland's `fullscreen` dispatcher takes no window: the window is
    /// focused first, which is what the verb means anyway.
    pub fn fullscreen(id: &str) -> Result<()> {
        match need()? {
            Backend::Hyprland => {
                hyprctl(&["dispatch", "focuswindow", &format!("address:{id}")])?;
                hyprctl(&["dispatch", "fullscreen", "0"]).map(drop)
            }
            Backend::Sway => swaymsg(&format!("[con_id={id}] fullscreen toggle")),
            Backend::X11 => run("wmctrl", &["-i", "-r", id, "-b", "toggle,fullscreen"]).map(drop),
        }
    }

    // ---- frames, displays, focus ------------------------------------------

    pub fn frame(id: &str) -> Result<Rect> {
        let found = match need()? {
            Backend::Hyprland => hyprland_client(id)?.map(|c| hyprland_frame(&c)),
            Backend::Sway => sway_node(&run("swaymsg", &["-t", "get_tree"])?, |n| n["id"].as_i64().map(|i| i.to_string()).as_deref() == Some(id)).map(|n| sway_rect(&n["rect"])),
            Backend::X11 => parse_wmctrl_geometry(&run("wmctrl", &["-lG"])?).into_iter().find(|(i, _)| i == id).map(|(_, r)| r),
        };
        found.ok_or_else(|| Error::NotFound(id.into()))
    }

    /// A tiled window is floated first: an exact frame means nothing inside
    /// a tiling layout (Hyprland ignores `movewindowpixel` for it, Sway
    /// would resize the split).
    pub fn set_frame(id: &str, r: Rect) -> Result<()> {
        let (x, y, w, h) = (r.x.round() as i64, r.y.round() as i64, r.w.round().max(1.0) as i64, r.h.round().max(1.0) as i64);
        match need()? {
            Backend::Hyprland => {
                let c = hyprland_client(id)?.ok_or_else(|| Error::NotFound(id.into()))?;
                if c["floating"].as_bool() != Some(true) {
                    hyprctl(&["dispatch", "setfloating", &format!("address:{id}")])?;
                }
                hyprctl(&["dispatch", "resizewindowpixel", &format!("exact {w} {h},address:{id}")])?;
                hyprctl(&["dispatch", "movewindowpixel", &format!("exact {x} {y},address:{id}")]).map(drop)
            }
            Backend::Sway => {
                swaymsg(&format!("[con_id={id}] floating enable"))?;
                swaymsg(&format!("[con_id={id}] resize set {w} px {h} px"))?;
                swaymsg(&format!("[con_id={id}] move absolute position {x} px {y} px"))
            }
            Backend::X11 => run("wmctrl", &["-i", "-r", id, "-e", &format!("0,{x},{y},{w},{h}")]).map(drop),
        }
    }

    pub fn spaces() -> Result<Vec<Space>> {
        let windows = list()?;
        let (monitors, mut spaces) = match need()? {
            Backend::Hyprland => {
                let monitors: Vec<serde_json::Value> = serde_json::from_str(&hyprctl(&["monitors", "-j"])?).unwrap_or_default();
                let active: Vec<String> = monitors.iter().filter_map(|m| m["activeWorkspace"]["name"].as_str().map(str::to_string)).collect();
                (monitors.len(), parse_hyprland_workspaces(&hyprctl(&["workspaces", "-j"])?, &active))
            }
            Backend::Sway => {
                let spaces = parse_sway_workspaces(&run("swaymsg", &["-t", "get_workspaces"])?);
                (spaces.iter().filter_map(|s| s.monitor.clone()).collect::<std::collections::HashSet<_>>().len(), spaces)
            }
            Backend::X11 => (1, parse_wmctrl_desktops(&run("wmctrl", &["-d"])?)),
        };
        // `Window::workspace` is the space's name (Hyprland, Sway) or number (X11): the join.
        for s in &mut spaces {
            let key = s.name.clone().unwrap_or_else(|| s.id.clone());
            s.windows = windows.iter().filter(|w| w.workspace.as_deref() == Some(&key)).map(|w| w.id.clone()).collect();
            if monitors < 2 {
                s.monitor = None;
            }
        }
        Ok(spaces)
    }

    pub fn go_space(_spaces: &[Space], target: &Space) -> Result<()> {
        match need()? {
            Backend::Hyprland => hyprctl(&["dispatch", "workspace", &target.id]).map(drop),
            Backend::Sway => swaymsg(&format!("workspace {}", target.name.as_deref().unwrap_or(&target.id))),
            Backend::X11 => run("wmctrl", &["-s", &target.id]).map(drop),
        }
    }

    /// `hyprctl workspaces -j`: every workspace that exists (Hyprland makes
    /// them as they are used), by id; `active` names the one in front on
    /// each monitor. The special ones (scratchpads, pal's `special:minimized`)
    /// are not spaces to go to.
    pub fn parse_hyprland_workspaces(text: &str, active: &[String]) -> Vec<Space> {
        let mut ws: Vec<serde_json::Value> = serde_json::from_str(text).unwrap_or_default();
        ws.sort_by_key(|w| w["id"].as_i64().unwrap_or_default());
        ws.iter()
            .filter(|w| w["id"].as_i64().unwrap_or_default() > 0)
            .map(|w| {
                let name = w["name"].as_str().unwrap_or_default().to_string();
                Space {
                    id: w["id"].as_i64().unwrap_or_default().to_string(),
                    index: w["id"].as_i64().unwrap_or_default().max(0) as usize,
                    current: active.contains(&name),
                    monitor: w["monitor"].as_str().map(str::to_string),
                    name: Some(name),
                    previous: false,
                    fullscreen: false,
                    windows: vec![],
                }
            })
            .collect()
    }

    /// `swaymsg -t get_workspaces`: name, number, `focused`/`visible`, output.
    pub fn parse_sway_workspaces(text: &str) -> Vec<Space> {
        let ws: Vec<serde_json::Value> = serde_json::from_str(text).unwrap_or_default();
        ws.iter()
            .map(|w| {
                let name = w["name"].as_str().unwrap_or_default().to_string();
                Space {
                    id: name.clone(),
                    index: w["num"].as_i64().unwrap_or_default().max(0) as usize,
                    current: w["visible"].as_bool() == Some(true) || w["focused"].as_bool() == Some(true),
                    monitor: w["output"].as_str().map(str::to_string),
                    name: Some(name),
                    previous: false,
                    fullscreen: false,
                    windows: vec![],
                }
            })
            .collect()
    }

    /// `wmctrl -d` lines (`0  * DG: 3840x1080  VP: 0,0  WA: 0,25 3840x1055  Workspace 1`):
    /// the desktop number, `*` on the current one.
    pub fn parse_wmctrl_desktops(text: &str) -> Vec<Space> {
        text.lines()
            .filter_map(|l| {
                let mut it = l.split_whitespace();
                let n: usize = it.next()?.parse().ok()?;
                Some(Space { id: n.to_string(), index: n + 1, name: None, current: it.next() == Some("*"), previous: false, fullscreen: false, monitor: None, windows: vec![] })
            })
            .collect()
    }

    pub fn displays() -> Result<Vec<Display>> {
        let out = match need()? {
            Backend::Hyprland => parse_hyprland_monitors(&hyprctl(&["monitors", "-j"])?),
            Backend::Sway => parse_sway_outputs(&run("swaymsg", &["-t", "get_outputs"])?, &run("swaymsg", &["-t", "get_workspaces"])?),
            Backend::X11 => parse_x11_monitors(&run("xrandr", &["--listmonitors"]).unwrap_or_default(), &run("wmctrl", &["-d"])?),
        };
        if out.is_empty() {
            return Err(Error::Unavailable("no display".into()));
        }
        Ok(out)
    }

    pub fn focused() -> Result<Option<Window>> {
        let id = match need()? {
            // `{}` when nothing has focus.
            Backend::Hyprland => serde_json::from_str::<serde_json::Value>(&hyprctl(&["activewindow", "-j"])?).ok().and_then(|v| v["address"].as_str().map(str::to_string)),
            Backend::Sway => sway_node(&run("swaymsg", &["-t", "get_tree"])?, |n| n["focused"].as_bool() == Some(true) && n["pid"].is_i64()).and_then(|n| n["id"].as_i64()).map(|i| i.to_string()),
            Backend::X11 => parse_active_window(&run("xprop", &["-root", "_NET_ACTIVE_WINDOW"])?),
        };
        let Some(id) = id else { return Ok(None) };
        Ok(list()?.into_iter().find(|w| w.id == id))
    }

    fn hyprland_client(id: &str) -> Result<Option<serde_json::Value>> {
        let clients: Vec<serde_json::Value> = serde_json::from_str(&hyprctl(&["clients", "-j"])?).unwrap_or_default();
        Ok(clients.into_iter().find(|c| c["address"].as_str() == Some(id)))
    }

    /// `at` and `size` of one `hyprctl clients -j` entry, logical pixels.
    fn hyprland_frame(c: &serde_json::Value) -> Rect {
        let n = |v: &serde_json::Value, i: usize| v[i].as_f64().unwrap_or_default();
        Rect { x: n(&c["at"], 0), y: n(&c["at"], 1), w: n(&c["size"], 0), h: n(&c["size"], 1) }
    }

    /// The first node of a `get_tree` (depth first, `nodes` then
    /// `floating_nodes`) that `pred` accepts.
    fn sway_node(tree: &str, pred: impl Fn(&serde_json::Value) -> bool) -> Option<serde_json::Value> {
        fn walk(n: &serde_json::Value, pred: &dyn Fn(&serde_json::Value) -> bool) -> Option<serde_json::Value> {
            if pred(n) {
                return Some(n.clone());
            }
            ["nodes", "floating_nodes"].iter().flat_map(|k| n[*k].as_array().into_iter().flatten()).find_map(|c| walk(c, pred))
        }
        walk(&serde_json::from_str(tree).unwrap_or_default(), &pred)
    }

    fn sway_rect(r: &serde_json::Value) -> Rect {
        Rect { x: r["x"].as_f64().unwrap_or_default(), y: r["y"].as_f64().unwrap_or_default(), w: r["width"].as_f64().unwrap_or_default(), h: r["height"].as_f64().unwrap_or_default() }
    }

    /// `hyprctl monitors -j`: `x`, `y` and `width` / `height` (physical,
    /// divided by `scale`, swapped for a rotated `transform`) make the
    /// frame; `reserved` (left, top, right, bottom: bars) comes off for the
    /// visible one. The focused monitor is not the primary: Hyprland has
    /// none, so the first listed is.
    pub fn parse_hyprland_monitors(text: &str) -> Vec<Display> {
        let monitors: Vec<serde_json::Value> = serde_json::from_str(text).unwrap_or_default();
        monitors
            .iter()
            .enumerate()
            .filter(|(_, m)| m["disabled"].as_bool() != Some(true))
            .map(|(i, m)| {
                let scale = m["scale"].as_f64().filter(|s| *s > 0.0).unwrap_or(1.0);
                let (mut w, mut h) = (m["width"].as_f64().unwrap_or_default() / scale, m["height"].as_f64().unwrap_or_default() / scale);
                if m["transform"].as_i64().unwrap_or_default() % 2 == 1 {
                    std::mem::swap(&mut w, &mut h);
                }
                let frame = Rect { x: m["x"].as_f64().unwrap_or_default(), y: m["y"].as_f64().unwrap_or_default(), w, h };
                let r = |i: usize| m["reserved"][i].as_f64().unwrap_or_default();
                let (left, top, right, bottom) = (r(0), r(1), r(2), r(3));
                let visible_frame = Rect { x: frame.x + left, y: frame.y + top, w: frame.w - left - right, h: frame.h - top - bottom };
                Display { id: m["name"].as_str().unwrap_or_default().to_string(), frame, visible_frame, primary: i == 0 }
            })
            .collect()
    }

    /// `swaymsg -t get_outputs` for the frames (`rect`), `-t get_workspaces`
    /// for the visible ones: a workspace's `rect` is its output minus the
    /// bars, and every workspace of an output has the same.
    pub fn parse_sway_outputs(outputs: &str, workspaces: &str) -> Vec<Display> {
        let outputs: Vec<serde_json::Value> = serde_json::from_str(outputs).unwrap_or_default();
        let workspaces: Vec<serde_json::Value> = serde_json::from_str(workspaces).unwrap_or_default();
        outputs
            .iter()
            .filter(|o| o["active"].as_bool() != Some(false))
            .enumerate()
            .map(|(i, o)| {
                let name = o["name"].as_str().unwrap_or_default().to_string();
                let frame = sway_rect(&o["rect"]);
                let visible_frame = workspaces.iter().find(|w| w["output"].as_str() == Some(&name)).map_or(frame, |w| sway_rect(&w["rect"]));
                Display { id: name, frame, visible_frame, primary: i == 0 }
            })
            .collect()
    }

    /// `xrandr --listmonitors` lines (`+*HDMI-1 1920/527x1080/296+0+0  HDMI-1`)
    /// for the frames, the `WA:` of the current desktop in `wmctrl -d` for
    /// the work area every frame is cut to. Without xrandr, the desktop's
    /// geometry (`DG:`) is the one display.
    pub fn parse_x11_monitors(xrandr: &str, wmctrl_d: &str) -> Vec<Display> {
        // `0  * DG: 3840x1080  VP: 0,0  WA: 0,25 3840x1055  Workspace 1`
        let current = wmctrl_d.lines().find(|l| l.split_whitespace().nth(1) == Some("*")).or_else(|| wmctrl_d.lines().next()).unwrap_or_default();
        let after = |key: &str| current.split_once(key).map(|(_, r)| r.trim_start());
        let size = |s: &str| s.split_once('x').and_then(|(w, h)| Some((w.parse::<f64>().ok()?, h.parse::<f64>().ok()?)));
        let point = |s: &str| s.split_once(',').and_then(|(x, y)| Some((x.parse::<f64>().ok()?, y.parse::<f64>().ok()?)));
        let desktop = after("DG:").and_then(|r| size(r.split_whitespace().next()?)).map(|(w, h)| Rect { x: 0.0, y: 0.0, w, h });
        let work = after("WA:").and_then(|r| {
            let mut it = r.split_whitespace();
            let (x, y) = point(it.next()?)?;
            let (w, h) = size(it.next()?)?;
            Some(Rect { x, y, w, h })
        });
        let mut out: Vec<Display> = xrandr
            .lines()
            .filter_map(|l| {
                let mut it = l.split_whitespace();
                let idx = it.next()?.strip_suffix(':')?;
                idx.parse::<u32>().ok()?;
                let name = it.next()?;
                let geometry = it.next()?;
                let (dims, rest) = geometry.split_once('+')?;
                let (x, y) = rest.split_once('+')?;
                let (w, h) = dims.split_once('x')?;
                let px = |s: &str| s.split('/').next()?.parse::<f64>().ok();
                Some(Display {
                    id: it.next().unwrap_or(name.trim_start_matches(['+', '*'])).to_string(),
                    frame: Rect { x: x.parse().ok()?, y: y.parse().ok()?, w: px(w)?, h: px(h)? },
                    visible_frame: Rect::default(),
                    primary: name.contains('*'),
                })
            })
            .collect();
        if out.is_empty() {
            if let Some(d) = desktop {
                out.push(Display { id: "desktop".into(), frame: d, visible_frame: d, primary: true });
            }
        }
        if !out.iter().any(|d| d.primary) {
            if let Some(d) = out.first_mut() {
                d.primary = true;
            }
        }
        out.sort_by_key(|d| !d.primary);
        for d in &mut out {
            d.visible_frame = match work {
                Some(wa) => {
                    let x0 = d.frame.x.max(wa.x);
                    let y0 = d.frame.y.max(wa.y);
                    let x1 = (d.frame.x + d.frame.w).min(wa.x + wa.w);
                    let y1 = (d.frame.y + d.frame.h).min(wa.y + wa.h);
                    if x1 > x0 && y1 > y0 {
                        Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
                    } else {
                        d.frame
                    }
                }
                None => d.frame,
            };
        }
        out
    }

    /// `wmctrl -lG`: `id desktop x y w h host title...`.
    pub fn parse_wmctrl_geometry(text: &str) -> Vec<(String, Rect)> {
        text.lines()
            .filter_map(|l| {
                let mut it = l.split_whitespace();
                let id = it.next()?.to_string();
                let _desktop = it.next()?;
                let mut n = || it.next()?.parse::<f64>().ok();
                Some((id, Rect { x: n()?, y: n()?, w: n()?, h: n()? }))
            })
            .collect()
    }

    /// `xprop -root _NET_ACTIVE_WINDOW`: `_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3400003`,
    /// as the `0x%08x` id `wmctrl` lists.
    pub fn parse_active_window(text: &str) -> Option<String> {
        let hex = text.rsplit_once('#')?.1.trim().split([',', ' ']).next()?.trim_start_matches("0x");
        let id = u64::from_str_radix(hex, 16).ok().filter(|i| *i != 0)?;
        Some(format!("{id:#010x}"))
    }

    // ---- parsers ---------------------------------------------------------

    /// `hyprctl clients -j` with `hyprctl monitors -j` for the monitor names,
    /// most recently focused first. Unmapped clients (still starting, or
    /// gone) are skipped; a window parked on `special:minimized` (what
    /// [`minimize`] does) is reported minimised.
    pub fn parse_hyprland(clients: &str, monitors: &str) -> Vec<Window> {
        let monitors: Vec<serde_json::Value> = serde_json::from_str(monitors).unwrap_or_default();
        let monitor_name = |id: i64| monitors.iter().find(|m| m["id"].as_i64() == Some(id)).and_then(|m| m["name"].as_str()).map(str::to_string);
        let mut clients: Vec<serde_json::Value> = serde_json::from_str(clients).unwrap_or_default();
        clients.sort_by_key(|c| c["focusHistoryID"].as_i64().unwrap_or(i64::MAX));
        clients
            .iter()
            .filter(|c| c["mapped"].as_bool() == Some(true) && c["pid"].as_i64().unwrap_or(-1) > 0)
            .map(|c| {
                let class = c["class"].as_str().filter(|s| !s.is_empty()).or_else(|| c["initialClass"].as_str()).unwrap_or_default().to_string();
                let ws = c["workspace"]["name"].as_str().unwrap_or_default().to_string();
                let title = c["title"].as_str().unwrap_or_default().to_string();
                Window {
                    id: c["address"].as_str().unwrap_or_default().to_string(),
                    app: class.clone(),
                    title: if title.is_empty() { class.clone() } else { title },
                    bundle_or_class: class,
                    pid: c["pid"].as_i64().unwrap_or_default() as i32,
                    minimized: ws.starts_with("special:"),
                    hidden: false,
                    on_screen: c["visible"].as_bool() == Some(true),
                    monitor: if monitors.len() > 1 { c["monitor"].as_i64().and_then(monitor_name) } else { None },
                    workspace: Some(ws),
                }
            })
            .collect()
    }

    /// `swaymsg -t get_tree`: every container with a pid, in tree order;
    /// scratchpad ones (under `__i3_scratch`) are the minimised.
    pub fn parse_sway(tree: &str) -> Vec<Window> {
        let root: serde_json::Value = serde_json::from_str(tree).unwrap_or_default();
        let outputs = root["nodes"].as_array().map_or(0, |o| o.iter().filter(|o| o["name"].as_str() != Some("__i3")).count());
        let mut out = vec![];
        fn walk(n: &serde_json::Value, output: Option<&str>, workspace: Option<&str>, many: bool, out: &mut Vec<Window>) {
            let name = n["name"].as_str();
            let (output, workspace) = match n["type"].as_str() {
                Some("output") => (name, None),
                Some("workspace") => (output, name),
                _ => (output, workspace),
            };
            if let Some(pid) = n["pid"].as_i64() {
                let class = n["app_id"].as_str().or_else(|| n["window_properties"]["class"].as_str()).unwrap_or_default().to_string();
                let title = name.unwrap_or_default().to_string();
                let scratch = workspace == Some("__i3_scratch") || n["scratchpad_state"].as_str().is_some_and(|s| s != "none");
                out.push(Window {
                    id: n["id"].as_i64().unwrap_or_default().to_string(),
                    app: class.clone(),
                    title: if title.is_empty() { class.clone() } else { title },
                    bundle_or_class: class,
                    pid: pid as i32,
                    minimized: scratch,
                    hidden: false,
                    on_screen: n["visible"].as_bool() == Some(true),
                    monitor: if many && !scratch { output.map(str::to_string) } else { None },
                    workspace: workspace.filter(|_| !scratch).map(str::to_string),
                });
            }
            for k in ["nodes", "floating_nodes"] {
                for c in n[k].as_array().into_iter().flatten() {
                    walk(c, output, workspace, many, out);
                }
            }
        }
        walk(&root, None, None, outputs > 1, &mut out);
        out
    }

    /// `wmctrl -lpx`: `id desktop pid instance.class host title...`. The
    /// desktop itself and panels come as pid 0 with class `N/A`; skipped.
    pub fn parse_wmctrl(text: &str) -> Vec<Window> {
        text.lines()
            .filter_map(|l| {
                // Five fixed columns, then the title with its own spaces.
                let mut rest = l.trim_start();
                let mut field = || {
                    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                    let f = &rest[..end];
                    rest = rest[end..].trim_start();
                    f
                };
                let (id, desktop, pid, class, _host) = (field(), field(), field(), field(), field());
                let title = rest.trim_end().to_string();
                let pid: i32 = pid.parse().ok().filter(|p| *p > 0)?;
                if class == "N/A" {
                    return None;
                }
                let class = class.rsplit('.').next().unwrap_or(class).to_string();
                Some(Window {
                    id: id.to_string(),
                    app: class.clone(),
                    title: if title.is_empty() { class.clone() } else { title },
                    bundle_or_class: class,
                    pid,
                    minimized: false,
                    hidden: false,
                    on_screen: true,
                    monitor: None,
                    workspace: Some(desktop.to_string()).filter(|d| d != "-1"),
                })
            })
            .collect()
    }

    // ---- icons -------------------------------------------------------------

    /// The `.desktop` file for a window class: `<class>.desktop` by name
    /// (case-insensitive, the common case for `app_id`s like `org.gnome.Nautilus`
    /// or `kitty`), else the entry whose `StartupWMClass` is the class.
    fn desktop_for_class(class: &str) -> Option<PathBuf> {
        let want = format!("{}.desktop", class.to_lowercase());
        let mut by_wmclass = None;
        for dir in crate::fs::desktop_dirs() {
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let name = e.file_name().to_string_lossy().to_lowercase();
                if !name.ends_with(".desktop") {
                    continue;
                }
                if name == want {
                    return Some(e.path());
                }
                if by_wmclass.is_none() {
                    let text = std::fs::read_to_string(e.path()).unwrap_or_default();
                    if text.lines().any(|l| l.strip_prefix("StartupWMClass=").is_some_and(|v| v.trim().eq_ignore_ascii_case(class))) {
                        by_wmclass = Some(e.path());
                    }
                }
            }
        }
        by_wmclass
    }

    pub fn app_icon_source(w: &Window) -> Option<PathBuf> {
        static CACHE: Mutex<Option<HashMap<String, Option<PathBuf>>>> = Mutex::new(None);
        if w.bundle_or_class.is_empty() {
            return None;
        }
        let mut cache = CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        cache.get_or_insert_with(HashMap::new).entry(w.bundle_or_class.clone()).or_insert_with(|| desktop_for_class(&w.bundle_or_class)).clone()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;

    fn unsupported<T>() -> Result<T> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn backend() -> &'static str {
        "none"
    }
    pub fn list() -> Result<Vec<Window>> {
        unsupported()
    }
    pub fn focus(_: &str) -> Result<()> {
        unsupported()
    }
    pub fn activate(_: &str) -> Result<String> {
        unsupported()
    }
    pub fn close(_: &str) -> Result<()> {
        unsupported()
    }
    pub fn minimize(_: &str) -> Result<()> {
        unsupported()
    }
    pub fn frame(_: &str) -> Result<Rect> {
        unsupported()
    }
    pub fn set_frame(_: &str, _: Rect) -> Result<()> {
        unsupported()
    }
    pub fn displays() -> Result<Vec<Display>> {
        unsupported()
    }
    pub fn focused() -> Result<Option<Window>> {
        unsupported()
    }
    pub fn app_icon_source(_: &Window) -> Option<PathBuf> {
        None
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::platform::*;
    use super::Rect;

    const CLIENTS: &str = include_str!("../fixtures/hyprctl-clients.json");
    const MONITORS: &str = include_str!("../fixtures/hyprctl-monitors.json");
    const TREE: &str = include_str!("../fixtures/swaymsg-tree.json");
    const WMCTRL: &str = include_str!("../fixtures/wmctrl-lpx.txt");

    #[test]
    fn hyprland_rows_by_focus_order_with_monitor_and_minimised() {
        let w = parse_hyprland(CLIENTS, MONITORS);
        assert_eq!(w.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), ["0x5555f04c7b30", "0x5555f0ea8e70", "0x5555f0aa0000"], "focusHistoryID order, the unmapped one dropped");
        let chromium = &w[0];
        assert_eq!((chromium.app.as_str(), chromium.title.as_str(), chromium.pid), ("chromium", "Migros - Chromium", 1693751));
        assert_eq!((chromium.on_screen, chromium.minimized), (true, false));
        assert_eq!(chromium.monitor.as_deref(), Some("HDMI-A-1"));
        assert_eq!(chromium.workspace.as_deref(), Some("3"));
        let kitty = &w[2];
        assert!(kitty.minimized && !kitty.on_screen);
        assert_eq!(kitty.monitor.as_deref(), Some("DP-2"));
        assert_eq!(kitty.workspace.as_deref(), Some("special:minimized"));
    }

    #[test]
    fn hyprland_single_monitor_has_no_monitor_column() {
        let one = MONITORS.replacen("},{", "}]", 1);
        let one = &one[..one.find("}]").unwrap() + 2];
        assert!(parse_hyprland(CLIENTS, one).iter().all(|w| w.monitor.is_none()));
    }

    #[test]
    fn sway_walks_outputs_workspaces_and_scratchpad() {
        let w = parse_sway(TREE);
        assert_eq!(w.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), ["21", "5", "7", "9"]);
        let scratch = &w[0];
        assert_eq!((scratch.app.as_str(), scratch.title.as_str(), scratch.minimized, scratch.on_screen), ("kitty", "scratch term", true, false));
        assert_eq!((scratch.monitor.as_deref(), scratch.workspace.as_deref()), (None, None));
        let foot = &w[1];
        assert_eq!((foot.app.as_str(), foot.title.as_str(), foot.pid, foot.on_screen), ("foot", "nvim ~/notes.md", 1200, true));
        assert_eq!((foot.workspace.as_deref(), foot.monitor.as_deref()), (Some("1"), None), "one real output: no monitor");
        let steam = &w[3];
        assert_eq!(steam.bundle_or_class, "steam", "XWayland class from window_properties");
        assert_eq!(steam.workspace.as_deref(), Some("2"));
    }

    #[test]
    fn wmctrl_columns_and_the_desktop_row() {
        let w = parse_wmctrl(WMCTRL);
        assert_eq!(w.len(), 3, "the N/A desktop row is skipped");
        assert_eq!((w[0].id.as_str(), w[0].pid, w[0].app.as_str(), w[0].title.as_str()), ("0x03400003", 12345, "kitty", "~/proj/pal"));
        assert_eq!((w[1].bundle_or_class.as_str(), w[1].title.as_str()), ("firefox", "GitHub - zcag/pal - Mozilla Firefox"));
        assert_eq!(w[2].workspace.as_deref(), Some("1"));
        assert_eq!((w[2].app.as_str(), w[2].title.as_str()), ("Code", "windows.rs - pal - Visual Studio Code"));
    }

    #[test]
    fn hyprland_monitors_scale_rotation_and_reserved() {
        let d = parse_hyprland_monitors(MONITORS);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].id.as_str(), d[0].primary), ("HDMI-A-1", true));
        assert_eq!(d[0].frame, Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 });
        assert_eq!(d[0].visible_frame, d[0].frame, "no reserved: the whole screen");
        assert_eq!((d[1].id.as_str(), d[1].primary), ("DP-2", false));
        let scaled = r#"[{"name":"DP-1","width":3840,"height":2160,"x":0,"y":0,"scale":2.0,"transform":1,"reserved":[0,30,0,0]}]"#;
        let d = parse_hyprland_monitors(scaled);
        assert_eq!(d[0].frame, Rect { x: 0.0, y: 0.0, w: 1080.0, h: 1920.0 }, "logical size, rotated");
        assert_eq!(d[0].visible_frame, Rect { x: 0.0, y: 30.0, w: 1080.0, h: 1890.0 }, "a 30 px bar at the top");
    }

    #[test]
    fn sway_outputs_take_the_workspace_rect_as_visible() {
        let outputs = r#"[{"name":"DP-1","active":true,"rect":{"x":0,"y":0,"width":2560,"height":1440}},{"name":"HDMI-A-1","active":true,"rect":{"x":2560,"y":0,"width":1920,"height":1080}},{"name":"eDP-1","active":false,"rect":{"x":0,"y":0,"width":0,"height":0}}]"#;
        let workspaces = r#"[{"num":1,"output":"DP-1","rect":{"x":0,"y":24,"width":2560,"height":1416}},{"num":2,"output":"HDMI-A-1","rect":{"x":2560,"y":24,"width":1920,"height":1056}}]"#;
        let d = parse_sway_outputs(outputs, workspaces);
        assert_eq!(d.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["DP-1", "HDMI-A-1"], "the inactive output is dropped");
        assert_eq!(d[0].visible_frame, Rect { x: 0.0, y: 24.0, w: 2560.0, h: 1416.0 });
        assert_eq!(d[1].frame, Rect { x: 2560.0, y: 0.0, w: 1920.0, h: 1080.0 });
        assert!(d[0].primary && !d[1].primary);
    }

    #[test]
    fn hyprland_workspaces_by_id_with_the_active_ones_current_and_the_special_ones_dropped() {
        let text = r#"[{"id":3,"name":"3","monitor":"DP-1","windows":1},{"id":1,"name":"1","monitor":"DP-1","windows":2},{"id":-98,"name":"special:minimized","monitor":"DP-1","windows":1},{"id":2,"name":"web","monitor":"HDMI-A-1","windows":1}]"#;
        let s = parse_hyprland_workspaces(text, &["1".to_string(), "web".to_string()]);
        assert_eq!(s.iter().map(|s| (s.id.as_str(), s.index, s.name.as_deref().unwrap(), s.current, s.monitor.as_deref().unwrap())).collect::<Vec<_>>(), [("1", 1, "1", true, "DP-1"), ("2", 2, "web", true, "HDMI-A-1"), ("3", 3, "3", false, "DP-1")]);
    }

    #[test]
    fn sway_workspaces_carry_name_number_visibility_and_output() {
        let text = r#"[{"num":1,"name":"1","visible":true,"focused":true,"output":"DP-1"},{"num":2,"name":"2:mail","visible":false,"focused":false,"output":"DP-1"},{"num":10,"name":"10","visible":true,"focused":false,"output":"HDMI-A-1"}]"#;
        let s = parse_sway_workspaces(text);
        assert_eq!(s.iter().map(|s| (s.id.as_str(), s.index, s.current)).collect::<Vec<_>>(), [("1", 1, true), ("2:mail", 2, false), ("10", 10, true)]);
        assert_eq!(s[1].name.as_deref(), Some("2:mail"));
    }

    #[test]
    fn wmctrl_desktops_are_numbered_from_zero_with_the_star_on_the_current_one() {
        let text = "0  - DG: 3840x1080  VP: 0,0  WA: 0,25 3840x1055  Workspace 1\n1  * DG: 3840x1080  VP: 0,0  WA: 0,25 3840x1055  Workspace 2\n2  - DG: 3840x1080  VP: N/A  WA: 0,25 3840x1055  Workspace 3\n";
        let s = parse_wmctrl_desktops(text);
        assert_eq!(s.iter().map(|s| (s.id.as_str(), s.index, s.current)).collect::<Vec<_>>(), [("0", 1, false), ("1", 2, true), ("2", 3, false)]);
        assert!(s.iter().all(|s| s.name.is_none() && s.monitor.is_none()));
    }

    #[test]
    fn x11_monitors_cut_to_the_work_area_and_fall_back_to_the_desktop() {
        let xrandr = "Monitors: 2
 0: +*DP-1 2560/597x1440/336+0+0  DP-1
 1: +HDMI-1 1920/527x1080/296+2560+0  HDMI-1
";
        let wmctrl_d = "0  * DG: 4480x1440  VP: 0,0  WA: 0,25 4480x1415  Workspace 1
1  - DG: 4480x1440  VP: N/A  WA: 0,25 4480x1415  Workspace 2
";
        let d = parse_x11_monitors(xrandr, wmctrl_d);
        assert_eq!(d.len(), 2);
        assert_eq!((d[0].id.as_str(), d[0].primary), ("DP-1", true));
        assert_eq!(d[0].frame, Rect { x: 0.0, y: 0.0, w: 2560.0, h: 1440.0 });
        assert_eq!(d[0].visible_frame, Rect { x: 0.0, y: 25.0, w: 2560.0, h: 1415.0 }, "the panel's 25 px come off");
        assert_eq!(d[1].visible_frame, Rect { x: 2560.0, y: 25.0, w: 1920.0, h: 1055.0 });
        let d = parse_x11_monitors("", wmctrl_d);
        assert_eq!(d.len(), 1, "no xrandr: the desktop is the display");
        assert_eq!((d[0].frame.h, d[0].visible_frame.h), (1440.0, 1415.0), "still cut to the work area");
    }

    #[test]
    fn wmctrl_geometry_and_the_active_window() {
        let g = parse_wmctrl_geometry("0x03400003  0 10   50   800  600  marko ~/proj/pal
0x04000007 -1 0 0 1920 1080 marko Desktop
");
        assert_eq!(g[0], ("0x03400003".into(), Rect { x: 10.0, y: 50.0, w: 800.0, h: 600.0 }));
        assert_eq!(g[1].0, "0x04000007");
        assert_eq!(parse_active_window("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3400003
").as_deref(), Some("0x03400003"));
        assert_eq!(parse_active_window("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0
"), None, "no focus");
        assert_eq!(parse_active_window("garbage"), None);
    }
}
