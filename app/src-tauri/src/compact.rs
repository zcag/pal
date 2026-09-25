//! Compact mode (`[general] compact`): the panel window narrowed to
//! [`WIDTH`] logical px (the page draws the 32 px rows and folds the
//! footer into the search row on its own, from `data-density` set by
//! theme.ts off the same config event), and back to tauri.conf.json's
//! width when the key goes. Applied at startup and on every reload that
//! flips the key (the panel's own cmd+shift+m writes the key, so it takes
//! this path too); a visible panel is re-placed at once, a hidden one
//! lands right on its next show (`place` reads the outer size).
//!
//! A game's panel (`[palettes.<id>] panel`, core's `PanelMode`): while a
//! game page is on top the panel can be big ([`ENLARGED`] of its monitor's
//! work area each way, centred) or in the corner ([`CORNER`], the work
//! area's bottom-right). The page asks with `panel_mode` on entering the
//! level (no mode: the palette's remembered one) and on each toggle
//! (cmd+shift+f, cmd+shift+j: the mode, written to the palette's config so
//! the game opens that way again); leaving the level asks for normal. A
//! mode outlives a hide: a show that keeps the level (pop to root) lands in
//! it, a show that starts over is normal before it paints (`on_show`), so
//! the panel never jumps on a show.

use std::sync::Mutex;

use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};

use pal_core::config::{instance, PanelMode};

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

/// The big panel's share of the work area, each way.
const ENLARGED: f64 = 0.9;
/// The corner panel's size and its gap to the work area's edges, logical px:
/// compact's width, and tall enough for a game page's body at about 520 by 290.
const CORNER: (f64, f64) = (WIDTH, 380.0);
const MARGIN: f64 = 16.0;
/// The mode the panel is in and, out of normal, where it stood before.
static MODE: Mutex<(PanelMode, Option<PhysicalPosition<i32>>)> = Mutex::new((PanelMode::Normal, None));

/// The panel for a game level: `palette` (`extension/palette`) with no
/// `mode` is its remembered mode; a `mode` with it is also remembered; no
/// palette is `mode` or normal, not remembered. Returns the mode applied.
#[tauri::command]
pub fn panel_mode(app: AppHandle, palette: Option<String>, mode: Option<PanelMode>) -> PanelMode {
    let id = palette.as_deref().and_then(|p| p.split_once('/')).map(|(e, p)| instance::palette_id(e, p));
    let mode = match (mode, &id) {
        (Some(m), Some(id)) => {
            let key = format!("palettes.\"{id}\".panel");
            if let Err(e) = settings::write(&app, &key, serde_json::to_value(m).ok()) {
                eprintln!("compact\tremember failed\t{e}");
            }
            m
        }
        (Some(m), None) => m,
        (None, Some(id)) => settings::config(&app).palette(id).panel.unwrap_or_default(),
        (None, None) => PanelMode::Normal,
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || set(&handle, mode));
    mode
}

/// A show from hidden: one that starts over is normal first, where `place`
/// then puts it (lib.rs `show_with`).
pub fn on_show(app: &AppHandle, keep: bool) {
    let mut st = MODE.lock().unwrap();
    if keep || st.0 == PanelMode::Normal {
        return;
    }
    *st = (PanelMode::Normal, None);
    drop(st);
    normal_size(app);
    eprintln!("compact\tmode\tnormal (a fresh show)");
}

/// `place` for a panel out of normal: its mode laid out again on the
/// monitor under the cursor; false in normal, which `place` handles.
pub fn place(app: &AppHandle) -> bool {
    let mode = MODE.lock().unwrap().0;
    mode != PanelMode::Normal && lay(app, mode)
}

fn set(app: &AppHandle, mode: PanelMode) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let mut st = MODE.lock().unwrap();
    if st.0 == mode {
        return;
    }
    if mode == PanelMode::Normal {
        let before = st.1.take();
        st.0 = mode;
        normal_size(app);
        if let Some(p) = before {
            let _ = w.set_position(p);
        }
        return eprintln!("compact\tmode\tnormal");
    }
    let before = if st.0 == PanelMode::Normal { w.outer_position().ok() } else { st.1 };
    if lay(app, mode) {
        *st = (mode, before);
    }
}

fn normal_size(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let (width, height) = size(settings::config(app).general.compact, configured(app));
    if let Err(e) = panel::resize(&w, LogicalSize::new(width, height)) {
        eprintln!("compact\tresize failed\t{e}");
    }
}

/// Sizes and places the panel for `mode` on the monitor `place` would use.
fn lay(app: &AppHandle, mode: PanelMode) -> bool {
    let Some(w) = app.get_webview_window(WINDOW) else { return false };
    let Some(m) = crate::monitor(app, &w) else { return false };
    let (a, scale) = (m.work_area(), m.scale_factor());
    let area = (a.position.x as f64, a.position.y as f64, a.size.width as f64, a.size.height as f64);
    let Some((x, y, pw, ph)) = frame(mode, area, scale) else { return false };
    if let Err(e) = panel::resize(&w, LogicalSize::new(pw / scale, ph / scale)) {
        eprintln!("compact\tresize failed\t{e}");
        return false;
    }
    let _ = w.set_position(PhysicalPosition::new(x as i32, y as i32));
    eprintln!("compact\tmode\t{mode:?}\t{:.0}x{:.0}", pw / scale, ph / scale);
    true
}

/// The panel's frame for a mode in a work area (`x, y, width, height`, all
/// physical px): big is centred, corner sits `MARGIN` in from the
/// bottom-right; `None` for normal, which `place` lays out.
fn frame(mode: PanelMode, (x, y, w, h): (f64, f64, f64, f64), scale: f64) -> Option<(f64, f64, f64, f64)> {
    match mode {
        PanelMode::Normal => None,
        PanelMode::Big => {
            let (pw, ph) = (w * ENLARGED, h * ENLARGED);
            Some((x + (w - pw) / 2.0, y + (h - ph) / 2.0, pw, ph))
        }
        PanelMode::Corner => {
            let (pw, ph, m) = (CORNER.0 * scale, CORNER.1 * scale, MARGIN * scale);
            Some((x + w - pw - m, y + h - ph - m, pw, ph))
        }
    }
}

fn apply(app: &AppHandle, compact: bool) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    // A flip out of normal: the mode's size from here, where it stands.
    *MODE.lock().unwrap() = (PanelMode::Normal, None);
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

    #[test]
    fn big_is_centred_and_corner_sits_bottom_right() {
        let area = (0.0, 50.0, 3000.0, 1800.0);
        assert_eq!(frame(PanelMode::Normal, area, 2.0), None);
        assert_eq!(frame(PanelMode::Big, area, 2.0), Some((150.0, 140.0, 2700.0, 1620.0)));
        // 560x380 logical at 2x, 16 in from the right and the bottom
        assert_eq!(frame(PanelMode::Corner, area, 2.0), Some((3000.0 - 1120.0 - 32.0, 50.0 + 1800.0 - 760.0 - 32.0, 1120.0, 760.0)));
    }
}
