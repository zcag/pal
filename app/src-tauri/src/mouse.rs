//! Mouse & Trackpad: a three-finger tap or click on a trackpad is a middle
//! click, and scrolling is reversed for the trackpad, the mouse or both, each
//! axis on its own (what MiddleClick and Scroll Reverser do). The settings are
//! the `mouse` extension's (`extensions/mouse/pal.json`); the extension's rows
//! flip them and read [`call`]'s `status`.
//!
//! Two sources, both started while any of it is on:
//!
//! - **The fingers**: MultitouchSupport, the private framework every
//!   finger-counting tool reads (loaded with `dlopen`, so a macOS without it
//!   costs the middle click, never the launch). One contact-frame callback
//!   per device, on the framework's own thread, feeds [`Touches`]: how many
//!   fingers are down on each device and, per touch session, whether it was a
//!   tap ([`Session`]: three fingers and never a fourth, down and up under
//!   [`TAP_MAX`], the centroid moved under [`TAP_MOVE`], no physical click).
//!   A tap posts a middle down and up at the cursor. Devices come and go (a
//!   Magic Trackpad paired later) and a sleep stops their callbacks, so a
//!   supervisor re-lists them every [`RESCAN`], and starts them again when
//!   the count changed or the clock jumped (a wake).
//! - **The events**: an active `CGEventTap` on a thread of its own with its
//!   own run loop, so a busy main thread never stalls the pointer. A left
//!   down while three fingers rest on a device becomes a middle down, its
//!   drags and its up follow; a scroll has its three delta pairs negated on
//!   the axes the settings reverse for its source. The source ([`Source`]):
//!   a wheel's notches (not continuous) are the mouse; a continuous scroll is
//!   the trackpad when two fingers or more are down on a device as it
//!   begins (a Magic Mouse scrolls under one), and its momentum keeps the
//!   source of the scroll it follows.
//!
//! The tap needs Accessibility: turning a feature on asks when it is missing
//! (the card, then the prompt) and starts on the grant, polling for it every
//! [`POLL`] while on. Linux: no portable tap (Wayland hands input to the
//! focused client only); `status` says so.

// Off macOS nothing is tapped; the settings and the pure parts still compile and their tests run.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use pal_core::config::{spec_defaults, Config};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{lock, permissions, settings};

const MANIFEST: &str = include_str!("../../../extensions/mouse/pal.json");
pub const SUPPORTED: bool = cfg!(target_os = "macos");
const UNAVAILABLE: &str = "Not available on Linux: there is no portable input tap (Wayland hands input to the focused app only)";

/// A tap is three fingers down and up within this long...
const TAP_MAX: f64 = 0.3;
/// ...their centroid moving less than this (the trackpad is 1 across).
const TAP_MOVE: f32 = 0.05;
/// How often the setting, on without Accessibility, looks for the grant.
const POLL: Duration = Duration::from_secs(2);
/// How often the devices are listed again.
const RESCAN: Duration = Duration::from_secs(3);

/// `[extensions.mouse]`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub middle_click: bool,
    pub middle_click_tap: bool,
    pub reverse_trackpad: bool,
    pub reverse_mouse: bool,
    pub reverse_vertical: bool,
    pub reverse_horizontal: bool,
}

impl Settings {
    fn from(config: &Config) -> Settings {
        let manifest: Value = serde_json::from_str(MANIFEST).expect("bundled pal.json parses");
        let defaults = spec_defaults(&manifest["settings"]);
        let table = config.extension_settings("mouse", &defaults, &manifest["settings"]);
        table.try_into().unwrap_or_else(|e| {
            eprintln!("mouse\tbad settings\t{e}; off");
            Settings::default()
        })
    }

    /// Whether anything needs the tap.
    fn any(self) -> bool {
        self.middle_click || self.reverse_trackpad || self.reverse_mouse
    }

