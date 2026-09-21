//! The windows capability: `pal_core::windows` over the bridge
//! (`windows.list` / `activate` / `close` / `minimize` / `unminimize` /
//! `fullscreen` / `frame` / `set_frame` / `displays` / `focused` /
//! `layout`) and as the `focus` and `layout` effects (effects.rs), which
//! hide the panel before touching the window.
//! Each listed row carries `icon`, the `.app` / `.desktop` path the webview
//! renders through `icon://app`. [`stamp_focused`] feeds the core's focus
//! history, which orders the macOS list most recently used first.

use pal_core::windows::{self, layout, Rect};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

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
    std::thread::spawn(|| {
        if let Ok(Some(w)) = windows::focused() {
            windows::note_focus(&w.id);
        }
    });
}

/// Run a named layout; the core's `Applied` on success.
pub fn apply_layout(p: &LayoutParams) -> Result<windows::Applied, String> {
    let l = layout::Layout::parse(&p.name).ok_or_else(|| format!("no layout {:?}", p.name))?;
    windows::apply(p.id.as_deref(), l, &p.opts).map_err(err)
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "list" => Ok(Value::Array(windows::list().map_err(err)?.iter().map(row).collect())),
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
        _ => Err(format!("unknown windows.{func}")),
    }
}
