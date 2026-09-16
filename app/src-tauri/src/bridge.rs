//! Core capabilities the extension host calls back into (`core.call` in
//! host/src/bridge.ts): `core/<capability>.<fn>` routes to the capability's
//! `call`. Runs on a blocking thread, never on the host's reader.

use serde_json::Value;
use tauri::AppHandle;

pub fn call(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let (capability, func) = method
        .strip_prefix("core/")
        .and_then(|m| m.split_once('.'))
        .ok_or_else(|| format!("not a core method: {method}"))?;
    match capability {
        "clipboard" => crate::clipboard::call(app, func, params),
        "settings" => crate::settings::call(app, func, params),
        _ => Err(format!("unknown capability {capability}")),
    }
}