    /// The axes to negate for a scroll from `source`: (vertical, horizontal).
    fn reverse(self, source: Source) -> (bool, bool) {
        let on = match source {
            Source::Trackpad => self.reverse_trackpad,
            Source::Mouse => self.reverse_mouse,
        };
        (on && self.reverse_vertical, on && self.reverse_horizontal)
    }
}

/// Where a scroll comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Trackpad,
    Mouse,
}

/// The source of a scroll event: `continuous` (pixels, not a wheel's
/// notches), `phased` (a trackpad-style Began/Changed/Ended, not momentum),
/// `fingers` the most down on any device (None when the fingers are not
/// read), `last` the source of the scroll before it (what momentum keeps).
pub fn source(continuous: bool, phased: bool, momentum: bool, fingers: Option<usize>, last: Source) -> Source {
    if !continuous {
        return Source::Mouse;
    }
    if momentum && !phased {
        return last;
    }
    match fingers {
        Some(n) if n < 2 => Source::Mouse,
        _ => Source::Trackpad,
    }
}

/// One device's touch session, from the first finger down to the last up.
#[derive(Debug, Clone, Copy)]
struct Session {
    start: f64,
    max: usize,
    /// The centroid when the third finger landed.
    origin: Option<(f32, f32)>,
    moved: bool,
    clicked: bool,
}

/// The fingers on every device, fed by contact frames: the counts the tap
/// reads and whether a session that just ended was a three-finger tap.
#[derive(Debug, Default)]
pub struct Touches {
    down: HashMap<usize, usize>,
    sessions: HashMap<usize, Session>,
}

impl Touches {
    /// One frame of `device` at `time` (seconds) with its fingers'
    /// normalised positions. True when it ends a three-finger tap.
    pub fn frame(&mut self, device: usize, time: f64, fingers: &[(f32, f32)]) -> bool {
        let n = fingers.len();
        self.down.insert(device, n);
        if n == 0 {
            let Some(s) = self.sessions.remove(&device) else { return false };
            return s.max == 3 && !s.moved && !s.clicked && time - s.start <= TAP_MAX;
        }
        let s = self.sessions.entry(device).or_insert(Session { start: time, max: 0, origin: None, moved: false, clicked: false });
        s.max = s.max.max(n);
        if n == 3 {
            let c = centroid(fingers);
            match s.origin {
                None => s.origin = Some(c),
                Some(o) if (c.0 - o.0).hypot(c.1 - o.1) > TAP_MOVE => s.moved = true,
                _ => {}
            }
        }
        false
    }

    /// The most fingers down on any device now.
    pub fn most(&self) -> usize {
        self.down.values().copied().max().unwrap_or(0)
    }

    /// A physical click happened: the sessions under way are not taps.
    pub fn clicked(&mut self) {
        for s in self.sessions.values_mut() {
            s.clicked = true;
        }
    }

    /// Forget every device's fingers (they stopped).
    pub fn clear(&mut self) {
        self.down.clear();
        self.sessions.clear();
    }
}

fn centroid(f: &[(f32, f32)]) -> (f32, f32) {
    let n = f.len() as f32;
    let (x, y) = f.iter().fold((0.0, 0.0), |(a, b), (x, y)| (a + x, b + y));
    (x / n, y / n)
}

static SETTINGS: Mutex<Settings> = Mutex::new(Settings { middle_click: false, middle_click_tap: false, reverse_trackpad: false, reverse_mouse: false, reverse_vertical: false, reverse_horizontal: false });
static TOUCHES: Mutex<Option<Touches>> = Mutex::new(None);
/// On: some feature wants the tap. The grant poll checks it.
static ON: AtomicBool = AtomicBool::new(false);

fn current() -> Settings {
    *lock(&SETTINGS)
}

