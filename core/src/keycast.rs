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
//! - [`Feed`] keeps the recent entries: a repeat of the last one within
//!   the hold is coalesced into its count (`×3`), the oldest go past
//!   `max`, and `prune` drops what the hold has ended.

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

/// One entry of the strip: its caps, how many times in a row, and when
/// it was last pressed (unix ms), which the page fades from.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Entry {
    pub id: u64,
    pub keys: Vec<String>,
    pub count: u32,
    pub at: u64,
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

/// The recent entries, newest last.
#[derive(Debug, Default)]
pub struct Feed {
    entries: VecDeque<Entry>,
    next: u64,
    pub opts: Options,
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
            if last.keys == keys {
                last.count += 1;
                last.at = now;
                return;
            }
        }
        self.next += 1;
        self.entries.push_back(Entry { id: self.next, keys, count: 1, at: now });
        while self.entries.len() > self.opts.max.max(1) {
            self.entries.pop_front();
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
    }
}
