//! Updates: the check against the release manifest (`plugins.updater.endpoints`
//! in tauri.conf.json: `latest.json` on the latest GitHub release, written
//! by `.github/workflows/release.yml`), and the install.
//!
//! The check runs once after startup and then daily while
//! `general.check_updates` is on; `check_updates` is the same check on
//! demand, for the tray's "Check for updates…", the About page and the
//! "Check for Updates" row; the Overview's runs through
//! `settings::settings_check_updates`, which reads the remembered result
//! first. A found update is kept (`Found`) so an install needs no second
//! round trip.
//!
//! The install (`install`, `update_install`) is `tauri-plugin-updater`'s
//! `download_and_install`: the signed bundle is downloaded with the
//! progress on the HUD and on [`events::UPDATE`] (the About row draws it),
//! verified against the public key, put in place (the `.app` on macOS,
//! the AppImage on Linux), then pal relaunches itself through
//! `commands::restart`. Whether this build can be installed over is
//! `support()`: a debug build cannot (nothing to update to), a Linux deb
//! or rpm cannot (the manifest carries the AppImage only; the package
//! manager updates those), a bare binary on Linux cannot (it is not what
//! the manifest ships). Nothing installs by itself: `check_updates` only
//! gates the automatic check, an install is always the user's click.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{commands, events, hud, lock, settings};

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
    /// With `available`: whether "Install update" can do it here, and why
    /// not when it cannot (`support`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_note: Option<String>,
}

impl UpdateInfo {
    fn none(status: Option<&str>) -> Self {
        Self { available: false, version: None, notes: None, status: status.map(str::to_string), installable: None, install_note: None }
    }

    fn available(version: String, notes: Option<String>) -> Self {
        let (installable, install_note) = match support() {
            Ok(()) => (true, None),
            Err(why) => (false, Some(why)),
        };
        Self { available: true, version: Some(version), notes, status: None, installable: Some(installable), install_note: Some(install_note).flatten() }
    }
}

/// The update the last check found, for `install`.
#[derive(Default)]
pub struct Found(Mutex<Option<Update>>);

/// Where an install is: the phases in order, `failed` with the reason.
/// Emitted on [`events::UPDATE`] as it moves.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum Progress {
    Idle,
    Downloading {
        version: String,
        downloaded: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        total: Option<u64>,
    },
    Installing { version: String },
    Restarting { version: String },
    Failed { version: String, error: String },
}

impl Progress {
    /// The HUD line for this step; the download says its percentage when
    /// the size is known, else the megabytes so far.
    pub fn hud_line(&self) -> Option<String> {
        match self {
            Progress::Idle => None,
            Progress::Downloading { version, downloaded, total: Some(total) } if *total > 0 => Some(format!("Downloading pal {version}: {}%", downloaded * 100 / total)),
            Progress::Downloading { version, downloaded, .. } => Some(format!("Downloading pal {version}: {:.1} MB", *downloaded as f64 / 1e6)),
            Progress::Installing { version } => Some(format!("Installing pal {version}")),
            Progress::Restarting { version } => Some(format!("pal {version} installed, restarting")),
            Progress::Failed { error, .. } => Some(format!("Update failed: {error}")),
        }
    }

    /// Whether a HUD line is due for this step after `last` (the previous
    /// line's step): every phase change, and the download at every ten
    /// percent (or every 5 MB without a total), so the HUD's clock is not
    /// restarted per chunk.
    pub fn hud_due(&self, last: Option<&Progress>) -> bool {
        match (self, last) {
            (Progress::Downloading { downloaded, total: Some(t), .. }, Some(Progress::Downloading { downloaded: prev, total: Some(_), .. })) if *t > 0 => downloaded * 10 / t != prev * 10 / t,
            (Progress::Downloading { downloaded, total: None, .. }, Some(Progress::Downloading { downloaded: prev, total: None, .. })) => downloaded / 5_000_000 != prev / 5_000_000,
            (a, Some(b)) => std::mem::discriminant(a) != std::mem::discriminant(b),
            (_, None) => true,
        }
    }
}

/// The install state, for the page's re-read and `update_install`'s refusal of a second run.
pub struct Installing(Mutex<Progress>);

impl Default for Installing {
    fn default() -> Self {
        Self(Mutex::new(Progress::Idle))
    }
}

/// Whether this build can be replaced by the plugin: the platform facts
/// (`support_for`) as this process sees them.
pub fn support() -> Result<(), String> {
    support_for(cfg!(debug_assertions), cfg!(target_os = "linux"), tauri::utils::platform::bundle_type(), std::env::var_os("APPIMAGE").is_some())
}

