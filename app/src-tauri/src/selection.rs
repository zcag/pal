//! The selection capability: `pal_core::selection` over the bridge,
//! `core/selection.text` answering the frontmost app's selected text or
//! null. The Cmd+C snapshot fallback runs only when
//! `general.selection_snapshot` allows it (it touches the clipboard for a
//! moment). Without Accessibility on macOS the call is an error naming
//! the permission, and the prompt is shown once per run like paste's.

use pal_core::selection;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{permissions, settings};

pub fn call(app: &AppHandle, func: &str, _params: Value) -> Result<Value, String> {
    match func {
        "text" => {
            let snapshot = settings::config(app).general.selection_snapshot;
            match selection::text(snapshot) {
                Ok(t) => Ok(json!(t)),
                Err(selection::Error::NeedsAccessibility) => {
                    permissions::request_once(app, "accessibility");
                    Err(selection::Error::NeedsAccessibility.to_string())
                }
                Err(e) => Err(e.to_string()),
            }
        }
        _ => Err(format!("unknown selection.{func}")),
    }
}
