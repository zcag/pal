//! Where a window goes for a named layout: pure arithmetic over the
//! window's frame and the displays, no OS in it. [`super::apply`] reads the
//! frames, calls [`target`], and writes the result back.
//!
//! The grid: a display's visible frame (screen minus menu bar, Dock, bars)
//! inset by `gap` on every side is the area; halves, thirds and quarters
//! cut it into equal cells with `gap` between them. `maximize` is the whole
//! area, `almost_maximize` and `reasonable_size` a centred percentage of
//! it, `center` keeps the window's size. `next_display` / `previous_display`
//! keep the window's place relative to the visible frame on the other
//! display. `restore` needs the remembered frame and is the caller's.

use serde::{Deserialize, Serialize};

use super::{Display, Rect};

/// Every layout, in the order the palette lists them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    LeftHalf,
    RightHalf,
    TopHalf,
    BottomHalf,
    LeftThird,
    CenterThird,
    RightThird,
    LeftTwoThirds,
    RightTwoThirds,
    TopLeftQuarter,
    TopRightQuarter,
    BottomLeftQuarter,
    BottomRightQuarter,
    Maximize,
    AlmostMaximize,
    Center,
    ReasonableSize,
    NextDisplay,
    PreviousDisplay,
    Restore,
}

pub const ALL: [Layout; 20] = [
    Layout::LeftHalf,
    Layout::RightHalf,
    Layout::TopHalf,
    Layout::BottomHalf,
    Layout::LeftThird,
    Layout::CenterThird,
    Layout::RightThird,
    Layout::LeftTwoThirds,
    Layout::RightTwoThirds,
    Layout::TopLeftQuarter,
    Layout::TopRightQuarter,
    Layout::BottomLeftQuarter,
    Layout::BottomRightQuarter,
    Layout::Maximize,
    Layout::AlmostMaximize,
    Layout::Center,
    Layout::ReasonableSize,
    Layout::NextDisplay,
    Layout::PreviousDisplay,
    Layout::Restore,
];

impl Layout {
    /// The wire name, `snake_case` (`left_half`).
    pub fn name(self) -> &'static str {
        match self {
            Layout::LeftHalf => "left_half",
            Layout::RightHalf => "right_half",
            Layout::TopHalf => "top_half",
            Layout::BottomHalf => "bottom_half",
            Layout::LeftThird => "left_third",
            Layout::CenterThird => "center_third",
            Layout::RightThird => "right_third",
            Layout::LeftTwoThirds => "left_two_thirds",
            Layout::RightTwoThirds => "right_two_thirds",
            Layout::TopLeftQuarter => "top_left_quarter",
            Layout::TopRightQuarter => "top_right_quarter",
            Layout::BottomLeftQuarter => "bottom_left_quarter",
            Layout::BottomRightQuarter => "bottom_right_quarter",
            Layout::Maximize => "maximize",
            Layout::AlmostMaximize => "almost_maximize",
            Layout::Center => "center",
            Layout::ReasonableSize => "reasonable_size",
            Layout::NextDisplay => "next_display",
            Layout::PreviousDisplay => "previous_display",
            Layout::Restore => "restore",
        }
    }

    /// What the HUD says.
    pub fn title(self) -> &'static str {
        match self {
            Layout::LeftHalf => "Left Half",
            Layout::RightHalf => "Right Half",
            Layout::TopHalf => "Top Half",
            Layout::BottomHalf => "Bottom Half",
            Layout::LeftThird => "Left Third",
            Layout::CenterThird => "Center Third",
            Layout::RightThird => "Right Third",
            Layout::LeftTwoThirds => "Left Two Thirds",
            Layout::RightTwoThirds => "Right Two Thirds",
            Layout::TopLeftQuarter => "Top Left Quarter",
            Layout::TopRightQuarter => "Top Right Quarter",
            Layout::BottomLeftQuarter => "Bottom Left Quarter",
            Layout::BottomRightQuarter => "Bottom Right Quarter",
            Layout::Maximize => "Maximize",
            Layout::AlmostMaximize => "Almost Maximize",
            Layout::Center => "Center",
            Layout::ReasonableSize => "Reasonable Size",
            Layout::NextDisplay => "Next Display",
            Layout::PreviousDisplay => "Previous Display",
            Layout::Restore => "Restore",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        ALL.into_iter().find(|l| l.name() == name)
    }

    /// Moves the window to another display rather than within its own.
    pub fn changes_display(self) -> bool {
        matches!(self, Layout::NextDisplay | Layout::PreviousDisplay)
    }
}

/// The knobs, the palette's settings on the wire.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Options {
    /// Pixels (points on macOS) between the area's edge and a window, and
    /// between two windows of a split.
    pub gap: f64,
    /// `almost_maximize` fills this much of the area, centred.
    pub almost_maximize_percent: f64,
    /// `reasonable_size` likewise.
    pub reasonable_size_percent: f64,
}

