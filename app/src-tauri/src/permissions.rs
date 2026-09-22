//! The OS permissions pal needs, as one place the shell asks from. macOS:
//! Accessibility (paste sends a keystroke into the app in front, window
//! switching raises another app's window, `pal action type`), Calendars
//! (the calendar extension, EventKit), Full Disk Access (the OTP palette
//! reads the Messages database), Input Monitoring (snippet expansion,
//! keycast, the app switcher's chord, the bar popover's key monitor while
//! a peek is up) and Location Services (macOS 15+ hands Wi-Fi network
//! names only to an app with it: the wifi extension). Off macOS every
//! permission is a given and `status` says so.
//!
//! **When pal asks: at the feature, never at launch.** Nothing prompts
//! on a fresh profile until the user runs something that needs a
//! permission (a paste, a window switch, keycast, expansion switched
//! on), the way Raycast and Maccy do and Apple's guidelines ask
//! ("request permission only when your app clearly needs access"). The
//! Welcome row and Settings > General > Permissions are the overview: what
//! each is for, a dot, a Grant button.
//!
//! **What an ask is: pal's word first, then the system's.** [`ask`] puts
//! a card in the panel, "Paste needs Accessibility", with what pal does
//! with the permission ([`REASONS`]) and where the switch is; Grant is
//! what runs [`request`], Cancel leaves everything as it was. The
//! passing askers (a refused paste, keycast starting) get the card once
//! per run and permission; their own toast or HUD line stands alone after
//! that. The Welcome row, Settings and an extension's row are explicit
//! (the row is the explanation) and call [`request`] directly.
//!
//! **What a request is: the prompt, or the pane, not both.** macOS lists
//! an app under Privacy & Security > Accessibility (and Input Monitoring)
//! only after the app has called the trust check with the prompt once,
//! and shows that prompt once: a later call while the app is listed and
//! off shows nothing. So the first request on this machine is the prompt
//! alone (the prompt has its own Open System Settings button), and a
//! request after that ([`prompted`], a marker under the app's data dir)
//! opens System Settings on the pane, where the switch is; a marker gone
//! stale (a rebuild under a new signature) costs one extra prompt.
//! Calendars and Location prompt once and say so (`not_determined`); Full
//! Disk Access has no prompt at all (the pane is the only way).
//!
//! Nothing polls the OS for a change; a grant is seen by [`watch`], which
//! checks every [`POLL`] while a window is open and something was missing,
//! and emits [`events::PERMISSIONS`] on a change (the Welcome row goes,
//! Settings turns the dot green, an Input Monitoring grant re-applies the
//! hotkeys for the switcher's `cmd+tab` tap). An extension asks over
//! `core/permissions.request` only from a listing the user is looking at
//! ([`call`], [`attended`]).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use pal_core::permission::Status as Permission;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{events, panel, settings, welcome};

const POLL: Duration = Duration::from_secs(2);

/// What pal does with a permission, in the words the card and the
/// toasts use: the ids the SDK's `PermissionId` spells.
pub struct Reason {
    pub id: &'static str,
    /// The pane's name, as System Settings spells it.
    pub title: &'static str,
    /// What pal uses it for, one or two sentences to the user.
    pub uses: &'static str,
    /// The switch: the pane under System Settings > Privacy & Security.
    pub pane: &'static str,
}

pub const REASONS: [Reason; 5] = [
    Reason { id: "accessibility", title: "Accessibility", uses: "pal uses it to paste into the app in front (a \u{2318}V keystroke), to raise, arrange and close other apps\u{2019} windows, and to read the selected text.", pane: "Accessibility" },
    Reason { id: "input_monitoring", title: "Input Monitoring", uses: "pal uses it to see the keys typed in other apps: a snippet keyword, the keys keycast draws, the app switcher\u{2019}s chord, the key that closes a bar peek. The keys are read for those and nothing else.", pane: "Input Monitoring" },
    Reason { id: "calendar", title: "Calendars", uses: "pal lists your upcoming events and can add or remove one from the panel.", pane: "Calendars" },
    Reason { id: "full_disk_access", title: "Full Disk Access", uses: "pal reads the Messages database for verification codes, and Safari\u{2019}s bookmarks. macOS has no prompt for this one: add pal in the pane by hand.", pane: "Full Disk Access" },
    Reason { id: "location", title: "Location", uses: "macOS shows Wi-Fi network names only to an app with Location access. pal reads the names and nothing about where you are.", pane: "Location Services" },
];

pub fn reason(which: &str) -> Option<&'static Reason> {
    REASONS.iter().find(|r| r.id == which)
}

/// Where the switch is, for a toast or a HUD line: "System Settings >
/// Privacy & Security > Accessibility".
pub fn switch(which: &str) -> String {
    format!("System Settings > Privacy & Security > {}", reason(which).map_or(which, |r| r.pane))
}