fn touches<R>(f: impl FnOnce(&mut Touches) -> R) -> R {
    f(lock(&TOUCHES).get_or_insert_with(Touches::default))
}

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
    *lock(&SETTINGS) = s;
    if !SUPPORTED {
        return;
    }
    let was = ON.swap(s.any(), Ordering::Relaxed);
    eprintln!("mouse\tsettings\t{s:?}");
    if !s.any() {
        if was {
            stop();
        }
        return;
    }
    if was {
        return;
    }
    if pal_core::ax::trusted() {
        start();
    } else {
        permissions::ask(app, "accessibility", "Mouse & Trackpad");
        std::thread::spawn(|| {
            while ON.load(Ordering::Relaxed) && !pal_core::ax::trusted() {
                std::thread::sleep(POLL);
            }
            if ON.load(Ordering::Relaxed) {
                eprintln!("mouse\taccessibility granted");
                start();
            }
        });
    }
}

fn start() {
    #[cfg(target_os = "macos")]
    {
        tap::start();
        touch::start();
    }
}

fn stop() {
    #[cfg(target_os = "macos")]
    {
        tap::stop();
        touch::stop();
    }
    eprintln!("mouse\toff");
}

/// `core/mouse.status`: whether it can run here, the grant, whether the tap
/// is in and how many touch devices are read, and the settings.
pub fn call(_app: &AppHandle, func: &str, _params: Value) -> Result<Value, String> {
    match func {
        "status" => {
            #[cfg(target_os = "macos")]
            let (running, devices) = (tap::running(), touch::devices());
            #[cfg(not(target_os = "macos"))]
            let (running, devices) = (false, 0usize);
            Ok(json!({
                "available": SUPPORTED,
                "reason": (!SUPPORTED).then_some(UNAVAILABLE),
                "accessibility": pal_core::ax::trusted(),
                "running": running,
                "devices": devices,
                "settings": current(),
            }))
        }
        _ => Err(format!("unknown mouse function {func}")),
    }
}

/// The event tap: middle click from a three-finger click, reversed scrolls.
#[cfg(target_os = "macos")]
mod tap {
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    use objc2_core_foundation::{kCFRunLoopCommonModes, CFMachPort, CFRetained, CFRunLoop};
    use objc2_core_graphics::{CGEvent, CGEventField, CGEventMask, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy, CGEventType, CGMouseButton};

    use super::{current, source, touches, Source};
    use crate::lock;

    /// Stamped on the clicks pal posts (`EventSourceUserData`), so the tap lets its own through.
    pub const TAG: i64 = 0x70616d;

    /// The tap's thread's run loop and the tap, for `stop` (CFRunLoopStop is thread-safe).
    struct Running(CFRetained<CFRunLoop>, CFRetained<CFMachPort>);
    // SAFETY: only `stop` and `tap_enable` are called across threads, both documented thread-safe.
    unsafe impl Send for Running {}
    static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
    /// A left down became a middle one: its drags and its up follow.
    static MIDDLE: AtomicBool = AtomicBool::new(false);
    /// The source of the scroll under way, for its momentum.
    static LAST: Mutex<Source> = Mutex::new(Source::Trackpad);

    pub fn running() -> bool {
        lock(&RUNNING).is_some()
    }

    fn middle(e: &CGEvent, ty: CGEventType) {
        CGEvent::set_type(Some(e), ty);
        CGEvent::set_integer_value_field(Some(e), CGEventField::MouseEventButtonNumber, CGMouseButton::Center.0 as i64);
    }

