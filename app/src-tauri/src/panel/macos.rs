//! macOS: a non-activating NSPanel that is never ordered out. Hidden means
//! alpha 0 and ignoring the mouse, so WebKit keeps painting and the first
//! show finds the page ready; orderOut on hide hands key focus back to the
//! app in front.

// The panel_event! grammar wants an explicit `-> ()`.
#![allow(clippy::unused_unit)]

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