/// The card for `feature` needing `which`: the title names the feature,
/// the message what pal does with the permission and what happens on
/// Grant (the system prompt when the OS still has one to show, else the
/// pane). `prompts`: [`prompts`], passed in so the text is testable.
pub fn card(which: &str, feature: &str, prompts: bool) -> (String, String) {
    let r = reason(which);
    let title = format!("{feature} needs {}", r.map_or(which, |r| r.title));
    let next = if prompts { "macOS asks next; the switch is under" } else { "System Settings opens on the switch, under" };
    let message = format!("{}\n\n{next} Privacy & Security > {}.", r.map_or("", |r| r.uses), r.map_or(which, |r| r.pane));
    (title, message)
}

/// The marker for the prompts already shown on this machine: one
/// permission id per line under the app's data dir (not the profile's:
/// the OS keys its list by the app, and every profile is the one app).
fn prompted_file() -> std::path::PathBuf {
    pal_core::fs::data_dir().join("prompted")
}

fn prompted(which: &str) -> bool {
    prompted_in(&prompted_file(), which)
}

fn prompted_in(f: &std::path::Path, which: &str) -> bool {
    std::fs::read_to_string(f).is_ok_and(|s| s.lines().any(|l| l == which))
}

fn note_prompted(which: &str) {
    let f = prompted_file();
    if let Err(e) = note_prompted_in(&f, which) {
        eprintln!("permissions\t{which}\tcould not note the prompt in {}: {e}", f.display());
    }
}

fn note_prompted_in(f: &std::path::Path, which: &str) -> std::io::Result<()> {
    if prompted_in(f, which) {
        return Ok(());
    }
    if let Some(dir) = f.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut s = std::fs::read_to_string(f).unwrap_or_default();
    s.push_str(which);
    s.push('\n');
    std::fs::write(f, s)
}

