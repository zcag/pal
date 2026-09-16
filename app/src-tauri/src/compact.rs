//! Compact mode (`[general] compact`): the panel window narrowed to
//! [`WIDTH`] logical px (the page draws the 32 px rows and folds the
//! footer into the search row on its own, from `data-density` set by
//! theme.ts off the same config event), and back to tauri.conf.json's
//! width when the key goes. Applied at startup and on every reload that
//! flips the key (the panel's own cmd+shift+m writes the key, so it takes
//! this path too); a visible panel is re-placed at once, a hidden one
//! lands right on its next show (`place` reads the outer size).

use tauri::{AppHandle, LogicalSize, Manager};

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

fn apply(app: &AppHandle, compact: bool) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let (width, height) = size(compact, configured(app));
    if let Err(e) = w.set_size(LogicalSize::new(width, height)) {
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
