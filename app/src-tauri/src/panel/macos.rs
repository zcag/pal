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

/// The blur behind a window comes from AppKit, not CSS: a `backdrop-filter`
/// in WKWebView samples only the page's own layers, never what is behind the
/// window, so the page's translucent background showed the desktop straight
/// through and read as "sometimes transparent" (solid over a dark window,
/// see-through over a bright one). An NSVisualEffectView under the webview
/// blurs what is really there, the same on every background; the Popover
/// material follows the appearance. Best effort: a failure is logged and
/// the page's flat colour stands.
pub fn vibrancy(window: &WebviewWindow, radius: f64) {
    if let Err(e) = window_vibrancy::apply_vibrancy(window, window_vibrancy::NSVisualEffectMaterial::Popover, Some(window_vibrancy::NSVisualEffectState::Active), Some(radius)) {
        eprintln!("panel\tvibrancy failed\t{e}");
    }
}

pub fn install(window: &WebviewWindow) {
    vibrancy(window, 14.0);
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

/// The panel's logical size: `set_size` is enough on AppKit.
pub fn resize(w: &WebviewWindow, size: tauri::LogicalSize<f64>) -> tauri::Result<()> {
    w.set_size(size)
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
    crate::pop::note_hidden();
    crate::pick::on_hidden(app);
    crate::switcher::on_hidden(app);
    crate::states::on_panel(app, false);
    crate::views::set_visible(app, WINDOW, false, false);
    p.set_ignores_mouse_events(true);
    p.set_alpha_value(0.0);
    crate::compact::on_hidden(app);
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

// ---- Large Type ----------------------------------------------------------

/// The Large Type window's panel (large.rs): the HUD's arrangement, but
/// key while up (any key dismisses it) and hidden again when it loses key
/// (a click elsewhere). Its own module, as `hud`.
mod large {
    use tauri::{AppHandle, Manager, WebviewWindow};
    use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};

    tauri_panel! {
        panel!(LargePanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })
        panel_event!(LargePanelEvents {
            window_did_resign_key(notification: &NSNotification) -> ()
        })
    }

    pub fn install(window: &WebviewWindow) {
        let panel = window.to_panel::<LargePanel>().expect("to_panel");
        panel.set_level(PanelLevel::Status.into());
        panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().into());
        panel.set_collection_behavior(CollectionBehavior::new().can_join_all_spaces().full_screen_auxiliary().ignores_cycle().into());
        panel.set_has_shadow(false);
        let app = window.app_handle().clone();
        let events = LargePanelEvents::new();
        events.window_did_resign_key(move |_| hide(&app));
        panel.set_event_handler(Some(events.as_ref()));
        let occlusion = window.with_webview(|wv| unsafe {
            let wk = &*(wv.inner() as *const AnyObject);
            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: false];
        });
        if let Err(e) = occlusion {
            eprintln!("large\twith_webview failed\t{e}; the page may pause when covered");
        }
        panel.set_ignores_mouse_events(true);
        panel.set_alpha_value(0.0);
        panel.show();
    }

    pub fn show(app: &AppHandle) {
        super::on_main(app, |app| {
            let Ok(p) = app.get_webview_panel(super::super::large::WINDOW) else { return };
            p.set_ignores_mouse_events(false);
            p.set_alpha_value(1.0);
            p.show_and_make_key();
            if let Some(w) = app.get_webview_window(super::super::large::WINDOW) {
                let webview: &tauri::Webview = w.as_ref();
                let _ = webview.set_focus();
            }
        });
    }

    pub fn hide(app: &AppHandle) {
        super::on_main(app, |app| {
            let Ok(p) = app.get_webview_panel(super::super::large::WINDOW) else { return };
            if p.as_panel().alphaValue() <= 0.0 {
                return;
            }
            p.set_ignores_mouse_events(true);
            p.set_alpha_value(0.0);
            p.hide();
            p.show();
        });
    }
}

pub use large::{hide as large_hide, install as large_install, show as large_show};

