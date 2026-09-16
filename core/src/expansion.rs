//! Snippet expansion: a snippet's keyword typed in any app is replaced by
//! its text. The keystrokes are watched by the app (an `NSEvent` global
//! monitor on macOS, `app/src-tauri/src/expansion.rs`); this module is the
//! pure part and the injection:
//!
//! - [`Matcher`] keeps the last [`MAX_BUF`] characters typed in one app and
//!   answers a [`Hit`] when they end in a snippet's keyword, under the
//!   [`Prefix`] rule (`;sig`, `:sig`, or the bare `sig` at a word start).
//! - [`plan`] turns a hit and the snippet's text into a [`Plan`]: how many
//!   backspaces delete what was typed, the text to paste with its
//!   placeholders filled ([`fill`]: `{clipboard}`, `{date}`, `{time}`,
//!   `{datetime}`, `{uuid}`), and how far left the caret moves for a
//!   `{cursor}`.
//! - [`perform`] runs a plan on macOS: the backspaces, then the text through
//!   the concealed pasteboard write (the clipboard is put back as it was,
//!   pal's history records nothing), then the arrows.
//!
//! Linux has no portable keyboard tap (Wayland hands key events to the
//! focused client only), so nothing here runs there: the shell documents
//! expansion as macOS-only and leaves the snippets palette's Enter as the
//! way to paste one.

use std::time::Duration;

use crate::clipboard;

/// How many typed characters are remembered: longer than any keyword
/// with its prefix, short enough that a buffer is never a transcript.
pub const MAX_BUF: usize = 64;

/// The character before a keyword that makes the bare form (no prefix)
/// expand: the buffer's start, or anything that is not part of a word.
fn boundary(c: Option<char>) -> bool {
    c.is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
}

/// What has to precede a keyword for it to expand (`snippets.expand_prefix`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Prefix {
    /// The keyword alone, at the start of a word: `sig` after a space.
    None,
    /// `;sig`: the default, since a bare keyword fires inside ordinary words.
    #[default]
    Semicolon,
    /// `:sig`.
    Colon,
}

impl Prefix {
    /// `"none"`, `";"`, `":"` as the setting spells them; anything else is the default.
    pub fn parse(s: &str) -> Prefix {
        match s.trim() {
            "none" | "" => Prefix::None,
            ":" | "colon" => Prefix::Colon,
            _ => Prefix::Semicolon,
        }
    }

    fn text(self) -> &'static str {
        match self {
            Prefix::None => "",
            Prefix::Semicolon => ";",
            Prefix::Colon => ":",
        }
    }
}

/// A snippet as the matcher needs it: the keyword typed, the text pasted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snippet {
    pub name: String,
    pub keyword: String,
    pub text: String,
}

/// One keyboard event, as the watcher classifies it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Key {
    /// What the key typed, layout applied (`NSEvent.characters`).
    Text(String),
    /// One character taken back.
    Backspace,
    /// Anything that moves the caret or leaves the field (arrows, Enter,
    /// Tab, Escape, a Cmd or Ctrl combo, a click elsewhere): the buffer
    /// no longer describes what is before the caret.
    Reset,
}

/// A keyword just completed: which snippet, and how many characters (the
/// prefix included) to delete before pasting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hit {
    pub index: usize,
    pub typed: usize,
}

/// The last characters typed in the app in front, matched against the
/// keywords after every key.
#[derive(Debug, Default)]
pub struct Matcher {
    buf: String,
    app: Option<String>,
    pub prefix: Prefix,
}

impl Matcher {
    pub fn new(prefix: Prefix) -> Self {
        Matcher { buf: String::new(), app: None, prefix }
    }

    /// The buffer as it stands, for tests and the log.
    pub fn buffer(&self) -> &str {
        &self.buf
    }

    pub fn reset(&mut self) {
        self.buf.clear();
    }