impl Default for Options {
    fn default() -> Self {
        Self { gap: 0.0, almost_maximize_percent: 90.0, reasonable_size_percent: 60.0 }
    }
}

/// The display the window is on: the one holding its centre, else the one
/// it overlaps most, else the primary. `None` only with no displays.
pub fn display_of(displays: &[Display], window: &Rect) -> Option<usize> {
    let (cx, cy) = window.center();
    if let Some(i) = displays.iter().position(|d| d.frame.contains(cx, cy)) {
        return Some(i);
    }
    let by_overlap = displays.iter().enumerate().map(|(i, d)| (i, d.frame.overlap(window))).filter(|(_, a)| *a > 0.0).max_by(|a, b| a.1.total_cmp(&b.1));
    by_overlap.map(|(i, _)| i).or_else(|| displays.iter().position(|d| d.primary)).or(if displays.is_empty() { None } else { Some(0) })
}

/// The frame `layout` puts `window` at, rounded to whole pixels. `None`
/// for `restore` (the caller has the memory), with no displays, and for a
/// display switch with one display.
pub fn target(layout: Layout, window: &Rect, displays: &[Display], opts: &Options) -> Option<Rect> {
    let i = display_of(displays, window)?;
    let visible = displays[i].visible_frame;
    let g = opts.gap.max(0.0);
    let area = Rect { x: visible.x + g, y: visible.y + g, w: (visible.w - 2.0 * g).max(1.0), h: (visible.h - 2.0 * g).max(1.0) };
    // `n` equal cells across the area with `g` between; the cell `at`, `span` wide.
    let cols = |n: f64, at: f64, span: f64| {
        let cell = (area.w - (n - 1.0) * g) / n;
        (area.x + at * (cell + g), span * cell + (span - 1.0) * g)
    };
    let rows = |n: f64, at: f64, span: f64| {
        let cell = (area.h - (n - 1.0) * g) / n;
        (area.y + at * (cell + g), span * cell + (span - 1.0) * g)
    };
    let full_w = (area.x, area.w);
    let full_h = (area.y, area.h);
    let boxed = |(x, w): (f64, f64), (y, h): (f64, f64)| Rect { x, y, w, h };
    let centred = |w: f64, h: f64| {
        let (w, h) = (w.min(area.w), h.min(area.h));
        Rect { x: area.x + (area.w - w) / 2.0, y: area.y + (area.h - h) / 2.0, w, h }
    };
    let scaled = |percent: f64| {
        let f = (percent / 100.0).clamp(0.1, 1.0);
        centred(area.w * f, area.h * f)
    };
    let r = match layout {
        Layout::LeftHalf => boxed(cols(2.0, 0.0, 1.0), full_h),
        Layout::RightHalf => boxed(cols(2.0, 1.0, 1.0), full_h),
        Layout::TopHalf => boxed(full_w, rows(2.0, 0.0, 1.0)),
        Layout::BottomHalf => boxed(full_w, rows(2.0, 1.0, 1.0)),
        Layout::LeftThird => boxed(cols(3.0, 0.0, 1.0), full_h),
        Layout::CenterThird => boxed(cols(3.0, 1.0, 1.0), full_h),
        Layout::RightThird => boxed(cols(3.0, 2.0, 1.0), full_h),
        Layout::LeftTwoThirds => boxed(cols(3.0, 0.0, 2.0), full_h),
        Layout::RightTwoThirds => boxed(cols(3.0, 1.0, 2.0), full_h),
        Layout::TopLeftQuarter => boxed(cols(2.0, 0.0, 1.0), rows(2.0, 0.0, 1.0)),
        Layout::TopRightQuarter => boxed(cols(2.0, 1.0, 1.0), rows(2.0, 0.0, 1.0)),
        Layout::BottomLeftQuarter => boxed(cols(2.0, 0.0, 1.0), rows(2.0, 1.0, 1.0)),
        Layout::BottomRightQuarter => boxed(cols(2.0, 1.0, 1.0), rows(2.0, 1.0, 1.0)),
        Layout::Maximize => area,
        Layout::AlmostMaximize => scaled(opts.almost_maximize_percent),
        Layout::ReasonableSize => scaled(opts.reasonable_size_percent),
        Layout::Center => centred(window.w, window.h),
        Layout::NextDisplay | Layout::PreviousDisplay => {
            if displays.len() < 2 {
                return None;
            }
            let j = if layout == Layout::NextDisplay { (i + 1) % displays.len() } else { (i + displays.len() - 1) % displays.len() };
            relocate(window, &visible, &displays[j].visible_frame)
        }
        Layout::Restore => return None,
    };
    Some(r.rounded())
}

