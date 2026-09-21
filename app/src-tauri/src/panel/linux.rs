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

/// The panel's logical size (compact mode). GTK pins a non-resizable
/// toplevel to the size it was mapped with: `set_size`, a size request on
/// the webview and `set_default_size` all took effect only on the next
/// map (measured on marko with a bare GTK probe and the app; the toggle
/// with the panel up left the page drawn at the new width in the old
/// window). What moves a mapped window is a resizable one whose min and
/// max hints are the size: GTK sends the new geometry, Hyprland resizes
/// the floating window in place, and min == max still means fixed size
/// to the compositor (it floats it as before, nothing to drag) and to the
/// user. So the panel is resizable from the first resize on, with the
/// hints doing what `resizable: false` did.
pub fn resize(w: &WebviewWindow, size: tauri::LogicalSize<f64>) -> tauri::Result<()> {
    w.set_resizable(true)?;
    w.set_min_size(Some(size))?;
    w.set_max_size(Some(size))?;
    w.set_size(size)
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
        if is_visible(app) {
            crate::pop::note_hidden();
            crate::pick::on_hidden(app);
            crate::switcher::on_hidden(app);
            crate::states::on_panel(app, false);
            crate::views::set_visible(app, WINDOW, false, false);
        }
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

// ---- Large Type ----------------------------------------------------------
//
// The Large Type window (large.rs) is a toplevel like the HUD but focused
// while up (any key dismisses it; a focus loss hides it). Its rule keys on
// the title `pal Large Type` and spans the monitor's width:
//
// ```text
// windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, size monitor_w (monitor_h*0.5), move 0 (monitor_h*0.25), match:title ^(pal Large Type)$
// ```

pub fn large_install(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |e| {
        if matches!(e, WindowEvent::Focused(false)) {
            large_hide(&app);
        }
    });
    let _ = window.show();
    let _ = window.hide();
}

pub fn large_show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(crate::large::WINDOW) {
        let _ = w.show();
        let _ = w.set_focus();
        let webview: &tauri::Webview = w.as_ref();
        let _ = webview.set_focus();
    }
}

pub fn large_hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(crate::large::WINDOW) {
        let _ = w.hide();
    }
}

// ---- bar popover ---------------------------------------------------------
//
// The bar popover (bar/popover.rs) is a fourth toplevel, `pal Bar`: shown
// engaged it takes focus like the panel and hides when it loses it; a
// peek (`engaged = false`) is shown without focus. Same class as the
// panel; a compositor rule keyed on its title floats it where pal placed
// it (`set_position` is a no-op on Wayland, so it lands where the rule
// says):
//
// ```text
// windowrule = float on, pin on, no_anim on, border_size 0, match:title ^(pal Bar)$
// ```

pub fn bar_install(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let sidebar = window.label() == crate::sidebar::WINDOW;
    window.on_window_event(move |e| {
        if matches!(e, WindowEvent::Focused(false)) {
            if sidebar {
                crate::sidebar::on_resign(&app);
            } else {
                crate::bar::popover::on_resign(&app);
            }
        }
    });
    let _ = window.show();
    let _ = window.hide();
}

pub fn bar_show(app: &AppHandle, label: &'static str, engaged: bool) {
    let Some(w) = app.get_webview_window(label) else { return };
    let _ = w.show();
    if engaged {
        let _ = w.set_focus();
        let webview: &tauri::Webview = w.as_ref();
        let _ = webview.set_focus();
    }
}

pub fn bar_hide(app: &AppHandle, label: &'static str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.hide();
    }
}

// ---- sidebar strip ---------------------------------------------------------
//
// No sidebar on Linux yet (sidebar.rs builds nothing there), so the strip
// is a pair of no-ops with the macOS signatures.

pub fn strip_place(_app: &AppHandle, _rects: Vec<(f64, f64, f64, f64)>, _on: fn(&AppHandle, bool)) {}

pub fn strip_remove(_app: &AppHandle) {}
