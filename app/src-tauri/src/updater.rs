//! Update check against the release manifest (`plugins.updater.endpoints`
//! in tauri.conf.json: `latest.json` on the latest GitHub release, written
//! by `.github/workflows/release.yml`). Runs once after startup and then
//! daily while `general.check_updates` is on; `check_updates` is the same
//! check on demand, for the tray's "Check for updates…" and the About
//! page; the Overview's runs through `settings::settings_check_updates`,
//! which reads the remembered result first. Nothing is downloaded or
//! installed yet: a found update is a log line and the command's reply.
//! Skipped in debug builds, which have nothing to update to.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::settings;

/// A short wait after startup so the check never competes with the first
/// paint and the host spawn.
const FIRST: Duration = Duration::from_secs(20);
const DAILY: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    /// The newer version, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The release notes from the manifest, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Why there is nothing to compare against, when that is the answer
    /// rather than "up to date": no release carries a manifest yet, or
    /// none for this platform. A fact for the page, not an error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

impl UpdateInfo {
    fn none(status: Option<&str>) -> Self {
        Self { available: false, version: None, notes: None, status: status.map(str::to_string) }
    }
}

async fn fetch(app: &AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::Error;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(u)) => Ok(UpdateInfo { available: true, version: Some(u.version), notes: u.body, status: None }),
        Ok(None) => Ok(UpdateInfo::none(None)),
        // `latest.json` is not on the latest release (a release without updater artifacts, or none yet): quiet.
        Err(Error::ReleaseNotFound) => Ok(UpdateInfo::none(Some("no release published yet"))),
        Err(Error::TargetNotFound(_) | Error::TargetsNotFound(_)) => Ok(UpdateInfo::none(Some("no release for this platform yet"))),
        Err(e) => Err(e.to_string()),
    }
}

/// One check against the manifest: a newer release than the running
/// version, or none. Network and signature errors come back as the
/// message. Logged, and remembered for the Overview (`settings::Checks`).
pub async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    let info = fetch(app).await;
    match &info {
        Ok(UpdateInfo { available: true, version, .. }) => eprintln!("updater\tavailable\t{}", version.as_deref().unwrap_or("?")),
        Ok(UpdateInfo { status: Some(s), .. }) => eprintln!("updater\t{s}"),
        Ok(_) => eprintln!("updater\tup to date"),
        Err(e) => eprintln!("updater\terror\t{e}"),
    }
    settings::remember_app_check(app, &info);
    info
}

/// `{ available, version?, notes? }` for the page and the tray.
#[tauri::command]
pub async fn check_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    check(&app).await
}

/// The periodic check; asks `settings::checks_due` on every tick (the
/// setting, and whether a check ran within the day already: the Overview
/// or the About page may have), so a config change takes effect at the
/// next one without a restart.
pub fn install(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST).await;
        loop {
            if settings::checks_due(&app, false).0 {
                let _ = check(&app).await;
            }
            tokio::time::sleep(DAILY).await;
        }
    });
}
