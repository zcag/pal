//! The frontmost app's menu bar, as a list: every enabled leaf item with its
//! path ("File > Export > PDF"), its shortcut in the `Action.shortcut`
//! spelling (`cmd+shift+e`, `cmd+up`, `f5`), and whether it is checked;
//! and pressing one. macOS only, over Accessibility: the app's
//! `AXMenuBar`, each `AXMenuBarItem`'s `AXMenu`, its `AXMenuItem`s, and a
//! submenu item's own `AXMenu` under it, walked depth first ([`walk`],
//! generic over [`Node`] so a fake tree tests it). Separators (no title)
//! and disabled items are skipped, the Apple menu too (pal's system
//! palette has what matters there). The walk stops at [`MAX_DEPTH`] path
//! segments and at [`BUDGET`]: what it has by then is the list, flagged
//! `truncated`. Every item is one round trip to the app's main thread
//! ([`crate::ax::element::Element::attrs`], seven attributes at once) plus
//! one per submenu, so a Finder menu bar is ~150 items in ~40 ms and a
//! Chrome one ~200 in ~60 ms; Xcode with its 1000 hits the budget.
//!
//! [`items`] walks the app in front and keeps the elements it found for
//! [`press`], keyed by the item's id (its path, `(2)` on a second item with
//! the same path), so Enter presses the very element listed; a press pal
//! has no element for (a restart in between) follows the path by title.
//! Off macOS every call is [`Error::Unavailable`].

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// macOS: reading another app's menus needs Accessibility permission for pal.
    #[error("menu bar search needs Accessibility permission")]
    NeedsAccessibility,
    /// Not macOS, or no app in front.
    #[error("menu bar unavailable: {0}")]
    Unavailable(String),
    #[error("no menu item {0}")]
    NotFound(String),
    /// The app refused the press.
    #[error("{0}")]
    Failed(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// One pressable menu item.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    /// The path joined with ` > `, `(2)` appended on a repeat: what `press` takes.
    pub id: String,
    /// The menu, its submenus, the item: `["File", "Export", "PDF"]`.
    pub path: Vec<String>,
    /// `cmd+shift+e`, `cmd+up`, `f5`, `ctrl+alt+space`: the `Action.shortcut` spelling.
    pub shortcut: Option<String>,
    /// Carries a check mark.
    pub checked: bool,
}

/// The app in front and its items.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Menu {
    pub app: String,
    pub bundle: String,
    pub pid: i32,
    /// The `.app` bundle, for the rows' icon.
    pub icon: Option<PathBuf>,
    pub items: Vec<Item>,
    /// The walk hit `MAX_DEPTH` or `BUDGET` somewhere: some items are not here.
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// Path segments, `File > Export > PDF > X` being four; deeper items are left out.
pub const MAX_DEPTH: usize = 4;
/// Wall time for one walk; what is collected by then is the list.
pub const BUDGET: Duration = Duration::from_millis(150);

/// The items of the app in front, with the elements kept for [`press`].
pub fn items() -> Result<Menu> {
    platform::items()
}

/// The items of one app by pid, no cache: the example binary's measure.
pub fn items_of(pid: i32) -> Result<Menu> {
    platform::items_of(pid)
}

/// Press the item `id` (from [`items`]) of the app `pid`.
pub fn press(pid: i32, id: &str) -> Result<()> {
    platform::press(pid, id)
}

// ---- the walk ------------------------------------------------------------

/// What one menu item says about itself, read in one go.
#[derive(Clone, Debug, Default)]
pub struct Facts<N> {
    pub title: String,
    pub enabled: bool,
    /// `AXMenuItemCmdChar`: the key, empty when the glyph or nothing says it.
    pub cmd_char: String,
    /// `AXMenuItemCmdModifiers`: bit 0 shift, 1 option, 2 control, 3 "no command".
    pub modifiers: i64,
    /// `AXMenuItemCmdGlyph`: Carbon's `kMenu*Glyph` for keys without a character; 0 for none.
    pub glyph: i64,
    /// `AXMenuItemMarkChar`: the check mark, empty when unchecked.
    pub mark: String,
    /// The menu under it, when it opens one.
    pub submenu: Option<N>,
}