/// `support`, pure: a debug build has nothing to update to; on Linux a deb
/// or rpm is the package manager's (the manifest ships the AppImage, and
/// the plugin refuses to install one over a package), and a binary that is
/// no AppImage is not what the manifest ships; macOS replaces the `.app`.
pub fn support_for(debug: bool, linux: bool, bundle: Option<tauri::utils::config::BundleType>, appimage: bool) -> Result<(), String> {
    use tauri::utils::config::BundleType;
    if debug {
        return Err("a development build: nothing to update to".into());
    }
    if linux {
        match bundle {
            Some(BundleType::Deb) => return Err("installed from the .deb: download the new package from the releases page and install it with dpkg".into()),
            Some(BundleType::Rpm) => return Err("installed from the .rpm: download the new package from the releases page and install it with rpm".into()),
            _ if !appimage => return Err("not running from an AppImage: replace the binary by hand".into()),
            _ => {}
        }
    }
    Ok(())
}

async fn fetch(app: &AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::Error;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(u)) => {
            let info = UpdateInfo::available(u.version.clone(), u.body.clone());
            *lock(&app.state::<Found>().0) = Some(u);
            Ok(info)
        }
        Ok(None) => {
            *lock(&app.state::<Found>().0) = None;
            Ok(UpdateInfo::none(None))
        }
        // `latest.json` is not on the latest release (a release without updater artifacts, or none yet): quiet.
        Err(Error::ReleaseNotFound) => Ok(UpdateInfo::none(Some("no release published yet"))),
        Err(Error::TargetNotFound(_) | Error::TargetsNotFound(_)) => Ok(UpdateInfo::none(Some("no release for this platform yet"))),
        Err(e) => Err(e.to_string()),
    }
}

/// One check against the manifest: a newer release than the running
/// version, or none. Network and signature errors come back as the
/// message. Logged, remembered for the Overview (`settings::Checks`), and
/// the "Install Update" row follows it (`commands::sync_update_row`).
pub async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    let info = fetch(app).await;
    match &info {
        Ok(UpdateInfo { available: true, version, installable, .. }) => eprintln!("updater\tavailable\t{}\t{}", version.as_deref().unwrap_or("?"), if *installable == Some(true) { "installable" } else { "not installable here" }),
        Ok(UpdateInfo { status: Some(s), .. }) => eprintln!("updater\t{s}"),
        Ok(_) => eprintln!("updater\tup to date"),
        Err(e) => eprintln!("updater\terror\t{e}"),
    }
    settings::remember_app_check(app, &info);
    commands::sync_update_row(app, info.as_ref().ok().filter(|i| i.available));
    info
}

/// `{ available, version?, notes?, installable?, install_note? }` for the page and the tray.
#[tauri::command]
pub async fn check_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    check(&app).await
}

/// The install state now (`Progress`), for a page that opened mid-way.
#[tauri::command]
pub fn update_progress(app: AppHandle) -> Progress {
    lock(&app.state::<Installing>().0).clone()
}

/// "Install update": download, verify, put in place, relaunch. Answers
/// once the download starts; the rest is on [`events::UPDATE`] and the
/// HUD. Refused while one is running, and when the last check found none
/// (a check runs first then).
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    install(&app).await
}

fn set_progress(app: &AppHandle, p: Progress) {
    {
        let st = app.state::<Installing>();
        let mut cur = lock(&st.0);
        if p.hud_due(Some(&cur)) {
            if let Some(line) = p.hud_line() {
                hud::show(app, &line);
            }
        }
        *cur = p.clone();
    }
    events::emit(app, events::UPDATE, &p);
}

pub async fn install(app: &AppHandle) -> Result<(), String> {
    support()?;
    if !matches!(*lock(&app.state::<Installing>().0), Progress::Idle | Progress::Failed { .. }) {
        return Err("an update is already being installed".into());
    }
    let found = lock(&app.state::<Found>().0).clone();
    let update = match found {
        Some(u) => u,
        None => {
            check(app).await?;
            lock(&app.state::<Found>().0).clone().ok_or("pal is up to date")?
        }
    };
    let version = update.version.clone();
    eprintln!("updater\tinstall\t{version}\t{}", update.download_url);
    set_progress(app, Progress::Downloading { version: version.clone(), downloaded: 0, total: None });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let (mut downloaded, v) = (0u64, version.clone());
        let h = handle.clone();
        let r = update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    set_progress(&h, Progress::Downloading { version: v.clone(), downloaded, total });
                },
                {
                    let (h, v) = (handle.clone(), version.clone());
                    move || set_progress(&h, Progress::Installing { version: v })
                },
            )
            .await;
        match r {
            Ok(()) => {
                eprintln!("updater\tinstalled\t{version}");
                set_progress(&handle, Progress::Restarting { version: version.clone() });
                // The HUD's hold, so the last line is seen before the window goes.
                tokio::time::sleep(Duration::from_millis(1200)).await;
                if let Err(e) = commands::restart(&handle) {
                    eprintln!("updater\trestart failed\t{e}");
                    set_progress(&handle, Progress::Failed { version, error: format!("installed, but could not relaunch: {e}. Quit and open pal again") });
                }
            }
            Err(e) => {
                eprintln!("updater\tinstall failed\t{e}");
                set_progress(&handle, Progress::Failed { version, error: e.to_string() });
            }
        }
    });
    Ok(())
}

