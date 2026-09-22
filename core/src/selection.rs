//! What the frontmost app has selected: its text, for `{selection}` in a
//! snippet and for extensions that act on what the user marked (define,
//! translate, search), and the files marked in the file manager in front,
//! for the Finder Selection palette, Quick Look and the image tools.
//!
//! Text ([`text`]), two ways in: the accessibility API (`AXFocusedUIElement`
//! then `AXSelectedText`, macOS; the primary selection on Linux, which is
//! the selected text by convention), and a copy-shortcut snapshot
//! ([`crate::clipboard::selection_snapshot`]) when the API answers nothing
//! and the caller allows it. Both need Accessibility on macOS.
//!
//! Files ([`files`]): Finder's `selection` over `osascript`, only while
//! Finder is the app in front (the panel does not activate pal, so it
//! still is with the panel up), as POSIX paths; empty otherwise, and on
//! Linux, where no file manager exposes its selection portably. The
//! script's output is [`parse_finder_selection`]'s, pure and tested.

use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// macOS: the accessibility API and the copy shortcut both need it.
    #[error("reading the selection needs Accessibility permission")]
    NeedsAccessibility,
    #[error("selection unavailable: {0}")]
    Unavailable(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// How long the snapshot waits for the app to answer the copy shortcut.
const SNAPSHOT_WAIT: Duration = Duration::from_millis(300);

/// The selected text, or `None` when nothing is selected. `snapshot`
/// allows the Cmd+C fallback when the accessibility read answers nothing
/// (an app whose text fields do not speak AX: Electron, some Java); it
/// touches the clipboard for a moment, so it is a setting.
pub fn text(snapshot: bool) -> Result<Option<String>> {
    if !crate::ax::trusted() {
        return Err(Error::NeedsAccessibility);
    }
    if let Some(t) = platform::ax_selected_text() {
        return Ok(Some(t));
    }
    if !snapshot {
        return Ok(None);
    }
    crate::clipboard::selection_snapshot(SNAPSHOT_WAIT).map_err(|e| match e {
        crate::clipboard::Error::NeedsAccessibility => Error::NeedsAccessibility,
        e => Error::Unavailable(e.to_string()),
    })
}

/// The files selected in the file manager in front, as absolute paths in
/// Finder's order: the front window's marked items, or the Desktop's when
/// no window is up. Empty when Finder is not the app in front, when
/// nothing is marked (a window showing a folder with nothing selected is
/// nothing, not the folder), and off macOS. One `osascript` run
/// (~100 ms on hornet), so the app caches it per panel show.
pub fn files() -> Vec<String> {
    platform::finder_selection()
}

/// The AppleScript behind [`files`]: the front window's target folder on
/// the first line (blank on the Desktop or with no window), then one
/// selected item per line, folders with a trailing slash. `POSIX path`
/// is coerced outside the Finder block: inside it Finder answers a
/// reference's name before its path.
pub const FINDER_SELECTION_SCRIPT: &str = r#"tell application "Finder"
  set sel to selection as alias list
  try
    set tgt to POSIX path of (target of front Finder window as alias)
  on error
    set tgt to ""
  end try
end tell
set out to {}
repeat with a in sel
  set end of out to POSIX path of a
end repeat
set AppleScript's text item delimiters to linefeed
return tgt & linefeed & (out as text)"#;

/// [`FINDER_SELECTION_SCRIPT`]'s output as paths: the trailing slash off a
/// folder, blank lines and repeats dropped. A lone selected folder that is
/// the front window's own target is what column view reports for the
/// folder being looked at, not a choice: nothing.
pub fn parse_finder_selection(out: &str) -> Vec<String> {
    let mut lines = out.lines().map(|l| l.strip_suffix('/').filter(|s| !s.is_empty()).unwrap_or(l));
    let target = lines.next().unwrap_or_default();
    let mut paths: Vec<String> = Vec::new();
    for l in lines.filter(|l| !l.is_empty()) {
        if !paths.iter().any(|p| p == l) {
            paths.push(l.to_string());
        }
    }
    if paths.len() == 1 && !target.is_empty() && paths[0] == target {
        paths.clear();
    }
    paths
}

#[cfg(target_os = "macos")]
mod platform {
    use crate::ax::element::Element;
    use objc2_app_kit::NSWorkspace;

    pub fn ax_selected_text() -> Option<String> {
        Element::system_wide()?.focused_element()?.selected_text()
    }

    const FINDER: &str = "com.apple.finder";

    /// Finder's selection while Finder is in front; nothing otherwise, and
    /// nothing when the script fails (Automation refused, Finder not
    /// answering within `OSASCRIPT_SECS`), logged.
    pub fn finder_selection() -> Vec<String> {
        let front = NSWorkspace::sharedWorkspace().frontmostApplication().and_then(|a| a.bundleIdentifier()).map(|s| s.to_string());
        if front.as_deref() != Some(FINDER) {
            return Vec::new();
        }
        match crate::tool::osascript(super::FINDER_SELECTION_SCRIPT) {
            Ok(out) => super::parse_finder_selection(&out),
            Err(e) => {
                eprintln!("selection\tfinder\t{e}");
                Vec::new()
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    /// The primary selection: what is highlighted, on X11 and on Wayland
    /// compositors that offer it over data-control.
    pub fn ax_selected_text() -> Option<String> {
        use arboard::{GetExtLinux, LinuxClipboardKind};
        let mut cb = arboard::Clipboard::new().ok()?;
        cb.get().clipboard(LinuxClipboardKind::Primary).text().ok().filter(|t| !t.is_empty())
    }

    /// No file manager exposes its selection portably (Nautilus, Dolphin and Thunar each keep it to themselves).
    pub fn finder_selection() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    pub fn ax_selected_text() -> Option<String> {
        None
    }
    pub fn finder_selection() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::parse_finder_selection;

    /// The script's output on hornet: the window's folder first, a folder and a file marked in it, a space in a name.
    #[test]
    fn finder_selection_is_the_marked_items_without_the_folder_slash() {
        let out = "/Users/x/Documents/\n/Users/x/Documents/sub/\n/Users/x/Documents/a b.txt\n";
        assert_eq!(parse_finder_selection(out), ["/Users/x/Documents/sub", "/Users/x/Documents/a b.txt"]);
        assert_eq!(parse_finder_selection("/Users/x/Desktop/\n/Users/x/Desktop/shot.png"), ["/Users/x/Desktop/shot.png"], "no trailing newline");
        assert_eq!(parse_finder_selection("\n/Users/x/Desktop/shot.png\n/Users/x/Desktop/shot.png\n"), ["/Users/x/Desktop/shot.png"], "the Desktop has no window (no target) and a repeat is one");
        assert_eq!(parse_finder_selection("/\n/Applications/\n"), ["/Applications"], "a folder marked at the root: the root's own slash stays");
    }

    #[test]
    fn nothing_marked_is_nothing_and_the_shown_folder_is_not_a_choice() {
        assert_eq!(parse_finder_selection("/Users/x/Documents/\n"), Vec::<String>::new(), "a window with nothing marked");
        assert_eq!(parse_finder_selection("/Users/x/Documents/"), Vec::<String>::new());
        assert_eq!(parse_finder_selection(""), Vec::<String>::new(), "no Finder window, nothing on the Desktop");
        assert_eq!(parse_finder_selection("/Users/x/Documents/sub/\n/Users/x/Documents/sub/\n"), Vec::<String>::new(), "column view: the folder being looked at is the window's target, not a choice");
        assert_eq!(parse_finder_selection("/Users/x/Documents/sub/\n/Users/x/Documents/sub/\n/Users/x/Documents/sub/a.txt\n"), ["/Users/x/Documents/sub", "/Users/x/Documents/sub/a.txt"], "with a second item it is a real mark");
    }

    /// Needs a desktop and Accessibility: `cargo test -p pal-core -- --ignored --nocapture selection_read_timing`.
    /// Prints how long the accessibility read takes against whatever is in front.
    #[test]
    #[ignore]
    fn selection_read_timing() {
        for _ in 0..3 {
            let t = std::time::Instant::now();
            let r = super::text(false);
            eprintln!("selection.text(false) -> {:?} in {:.1} ms", r.as_ref().map(|s| s.as_ref().map(|t| t.len())), t.elapsed().as_secs_f64() * 1000.0);
        }
    }
}
