//! The windows capability: `pal_core::windows` over the bridge
//! (`windows.list` / `activate` / `close` / `minimize` / `unminimize` /
//! `fullscreen` / `frame` / `set_frame` / `displays` / `focused` /
//! `layout` / `spaces` / `go_space`) and as the `focus`, `layout` and
//! `space` effects (effects.rs), which hide the panel before touching the
//! window or the desktop. [`raise`] is the focus
//! itself, shared by the effect and the switcher's tap (switcher.rs):
//! the window with Accessibility, else the app forward with a note.
//! Each listed row carries `icon`, the `.app` / `.desktop` path the webview
//! renders through `icon://app`. [`stamp_focused`] feeds the core's focus
//! history, which orders the macOS list most recently used first;
//! [`stamp_space`] its space history (the bar's Space-change observer), so
//! "the previous space" counts a swipe too.

use std::sync::atomic::{AtomicBool, Ordering};

use pal_core::windows::{self, layout, Rect};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::{hud, permissions};

#[derive(Deserialize)]
struct IdParams {
    id: String,
}

#[derive(Deserialize)]
struct FrameParams {
    id: String,
    #[serde(flatten)]
    rect: Rect,
}

/// `{ name, id?, gap?, almost_maximize_percent?, reasonable_size_percent?, step?, cycle? }`:
/// the layout effect's payload and `windows.layout`'s params, one shape.
#[derive(Deserialize)]
pub struct LayoutParams {
    pub name: String,
    /// The focused window when absent.
    pub id: Option<String>,
    #[serde(flatten)]
    pub opts: layout::Options,
}

fn err(e: windows::Error) -> String {
    e.to_string()
}

fn parse<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("bad params: {e}"))
}

/// A row as the host sees it: the window plus its icon source.
fn row(w: &windows::Window) -> Value {
    let mut v = serde_json::to_value(w).unwrap();
    v["icon"] = windows::app_icon_source(w).map_or(Value::Null, |p| Value::String(p.to_string_lossy().into_owned()));
    v
}

/// Stamp the front window into the core's focus history
/// (`windows::note_focus`): on every app activation (the bar's observer)
/// and when the panel shows, so the windows palette lists the window the
/// user came from first. On a thread of its own: `focused()` asks the
/// front app over AX, tens of ms when it naps, and neither caller (the
/// main thread, the show) may wait for that. Only macOS keeps a history;
/// Hyprland's order is its own and the other backends have none.
pub fn stamp_focused() {
    #[cfg(target_os = "macos")]
    {
        let (lock, cv) = &*STAMP;
        *lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner) += 1;
        std::thread::spawn(|| {
            if let Ok(Some(w)) = windows::focused() {
                windows::note_focus(&w.id);
            }
            *lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner) -= 1;
            cv.notify_all();
        });
    }
}

/// Stamps in flight, and the condvar a `list` waits on: the show's stamp
/// and the relist it triggers race otherwise, and the switcher's first
/// frame would have the window just left in CG order instead of first.
#[cfg(target_os = "macos")]
static STAMP: std::sync::LazyLock<(std::sync::Mutex<u32>, std::sync::Condvar)> = std::sync::LazyLock::new(Default::default);

/// Wait for a stamp in flight, briefly (an AX read of a napping app can
/// take longer; the list then goes ahead with what the history has).
pub(crate) fn await_stamp() {
    #[cfg(target_os = "macos")]
    {
        let (lock, cv) = &*STAMP;
        let pending = lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ = cv.wait_timeout_while(pending, std::time::Duration::from_millis(150), |n| *n > 0);
    }
}

/// What the HUD says after a raise: nothing with Accessibility (the
/// window coming up is the feedback), and without it, once per run, which
/// app came forward and why only the app. A toast cannot carry this: the
/// activation makes the panel resign key, which hides it (panel/macos.rs).
fn focus_feedback(trusted: bool, first: bool, app: &str) -> Option<String> {
    (!trusted && first).then(|| format!("Switched to {app}; per-window switching needs Accessibility"))
}

