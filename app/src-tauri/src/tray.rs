//! The menu bar (macOS) / system tray (Linux) icon: the one visible handle
//! on an app with no Dock icon. Its menu opens the panel and the settings
//! window, restarts the extension host, and quits. `general.menu_bar_icon`
//! turns it off; `apply` follows the config live (create, remove, or
//! rebuild the menu when the hotkey shown next to "Open pal" changes).
//!
//! The image is `app/design/tray.svg`: the app icon reduced to one colour,
//! rendered to `icons/tray/`. On macOS it is a template image (black on
//! transparent, tinted by the system for a light or dark bar; the 36 px
//! file is the @2x the bar draws at 18 pt), on Linux the same shape in
//! white for the usual dark panel (22 px). Left click opens the menu on
//! both, as Raycast's does.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use pal_core::config::Config;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{include_image, AppHandle, Manager};

use crate::settings;

/// The current icon's id. On Linux tray-icon derives the StatusNotifier
/// object path from the id and never unexports it, so a re-created icon
/// with the same id collides with the stale object and stays invisible: a
/// fresh id per creation sidesteps that.
static ID: Mutex<Option<String>> = Mutex::new(None);
static NEXT: AtomicU32 = AtomicU32::new(0);

fn current_id() -> Option<String> {
    crate::lock(&ID).clone()
}

fn fresh_id() -> String {
    let id = format!("pal-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    *crate::lock(&ID) = Some(id.clone());
    id
}

/// Create, remove or refresh the icon as the config says. Hops to the main
/// thread itself: the watcher calls this from its own.
pub fn apply(app: &AppHandle, config: &Config) {
    let want = config.general.menu_bar_icon;
    let hotkey = config.general.hotkey.clone();
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let have = current_id().and_then(|id| handle.tray_by_id(&id));
        match (want, have) {
            (true, None) => match build(&handle, &hotkey) {
                Ok(_) => eprintln!("tray\tcreated\tOpen pal, Settings, Restart extension host, Check for updates (off), Quit"),
                Err(e) => eprintln!("tray\tcreate failed\t{e}"),
            },
            (true, Some(tray)) => match menu_for(&handle, &hotkey).and_then(|m| tray.set_menu(Some(m))) {
                Ok(()) => {}
                Err(e) => eprintln!("tray\tmenu rebuild failed\t{e}"),
            },
            (false, Some(_)) => {
                if let Some(id) = crate::lock(&ID).take() {
                    handle.remove_tray_by_id(&id);
                }
                eprintln!("tray\tremoved");
            }
            (false, None) => {}
        }
    });
}

fn build(app: &AppHandle, hotkey: &str) -> tauri::Result<TrayIcon> {
    #[cfg(target_os = "macos")]
    let icon = include_image!("icons/tray/36x36.png");
    #[cfg(not(target_os = "macos"))]
    let icon = include_image!("icons/tray/22x22.png");
    TrayIconBuilder::with_id(fresh_id())
        .icon(icon)
        .icon_as_template(true)
        .tooltip("pal")
        .menu(&menu_for(app, hotkey)?)
        .show_menu_on_left_click(true)
        .on_menu_event(on_menu)
        .build(app)
}

/// The menu with the root hotkey as the hint next to "Open pal", or
/// without one when the menu's own parser rejects the string (the hotkey
/// module reports a bad hotkey itself; the menu must still exist).
fn menu_for(app: &AppHandle, hotkey: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let s = hotkey.trim();
    match menu(app, Some(s).filter(|s| !s.is_empty())) {
        Err(_) if !s.is_empty() => menu(app, None),
        r => r,
    }
}

fn menu(app: &AppHandle, accelerator: Option<&str>) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", "Open pal", true, accelerator)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let restart = MenuItem::with_id(app, "restart-host", "Restart extension host", true, None::<&str>)?;
    // Placeholder: `crate::updater::check` exists (updater.rs), but the
    // download-and-relaunch flow and its UI do not yet; the row is here so
    // the menu's shape is settled and is enabled with that work.
    let updates = MenuItem::with_id(app, "updates", "Check for updates…", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit pal", true, None::<&str>)?;
    Menu::with_items(app, &[&open, &settings, &PredefinedMenuItem::separator(app)?, &restart, &updates, &PredefinedMenuItem::separator(app)?, &quit])
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "open" => crate::show(app),
        "settings" => settings::open(app),
        "restart-host" => {
            if let Some(host) = app.try_state::<std::sync::Arc<crate::host::Host>>() {
                let host = host.inner().clone();
                tauri::async_runtime::spawn(async move { host.restart().await });
            }
        }
        "quit" => crate::quit(app),
        _ => {}
    }
}
