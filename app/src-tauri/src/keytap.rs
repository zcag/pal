//! The one place pal watches what is typed and clicked in other apps:
//! an `NSEvent` global monitor on the main thread (it observes without
//! swallowing, and delivers only with the **Input Monitoring** grant; the
//! bar popover's peek established that a listen-only `CGEventTap` buys
//! nothing over it, bar/popover.rs), shared by snippet expansion
//! (expansion.rs) and keycast (keycast.rs) so that both on means one
//! monitor, not two. Each subscriber says what it wants ([`Wants`]: keys,
//! clicks, the pointer's moves) and the monitor's mask is the union; it is
//! installed with the first subscriber, re-installed when the union
//! changes, and removed with the last. The registry ([`Registry`]) is
//! pure and tested; the AppKit half is the `monitor` module.
//!
//! Every [`Event`] carries what any subscriber may need, read once: the
//! key code and the characters (with and without the modifiers applied),
//! the modifiers, the app in front (keys only) and whether a secure text
//! field has the keyboard (`IsSecureEventInputEnabled`: a password
//! prompt, `sudo`), which every subscriber honours. Handlers run on the
//! main thread inside the monitor's block: keep them short, hand work to
//! a thread. Linux has no portable tap (Wayland hands input to the
//! focused client only): `subscribe` records the subscriber and nothing
//! is ever delivered.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::sync::Mutex;

use pal_core::keycast::{Button, Gesture, GestureEvent, Mods, Phase, Scroll};
use tauri::AppHandle;

use crate::lock;

/// What a subscriber wants delivered. The union over subscribers is the monitor's mask.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Wants {
    /// Key downs.
    pub keys: bool,
    /// Mouse buttons down and up.
    pub clicks: bool,
    /// The pointer moving (with or without a button held): at the input rate, so only what draws the pointer asks.
    pub moves: bool,
    /// Scroll wheel and trackpad scrolling, with the phases and the momentum.
    pub scrolls: bool,
    /// Trackpad gestures: pinch, rotate, two-finger swipe, smart zoom.
    pub gestures: bool,
}

impl Wants {
    fn union(self, o: Wants) -> Wants {
        Wants { keys: self.keys || o.keys, clicks: self.clicks || o.clicks, moves: self.moves || o.moves, scrolls: self.scrolls || o.scrolls, gestures: self.gestures || o.gestures }
    }

    fn any(self) -> bool {
        self.keys || self.clicks || self.moves || self.scrolls || self.gestures
    }