    /// One key in `app`; a change of app empties the buffer first. Answers
    /// the hit the key completed, if any; the buffer is emptied on a hit
    /// (the keyword is about to be deleted and replaced).
    pub fn feed(&mut self, key: Key, app: Option<&str>, snippets: &[Snippet]) -> Option<Hit> {
        if self.app.as_deref() != app {
            self.app = app.map(str::to_string);
            self.buf.clear();
        }
        match key {
            Key::Reset => {
                self.buf.clear();
                None
            }
            Key::Backspace => {
                self.buf.pop();
                None
            }
            Key::Text(t) => {
                self.buf.push_str(&t);
                while self.buf.chars().count() > MAX_BUF {
                    self.buf.remove(0);
                }
                let hit = self.hit(snippets);
                if hit.is_some() {
                    self.buf.clear();
                }
                hit
            }
        }
    }

    /// The longest keyword the buffer ends with, under the prefix rule.
    fn hit(&self, snippets: &[Snippet]) -> Option<Hit> {
        let mut best: Option<Hit> = None;
        for (index, s) in snippets.iter().enumerate() {
            let k = s.keyword.trim();
            if k.is_empty() {
                continue;
            }
            let wanted = format!("{}{}", self.prefix.text(), k);
            let Some(before) = self.buf.strip_suffix(wanted.as_str()) else { continue };
            if self.prefix == Prefix::None && !boundary(before.chars().next_back()) {
                continue;
            }
            let typed = wanted.chars().count();
            if best.as_ref().is_none_or(|b| typed > b.typed) {
                best = Some(Hit { index, typed });
            }
        }
        best
    }
}

/// The local wall clock, for `{date}` and `{time}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Clock {
    pub y: i32,
    pub m: u32,
    pub d: u32,
    pub hh: u32,
    pub mm: u32,
}

impl Clock {
    /// Now, in the local time zone (libc `localtime_r`).
    pub fn now() -> Clock {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64);
        let t: libc::time_t = secs as libc::time_t;
        // SAFETY: a zeroed tm is a valid out-param; localtime_r fills it.
        let tm = unsafe {
            let mut tm: libc::tm = std::mem::zeroed();
            libc::localtime_r(&t, &mut tm);
            tm
        };
        Clock { y: tm.tm_year + 1900, m: (tm.tm_mon + 1) as u32, d: tm.tm_mday as u32, hh: tm.tm_hour as u32, mm: tm.tm_min as u32 }
    }

    fn date(&self) -> String {
        format!("{:04}-{:02}-{:02}", self.y, self.m, self.d)
    }

    fn time(&self) -> String {
        format!("{:02}:{:02}", self.hh, self.mm)
    }
}

/// What the placeholders read: the clipboard's text (asked once, only for
/// `{clipboard}`), the clock, fresh ids.
pub struct Sources<'a> {
    pub clipboard: &'a dyn Fn() -> Option<String>,
    pub clock: Clock,
    pub uuid: &'a dyn Fn() -> String,
}

