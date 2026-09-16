//! The media capability: `pal_core::media` over the bridge
//! (`media.now_playing` / `control`). Controls run without hiding the
//! panel, so a palette can skip a track and stay up.

use pal_core::media::{self, Command};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Deserialize)]
struct Params {
    player: String,
    command: Command,
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "now_playing" => Ok(serde_json::to_value(media::now_playing().map_err(|e| e.to_string())?).unwrap()),
        "control" => {
            let p: Params = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
            media::control(&p.player, p.command).map(|_| Value::Null).map_err(|e| e.to_string())
        }
        _ => Err(format!("unknown media.{func}")),
    }
}