    fn takes(self, kind: &Kind) -> bool {
        match kind {
            Kind::KeyDown => self.keys,
            Kind::MouseDown(_) | Kind::MouseUp(_) => self.clicks,
            Kind::MouseMoved => self.moves,
            Kind::Scroll => self.scrolls,
            Kind::Gesture(_) => self.gestures,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    KeyDown,
    MouseDown(Button),
    MouseUp(Button),
    MouseMoved,
    Scroll,
    Gesture(Gesture),
}

/// One event off the monitor.
#[derive(Clone, Debug)]
pub struct Event {
    pub kind: Kind,
    /// The virtual key code (keys only).
    pub code: u16,
    pub mods: Mods,
    /// What the key typed, the layout and modifiers applied (`characters`); empty off a key event.
    pub chars: String,
    /// The key's own face (`charactersIgnoringModifiers`); empty off a key event.
    pub base: String,
    /// The bundle id of the app in front (keys only; a move never asks).
    pub front: Option<String>,
    /// A secure text field has the keyboard: nothing typed may be read or shown.
    pub secure: bool,
    /// A scroll's deltas and phases (`Kind::Scroll` only).
    pub scroll: Option<Scroll>,
    /// A gesture's amount, direction and phase (`Kind::Gesture` only).
    pub gesture: Option<GestureEvent>,
}

pub type Handler = fn(&AppHandle, &Event);

/// The subscribers, pure: who wants what, and who gets an event.
#[derive(Debug)]
pub struct Registry<H> {
    subs: Vec<(&'static str, Wants, H)>,
}

impl<H: Clone> Default for Registry<H> {
    fn default() -> Self {
        Registry { subs: Vec::new() }
    }
}

impl<H: Clone> Registry<H> {
    /// Add or replace `id`'s subscription.
    pub fn add(&mut self, id: &'static str, wants: Wants, handler: H) {
        self.remove(id);
        self.subs.push((id, wants, handler));
    }

    pub fn remove(&mut self, id: &'static str) {
        self.subs.retain(|(i, _, _)| *i != id);
    }

    /// The union: what the monitor has to be installed for.
    pub fn wants(&self) -> Wants {
        self.subs.iter().fold(Wants::default(), |w, (_, x, _)| w.union(*x))
    }

    /// The handlers an event of `kind` reaches, in subscription order.
    pub fn targets(&self, kind: &Kind) -> Vec<H> {
        self.subs.iter().filter(|(_, w, _)| w.takes(kind)).map(|(_, _, h)| h.clone()).collect()
    }
}

static REGISTRY: Mutex<Registry<Handler>> = Mutex::new(Registry { subs: Vec::new() });

/// Subscribe `id` (a second call with the same id replaces the first); the
/// monitor follows on the main thread.
pub fn subscribe(app: &AppHandle, id: &'static str, wants: Wants, handler: Handler) {
    lock(&REGISTRY).add(id, wants, handler);
    sync(app);
}

pub fn unsubscribe(app: &AppHandle, id: &'static str) {
    lock(&REGISTRY).remove(id);
    sync(app);
}

/// The union as it stands, for a log line.
pub fn wants() -> Wants {
    lock(&REGISTRY).wants()
}

/// Re-install the monitor for the union of what is wanted (main thread).
fn sync(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || monitor::sync(&handle, wants()));
}

/// Deliver one event to every subscriber that takes its kind.
fn dispatch(app: &AppHandle, ev: &Event) {
    let targets = lock(&REGISTRY).targets(&ev.kind);
    for h in targets {
        h(app, ev);
    }
}

#[cfg(target_os = "macos")]
mod monitor {
    use std::cell::RefCell;
    use std::ptr::NonNull;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventPhase, NSEventType, NSWorkspace};
    use tauri::AppHandle;

    use super::{Button, Event, Gesture, GestureEvent, Kind, Mods, Phase, Scroll, Wants};

    thread_local! {
        static MONITOR: RefCell<Option<(Wants, Retained<AnyObject>)>> = const { RefCell::new(None) };
    }

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        /// Whether a secure text field (a password) has the keyboard: keys
        /// are not delivered to monitors then either, but the check is what
        /// says so for sure.
        fn IsSecureEventInputEnabled() -> u8;
    }

    fn mask(w: Wants) -> NSEventMask {
        let mut m = NSEventMask::empty();
        if w.keys {
            m |= NSEventMask::KeyDown;
        }
        if w.clicks {
            m |= NSEventMask::LeftMouseDown | NSEventMask::LeftMouseUp | NSEventMask::RightMouseDown | NSEventMask::RightMouseUp | NSEventMask::OtherMouseDown | NSEventMask::OtherMouseUp;
        }
        if w.moves {
            m |= NSEventMask::MouseMoved | NSEventMask::LeftMouseDragged | NSEventMask::RightMouseDragged | NSEventMask::OtherMouseDragged;
        }
        if w.scrolls {
            m |= NSEventMask::ScrollWheel;
        }
        if w.gestures {
            // Not the bare `Gesture` type (29): it rides beside every one of these with nothing of its own to read.
            m |= NSEventMask::Magnify | NSEventMask::Rotate | NSEventMask::Swipe | NSEventMask::SmartMagnify;
        }
        m
    }

