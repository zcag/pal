//! The windows capability: `pal_core::windows` over the bridge
//! (`windows.list` / `close` / `minimize`) and as the `focus` effect
//! (effects.rs), which hides the panel before raising the window. Each
//! listed row carries `icon`, the `.app` / `.desktop` path the webview
//! renders through `icon://app`.

use pal_core::windows;
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Deserialize)]
struct IdParams {
    id: String,
}

fn err(e: windows::Error) -> String {
    e.to_string()
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "list" => {
            let rows = windows::list().map_err(err)?;
            let rows: Vec<Value> = rows
                .iter()
                .map(|w| {
                    let mut v = serde_json::to_value(w).unwrap();
                    v["icon"] = windows::app_icon_source(w).map_or(Value::Null, |p| Value::String(p.to_string_lossy().into_owned()));
                    v
                })
                .collect();
            Ok(Value::Array(rows))
        }
        "close" | "minimize" => {
            let p: IdParams = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
            let r = if func == "close" { windows::close(&p.id) } else { windows::minimize(&p.id) };
            r.map_err(err).map(|_| Value::Null)
        }
        _ => Err(format!("unknown windows.{func}")),
    }
}
