//! The privacy capability: `pal_core::privacy` over the bridge
//! (`privacy.in_use`). The first call starts the core's watcher, so a
//! machine where nothing asks never polls; from then on every change is
//! the `privacy` trigger, and an item with `privacy` in its `refresh.on`
//! re-renders the moment a camera or a microphone turns on or off.

use pal_core::privacy;
use serde_json::Value;
use std::sync::Once;
use tauri::AppHandle;

static WATCH: Once = Once::new();

pub fn call(app: &AppHandle, func: &str, _params: Value) -> Result<Value, String> {
    match func {
        "in_use" => {
            let handle = app.clone();
            WATCH.call_once(|| privacy::on_change(move || crate::bar::trigger(&handle, "privacy")));
            Ok(serde_json::to_value(privacy::in_use().map_err(|e| e.to_string())?).unwrap())
        }
        _ => Err(format!("unknown privacy.{func}")),
    }
}