    fn phase(p: NSEventPhase) -> Phase {
        if p.contains(NSEventPhase::Began) {
            Phase::Began
        } else if p.contains(NSEventPhase::Changed) {
            Phase::Changed
        } else if p.contains(NSEventPhase::Ended) {
            Phase::Ended
        } else if p.contains(NSEventPhase::Cancelled) {
            Phase::Cancelled
        } else if p.contains(NSEventPhase::MayBegin) {
            Phase::MayBegin
        } else if p.contains(NSEventPhase::Stationary) {
            Phase::Stationary
        } else {
            Phase::None
        }
    }

    fn mods(flags: NSEventModifierFlags) -> Mods {
        Mods {
            cmd: flags.contains(NSEventModifierFlags::Command),
            ctrl: flags.contains(NSEventModifierFlags::Control),
            alt: flags.contains(NSEventModifierFlags::Option),
            shift: flags.contains(NSEventModifierFlags::Shift),
        }
    }

    /// The event's kind, or none for a type the mask did not ask for.
    fn kind(e: &NSEvent) -> Option<Kind> {
        let t = e.r#type();
        Some(match t {
            NSEventType::KeyDown => Kind::KeyDown,
            NSEventType::LeftMouseDown => Kind::MouseDown(Button::Left),
            NSEventType::LeftMouseUp => Kind::MouseUp(Button::Left),
            NSEventType::RightMouseDown => Kind::MouseDown(Button::Right),
            NSEventType::RightMouseUp => Kind::MouseUp(Button::Right),
            NSEventType::OtherMouseDown => Kind::MouseDown(Button::Other),
            NSEventType::OtherMouseUp => Kind::MouseUp(Button::Other),
            NSEventType::MouseMoved | NSEventType::LeftMouseDragged | NSEventType::RightMouseDragged | NSEventType::OtherMouseDragged => Kind::MouseMoved,
            NSEventType::ScrollWheel => Kind::Scroll,
            NSEventType::Magnify => Kind::Gesture(Gesture::Magnify),
            NSEventType::Rotate => Kind::Gesture(Gesture::Rotate),
            NSEventType::Swipe => Kind::Gesture(Gesture::Swipe),
            NSEventType::SmartMagnify => Kind::Gesture(Gesture::SmartMagnify),
            _ => return None,
        })
    }

    /// The event as subscribers see it. The key fields are read only off a
    /// key event: AppKit raises on `keyCode` of a mouse event.
    fn read(e: &NSEvent) -> Option<Event> {
        let kind = kind(e)?;
        let flags = e.modifierFlags();
        // SAFETY: a plain Carbon query with no arguments.
        let secure = unsafe { IsSecureEventInputEnabled() } != 0;
        let (code, chars, base, front) = if kind == Kind::KeyDown {
            (
                e.keyCode(),
                e.characters().map(|s| s.to_string()).unwrap_or_default(),
                e.charactersIgnoringModifiers().map(|s| s.to_string()).unwrap_or_default(),
                NSWorkspace::sharedWorkspace().frontmostApplication().and_then(|a| a.bundleIdentifier()).map(|s| s.to_string()),
            )
        } else {
            (0, String::new(), String::new(), None)
        };
        // The scroll and gesture fields are read only off their own events: AppKit raises on the others.
        let scroll = (kind == Kind::Scroll).then(|| Scroll { dx: e.scrollingDeltaX(), dy: e.scrollingDeltaY(), phase: phase(e.phase()), momentum: phase(e.momentumPhase()) });
        let gesture = match kind {
            Kind::Gesture(g) => Some(GestureEvent {
                kind: g,
                amount: match g {
                    Gesture::Magnify => e.magnification(),
                    Gesture::Rotate => e.rotation() as f64,
                    _ => 0.0,
                },
                dx: if g == Gesture::Swipe { e.deltaX() } else { 0.0 },
                dy: if g == Gesture::Swipe { e.deltaY() } else { 0.0 },
                phase: if g == Gesture::SmartMagnify { Phase::None } else { phase(e.phase()) },
            }),
            _ => None,
        };
        Some(Event { kind, code, mods: mods(flags), chars, base, front, secure, scroll, gesture })
    }

