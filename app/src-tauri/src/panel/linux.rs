//! Linux: a plain GTK toplevel. Hidden means unmapped; the page stays alive
//! across unmaps (notes/linux.md), so only the first map costs, and that one
//! is paid at startup below.
//!
//! What the app cannot do itself on Wayland: `set_position` is a no-op and
//! the cursor is unreadable, so placement, pinning and the map animation are
//! the compositor's. Hyprland (0.56 syntax; the class is the binary name):
//!
//! ```text
//! windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:class ^(pal)$
//! bind = CTRL, space, exec, pal toggle
//! ```

use super::*;
use tauri::WindowEvent;

pub fn install(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |e| {
        if matches!(e, WindowEvent::Focused(false)) {
            hide(&app);
        }
    });
    // Map once now: the first show otherwise pays surface creation plus the
    // first frame (83 ms on marko against 0.3 to 4 ms for every later show).
    let _ = window.show();
    let _ = window.hide();
}

pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(WINDOW).and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

pub fn show(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let _ = w.show();
    let _ = w.set_focus();
    let webview: &tauri::Webview = w.as_ref();
    let _ = webview.set_focus();
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.hide();
    }
}

// ---- HUD -----------------------------------------------------------------
//
// The HUD (hud.rs) is a second toplevel, `focusable: false` and always on
// top in tauri.conf.json, so a show never takes focus from the app the
// pick landed in. Same class as the panel, so a compositor rule keyed on
// the class places it like the panel; key the HUD's own rule on its title:
//
// ```text
// windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, no_focus on, move (monitor_w*0.5-window_w*0.5) (monitor_h-window_h-8), match:title ^(pal HUD)$
// ```

pub fn hud_install(window: &WebviewWindow) {
    // Pre-map like the panel: the first show then costs one frame, not a surface.
    let _ = window.show();
    let _ = window.hide();
}

pub fn hud_show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(crate::hud::WINDOW) {
        let _ = w.show();
    }
}

pub fn hud_hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(crate::hud::WINDOW) {
        let _ = w.hide();
    }
}