// ---- keycast overlay -----------------------------------------------------

/// The keycast overlay's panel (keycast.rs): the HUD's arrangement exactly
/// (never key, the mouse passing through, every Space, above everything,
/// alpha 0 when hidden) over a whole display. Its own module, as `hud`.
mod keycast {
    use tauri::{AppHandle, Manager, WebviewWindow};
    use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};

    tauri_panel! {
        panel!(KeycastPanel {
            config: {
                can_become_key_window: false,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
        })
    }

    pub fn install(window: &WebviewWindow) {
        let panel = window.to_panel::<KeycastPanel>().expect("to_panel");
        panel.set_level(PanelLevel::Status.into());
        panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().into());
        panel.set_collection_behavior(CollectionBehavior::new().can_join_all_spaces().full_screen_auxiliary().ignores_cycle().into());
        panel.set_has_shadow(false);
        let occlusion = window.with_webview(|wv| unsafe {
            let wk = &*(wv.inner() as *const AnyObject);
            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: false];
        });
        if let Err(e) = occlusion {
            eprintln!("keycast\twith_webview failed\t{e}; the page may pause when covered");
        }
        panel.set_ignores_mouse_events(true);
        panel.set_alpha_value(0.0);
        panel.show();
    }

    pub fn show(app: &AppHandle) {
        super::on_main(app, |app| {
            if let Ok(p) = app.get_webview_panel(super::super::keycast::WINDOW) {
                p.set_alpha_value(1.0);
                p.order_front_regardless();
            }
        });
    }

    pub fn hide(app: &AppHandle) {
        super::on_main(app, |app| {
            if let Ok(p) = app.get_webview_panel(super::super::keycast::WINDOW) {
                p.set_alpha_value(0.0);
            }
        });
    }
}

pub use keycast::{hide as keycast_hide, install as keycast_install, show as keycast_show};

// ---- keycast cursor ring ----------------------------------------------------

