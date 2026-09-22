//! Keycast: keystrokes and clicks as an overlay for a recording or a
//! screen share. The app watches the events (`app/src-tauri/src/keycast.rs`
//! over the shared `keytap`); this module is the pure part:
//!
//! - [`caps`] turns one key event into the key caps to draw (`⌃ ⌥ ⇧ ⌘`
//!   then the key: a named key by its virtual key code, else what the key
//!   types), or nothing for a key that shows nothing (a dead key, `fn`
//!   alone) or, with `shortcuts_only`, plain typing.
//! - [`click_caps`] does the same for a click that carries modifiers
//!   (`⌘ click`), the one kind of click the key strip shows.
//! - [`scroll_caps`] and [`gesture_caps`] name a scroll (the wheel mark and
//!   the arrow of its dominant axis) and a trackpad gesture (`pinch out
//!   +35%`, `rotate ↻ 12°`, `swipe ←`, `smart zoom`).
//! - [`Feed`] keeps the recent entries: a repeat of the last key within
//!   the hold is coalesced into its count (`×3`), a stretch of scrolling
//!   or a pinch is one entry updated until its end phase (momentum keeps
//!   a scroll on screen), the oldest go past `max`, and `prune` drops
//!   what the hold has ended.

use std::collections::VecDeque;

/// The modifiers on an event, as the watcher reads them off the flags.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mods {
    pub cmd: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

impl Mods {
    /// A combo: something beyond shift is held.
    pub fn combo(self) -> bool {
        self.cmd || self.ctrl || self.alt
    }

    /// The glyphs in macOS's order (`⌃ ⌥ ⇧ ⌘`), with `shift` only when asked.
    fn glyphs(self, with_shift: bool) -> Vec<String> {
        let mut v = Vec::new();
        if self.ctrl {
            v.push("⌃".into());
        }
        if self.alt {
            v.push("⌥".into());
        }
        if self.shift && with_shift {
            v.push("⇧".into());
        }
        if self.cmd {
            v.push("⌘".into());
        }
        v
    }
}

/// One key down as the watcher hands it over: the virtual key code, what
/// the key typed with the modifiers applied (`NSEvent.characters`) and
/// without them (`charactersIgnoringModifiers`, the key's own face).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KeyEvent {
    pub code: u16,
    pub mods: Mods,
    pub chars: String,
    pub base: String,
}

/// A mouse button as the watcher names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Button {
    Left,
    Right,
    Other,
}

impl Button {
    pub fn name(self) -> &'static str {
        match self {
            Button::Left => "left",
            Button::Right => "right",
            Button::Other => "middle",
        }
    }
}

/// A key drawn by name rather than by what it types (macOS virtual key
/// codes), and whether it counts as navigation for `shortcuts_only`.
fn named(code: u16) -> Option<(&'static str, bool)> {
    Some(match code {
        36 => ("↵", false),
        76 => ("⌤", false),
        48 => ("⇥", false),
        49 => ("␣", false),
        51 => ("⌫", false),
        117 => ("⌦", false),
        53 => ("esc", true),
        57 => ("⇪", false),
        71 => ("⌧", false),
        123 => ("←", true),
        124 => ("→", true),
        125 => ("↓", true),
        126 => ("↑", true),
        115 => ("↖", true),
        119 => ("↘", true),
        116 => ("⇞", true),
        121 => ("⇟", true),
        114 => ("help", true),
        122 => ("F1", true),
        120 => ("F2", true),
        99 => ("F3", true),
        118 => ("F4", true),
        96 => ("F5", true),
        97 => ("F6", true),
        98 => ("F7", true),
        100 => ("F8", true),
        101 => ("F9", true),
        109 => ("F10", true),
        103 => ("F11", true),
        111 => ("F12", true),
        105 => ("F13", true),
        107 => ("F14", true),
        113 => ("F15", true),
        106 => ("F16", true),
        64 => ("F17", true),
        79 => ("F18", true),
        80 => ("F19", true),
        90 => ("F20", true),
        _ => return None,
    })
}