    /// The monitor for `wants` (main thread): none for nothing wanted,
    /// re-made when the union moved, left alone otherwise.
    pub fn sync(app: &AppHandle, wants: Wants) {
        let current = MONITOR.with(|m| m.borrow().as_ref().map(|(w, _)| *w));
        if current == Some(wants) || (current.is_none() && !wants.any()) {
            return;
        }
        MONITOR.with(|slot| {
            if let Some((_, m)) = slot.borrow_mut().take() {
                // SAFETY: the object is the one `addGlobalMonitor` returned.
                unsafe { NSEvent::removeMonitor(&m) };
                eprintln!("keytap\tmonitor\tremoved");
            }
        });
        if !wants.any() {
            return;
        }
        let h = app.clone();
        let handler = block2::RcBlock::new(move |e: NonNull<NSEvent>| {
            // SAFETY: AppKit hands a live event to the monitor's block.
            if let Some(ev) = read(unsafe { e.as_ref() }) {
                super::dispatch(&h, &ev);
            }
        });
        // The block is retained by AppKit for as long as the monitor lives; `removeMonitor` ends it.
        let m = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask(wants), &handler);
        eprintln!("keytap\tmonitor\t{}\t{wants:?}\tinput_monitoring={}", if m.is_some() { "installed" } else { "refused" }, crate::permissions::input_monitoring());
        MONITOR.with(|slot| *slot.borrow_mut() = m.map(|m| (wants, m)));
    }
}

#[cfg(not(target_os = "macos"))]
mod monitor {
    use tauri::AppHandle;
    pub fn sync(_app: &AppHandle, _wants: super::Wants) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_union_is_the_mask_and_each_kind_reaches_who_asked() {
        let mut r: Registry<&'static str> = Registry::default();
        assert_eq!(r.wants(), Wants::default(), "nothing wanted: no monitor");
        r.add("expansion", Wants { keys: true, ..Default::default() }, "expansion");
        assert_eq!(r.wants(), Wants { keys: true, ..Default::default() });
        r.add("keycast", Wants { keys: true, clicks: true, moves: true, scrolls: true, gestures: true }, "keycast");
        assert_eq!(r.wants(), Wants { keys: true, clicks: true, moves: true, scrolls: true, gestures: true }, "one monitor for both");
        assert_eq!(r.targets(&Kind::KeyDown), ["expansion", "keycast"], "a key reaches both, in order");
        assert_eq!(r.targets(&Kind::MouseDown(Button::Left)), ["keycast"]);
        assert_eq!(r.targets(&Kind::MouseMoved), ["keycast"]);
        assert_eq!(r.targets(&Kind::Scroll), ["keycast"]);
        assert_eq!(r.targets(&Kind::Gesture(Gesture::Magnify)), ["keycast"]);
        // A re-subscription replaces (keycast narrows to keys only): the union shrinks with it.
        r.add("keycast", Wants { keys: true, ..Default::default() }, "keycast2");
        assert_eq!(r.targets(&Kind::KeyDown), ["expansion", "keycast2"], "replaced in place, not appended");
        assert_eq!(r.wants(), Wants { keys: true, ..Default::default() });
        assert!(r.targets(&Kind::MouseUp(Button::Right)).is_empty());
        assert!(r.targets(&Kind::Scroll).is_empty());
        r.remove("expansion");
        assert_eq!(r.targets(&Kind::KeyDown), ["keycast2"], "the other keeps the monitor");
        r.remove("keycast");
        assert_eq!(r.wants(), Wants::default(), "the last one out takes the monitor down");
        r.remove("keycast");
    }
}
