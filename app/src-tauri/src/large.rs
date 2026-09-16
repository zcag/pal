//! Large Type: a line of text across the screen, for reading a code or an
//! address from the other side of the room (Alfred's Cmd+L). Its own
//! window (`large`, `index.html?large`), built like the HUD's (hud.rs,
//! `panel::large_install`): transparent, no decorations, kept alive
//! hidden. Unlike the HUD it takes the keyboard while up, since any key
//! dismisses it (as does a click, a focus loss, or [`HOLD`]). Reached by
//! the `large_type` effect (effects.rs) and the panel's "Show in Large
//! Type" action (`large_show`); the page (LargePage.tsx) fits the text
//! to the width and groups a code's digits.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

use crate::{events, panel};

pub const WINDOW: &str = "large";

/// Up for this long unless a key or a click ends it first.
pub const HOLD: Duration = Duration::from_secs(8);
/// The window spans the work area's width and this much of its height,
/// centred: room for a wrapped sentence, not a curtain.
const HEIGHT_FRACTION: f64 = 0.5;
/// Longer text is cut here: Large Type is for a line, not a page.
pub const MAX_CHARS: usize = 400;

static SHOWS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
struct Payload<'a> {
    text: &'a str,
}

/// What the window shows for `text`: trimmed, cut at [`MAX_CHARS`] with an
/// ellipsis; `None` for blank text (nothing to show).
pub fn prepare(text: &str) -> Option<String> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let mut chars = t.chars();
    let head: String = chars.by_ref().take(MAX_CHARS).collect();
    Some(if chars.next().is_some() { format!("{head}…") } else { head })
}

/// Show `text` until a key, a click, or [`HOLD`]. Safe from any thread.
pub fn show(app: &AppHandle, text: &str) {
    let Some(text) = prepare(text) else { return };
    let n = SHOWS.fetch_add(1, Ordering::Relaxed) + 1;
    eprintln!("large\tshow\t{} chars", text.chars().count());
    events::emit_to(app, WINDOW, events::LARGE, Payload { text: &text });
    let handle = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        place(&handle);
        panel::large_show(&handle);
    }) {
        eprintln!("large\tshow failed\t{e}");
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(HOLD).await;
        if SHOWS.load(Ordering::Relaxed) == n {
            hide(&handle);
        }
    });
}

/// Hide now (a key, a click, the hold ending, a focus loss). Safe from any thread.
pub fn hide(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || panel::large_hide(&handle));
}

/// The full width of the work area of the monitor under the cursor (else
/// the panel's), half its height, centred. No-op on Wayland, where the
/// compositor rule places (`panel/linux.rs`).
fn place(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let monitor = crate::hud::monitor_at_cursor(app)
        .or_else(|| app.get_webview_window(crate::WINDOW).and_then(|p| p.current_monitor().ok().flatten()));
    let Some(m) = monitor else { return };
    let area = m.work_area();
    let height = (area.size.height as f64 * HEIGHT_FRACTION) as u32;
    let _ = w.set_size(PhysicalSize::new(area.size.width, height));
    let y = area.position.y + (area.size.height as i32 - height as i32) / 2;
    let _ = w.set_position(PhysicalPosition::new(area.position.x, y));
}

/// The page's dismissal (a key, a click).
#[tauri::command]
pub fn large_hide(app: AppHandle) {
    hide(&app);
}

/// The panel's "Show in Large Type" action: the panel hides, the text goes up.
#[tauri::command]
pub async fn large_show(app: AppHandle, text: String) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || panel::hide(&handle));
    show(&app, &text);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepare_trims_cuts_and_refuses_blank() {
        assert_eq!(prepare("  483920\n"), Some("483920".into()));
        assert_eq!(prepare("   "), None);
        let long = "x".repeat(MAX_CHARS + 5);
        let p = prepare(&long).unwrap();
        assert_eq!(p.chars().count(), MAX_CHARS + 1);
        assert!(p.ends_with('…'));
        assert_eq!(prepare(&"y".repeat(MAX_CHARS)).unwrap().chars().count(), MAX_CHARS, "exactly the cap is not cut");
    }
}