/// The face of a key that types: the base key (upper-cased) inside a
/// combo, so `⌘⇧S` reads as the shortcut it is, else what was typed
/// (`A`, `!`, `å`), which already carries the shift.
fn face(ev: &KeyEvent) -> Option<String> {
    let s = if ev.mods.combo() { &ev.base } else { &ev.chars };
    let s = s.trim_matches(char::is_control);
    if s.is_empty() || s.chars().any(|c| ('\u{f700}'..='\u{f8ff}').contains(&c)) {
        // Nothing typed, or a private-use function key code the table does not name.
        return None;
    }
    Some(if s.chars().count() == 1 { s.to_uppercase() } else { s.to_string() })
}

/// The caps for a key down, or none: a key that shows nothing, or plain
/// typing under `shortcuts_only` (a shortcut is a combo, or a named
/// navigation or function key; shift alone is typing).
pub fn caps(ev: &KeyEvent, shortcuts_only: bool) -> Option<Vec<String>> {
    let (key, nav) = match named(ev.code) {
        Some((n, nav)) => (n.to_string(), nav),
        None => (face(ev)?, false),
    };
    if shortcuts_only && !ev.mods.combo() && !nav {
        return None;
    }
    // Shift shows inside a combo and on a named key (`⇧⇥`, `⇧→`); on a typed character it is the character.
    let mut v = ev.mods.glyphs(ev.mods.combo() || named(ev.code).is_some());
    v.push(key);
    Some(v)
}

/// How long after the last character a new one still joins the same text
/// run, and how many characters a run holds before the next starts one.
pub const TEXT_GAP_MS: u64 = 1000;
pub const TEXT_MAX: usize = 24;

/// The character a plain press typed, as typed (case kept), for the strip's
/// text runs: no modifier combo, not a named key (space is the one named
/// key that is text), one printable character. `None` is a cap's business.
pub fn typed(ev: &KeyEvent) -> Option<String> {
    if ev.mods.combo() {
        return None;
    }
    if ev.code == 49 {
        return Some(" ".into());
    }
    if named(ev.code).is_some() {
        return None;
    }
    let s = ev.chars.trim_matches(char::is_control);
    (s.chars().count() == 1 && !s.chars().any(|c| ('\u{f700}'..='\u{f8ff}').contains(&c))).then(|| s.to_string())
}

/// The caps for a click that carries modifiers (`⌥ click`, `⌘ right click`); a bare click is the cursor overlay's, not the strip's.
pub fn click_caps(button: Button, mods: Mods) -> Option<Vec<String>> {
    if !mods.combo() && !mods.shift {
        return None;
    }
    let mut v = mods.glyphs(true);
    v.push(match button {
        Button::Left => "click".into(),
        Button::Right => "right click".into(),
        Button::Other => "middle click".into(),
    });
    Some(v)
}

// ---- scrolls and gestures -----------------------------------------------------

/// Where a continuous event is in its gesture (`NSEventPhase`): a
/// trackpad scroll or a pinch runs Began, Changed..., Ended; a wheel
/// mouse's scroll has no phase at all.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Phase {
    #[default]
    None,
    MayBegin,
    Began,
    Stationary,
    Changed,
    Ended,
    Cancelled,
}

impl Phase {
    /// The gesture is over: what was accumulated stands, the next event starts anew.
    pub fn over(self) -> bool {
        matches!(self, Phase::Ended | Phase::Cancelled)
    }
}

/// A scroll as the watcher reads it: the scrolling deltas (points, or
/// lines for a wheel), the finger's phase and the momentum's (the coast
/// after the fingers lift, which keeps the entry alive).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Scroll {
    pub dx: f64,
    pub dy: f64,
    pub phase: Phase,
    pub momentum: Phase,
}

/// The trackpad gestures AppKit names (`NSEventType` Magnify, Rotate, Swipe, SmartMagnify).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gesture {
    Magnify,
    Rotate,
    Swipe,
    SmartMagnify,
}

/// One gesture event: `amount` is this event's magnification (a fraction,
/// 0.1 is 10 % more) or rotation (degrees, positive counter-clockwise);
/// `dx`/`dy` a swipe's direction (`deltaX`/`deltaY`, -1, 0 or 1).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GestureEvent {
    pub kind: Gesture,
    pub amount: f64,
    pub dx: f64,
    pub dy: f64,
    pub phase: Phase,
}

