//! `general.launch_at_login`, registered for real through
//! tauri-plugin-autostart: on macOS a LaunchAgent,
//! `~/Library/LaunchAgents/io.cagdas.pal.plist` (label `io.cagdas.pal`,
//! `RunAtLoad`, `ProgramArguments` = the binary inside the bundle; it takes
//! effect at the next login, the plugin does not `launchctl load` it), on
//! Linux an XDG autostart entry, `~/.config/autostart/pal.desktop`
//! (`Exec` = the binary, or the AppImage when running from one).
//!
//! `apply` follows the config: the watcher calls it on every reload, so the
//! Settings toggle (which writes the key) and a hand edit land the same way.
//! A debug build never registers: the entry would point at
//! `target/debug/pal` and outlive the checkout. It logs and leaves whatever
//! a release build registered alone.

use pal_core::config::Config;
use tauri::plugin::TauriPlugin;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    let b = tauri_plugin_autostart::Builder::new();
    // The LaunchAgent's label and file name: reverse-DNS like every other
    // agent there. Linux keeps the product name, it is the entry's `Name=`.
    #[cfg(target_os = "macos")]
    let b = b.app_name("io.cagdas.pal").macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
    b.build()
}

/// Register or remove the login item as the config says; a no-op when it
/// already matches, so a reload for another key touches nothing.
pub fn apply(app: &AppHandle, config: &Config) {
    let want = config.general.launch_at_login;
    if cfg!(debug_assertions) {
        eprintln!("autostart\tskipped\tlaunch_at_login = {want}; a debug build would register target/debug/pal");
        return;
    }
    let m = app.autolaunch();
    let have = match m.is_enabled() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("autostart\tstatus failed\t{e}");
            return;
        }
    };
    if want == have {
        return;
    }
    let r = if want { m.enable() } else { m.disable() };
    match r {
        Ok(()) => eprintln!("autostart\t{}", if want { "registered" } else { "removed" }),
        Err(e) => eprintln!("autostart\t{} failed\t{e}", if want { "register" } else { "remove" }),
    }
}
