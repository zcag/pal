//! The OS permissions pal needs, as one place the shell asks from. macOS:
//! Accessibility (paste sends a keystroke into the app in front, window
//! switching raises another app's window, `pal action type`), Calendars
//! (the calendar extension, EventKit), Full Disk Access (the OTP palette
//! reads the Messages database), Input Monitoring (the bar popover's key
//! monitor while a peek is up) and Location Services (macOS 15+ hands
//! Wi-Fi network names only to an app with it: the wifi extension). macOS
//! lists an app under Privacy & Security > Accessibility only after the
//! app has called the trust check with the prompt once, so every ask here
//! is both: the system prompt (`ax::request`, which adds pal to the list)
//! and System Settings opened on that pane, where the switch is. Full
//! Disk Access has no prompt at all (the pane is the only way), Input
//! Monitoring, Calendars and Location prompt once. Off macOS every
//! permission is a given and `status` says so.
//!
//! Who asks: the panel's first show on a fresh profile (once per run,
//! `general.ask_permissions_on_start`), the Welcome row (every time), an
//! effect refused for want of it (once per run, `effects.rs`), an
//! extension over `core/permissions.request` (the wifi palette asks for
//! Location from a listing the user is looking at, never from the startup
//! load: [`call`]) and the Settings window's Grant buttons. Nothing polls the OS for
//! a change; a grant is seen by [`watch`], which checks every [`POLL`]
//! while a window is open and something was missing, and emits
//! [`events::PERMISSIONS`] on a change (the Welcome row goes, Settings
//! turns the dot green).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use pal_core::permission::Status as Permission;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{events, panel, settings, welcome};

const POLL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Status {
    /// May drive other apps (send keys, raise windows). Always true off macOS.
    pub accessibility: bool,
    /// Calendars (EventKit): `granted`, `not_determined`, `denied`, `restricted`, or `unavailable` off macOS without a backend.
    pub calendar: Permission,
    /// Full Disk Access, probed by opening the Messages database the OTP
    /// palette reads: `true` readable, `false` refused, `None` when there is
    /// no database to probe (Messages never ran) or off macOS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_disk_access: Option<bool>,
    /// Input Monitoring (`IOHIDCheckAccess`): the bar popover's key monitor. Always true off macOS.
    pub input_monitoring: bool,
    /// Location Services (CoreLocation): Wi-Fi network names on macOS 15+. `unavailable` off macOS.
    pub location: Permission,
}

impl Status {
    /// Nothing left to grant: what stops [`watch`].
    fn complete(&self) -> bool {
        self.accessibility && !self.calendar.missing() && self.full_disk_access != Some(false) && self.input_monitoring && !self.location.missing()
    }
}

pub fn status() -> Status {
    Status { accessibility: pal_core::ax::trusted(), calendar: pal_core::calendar::permission(), full_disk_access: full_disk_access(), input_monitoring: input_monitoring(), location: location::status() }
}

/// The Messages database is behind Full Disk Access and nothing else, so
/// opening it for reading is the probe: `EPERM` is a missing grant, a
/// missing file is no answer.
fn full_disk_access() -> Option<bool> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let db = pal_core::fs::expand_home("~/Library/Messages/chat.db");
    match std::fs::File::open(&db) {
        Ok(_) => Some(true),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Some(false),
        Err(_) => None,
    }
}

#[cfg(target_os = "macos")]
mod hid {
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        /// `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)`: 0 granted, 1 denied, 2 not asked.
        pub fn IOHIDCheckAccess(request: u32) -> u32;
        /// The system prompt, once; the answer as of now.
        pub fn IOHIDRequestAccess(request: u32) -> bool;
    }
    pub const LISTEN_EVENT: u32 = 1;
}

/// Whether the process may observe keyboard events (Input Monitoring).
pub fn input_monitoring() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        hid::IOHIDCheckAccess(hid::LISTEN_EVENT) == 0
    }
    #[cfg(not(target_os = "macos"))]
    true
}