    fn scroll(e: &CGEvent) {
        let int = |f| CGEvent::integer_value_field(Some(e), f);
        let continuous = int(CGEventField::ScrollWheelEventIsContinuous) != 0;
        let phased = int(CGEventField::ScrollWheelEventScrollPhase) != 0;
        let momentum = int(CGEventField::ScrollWheelEventMomentumPhase) != 0;
        let fingers = super::touch::reading().then(|| touches(|t| t.most()));
        let mut last = lock(&LAST);
        let src = source(continuous, phased, momentum, fingers, *last);
        *last = src;
        drop(last);
        let (v, h) = current().reverse(src);
        let axes = [(v, CGEventField::ScrollWheelEventDeltaAxis1, CGEventField::ScrollWheelEventFixedPtDeltaAxis1, CGEventField::ScrollWheelEventPointDeltaAxis1), (h, CGEventField::ScrollWheelEventDeltaAxis2, CGEventField::ScrollWheelEventFixedPtDeltaAxis2, CGEventField::ScrollWheelEventPointDeltaAxis2)];
        for (on, delta, fixed, point) in axes {
            if !on {
                continue;
            }
            // Read all three before writing any: setting one field can recompute the others.
            let (d, f, p) = (int(delta), CGEvent::double_value_field(Some(e), fixed), int(point));
            CGEvent::set_integer_value_field(Some(e), delta, -d);
            CGEvent::set_double_value_field(Some(e), fixed, -f);
            CGEvent::set_integer_value_field(Some(e), point, -p);
        }
    }

    unsafe extern "C-unwind" fn callback(_proxy: CGEventTapProxy, ty: CGEventType, event: NonNull<CGEvent>, _info: *mut c_void) -> *mut CGEvent {
        if ty == CGEventType::TapDisabledByTimeout || ty == CGEventType::TapDisabledByUserInput {
            if let Some(r) = &*lock(&RUNNING) {
                CGEvent::tap_enable(&r.1, true);
            }
            eprintln!("mouse\ttap\tre-enabled after {ty:?}");
            return event.as_ptr();
        }
        // SAFETY: the system hands a live event to the tap's callback.
        let e = unsafe { event.as_ref() };
        if CGEvent::integer_value_field(Some(e), CGEventField::EventSourceUserData) == TAG {
            return event.as_ptr();
        }
        match ty {
            CGEventType::ScrollWheel => scroll(e),
            CGEventType::LeftMouseDown => {
                let three = current().middle_click && super::touch::reading() && touches(|t| {
                    let three = t.most() == 3;
                    t.clicked();
                    three
                });
                MIDDLE.store(three, Ordering::Relaxed);
                if three {
                    middle(e, CGEventType::OtherMouseDown);
                }
            }
            CGEventType::LeftMouseDragged if MIDDLE.load(Ordering::Relaxed) => middle(e, CGEventType::OtherMouseDragged),
            CGEventType::LeftMouseUp if MIDDLE.swap(false, Ordering::Relaxed) => middle(e, CGEventType::OtherMouseUp),
            _ => {}
        }
        event.as_ptr()
    }

    pub fn start() {
        if running() {
            return;
        }
        std::thread::Builder::new()
            .name("mouse-tap".into())
            .spawn(|| {
                let mask: CGEventMask = [CGEventType::ScrollWheel, CGEventType::LeftMouseDown, CGEventType::LeftMouseUp, CGEventType::LeftMouseDragged].iter().fold(0, |m, t| m | (1 << t.0));
                // SAFETY: the callback has the signature the tap expects and reads nothing from `user_info`.
                let Some(port) = (unsafe { CGEvent::tap_create(CGEventTapLocation::SessionEventTap, CGEventTapPlacement::HeadInsertEventTap, CGEventTapOptions::Default, mask, Some(callback), std::ptr::null_mut()) }) else {
                    return eprintln!("mouse\ttap\trefused (Accessibility?)");
                };
                let (Some(source), Some(rl)) = (CFMachPort::new_run_loop_source(None, Some(&port), 0), CFRunLoop::current()) else {
                    return eprintln!("mouse\ttap\tno run loop source");
                };
                // SAFETY: a CoreFoundation constant, read only.
                rl.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
                CGEvent::tap_enable(&port, true);
                *lock(&RUNNING) = Some(Running(rl, port));
                eprintln!("mouse\ttap\tinstalled");
                CFRunLoop::run();
                eprintln!("mouse\ttap\tremoved");
            })
            .expect("spawn the mouse tap thread");
    }

