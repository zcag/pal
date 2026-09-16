//! Update check against the release manifest (`plugins.updater.endpoints`
//! in tauri.conf.json: `latest.json` on the latest GitHub release, written
//! by `.github/workflows/release.yml`). Runs once after startup and then
//! daily while `general.check_updates` is on; `check_updates` is the same
//! check on demand, for the tray's "Check for updates…". Nothing is
//! downloaded or installed yet: a found update is a log line and the
//! command's reply. Skipped in debug builds, which have nothing to update to.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::settings;

/// A short wait after startup so the check never competes with the first
/// paint and the host spawn.
const FIRST: Duration = Duration::from_secs(20);
const DAILY: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    /// The newer version, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The release notes from the manifest, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// One check against the manifest: a newer release than the running
/// version, or none. Network and signature errors come back as the message.
pub async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(u) => Ok(UpdateInfo { available: true, version: Some(u.version), notes: u.body }),
        None => Ok(UpdateInfo { available: false, version: None, notes: None }),
    }
}

/// `{ available, version?, notes? }` for the page and the tray.
#[tauri::command]
pub async fn check_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    let info = check(&app).await;
    log(&info);
    info
}

fn log(info: &Result<UpdateInfo, String>) {
    match info {
        Ok(UpdateInfo { available: true, version, .. }) => eprintln!("updater\tavailable\t{}", version.as_deref().unwrap_or("?")),
        Ok(_) => eprintln!("updater\tup to date"),
        Err(e) => eprintln!("updater\terror\t{e}"),
    }
}

/// The periodic check; reads `general.check_updates` on every tick, so a
/// config change takes effect at the next one without a restart.
pub fn install(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST).await;
        loop {
            if settings::config(&app).general.check_updates {
                log(&check(&app).await);
            }
            tokio::time::sleep(DAILY).await;
        }
    });
}