/// The keycast ring (keycast.rs): a panel of its own the size of the ring,
/// click-through on every Space above the overlay, holding two Core
/// Animation layers (the ring in its colour over a thin dark outline, the
/// figures keycast.css had). No WebKit between the pointer and the screen:
/// the page drew the ring two to four frames behind a fast cursor
/// (measured 2026-09-23: 11 ms p50, 34 max from emit to paint, against
/// ~1 ms for the event to reach pal). The panel's origin follows the mouse
/// once per display refresh, off the view's display link (macOS 14+): set
/// per mouse event instead, the moves fell unevenly across frames (two in
/// one, none in the next) and the ring jittered. Before 14, per event.
/// Main thread only; every entry point is a no-op off it.
mod ring {
    use std::cell::RefCell;
    use std::time::{Duration, Instant};

    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, NSObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSBackingStoreType, NSColor, NSEvent, NSPanel, NSStatusWindowLevel, NSView, NSWindowCollectionBehavior, NSWindowStyleMask};
    use objc2_core_graphics::CGColor;
    use objc2_core_foundation::kCFRunLoopCommonModes;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; no ivars, no Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "PalRingTicker"]
        struct Ticker;

        unsafe impl NSObjectProtocol for Ticker {}

        impl Ticker {
            /// A display refresh: the ring to where the mouse is now.
            #[unsafe(method(tick:))]
            fn tick(&self, _link: &AnyObject) {
                RING.with(|slot| {
                    if let Some(r) = slot.borrow_mut().as_mut() {
                        if r.ticked.replace(Instant::now()).is_none() {
                            eprintln!("keycast\tring\tdisplay link ticking");
                        }
                        place(r);
                    }
                });
            }
        }
    );

    /// The ring's diameter up and with a button down, and its stroke, in points before the scale.
    const UP: f64 = 36.0;
    const DOWN: f64 = 26.0;
    const STROKE: f64 = 2.5;
    /// The outline's width either side of the stroke.
    const OUTLINE: f64 = 1.0;

    struct Ring {
        panel: Retained<NSPanel>,
        ring: Retained<AnyObject>,
        outline: Retained<AnyObject>,
        scale: f64,
        down: bool,
        /// The view's `CADisplayLink`, paused while hidden; made once the panel is on screen (a view's link is its window's screen's), never before macOS 14.
        link: Option<Retained<AnyObject>>,
        /// The link's last tick: a move places the ring itself when the link has gone quiet, so a link that never ticks cannot strand it.
        ticked: Option<Instant>,
        /// Where the panel was last put, so a still mouse costs no move.
        at: NSPoint,
    }

    thread_local! {
        static RING: RefCell<Option<Ring>> = const { RefCell::new(None) };
    }

    fn side(scale: f64) -> f64 {
        UP * scale + 2.0 * OUTLINE
    }

    fn layer() -> Retained<AnyObject> {
        let class = AnyClass::get(c"CALayer").expect("QuartzCore's CALayer");
        // SAFETY: `+[CALayer layer]` returns a new autoreleased layer.
        unsafe { msg_send![class, layer] }
    }

    fn make(mtm: MainThreadMarker) -> Ring {
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(side(1.0), side(1.0)));
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(NSPanel::alloc(mtm), frame, NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel, NSBackingStoreType::Buffered, false);
        // SAFETY: a panel made and kept on the main thread; `releasedWhenClosed` off so the Retained here is its one owner.
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setLevel(NSStatusWindowLevel + 1);
        panel.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary | NSWindowCollectionBehavior::Stationary | NSWindowCollectionBehavior::IgnoresCycle);
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(false);
        panel.setHidesOnDeactivate(false);
        panel.setIgnoresMouseEvents(true);
        let view = NSView::initWithFrame(NSView::alloc(mtm), frame);
        view.setWantsLayer(true);
        let (ring, outline) = (layer(), layer());
        let dark = CGColor::new_srgb(0.0, 0.0, 0.0, 0.25);
        // SAFETY: plain CALayer property setters on layers this module owns.
        unsafe {
            let root: Retained<AnyObject> = msg_send![&view, layer];
            let _: () = msg_send![&outline, setBorderColor: &*dark];
            let _: () = msg_send![&*root, addSublayer: &*outline];
            let _: () = msg_send![&*root, addSublayer: &*ring];
        }
        panel.setContentView(Some(&view));
        Ring { panel, ring, outline, scale: 0.0, down: false, link: None, ticked: None, at: NSPoint::new(f64::NAN, f64::NAN) }
    }

    /// How long the link may go without a tick before moves place the ring again.
    const QUIET: Duration = Duration::from_millis(100);

    /// The view's display link calling a [`Ticker`] every refresh of the display the panel is on; None where there is none (before macOS 14).
    fn link(mtm: MainThreadMarker, view: &NSView) -> Option<Retained<AnyObject>> {
        // SAFETY: a selector query on a live view.
        let has: bool = unsafe { msg_send![view, respondsToSelector: sel!(displayLinkWithTarget:selector:)] };
        if !has {
            return None;
        }
        let ticker: Retained<Ticker> = unsafe { msg_send![Ticker::alloc(mtm), init] };
        // SAFETY: `-[NSView displayLinkWithTarget:selector:]` (macOS 14) retains the target; `tick:` takes the link. Added to the main run
        // loop in the common modes so it ticks through a drag or a menu's tracking too. The mode is CoreFoundation's own constant, bridged:
        // the run loop knows the common modes by that pointer, and an equal string of our own named a mode nothing runs (the link never fired).
        unsafe {
            let link: Retained<AnyObject> = msg_send![view, displayLinkWithTarget: &*ticker, selector: sel!(tick:)];
            let rl: Retained<AnyObject> = msg_send![AnyClass::get(c"NSRunLoop")?, mainRunLoop];
            let common = &*(kCFRunLoopCommonModes? as *const _ as *const AnyObject);
            let _: () = msg_send![&link, addToRunLoop: &*rl, forMode: common];
            Some(link)
        }
    }

    fn pause(r: &Ring, paused: bool) {
        if let Some(l) = &r.link {
            // SAFETY: CADisplayLink's `paused` setter, on the main thread.
            let _: () = unsafe { msg_send![&**l, setPaused: paused] };
        }
    }

    /// The layers laid out for the scale and the button, animated over the
    /// overlay's fast duration (`--pal-dur-fast`) or placed at once.
    fn layout(r: &Ring, animate: bool) {
        let d = if r.down { DOWN } else { UP } * r.scale;
        let c = side(r.scale) / 2.0;
        let rect = |d: f64| NSRect::new(NSPoint::new(c - d / 2.0, c - d / 2.0), NSSize::new(d, d));
        let tx = AnyClass::get(c"CATransaction").expect("QuartzCore's CATransaction");
        // SAFETY: CATransaction's class methods and CALayer setters, on the main thread.
        unsafe {
            let _: () = msg_send![tx, begin];
            let _: () = msg_send![tx, setDisableActions: !animate];
            let _: () = msg_send![tx, setAnimationDuration: 0.08f64];
            for (l, d, w) in [(&r.outline, d + 2.0 * OUTLINE, STROKE + 2.0 * OUTLINE), (&r.ring, d, STROKE)] {
                let _: () = msg_send![&**l, setFrame: rect(d)];
                let _: () = msg_send![&**l, setCornerRadius: d / 2.0];
                let _: () = msg_send![&**l, setBorderWidth: w];
            }
            let _: () = msg_send![tx, commit];
        }
    }

    fn place(r: &mut Ring) {
        let p = NSEvent::mouseLocation();
        let h = side(r.scale) / 2.0;
        let at = NSPoint::new(p.x - h, p.y - h);
        if at != r.at {
            r.at = at;
            r.panel.setFrameOrigin(at);
        }
    }

    /// Shown at `scale` in `rgba` at the mouse, or hidden (None).
    pub fn set(look: Option<(f64, [f64; 4])>) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        RING.with(|slot| {
            let mut slot = slot.borrow_mut();
            let Some((scale, [red, green, blue, alpha])) = look else {
                if let Some(r) = slot.as_ref() {
                    pause(r, true);
                    r.panel.orderOut(None);
                }
                return;
            };
            let r = slot.get_or_insert_with(|| make(mtm));
            let color = CGColor::new_srgb(red, green, blue, alpha);
            // SAFETY: a CALayer setter on a layer this module owns.
            let _: () = unsafe { msg_send![&*r.ring, setBorderColor: &*color] };
            if r.scale != scale {
                r.scale = scale;
                let s = side(scale);
                r.panel.setContentSize(NSSize::new(s, s));
                r.at = NSPoint::new(f64::NAN, f64::NAN);
                layout(r, false);
            }
            place(r);
            r.panel.orderFrontRegardless();
            if r.link.is_none() {
                r.link = r.panel.contentView().and_then(|v| link(mtm, &v));
                eprintln!("keycast\tring\tdisplay link {}", if r.link.is_some() { "on" } else { "unavailable: moves place it" });
            }
            pause(r, false);
        });
    }

    /// The ring to the mouse on a move, where no display link is doing it every frame.
    pub fn follow() {
        RING.with(|slot| {
            if let Some(r) = slot.borrow_mut().as_mut().filter(|r| r.panel.isVisible() && r.ticked.is_none_or(|t| t.elapsed() > QUIET)) {
                place(r);
            }
        });
    }

    /// A button down shrinks the ring, its up restores it.
    pub fn press(down: bool) {
        RING.with(|slot| {
            if let Some(r) = slot.borrow_mut().as_mut().filter(|r| r.down != down) {
                r.down = down;
                layout(r, true);
            }
        });
    }
}

