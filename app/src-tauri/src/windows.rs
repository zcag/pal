//! The windows capability: `pal_core::windows` over the bridge
//! (`windows.list` / `close` / `minimize` / `frame` / `set_frame` /
//! `displays` / `focused` / `layout`) and as the `focus` and `layout`
//! effects (effects.rs), which hide the panel before touching the window.
//! Each listed row carries `icon`, the `.app` / `.desktop` path the webview
//! renders through `icon://app`.

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

/// `{ name, id?, gap?, almost_maximize_percent?, reasonable_size_percent? }`:
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

/// Run a named layout; the core's `Applied` on success.
pub fn apply_layout(p: &LayoutParams) -> Result<windows::Applied, String> {
    let l = layout::Layout::parse(&p.name).ok_or_else(|| format!("no layout {:?}", p.name))?;
    windows::apply(p.id.as_deref(), l, &p.opts).map_err(err)
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "list" => Ok(Value::Array(windows::list().map_err(err)?.iter().map(row).collect())),
        "close" | "minimize" => {
            let p: IdParams = parse(params)?;
            let r = if func == "close" { windows::close(&p.id) } else { windows::minimize(&p.id) };
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
