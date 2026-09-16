//! Linux: a plain GTK toplevel. Hidden means unmapped; the page stays alive
//! across unmaps (notes/linux.md), so only the first map costs, and that one
//! is paid at startup below.
//!
//! What the app cannot do itself on Wayland: `set_position` is a no-op and
//! the cursor is unreadable, so placement, pinning and the map animation are
//! the compositor's. Hyprland (0.56 syntax). Every pal window has the class
//! `pal` (the binary name), so the rule keys on the title, which only the
//! panel has: a class rule would float and pin the HUD (`pal HUD`) and the
//! settings window (`pal Settings`, a normal tiled window) too.
//!
//! ```text
//! windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:title ^(pal)$
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
// pick landed in. Same class as the panel, its own title; its rule keys on
// that title like the panel's does, and places it at the bottom:
//
// ```text
// windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, no_focus on, move (monitor_w*0.5-window_w*0.5) (monitor_h-window_h-8), match:title ^(pal HUD)$
// ```

pub fn hud_install(window: &WebviewWindow) {
    hud_size_request(window);
    // Pre-map like the panel: the first show then costs one frame, not a surface.
    let _ = window.show();
    let _ = window.hide();
}

/// GTK sizes a non-resizable toplevel from its child's request, with a
/// floor of 200 px where the child asks for nothing: tao packs the
/// WebKitWebView (minimum 0 by 0) into a GtkBox without a size request,
/// so the HUD came up 480 by 200 on Hyprland for the 480 by 72 in
/// tauri.conf.json (the panel's 480 is above the floor and unaffected).
/// Ask the webview for the configured size, as wry itself does for a
/// GtkFixed parent; the toplevel is then exactly that. Measured on marko
/// with a bare GTK probe: 480x200 without, 480x72 with.
fn hud_size_request(window: &WebviewWindow) {
    use gtk::prelude::*;
    let app = window.app_handle();
    let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == crate::hud::WINDOW) else { return };
    let Ok(vbox) = window.default_vbox() else { return };
    for child in vbox.children() {
        child.set_size_request(cfg.width as i32, cfg.height as i32);
    }
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