/// The arrow for a scroll's dominant axis (`scrollingDeltaY` positive is
/// scrolling up, `scrollingDeltaX` positive scrolling left, as AppKit
/// signs them), or none for no movement.
pub fn scroll_arrow(dx: f64, dy: f64) -> Option<&'static str> {
    if dx == 0.0 && dy == 0.0 {
        return None;
    }
    Some(if dy.abs() >= dx.abs() { if dy > 0.0 { "↑" } else { "↓" } } else if dx > 0.0 { "←" } else { "→" })
}

/// A swipe's arrow: AppKit signs a two-finger swipe like a scroll (`deltaX` 1 is a swipe to the left).
pub fn swipe_arrow(dx: f64, dy: f64) -> Option<&'static str> {
    scroll_arrow(dx, dy)
}

/// How much scrolling has piled up, in three steps the page sizes the cap by: a flick, a scroll, a long one.
pub fn scroll_level(magnitude: f64) -> u8 {
    if magnitude < 40.0 {
        1
    } else if magnitude < 200.0 {
        2
    } else {
        3
    }
}

/// The caps for a scroll of the accumulated deltas: the wheel mark and the arrow.
pub fn scroll_caps(dx: f64, dy: f64) -> Option<Vec<String>> {
    scroll_arrow(dx, dy).map(|a| vec!["scroll".into(), a.into()])
}

/// The caps for a gesture with what it has accumulated: `pinch out +35%`,
/// `rotate ↻ 12°`, `swipe ←`, `smart zoom`.
pub fn gesture_caps(kind: Gesture, total: f64, dx: f64, dy: f64) -> Option<Vec<String>> {
    Some(match kind {
        Gesture::Magnify => vec![if total < 0.0 { "pinch in" } else { "pinch out" }.into(), format!("{}{}%", if total < 0.0 { "−" } else { "+" }, (total.abs() * 100.0).round())],
        Gesture::Rotate => vec!["rotate".into(), format!("{} {}°", if total < 0.0 { "↻" } else { "↺" }, total.abs().round())],
        Gesture::Swipe => vec!["swipe".into(), swipe_arrow(dx, dy)?.into()],
        Gesture::SmartMagnify => vec!["smart zoom".into()],
    })
}

/// What an entry is, for the page's styling.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Key,
    /// A run of plain typing, `keys[0]` the text so far (KeyCastr's word grouping).
    Text,
    Scroll,
    Gesture,
}

/// One entry of the strip: its caps, how many times in a row, when it
/// was last pressed or moved (unix ms), which the page fades from, what
/// it is and, for a scroll, how much (`scroll_level`).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Entry {
    pub id: u64,
    pub keys: Vec<String>,
    pub count: u32,
    pub at: u64,
    pub kind: EntryKind,
    pub level: u8,
}

/// How the feed keeps entries: how long one stays (ms) and how many at most.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Options {
    pub hold_ms: u64,
    pub max: usize,
}

impl Default for Options {
    fn default() -> Self {
        Options { hold_ms: 2000, max: 5 }
    }
}

/// A continuous thing under way: which entry it writes into and what it has accumulated.
#[derive(Debug, Clone, Copy)]
struct Live {
    id: u64,
    acc: (f64, f64),
    /// The fingers are still on it (a wheel's scroll never is; momentum is not).
    touching: bool,
}

/// The recent entries, newest last.
#[derive(Debug, Default)]
pub struct Feed {
    entries: VecDeque<Entry>,
    next: u64,
    pub opts: Options,
    /// The scroll under way or coasting, and the gesture under way.
    scroll: Option<Live>,
    gesture: Option<(Gesture, Live)>,
}

impl Feed {
    pub fn new(opts: Options) -> Self {
        Feed { opts, ..Default::default() }
    }

    pub fn entries(&self) -> &VecDeque<Entry> {
        &self.entries
    }

    /// A press: the same caps as the newest entry within the hold bump
    /// its count and time (`×3`), anything else is a new entry; the
    /// oldest leave past `max`. What the hold has ended is dropped first.
    pub fn push(&mut self, keys: Vec<String>, now: u64) {
        self.prune(now);
        if let Some(last) = self.entries.back_mut() {
            if last.kind == EntryKind::Key && last.keys == keys {
                last.count += 1;
                last.at = now;
                return;
            }
        }
        self.add(keys, now, EntryKind::Key, 0);
    }

