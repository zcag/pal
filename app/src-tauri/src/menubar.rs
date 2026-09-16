//! The menu bar capability: `pal_core::menubar` over the bridge.
//! `menubar.items` lists the front app's menu items (the panel is a
//! non-activating window, so the app in front is the one behind it);
//! `menubar.press { pid, id }` hides the panel first, the way `system.run`
//! does, waits for the orderOut to hand key focus back so an item that
//! opens a sheet or wants a first responder lands in the app, then presses
//! the item through Accessibility. Without Accessibility both refuse with
//! the core's reason and the extension shows the ask.

use pal_core::menubar;
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

use crate::panel;

/// Same wait as the effects' `HIDE_SETTLE`: a few frames for the orderOut
/// to reach the window server and the app in front to be key again.
const HIDE_SETTLE: Duration = Duration::from_millis(80);

#[derive(Deserialize)]
struct PressParams {
    pid: i32,
    id: String,
}

pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "items" => Ok(serde_json::to_value(menubar::items().map_err(|e| e.to_string())?).unwrap()),
        "press" => {
            let p: PressParams = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
            let handle = app.clone();
            app.run_on_main_thread(move || panel::hide(&handle)).map_err(|e| e.to_string())?;
            std::thread::sleep(HIDE_SETTLE);
            menubar::press(p.pid, &p.id).map_err(|e| e.to_string()).map(|_| Value::Null)
        }
        _ => Err(format!("unknown menubar.{func}")),
    }
}
