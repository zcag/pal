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
    let occlusion = window.with_webview(|wv| unsafe {
        let wk = &*(wv.inner() as *const AnyObject);
        let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: false];
    });
    if let Err(e) = occlusion {
        eprintln!("panel\twith_webview failed\t{e}; the page may pause when covered");
    }
    // Order in now, invisible: the first show then finds the page painted.
    panel.set_ignores_mouse_events(true);
    panel.set_alpha_value(0.0);
    panel.show();
}

pub fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_panel(WINDOW).is_ok_and(|p| p.as_panel().alphaValue() > 0.0)
}

/// tauri-nspanel talks to AppKit on the calling thread, and AppKit aborts a
/// window change made off the main one ("Must only be used from the main
/// thread"). Every show/hide here goes through this, so a pick (a tokio
/// worker) can hide the panel like the hotkey handler (main) does.
fn on_main(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    if tauri_nspanel::objc2_foundation::MainThreadMarker::new().is_some() {
        f(app);
    } else {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || f(&handle));
    }
}

pub fn show(app: &AppHandle) {
    on_main(app, show_now);
}

fn show_now(app: &AppHandle) {
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
    on_main(app, hide_now);
}

fn hide_now(app: &AppHandle) {
    let Ok(p) = app.get_webview_panel(WINDOW) else { return };
    if !is_visible(app) {
        // Also cuts the re-entry: orderOut below fires window_did_resign_key,
        // whose handler is this function, and alpha is already 0 by then.
        return;
    }
    p.set_ignores_mouse_events(true);
    p.set_alpha_value(0.0);
    // orderOut is what gives key focus back to the app in front; order
    // straight back in so WebKit keeps the page alive.
    p.hide(); // orderOut:
    p.show(); // orderFrontRegardless
}

// ---- HUD -----------------------------------------------------------------

/// The HUD's panel (hud.rs): its own module because `tauri_panel!` brings
/// its imports with it and one module cannot hold two.
mod hud {
    use tauri::{AppHandle, Manager, WebviewWindow};
    use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};

    tauri_panel! {
        // Never key: a HUD takes nothing from the app in front, not even
        // for the frames it is on screen.
        panel!(HudPanel {
            config: {
                can_become_key_window: false,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })
    }

    /// The same never-ordered-out arrangement as the panel (`install`
    /// above): alpha 0 with the mouse passing through is hidden, occlusion
    /// detection off so a covered or locked screen does not pause the page.
    /// Above the panel's level so it is never under it, and no window
    /// shadow: the capsule draws its own (`--pal-shadow-hud`).
    pub fn install(window: &WebviewWindow) {
        let panel = window.to_panel::<HudPanel>().expect("to_panel");
        panel.set_level(PanelLevel::Status.into());
        panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().into());
        panel.set_collection_behavior(CollectionBehavior::new().can_join_all_spaces().full_screen_auxiliary().ignores_cycle().into());
        panel.set_has_shadow(false);
        let occlusion = window.with_webview(|wv| unsafe {
            let wk = &*(wv.inner() as *const AnyObject);
            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: false];
        });
        if let Err(e) = occlusion {
            eprintln!("hud\twith_webview failed\t{e}; the page may pause when covered");
        }
        panel.set_ignores_mouse_events(true);
        panel.set_alpha_value(0.0);
        panel.show();
    }

    pub fn show(app: &AppHandle) {
        super::on_main(app, |app| {
            if let Ok(p) = app.get_webview_panel(super::super::hud::WINDOW) {
                p.set_alpha_value(1.0);
                p.order_front_regardless();
            }
        });
    }

    pub fn hide(app: &AppHandle) {
        super::on_main(app, |app| {
            if let Ok(p) = app.get_webview_panel(super::super::hud::WINDOW) {
                p.set_alpha_value(0.0);
            }
        });
    }
}

pub use hud::{hide as hud_hide, install as hud_install, show as hud_show};