    /// A typed character: within `TEXT_GAP_MS` of the newest entry when that
    /// is a run under `TEXT_MAX` characters it joins it, else it starts a run.
    pub fn text(&mut self, ch: &str, now: u64) {
        self.prune(now);
        if let Some(last) = self.entries.back_mut() {
            if last.kind == EntryKind::Text && now.saturating_sub(last.at) <= TEXT_GAP_MS && last.keys[0].chars().count() < TEXT_MAX {
                last.keys[0].push_str(ch);
                last.at = now;
                return;
            }
        }
        self.add(vec![ch.to_string()], now, EntryKind::Text, 0);
    }

    fn add(&mut self, keys: Vec<String>, now: u64, kind: EntryKind, level: u8) -> u64 {
        self.next += 1;
        self.entries.push_back(Entry { id: self.next, keys, count: 1, at: now, kind, level });
        while self.entries.len() > self.opts.max.max(1) {
            self.entries.pop_front();
        }
        self.next
    }

    fn entry_mut(&mut self, id: u64) -> Option<&mut Entry> {
        self.entries.iter_mut().find(|e| e.id == id)
    }

    /// A scroll: one entry per stretch of scrolling, its arrow and level
    /// from what has piled up. A trackpad's Began starts one and its
    /// Changed events feed it until Ended; the momentum after keeps it
    /// on screen (its time moves) without adding; a wheel mouse has no
    /// phases, so its notches within the hold in the same direction feed
    /// the newest scroll entry. Whether anything drawn changed.
    pub fn scroll(&mut self, s: &Scroll, now: u64) -> bool {
        self.prune(now);
        if s.momentum != Phase::None {
            if let Some(e) = self.scroll.map(|l| l.id).and_then(|id| self.entry_mut(id)) {
                e.at = now;
                return true;
            }
            return false;
        }
        let Some(arrow) = scroll_arrow(s.dx, s.dy) else {
            // The end of a stretch carries no delta: the fingers lifted, the entry stays as it is.
            if s.phase.over() {
                if let Some(l) = self.scroll.as_mut() {
                    l.touching = false;
                    let id = l.id;
                    if let Some(e) = self.entry_mut(id) {
                        e.at = now;
                        return true;
                    }
                }
            }
            return false;
        };
        let continuing = match self.scroll {
            Some(l) if self.entries.iter().any(|e| e.id == l.id) => {
                if s.phase == Phase::Began {
                    false
                } else if l.touching {
                    true
                } else {
                    // A wheel notch, or a stretch after the fingers lifted: the same way within the hold joins it.
                    s.phase == Phase::None && self.entries.back().is_some_and(|e| e.id == l.id && e.keys.get(1).map(String::as_str) == Some(arrow))
                }
            }
            _ => false,
        };
        if continuing {
            let l = self.scroll.as_mut().expect("continuing means live");
            l.acc = (l.acc.0 + s.dx, l.acc.1 + s.dy);
            l.touching = !s.phase.over() && s.phase != Phase::None;
            let (acc, id) = (l.acc, l.id);
            let level = scroll_level(acc.0.abs().max(acc.1.abs()));
            if let (Some(keys), Some(e)) = (scroll_caps(acc.0, acc.1), self.entry_mut(id)) {
                e.keys = keys;
                e.level = level;
                e.at = now;
            }
        } else {
            let level = scroll_level(s.dx.abs().max(s.dy.abs()));
            let id = self.add(vec!["scroll".into(), arrow.into()], now, EntryKind::Scroll, level);
            self.scroll = Some(Live { id, acc: (s.dx, s.dy), touching: matches!(s.phase, Phase::Began | Phase::Changed) });
        }
        true
    }

