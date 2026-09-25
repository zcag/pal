//! Compact mode (`[general] compact`): the panel window narrowed to
//! [`WIDTH`] logical px (the page draws the 32 px rows and folds the
//! footer into the search row on its own, from `data-density` set by
//! theme.ts off the same config event), and back to tauri.conf.json's
//! width when the key goes. Applied at startup and on every reload that
//! flips the key (the panel's own cmd+shift+m writes the key, so it takes
//! this path too); a visible panel is re-placed at once, a hidden one
//! lands right on its next show (`place` reads the outer size).
//!
//! Enlarged (`panel_enlarge`, cmd+shift+f on a game's level): the panel
//! grown to [`ENLARGED`] of its monitor's work area each way and centred,
//! for a game played from further back. Only on that ask; the level left
//! or the panel hidden, it goes back to the mode's size where it stood.

use std::sync::Mutex;

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};

use crate::{panel, settings, WINDOW};

/// The compact panel's width, logical px (tokens.css `--pal-panel-w` under `data-density="compact"`).
pub const WIDTH: f64 = 560.0;

/// tauri.conf.json's size for the main window: what full mode goes back to.
fn configured(app: &AppHandle) -> (f64, f64) {
    app.config().app.windows.iter().find(|w| w.label == WINDOW).map_or((760.0, 480.0), |w| (w.width, w.height))
}

/// The window's logical size for the mode.
pub fn size(compact: bool, full: (f64, f64)) -> (f64, f64) {
    if compact { (WIDTH, full.1) } else { full }
}

/// The enlarged panel's share of the work area, each way.
const ENLARGED: f64 = 0.9;
/// While enlarged: where the panel stood before, to go back to.
static BEFORE: Mutex<Option<PhysicalPosition<i32>>> = Mutex::new(None);

/// The panel enlarged or back to the mode's size; a no-op when it already is.
#[tauri::command]
pub fn panel_enlarge(app: AppHandle, on: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || enlarge(&handle, on));
}

/// The panel hid: back to the mode's size (panel/*.rs `hide`).
pub fn on_hidden(app: &AppHandle) {
    enlarge(app, false);
}

fn enlarge(app: &AppHandle, on: bool) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let mut before = BEFORE.lock().unwrap();
    if on == before.is_some() {
        return;
    }
    if !on {
        let (width, height) = size(settings::config(app).general.compact, configured(app));
        let _ = panel::resize(&w, LogicalSize::new(width, height));
        if let Some(p) = before.take() {
            let _ = w.set_position(p);
        }
        return eprintln!("compact\tenlarged off");
    }
    let (Ok(pos), Some(m)) = (w.outer_position(), w.current_monitor().ok().flatten()) else { return };
    let (area, scale) = (m.work_area(), m.scale_factor());
    let (pw, ph) = (area.size.width as f64 * ENLARGED, area.size.height as f64 * ENLARGED);
    if let Err(e) = panel::resize(&w, LogicalSize::new(pw / scale, ph / scale)) {
        return eprintln!("compact\tenlarge failed\t{e}");
    }
    let _ = w.set_position(PhysicalPosition::new(area.position.x + ((area.size.width as f64 - pw) / 2.0) as i32, area.position.y + ((area.size.height as f64 - ph) / 2.0) as i32));
    *before = Some(pos);
    eprintln!("compact\tenlarged\t{:.0}x{:.0}", pw / scale, ph / scale);
}

fn apply(app: &AppHandle, compact: bool) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    // A flip while enlarged: the mode's size from here, where it stands.
    BEFORE.lock().unwrap().take();
    let (width, height) = size(compact, configured(app));
    if let Err(e) = panel::resize(&w, LogicalSize::new(width, height)) {
        return eprintln!("compact\tresize failed\t{e}");
    }
    eprintln!("compact\t{}\t{width}x{height}", if compact { "on" } else { "off" });
    if panel::is_visible(app) {
        crate::place(app);
    }
}

/// Startup: the size the config asks for.
pub fn install(app: &AppHandle) {
    if settings::config(app).general.compact {
        apply(app, true);
    }
}

/// A config reload: the window follows a flipped key.
pub fn apply_config(app: &AppHandle, prev: &pal_core::config::Config, next: &pal_core::config::Config) {
    if prev.general.compact != next.general.compact {
        apply(app, next.general.compact);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_narrows_and_keeps_the_height() {
        assert_eq!(size(true, (760.0, 480.0)), (560.0, 480.0));
        assert_eq!(size(false, (760.0, 480.0)), (760.0, 480.0));
    }
}