    pub fn stop() {
        if let Some(Running(rl, port)) = lock(&RUNNING).take() {
            CGEvent::tap_enable(&port, false);
            port.invalidate();
            rl.stop();
        }
        MIDDLE.store(false, Ordering::Relaxed);
    }

    /// A middle click at the cursor, for a tap.
    pub fn click() {
        let Some(here) = CGEvent::new(None) else { return };
        let at = CGEvent::location(Some(&here));
        for ty in [CGEventType::OtherMouseDown, CGEventType::OtherMouseUp] {
            let Some(e) = CGEvent::new_mouse_event(None, ty, at, CGMouseButton::Center) else { return };
            CGEvent::set_integer_value_field(Some(&e), CGEventField::MouseEventClickState, 1);
            CGEvent::set_integer_value_field(Some(&e), CGEventField::EventSourceUserData, TAG);
            CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&e));
        }
    }
}

/// The fingers, over MultitouchSupport (private, so loaded by hand).
#[cfg(target_os = "macos")]
mod touch {
    use std::ffi::{c_int, c_void, CStr};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use super::{current, touches, RESCAN};
    use crate::lock;

    /// `MTTouch` as the framework lays it out (96 bytes; MiddleClick's and
    /// every other reader's struct): only the normalised position is read.
    #[repr(C)]
    struct Finger {
        frame: c_int,
        timestamp: f64,
        identifier: c_int,
        state: c_int,
        finger_id: c_int,
        hand_id: c_int,
        pos: [f32; 2],
        vel: [f32; 2],
        size: f32,
        zero1: c_int,
        angle: f32,
        major: f32,
        minor: f32,
        mm: [f32; 4],
        zero2: [c_int; 2],
        density: f32,
    }
    const _: () = assert!(std::mem::size_of::<Finger>() == 96);

    type Device = *mut c_void;
    type Callback = unsafe extern "C" fn(Device, *const Finger, c_int, f64, c_int) -> c_int;

    type CreateList = unsafe extern "C" fn() -> *const c_void;
    type Register = unsafe extern "C" fn(Device, Callback);
    type Start = unsafe extern "C" fn(Device, c_int);
    type Stop = unsafe extern "C" fn(Device);

    /// The framework's functions, looked up once.
    struct Api {
        create_list: CreateList,
        register: Register,
        unregister: Register,
        start: Start,
        stop: Stop,
    }

    extern "C" {
        fn CFArrayGetCount(a: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(a: *const c_void, i: isize) -> *const c_void;
        fn CFRelease(o: *const c_void);
    }

    fn api() -> Option<&'static Api> {
        static API: OnceLock<Option<Api>> = OnceLock::new();
        API.get_or_init(|| unsafe {
            let path = c"/System/Library/PrivateFrameworks/MultitouchSupport.framework/MultitouchSupport";
            let lib = libc::dlopen(path.as_ptr(), libc::RTLD_LAZY);
            if lib.is_null() {
                eprintln!("mouse\tmultitouch\tnot loaded");
                return None;
            }
            let sym = |name: &CStr| {
                let p = libc::dlsym(lib, name.as_ptr());
                (!p.is_null()).then_some(p)
            };
            Some(Api {
                create_list: std::mem::transmute::<*mut c_void, CreateList>(sym(c"MTDeviceCreateList")?),
                register: std::mem::transmute::<*mut c_void, Register>(sym(c"MTRegisterContactFrameCallback")?),
                unregister: std::mem::transmute::<*mut c_void, Register>(sym(c"MTUnregisterContactFrameCallback")?),
                start: std::mem::transmute::<*mut c_void, Start>(sym(c"MTDeviceStart")?),
                stop: std::mem::transmute::<*mut c_void, Stop>(sym(c"MTDeviceStop")?),
            })
        })
        .as_ref()
    }

