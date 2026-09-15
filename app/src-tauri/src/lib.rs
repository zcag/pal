//! The shell: a hidden, pre-warmed panel toggled by a global hotkey, a
//! streaming feed from a child process, and timing marks for the go/no-go.

mod host;

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const WINDOW: &str = "main";
const FEED_CHUNK: usize = 256;

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

// ---- panel (macOS) -------------------------------------------------------

#[cfg(target_os = "macos")]
mod panel {
    use super::*;
    use tauri_nspanel::{
        tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
    };

    // Also brings msg_send and AnyObject into scope.
    tauri_panel! {
        // Key (takes keyboard) but non-activating: the app behind keeps
        // being the active app, so a pick can paste into it after we hide.
        panel!(PalPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })
        panel_event!(PalPanelEvents {
            window_did_resign_key(notification: &NSNotification) -> ()
        })
    }

    pub fn install(window: &WebviewWindow) {
        let panel = window.to_panel::<PalPanel>().expect("to_panel");
        panel.set_level(PanelLevel::Floating.into());
        panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().into());
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary()
                .ignores_cycle()
                .into(),
        );
        panel.set_has_shadow(true);
        panel.set_corner_radius(12.0);

        let app = window.app_handle().clone();
        let events = PalPanelEvents::new();
        events.window_did_resign_key(move |_| hide(&app));
        panel.set_event_handler(Some(events.as_ref()));

        // WebKit suspends rendering updates (rAF, timers) for a page whose
        // window is ordered out or occluded (WebKit PageClientImplMac.mm,
        // isViewVisible). So the panel is never ordered out: hidden means
        // alpha 0 and ignoring the mouse. On top at floating level that still
        // counts as visible; a covering window, a locked screen or a sleeping
        // display would not, so occlusion detection goes off too, via the
        // private WKWebView setter Raycast flips for the same reason.
        let _ = window.with_webview(|wv| unsafe {
            let wk = &*(wv.inner() as *const AnyObject);
            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: false];
        });
        // Order in now, invisible: the first show then finds the page painted.
        panel.set_ignores_mouse_events(true);
        panel.set_alpha_value(0.0);
        panel.show();
    }

    pub fn is_visible(app: &AppHandle) -> bool {
        app.get_webview_panel(WINDOW).map(|p| p.as_panel().alphaValue() > 0.0).unwrap_or(false)
    }

    pub fn show(app: &AppHandle) {
        let Ok(p) = app.get_webview_panel(WINDOW) else { return };
        p.set_ignores_mouse_events(false);
        p.set_alpha_value(1.0);
        p.show_and_make_key();
        // The page never goes hidden, so its input keeps DOM focus and WebKit
        // does not claim first responder by itself: hand it the keyboard.
        if let Some(w) = app.get_webview_window(WINDOW) {
            let webview: &tauri::Webview = w.as_ref();
            let _ = webview.set_focus();
        }
    }

    pub fn hide(app: &AppHandle) {
        let Ok(p) = app.get_webview_panel(WINDOW) else { return };
        if !is_visible(app) {
            return; // also cuts the resign-key -> hide re-entry from orderOut below
        }
        p.set_ignores_mouse_events(true);
        p.set_alpha_value(0.0);
        // orderOut is what gives key focus back to the app in front; order
        // straight back in so WebKit keeps the page alive.
        p.hide(); // orderOut:
        p.show(); // orderFrontRegardless
    }
}

#[cfg(not(target_os = "macos"))]
mod panel {
    use super::*;
    pub fn install(_: &WebviewWindow) {}
    pub fn is_visible(app: &AppHandle) -> bool {
        app.get_webview_window(WINDOW).and_then(|w| w.is_visible().ok()).unwrap_or(false)
    }
    pub fn show(app: &AppHandle) {
        if let Some(w) = app.get_webview_window(WINDOW) {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    pub fn hide(app: &AppHandle) {
        if let Some(w) = app.get_webview_window(WINDOW) {
            let _ = w.hide();
        }
    }
}

// ---- show / hide ---------------------------------------------------------

/// Centre the window horizontally on the monitor under the cursor, a fifth
/// of the way down: where Spotlight and Raycast put theirs.
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

fn toggle(app: &AppHandle) {
    if panel::is_visible(app) {
        panel::hide(app);
        return;
    }
    let t0 = now_ms();
    place(app);
    panel::show(app);
    let _ = app.emit("pal://shown", Shown { t0 });
}

#[tauri::command]
fn hide(app: AppHandle) {
    panel::hide(&app);
}

// ---- feed ----------------------------------------------------------------

/// Runs `cmd` in a shell and streams its stdout lines to the webview in
/// chunks, as `pal://feed` events, then `pal://feed-done`.
#[tauri::command]
fn feed(app: AppHandle, cmd: String) {
    std::thread::spawn(move || {
        let child = Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
            .stdout(Stdio::piped())
            .spawn();
        let Ok(mut child) = child else { return };
        let reader = BufReader::new(child.stdout.take().unwrap());
        let mut chunk = Vec::with_capacity(FEED_CHUNK);
        for line in reader.lines().map_while(Result::ok) {
            chunk.push(line);
            if chunk.len() == FEED_CHUNK {
                let _ = app.emit("pal://feed", std::mem::take(&mut chunk));
            }
        }
        if !chunk.is_empty() {
            let _ = app.emit("pal://feed", chunk);
        }
        let _ = app.emit("pal://feed-done", ());
    });
}

// ---- app -----------------------------------------------------------------

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
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
        .invoke_handler(tauri::generate_handler![mark, hide, feed, host::host_request])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let window = app.get_webview_window(WINDOW).expect("main window");
            panel::install(&window);
            host::Host::start(app.handle());
            app.global_shortcut()
                .register(Shortcut::new(Some(Modifiers::CONTROL), Code::Space))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