/// Location Services over CoreLocation. The state is the class method,
/// answered without a manager; the prompt is `requestWhenInUseAuthorization`
/// on a manager made on the main thread and kept for the run with its
/// delegate (CoreLocation answers asynchronously and only to a manager that
/// still exists, so a dropped one shows nothing). The prompt needs
/// `NSLocationWhenInUseUsageDescription` in the bundle's Info.plist and
/// shows once per bundle identifier; a `denied` state is switched in
/// System Settings > Privacy & Security > Location Services.
#[cfg(target_os = "macos")]
mod location {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
    use objc2_core_location::{CLAuthorizationStatus, CLLocationManager, CLLocationManagerDelegate};
    use objc2_foundation::NSObject;

    use super::Permission;

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; no Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "PalLocationDelegate"]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl CLLocationManagerDelegate for Delegate {
            /// The answer to the prompt (and any later switch); `watch` carries it to the windows, this is the log line.
            #[unsafe(method(locationManagerDidChangeAuthorization:))]
            fn did_change(&self, manager: &CLLocationManager) {
                // SAFETY: a property read on the manager CoreLocation handed us.
                let s = unsafe { manager.authorizationStatus() };
                eprintln!("permissions\tlocation\tchanged\t{:?}", of(s));
            }
        }
    );

    thread_local! {
        static MANAGER: RefCell<Option<(Retained<CLLocationManager>, Retained<Delegate>)>> = const { RefCell::new(None) };
    }

    pub(super) fn of(s: CLAuthorizationStatus) -> Permission {
        match s {
            CLAuthorizationStatus::NotDetermined => Permission::NotDetermined,
            CLAuthorizationStatus::Restricted => Permission::Restricted,
            CLAuthorizationStatus::AuthorizedAlways | CLAuthorizationStatus::AuthorizedWhenInUse => Permission::Granted,
            _ => Permission::Denied,
        }
    }

    pub fn status() -> Permission {
        // SAFETY: a class method with no arguments. Deprecated for the instance property, which would need a manager per read.
        #[allow(deprecated)]
        of(unsafe { CLLocationManager::authorizationStatus_class() })
    }

    /// The prompt, on the main thread; returns at once, the answer comes to the delegate.
    pub fn request(mtm: MainThreadMarker) {
        MANAGER.with(|m| {
            let mut m = m.borrow_mut();
            if m.is_none() {
                // SAFETY: plain inits on the main thread; the delegate is a weak property, so the pair is retained here for the run.
                let delegate: Retained<Delegate> = unsafe { msg_send![Delegate::alloc(mtm), init] };
                let manager = unsafe { CLLocationManager::new() };
                unsafe { manager.setDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
                *m = Some((manager, delegate));
            }
            // SAFETY: a call on the retained manager; a second call while the prompt is up is a no-op.
            unsafe { m.as_ref().unwrap().0.requestWhenInUseAuthorization() };
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod location {
    use super::Permission;
    pub fn status() -> Permission {
        Permission::Unavailable
    }
}

/// A Privacy & Security pane by its anchor, reaped like `ax::open_settings`.
fn open_privacy_pane(anchor: &str) -> std::io::Result<()> {
    let mut child = std::process::Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{anchor}")).spawn()?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// Off the main thread: the probes (AX trust, EventKit, a file open behind
/// Full Disk Access, IOHIDCheckAccess) took ~85 ms of the startup on
/// hornet, and nothing at startup waits on the answer.
pub fn install(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let s = status();
        eprintln!("permissions\t{s:?}\t{:.1}ms since start", crate::since_start_ms());
        if !s.complete() {
            watch(&app);
        }
    });
}

/// The ask: the system prompt (adds pal to the list) and the pane with the
/// switch. Returns the state as of now, which a just-shown prompt never
/// changes; `watch` reports the grant later.
pub fn request(app: &AppHandle, which: &str) -> Result<Status, String> {
    if !cfg!(target_os = "macos") {
        // Nothing to grant and no pane to open (`open` is not a launcher here).
        eprintln!("permissions\t{which}\trequested\tnothing to grant off macOS");
        return Ok(status());
    }
    let pane = |e: std::io::Error| format!("could not open System Settings: {e}");
    match which {
        "accessibility" => {
            let trusted = pal_core::ax::request();
            if !trusted {
                pal_core::ax::open_settings().map_err(pane)?;
            }
            eprintln!("permissions\taccessibility\trequested\ttrusted={trusted}");
        }
        // The prompt when the OS still has one to show; the pane once it was answered no.
        "calendar" => {
            let s = pal_core::calendar::request(Duration::from_secs(3)).map_err(|e| e.to_string())?;
            if matches!(s, Permission::Denied | Permission::Restricted) {
                pal_core::calendar::open_settings().map_err(pane)?;
            }
            eprintln!("permissions\tcalendar\trequested\t{s:?}");
        }
        // No prompt exists for this one: the pane, with pal to be added by hand.
        "full_disk_access" => open_privacy_pane("Privacy_AllFiles").map_err(pane)?,
        "input_monitoring" => {
            #[cfg(target_os = "macos")]
            let granted = unsafe { hid::IOHIDRequestAccess(hid::LISTEN_EVENT) };
            #[cfg(not(target_os = "macos"))]
            let granted = true;
            if !granted {
                open_privacy_pane("Privacy_ListenEvent").map_err(pane)?;
            }
            eprintln!("permissions\tinput_monitoring\trequested\tgranted={granted}");
        }
        // The prompt while the OS still has one to show (asynchronous: the
        // answer reaches `watch`); the pane once it was answered no.
        "location" => {
            let s = location::status();
            match s {
                Permission::NotDetermined => {
                    #[cfg(target_os = "macos")]
                    app.run_on_main_thread(|| location::request(objc2::MainThreadMarker::new().expect("main thread"))).map_err(|e| e.to_string())?;
                }
                Permission::Denied | Permission::Restricted => open_privacy_pane("Privacy_LocationServices").map_err(pane)?,
                Permission::Granted | Permission::Unavailable => {}
            }
            eprintln!("permissions\tlocation\trequested\t{s:?}");
        }
        other => return Err(format!("unknown permission {other}")),
    }
    watch(app);
    Ok(status())
}

/// [`request`] at most once per run and permission across every caller
/// that wants it only in passing (an effect refused, the first show): the
/// prompt is a modal and a second one on the same run is noise.
pub fn request_once(app: &AppHandle, which: &str) {
    static ASKED: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let mut asked = ASKED.lock().unwrap_or_else(|e| e.into_inner());
    if asked.iter().any(|w| w == which) {
        return;
    }
    asked.push(which.to_string());
    drop(asked);
    if let Err(e) = request(app, which) {
        eprintln!("permissions\t{which}\t{e}");
    }
}

/// The panel's first show on a fresh profile (the Welcome tips still up):
/// ask, once per run, when `general.ask_permissions_on_start` says so and
/// the permission is missing. Raycast asks during its onboarding; this is
/// pal's. Spawned: the prompt is the system's window and takes key focus,
/// which hides the panel, so the show itself must not wait on it.
pub fn ask_on_first_show(app: &AppHandle) {
    if status().accessibility || !settings::config(app).general.ask_permissions_on_start || welcome::welcomed(&welcome::data_dir(app)) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || request_once(&app, "accessibility"));
}

/// Whether the user has a pal window in front of them: the panel or the
/// Settings window. The poll runs only then.
fn window_open(app: &AppHandle) -> bool {
    panel::is_visible(app) || app.get_webview_window(settings::WINDOW).is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Poll [`status`] every [`POLL`] while a window is open and something is
/// missing; one poll at a time. Every change is told to every window (and
/// an Accessibility grant re-derives the Welcome rows); stops once nothing
/// is missing or no window is open; `show_in`, `settings::open` and
/// `request` start it again. macOS has no notification for any of these
/// (an `AXObserver` watches elements, not the trust list), so polling it is.
pub fn watch(app: &AppHandle) {
    static POLLING: AtomicBool = AtomicBool::new(false);
    let mut last = status();
    if !cfg!(target_os = "macos") || last.complete() || POLLING.swap(true, Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            let s = status();
            if s != last {
                eprintln!("permissions\tchanged\t{s:?}");
                events::emit(&app, events::PERMISSIONS, s);
                if s.accessibility && !last.accessibility {
                    welcome::sync(&app);
                }
                last = s;
            }
            if s.complete() || !window_open(&app) {
                break;
            }
        }
        POLLING.store(false, Ordering::Relaxed);
    });
}

/// The bridge's `core/permissions.{status, request}` for an extension:
/// `request { which }` is [`request`] (the prompt, or the pane), answered
/// with the state as of now. An extension asks from a listing, and a
/// listing also runs at startup (every palette, for the cache) and on a
/// background refresh, so the ask is honoured only while a pal window is
/// in front of the user and skipped otherwise: the extension asks again on
/// its next listing, and the first one the user looks at is the one that
/// prompts.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let s = match func {
        "status" => status(),
        "request" => {
            let which = params["which"].as_str().ok_or("permissions.request: no which")?;
            if window_open(app) {
                request(app, which)?
            } else {
                eprintln!("permissions\t{which}\tskipped\tno pal window in front");
                status()
            }
        }
        _ => return Err(format!("unknown permissions.{func}")),
    };
    Ok(serde_json::to_value(s).unwrap())
}