    /// A gesture: a pinch or a rotation is one entry from its Began to its
    /// Ended, its caps re-made from the running total on every Changed; a
    /// swipe and a smart zoom are one entry each. Whether anything drawn
    /// changed.
    pub fn gesture(&mut self, g: &GestureEvent, now: u64) -> bool {
        self.prune(now);
        match g.kind {
            Gesture::Swipe | Gesture::SmartMagnify => {
                let Some(keys) = gesture_caps(g.kind, 0.0, g.dx, g.dy) else { return false };
                self.add(keys, now, EntryKind::Gesture, 0);
                true
            }
            Gesture::Magnify | Gesture::Rotate => {
                let live = match self.gesture {
                    Some((k, l)) if k == g.kind && g.phase != Phase::Began && self.entries.iter().any(|e| e.id == l.id) => Some(l),
                    _ => None,
                };
                let (id, total) = match live {
                    Some(l) => (l.id, l.acc.0 + g.amount),
                    None => (self.add(vec![], now, EntryKind::Gesture, 0), g.amount),
                };
                if let (Some(keys), Some(e)) = (gesture_caps(g.kind, total, 0.0, 0.0), self.entry_mut(id)) {
                    e.keys = keys;
                    e.at = now;
                }
                self.gesture = if g.phase.over() { None } else { Some((g.kind, Live { id, acc: (total, 0.0), touching: true })) };
                true
            }
        }
    }

