//! The media capability: `pal_core::media` over the bridge
//! (`media.now_playing` / `control`). Controls run without hiding the
//! panel, so a palette can skip a track and stay up. [`install`] tells the
//! core where the bundled MediaRemote adapter is (macOS).

use pal_core::media::{self, Command};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

/// Points `pal_core::media` at the MediaRemote adapter: the bundle's
/// `Resources/mediaremote` (tauri.macos.conf.json ships it) when the app
/// runs from a bundle, else `app/src-tauri/mediaremote` in the repo, where
/// `scripts/fetch-mediaremote.sh` (run by build.rs) put it. Without either
/// the core falls back to `nowplaying-cli`, which is logged. Nothing to do
/// off macOS.
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let staged = app.path().resource_dir().ok().map(|d| d.join("mediaremote")).filter(|d| d.join("mediaremote-adapter.pl").is_file());
        let dir = staged.unwrap_or_else(|| std::path::PathBuf::from(crate::host::REPO).join("app/src-tauri/mediaremote"));
        if !media::configure(&dir) {
            eprintln!("media\tno MediaRemote adapter at {}: system-wide Now Playing needs nowplaying-cli", dir.display());
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

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