    /// The device list (a CFArray the devices live in) while they are read.
    struct List(*const c_void);
    // SAFETY: the array is only touched under the mutex.
    unsafe impl Send for List {}
    static LIST: Mutex<Option<List>> = Mutex::new(None);
    static DEVICES: AtomicUsize = AtomicUsize::new(0);
    /// The supervisor runs while this is on.
    static WATCHING: AtomicBool = AtomicBool::new(false);

    /// Whether finger counts are coming in.
    pub fn reading() -> bool {
        DEVICES.load(Ordering::Relaxed) > 0
    }

    pub fn devices() -> usize {
        DEVICES.load(Ordering::Relaxed)
    }

    unsafe extern "C" fn frame(device: Device, data: *const Finger, n: c_int, time: f64, _frame: c_int) -> c_int {
        let fingers: Vec<(f32, f32)> = if data.is_null() || n <= 0 {
            Vec::new()
        } else {
            // SAFETY: the framework hands `n` touches at `data`.
            unsafe { std::slice::from_raw_parts(data, n as usize) }.iter().map(|f| (f.pos[0], f.pos[1])).collect()
        };
        let tap = touches(|t| t.frame(device as usize, time, &fingers));
        let s = current();
        if tap && s.middle_click && s.middle_click_tap {
            super::tap::click();
        }
        0
    }

    fn each(list: *const c_void, f: impl Fn(Device)) {
        // SAFETY: `list` is the framework's CFArray of devices, alive while held.
        let n = unsafe { CFArrayGetCount(list) };
        for i in 0..n {
            f(unsafe { CFArrayGetValueAtIndex(list, i) } as Device);
        }
    }

    fn count(api: &Api) -> usize {
        // SAFETY: a fresh list, released after counting.
        unsafe {
            let list = (api.create_list)();
            if list.is_null() {
                return 0;
            }
            let n = CFArrayGetCount(list) as usize;
            CFRelease(list);
            n
        }
    }

    /// Read every device now there (the ones read before stopped first).
    fn open(api: &Api) {
        close(api);
        // SAFETY: the framework's own calls on its own devices; the list keeps them alive.
        let list = unsafe { (api.create_list)() };
        if list.is_null() {
            return;
        }
        each(list, |d| unsafe {
            (api.register)(d, frame);
            (api.start)(d, 0);
        });
        let n = unsafe { CFArrayGetCount(list) } as usize;
        DEVICES.store(n, Ordering::Relaxed);
        *lock(&LIST) = Some(List(list));
        eprintln!("mouse\tmultitouch\t{n} device(s)");
    }

    fn close(api: &Api) {
        if let Some(List(list)) = lock(&LIST).take() {
            each(list, |d| unsafe {
                (api.unregister)(d, frame);
                (api.stop)(d);
            });
            // SAFETY: the list was created by `open` and is released once.
            unsafe { CFRelease(list) };
        }
        DEVICES.store(0, Ordering::Relaxed);
        touches(|t| t.clear());
    }

    pub fn start() {
        let Some(api) = api() else { return };
        if WATCHING.swap(true, Ordering::Relaxed) {
            return;
        }
        open(api);
        std::thread::spawn(move || {
            let mut last = Instant::now();
            while WATCHING.load(Ordering::Relaxed) {
                std::thread::sleep(RESCAN);
                if !WATCHING.load(Ordering::Relaxed) {
                    break;
                }
                // A wake: the clock ran on while the thread slept far past its beat.
                let woke = last.elapsed() > RESCAN * 3 + Duration::from_secs(2);
                last = Instant::now();
                if woke || count(api) != DEVICES.load(Ordering::Relaxed) {
                    eprintln!("mouse\tmultitouch\trescan ({})", if woke { "wake" } else { "devices changed" });
                    open(api);
                }
            }
        });
    }