/// A node of a menu tree: the menu bar, a bar item, a menu item. The AX
/// implementation is in `platform`; the tests use a fake.
pub trait Node: Sized {
    /// This item's facts; `None` when the app did not answer.
    fn facts(&self) -> Option<Facts<Self>>;
    /// The items of a menu node (the menu bar's bar items, a menu's items).
    fn items(&self) -> Vec<Self>;
}

/// One leaf the walk found, with the node to press.
pub struct Found<N> {
    pub path: Vec<String>,
    pub shortcut: Option<String>,
    pub checked: bool,
    pub node: N,
}

/// What a walk found and why it stopped where it did.
pub struct Walk<N> {
    pub found: Vec<Found<N>>,
    /// A submenu past `max_depth` was left out.
    pub cut_depth: bool,
    /// The budget ran out: the rest of the menus was not read.
    pub cut_time: bool,
}

impl<N> Walk<N> {
    pub fn truncated(&self) -> bool {
        self.cut_depth || self.cut_time
    }
}

/// Every enabled, titled leaf under `bar` (a menu bar node), depth first
/// in menu order, the Apple menu skipped; cut at `max_depth` path segments
/// and at `budget` (checked before every item, so one slow round trip can
/// still overrun it).
pub fn walk<N: Node>(bar: &N, budget: Duration, max_depth: usize) -> Walk<N> {
    let start = Instant::now();
    let mut w = Walk { found: vec![], cut_depth: false, cut_time: false };
    for top in bar.items() {
        let Some(f) = top.facts() else { continue };
        if f.title.is_empty() || f.title == "Apple" || !f.enabled {
            continue;
        }
        let Some(menu) = f.submenu else { continue };
        descend(&menu, vec![f.title], &start, budget, max_depth, &mut w);
        if w.cut_time {
            break;
        }
    }
    w
}

fn descend<N: Node>(menu: &N, path: Vec<String>, start: &Instant, budget: Duration, max_depth: usize, w: &mut Walk<N>) {
    for item in menu.items() {
        if start.elapsed() > budget {
            w.cut_time = true;
            return;
        }
        let Some(f) = item.facts() else { continue };
        if f.title.is_empty() || !f.enabled {
            continue;
        }
        let mut p = path.clone();
        p.push(f.title);
        match f.submenu {
            Some(sub) => {
                if p.len() >= max_depth {
                    w.cut_depth = true;
                    continue;
                }
                descend(&sub, p, start, budget, max_depth, w);
                if w.cut_time {
                    return;
                }
            }
            None => w.found.push(Found { path: p, shortcut: shortcut(&f.cmd_char, f.modifiers, f.glyph), checked: !f.mark.trim().is_empty(), node: item }),
        }
    }
}

/// The wire items for what the walk found: ids are the path joined with
/// ` > `, a repeat (two `Window > Untitled`) gets ` (2)`, ` (3)`.
pub fn to_items<N>(found: &[Found<N>]) -> Vec<Item> {
    let mut seen: std::collections::HashMap<String, usize> = Default::default();
    found
        .iter()
        .map(|f| {
            let base = f.path.join(" > ");
            let n = seen.entry(base.clone()).or_insert(0);
            *n += 1;
            let id = if *n == 1 { base } else { format!("{base} ({n})") };
            Item { id, path: f.path.clone(), shortcut: f.shortcut.clone(), checked: f.checked }
        })
        .collect()
}

/// The path and ordinal an id names: `File > Open (2)` is the second
/// `["File", "Open"]`.
pub fn parse_id(id: &str) -> (Vec<String>, usize) {
    let (base, n) = match id.rsplit_once(" (") {
        Some((b, rest)) => match rest.strip_suffix(')').and_then(|n| n.parse::<usize>().ok()) {
            Some(n) if n >= 2 => (b, n),
            _ => (id, 1),
        },
        None => (id, 1),
    };
    (base.split(" > ").map(str::to_string).collect(), n)
}