/// The periodic check; asks `settings::checks_due` on every tick (the
/// setting, and whether a check ran within the day already: the Overview
/// or the About page may have), so a config change takes effect at the
/// next one without a restart. The states live here too (`Found`, `Installing`).
pub fn install_checks(app: &AppHandle) {
    app.manage(Found::default());
    app.manage(Installing::default());
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri::utils::config::BundleType;

    #[test]
    fn support_is_release_builds_of_the_app_and_the_appimage() {
        assert_eq!(support_for(false, false, Some(BundleType::App), false), Ok(()), "macOS .app");
        assert_eq!(support_for(false, true, Some(BundleType::AppImage), true), Ok(()));
        assert_eq!(support_for(false, true, None, true), Ok(()), "an AppImage the binary patch missed: APPIMAGE is set");
        assert!(support_for(true, false, Some(BundleType::App), false).unwrap_err().contains("development build"));
        assert!(support_for(false, true, Some(BundleType::Deb), false).unwrap_err().contains(".deb"));
        assert!(support_for(false, true, Some(BundleType::Rpm), false).unwrap_err().contains(".rpm"));
        assert!(support_for(false, true, None, false).unwrap_err().contains("not running from an AppImage"));
    }

    #[test]
    fn update_info_says_whether_it_can_be_installed() {
        let v = serde_json::to_value(UpdateInfo::none(Some("no release published yet"))).unwrap();
        assert_eq!(v, json!({ "available": false, "status": "no release published yet" }), "nothing about installing when there is nothing");
        let info = UpdateInfo::available("0.2.0".into(), Some("notes".into()));
        assert!(info.available && info.version.as_deref() == Some("0.2.0"));
        // In a test binary (debug, no bundle) the answer is "not installable", with the reason.
        assert_eq!(info.installable, Some(cfg!(not(debug_assertions)) && !cfg!(target_os = "linux")));
        if info.installable == Some(false) {
            assert!(info.install_note.is_some());
        }
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["available"], true);
        assert_eq!(v["notes"], "notes");
        assert!(v.get("status").is_none());
    }

    #[test]
    fn progress_serialises_by_phase_and_paces_the_hud() {
        let v = |p: &Progress| serde_json::to_value(p).unwrap();
        assert_eq!(v(&Progress::Idle), json!({ "phase": "idle" }));
        assert_eq!(v(&Progress::Downloading { version: "0.2.0".into(), downloaded: 5, total: Some(10) }), json!({ "phase": "downloading", "version": "0.2.0", "downloaded": 5, "total": 10 }));
        assert_eq!(v(&Progress::Downloading { version: "0.2.0".into(), downloaded: 5, total: None }), json!({ "phase": "downloading", "version": "0.2.0", "downloaded": 5 }));
        assert_eq!(v(&Progress::Failed { version: "0.2.0".into(), error: "no".into() }), json!({ "phase": "failed", "version": "0.2.0", "error": "no" }));
        let d = |downloaded: u64, total: Option<u64>| Progress::Downloading { version: "0.2.0".into(), downloaded, total };
        assert_eq!(d(5_000_000, Some(20_000_000)).hud_line().as_deref(), Some("Downloading pal 0.2.0: 25%"));
        assert_eq!(d(2_500_000, None).hud_line().as_deref(), Some("Downloading pal 0.2.0: 2.5 MB"));
        assert_eq!(Progress::Installing { version: "0.2.0".into() }.hud_line().as_deref(), Some("Installing pal 0.2.0"));
        assert_eq!(Progress::Restarting { version: "0.2.0".into() }.hud_line().as_deref(), Some("pal 0.2.0 installed, restarting"));
        assert_eq!(Progress::Failed { version: "0.2.0".into(), error: "no".into() }.hud_line().as_deref(), Some("Update failed: no"));
        assert_eq!(Progress::Idle.hud_line(), None);
        // A line per phase change and per ten percent, not per chunk.
        assert!(d(0, Some(100)).hud_due(Some(&Progress::Idle)));
        assert!(!d(5, Some(100)).hud_due(Some(&d(0, Some(100)))));
        assert!(d(10, Some(100)).hud_due(Some(&d(9, Some(100)))));
        assert!(!d(19, Some(100)).hud_due(Some(&d(10, Some(100)))));
        assert!(!d(4_000_000, None).hud_due(Some(&d(0, None))));
        assert!(d(5_000_000, None).hud_due(Some(&d(4_000_000, None))));
        assert!(Progress::Installing { version: "0.2.0".into() }.hud_due(Some(&d(99, Some(100)))));
        assert!(Progress::Restarting { version: "0.2.0".into() }.hud_due(Some(&Progress::Installing { version: "0.2.0".into() })));
        assert!(!Progress::Installing { version: "0.2.0".into() }.hud_due(Some(&Progress::Installing { version: "0.2.0".into() })));
        assert!(d(0, None).hud_due(None));
    }
}