/// The text with its placeholders filled, and where the caret goes: the
/// number of characters after `{cursor}` (the first one; every occurrence
/// is removed), 0 for the end. `{selection}` is left alone: what is
/// selected while a keyword is being typed is the keyword. Anything else
/// in braces stays (code has braces), as the snippets palette does.
pub fn fill(text: &str, s: &Sources) -> (String, usize) {
    let clip = if text.contains("{clipboard}") { (s.clipboard)().unwrap_or_default() } else { String::new() };
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut cursor: Option<usize> = None;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(j) = rest.find('}') else {
            break;
        };
        let name = &rest[1..j];
        let replaced = match name {
            "clipboard" => Some(clip.clone()),
            "date" => Some(s.clock.date()),
            "time" => Some(s.clock.time()),
            "datetime" => Some(format!("{} {}", s.clock.date(), s.clock.time())),
            "uuid" => Some((s.uuid)()),
            "cursor" => {
                if cursor.is_none() {
                    cursor = Some(out.chars().count());
                }
                Some(String::new())
            }
            _ => None,
        };
        match replaced {
            Some(r) => {
                out.push_str(&r);
                rest = &rest[j + 1..];
            }
            None => {
                out.push('{');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    let total = out.chars().count();
    (out, cursor.map_or(0, |c| total - c))
}

/// What [`perform`] does, in order: delete the typed keyword, paste the
/// text, move the caret back for a `{cursor}`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub backspaces: usize,
    pub text: String,
    pub left: usize,
}

/// The plan for a hit on `snippet`.
pub fn plan(hit: &Hit, snippet: &Snippet, s: &Sources) -> Plan {
    let (text, left) = fill(&snippet.text, s);
    Plan { backspaces: hit.typed, text, left }
}

/// Between two synthesised keys: the app in front has to read one before
/// the next arrives, or a fast run of backspaces deletes out of order.
const KEY_GAP: Duration = Duration::from_millis(6);
/// After the paste keystroke, before the caret moves: the app has to take
/// the pasteboard's text first.
const PASTE_SETTLE: Duration = Duration::from_millis(120);
/// After the arrows: how long the pasted text stays on the pasteboard
/// before the previous contents come back.
const RESTORE_AFTER: Duration = Duration::from_millis(300);

/// Run the plan against the app in front: needs Accessibility on macOS
/// (synthesised keys), like paste. The pasteboard is restored to what it
/// held before, on a thread, once the paste has landed.
pub fn perform(p: &Plan) -> clipboard::Result<()> {
    if !crate::ax::trusted() {
        return Err(clipboard::Error::NeedsAccessibility);
    }
    let backspace = clipboard::Keystroke::parse("backspace").expect("a key");
    for _ in 0..p.backspaces {
        clipboard::send_keystroke(&backspace)?;
        std::thread::sleep(KEY_GAP);
    }
    if p.text.is_empty() {
        return Ok(());
    }
    let previous = clipboard::snapshot();
    clipboard::write_text_concealed(&p.text)?;
    clipboard::send_paste()?;
    if p.left > 0 {
        std::thread::sleep(PASTE_SETTLE);
        let left = clipboard::Keystroke::parse("left").expect("a key");
        for _ in 0..p.left {
            clipboard::send_keystroke(&left)?;
            std::thread::sleep(KEY_GAP);
        }
    }
    let secret = p.text.clone();
    std::thread::Builder::new()
        .name("expansion-restore".into())
        .spawn(move || {
            std::thread::sleep(RESTORE_AFTER);
            clipboard::restore(previous, &secret);
        })
        .map(|_| ())
        .map_err(clipboard::Error::Io)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippets() -> Vec<Snippet> {
        vec![
            Snippet { name: "Signature".into(), keyword: "sig".into(), text: "Best,\nAda".into() },
            Snippet { name: "Long".into(), keyword: "sigil".into(), text: "long".into() },
            Snippet { name: "No keyword".into(), keyword: "".into(), text: "x".into() },
        ]
    }

    fn typed(m: &mut Matcher, s: &str, app: Option<&str>, snippets: &[Snippet]) -> Option<Hit> {
        let mut hit = None;
        for c in s.chars() {
            hit = m.feed(Key::Text(c.to_string()), app, snippets);
        }
        hit
    }

    #[test]
    fn a_prefixed_keyword_fires_at_its_last_character_and_the_longest_wins() {
        let s = snippets();
        let mut m = Matcher::new(Prefix::Semicolon);
        assert_eq!(typed(&mut m, "hello ;si", Some("a"), &s), None);
        assert_eq!(m.feed(Key::Text("g".into()), Some("a"), &s), Some(Hit { index: 0, typed: 4 }));
        assert_eq!(m.buffer(), "", "emptied on a hit");
        // `;sigil` is the longer keyword: `;sig` would have fired on the way, as it does; a keyword that is a prefix of another fires first.
        assert_eq!(typed(&mut m, "x;sigil", Some("a"), &s), None, "the buffer was cleared at ;sig, so `il` finds nothing");
        let mut m = Matcher::new(Prefix::Colon);
        assert_eq!(typed(&mut m, ":sig", Some("a"), &s), Some(Hit { index: 0, typed: 4 }));
        assert_eq!(typed(&mut m, ";sig", Some("a"), &s), None, "the other prefix is just text");
    }

    #[test]
    fn a_bare_keyword_needs_a_word_boundary() {
        let s = snippets();
        let mut m = Matcher::new(Prefix::None);
        assert_eq!(typed(&mut m, "sig", Some("a"), &s), Some(Hit { index: 0, typed: 3 }), "at the start");
        assert_eq!(typed(&mut m, "design", Some("a"), &s), None, "inside a word");
        assert_eq!(typed(&mut m, " sig", Some("a"), &s), Some(Hit { index: 0, typed: 3 }));
        assert_eq!(typed(&mut m, "(sig", Some("a"), &s), Some(Hit { index: 0, typed: 3 }));
        assert_eq!(typed(&mut m, "a_sig", Some("a"), &s), None, "an underscore joins a word");
    }

    #[test]
    fn backspace_takes_a_character_back_and_resets_and_app_changes_empty_the_buffer() {
        let s = snippets();
        let mut m = Matcher::new(Prefix::Semicolon);
        typed(&mut m, ";sx", Some("a"), &s);
        m.feed(Key::Backspace, Some("a"), &s);
        assert_eq!(m.buffer(), ";s");
        assert_eq!(typed(&mut m, "ig", Some("a"), &s), Some(Hit { index: 0, typed: 4 }));
        typed(&mut m, ";si", Some("a"), &s);
        assert_eq!(m.feed(Key::Reset, Some("a"), &s), None);
        assert_eq!(typed(&mut m, "g", Some("a"), &s), None, "an arrow in between: the keyword is not before the caret");
        typed(&mut m, ";si", Some("a"), &s);
        assert_eq!(typed(&mut m, "g", Some("b"), &s), None, "another app: its own buffer");
        assert_eq!(m.buffer(), "g");
        let long = "x".repeat(MAX_BUF + 10);
        typed(&mut m, &long, Some("b"), &s);
        assert_eq!(m.buffer().chars().count(), MAX_BUF);
    }

    #[test]
    fn prefix_spellings() {
        assert_eq!(Prefix::parse("none"), Prefix::None);
        assert_eq!(Prefix::parse(""), Prefix::None);
        assert_eq!(Prefix::parse(";"), Prefix::Semicolon);
        assert_eq!(Prefix::parse(":"), Prefix::Colon);
        assert_eq!(Prefix::parse("what"), Prefix::Semicolon, "the default");
    }

    fn sources<'a>(clip: &'a dyn Fn() -> Option<String>, uuid: &'a dyn Fn() -> String) -> Sources<'a> {
        Sources { clipboard: clip, clock: Clock { y: 2026, m: 9, d: 17, hh: 9, mm: 5 }, uuid }
    }

    #[test]
    fn placeholders_are_filled_and_the_cursor_counts_from_the_end() {
        let clip = || Some("pasted".to_string());
        let uuid = || "u-1".to_string();
        let s = sources(&clip, &uuid);
        assert_eq!(fill("on {date} at {time} ({datetime}) {uuid} {clipboard}", &s), ("on 2026-09-17 at 09:05 (2026-09-17 09:05) u-1 pasted".to_string(), 0));
        assert_eq!(fill("Dear {cursor},\nBest", &s), ("Dear ,\nBest".to_string(), 6));
        assert_eq!(fill("{cursor}", &s), (String::new(), 0));
        assert_eq!(fill("a{cursor}b{cursor}c", &s), ("abc".to_string(), 2), "the first cursor counts, every one goes");
        assert_eq!(fill("fn x() { return {y}; } {selection}", &s), ("fn x() { return {y}; } {selection}".to_string(), 0), "unknown braces stay");
        assert_eq!(fill("{unclosed", &s), ("{unclosed".to_string(), 0));
        assert_eq!(fill("héllo {cursor}wörld", &s), ("héllo wörld".to_string(), 5), "characters, not bytes");
        let none = || None;
        assert_eq!(fill("[{clipboard}]", &sources(&none, &uuid)), ("[]".to_string(), 0), "an empty clipboard is empty text");
    }

    #[test]
    fn the_plan_deletes_what_was_typed_and_pastes_the_filled_text() {
        let clip = || None;
        let uuid = || "u".to_string();
        let s = sources(&clip, &uuid);
        let p = plan(&Hit { index: 0, typed: 4 }, &Snippet { name: "n".into(), keyword: "sig".into(), text: "Hi {cursor}!".into() }, &s);
        assert_eq!(p, Plan { backspaces: 4, text: "Hi !".into(), left: 1 });
    }

    #[test]
    fn the_clock_reads_a_plausible_local_time() {
        let c = Clock::now();
        assert!(c.y >= 2026 && (1..=12).contains(&c.m) && (1..=31).contains(&c.d) && c.hh < 24 && c.mm < 60);
        assert_eq!(c.date().len(), 10);
        assert_eq!(c.time().len(), 5);
    }
}
