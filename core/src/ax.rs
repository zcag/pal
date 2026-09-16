//! Accessibility on macOS: the permission every capability that reaches into
//! another app needs (synthesised keystrokes for paste, window raise/close
//! /minimise for the window switcher, the menu bar walk), and a thin wrapper
//! over the `AXUIElement` C API for the parts of it pal uses. Off macOS the permission
//! is a given and the element API does not exist.
//!
//! [`trusted`] tells, [`request`] shows the system prompt that adds pal to
//! the Accessibility list (macOS lists an app under Privacy & Security >
//! Accessibility only after that call), [`open_settings`] opens that pane;
//! the user grants there and a later `trusted` sees it without a restart.

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

/// macOS: open System Settings on Privacy & Security > Accessibility, the
/// switch itself. No-op off macOS.
pub fn open_settings() -> std::io::Result<()> {
    platform::open_settings()
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

    pub fn open_settings() -> std::io::Result<()> {
        // `open` returns at once; the child is reaped here so it never lingers as a zombie.
        let mut child = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility").spawn()?;
        std::thread::spawn(move || child.wait());
        Ok(())
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
    pub fn open_settings() -> std::io::Result<()> {
        Ok(())
    }
}

/// The `AXUIElement` API, as much of it as the window switcher, the
/// layouts and the menu bar search need: an application's windows and its
/// focused one, their title, frame, minimised and full-screen state, the
/// raise / minimise / close-button-press actions, setting a frame, and the
/// generic attribute reads the menu walk is built on (a string, a flag, a
/// number, a child element or list, several attributes in one round trip).
/// Every call is a Mach message to the other app, answered on its main
/// thread; a hung app would stall it, so [`Element::app`] caps the wait at
/// [`TIMEOUT`] seconds.
#[cfg(target_os = "macos")]
pub mod element {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use objc2_core_foundation::{CFArray, CFBoolean, CFNumber, CFRetained, CFString, CFType, CGPoint, CGSize};

    pub use crate::windows::Rect;

    /// Seconds an app gets to answer one attribute read before it is skipped.
    pub const TIMEOUT: f32 = 0.3;

    const AX_VALUE_POINT: u32 = 1;
    const AX_VALUE_SIZE: u32 = 2;
    const AX_SUCCESS: i32 = 0;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> *mut CFType;
        fn AXUIElementCreateSystemWide() -> *mut CFType;
        fn AXUIElementCopyAttributeValue(element: *const CFType, attribute: *const CFString, value: *mut *mut CFType) -> i32;
        fn AXUIElementCopyMultipleAttributeValues(element: *const CFType, attributes: *const CFArray<CFString>, options: u32, values: *mut *mut CFArray) -> i32;
        fn AXUIElementSetAttributeValue(element: *const CFType, attribute: *const CFString, value: *const CFType) -> i32;
        fn AXUIElementPerformAction(element: *const CFType, action: *const CFString) -> i32;
        fn AXUIElementSetMessagingTimeout(element: *const CFType, timeout: f32) -> i32;
        fn AXValueGetValue(value: *const CFType, kind: u32, out: *mut c_void) -> bool;
        fn AXValueCreate(kind: u32, value: *const c_void) -> *mut CFType;
        static kCFBooleanTrue: &'static CFBoolean;
        static kCFBooleanFalse: &'static CFBoolean;
    }

    /// One `AXUIElementRef`, released on drop; a clone is another retain.
    #[derive(Clone)]
    pub struct Element(CFRetained<CFType>);

    // SAFETY: the AXUIElement API is documented thread-safe (every call is a
    // Mach message to the other app); the ref is an immutable handle.
    unsafe impl Send for Element {}
    unsafe impl Sync for Element {}

    /// A retained CF value read from an attribute, as the type pal wants
    /// it; `None` when it is something else (an AX error placeholder from a
    /// multiple read, a value of another type).
    fn text(v: &CFType) -> Option<String> {
        v.downcast_ref::<CFString>().map(|s| s.to_string())
    }
    fn flag(v: &CFType) -> Option<bool> {
        v.downcast_ref::<CFBoolean>().map(|b| b.value())
    }
    fn number(v: &CFType) -> Option<i64> {
        v.downcast_ref::<CFNumber>().and_then(|n| n.as_i64())
    }
    fn elements(v: &CFType) -> Vec<Element> {
        let Some(arr) = v.downcast_ref::<CFArray>() else { return vec![] };
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

        /// The system-wide element: the one that knows which element has
        /// keyboard focus across apps (`AXFocusedUIElement`).
        pub fn system_wide() -> Option<Self> {
            // SAFETY: creates a new object we own.
            let raw = NonNull::new(unsafe { AXUIElementCreateSystemWide() })?;
            // SAFETY: a valid AXUIElementRef with a +1 retain.
            let el = Self(unsafe { CFRetained::from_raw(raw) });
            // SAFETY: element is valid for the call.
            unsafe { AXUIElementSetMessagingTimeout(el.ptr(), TIMEOUT) };
            Some(el)
        }

        /// The element with keyboard focus (a text field, a web area), from
        /// the system-wide element or an app's.
        pub fn focused_element(&self) -> Option<Element> {
            self.attr("AXFocusedUIElement").map(Element)
        }

        /// The selected text of a text element (`AXSelectedText`); `None`
        /// when the element has no such attribute or nothing is selected.
        pub fn selected_text(&self) -> Option<String> {
            self.attr("AXSelectedText").and_then(|v| v.downcast::<CFString>().ok()).map(|s| s.to_string()).filter(|s| !s.is_empty())
        }

        fn ptr(&self) -> *const CFType {
            CFRetained::as_ptr(&self.0).as_ptr()
        }

        /// One attribute, raw: `None` when the app has no such attribute or
        /// did not answer.
        pub fn attr(&self, name: &str) -> Option<CFRetained<CFType>> {
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

        /// Several attributes in one round trip, in the order asked; an
        /// attribute the app does not have comes back `None` (the API puts
        /// an error placeholder there, which no downcast accepts). A menu
        /// walk reads seven per item, so this is what keeps it under its
        /// budget.
        pub fn attrs(&self, names: &[&str]) -> Vec<Option<CFRetained<CFType>>> {
            let keys: Vec<CFRetained<CFString>> = names.iter().map(|n| CFString::from_str(n)).collect();
            let keys = CFArray::from_retained_objects(&keys);
            let mut out: *mut CFArray = std::ptr::null_mut();
            // SAFETY: element and the key array are valid; `out` receives a +1 array or stays null.
            let rc = unsafe { AXUIElementCopyMultipleAttributeValues(self.ptr(), CFRetained::as_ptr(&keys).as_ptr(), 0, &mut out) };
            let Some(arr) = (rc == AX_SUCCESS).then(|| NonNull::new(out)).flatten() else { return names.iter().map(|_| None).collect() };
            // SAFETY: on success `out` is an array we own.
            let arr = unsafe { CFRetained::from_raw(arr) };
            (0..names.len())
                .map(|i| {
                    if i >= arr.len() {
                        return None;
                    }
                    // SAFETY: index in range; the array owns its values, so retain our own.
                    let p = NonNull::new(unsafe { arr.value_at_index(i as isize) } as *mut CFType)?;
                    // SAFETY: `p` is a live CF object.
                    Some(unsafe { CFRetained::retain(p) })
                })
                .collect()
        }

        pub fn string(&self, name: &str) -> Option<String> {
            self.attr(name).and_then(|v| text(&v))
        }

        pub fn boolean(&self, name: &str) -> Option<bool> {
            self.attr(name).and_then(|v| flag(&v))
        }

        pub fn element(&self, name: &str) -> Option<Element> {
            self.attr(name).map(Element)
        }

        pub fn elements(&self, name: &str) -> Vec<Element> {
            self.attr(name).map(|v| elements(&v)).unwrap_or_default()
        }

        /// A value from [`Element::attrs`] as a string.
        pub fn as_text(v: &Option<CFRetained<CFType>>) -> Option<String> {
            v.as_deref().and_then(text)
        }
        pub fn as_flag(v: &Option<CFRetained<CFType>>) -> Option<bool> {
            v.as_deref().and_then(flag)
        }
        pub fn as_number(v: &Option<CFRetained<CFType>>) -> Option<i64> {
            v.as_deref().and_then(number)
        }
        pub fn as_elements(v: &Option<CFRetained<CFType>>) -> Vec<Element> {
            v.as_deref().map(elements).unwrap_or_default()
        }

        /// The app's windows, front to back as the app orders them; minimised
        /// ones included.
        pub fn windows(&self) -> Vec<Element> {
            self.elements("AXWindows")
        }

        /// The app's window with keyboard focus (`AXFocusedWindow`); none
        /// when the app has no window up.
        pub fn focused_window(&self) -> Option<Element> {
            self.element("AXFocusedWindow")
        }

        /// The app's menu bar (`AXMenuBar` of an application element).
        pub fn menu_bar(&self) -> Option<Element> {
            self.element("AXMenuBar")
        }

        pub fn title(&self) -> Option<String> {
            self.string("AXTitle")
        }

        pub fn minimized(&self) -> bool {
            self.boolean("AXMinimized").unwrap_or(false)
        }

        /// The window's native full-screen state (`AXFullScreen`, a Space
        /// of its own); `None` when the window has no such attribute.
        pub fn fullscreen(&self) -> Option<bool> {
            self.boolean("AXFullScreen")
        }

        /// Where the window is, in the global top-left-origin space
        /// `CGWindowListCopyWindowInfo` also reports in.
        pub fn frame(&self) -> Option<Rect> {
            let mut p = CGPoint { x: 0.0, y: 0.0 };
            let mut s = CGSize { width: 0.0, height: 0.0 };
            let pos = self.attr("AXPosition")?;
            let size = self.attr("AXSize")?;
            // SAFETY: the out pointers match the requested value types.
            let ok = unsafe {
                AXValueGetValue(CFRetained::as_ptr(&pos).as_ptr(), AX_VALUE_POINT, (&mut p as *mut CGPoint).cast())
                    && AXValueGetValue(CFRetained::as_ptr(&size).as_ptr(), AX_VALUE_SIZE, (&mut s as *mut CGSize).cast())
            };
            ok.then_some(Rect { x: p.x, y: p.y, w: s.width, h: s.height })
        }

        /// Move and resize: position, size, then position again, since a
        /// window that grows against a screen edge is pushed by the app
        /// before its size settles. The app keeps its minimum size and may
        /// round; true when every set was accepted.
        pub fn set_frame(&self, r: Rect) -> bool {
            let p = CGPoint { x: r.x, y: r.y };
            let s = CGSize { width: r.w, height: r.h };
            let set = |attr: &str, kind: u32, v: *const c_void| {
                // SAFETY: `v` points at the struct `kind` names; the value is released on drop.
                let value = NonNull::new(unsafe { AXValueCreate(kind, v) }).map(|p| unsafe { CFRetained::from_raw(p) });
                let Some(value) = value else { return false };
                self.set(attr, &value)
            };
            let pos = || set("AXPosition", AX_VALUE_POINT, (&p as *const CGPoint).cast());
            pos() && set("AXSize", AX_VALUE_SIZE, (&s as *const CGSize).cast()) && pos()
        }

        fn set(&self, attr: &str, value: &CFType) -> bool {
            let key = CFString::from_str(attr);
            // SAFETY: element, key and value are valid for the call.
            unsafe { AXUIElementSetAttributeValue(self.ptr(), CFRetained::as_ptr(&key).as_ptr(), value as *const CFType) == AX_SUCCESS }
        }

        /// Set a boolean attribute (`AXMinimized`, `AXFullScreen`).
        pub fn set_bool(&self, attr: &str, on: bool) -> bool {
            // SAFETY: framework constants, valid for the program's life.
            let v: &CFBoolean = unsafe { if on { kCFBooleanTrue } else { kCFBooleanFalse } };
            self.set(attr, v)
        }

        pub fn set_minimized(&self, on: bool) -> bool {
            self.set_bool("AXMinimized", on)
        }

        pub fn set_fullscreen(&self, on: bool) -> bool {
            self.set_bool("AXFullScreen", on)
        }

        pub fn raise(&self) -> bool {
            self.perform("AXRaise")
        }

        /// Press it: what a click does on a button or a menu item.
        pub fn press(&self) -> bool {
            self.perform("AXPress")
        }

        /// Press the window's close button: what the red dot does, so the
        /// app gets its usual chance to ask about unsaved changes.
        pub fn close(&self) -> bool {
            self.element("AXCloseButton").is_some_and(|b| b.press())
        }

        fn perform(&self, action: &str) -> bool {
            let key = CFString::from_str(action);
            // SAFETY: element and key are valid for the call.
            unsafe { AXUIElementPerformAction(self.ptr(), CFRetained::as_ptr(&key).as_ptr()) == AX_SUCCESS }
        }
    }
}
