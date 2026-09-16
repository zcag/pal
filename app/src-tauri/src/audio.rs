//! The audio capability: `pal_core::audio` over the bridge
//! (`audio.devices` / `set_default` / `set_volume` / `set_mute`). Nothing
//! here hides the panel: switching an output is something you do and
//! keep looking at the list.

use pal_core::audio::{self, Kind};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

#[derive(Deserialize)]
struct Params {
    id: String,
    kind: Kind,
    #[serde(default)]
    volume: Option<u8>,
    /// Absent toggles.
    #[serde(default)]
    muted: Option<bool>,
}

pub fn call(_app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    if func == "devices" {
        return Ok(serde_json::to_value(audio::devices().map_err(|e| e.to_string())?).unwrap());
    }
    let p: Params = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
    let r = match func {
        "set_default" => audio::set_default(&p.id, p.kind).map(|_| Value::Null),
        "set_volume" => audio::set_volume(&p.id, p.kind, p.volume.ok_or("audio.set_volume: no volume")?).map(|_| Value::Null),
        "set_mute" => audio::set_mute(&p.id, p.kind, p.muted).map(Value::Bool),
        _ => return Err(format!("unknown audio.{func}")),
    };
    r.map_err(|e| e.to_string())
}
