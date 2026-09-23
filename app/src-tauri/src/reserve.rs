//! Keep windows below the bar: while `[extensions.window-management]
//! keep_below_bar = true`, a window whose top lands under a bar pal does
//! not draw the frame of (sketchybar over a hidden menu bar, where macOS
//! reserves nothing) is moved down clear of it, its bottom edge kept. The
//! strip is `bar_height`, or sketchybar's own height when that is 0
//! (`sketchybar --query bar`, asked again every [`REQUERY`] while it is the
//! source). `pal_core::windows::reserve` holds it: the displays pal lays
//! windows out on have it taken off, so pal's own layouts land below it
//! and never need moving.
//!
//! How it sees windows: one `AXObserver` per running regular app, its
//! source on the main run loop, for `AXWindowCreated`, `AXWindowMoved` and
//! `AXWindowResized` on the app element (a window's own moves reach the
//! app's observer, as yabai registers them). Apps come and go with
//! `NSWorkspace`'s launch and terminate notifications. An app still
//! launching refuses an observer (`kAXErrorCannotComplete`) and is asked
//! again every [`RETRY`], [`TRIES`] times. The callback only queues the
//! window; a worker thread reads its frame and moves it, so a slow app
//! never stalls pal's main thread. While a mouse button is down the
//! worker waits for it to come up: a window being dragged or resized is
//! moved when it is let go, never mid-gesture.
//!
//! A move is never repeated into a loop: the frame it sets is clear of the
//! strip, so the event it causes finds nothing to do (yabai's way too). An
//! app that puts the window back is let be after one try per
//! [`GIVE_UP`]. What is left alone: pal's own windows, windows that are
//! not a standard window or a dialog (panels, popovers, sheets, a bar's
//! own), full-screen and minimised windows.
//!
//! Turning it on asks for Accessibility when it is missing (the card,
//! then the prompt); the watcher starts on the grant, polling for it
//! every [`POLL`] while the setting is on. Turning it off drops every
//! observer and the strip. Linux: the compositor reserves a bar's space
//! itself (layer-shell's exclusive zone), so this is macOS only.

// Off macOS nothing is watched; the settings still compile.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use pal_core::config::{spec_defaults, Config};
use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::{permissions, settings};

const MANIFEST: &str = include_str!("../../../extensions/window-management/pal.json");

/// How often the setting, on without Accessibility, looks for the grant.
const POLL: Duration = Duration::from_secs(2);
/// An app that refused an observer (still launching) is asked again after this...
const RETRY: Duration = Duration::from_millis(100);
/// ...this many times.
const TRIES: u32 = 50;
/// How often sketchybar is asked for its height again while it is the source.
const REQUERY: Duration = Duration::from_secs(30);
/// A window found back under the strip this soon after pal moved it is the app's doing: let be.
const GIVE_UP: Duration = Duration::from_secs(2);

/// `[extensions.window-management]` as the watcher reads it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct Settings {
    keep_below_bar: bool,
    bar_height: f64,
}

impl Settings {
    fn from(config: &Config) -> Settings {
        let manifest: Value = serde_json::from_str(MANIFEST).expect("bundled pal.json parses");
        let defaults = spec_defaults(&manifest["settings"]);
        let table = config.extension_settings("window-management", &defaults, &manifest["settings"]);
        // The layouts' own keys ride in the same table; only these two are read here.
        table.try_into().unwrap_or_else(|e| {
            eprintln!("reserve\tbad settings\t{e}; off");
            Settings { keep_below_bar: false, bar_height: 0.0 }
        })
    }
}

/// On: the setting says so. The watcher's callbacks and the worker check it.
static ON: AtomicBool = AtomicBool::new(false);
/// The configured height, 0 for sketchybar's.
static HEIGHT: std::sync::Mutex<f64> = std::sync::Mutex::new(0.0);

pub fn install(app: &AppHandle) {
    apply(app, Settings::from(&settings::config(app)));
}

pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    let (before, after) = (Settings::from(prev), Settings::from(next));
    if before != after {
        apply(app, after);
    }
}

