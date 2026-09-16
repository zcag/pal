//! The bluetooth capability: `pal_core::bluetooth` over the bridge
//! (`bluetooth.devices` / `connect` / `disconnect`). A connect can take
//! seconds (the radio pages the device); it runs on the bridge's blocking
//! thread like every other call.

use pal_core::bluetooth;
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Deserialize)]
struct Params {
    address: String,
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    if func == "devices" {
        return Ok(serde_json::to_value(bluetooth::devices().map_err(|e| e.to_string())?).unwrap());
    }
    let p: Params = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
    match func {
        "connect" => bluetooth::connect(&p.address),
        "disconnect" => bluetooth::disconnect(&p.address),
        _ => return Err(format!("unknown bluetooth.{func}")),
    }
    .map(|_| Value::Null)
    .map_err(|e| e.to_string())
}
