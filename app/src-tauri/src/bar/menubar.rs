//! The macOS menu bar target: one Tauri tray icon per visible item, built
//! on the main thread as `tray.rs` builds pal's own. The strip is the
//! prerendered glyph (`glyph.rs`, a template image unless the item has a
//! colour, a badge dot or an image icon) with `title`, the segments and a
//! count badge joined into the title text; a hidden item is
//! `remove_tray_by_id` (no slot), not `set_visible`. What the look can do
//! here (`[bar.menubar]`, `Draw::look`): the title is a plain `NSString`
//! (tray-icon 0.24.2 `set_title` is `button.setTitle`, no attributes), so
//! `size`, `font` and `width` prerender the text into the image too
//! (`glyph::strip`, [`prerendered`]); `dim` is the template ink's alpha;
//! `color` and `urgent_color` are the glyph's ink (the title text keeps
//! the bar's colour unless prerendered); `spacing` is the gap in a
//! prerendered strip (Apple's own otherwise); `badge_style`, `show_icon`
//! and `show_title` shaped the item before it got here. No menu is built:
//! `Click`, `Enter` and `Leave` go to `popover` with the icon's rect.
//! Order among pal's icons follows `[bar.items.<key>] order` (ascending
//! left to right): macOS puts a new status item leftmost, so after an
//! add the icons with a lower order are rebuilt (on the next turn of the
//! loop), which moves them back to its left. A fresh id per creation
//! (`pal.<ext>.<id>.<n>`), the Linux note in `tray.rs`. What macOS does
//! not give: room. A status item that does not fit between the front
//! app's menus and the notch is dropped from the bar by the system (on
//! hornet the owner's own items leave room for two of pal's; the rest
//! exist, `rect()` says so, and are not drawn), which is the spec's open
//! "menu bar width" question, not something the renderer can fix.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{include_image, AppHandle, Manager};

use pal_core::config::BarFont;

use super::colors::Palette;
use super::{glyph, popover, Draw, IconKind, Rect, Target};
use crate::{lock, settings};

struct Icon {
    id: String,
    order: i64,
    draw: Draw,
}

static ICONS: LazyLock<Mutex<BTreeMap<String, Icon>>> = LazyLock::new(Mutex::default);
static NEXT: AtomicU64 = AtomicU64::new(0);

/// Whether the bar is dark: `general.theme` when pinned, else the panel
/// window's effective theme (the system's).
pub fn dark(app: &AppHandle) -> bool {
    match settings::config(app).general.theme {
        pal_core::config::Theme::Dark => true,
        pal_core::config::Theme::Light => false,
        pal_core::config::Theme::System => app.get_webview_window(crate::WINDOW).and_then(|w| w.theme().ok()).is_some_and(|t| t == tauri::Theme::Dark),
    }
}

pub fn install(_app: &AppHandle) {}

/// `s` cut to `max` characters with an ellipsis, on a word edge when one is near.
pub fn clip(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let cut = max.saturating_sub(1);
    let keep: String = chars[..cut].iter().collect();
    // A cut inside a word backs up to the word's start when that loses less than a third.
    let mid_word = chars[cut] != ' ';
    let trimmed = match keep.rfind(' ') {
        Some(i) if mid_word && i >= keep.len() * 2 / 3 => keep[..i].to_string(),
        _ => keep,
    };
    format!("{}…", trimmed.trim_end())
}

/// Whether the look asks for what the title cannot carry: a face, a
/// size or a fixed width. Then the text goes into the image
/// (`glyph::strip`), where the system face is on disk; an image icon
/// keeps its picture and the text stays title text.
pub fn prerendered(draw: &Draw) -> bool {
    let l = &draw.look;
    (l.font == BarFont::Mono || l.size > 0.0 || l.width > 0) && glyph::can_strip(l.font == BarFont::Mono) && !matches!(draw.item.icon_kind(), Some(IconKind::Image { .. }))
}

/// The text of the item: the title, each segment as `glyph text`, two
/// spaces apart, then a count badge as ` ·3`, cut to `max_chars` (Apple's
/// bar hides whatever runs under the notch or off the left edge).
pub fn body(draw: &Draw) -> String {
    let item = &draw.item;
    let mut parts: Vec<String> = Vec::new();
    if let Some(t) = item.title.as_deref().filter(|t| !t.is_empty()) {
        parts.push(t.to_string());
    }
    for s in &item.segments {
        let run = format!("{} {}", s.icon.as_deref().unwrap_or_default(), s.text.as_deref().unwrap_or_default()).trim().to_string();
        if !run.is_empty() {
            parts.push(run);
        }
    }
    let mut text = parts.join("  ");
    if let Some(n) = item.count() {
        text.push_str(&format!(" ·{n}"));
    }
    clip(text.trim(), draw.look.max_chars)
}

