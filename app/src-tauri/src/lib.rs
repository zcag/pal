//! The shell: a hidden, pre-warmed panel toggled by the global hotkey or by
//! `pal-app toggle` from a second process, the extension host and the item
//! index behind it, the `icon://` scheme, and timing marks.

mod cli;
mod effects;
mod host;
mod hotkey;
mod icon;
mod index;
#[cfg_attr(target_os = "macos", path = "panel/macos.rs")]
#[cfg_attr(not(target_os = "macos"), path = "panel/linux.rs")]
mod panel;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::Parser;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, RunEvent, WebviewWindow};
use tauri::webview::PageLoadEvent;
use tauri_plugin_global_shortcut::ShortcutState;

const WINDOW: &str = "main";

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
}

// ---- show / hide ---------------------------------------------------------

/// Centre the window horizontally on the monitor under the cursor, a fifth
/// of the way down: where Spotlight and Raycast put theirs. Harmless on
/// Wayland, where every step fails or no-ops and the compositor rule places.
fn place(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten());
    let (Some(m), Ok(size)) = (monitor, w.outer_size()) else { return };
    let area = m.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + (area.size.height as f64 * 0.2) as i32;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

fn show(app: &AppHandle) {
    if panel::is_visible(app) {
        return;
    }
    let t0 = now_ms();
    place(app);
    panel::show(app);
    let _ = app.emit("pal://shown", Shown { t0 });
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

// ---- app -----------------------------------------------------------------

pub fn run() {
    let cli = cli::Cli::parse();
    let context = tauri::generate_context!();
    if cli.cmd.is_some() && cli::handover(&context.config().identifier) {
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
    let builder = icon::register(builder);
    builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![mark, hide, host::host_request, index::query, index::sources, index::pick])
        .on_page_load(move |webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(cmd) = startup.lock().unwrap().take() {
                    cmd.run(webview.app_handle());
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let window = app.get_webview_window(WINDOW).expect("main window");
            panel::install(&window);
            index::install(app.handle());
            host::Host::start(app.handle());
            hotkey::install(app.handle());
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                index::flush(app);
            }
        });
}
