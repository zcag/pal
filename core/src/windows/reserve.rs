//! A strip along the top of every display that windows keep clear of: a
//! bar drawn by another program (sketchybar) over a hidden menu bar, where
//! macOS reserves nothing, so a zoom or a fresh window lands under it.
//! [`set`] is the strip's height in points, 0 when off; the app's
//! keep-below-bar watcher sets it. [`super::displays`] takes it off every
//! `visible_frame`, so pal's own layouts land below it, and [`clear`] is
//! the frame a window that landed under it anyway is moved to.

use std::sync::atomic::{AtomicU64, Ordering};

use super::{Display, Rect};

/// The strip's height, as `f64` bits.
static TOP: AtomicU64 = AtomicU64::new(0);

/// A window whose top is this close to the floor already counts as clear:
/// an app rounds, a border sits a point proud.
const SLACK: f64 = 1.0;
/// Keeping the bottom edge never leaves a window shorter than this; a
/// short window is moved down whole instead.
const MIN_HEIGHT: f64 = 120.0;

pub fn set(points: f64) {
    TOP.store(points.max(0.0).to_bits(), Ordering::Relaxed);
}

pub fn get() -> f64 {
    f64::from_bits(TOP.load(Ordering::Relaxed))
}

/// `d` with the strip taken off its `visible_frame`. What the system keeps
/// already counts: on a notched display macOS reserves the notch's height
/// itself, so a bar no taller than that takes nothing more.
pub fn apply(mut d: Display, top: f64) -> Display {
    let floor = d.frame.y + top;
    let v = &mut d.visible_frame;
    if floor > v.y {
        v.h = (v.h - (floor - v.y)).max(0.0);
        v.y = floor;
    }
    d
}

/// Where `w` goes so it is clear of the strip on the display its top edge
/// is on (the middle of it): its top moved down to that display's visible
/// top, its bottom edge kept, or the whole window moved down when keeping
/// the bottom would leave it shorter than [`MIN_HEIGHT`]. `None` when it is
/// clear already or its top is on no display. `displays` are as
/// [`super::displays`] gives them, the strip taken off.
pub fn clear(w: &Rect, displays: &[Display]) -> Option<Rect> {
    let d = displays.iter().find(|d| d.frame.contains(w.x + w.w / 2.0, w.y))?;
    let floor = d.visible_frame.y;
    if w.y >= floor - SLACK {
        return None;
    }
    let bottom = w.y + w.h;
    Some(if bottom - floor >= MIN_HEIGHT { Rect { y: floor, h: bottom - floor, ..*w } } else { Rect { y: floor, ..*w } })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(y: f64, visible_top: f64) -> Display {
        Display { id: "1".into(), frame: Rect { x: 0.0, y, w: 2560.0, h: 1440.0 }, visible_frame: Rect { x: 0.0, y: y + visible_top, w: 2560.0, h: 1440.0 - visible_top }, primary: true }
    }

    #[test]
    fn apply_takes_the_strip_off_what_the_system_leaves() {
        // A hidden menu bar: the system keeps nothing, the strip is all of it.
        let d = apply(display(0.0, 0.0), 26.0);
        assert_eq!(d.visible_frame, Rect { x: 0.0, y: 26.0, w: 2560.0, h: 1414.0 });
        // The notch's 38 already reserved: a 26 bar takes nothing more, a 44 one the difference.
        assert_eq!(apply(display(0.0, 38.0), 26.0).visible_frame.y, 38.0);
        let d = apply(display(0.0, 38.0), 44.0);
        assert_eq!((d.visible_frame.y, d.visible_frame.h), (44.0, 1396.0));
        // Off: as the system gave it.
        assert_eq!(apply(display(0.0, 0.0), 0.0), display(0.0, 0.0));
    }

    #[test]
    fn clear_keeps_the_bottom_edge() {
        let ds = [apply(display(0.0, 0.0), 26.0)];
        // A zoom to the whole screen: the top moves down, the bottom stays.
        assert_eq!(clear(&Rect { x: 0.0, y: 0.0, w: 2560.0, h: 1440.0 }, &ds), Some(Rect { x: 0.0, y: 26.0, w: 2560.0, h: 1414.0 }));
        // Clear already, or a point proud of it.
        assert_eq!(clear(&Rect { x: 100.0, y: 26.0, w: 800.0, h: 600.0 }, &ds), None);
        assert_eq!(clear(&Rect { x: 100.0, y: 25.5, w: 800.0, h: 600.0 }, &ds), None);
        assert_eq!(clear(&Rect { x: 100.0, y: 300.0, w: 800.0, h: 600.0 }, &ds), None);
    }

    #[test]
    fn clear_moves_a_short_window_whole() {
        let ds = [apply(display(0.0, 0.0), 26.0)];
        assert_eq!(clear(&Rect { x: 100.0, y: 10.0, w: 400.0, h: 100.0 }, &ds), Some(Rect { x: 100.0, y: 26.0, w: 400.0, h: 100.0 }));
    }

    #[test]
    fn clear_uses_the_display_the_top_edge_is_on() {
        // A second display below the first: a window at its top is under that display's strip.
        let ds = [apply(display(0.0, 0.0), 26.0), apply(display(1440.0, 0.0), 26.0)];
        assert_eq!(clear(&Rect { x: 0.0, y: 1440.0, w: 800.0, h: 600.0 }, &ds), Some(Rect { x: 0.0, y: 1466.0, w: 800.0, h: 574.0 }));
        // Low on the first display: clear.
        assert_eq!(clear(&Rect { x: 0.0, y: 1000.0, w: 800.0, h: 600.0 }, &ds), None);
        // Off every display.
        assert_eq!(clear(&Rect { x: 9000.0, y: 0.0, w: 800.0, h: 600.0 }, &ds), None);
    }
}
