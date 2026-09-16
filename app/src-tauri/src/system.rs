//! The system capability: `pal_core::system` over the bridge.
//! `system.commands` is the catalogue with availability; `system.run` hides
//! the panel first, since every one of these wants pal out of the way (the
//! desktop shown, the screen locked, the machine asleep), then runs.

use pal_core::system;
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::panel;

#[derive(Deserialize)]
struct IdParams {
    id: String,
}

pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "commands" => Ok(serde_json::to_value(system::commands()).unwrap()),
        "run" => {
            let p: IdParams = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
            let handle = app.clone();
            app.run_on_main_thread(move || panel::hide(&handle)).map_err(|e| e.to_string())?;
            system::run(&p.id).map_err(|e| e.to_string()).map(|_| Value::Null)
        }
        _ => Err(format!("unknown system.{func}")),
    }
}
