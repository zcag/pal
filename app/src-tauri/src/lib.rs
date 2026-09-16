//! The shell: a hidden, pre-warmed panel toggled by the global hotkey or by
//! `pal toggle` from a second process, the extension host and the item
//! index behind it, the core capabilities the host calls back for
//! (`bridge`), the `icon://` scheme, the menu bar icon, and timing marks.

mod autostart;
mod bridge;
mod cache;
mod cli;
mod clipboard;
mod effects;
mod firstrun;
mod host;
mod hotkey;
mod icon;
mod index;
mod settings;
mod system;
mod tray;
mod updater;
mod windows;
#[cfg_attr(target_os = "macos", path = "panel/macos.rs")]
#[cfg_attr(not(target_os = "macos"), path = "panel/linux.rs")]
mod panel;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use clap::Parser;
use pal_core::config::{ConfigFile, Position};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, RunEvent, WebviewWindow};
use tauri::webview::PageLoadEvent;
use tauri_plugin_global_shortcut::ShortcutState;

const WINDOW: &str = "main";

/// When `run` began: the origin of the startup timing lines.
static START: OnceLock<Instant> = OnceLock::new();

pub(crate) fn since_start_ms() -> f64 {
    START.get().map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0)
}

fn now_ms() -> f64 {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    d.as_secs_f64() * 1000.0
}

/// Prints a timing mark from either side, on one clock (wall time, ms).
#[tauri::command]
fn mark(name: String, t: Option<f64>) {
    eprintln!("mark\t{}\t{:.1}", name, t.unwrap_or_else(now_ms));
}

#[derive(Clone, Serialize)]
struct Shown {
    t0: f64,
    /// `extension/palette` to open straight into (a palette hotkey).
    #[serde(skip_serializing_if = "Option::is_none")]
    palette: Option<String>,
}

// ---- show / hide ---------------------------------------------------------

/// Whether `place` has positioned the panel once; `position = "last"` then
/// leaves it where it is.
static PLACED: AtomicBool = AtomicBool::new(false);

/// Centre the window horizontally on the monitor under the cursor, and
/// vertically where `general.position` says: a fifth of the way down (where
/// Spotlight and Raycast put theirs), centred, or wherever it was last.
/// Harmless on Wayland, where every step fails or no-ops and the compositor
/// rule places.
fn place(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let position = settings::config(app).general.position;
    if position == Position::Last && PLACED.load(Ordering::Relaxed) {
        return;
    }
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten());
    let (Some(m), Ok(size)) = (monitor, w.outer_size()) else { return };
    let area = m.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = match position {
        Position::Centre => area.position.y + (area.size.height as i32 - size.height as i32) / 2,
        Position::Top | Position::Last => area.position.y + (area.size.height as f64 * 0.2) as i32,
    };
    let _ = w.set_position(PhysicalPosition::new(x, y));
    PLACED.store(true, Ordering::Relaxed);
}

fn show(app: &AppHandle) {
    show_in(app, None);
}

/// Show the panel, at the root or inside `palette` (`extension/palette`).
/// An already visible panel is not moved; the page still gets the event, so
/// a palette hotkey switches what is showing.
pub(crate) fn show_in(app: &AppHandle, palette: Option<String>) {
    let t0 = now_ms();
    if !panel::is_visible(app) {
        place(app);
        panel::show(app);
    } else if palette.is_none() {
        return;
    }
    let _ = app.emit("pal://shown", Shown { t0, palette });
    // After the event: the live palettes list again off this thread.
    index::on_shown(app);
}

fn toggle(app: &AppHandle) {
    if panel::is_visible(app) {
        panel::hide(app);
    } else {
        show(app);
    }
}

#[tauri::command]
fn hide(app: AppHandle) {
    panel::hide(&app);
}

/// Quit: the host gets EOF and up to its stop timeout to exit, then the
/// event loop ends (`RunEvent::Exit` below flushes frecency and the cache
/// saver) and the process exits 0. Off the caller's thread, so the tray
/// menu and `pal quit` (both on the main thread) return at once.
pub(crate) fn quit(app: &AppHandle) {
    eprintln!("quit\trequested");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(host) = app.try_state::<std::sync::Arc<host::Host>>() {
            host.stop().await;
        }
        app.exit(0);
    });
}

// ---- app -----------------------------------------------------------------

pub fn run() {
    START.get_or_init(Instant::now);
    let cli = cli::Cli::parse();
    let context = tauri::generate_context!();
    if cli.cmd.is_some() && cli::handover(&context.config().identifier) {
        return;
    }
    if cli.cmd == Some(cli::Cmd::Quit) {
        // Nothing answered: starting an app to quit it is not what was asked.
        eprintln!("pal\tnot running");
        return;
    }
    // Applied once the page has loaded, when started with a subcommand.
    let startup = Mutex::new(cli.cmd);
    let builder = tauri::Builder::default()
        // First: a second process the handover above missed exits inside
        // this plugin's setup, before anything else is built.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(cmd) = cli::Cmd::from_args(args) {
                cmd.run(app);
            }
        }));
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    let builder = icon::register(builder).plugin(tauri_plugin_updater::Builder::new().build()).plugin(autostart::plugin());
    builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        hotkey::pressed(app, shortcut);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            mark,
            hide,
            host::host_request,
            index::query,
            index::sources,
            index::pick,
            index::detail,
            index::filter,
            index::index_refresh,
            settings::settings_get,
            settings::settings_set,
            settings::settings_unset,
            settings::settings_set_secret,
            settings::settings_open_file,
            settings::settings_reveal_file,
            settings::settings_reset_frecency,
            settings::settings_restart_host,
            settings::settings_open,
            settings::settings_close,
            updater::check_updates,
        ])
        .on_page_load(move |webview, payload| {
            // The panel's page: the settings window loads later and on demand.
            if payload.event() == PageLoadEvent::Finished && webview.label() == WINDOW {
                if let Some(cmd) = startup.lock().unwrap().take() {
                    cmd.run(webview.app_handle());
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let window = app.get_webview_window(WINDOW).expect("main window");
            firstrun::install();
            panel::install(&window);
            // The index cache and frecency are keyed by config file, so two
            // configs (`pali.toml` in dev, `config.toml`) never share one.
            let config = ConfigFile::locate();
            let data = config.data_dir();
            eprintln!("profile\t{}\t{}\t{}", config.profile(), config.path().display(), data.display());
            index::install(app.handle(), &data);
            clipboard::install(app.handle());
            // Hotkeys and settings before the host: its first notifications
            // read the config and register palettes' hotkeys.
            hotkey::install(app.handle());
            settings::install(app.handle(), config);
            updater::install(app.handle());
            // The last run's listings, so the root answers before the host is up.
            index::restore_cache(app.handle());
            host::Host::start(app.handle());
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                index::flush(app);
                eprintln!("quit\tflushed\t{:.1}ms since start", since_start_ms());
            }
        });
}