pub use ring::{follow as ring_follow, press as ring_press, set as ring_set};

// ---- bar popover and sidebar ----------------------------------------------

/// The bar popover's panel (bar/popover.rs), and the sidebar's (sidebar.rs,
/// the same kind under another label): key like the main panel when
/// engaged, shown without key for a peek; its own tracking area reports
/// the pointer entering and leaving (the peek's grace spans the gap
/// between an item and the popover, or the strip and the sidebar). Its
/// own module, as `hud`.
mod bar {
    use tauri::{AppHandle, Manager, WebviewWindow};
    use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, TrackingAreaOptions, WebviewWindowExt};

    tauri_panel! {
        panel!(BarPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                is_floating_panel: true,
                hides_on_deactivate: false
            }
            with: {
                tracking_area: {
                    options: TrackingAreaOptions::new().active_always().mouse_entered_and_exited(),
                    auto_resize: true
                }
            }
        })
        panel_event!(BarPanelEvents {
            window_did_become_key(notification: &NSNotification) -> (),
            window_did_resign_key(notification: &NSNotification) -> ()
        })
    }

    /// The machine behind a window of this kind, by its label: what its
    /// resign and its pointer tracking feed.
    struct Hooks {
        on_resign: fn(&AppHandle),
        on_pointer: fn(&AppHandle, bool),
    }

    fn hooks(label: &str) -> Hooks {
        if label == crate::sidebar::WINDOW {
            Hooks { on_resign: crate::sidebar::on_resign, on_pointer: crate::sidebar::on_pointer }
        } else {
            Hooks { on_resign: crate::bar::popover::on_resign, on_pointer: crate::bar::popover::on_pointer }
        }
    }

    /// The main panel's arrangement (`install` above): floating,
    /// non-activating, all Spaces, never ordered out, hidden = alpha 0
    /// and the mouse passing through, occlusion detection off.
    pub fn install(window: &WebviewWindow) {
        super::vibrancy(window, 12.0);
        let panel = window.to_panel::<BarPanel>().expect("to_panel");
        panel.set_level(PanelLevel::Floating.into());
        panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().into());
        panel.set_collection_behavior(CollectionBehavior::new().can_join_all_spaces().full_screen_auxiliary().ignores_cycle().into());
        panel.set_has_shadow(true);
        panel.set_corner_radius(12.0);
        // Key only when `show(engaged)` says so (`makeKeyWindow`): AppKit
        // otherwise hands the frontmost key-capable window the keyboard when
        // the app activates at launch, and this panel, ordered front last,
        // invisible, took a user's keystrokes for six seconds on hornet
        // (2026-09-16, `key->paint "ok sent" (0)` in the popover's page).
        panel.set_becomes_key_only_if_needed(true);
        let app = window.app_handle().clone();
        let label = window.label().to_string();
        let Hooks { on_resign, on_pointer } = hooks(&label);
        let events = BarPanelEvents::new();
        let l = label.clone();
        events.window_did_become_key(move |_| eprintln!("bar\t{l}\tkey\t{:.1}ms since start", crate::since_start_ms()));
        let h = app.clone();
        events.window_did_resign_key(move |_| on_resign(&h));
        let h = app.clone();
        events.on_mouse_entered(move |_| on_pointer(&h, true));
        let h = app.clone();
        events.on_mouse_exited(move |_| on_pointer(&h, false));
        panel.set_event_handler(Some(events.as_ref()));
        let occlusion = window.with_webview(|wv| unsafe {
            let wk = &*(wv.inner() as *const AnyObject);
            let _: () = msg_send![wk, _setWindowOcclusionDetectionEnabled: false];
            super::accept_first_mouse(wk);
        });
        if let Err(e) = occlusion {
            eprintln!("bar\t{label}\twith_webview failed\t{e}; the page may pause when covered");
        }
        panel.set_ignores_mouse_events(true);
        panel.set_alpha_value(0.0);
        panel.show();
    }

    /// Show `label`: key (`engaged`, the page's input takes the keyboard)
    /// or a peek, ordered front without key so the app in front keeps
    /// typing.
    pub fn show(app: &AppHandle, label: &'static str, engaged: bool) {
        super::on_main(app, move |app| {
            let Ok(p) = app.get_webview_panel(label) else { return };
            p.set_ignores_mouse_events(false);
            p.set_alpha_value(1.0);
            if engaged {
                p.show_and_make_key();
                if let Some(w) = app.get_webview_window(label) {
                    let webview: &tauri::Webview = w.as_ref();
                    let _ = webview.set_focus();
                }
            } else {
                p.order_front_regardless();
            }
        });
    }

    pub fn hide(app: &AppHandle, label: &'static str) {
        super::on_main(app, move |app| {
            let Ok(p) = app.get_webview_panel(label) else { return };
            if p.as_panel().alphaValue() <= 0.0 {
                return;
            }
            p.set_ignores_mouse_events(true);
            p.set_alpha_value(0.0);
            p.hide();
            p.show();
        });
    }
}