/// The title text beside the icon: an emoji icon first (the font has no
/// emoji), then [`body`] unless it is prerendered into the image.
pub fn title_text(draw: &Draw) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(IconKind::Text(t)) = draw.item.icon_kind() {
        parts.push(t);
    }
    if !prerendered(draw) {
        parts.push(body(draw));
    }
    parts.join("  ").trim().to_string()
}

/// The tooltip: the item's, "(stale)" appended when it is.
pub fn tooltip(draw: &Draw) -> String {
    let t = draw.item.tooltip.clone().unwrap_or_default();
    if draw.item.stale {
        format!("{t} (stale)").trim().to_string()
    } else {
        t
    }
}

/// How the glyph (or the strip) is inked: the tint's RGB for a colour,
/// none (template, the system's tint) for the bar's text colour and for a
/// muted item, which is the template at `dim`.
fn style(draw: &Draw, palette: &Palette) -> glyph::Style {
    let item = &draw.item;
    let muted = item.muted();
    let color = match draw.tint() {
        None | Some("text") | Some("muted") => None,
        Some(spec) => palette.rgb_of(spec),
    };
    let alpha = if muted { draw.look.dim as f32 / 100.0 } else { 1.0 };
    glyph::Style { color, dot: item.dot(), progress: item.progress.map(|p| p as f32), alpha, size: draw.look.size as f32 }
}

/// The icon image and whether it is a template: a glyph rasterised in the
/// item's colour (none: template), the whole strip when [`prerendered`],
/// an image decoded, else nothing.
fn image(draw: &Draw, palette: &Palette) -> Option<(tauri::image::Image<'static>, bool)> {
    let item = &draw.item;
    let kind = item.icon_kind();
    if let Some(IconKind::Image { value, template }) = &kind {
        let img = glyph::image(value)?;
        return Some((tauri::image::Image::new_owned(img.data, img.width, img.height), *template));
    }
    let style = style(draw, palette);
    let glyph = match kind {
        Some(IconKind::Glyph(c)) => Some(c),
        _ => None,
    };
    let img = if prerendered(draw) {
        let l = &draw.look;
        glyph::strip(glyph, &glyph::Text { text: body(draw), mono: l.font == BarFont::Mono, spacing: l.spacing as f32, width: l.width as f32 }, &style)?
    } else {
        glyph::render(glyph?, &style)?
    };
    Some((tauri::image::Image::new_owned(img.data.clone(), img.width, img.height), style.template()))
}

/// Whether two draws come out as the same image (the tooltip and the menu are not in it).
fn same_image(a: &Draw, b: &Draw) -> bool {
    a.item.icon == b.item.icon && a.tint() == b.tint() && a.item.muted() == b.item.muted() && a.item.badge == b.item.badge && a.item.progress == b.item.progress && a.look == b.look && (!prerendered(a) || body(a) == body(b))
}

fn build(app: &AppHandle, key: &str, draw: &Draw) -> tauri::Result<String> {
    let id = format!("pal.{}.{}", key.replace('/', "."), NEXT.fetch_add(1, Ordering::Relaxed));
    let palette = Palette::new(dark(app), &BTreeMap::new());
    let (icon, template) = image(draw, &palette).unwrap_or_else(|| (include_image!("icons/tray/36x36.png"), true));
    let text = title_text(draw);
    let (k, handle) = (key.to_string(), app.clone());
    let mut b = TrayIconBuilder::with_id(id.clone()).icon(icon).icon_as_template(template).tooltip(tooltip(draw)).show_menu_on_left_click(false).on_tray_icon_event(move |_, ev| on_event(&handle, &k, ev));
    if !text.is_empty() {
        b = b.title(text);
    }
    b.build(app)?;
    Ok(id)
}

/// The tray's rect (physical pixels of its screen) as logical points. An
/// auto-hidden menu bar reports its items above the screen, on no
/// monitor: the primary one's scale then.
fn logical(app: &AppHandle, rect: &tauri::Rect) -> Rect {
    let (px, py) = match rect.position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p) => (p.x, p.y),
    };
    let scale = app.monitor_from_point(px, py).ok().flatten().or_else(|| app.primary_monitor().ok().flatten()).map_or(1.0, |m| m.scale_factor());
    let p = rect.position.to_logical::<f64>(scale);
    let s = rect.size.to_logical::<f64>(scale);
    Rect { x: p.x, y: p.y, w: s.width, h: s.height }
}