    /// Drop the entries whose hold has ended; whether any left.
    pub fn prune(&mut self, now: u64) -> bool {
        let before = self.entries.len();
        let hold = self.opts.hold_ms;
        self.entries.retain(|e| now.saturating_sub(e.at) < hold);
        self.entries.len() != before
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.scroll = None;
        self.gesture = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(code: u16, chars: &str, base: &str, mods: Mods) -> KeyEvent {
        KeyEvent { code, mods, chars: chars.into(), base: base.into() }
    }
    const NONE: Mods = Mods { cmd: false, ctrl: false, alt: false, shift: false };
    const CMD: Mods = Mods { cmd: true, ..NONE };
    const SHIFT: Mods = Mods { shift: true, ..NONE };
    const CMD_SHIFT: Mods = Mods { cmd: true, shift: true, ..NONE };
    const ALT: Mods = Mods { alt: true, ..NONE };

    #[test]
    fn a_typed_key_is_its_character_and_a_combo_its_base_key() {
        assert_eq!(caps(&ev(0, "a", "a", NONE), false), Some(vec!["A".into()]));
        assert_eq!(caps(&ev(0, "A", "a", SHIFT), false), Some(vec!["A".into()]), "shift on a letter is the letter");
        assert_eq!(caps(&ev(18, "!", "1", SHIFT), false), Some(vec!["!".into()]));
        assert_eq!(caps(&ev(1, "s", "s", CMD), false), Some(vec!["⌘".into(), "S".into()]));
        assert_eq!(caps(&ev(1, "S", "s", CMD_SHIFT), false), Some(vec!["⇧".into(), "⌘".into(), "S".into()]));
        assert_eq!(caps(&ev(0, "å", "a", ALT), false), Some(vec!["⌥".into(), "A".into()]), "option types å, the cap says A");
        let all = Mods { cmd: true, ctrl: true, alt: true, shift: true };
        assert_eq!(caps(&ev(0, "", "a", all), false), Some(vec!["⌃".into(), "⌥".into(), "⇧".into(), "⌘".into(), "A".into()]), "macOS's order");
    }

    #[test]
    fn named_keys_draw_by_code_with_shift_shown() {
        assert_eq!(caps(&ev(36, "\r", "\r", NONE), false), Some(vec!["↵".into()]));
        assert_eq!(caps(&ev(49, " ", " ", NONE), false), Some(vec!["␣".into()]));
        assert_eq!(caps(&ev(48, "\u{19}", "\t", SHIFT), false), Some(vec!["⇧".into(), "⇥".into()]));
        assert_eq!(caps(&ev(124, "\u{f703}", "\u{f703}", SHIFT), false), Some(vec!["⇧".into(), "→".into()]));
        assert_eq!(caps(&ev(122, "\u{f704}", "\u{f704}", NONE), false), Some(vec!["F1".into()]));
        assert_eq!(caps(&ev(53, "\u{1b}", "\u{1b}", NONE), false), Some(vec!["esc".into()]));
    }

    #[test]
    fn nothing_for_what_shows_nothing() {
        assert_eq!(caps(&ev(63, "", "", NONE), false), None, "fn alone");
        assert_eq!(caps(&ev(0, "\u{f710}", "\u{f710}", NONE), false), None, "an unnamed function key code");
        assert_eq!(caps(&ev(0, "\u{1}", "\u{1}", NONE), false), None, "a control character alone");
    }

    #[test]
    fn shortcuts_only_keeps_combos_and_navigation_and_drops_typing() {
        assert_eq!(caps(&ev(0, "a", "a", NONE), true), None);
        assert_eq!(caps(&ev(0, "A", "a", SHIFT), true), None, "shift is typing");
        assert_eq!(caps(&ev(36, "\r", "\r", NONE), true), None, "enter is typing");
        assert_eq!(caps(&ev(49, " ", " ", NONE), true), None);
        assert!(caps(&ev(1, "s", "s", CMD), true).is_some());
        assert!(caps(&ev(0, "\u{1}", "a", Mods { ctrl: true, ..NONE }), true).is_some());
        assert!(caps(&ev(126, "\u{f700}", "\u{f700}", NONE), true).is_some(), "an arrow");
        assert!(caps(&ev(96, "\u{f708}", "\u{f708}", NONE), true).is_some(), "F5");
        assert!(caps(&ev(53, "\u{1b}", "\u{1b}", NONE), true).is_some(), "escape");
    }

    #[test]
    fn a_click_shows_only_with_modifiers() {
        assert_eq!(click_caps(Button::Left, NONE), None);
        assert_eq!(click_caps(Button::Left, CMD), Some(vec!["⌘".into(), "click".into()]));
        assert_eq!(click_caps(Button::Right, SHIFT), Some(vec!["⇧".into(), "right click".into()]));
        assert_eq!(click_caps(Button::Other, ALT), Some(vec!["⌥".into(), "middle click".into()]));
    }

    #[test]
    fn typed_is_the_character_as_typed_and_space_only_among_the_named() {
        assert_eq!(typed(&ev(0, "a", "a", NONE)), Some("a".into()), "case kept, unlike a cap");
        assert_eq!(typed(&ev(0, "A", "a", SHIFT)), Some("A".into()));
        assert_eq!(typed(&ev(49, " ", " ", NONE)), Some(" ".into()), "space is text");
        assert_eq!(typed(&ev(36, "\r", "\r", NONE)), None, "return is a named cap");
        assert_eq!(typed(&ev(1, "s", "s", CMD)), None, "a combo is caps");
        assert_eq!(typed(&ev(0, "\u{f710}", "\u{f710}", NONE)), None);
    }

    #[test]
    fn typing_runs_together_until_a_gap_a_length_or_another_kind_of_entry() {
        let mut f = Feed::new(Options { hold_ms: 5000, max: 5 });
        for (i, c) in "hello world".chars().enumerate() {
            f.text(&c.to_string(), i as u64 * 100);
        }
        assert_eq!(f.entries().len(), 1);
        assert_eq!((f.entries()[0].kind, f.entries()[0].keys[0].as_str(), f.entries()[0].count), (EntryKind::Text, "hello world", 1));
        f.text("!", 1000 + TEXT_GAP_MS + 1);
        assert_eq!(f.entries().iter().map(|e| e.keys[0].as_str()).collect::<Vec<_>>(), ["hello world", "!"], "a pause starts a new run");
        f.push(vec!["⌘".into(), "S".into()], 2200);
        f.text("x", 2300);
        assert_eq!(f.entries().iter().map(|e| e.keys[0].as_str()).collect::<Vec<_>>(), ["hello world", "!", "⌘", "x"], "a cap between runs splits them");
        let mut g = Feed::new(Options { hold_ms: 5000, max: 5 });
        for i in 0..TEXT_MAX + 2 {
            g.text("a", i as u64);
        }
        assert_eq!(g.entries().iter().map(|e| e.keys[0].chars().count()).collect::<Vec<_>>(), [TEXT_MAX, 2], "a full run overflows into the next");
    }

    #[test]
    fn the_feed_coalesces_repeats_caps_the_length_and_prunes_by_hold() {
        let mut f = Feed::new(Options { hold_ms: 1000, max: 3 });
        f.push(vec!["A".into()], 0);
        f.push(vec!["A".into()], 100);
        f.push(vec!["A".into()], 200);
        assert_eq!(f.entries().len(), 1);
        assert_eq!(f.entries()[0].count, 3);
        assert_eq!(f.entries()[0].at, 200, "the time moves with the repeat");
        f.push(vec!["B".into()], 300);
        f.push(vec!["A".into()], 400);
        assert_eq!(f.entries().iter().map(|e| e.keys[0].as_str()).collect::<Vec<_>>(), ["A", "B", "A"], "the same caps after another key are a new entry");
        f.push(vec!["C".into()], 500);
        assert_eq!(f.entries().iter().map(|e| e.keys[0].as_str()).collect::<Vec<_>>(), ["B", "A", "C"], "past max the oldest leaves");
        assert!(f.prune(1350), "B (at 300) has held a second");
        assert_eq!(f.entries().iter().map(|e| e.keys[0].as_str()).collect::<Vec<_>>(), ["A", "C"]);
        assert!(!f.prune(1360));
        // A repeat after the hold has ended is a fresh entry, not a bump of a gone one.
        f.push(vec!["C".into()], 2000);
        assert_eq!(f.entries().len(), 1);
        assert_eq!(f.entries()[0].count, 1);
        assert!(f.entries()[0].id > 4, "ids never repeat");
        assert_eq!((f.entries()[0].kind, f.entries()[0].level), (EntryKind::Key, 0));
    }

    #[test]
    fn scroll_and_swipe_arrows_follow_appkit_signs() {
        assert_eq!(scroll_arrow(0.0, 3.0), Some("↑"));
        assert_eq!(scroll_arrow(0.0, -3.0), Some("↓"));
        assert_eq!(scroll_arrow(2.0, 1.0), Some("←"), "the dominant axis");
        assert_eq!(scroll_arrow(-2.0, 1.0), Some("→"));
        assert_eq!(scroll_arrow(0.0, 0.0), None);
        assert_eq!(scroll_caps(0.0, -1.0), Some(vec!["scroll".into(), "↓".into()]));
        assert_eq!((scroll_level(10.0), scroll_level(40.0), scroll_level(500.0)), (1, 2, 3));
        assert_eq!(gesture_caps(Gesture::Swipe, 0.0, 1.0, 0.0), Some(vec!["swipe".into(), "←".into()]));
        assert_eq!(gesture_caps(Gesture::Swipe, 0.0, 0.0, 0.0), None);
    }

    #[test]
    fn gesture_caps_carry_the_running_total() {
        assert_eq!(gesture_caps(Gesture::Magnify, 0.354, 0.0, 0.0), Some(vec!["pinch out".into(), "+35%".into()]));
        assert_eq!(gesture_caps(Gesture::Magnify, -0.2, 0.0, 0.0), Some(vec!["pinch in".into(), "−20%".into()]));
        assert_eq!(gesture_caps(Gesture::Rotate, 12.4, 0.0, 0.0), Some(vec!["rotate".into(), "↺ 12°".into()]), "positive is counter-clockwise");
        assert_eq!(gesture_caps(Gesture::Rotate, -30.0, 0.0, 0.0), Some(vec!["rotate".into(), "↻ 30°".into()]));
        assert_eq!(gesture_caps(Gesture::SmartMagnify, 0.0, 0.0, 0.0), Some(vec!["smart zoom".into()]));
    }

    #[test]
    fn a_trackpad_scroll_is_one_entry_fed_until_its_end_and_kept_alive_by_momentum() {
        let mut f = Feed::new(Options { hold_ms: 1000, max: 5 });
        let sc = |dy: f64, phase: Phase, momentum: Phase| Scroll { dx: 0.0, dy, phase, momentum };
        assert!(f.scroll(&sc(-5.0, Phase::Began, Phase::None), 0));
        assert!(f.scroll(&sc(-20.0, Phase::Changed, Phase::None), 10));
        assert!(f.scroll(&sc(-30.0, Phase::Changed, Phase::None), 20));
        assert_eq!(f.entries().len(), 1);
        let e = &f.entries()[0];
        assert_eq!((e.keys.clone(), e.kind, e.level, e.at), (vec!["scroll".into(), "↓".into()], EntryKind::Scroll, 2, 20), "55 points piled up: level 2");
        // Reversing inside one stretch turns the arrow with the total.
        assert!(f.scroll(&sc(80.0, Phase::Changed, Phase::None), 30));
        assert_eq!(f.entries()[0].keys[1], "↑");
        assert!(f.scroll(&sc(0.0, Phase::Ended, Phase::None), 40), "the end event has no delta but ends the stretch");
        assert_eq!(f.entries().len(), 1);
        // Momentum: the time moves, nothing is added.
        assert!(f.scroll(&sc(-3.0, Phase::None, Phase::Changed), 900));
        assert_eq!((f.entries().len(), f.entries()[0].at), (1, 900));
        assert!(!f.prune(1500), "kept alive by the coast");
        // A new Began after the lift is a new entry.
        assert!(f.scroll(&sc(-5.0, Phase::Began, Phase::None), 950));
        assert_eq!(f.entries().len(), 2);
        assert!(!f.scroll(&Scroll { dx: 0.0, dy: 0.0, phase: Phase::Began, momentum: Phase::None }, 960), "no movement, nothing drawn");
    }

    #[test]
    fn a_wheels_notches_join_the_newest_scroll_the_same_way_and_a_turn_starts_another() {
        let mut f = Feed::new(Options { hold_ms: 1000, max: 5 });
        let notch = |dy: f64| Scroll { dx: 0.0, dy, phase: Phase::None, momentum: Phase::None };
        f.scroll(&notch(-3.0), 0);
        f.scroll(&notch(-3.0), 50);
        f.scroll(&notch(-3.0), 100);
        assert_eq!(f.entries().len(), 1);
        assert_eq!(f.entries()[0].count, 1, "no ×N on a scroll; the level carries how much");
        f.scroll(&notch(3.0), 150);
        assert_eq!(f.entries().len(), 2, "the other way is another entry");
        assert_eq!(f.entries()[1].keys[1], "↑");
        f.push(vec!["A".into()], 200);
        f.scroll(&notch(3.0), 250);
        assert_eq!(f.entries().len(), 4, "a key between two notches keeps them apart");
        // After the hold the old stretch is gone and a notch starts fresh.
        f.scroll(&notch(3.0), 2000);
        assert_eq!(f.entries().len(), 1);
    }

    #[test]
    fn a_pinch_is_one_entry_from_began_to_ended_and_a_swipe_one_each() {
        let mut f = Feed::new(Options { hold_ms: 1000, max: 5 });
        let mag = |amount: f64, phase: Phase| GestureEvent { kind: Gesture::Magnify, amount, dx: 0.0, dy: 0.0, phase };
        assert!(f.gesture(&mag(0.05, Phase::Began), 0));
        assert!(f.gesture(&mag(0.1, Phase::Changed), 10));
        assert!(f.gesture(&mag(0.2, Phase::Changed), 20));
        assert_eq!(f.entries().len(), 1);
        assert_eq!(f.entries()[0].keys, vec!["pinch out".to_string(), "+35%".into()]);
        assert!(f.gesture(&mag(0.0, Phase::Ended), 30));
        assert_eq!(f.entries().len(), 1);
        assert_eq!(f.entries()[0].at, 30);
        assert!(f.gesture(&mag(-0.1, Phase::Began), 40));
        assert_eq!(f.entries().len(), 2, "after Ended a Began is a new pinch");
        assert_eq!(f.entries()[1].keys[0], "pinch in");
        let rot = |amount: f64, phase: Phase| GestureEvent { kind: Gesture::Rotate, amount, dx: 0.0, dy: 0.0, phase };
        f.gesture(&rot(-10.0, Phase::Began), 50);
        f.gesture(&rot(-5.5, Phase::Changed), 60);
        assert_eq!(f.entries().back().unwrap().keys, vec!["rotate".to_string(), "↻ 16°".into()], "a rotation alongside the pinch is its own entry");
        assert!(f.gesture(&GestureEvent { kind: Gesture::Swipe, amount: 0.0, dx: -1.0, dy: 0.0, phase: Phase::None }, 70));
        assert!(f.gesture(&GestureEvent { kind: Gesture::SmartMagnify, amount: 0.0, dx: 0.0, dy: 0.0, phase: Phase::None }, 80));
        assert_eq!(f.entries().iter().map(|e| e.keys[0].as_str()).collect::<Vec<_>>(), ["pinch out", "pinch in", "rotate", "swipe", "smart zoom"]);
        assert_eq!(f.entries()[3].keys[1], "→");
        assert!(f.entries().iter().all(|e| e.kind == EntryKind::Gesture));
        f.clear();
        assert!(f.entries().is_empty());
    }
}