fn apply(app: &AppHandle, s: Settings) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let was = ON.swap(s.keep_below_bar, Ordering::Relaxed);
    *crate::lock(&HEIGHT) = s.bar_height;
    if !s.keep_below_bar {
        if was {
            eprintln!("reserve\toff");
            pal_core::windows::reserve::set(0.0);
            stop(app);
        }
        return;
    }
    // The strip first: the layouts honour it with or without the watcher.
    std::thread::spawn(|| strip(true));
    if was {
        return;
    }
    if pal_core::ax::trusted() {
        start(app);
    } else {
        permissions::ask(app, "accessibility", "Keep windows below the bar");
        let app = app.clone();
        std::thread::spawn(move || {
            while ON.load(Ordering::Relaxed) && !pal_core::ax::trusted() {
                std::thread::sleep(POLL);
            }
            if ON.load(Ordering::Relaxed) {
                eprintln!("reserve\taccessibility granted");
                start(&app);
            }
        });
    }
}

fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::start(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

fn stop(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::stop(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Set the strip from the setting, or from sketchybar when that is 0;
/// `force` asks sketchybar even when it answered lately. Returns the strip.
fn strip(force: bool) -> f64 {
    use std::time::Instant;
    static ASKED: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);
    let fixed = *crate::lock(&HEIGHT);
    if fixed > 0.0 {
        pal_core::windows::reserve::set(fixed);
        return fixed;
    }
    let mut asked = crate::lock(&ASKED);
    if !force && asked.is_some_and(|t| t.elapsed() < REQUERY) {
        return pal_core::windows::reserve::get();
    }
    *asked = Some(Instant::now());
    drop(asked);
    let h = crate::bar::sketchybar::top_height().unwrap_or(0.0);
    if h != pal_core::windows::reserve::get() {
        eprintln!("reserve\tstrip\t{h} (sketchybar)");
    }
    pal_core::windows::reserve::set(h);
    h
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;

    use objc2_app_kit::{NSApplicationActivationPolicy, NSWorkspace, NSWorkspaceDidLaunchApplicationNotification, NSWorkspaceDidTerminateApplicationNotification};
    use objc2_core_foundation::{CFString, CFType};
    use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGMouseButton};
    use objc2_foundation::NSNotification;
    use pal_core::ax::element::{Element, Observer};
    use pal_core::windows::{self, reserve, Rect};
    use tauri::AppHandle;

    use super::*;

    const NOTIFICATIONS: [&str; 3] = ["AXWindowCreated", "AXWindowMoved", "AXWindowResized"];
    /// The window kinds moved: what a person calls a window.
    const SUBROLES: [&str; 2] = ["AXStandardWindow", "AXDialog"];

    thread_local! {
        /// The observers, by pid. Main thread only: made, used and dropped there.
        static OBSERVERS: RefCell<HashMap<i32, Observer>> = RefCell::new(HashMap::new());
    }

    /// The worker's queue.
    static QUEUE: OnceLock<Mutex<Sender<Element>>> = OnceLock::new();

    fn queue(el: Element) {
        let q = QUEUE.get_or_init(|| {
            let (tx, rx) = channel::<Element>();
            std::thread::Builder::new()
                .name("reserve".into())
                .spawn(move || {
                    let mut moved: Vec<(i32, Rect, Instant)> = vec![];
                    while let Ok(el) = rx.recv() {
                        check(&el, &mut moved);
                    }
                })
                .expect("spawn the reserve worker");
            Mutex::new(tx)
        });
        let _ = crate::lock(q).send(el);
    }

    extern "C" fn callback(_observer: *mut CFType, element: *mut CFType, _notification: *const CFString, _refcon: *mut c_void) {
        if !ON.load(Ordering::Relaxed) {
            return;
        }
        // SAFETY: the element the observer hands its callback is live for the call.
        if let Some(el) = unsafe { Element::borrowed(element) } {
            queue(el);
        }
    }

    fn mouse_down() -> bool {
        [CGMouseButton::Left, CGMouseButton::Right].into_iter().any(|b| CGEventSource::button_state(CGEventSourceStateID::CombinedSessionState, b))
    }

    /// One window: read, and moved clear of the strip when it is under it.
    fn check(el: &Element, moved: &mut Vec<(i32, Rect, Instant)>) {
        // A drag or a resize by hand: wait for the button to come up (the last event of the gesture is the one that counts).
        let t = Instant::now();
        while mouse_down() && t.elapsed() < Duration::from_secs(60) {
            std::thread::sleep(Duration::from_millis(50));
        }
        if !ON.load(Ordering::Relaxed) || strip(false) <= 0.0 {
            return;
        }
        let Some(pid) = el.pid() else { return };
        if pid == std::process::id() as i32 || el.role().as_deref() != Some("AXWindow") || !el.subrole().is_some_and(|s| SUBROLES.contains(&s.as_str())) {
            return;
        }
        if el.fullscreen() == Some(true) || el.minimized() {
            return;
        }
        let Some(frame) = el.frame() else { return };
        let displays = windows::displays().unwrap_or_default();
        let Some(to) = reserve::clear(&frame, &displays) else { return };
        moved.retain(|(.., at)| at.elapsed() < GIVE_UP);
        if moved.iter().any(|(p, f, _)| *p == pid && f.about(&frame, 1.0)) {
            return;
        }
        let ok = el.set_frame(to);
        eprintln!("reserve\tmoved\tpid {pid} {frame:?} -> {to:?}{}", if ok { "" } else { "\tthe app refused part of it" });
        moved.push((pid, frame, Instant::now()));
    }

    /// The watcher on: the workspace notifications (once a run), an
    /// observer for every running app, and every window already under the
    /// strip moved.
    pub fn start(app: &AppHandle) {
        static WORKSPACE: std::sync::Once = std::sync::Once::new();
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            WORKSPACE.call_once(|| {
                let center = NSWorkspace::sharedWorkspace().notificationCenter();
                for name in [unsafe { NSWorkspaceDidLaunchApplicationNotification }, unsafe { NSWorkspaceDidTerminateApplicationNotification }] {
                    let h = handle.clone();
                    let block = block2::RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| sync(&h));
                    // Leaked on purpose: the observation lasts the process; `sync` does nothing while off.
                    let token = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) };
                    std::mem::forget(token);
                }
            });
            eprintln!("reserve\ton");
            sync(&handle);
            let pids: Vec<i32> = OBSERVERS.with_borrow(|o| o.keys().copied().collect());
            std::thread::spawn(move || {
                for pid in pids {
                    Element::app(pid).into_iter().flat_map(|a| a.windows()).for_each(queue);
                }
            });
        });
    }

    pub fn stop(app: &AppHandle) {
        let _ = app.run_on_main_thread(|| OBSERVERS.with_borrow_mut(|o| o.clear()));
    }

    /// Main thread: an observer for every regular app running, none for one gone.
    fn sync(app: &AppHandle) {
        if !ON.load(Ordering::Relaxed) {
            return;
        }
        let own = std::process::id() as i32;
        let running: Vec<i32> = NSWorkspace::sharedWorkspace()
            .runningApplications()
            .iter()
            .filter(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular)
            .map(|a| a.processIdentifier())
            .filter(|&p| p != own)
            .collect();
        OBSERVERS.with_borrow_mut(|o| o.retain(|pid, _| running.contains(pid)));
        for pid in running {
            if !OBSERVERS.with_borrow(|o| o.contains_key(&pid)) {
                observe(app, pid, 0);
            }
        }
    }

    /// Main thread: observe `pid`, asking again after [`RETRY`] while it is still launching.
    fn observe(app: &AppHandle, pid: i32, tries: u32) {
        if !ON.load(Ordering::Relaxed) || OBSERVERS.with_borrow(|o| o.contains_key(&pid)) {
            return;
        }
        let made = Observer::new(pid, callback).zip(Element::app(pid)).map(|(obs, el)| {
            let r = NOTIFICATIONS.iter().try_for_each(|n| obs.add(&el, n));
            (obs, r)
        });
        match made {
            Some((obs, Ok(()))) => {
                OBSERVERS.with_borrow_mut(|o| o.insert(pid, obs));
            }
            // -25204, kAXErrorCannotComplete: not answering yet.
            Some((_, Err(-25204))) | None if tries < TRIES => {
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(RETRY);
                    let h = app.clone();
                    let _ = app.run_on_main_thread(move || observe(&h, pid, tries + 1));
                });
            }
            Some((_, Err(rc))) => eprintln!("reserve\tpid {pid}\tnot observed\tAX error {rc}"),
            None => eprintln!("reserve\tpid {pid}\tnot observed after {TRIES} tries"),
        }
    }
}