pub use bar::{hide as bar_hide, install as bar_install, show as bar_show};

/// A click into a peeking popover or sidebar must be the click, not the
/// one that only makes the window key: AppKit asks the view under the
/// pointer `acceptsFirstMouse:` and WKWebView says no, so the first click
/// on a non-key panel was swallowed (measured on hornet 2026-09-22: the
/// mousedown made the sidebar key and the page saw nothing). wry's
/// webview class gets the method here, once, answering yes; every webview
/// in this process is pal's own, so nothing else changes.
unsafe fn accept_first_mouse(wk: &AnyObject) {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        unsafe extern "C-unwind" fn yes(_this: *const AnyObject, _cmd: objc2::runtime::Sel, _event: *const AnyObject) -> objc2::runtime::Bool {
            objc2::runtime::Bool::YES
        }
        // SAFETY: `B@:@` is the type encoding of `- (BOOL)acceptsFirstMouse:(NSEvent *)`; the imp matches it. A method the class already has (a later wry) is left alone: `class_addMethod` refuses to replace one.
        let imp: objc2::runtime::Imp = unsafe { std::mem::transmute(yes as unsafe extern "C-unwind" fn(*const AnyObject, objc2::runtime::Sel, *const AnyObject) -> objc2::runtime::Bool) };
        // The instance's class is KVO's dynamic subclass when something observes it (`NSKVONotifying_…`); wry's own class beneath it gets the method too, for a webview nothing observes.
        let mut class = Some(wk.class());
        while let Some(c) = class {
            let name = c.name().to_string_lossy();
            if !name.contains("WryWebView") {
                break;
            }
            let added = unsafe { objc2::ffi::class_addMethod(c as *const _ as *mut _, objc2::sel!(acceptsFirstMouse:), imp, c"B@:@".as_ptr()) };
            eprintln!("bar\tacceptsFirstMouse\t{name}\t{}", if added.as_bool() { "added" } else { "kept the class's own" });
            class = c.superclass();
        }
    });
}

