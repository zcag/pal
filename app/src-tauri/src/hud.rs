//! The HUD: a one-line confirmation ("Copied") for a pick with no other
//! feedback once the panel has hidden. Its own tiny window (`hud`,
//! `index.html?hud`), transparent, never key, mouse passing through, at
//! the bottom centre of the monitor under the cursor; kept alive hidden
//! like the panel (`panel::hud_install`), so a show is an alpha flip and
//! the capsule's own entrance. Timing is the brief's: 120 ms in, 900 ms
//! hold, 240 ms out; the page runs the motion off `pal://hud`, this side
//! shows the window and hides it once the out has ended. A new `show`
//! restarts the clock.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition};

use crate::{events, panel};

pub const WINDOW: &str = "hud";

/// The brief's HUD motion (tokens.css `--pal-dur-base`, `--pal-dur-hud-hold`,
/// `--pal-dur-hud-out`); the page hides the capsule after in + hold, the
/// window follows once the out is over.
const IN: Duration = Duration::from_millis(120);
const HOLD: Duration = Duration::from_millis(900);
const OUT: Duration = Duration::from_millis(240);
/// Room for the compositor to finish the last out frame before alpha 0.
const SLACK: Duration = Duration::from_millis(60);
/// Gap between the capsule's window and the bottom of the work area; the
/// capsule sits 24 px inside the window (ui.css `.pal-hud-page`), so it
/// reads about 32 px above the Dock or panel edge.
const MARGIN: i32 = 8;

/// Counts shows; the hide timer of an earlier show finds the count moved on
/// and leaves the window to the later one.
static SHOWS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
struct Payload<'a> {
    text: &'a str,
}

/// Show `text` for the hold, then hide. Safe from any thread.
pub fn show(app: &AppHandle, text: &str) {
    let n = SHOWS.fetch_add(1, Ordering::Relaxed) + 1;
    events::emit_to(app, WINDOW, events::HUD, Payload { text });
    let handle = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        place(&handle);
        panel::hud_show(&handle);
    }) {
        eprintln!("hud\tshow failed\t{e}");
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IN + HOLD + OUT + SLACK).await;
        if SHOWS.load(Ordering::Relaxed) == n {
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || panel::hud_hide(&h));
        }
    });
}

/// The monitor under the cursor, when the platform can say (not Wayland).
pub(crate) fn monitor_at_cursor(app: &AppHandle) -> Option<Monitor> {
    let c = app.cursor_position().ok()?;
    app.monitor_from_point(c.x, c.y).ok().flatten()
}

/// Bottom centre of the work area of the monitor under the cursor, else of
/// the panel's monitor. No-op on Wayland (`set_position` does nothing there;
/// the compositor rule places, `panel/linux.rs`).
fn place(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let monitor = monitor_at_cursor(app)
        .or_else(|| app.get_webview_window(crate::WINDOW).and_then(|p| p.current_monitor().ok().flatten()));
    let (Some(m), Ok(size)) = (monitor, w.outer_size()) else { return };
    let area = m.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - MARGIN;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}