fn on_event(app: &AppHandle, key: &str, ev: TrayIconEvent) {
    match ev {
        TrayIconEvent::Click { rect, button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => popover::on_click(app, key, Some(logical(app, &rect)), "menubar"),
        TrayIconEvent::Enter { rect, .. } => {
            let hover = lock(&ICONS).get(key).is_some_and(|i| i.draw.hover);
            if hover {
                popover::on_hover(app, key, Some(logical(app, &rect)), true, "menubar");
            }
        }
        TrayIconEvent::Leave { .. } => popover::on_hover(app, key, None, false, "menubar"),
        _ => {}
    }
}

/// On the main thread: create, update or remove the icon for `key`.
fn apply_now(app: &AppHandle, key: &str, draw: Option<Draw>) {
    let existing = lock(&ICONS).get(key).map(|i| (i.id.clone(), i.order, i.draw.clone()));
    let Some(draw) = draw.filter(|d| !d.item.hidden) else {
        if let Some((id, _, _)) = existing {
            app.remove_tray_by_id(&id);
            lock(&ICONS).remove(key);
            eprintln!("bar\tmenubar\t{key}\tremoved");
        }
        return;
    };
    match existing {
        Some((id, order, last)) if order == draw.order => {
            if last == draw {
                return;
            }
            let Some(tray) = app.tray_by_id(&id) else {
                lock(&ICONS).remove(key);
                return apply_now(app, key, Some(draw));
            };
            let palette = Palette::new(dark(app), &BTreeMap::new());
            if !same_image(&last, &draw) {
                match image(&draw, &palette) {
                    Some((img, template)) => {
                        let _ = tray.set_icon(Some(img));
                        let _ = tray.set_icon_as_template(template);
                    }
                    None => {
                        let _ = tray.set_icon(Some(include_image!("icons/tray/36x36.png")));
                        let _ = tray.set_icon_as_template(true);
                    }
                }
            }
            let text = title_text(&draw);
            if text != title_text(&last) {
                // `set_title(None)` leaves the old text; `Some("")` clears it.
                let _ = tray.set_title(Some(text));
            }
            let tip = tooltip(&draw);
            if tip != tooltip(&last) {
                let _ = tray.set_tooltip(Some(tip));
            }
            if let Some(i) = lock(&ICONS).get_mut(key) {
                i.draw = draw;
            }
        }
        other => {
            if let Some((id, _, _)) = other {
                app.remove_tray_by_id(&id);
                lock(&ICONS).remove(key);
            }
            match build(app, key, &draw) {
                Ok(id) => {
                    eprintln!("bar\tmenubar\t{key}\tcreated\t{}", title_text(&draw));
                    let order = draw.order;
                    lock(&ICONS).insert(key.to_string(), Icon { id, order, draw });
                    // The new icon landed leftmost: rebuild the ones that belong to its left, rightmost first, on the next turn of the loop, so the add itself returns at once.
                    let lower: Vec<String> = lock(&ICONS).iter().filter(|(k, i)| k.as_str() != key && i.order < order).map(|(k, _)| k.clone()).collect();
                    if !lower.is_empty() {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || rebuild(&handle, lower));
                    }
                }
                Err(e) => eprintln!("bar\tmenubar\t{key}\tcreate failed\t{e}"),
            }
        }
    }
}

/// Remove and create `keys` again, highest order first, so each lands to
/// the left of the ones created before it: the menu bar then reads in
/// ascending order. The draw is the one last applied.
fn rebuild(app: &AppHandle, mut keys: Vec<String>) {
    keys.sort_by_key(|k| std::cmp::Reverse(lock(&ICONS).get(k).map_or(0, |i| i.order)));
    for k in keys {
        let Some(i) = lock(&ICONS).remove(&k) else { continue };
        app.remove_tray_by_id(&i.id);
        match build(app, &k, &i.draw) {
            Ok(id) => {
                lock(&ICONS).insert(k, Icon { id, order: i.order, draw: i.draw });
            }
            Err(e) => eprintln!("bar\tmenubar\t{k}\trebuild failed\t{e}"),
        }
    }
    let placed: Vec<String> = lock(&ICONS).iter().map(|(k, i)| format!("{k}={}", app.tray_by_id(&i.id).and_then(|t| t.rect().ok().flatten()).map_or(String::from("none"), |r| format!("{:?}", logical(app, &r))))).collect();
    eprintln!("bar\tmenubar\trebuilt\t{}", placed.join(" "));
}