/// `window` at the same fractions of `to` as it has of `from`, its size
/// scaled the same way and clamped to fit.
fn relocate(window: &Rect, from: &Rect, to: &Rect) -> Rect {
    let fx = (window.x - from.x) / from.w;
    let fy = (window.y - from.y) / from.h;
    let w = (window.w / from.w * to.w).min(to.w);
    let h = (window.h / from.h * to.h).min(to.h);
    let x = (to.x + fx * to.w).clamp(to.x, to.x + to.w - w);
    let y = (to.y + fy * to.h).clamp(to.y, to.y + to.h - h);
    Rect { x, y, w, h }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One 1440x900 screen with a 25 pt menu bar: display frame 1440x925,
    /// visible frame 1440x900 below the bar.
    fn one() -> Vec<Display> {
        vec![Display { id: "1".into(), frame: Rect { x: 0.0, y: 0.0, w: 1440.0, h: 925.0 }, visible_frame: Rect { x: 0.0, y: 25.0, w: 1440.0, h: 900.0 }, primary: true }]
    }

    /// The same, plus a 2560x1440 display to its right with a bar taking 40 px at the bottom.
    fn two() -> Vec<Display> {
        let mut d = one();
        d.push(Display { id: "2".into(), frame: Rect { x: 1440.0, y: 0.0, w: 2560.0, h: 1440.0 }, visible_frame: Rect { x: 1440.0, y: 0.0, w: 2560.0, h: 1400.0 }, primary: false });
        d
    }

    const WIN: Rect = Rect { x: 100.0, y: 100.0, w: 800.0, h: 600.0 };
    const DEFAULTS: Options = Options { gap: 0.0, almost_maximize_percent: 90.0, reasonable_size_percent: 60.0 };

    fn at(layout: Layout) -> Rect {
        target(layout, &WIN, &one(), &DEFAULTS).unwrap()
    }
    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn halves_split_the_visible_frame() {
        assert_eq!(at(Layout::LeftHalf), rect(0.0, 25.0, 720.0, 900.0));
        assert_eq!(at(Layout::RightHalf), rect(720.0, 25.0, 720.0, 900.0));
        assert_eq!(at(Layout::TopHalf), rect(0.0, 25.0, 1440.0, 450.0));
        assert_eq!(at(Layout::BottomHalf), rect(0.0, 475.0, 1440.0, 450.0));
    }

    #[test]
    fn thirds_and_two_thirds() {
        assert_eq!(at(Layout::LeftThird), rect(0.0, 25.0, 480.0, 900.0));
        assert_eq!(at(Layout::CenterThird), rect(480.0, 25.0, 480.0, 900.0));
        assert_eq!(at(Layout::RightThird), rect(960.0, 25.0, 480.0, 900.0));
        assert_eq!(at(Layout::LeftTwoThirds), rect(0.0, 25.0, 960.0, 900.0));
        assert_eq!(at(Layout::RightTwoThirds), rect(480.0, 25.0, 960.0, 900.0));
    }

    #[test]
    fn quarters() {
        assert_eq!(at(Layout::TopLeftQuarter), rect(0.0, 25.0, 720.0, 450.0));
        assert_eq!(at(Layout::TopRightQuarter), rect(720.0, 25.0, 720.0, 450.0));
        assert_eq!(at(Layout::BottomLeftQuarter), rect(0.0, 475.0, 720.0, 450.0));
        assert_eq!(at(Layout::BottomRightQuarter), rect(720.0, 475.0, 720.0, 450.0));
    }

    #[test]
    fn maximize_and_the_centred_sizes() {
        assert_eq!(at(Layout::Maximize), rect(0.0, 25.0, 1440.0, 900.0));
        assert_eq!(at(Layout::AlmostMaximize), rect(72.0, 70.0, 1296.0, 810.0), "90% of the visible frame, centred");
        assert_eq!(at(Layout::ReasonableSize), rect(288.0, 205.0, 864.0, 540.0), "60%");
        assert_eq!(at(Layout::Center), rect(320.0, 175.0, 800.0, 600.0), "the window's own size");
        let huge = Rect { x: 0.0, y: 0.0, w: 3000.0, h: 3000.0 };
        assert_eq!(target(Layout::Center, &huge, &one(), &DEFAULTS).unwrap(), rect(0.0, 25.0, 1440.0, 900.0), "a window larger than the area is shrunk to it");
        let opts = Options { almost_maximize_percent: 50.0, reasonable_size_percent: 25.0, ..DEFAULTS };
        assert_eq!(target(Layout::AlmostMaximize, &WIN, &one(), &opts).unwrap(), rect(360.0, 250.0, 720.0, 450.0));
        assert_eq!(target(Layout::ReasonableSize, &WIN, &one(), &opts).unwrap(), rect(540.0, 363.0, 360.0, 225.0), "rounded to whole pixels");
    }

    #[test]
    fn gap_insets_the_area_and_separates_the_cells() {
        let opts = Options { gap: 10.0, ..DEFAULTS };
        let at = |l| target(l, &WIN, &one(), &opts).unwrap();
        assert_eq!(at(Layout::Maximize), rect(10.0, 35.0, 1420.0, 880.0));
        assert_eq!(at(Layout::LeftHalf), rect(10.0, 35.0, 705.0, 880.0));
        assert_eq!(at(Layout::RightHalf), rect(725.0, 35.0, 705.0, 880.0), "one gap between the halves");
        assert_eq!(at(Layout::LeftThird), rect(10.0, 35.0, 467.0, 880.0));
        assert_eq!(at(Layout::RightThird), rect(963.0, 35.0, 467.0, 880.0));
        assert_eq!(at(Layout::LeftTwoThirds), rect(10.0, 35.0, 943.0, 880.0), "two cells and the gap between them");
        assert_eq!(at(Layout::BottomRightQuarter), rect(725.0, 480.0, 705.0, 435.0));
        assert_eq!(at(Layout::Center), rect(320.0, 175.0, 800.0, 600.0), "centring is not affected by a gap that fits");
    }

    #[test]
    fn restore_is_not_computed_here() {
        assert_eq!(target(Layout::Restore, &WIN, &one(), &DEFAULTS), None);
    }

    #[test]
    fn next_and_previous_display_keep_the_relative_place() {
        let d = two();
        // A window at the left quarter of the primary lands at the left quarter of the second, scaled.
        let w = rect(0.0, 25.0, 720.0, 900.0);
        let next = target(Layout::NextDisplay, &w, &d, &DEFAULTS).unwrap();
        assert_eq!(next, rect(1440.0, 0.0, 1280.0, 1400.0));
        assert_eq!(target(Layout::PreviousDisplay, &w, &d, &DEFAULTS).unwrap(), next, "two displays: previous is next");
        let back = target(Layout::NextDisplay, &next, &d, &DEFAULTS).unwrap();
        assert_eq!(back, w, "and back");
        let mid = rect(2000.0, 300.0, 1000.0, 700.0);
        assert_eq!(target(Layout::NextDisplay, &mid, &d, &DEFAULTS).unwrap(), rect(315.0, 218.0, 563.0, 450.0));
        assert_eq!(target(Layout::NextDisplay, &WIN, &one(), &DEFAULTS), None, "one display: nowhere to go");
    }

    #[test]
    fn layouts_on_the_second_display_use_its_visible_frame() {
        let d = two();
        let w = rect(2000.0, 300.0, 1000.0, 700.0);
        assert_eq!(target(Layout::LeftHalf, &w, &d, &DEFAULTS).unwrap(), rect(1440.0, 0.0, 1280.0, 1400.0));
        assert_eq!(target(Layout::BottomHalf, &w, &d, &DEFAULTS).unwrap(), rect(1440.0, 700.0, 2560.0, 700.0));
        assert_eq!(target(Layout::Maximize, &w, &d, &DEFAULTS).unwrap(), d[1].visible_frame);
    }

    #[test]
    fn the_display_is_the_one_under_the_centre_else_the_most_overlapped_else_primary() {
        let d = two();
        assert_eq!(display_of(&d, &rect(1000.0, 100.0, 800.0, 600.0)), Some(0), "centre at 1400 is on the first");
        assert_eq!(display_of(&d, &rect(1100.0, 100.0, 800.0, 600.0)), Some(1), "centre at 1500 is on the second");
        assert_eq!(display_of(&d, &rect(-700.0, 100.0, 800.0, 600.0)), Some(0), "centre off screen: the overlap decides");
        assert_eq!(display_of(&d, &rect(-9000.0, -9000.0, 10.0, 10.0)), Some(0), "nowhere near: the primary");
        assert_eq!(display_of(&[], &WIN), None);
    }

    #[test]
    fn names_round_trip_and_titles_are_set() {
        for l in ALL {
            assert_eq!(Layout::parse(l.name()), Some(l));
            assert!(!l.title().is_empty());
            assert_eq!(serde_json::to_value(l).unwrap(), l.name(), "serde uses the wire name");
        }
        assert_eq!(Layout::parse("left half"), None);
        assert!(Layout::NextDisplay.changes_display() && !Layout::LeftHalf.changes_display());
        let o: Options = serde_json::from_str("{}").unwrap();
        assert_eq!(o, Options::default());
        let o: Options = serde_json::from_str(r#"{"gap": 8}"#).unwrap();
        assert_eq!((o.gap, o.almost_maximize_percent), (8.0, 90.0));
    }
}