/// The `Action.shortcut` spelling of a menu item's key equivalent, `None`
/// without one. Modifiers in the order macOS draws them (control, option,
/// shift, command); the key from the glyph when there is one, else the
/// character (a Cocoa function key `U+F700..` named, a letter lowered). A
/// bare letter with the "no command" bit is a Globe (fn) shortcut, which
/// AX has no bit for: `fn+f` for Enter Full Screen.
pub fn shortcut(cmd_char: &str, modifiers: i64, glyph: i64) -> Option<String> {
    let key = if glyph > 0 { glyph_key(glyph) } else { char_key(cmd_char) }?;
    let mut parts = vec![];
    if glyph == 0 && modifiers == 8 && key.chars().count() == 1 && key.chars().all(|c| c.is_alphanumeric()) {
        parts.push("fn");
    }
    if modifiers & 4 != 0 {
        parts.push("ctrl");
    }
    if modifiers & 2 != 0 {
        parts.push("alt");
    }
    if modifiers & 1 != 0 {
        parts.push("shift");
    }
    if modifiers & 8 == 0 {
        parts.push("cmd");
    }
    parts.push(&key);
    Some(parts.join("+"))
}

/// Carbon `kMenu*Glyph` codes for the keys a character cannot spell.
fn glyph_key(glyph: i64) -> Option<String> {
    Some(match glyph {
        2 => "tab",
        3 => "⇤",
        4 => "⌤",
        9 => "space",
        10 => "⌦",
        11..=13 => "enter",
        16 => "⇣",
        23 => "backspace",
        24 => "⇠",
        25 => "⇡",
        26 => "⇢",
        27 => "escape",
        28 => "⌧",
        98 => "⇞",
        99 => "⇪",
        100 => "left",
        101 => "right",
        102 => "↖",
        103 => "?",
        104 => "up",
        105 => "↘",
        106 => "down",
        107 => "⇟",
        110 => "⏻",
        111..=125 => return Some(format!("f{}", glyph - 110)),
        140 => "⏏",
        143..=146 => return Some(format!("f{}", glyph - 127)),
        _ => return None,
    }
    .to_string())
}