// ---- sidebar strip ---------------------------------------------------------

/// The sidebar's peek strips (sidebar.rs): a 2 px panel of pal's own
/// along the docked edge of each display the config can mean, no
/// webview, transparent (a clear background at alpha 1: a window at
/// alpha 0 gets no mouse events), non-activating, floating on every
/// Space, taking the mouse only to notice it (`mouseEntered` /
/// `mouseExited` from a tracking area over its whole content view, on a
/// view class of ours since AppKit sends them to the area's owner).
/// `place` moves the panels it has and makes or closes the difference;
/// `remove` closes them all.
mod strip {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::NSObjectProtocol;
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSBackingStoreType, NSColor, NSEvent, NSFloatingWindowLevel, NSPanel, NSScreen, NSTrackingArea, NSTrackingAreaOptions, NSView, NSWindowCollectionBehavior, NSWindowStyleMask};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use tauri::AppHandle;

    struct Ivars {
        on: Box<dyn Fn(bool)>,
    }

    define_class!(
        // SAFETY: NSView has no subclassing requirements beyond the main thread; no Drop.
        #[unsafe(super(NSView))]
        #[thread_kind = MainThreadOnly]
        #[name = "PalStripView"]
        #[ivars = Ivars]
        struct StripView;

        unsafe impl NSObjectProtocol for StripView {}

        impl StripView {
            #[unsafe(method(mouseEntered:))]
            fn mouse_entered(&self, _event: &NSEvent) {
                (self.ivars().on)(true);
            }

            #[unsafe(method(mouseExited:))]
            fn mouse_exited(&self, _event: &NSEvent) {
                (self.ivars().on)(false);
            }
        }
    );

    thread_local! {
        static STRIPS: RefCell<Vec<Retained<NSPanel>>> = const { RefCell::new(Vec::new()) };
    }

    /// A logical rect, top-left origin (tauri's space), in AppKit's
    /// bottom-left space: the primary screen's height is the hinge.
    fn flip(mtm: MainThreadMarker, (x, y, w, h): (f64, f64, f64, f64)) -> NSRect {
        let hinge = NSScreen::screens(mtm).iter().next().map_or(0.0, |s| s.frame().size.height);
        NSRect::new(NSPoint::new(x, hinge - y - h), NSSize::new(w, h))
    }

    fn make(mtm: MainThreadMarker, frame: NSRect, on: Box<dyn Fn(bool)>) -> Retained<NSPanel> {
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(NSPanel::alloc(mtm), frame, NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel, NSBackingStoreType::Buffered, false);
        // SAFETY: a panel made and kept on the main thread; `releasedWhenClosed` off so the Retained here is its one owner.
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setLevel(NSFloatingWindowLevel);
        panel.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary | NSWindowCollectionBehavior::Stationary | NSWindowCollectionBehavior::IgnoresCycle);
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(false);
        panel.setHidesOnDeactivate(false);
        panel.setIgnoresMouseEvents(false);
        let bounds = NSRect::new(NSPoint::new(0.0, 0.0), frame.size);
        let view = StripView::alloc(mtm).set_ivars(Ivars { on });
        // SAFETY: NSView's designated initialiser on our subclass.
        let view: Retained<StripView> = unsafe { msg_send![super(view), initWithFrame: bounds] };
        // SAFETY: the view owns the area and outlives it (the panel holds the view); `InVisibleRect` follows the view's bounds, so a re-place needs no bookkeeping.
        let area = unsafe { NSTrackingArea::initWithRect_options_owner_userInfo(mtm.alloc::<NSTrackingArea>(), bounds, NSTrackingAreaOptions::MouseEnteredAndExited | NSTrackingAreaOptions::ActiveAlways | NSTrackingAreaOptions::InVisibleRect, Some(&view), None) };
        view.addTrackingArea(&area);
        panel.setContentView(Some(&view));
        panel.orderFrontRegardless();
        panel
    }

    /// One strip per rect (main thread), `on` getting the pointer entering (true) and leaving any of them.
    pub fn place(app: &AppHandle, rects: Vec<(f64, f64, f64, f64)>, on: fn(&AppHandle, bool)) {
        let handle = app.clone();
        super::on_main(app, move |_| {
            let Some(mtm) = MainThreadMarker::new() else { return };
            STRIPS.with(|s| {
                let mut s = s.borrow_mut();
                for p in s.iter().skip(rects.len()) {
                    p.orderOut(None);
                }
                s.truncate(rects.len());
                for (i, rect) in rects.into_iter().enumerate() {
                    let frame = flip(mtm, rect);
                    match s.get(i) {
                        Some(p) => p.setFrame_display(frame, false),
                        None => {
                            let h = handle.clone();
                            s.push(make(mtm, frame, Box::new(move |entered| on(&h, entered))));
                        }
                    }
                }
            });
        });
    }

    pub fn remove(app: &AppHandle) {
        super::on_main(app, |_| {
            STRIPS.with(|s| {
                for p in s.borrow_mut().drain(..) {
                    p.orderOut(None);
                }
            });
        });
    }
}

pub use strip::{place as strip_place, remove as strip_remove};
