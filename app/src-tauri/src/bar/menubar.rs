//! The macOS menu bar target: one Tauri tray icon per visible item, built
//! on the main thread as `tray.rs` builds pal's own. The strip is the
//! prerendered glyph (`glyph.rs`, a template image unless the item has a
//! colour, a badge dot or an image icon) with `title`, the segments and a
//! count badge joined into the title text; a hidden item is
//! `remove_tray_by_id` (no slot), not `set_visible`. No menu is built:
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

/// The title text beside the icon: an emoji icon first (the font has no
/// emoji), the title, each segment as `glyph text`, two spaces apart, then
/// a count badge as ` ·3`.
pub fn title_text(draw: &Draw) -> String {
    let item = &draw.item;
    let mut parts: Vec<String> = Vec::new();
    if let Some(IconKind::Text(t)) = item.icon_kind() {
        parts.push(t);
    }
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
    text.trim().to_string()
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

/// The icon image and whether it is a template: a glyph rasterised in the
/// item's colour (none: template), an image decoded, else nothing.
fn image(draw: &Draw, palette: &Palette) -> Option<(tauri::image::Image<'static>, bool)> {
    let item = &draw.item;
    match item.icon_kind()? {
        IconKind::Glyph(c) => {
            let color = item.color_name().filter(|n| *n != "text").and_then(|n| palette.rgb(n));
            let style = glyph::Style { color, dot: item.dot(), progress: item.progress.map(|p| p as f32), stale: item.stale };
            let img = glyph::render(c, &style)?;
            Some((tauri::image::Image::new_owned(img.data.clone(), img.width, img.height), style.template()))
        }
        IconKind::Image { value, template } => {
            let img = glyph::image(&value)?;
            Some((tauri::image::Image::new_owned(img.data, img.width, img.height), template))
        }
        IconKind::Text(_) => None,
    }
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
            if last.item.icon != draw.item.icon || last.item.color_name() != draw.item.color_name() || last.item.badge != draw.item.badge || last.item.progress != draw.item.progress || last.item.stale != draw.item.stale {
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
    use serde_json::json;

    fn draw(item: serde_json::Value) -> Draw {
        Draw { item: serde_json::from_value(item).unwrap(), order: 0, position: "right".into(), hover: false }
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
        assert!(!image(&draw(json!({ "icon": "\u{f09b}", "badge": "dot" })), &p).unwrap().1);
        assert!(image(&draw(json!({ "icon": "🔔" })), &p).is_none(), "an emoji is title text");
        assert!(image(&draw(json!({ "title": "x" })), &p).is_none());
    }
}