/// Raise window `id`: the window itself with Accessibility, else the app
/// forward (the core's `activate` can do without the permission, just not
/// pick the window), said once on the HUD and asked once. Blocking (AX
/// calls): a blocking thread, never the main one. The panel, if up, is
/// hidden by the caller first.
pub fn raise(app: &AppHandle, id: &str) -> Result<(), String> {
    static HINTED: AtomicBool = AtomicBool::new(false);
    if pal_core::ax::trusted() {
        return windows::focus(id).map_err(err);
    }
    let name = windows::activate(id).map_err(err)?;
    if let Some(text) = focus_feedback(false, !HINTED.swap(true, Ordering::Relaxed), &name) {
        hud::show(app, &text);
    }
    permissions::request_once(app, "accessibility");
    Ok(())
}

/// Stamp the space that just came in front (macOS's
/// `NSWorkspaceActiveSpaceDidChangeNotification`): `windows::note_space`
/// with the current one, off the main thread (the read is a window
/// server round trip).
pub fn stamp_space() {
    std::thread::spawn(|| {
        if let Ok(spaces) = windows::spaces() {
            if let Some(s) = spaces.iter().find(|s| s.current) {
                windows::note_space(&s.id);
            }
        }
    });
}

/// Bring a space in front; what the HUD says when it could not. The
/// panel, if up, is hidden by the caller first.
pub fn go_space(app: &AppHandle, id: &str) -> Result<(), String> {
    match windows::go_space(id) {
        Ok(()) => Ok(()),
        Err(windows::Error::NeedsAccessibility(_)) => {
            permissions::request_once(app, "accessibility");
            Err("switching to an empty space needs Accessibility".into())
        }
        Err(e) => Err(err(e)),
    }
}

/// Run a named layout; the core's `Applied` on success.
pub fn apply_layout(p: &LayoutParams) -> Result<windows::Applied, String> {
    let l = layout::Layout::parse(&p.name).ok_or_else(|| format!("no layout {:?}", p.name))?;
    windows::apply(p.id.as_deref(), l, &p.opts).map_err(err)
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "list" => {
            await_stamp();
            Ok(Value::Array(windows::list().map_err(err)?.iter().map(row).collect()))
        }
        // The app forward (unhidden), not one window: Show app. Its name.
        "activate" => {
            let p: IdParams = parse(params)?;
            windows::activate(&p.id).map_err(err).map(Value::String)
        }
        "close" | "minimize" | "unminimize" | "fullscreen" => {
            let p: IdParams = parse(params)?;
            let r = match func {
                "close" => windows::close(&p.id),
                "minimize" => windows::minimize(&p.id),
                "unminimize" => windows::unminimize(&p.id),
                _ => windows::fullscreen(&p.id),
            };
            r.map_err(err).map(|_| Value::Null)
        }
        "frame" => {
            let p: IdParams = parse(params)?;
            Ok(serde_json::to_value(windows::frame(&p.id).map_err(err)?).unwrap())
        }
        "set_frame" => {
            let p: FrameParams = parse(params)?;
            windows::set_frame(&p.id, p.rect).map_err(err).map(|_| Value::Null)
        }
        "displays" => Ok(serde_json::to_value(windows::displays().map_err(err)?).unwrap()),
        "focused" => Ok(windows::focused().map_err(err)?.as_ref().map_or(Value::Null, row)),
        "layout" => Ok(serde_json::to_value(apply_layout(&parse(params)?)?).unwrap()),
        "spaces" => Ok(serde_json::to_value(windows::spaces().map_err(err)?).unwrap()),
        // From the host directly, with the panel wherever it is: `pal run` and a pick prefer the `space` effect.
        "go_space" => {
            let p: IdParams = parse(params)?;
            go_space(_app, &p.id).map(|_| Value::Null)
        }
        _ => Err(format!("unknown windows.{func}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_feedback_names_the_app_once_and_only_without_accessibility() {
        assert_eq!(focus_feedback(true, true, "Safari"), None, "with the permission the window itself is the feedback");
        assert_eq!(focus_feedback(true, false, "Safari"), None);
        assert_eq!(focus_feedback(false, true, "Safari").as_deref(), Some("Switched to Safari; per-window switching needs Accessibility"));
        assert_eq!(focus_feedback(false, false, "Safari"), None, "the reason is said once per run");
    }
}