#[tauri::command]
pub fn permissions_status() -> Status {
    status()
}

#[tauri::command(async)]
pub fn permissions_request(app: AppHandle, which: String) -> Result<Status, String> {
    request(&app, &which)
}

/// A System Settings pane by name, for the buttons in Settings that point
/// at one: `accessibility` (Privacy & Security), `keyboard-shortcuts`
/// (where Spotlight's binding is switched off).
#[tauri::command(async)]
pub fn open_system_settings(pane: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("no such pane off macOS".into());
    }
    match pane.as_str() {
        "accessibility" => pal_core::ax::open_settings(),
        "keyboard-shortcuts" => pal_core::spotlight::open_keyboard_shortcuts(),
        other => return Err(format!("unknown pane {other}")),
    }
    .map_err(|e| format!("could not open System Settings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_status_reads_as_a_permission() {
        #[cfg(target_os = "macos")]
        {
            use objc2_core_location::CLAuthorizationStatus as C;
            assert_eq!(location::of(C::NotDetermined), Permission::NotDetermined);
            assert_eq!(location::of(C::Restricted), Permission::Restricted);
            assert_eq!(location::of(C::Denied), Permission::Denied);
            assert_eq!(location::of(C::AuthorizedAlways), Permission::Granted);
            assert_eq!(location::of(C::AuthorizedWhenInUse), Permission::Granted);
            // Whatever a later macOS adds reads as a refusal, never as a grant.
            assert_eq!(location::of(C(99)), Permission::Denied);
        }
        #[cfg(not(target_os = "macos"))]
        assert_eq!(location::status(), Permission::Unavailable);
    }

    #[test]
    fn complete_needs_location_settled() {
        let granted = Status { accessibility: true, calendar: Permission::Granted, full_disk_access: Some(true), input_monitoring: true, location: Permission::Granted };
        assert!(granted.complete());
        assert!(!Status { location: Permission::NotDetermined, ..granted }.complete());
        assert!(!Status { location: Permission::Denied, ..granted }.complete());
        // Restricted (a profile) and unavailable (Linux) are nobody's to grant: nothing to watch for.
        assert!(Status { location: Permission::Restricted, ..granted }.complete());
        assert!(Status { location: Permission::Unavailable, ..granted }.complete());
    }
}