pub struct MenuBar;

impl Target for MenuBar {
    fn apply(&self, app: &AppHandle, key: &str, draw: Option<&Draw>) {
        let (handle, key, draw) = (app.clone(), key.to_string(), draw.cloned());
        let _ = app.run_on_main_thread(move || apply_now(&handle, &key, draw));
    }

    fn remove(&self, app: &AppHandle, key: &str) {
        self.apply(app, key, None);
    }

    fn remove_all(&self, app: &AppHandle) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            for (_, i) in std::mem::take(&mut *lock(&ICONS)) {
                handle.remove_tray_by_id(&i.id);
            }
        });
    }

    fn anchor(&self, app: &AppHandle, key: &str) -> Option<Rect> {
        let id = lock(&ICONS).get(key)?.id.clone();
        let rect = app.tray_by_id(&id)?.rect().ok().flatten()?;
        Some(logical(app, &rect))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pal_core::config::BarLook;
    use serde_json::json;

    fn draw(item: serde_json::Value) -> Draw {
        Draw { item: serde_json::from_value(item).unwrap(), order: 0, position: "right".into(), hover: false, look: BarLook::default() }
    }

    fn with(item: serde_json::Value, look: BarLook) -> Draw {
        let d = draw(item);
        Draw { item: d.item.shaped(&look), look, ..d }
    }

    #[test]
    fn long_titles_stop_short_of_the_notch() {
        assert_eq!(clip("short", 32), "short");
        assert_eq!(clip("With a coat that smells of rain and the radio playing", 32), "With a coat that smells of rain…");
        assert_eq!(clip("abcdefghijklmnopqrstuvwxyz0123456789", 12), "abcdefghijk…");
        let mut d = draw(json!({ "title": "A lyric line long enough to reach the notch on a 14 inch MacBook" }));
        d.look.max_chars = 24;
        assert_eq!(title_text(&d), "A lyric line long…");
    }

    #[test]
    fn the_look_reaches_the_image_and_the_title() {
        let p = Palette::new(true, &BTreeMap::new());
        let item = json!({ "icon": "\u{f09b}", "title": "3:12", "badge": 3, "progress": 0.5, "menu": [] });
        // The defaults: the glyph is the image, the text the title.
        let plain = with(item.clone(), BarLook::default());
        assert!(!prerendered(&plain));
        assert_eq!(title_text(&plain), "3:12 ·3");
        let (img, template) = image(&plain, &p).unwrap();
        assert!(template && img.width() == glyph::SIZE);
        // show_icon / show_title / badge_style shaped the item.
        assert_eq!(title_text(&with(item.clone(), BarLook { show_title: false, ..Default::default() })), "·3", "glyph only keeps the count");
        assert_eq!(title_text(&with(item.clone(), BarLook { show_title: false, badge_style: pal_core::config::BadgeStyle::None, ..Default::default() })), "");
        assert!(image(&with(item.clone(), BarLook { show_icon: false, ..Default::default() }), &p).is_none(), "no icon: no image, the title alone");
        let dotted = with(item.clone(), BarLook { badge_style: pal_core::config::BadgeStyle::Dot, ..Default::default() });
        assert_eq!(title_text(&dotted), "3:12", "the count became the dot");
        assert!(!image(&dotted, &p).unwrap().1, "a dot rides a coloured image");
        // color, urgent_color, dim.
        assert!(!image(&with(item.clone(), BarLook { color: Some("blue".into()), ..Default::default() }), &p).unwrap().1, "a tint is ink of its own");
        assert!(!image(&with(item.clone(), BarLook { color: Some("#ff8800".into()), ..Default::default() }), &p).unwrap().1, "hex too");
        assert_eq!(style(&with(item.clone(), BarLook { color: Some("#ff8800".into()), ..Default::default() }), &p).color, Some([0xff, 0x88, 0x00]));
        let urgent = with(json!({ "icon": "\u{f09b}", "urgent": true }), BarLook { urgent_color: "amber".into(), ..Default::default() });
        assert_eq!(style(&urgent, &p).color, p.rgb_of("amber"), "the look's urgent colour");
        let stale = with(json!({ "icon": "\u{f09b}", "stale": true, "color": "green" }), BarLook { dim: 30, ..Default::default() });
        let st = style(&stale, &p);
        assert!(st.color.is_none() && (st.alpha - 0.3).abs() < 1e-6, "a muted item is the template at dim: {st:?}");
        assert!(image(&stale, &p).unwrap().1, "still a template, so the bar tints it");
        assert_eq!(style(&with(item.clone(), BarLook { size: 11.0, ..Default::default() }), &p).size, 11.0);
        // font, size and width prerender the text into the image.
        if glyph::can_strip(true) {
            let mono = with(item.clone(), BarLook { font: BarFont::Mono, ..Default::default() });
            assert!(prerendered(&mono));
            assert_eq!(title_text(&mono), "", "the text is in the image");
            let (img, template) = image(&mono, &p).unwrap();
            assert!(template && img.width() > glyph::SIZE * 2, "a wide template strip: {}", img.width());
            let fixed = with(item.clone(), BarLook { width: 60, ..Default::default() });
            assert_eq!(image(&fixed, &p).unwrap().0.width(), 120, "60 pt at 2x");
            let emoji = with(json!({ "icon": "🔔", "title": "Ring" }), BarLook { size: 12.0, ..Default::default() });
            assert_eq!(title_text(&emoji), "🔔", "an emoji cannot be prerendered and stays title text");
            assert!(image(&emoji, &p).unwrap().0.width() > 20, "the text strip without a glyph square");
            assert!(same_image(&mono, &mono.clone()));
            assert!(!same_image(&mono, &with(json!({ "icon": "\u{f09b}", "title": "3:11", "badge": 3, "progress": 0.5, "menu": [] }), BarLook { font: BarFont::Mono, ..Default::default() })), "a tick redraws a prerendered strip");
            assert!(same_image(&plain, &with(json!({ "icon": "\u{f09b}", "title": "3:11", "badge": 3, "progress": 0.5, "menu": [] }), BarLook::default())), "but not a plain one: the title carries it");
        }
        let picture = with(json!({ "icon": { "image": "data:image/png;base64,AA==" }, "title": "x" }), BarLook { font: BarFont::Mono, ..Default::default() });
        assert!(!prerendered(&picture) && title_text(&picture) == "x", "an image icon keeps its picture and its title text");
        assert!(!same_image(&plain, &with(item, BarLook { dim: 10, ..Default::default() })), "a look change redraws");
    }

    #[test]
    fn title_text_joins_emoji_title_segments_and_count() {
        assert_eq!(title_text(&draw(json!({ "icon": "\u{f09b}", "badge": 3 }))), "·3", "a glyph is the image, the count the text");
        assert_eq!(title_text(&draw(json!({ "icon": "🔔", "title": "Ring" }))), "🔔  Ring", "an emoji leads the text");
        assert_eq!(title_text(&draw(json!({ "title": "prs", "segments": [{ "id": "a", "icon": "\u{f0159}", "text": "2" }, { "id": "b", "text": "│" }, { "id": "c", "icon": "\u{f09b}" }] }))), "prs  \u{f0159} 2  │  \u{f09b}");
        assert_eq!(title_text(&draw(json!({ "hidden": true }))), "");
        assert_eq!(tooltip(&draw(json!({ "tooltip": "3 unread", "stale": true }))), "3 unread (stale)");
        assert_eq!(tooltip(&draw(json!({ "stale": true }))), "(stale)");
    }

    #[test]
    fn image_is_template_unless_coloured_dotted_or_a_picture() {
        let p = Palette::new(true, &BTreeMap::new());
        let (img, template) = image(&draw(json!({ "icon": "\u{f09b}" })), &p).unwrap();
        assert!(template && img.width() == glyph::SIZE);
        assert!(image(&draw(json!({ "icon": "\u{f09b}", "color": "text" })), &p).unwrap().1, "text is the system tint");
        assert!(!image(&draw(json!({ "icon": "\u{f09b}", "color": "green" })), &p).unwrap().1);
        assert!(!image(&draw(json!({ "icon": "\u{f09b}", "urgent": true })), &p).unwrap().1, "an alarm is drawn in the destructive colour");
        assert!(image(&draw(json!({ "icon": "\u{f09b}", "stale": true })), &p).unwrap().1, "stale is the template, dimmed");
        assert!(!image(&draw(json!({ "icon": "\u{f09b}", "badge": "dot" })), &p).unwrap().1);
        assert!(image(&draw(json!({ "icon": "🔔" })), &p).is_none(), "an emoji is title text");
        assert!(image(&draw(json!({ "title": "x" })), &p).is_none());
    }
}
