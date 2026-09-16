//! The text the frontmost app has selected, for `{selection}` in a snippet
//! and for extensions that act on what the user marked (define, translate,
//! search). Two ways in: the accessibility API (`AXFocusedUIElement` then
//! `AXSelectedText`, macOS; the primary selection on Linux, which is the
//! selected text by convention), and a copy-shortcut snapshot
//! ([`crate::clipboard::selection_snapshot`]) when the API answers nothing
//! and the caller allows it. Both need Accessibility on macOS.

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

#[cfg(target_os = "macos")]
mod platform {
    use crate::ax::element::Element;

    pub fn ax_selected_text() -> Option<String> {
        Element::system_wide()?.focused_element()?.selected_text()
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
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    pub fn ax_selected_text() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
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
