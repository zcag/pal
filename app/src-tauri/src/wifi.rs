//! The wifi capability: `pal_core::wifi` over the bridge (`wifi.status` /
//! `known` / `scan` / `join` / `forget` / `password` / `set_power`). `scan`
//! takes `{ mode: "cached" | "auto" | "fresh" }` since a macOS scan is
//! seconds long; `password` may put up the keychain prompt on macOS, which
//! is the user's own action from the palette.

use pal_core::wifi::{self, ScanMode};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Deserialize, Default)]
#[serde(default)]
struct Params {
    ssid: Option<String>,
    password: Option<String>,
    mode: Option<ScanMode>,
    on: Option<bool>,
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let p: Params = if params.is_null() { Params::default() } else { serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))? };
    let ssid = || p.ssid.as_deref().ok_or("wifi: no ssid");
    let r = match func {
        "status" => wifi::status().map(|s| serde_json::to_value(s).unwrap()),
        "known" => wifi::known().map(|k| serde_json::to_value(k).unwrap()),
        "scan" => wifi::scan(p.mode.unwrap_or(ScanMode::Auto)).map(|s| serde_json::to_value(s).unwrap()),
        "join" => wifi::join(ssid()?, p.password.as_deref()).map(|_| Value::Null),
        "forget" => wifi::forget(ssid()?).map(|_| Value::Null),
        "password" => wifi::password(ssid()?).map(Value::String),
        "set_power" => wifi::set_power(p.on.ok_or("wifi.set_power: no on")?).map(|_| Value::Null),
        _ => return Err(format!("unknown wifi.{func}")),
    };
    r.map_err(|e| e.to_string())
}