/// `AXMenuItemCmdChar`: one character, a Cocoa function key (`U+F700..`),
/// or a control character for Return, Tab, Delete, Escape.
fn char_key(cmd_char: &str) -> Option<String> {
    let mut chars = cmd_char.chars();
    let c = chars.next()?;
    if chars.next().is_some() {
        return Some(cmd_char.to_lowercase());
    }
    let code = c as u32;
    Some(
        match code {
            0xF700 => "up",
            0xF701 => "down",
            0xF702 => "left",
            0xF703 => "right",
            0xF704..=0xF726 => return Some(format!("f{}", code - 0xF703)),
            0xF728 | 0x7F => "⌦",
            0xF729 => "↖",
            0xF72B => "↘",
            0xF72C => "⇞",
            0xF72D => "⇟",
            0xF746 => "?",
            0x0D | 0x03 => "enter",
            0x09 => "tab",
            0x08 => "backspace",
            0x1B => "escape",
            0x20 => "space",
            _ if c.is_control() => return None,
            _ => return Some(c.to_lowercase().to_string()),
        }
        .to_string(),
    )
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::ax::element::Element;
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};
    use std::sync::{LazyLock, Mutex};

    /// The seven attributes of a menu item, one round trip.
    const ATTRS: [&str; 8] = ["AXRole", "AXTitle", "AXEnabled", "AXMenuItemCmdChar", "AXMenuItemCmdModifiers", "AXMenuItemCmdGlyph", "AXMenuItemMarkChar", "AXChildren"];

    impl Node for Element {
        fn facts(&self) -> Option<Facts<Self>> {
            let v = self.attrs(&ATTRS);
            let title = Element::as_text(&v[1])?;
            // A submenu item's only child is its AXMenu; a leaf has none.
            let submenu = Element::as_elements(&v[7]).into_iter().find(|c| c.string("AXRole").as_deref() == Some("AXMenu"));
            Some(Facts {
                title,
                enabled: Element::as_flag(&v[2]).unwrap_or(true),
                cmd_char: Element::as_text(&v[3]).unwrap_or_default(),
                modifiers: Element::as_number(&v[4]).unwrap_or(0),
                glyph: Element::as_number(&v[5]).unwrap_or(0),
                mark: Element::as_text(&v[6]).unwrap_or_default(),
                submenu,
            })
        }

        fn items(&self) -> Vec<Self> {
            self.elements("AXChildren")
        }
    }

    /// What the last complete-enough walk found: the elements for `press`,
    /// and the list itself, served again when a later walk of the same app
    /// is cut short by the budget with less (an app is slow to answer for
    /// a moment right after it comes to the front: TextEdit gave 22 items
    /// in 188 ms just activated, 144 in 11 ms a second later).
    struct Cache {
        menu: Menu,
        found: Vec<(String, Element)>,
    }

    static CACHE: LazyLock<Mutex<Option<Cache>>> = LazyLock::new(Default::default);

    fn front() -> Result<objc2::rc::Retained<NSRunningApplication>> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication().ok_or_else(|| Error::Unavailable("no app in front".into()))?;
        if app.processIdentifier() == std::process::id() as i32 {
            return Err(Error::Unavailable("pal is the app in front".into()));
        }
        Ok(app)
    }

    fn walk_app(app: &NSRunningApplication) -> Result<(Menu, Walk<Element>)> {
        if !crate::ax::trusted() {
            return Err(Error::NeedsAccessibility);
        }
        let pid = app.processIdentifier();
        let name = app.localizedName().map(|s| s.to_string()).unwrap_or_default();
        let bar = Element::app(pid).and_then(|a| a.menu_bar()).ok_or_else(|| Error::Unavailable(format!("{name} has no menu bar pal can read")))?;
        let t0 = Instant::now();
        let w = walk(&bar, BUDGET, MAX_DEPTH);
        let menu = Menu {
            app: name,
            bundle: app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default(),
            pid,
            icon: app.bundleURL().and_then(|u| u.path()).map(|p| PathBuf::from(p.to_string())),
            items: to_items(&w.found),
            truncated: w.truncated(),
            elapsed_ms: t0.elapsed().as_millis() as u64,
        };
        Ok((menu, w))
    }

    pub fn items() -> Result<Menu> {
        let (menu, w) = walk_app(&*front()?)?;
        let mut cache = CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(c) = cache.as_ref().filter(|c| w.cut_time && c.menu.pid == menu.pid && c.menu.items.len() > menu.items.len()) {
            return Ok(Menu { elapsed_ms: menu.elapsed_ms, ..c.menu.clone() });
        }
        let found = menu.items.iter().map(|i| i.id.clone()).zip(w.found.into_iter().map(|f| f.node)).collect();
        *cache = Some(Cache { menu: menu.clone(), found });
        Ok(menu)
    }

    pub fn items_of(pid: i32) -> Result<Menu> {
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid).ok_or_else(|| Error::Unavailable(format!("no app with pid {pid}")))?;
        walk_app(&app).map(|(m, _)| m)
    }

    /// The element `id` names, by following its path from the menu bar:
    /// the fallback when the cache has nothing for it.
    fn find(pid: i32, id: &str) -> Result<Element> {
        let (path, nth) = parse_id(id);
        let mut menu = Element::app(pid).and_then(|a| a.menu_bar()).ok_or_else(|| Error::Unavailable("the app has no menu bar pal can read".into()))?;
        let last = path.len().saturating_sub(1);
        for (depth, want) in path.iter().enumerate() {
            let mut n = 0;
            let mut next = None;
            for item in menu.items() {
                let Some(f) = item.facts() else { continue };
                if &f.title != want {
                    continue;
                }
                if depth < last {
                    next = f.submenu;
                    break;
                }
                n += 1;
                if n == nth {
                    return Ok(item);
                }
            }
            menu = next.ok_or_else(|| Error::NotFound(id.into()))?;
        }
        Err(Error::NotFound(id.into()))
    }

    pub fn press(pid: i32, id: &str) -> Result<()> {
        if !crate::ax::trusted() {
            return Err(Error::NeedsAccessibility);
        }
        let cached = {
            let cache = CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            cache.as_ref().filter(|c| c.menu.pid == pid).and_then(|c| c.found.iter().find(|(i, _)| i == id)).map(|(_, el)| el.clone())
        };
        let el = match cached {
            Some(el) => el,
            None => find(pid, id)?,
        };
        if !el.facts().is_some_and(|f| f.enabled) {
            return Err(Error::Failed("the item is disabled now".into()));
        }
        el.press().then_some(()).ok_or_else(|| Error::Failed("the app refused the press".into()))
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    const WHY: &str = "the menu bar is macOS only; no desktop on Linux exposes an app's menus to read";

    pub fn items() -> Result<Menu> {
        Err(Error::Unavailable(WHY.into()))
    }
    pub fn items_of(_pid: i32) -> Result<Menu> {
        Err(Error::Unavailable(WHY.into()))
    }
    pub fn press(_pid: i32, _id: &str) -> Result<()> {
        Err(Error::Unavailable(WHY.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A menu tree: a menu holds items; an item may open one.
    #[derive(Clone, Debug)]
    enum Fake {
        Menu(Vec<Fake>),
        Item { title: &'static str, enabled: bool, key: &'static str, mods: i64, glyph: i64, mark: &'static str, sub: Option<Box<Fake>> },
    }

    fn item(title: &'static str) -> Fake {
        Fake::Item { title, enabled: true, key: "", mods: 0, glyph: 0, mark: "", sub: None }
    }
    fn keyed(title: &'static str, key: &'static str, mods: i64) -> Fake {
        Fake::Item { title, enabled: true, key, mods, glyph: 0, mark: "", sub: None }
    }
    fn menu(title: &'static str, items: Vec<Fake>) -> Fake {
        Fake::Item { title, enabled: true, key: "", mods: 0, glyph: 0, mark: "", sub: Some(Box::new(Fake::Menu(items))) }
    }
    fn disabled(title: &'static str) -> Fake {
        Fake::Item { title, enabled: false, key: "", mods: 0, glyph: 0, mark: "", sub: None }
    }
    fn checked(title: &'static str) -> Fake {
        Fake::Item { title, enabled: true, key: "", mods: 0, glyph: 0, mark: "✓", sub: None }
    }

    impl Node for Fake {
        fn facts(&self) -> Option<Facts<Self>> {
            match self {
                Fake::Menu(_) => None,
                Fake::Item { title, enabled, key, mods, glyph, mark, sub } => Some(Facts { title: title.to_string(), enabled: *enabled, cmd_char: key.to_string(), modifiers: *mods, glyph: *glyph, mark: mark.to_string(), submenu: sub.as_deref().cloned() }),
            }
        }
        fn items(&self) -> Vec<Self> {
            match self {
                Fake::Menu(items) => items.clone(),
                Fake::Item { .. } => vec![],
            }
        }
    }

    fn bar() -> Fake {
        Fake::Menu(vec![
            menu("Apple", vec![item("About This Mac")]),
            menu("TextEdit", vec![item("About TextEdit"), item(""), keyed("Preferences…", ",", 0), disabled("Services")]),
            menu("File", vec![
                keyed("New", "N", 0),
                keyed("Open…", "O", 0),
                menu("Open Recent", vec![item("notes.txt"), item(""), item("Clear Menu")]),
                item(""),
                menu("Export", vec![menu("As", vec![item("PDF"), menu("Too Deep", vec![item("Leaf")])])]),
                keyed("Print…", "P", 1),
            ]),
            menu("View", vec![checked("Show Toolbar"), keyed("Enter Full Screen", "F", 4 | 8), keyed("Toggle Sidebar", "S", 8)]),
            disabled("Format"),
            menu("Window", vec![item("Untitled"), item("Untitled")]),
        ])
    }

    #[test]
    fn walks_enabled_leaves_with_paths_skipping_apple_separators_and_disabled() {
        let w = walk(&bar(), Duration::from_secs(1), MAX_DEPTH);
        let found = &w.found;
        let paths: Vec<String> = found.iter().map(|f| f.path.join(" > ")).collect();
        assert_eq!(
            paths,
            [
                "TextEdit > About TextEdit",
                "TextEdit > Preferences…",
                "File > New",
                "File > Open…",
                "File > Open Recent > notes.txt",
                "File > Open Recent > Clear Menu",
                "File > Export > As > PDF",
                "File > Print…",
                "View > Show Toolbar",
                "View > Enter Full Screen",
                "View > Toggle Sidebar",
                "Window > Untitled",
                "Window > Untitled",
            ]
        );
        assert!(w.cut_depth && !w.cut_time && w.truncated(), "Too Deep > Leaf is five segments");
        let by = |p: &str| found.iter().find(|f| f.path.join(" > ") == p).unwrap();
        assert_eq!(by("File > New").shortcut.as_deref(), Some("cmd+n"));
        assert_eq!(by("File > Print…").shortcut.as_deref(), Some("shift+cmd+p"));
        assert_eq!(by("View > Enter Full Screen").shortcut.as_deref(), Some("ctrl+f"), "bit 3 drops command");
        assert_eq!(by("View > Toggle Sidebar").shortcut.as_deref(), Some("fn+s"), "a bare letter without command is a Globe shortcut");
        assert_eq!(by("TextEdit > Preferences…").shortcut.as_deref(), Some("cmd+,"));
        assert_eq!(by("File > Open Recent > notes.txt").shortcut, None);
        assert!(by("View > Show Toolbar").checked && !by("File > New").checked);
    }

    #[test]
    fn ids_number_repeats_and_parse_back() {
        let items = to_items(&walk(&bar(), Duration::from_secs(1), MAX_DEPTH).found);
        let ids: Vec<&str> = items.iter().filter(|i| i.path[0] == "Window").map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["Window > Untitled", "Window > Untitled (2)"]);
        assert_eq!(parse_id("Window > Untitled (2)"), (vec!["Window".to_string(), "Untitled".to_string()], 2));
        assert_eq!(parse_id("File > Export > As > PDF"), (vec!["File".to_string(), "Export".to_string(), "As".to_string(), "PDF".to_string()], 1));
        assert_eq!(parse_id("Edit > Emoji (1)"), (vec!["Edit".to_string(), "Emoji (1)".to_string()], 1), "(1) is never a repeat suffix");
        assert_eq!(parse_id("Go > Back (0)").1, 1);
        let open = items.iter().find(|i| i.id == "File > Open…").unwrap();
        assert_eq!(open, &Item { id: "File > Open…".into(), path: vec!["File".into(), "Open…".into()], shortcut: Some("cmd+o".into()), checked: false });
    }

    #[test]
    fn a_shallow_cap_and_a_spent_budget_truncate() {
        let w = walk(&bar(), Duration::from_secs(1), 2);
        assert!(w.cut_depth && !w.cut_time);
        assert!(w.found.iter().all(|f| f.path.len() == 2), "{:?}", w.found.iter().map(|f| f.path.join(" > ")).collect::<Vec<_>>());
        assert!(w.found.iter().any(|f| f.path == ["File", "New"]));
        let w = walk(&bar(), Duration::ZERO, MAX_DEPTH);
        assert!(w.cut_time && w.truncated());
        assert!(w.found.is_empty(), "the budget is checked before every item: nothing fits in zero time");
    }

    #[test]
    fn shortcuts_spell_modifiers_glyphs_and_function_keys() {
        assert_eq!(shortcut("", 0, 0), None);
        assert_eq!(shortcut("Z", 1 | 2, 0).as_deref(), Some("alt+shift+cmd+z"));
        assert_eq!(shortcut("", 0, 104).as_deref(), Some("cmd+up"), "glyph 104 is the up arrow");
        assert_eq!(shortcut("", 2, 23).as_deref(), Some("alt+cmd+backspace"));
        assert_eq!(shortcut("", 0, 111).as_deref(), Some("cmd+f1"));
        assert_eq!(shortcut("", 8, 125).as_deref(), Some("f15"), "a bare function key is not a Globe shortcut");
        assert_eq!(shortcut("", 8, 143).as_deref(), Some("f16"));
        assert_eq!(shortcut("F", 8, 0).as_deref(), Some("fn+f"));
        assert_eq!(shortcut("F", 8 | 1, 0).as_deref(), Some("shift+f"), "with another modifier AX cannot say whether Globe is held");
        assert_eq!(shortcut("\u{F700}", 1, 0).as_deref(), Some("shift+cmd+up"), "a Cocoa function key as the character");
        assert_eq!(shortcut("\u{F708}", 8, 0).as_deref(), Some("f5"));
        assert_eq!(shortcut("\r", 0, 0).as_deref(), Some("cmd+enter"));
        assert_eq!(shortcut("\t", 4, 0).as_deref(), Some("ctrl+cmd+tab"));
        assert_eq!(shortcut("\u{8}", 0, 0).as_deref(), Some("cmd+backspace"));
        assert_eq!(shortcut("\u{7f}", 0, 0).as_deref(), Some("cmd+⌦"));
        assert_eq!(shortcut(" ", 0, 0).as_deref(), Some("cmd+space"));
        assert_eq!(shortcut("\u{1}", 0, 0), None, "a control character with no name is no shortcut");
        assert_eq!(shortcut("", 0, 999), None, "an unknown glyph is no shortcut");
        assert_eq!(shortcut("", 0, 140).as_deref(), Some("cmd+⏏"));
    }
}
