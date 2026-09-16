//! The OS permissions pal needs, as one place the shell asks from: today
//! only macOS Accessibility (paste sends a keystroke into the app in front,
//! window switching raises another app's window, `pal action type`). macOS
//! lists an app under Privacy & Security > Accessibility only after the app
//! has called the trust check with the prompt once, so every ask here is
//! both: the system prompt (`ax::request`, which adds pal to the list) and
//! System Settings opened on that pane, where the switch is. Off macOS the
//! permission is a given and `status` says so.
//!
//! Who asks: the panel's first show on a fresh profile (once per run,
//! `general.ask_permissions_on_start`), the Welcome row (every time), an
//! effect refused for want of it (once per run, `effects.rs`) and the
//! Settings window's Grant button. Nothing polls the OS for a change; a
//! grant is seen by [`watch`], which checks every [`POLL`] while a window is
//! open and the permission was missing, and emits [`events::PERMISSIONS`]
//! once it is there (the Welcome row goes, Settings turns the dot green).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{events, panel, settings, welcome};

const POLL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Status {
    /// May drive other apps (send keys, raise windows). Always true off macOS.
    pub accessibility: bool,
}

pub fn status() -> Status {
    Status { accessibility: pal_core::ax::trusted() }
}

pub fn install(app: &AppHandle) {
    let s = status();
    eprintln!("permissions\taccessibility\t{}", s.accessibility);
    if !s.accessibility {
        watch(app);
    }
}

/// The ask: the system prompt (adds pal to the list) and the pane with the
/// switch. Returns the state as of now, which a just-shown prompt never
/// changes; `watch` reports the grant later.
pub fn request(app: &AppHandle, which: &str) -> Result<Status, String> {
    match which {
        "accessibility" => {
            let trusted = pal_core::ax::request();
            if !trusted {
                pal_core::ax::open_settings().map_err(|e| format!("could not open System Settings: {e}"))?;
                watch(app);
            }
            eprintln!("permissions\taccessibility\trequested\ttrusted={trusted}");
            Ok(status())
        }
        other => Err(format!("unknown permission {other}")),
    }
}

/// [`request`] at most once per run across every caller that wants it
/// only in passing (an effect refused, the first show): the prompt is a
/// modal and a second one on the same run is noise.
pub fn request_once(app: &AppHandle, which: &str) {
    static ASKED: AtomicBool = AtomicBool::new(false);
    if !ASKED.swap(true, Ordering::Relaxed) {
        if let Err(e) = request(app, which) {
            eprintln!("permissions\t{which}\t{e}");
        }
    }
}

/// The panel's first show on a fresh profile (the Welcome tips still up):
/// ask, once per run, when `general.ask_permissions_on_start` says so and
/// the permission is missing. Raycast asks during its onboarding; this is
/// pal's. Spawned: the prompt is the system's window and takes key focus,
/// which hides the panel, so the show itself must not wait on it.
pub fn ask_on_first_show(app: &AppHandle) {
    if status().accessibility || !settings::config(app).general.ask_permissions_on_start || welcome::welcomed(&welcome::data_dir(app)) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || request_once(&app, "accessibility"));
}

/// Whether the user has a pal window in front of them: the panel or the
/// Settings window. The poll runs only then.
fn window_open(app: &AppHandle) -> bool {
    panel::is_visible(app) || app.get_webview_window(settings::WINDOW).is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Poll `ax::trusted` every [`POLL`] while a window is open and the
/// permission is missing; one poll at a time. Stops on the grant (after
/// telling every window and re-deriving the Welcome rows) or once no
/// window is open; `show_in`, `settings::open` and `request` start it
/// again. macOS has no notification for this and an `AXObserver` watches
/// elements, not the trust list, so polling it is.
pub fn watch(app: &AppHandle) {
    static POLLING: AtomicBool = AtomicBool::new(false);
    if !cfg!(target_os = "macos") || status().accessibility || POLLING.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            let s = status();
            if s.accessibility {
                eprintln!("permissions\taccessibility\tgranted");
                events::emit(&app, events::PERMISSIONS, s);
                welcome::sync(&app);
                break;
            }
            if !window_open(&app) {
                break;
            }
        }
        POLLING.store(false, Ordering::Relaxed);
    });
}

#[tauri::command]
pub fn permissions_status() -> Status {
    status()
}

#[tauri::command(async)]
pub fn permissions_request(app: AppHandle, which: String) -> Result<Status, String> {
    request(&app, &which)
}

/// A System Settings pane by name, for the buttons in Settings that point
/// at one: `accessibility` (Privacy & Security), `keyboard-shortcuts`
/// (where Spotlight's binding is switched off).
#[tauri::command(async)]
pub fn open_system_settings(pane: String) -> Result<(), String> {
    match pane.as_str() {
        "accessibility" => pal_core::ax::open_settings(),
        "keyboard-shortcuts" => pal_core::spotlight::open_keyboard_shortcuts(),
        other => return Err(format!("unknown pane {other}")),
    }
    .map_err(|e| format!("could not open System Settings: {e}"))
}