/// Whether a request for `which` shows a system prompt (as against
/// opening the pane): Accessibility and Input Monitoring until pal has
/// prompted once on this machine, Calendars and Location while the OS
/// says `not_determined`, Full Disk Access never.
pub fn prompts(which: &str) -> bool {
    match which {
        "accessibility" | "input_monitoring" => !prompted(which),
        "calendar" => pal_core::calendar::permission() == Permission::NotDetermined,
        "location" => location::status() == Permission::NotDetermined,
        _ => false,
    }
}

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
        // The prompt (which lists pal) the first time; the pane once the
        // OS has shown it, since it shows it once. The prompt call is made
        // either way: nothing when pal is listed, and the real prompt again
        // after a rebuild under a new signature dropped pal from the list.
        "accessibility" => {
            let again = !prompts(which);
            let trusted = pal_core::ax::request();
            if !trusted && again {
                pal_core::ax::open_settings().map_err(pane)?;
            }
            note_prompted(which);
            eprintln!("permissions\taccessibility\trequested\ttrusted={trusted} pane={}", !trusted && again);
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
            let again = !prompts(which);
            #[cfg(target_os = "macos")]
            let granted = unsafe { hid::IOHIDRequestAccess(hid::LISTEN_EVENT) };
            #[cfg(not(target_os = "macos"))]
            let granted = true;
            if !granted && again {
                open_privacy_pane("Privacy_ListenEvent").map_err(pane)?;
            }
            note_prompted(which);
            eprintln!("permissions\tinput_monitoring\trequested\tgranted={granted} pane={}", !granted && again);
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

/// The panel's page is up: a card can be shown. Set from the page load
/// (lib.rs); an ask before it (a startup `hotkey::apply` for a `cmd+tab`
/// switcher, `expansion::install`) is skipped and logged, and the Settings
/// Overview lists what is missing.
static READY: AtomicBool = AtomicBool::new(false);

pub fn page_ready() {
    READY.store(true, Ordering::Relaxed);
}

/// The ask for a `feature` that came across a missing `which` in passing
/// (a refused paste, a window switch that could only activate, keycast
/// starting, expansion switched on): the card in the panel, once per run
/// and permission, and [`request`] on Grant. Returns whether the card
/// went up this time; when not (asked already this run, the page not up
/// yet, nothing to grant off macOS) the caller's own toast or HUD line is
/// what the user sees. The answer is not waited for: after a grant the
/// user redoes the action, and `watch` reports the grant to the windows.
pub fn ask(app: &AppHandle, which: &str, feature: &str) -> bool {
    static ASKED: Mutex<Vec<String>> = Mutex::new(Vec::new());
    if !cfg!(target_os = "macos") {
        return false;
    }
    if !READY.load(Ordering::Relaxed) {
        eprintln!("permissions\t{which}\task for {feature} skipped\tthe panel is not up yet");
        return false;
    }
    let mut asked = ASKED.lock().unwrap_or_else(|e| e.into_inner());
    if asked.iter().any(|w| w == which) {
        return false;
    }
    asked.push(which.to_string());
    drop(asked);
    let (title, message) = card(which, feature, prompts(which));
    eprintln!("permissions\t{which}\tasked for {feature}");
    let (app, which) = (app.clone(), which.to_string());
    tauri::async_runtime::spawn(async move {
        let yes = crate::confirm::ask(&app, &title, &message, "Grant").await;
        eprintln!("permissions\t{which}\tcard\t{}", match yes { Some(true) => "granted", Some(false) => "cancelled", None => "no answer" });
        if yes == Some(true) {
            let handle = app.clone();
            let r = tauri::async_runtime::spawn_blocking(move || request(&handle, &which)).await;
            if let Ok(Err(e)) = r {
                crate::hud::show(&app, &e);
            }
        }
    });
    true
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
                // The switcher's tap for a Dock-owned chord waits on this one (hotkey.rs).
                if s.input_monitoring && !last.input_monitoring {
                    let (config, handle) = (settings::config(&app), app.clone());
                    tauri::async_runtime::spawn_blocking(move || crate::hotkey::apply(&handle, &config));
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

/// Whether the user is looking at `extension`: the panel is up inside one
/// of its palettes (`index::showing`), or a pick of its is being answered
/// (`index::picking`: Enter on its row). Without a caller (an older SDK)
/// any pal window in front counts, as it used to.
fn attended(app: &AppHandle, extension: Option<&str>) -> Result<(), String> {
    let Some(ext) = extension else {
        return if window_open(app) { Ok(()) } else { Err("no pal window in front".into()) };
    };
    if crate::index::picking(ext) {
        return Ok(());
    }
    if !panel::is_visible(app) {
        return Err("the panel is down".into());
    }
    match crate::index::showing() {
        Some(s) if s.extension == ext => Ok(()),
        Some(s) => Err(format!("the panel is inside {}/{}", s.extension, s.palette)),
        None => Err("the panel is at the root".into()),
    }
}

/// The bridge's `core/permissions.{status, request}` for an extension:
/// `request { which, extension? }` is [`request`] (the prompt, or the
/// pane), answered with the state as of now. An extension asks from a
/// listing, and a listing also runs at startup (every palette, for the
/// cache), on every show (a live palette) and on a background refresh, so
/// the ask is honoured only while the user is looking at that extension
/// ([`attended`]) and skipped otherwise: the extension asks again on its
/// next listing, and the one the user is inside of is the one that
/// prompts. A pick's ask (Enter on the row that offered it) always is.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let s = match func {
        "status" => status(),
        "request" => {
            let which = params["which"].as_str().ok_or("permissions.request: no which")?;
            match attended(app, params["extension"].as_str()) {
                Ok(()) => request(app, which)?,
                Err(why) => {
                    eprintln!("permissions\t{which}\tskipped\t{why}");
                    status()
                }
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
    fn every_permission_id_has_a_reason_and_a_pane() {
        for id in ["accessibility", "calendar", "full_disk_access", "input_monitoring", "location"] {
            let r = reason(id).unwrap_or_else(|| panic!("{id} has no reason"));
            assert!(r.uses.starts_with("pal ") || r.uses.starts_with("macOS "), "{id}: the reason says who does what");
            assert!(switch(id).ends_with(r.pane), "{id}: the switch names the pane");
        }
        assert!(reason("screen_recording").is_none());
        assert_eq!(switch("screen_recording"), "System Settings > Privacy & Security > screen_recording", "an unknown id falls back to itself");
    }

    #[test]
    fn card_names_the_feature_the_reason_and_what_grant_does() {
        let (title, message) = card("accessibility", "Paste", true);
        assert_eq!(title, "Paste needs Accessibility");
        assert!(message.starts_with("pal uses it to paste into the app in front"), "{message}");
        assert!(message.ends_with("macOS asks next; the switch is under Privacy & Security > Accessibility."), "{message}");
        let (_, message) = card("input_monitoring", "Keycast", false);
        assert!(message.ends_with("System Settings opens on the switch, under Privacy & Security > Input Monitoring."), "{message}");
        let (title, message) = card("full_disk_access", "Verification codes", false);
        assert_eq!(title, "Verification codes needs Full Disk Access");
        assert!(message.contains("add pal in the pane by hand"), "{message}");
    }

    #[test]
    fn the_prompted_marker_lists_each_permission_once() {
        let dir = std::env::temp_dir().join(format!("pal-prompted-{}", std::process::id()));
        let f = dir.join("prompted");
        assert!(!prompted_in(&f, "accessibility"), "no file, never prompted");
        note_prompted_in(&f, "accessibility").unwrap();
        note_prompted_in(&f, "accessibility").unwrap();
        note_prompted_in(&f, "input_monitoring").unwrap();
        assert!(prompted_in(&f, "accessibility"));
        assert!(prompted_in(&f, "input_monitoring"));
        assert!(!prompted_in(&f, "calendar"));
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "accessibility\ninput_monitoring\n", "one line each, no repeat");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn full_disk_access_never_prompts() {
        assert!(!prompts("full_disk_access"));
        assert!(!prompts("screen_recording"), "an unknown id opens nothing");
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