    pub fn stop() {
        WATCHING.store(false, Ordering::Relaxed);
        if let Some(api) = api() {
            close(api);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: usize = 1;
    const B: usize = 2;
    fn three(x: f32) -> Vec<(f32, f32)> {
        vec![(x, 0.5), (x + 0.1, 0.5), (x + 0.2, 0.5)]
    }

    #[test]
    fn three_fingers_down_and_up_in_time_is_a_tap() {
        let mut t = Touches::default();
        assert!(!t.frame(A, 0.0, &[(0.4, 0.5)]));
        assert!(!t.frame(A, 0.02, &three(0.4)));
        assert_eq!(t.most(), 3);
        assert!(!t.frame(A, 0.1, &three(0.41)));
        assert!(!t.frame(A, 0.15, &[(0.4, 0.5)]), "fingers lifting one by one");
        assert!(t.frame(A, 0.18, &[]));
        assert_eq!(t.most(), 0);
    }

    #[test]
    fn what_is_not_a_tap() {
        let tap = |frames: &[(f64, Vec<(f32, f32)>)], click: bool| {
            let mut t = Touches::default();
            let mut fired = false;
            for (i, (at, f)) in frames.iter().enumerate() {
                if click && i == 1 {
                    t.clicked();
                }
                fired |= t.frame(A, *at, f);
            }
            fired
        };
        assert!(!tap(&[(0.0, three(0.4)), (0.5, vec![])], false), "held too long");
        assert!(!tap(&[(0.0, three(0.4)), (0.1, three(0.6)), (0.2, vec![])], false), "a swipe");
        assert!(!tap(&[(0.0, three(0.4)), (0.05, [three(0.4), vec![(0.9, 0.9)]].concat()), (0.1, vec![])], false), "four fingers");
        assert!(!tap(&[(0.0, vec![(0.4, 0.5), (0.5, 0.5)]), (0.1, vec![])], false), "two fingers");
        assert!(!tap(&[(0.0, three(0.4)), (0.1, three(0.4)), (0.2, vec![])], true), "a physical click");
    }

    #[test]
    fn devices_are_apart() {
        let mut t = Touches::default();
        t.frame(A, 0.0, &three(0.4));
        t.frame(B, 0.0, &[(0.5, 0.5)]);
        assert_eq!(t.most(), 3);
        assert!(!t.frame(B, 0.1, &[]), "the other device's lift is not A's tap");
        assert!(t.frame(A, 0.1, &[]));
    }

    #[test]
    fn a_scroll_is_the_trackpads_or_the_mouses() {
        use Source::*;
        assert_eq!(source(false, false, false, Some(2), Trackpad), Mouse, "a wheel's notches");
        assert_eq!(source(true, true, false, Some(2), Mouse), Trackpad);
        assert_eq!(source(true, true, false, Some(1), Trackpad), Mouse, "a Magic Mouse scrolls under one finger");
        assert_eq!(source(true, false, true, Some(0), Trackpad), Trackpad, "momentum keeps the scroll's source");
        assert_eq!(source(true, false, true, Some(0), Mouse), Mouse);
        assert_eq!(source(true, true, false, None, Mouse), Trackpad, "fingers unread: continuous is the trackpad");
    }

    #[test]
    fn the_axes_reversed_for_each_source() {
        let s = Settings { reverse_mouse: true, reverse_vertical: true, reverse_horizontal: false, ..Settings::default() };
        assert_eq!(s.reverse(Source::Mouse), (true, false));
        assert_eq!(s.reverse(Source::Trackpad), (false, false));
        assert!(s.any());
        assert!(!Settings { reverse_vertical: true, ..Settings::default() }.any(), "the axes alone reverse nothing");
    }

    #[test]
    fn the_manifest_defaults_read() {
        let manifest: Value = serde_json::from_str(MANIFEST).unwrap();
        let s: Settings = spec_defaults(&manifest["settings"]).try_into().unwrap();
        assert_eq!(s, Settings { middle_click_tap: true, reverse_vertical: true, reverse_horizontal: true, ..Settings::default() });
    }
}
