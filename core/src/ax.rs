//! Accessibility on macOS: the permission every capability that reaches into
//! another app needs (synthesised keystrokes for paste, window raise/close
//! /minimise for the window switcher), and a thin wrapper over the
//! `AXUIElement` C API for the parts of it pal uses. Off macOS the permission
//! is a given and the element API does not exist.
//!
//! [`trusted`] tells, [`request`] shows the system prompt that adds pal to
//! the Accessibility list; the user grants in System Settings and a later
//! `trusted` sees it without a restart.

/// Whether pal may drive other apps (send keys, raise windows). Always true
/// off macOS.
pub fn trusted() -> bool {
    platform::trusted()
}

/// macOS: show the system prompt that adds pal to the Accessibility list.
/// Returns the current state.
pub fn request() -> bool {
    platform::request()
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_foundation::{NSDictionary, NSNumber, NSString};

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const NSDictionary<NSString, NSNumber>) -> bool;
        static kAXTrustedCheckOptionPrompt: &'static NSString;
    }

    pub fn trusted() -> bool {
        // SAFETY: plain C call with no arguments.
        unsafe { AXIsProcessTrusted() }
    }

    pub fn request() -> bool {
        // SAFETY: the dictionary outlives the call; the key is the framework's own constant.
        unsafe {
            let opts = NSDictionary::from_slices(&[kAXTrustedCheckOptionPrompt], &[&*NSNumber::numberWithBool(true)]);
            AXIsProcessTrustedWithOptions(&*opts)
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn trusted() -> bool {
        true
    }
    pub fn request() -> bool {
        true
    }
}

/// The `AXUIElement` API, as much of it as the window switcher needs: an
/// application's windows, their title, frame and minimised state, and the
/// raise / minimise / close-button-press actions. Every call is a Mach
/// message to the other app, answered on its main thread; a hung app would
/// stall it, so [`Element::app`] caps the wait at [`TIMEOUT`] seconds.
#[cfg(target_os = "macos")]
pub mod element {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use objc2_core_foundation::{CFArray, CFBoolean, CFRetained, CFString, CFType, CGPoint, CGSize};

    /// Seconds an app gets to answer one attribute read before it is skipped.
    pub const TIMEOUT: f32 = 0.3;

    const AX_VALUE_POINT: u32 = 1;
    const AX_VALUE_SIZE: u32 = 2;
    const AX_SUCCESS: i32 = 0;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> *mut CFType;
        fn AXUIElementCopyAttributeValue(element: *const CFType, attribute: *const CFString, value: *mut *mut CFType) -> i32;
        fn AXUIElementSetAttributeValue(element: *const CFType, attribute: *const CFString, value: *const CFType) -> i32;
        fn AXUIElementPerformAction(element: *const CFType, action: *const CFString) -> i32;
        fn AXUIElementSetMessagingTimeout(element: *const CFType, timeout: f32) -> i32;
        fn AXValueGetValue(value: *const CFType, kind: u32, out: *mut c_void) -> bool;
        static kCFBooleanTrue: &'static CFBoolean;
        static kCFBooleanFalse: &'static CFBoolean;
    }

    /// One `AXUIElementRef`, released on drop.
    pub struct Element(CFRetained<CFType>);

    // SAFETY: the AXUIElement API is documented thread-safe (every call is a
    // Mach message to the other app); the ref is an immutable handle.
    unsafe impl Send for Element {}
    unsafe impl Sync for Element {}

    /// Where a window sits and how big it is, in the global top-left-origin
    /// coordinate space `CGWindowListCopyWindowInfo` also reports in.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct Frame {
        pub x: f64,
        pub y: f64,
        pub w: f64,
        pub h: f64,
    }

    impl Element {
        /// The application element for `pid`, with the messaging timeout set.
        pub fn app(pid: i32) -> Option<Self> {
            // SAFETY: creates a new object we own; null only when the pid is gone.
            let raw = NonNull::new(unsafe { AXUIElementCreateApplication(pid) })?;
            // SAFETY: `raw` is a valid AXUIElementRef with a +1 retain.
            let el = Self(unsafe { CFRetained::from_raw(raw) });
            // SAFETY: element is valid for the call.
            unsafe { AXUIElementSetMessagingTimeout(el.ptr(), TIMEOUT) };
            Some(el)
        }

        fn ptr(&self) -> *const CFType {
            CFRetained::as_ptr(&self.0).as_ptr()
        }

        fn attr(&self, name: &str) -> Option<CFRetained<CFType>> {
            let key = CFString::from_str(name);
            let mut out: *mut CFType = std::ptr::null_mut();
            // SAFETY: element and key are valid; `out` receives a +1 reference or stays null.
            let rc = unsafe { AXUIElementCopyAttributeValue(self.ptr(), CFRetained::as_ptr(&key).as_ptr(), &mut out) };
            if rc != AX_SUCCESS {
                return None;
            }
            // SAFETY: on success `out` is an object we own.
            NonNull::new(out).map(|p| unsafe { CFRetained::from_raw(p) })
        }

        /// The app's windows, front to back as the app orders them; minimised
        /// ones included.
        pub fn windows(&self) -> Vec<Element> {
            let Some(arr) = self.attr("AXWindows").and_then(|v| v.downcast::<CFArray>().ok()) else { return vec![] };
            (0..arr.len())
                .filter_map(|i| {
                    // SAFETY: index in range; the array holds AXUIElementRefs it owns, so retain our own.
                    let p = unsafe { arr.value_at_index(i as isize) } as *mut CFType;
                    let p = NonNull::new(p)?;
                    // SAFETY: `p` is a live CF object; `retain` gives us our own +1.
                    Some(Element(unsafe { CFRetained::retain(p) }))
                })
                .collect()
        }

        pub fn title(&self) -> Option<String> {
            self.attr("AXTitle").and_then(|v| v.downcast::<CFString>().ok()).map(|s| s.to_string())
        }

        pub fn minimized(&self) -> bool {
            self.attr("AXMinimized").and_then(|v| v.downcast::<CFBoolean>().ok()).is_some_and(|b| b.value())
        }

        pub fn frame(&self) -> Option<Frame> {
            let mut p = CGPoint { x: 0.0, y: 0.0 };
            let mut s = CGSize { width: 0.0, height: 0.0 };
            let pos = self.attr("AXPosition")?;
            let size = self.attr("AXSize")?;
            // SAFETY: the out pointers match the requested value types.
            let ok = unsafe {
                AXValueGetValue(CFRetained::as_ptr(&pos).as_ptr(), AX_VALUE_POINT, (&mut p as *mut CGPoint).cast())
                    && AXValueGetValue(CFRetained::as_ptr(&size).as_ptr(), AX_VALUE_SIZE, (&mut s as *mut CGSize).cast())
            };
            ok.then_some(Frame { x: p.x, y: p.y, w: s.width, h: s.height })
        }

        pub fn set_minimized(&self, on: bool) -> bool {
            let key = CFString::from_str("AXMinimized");
            // SAFETY: framework constants; the element and key are valid.
            unsafe {
                let v: &CFBoolean = if on { kCFBooleanTrue } else { kCFBooleanFalse };
                AXUIElementSetAttributeValue(self.ptr(), CFRetained::as_ptr(&key).as_ptr(), (v as *const CFBoolean).cast()) == AX_SUCCESS
            }
        }

        pub fn raise(&self) -> bool {
            self.perform("AXRaise")
        }

        /// Press the window's close button: what the red dot does, so the
        /// app gets its usual chance to ask about unsaved changes.
        pub fn close(&self) -> bool {
            self.attr("AXCloseButton").map(Element).is_some_and(|b| b.perform("AXPress"))
        }

        fn perform(&self, action: &str) -> bool {
            let key = CFString::from_str(action);
            // SAFETY: element and key are valid for the call.
            unsafe { AXUIElementPerformAction(self.ptr(), CFRetained::as_ptr(&key).as_ptr()) == AX_SUCCESS }
        }
    }
}
