//! The front app's open or save panel, and typing a path into it: what a
//! Files row's "Use in dialog" does (Flow's Dialog Jump). macOS over
//! Accessibility: the focused window of the app in front is a panel when
//! AppKit says so, its `AXIdentifier` `open-panel` or `save-panel` (a
//! standalone panel is a plain `AXWindow` with it, a sheet an `AXSheet`;
//! measured on TextEdit, macOS 26), or, for a panel drawn without the
//! identifiers, when its tree holds the file browser (`AXBrowser`,
//! `AXOutline` or `AXTable`) beside the "Where:" popup or the search field,
//! the file-name field (`saveAsNameTextField`, or one titled "Save As:")
//! making it a save panel: [`classify`] over a [`Win`] tree so a fake one
//! tests it. Typing the path is the panel's own "Go to Folder" sheet
//! (`cmd+shift+g`), the path pasted into it (a keystroke per character
//! would trip on layouts) and Return; the sheet takes a file as well as a
//! folder, and on an open panel a file is then selected, Return again
//! opens it. GTK file choosers take `ctrl+l` for the same field. The plan
//! is [`plan`], pure; [`go`] runs it.

use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("using a dialog needs Accessibility permission")]
    NeedsAccessibility,
    #[error("no open or save panel in front")]
    NoDialog,
    #[error("dialog unavailable: {0}")]
    Unavailable(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Open,
    Save,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Open => "open",
            Kind::Save => "save",
        }
    }
}

/// The panel in front.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dialog {
    /// The app that put it up ("TextEdit").
    pub app: String,
    pub pid: i32,
    pub kind: Kind,
    /// The panel's own title when it has one ("Open", "Export as PDF").
    pub title: Option<String>,
}

/// The open or save panel the app in front has up, if any. `None` without
/// Accessibility, with pal in front, or with no such panel.
pub fn detect() -> Option<Dialog> {
    platform::detect()
}

/// Type `path` into the panel in front: [`detect`], then [`plan`] run as
/// keystrokes. The caller has hidden pal first, so the panel is key.
pub fn go(path: &str) -> Result<Dialog> {
    platform::go(path)
}

// ---- the tree ------------------------------------------------------------

/// What one element says about itself, read in one go.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Facts {
    pub role: String,
    pub subrole: String,
    pub title: String,
    /// `AXIdentifier`: AppKit names the panel and its fields (`open-panel`, `saveAsNameTextField`).
    pub identifier: String,
}

/// A node of a window's tree; the AX implementation is in `platform`, the tests use a fake.
pub trait Win: Sized {
    fn facts(&self) -> Option<Facts>;
    fn children(&self) -> Vec<Self>;
}

/// Levels below the window read before giving up: the file browser sits
/// two or three down (a split group in a group); a document window's web
/// area would otherwise be walked whole.
pub const MAX_DEPTH: usize = 6;
/// Elements read per detection at most; a panel is found well within it.
pub const MAX_NODES: usize = 400;

/// Whether `window` is an open or save panel, and which. AppKit's own
/// identifier settles it (`open-panel`, `save-panel`); a sheet or a
/// dialog without one is a panel when a file browser (`AXBrowser`,
/// `AXOutline`, `AXTable`) sits under it with the "Where:" popup or the
/// search field, a save panel with the file-name field. A plain alert
/// (buttons and a text) has none of that; a document window is neither a
/// sheet nor a dialog.
pub fn classify<N: Win>(window: &N) -> Option<Kind> {
    let top = window.facts()?;
    match top.identifier.as_str() {
        "open-panel" => return Some(Kind::Open),
        "save-panel" => return Some(Kind::Save),
        _ => {}
    }
    if !(top.role == "AXSheet" || top.subrole == "AXDialog" || top.subrole == "AXSystemDialog") {
        return None;
    }
    let mut seen = Seen::default();
    walk(window, 0, &mut seen);
    if !seen.browser || !(seen.search || seen.popup) {
        return None;
    }
    Some(if seen.save_field { Kind::Save } else { Kind::Open })
}

#[derive(Default)]
struct Seen {
    browser: bool,
    search: bool,
    popup: bool,
    save_field: bool,
    nodes: usize,
}

fn walk<N: Win>(n: &N, depth: usize, seen: &mut Seen) {
    if depth > MAX_DEPTH || seen.nodes >= MAX_NODES {
        return;
    }
    for c in n.children() {
        seen.nodes += 1;
        if seen.nodes >= MAX_NODES {
            return;
        }
        let Some(f) = c.facts() else { continue };
        let label = f.title.trim_end_matches(':').to_ascii_lowercase();
        match f.role.as_str() {
            "AXBrowser" | "AXOutline" | "AXTable" => seen.browser = true,
            "AXTextField" if f.subrole == "AXSearchField" => seen.search = true,
            "AXTextField" if f.identifier == "saveAsNameTextField" || matches!(label.as_str(), "save as" | "export as" | "name") => seen.save_field = true,
            "AXPopUpButton" => seen.popup = true,
            // A sheet on the dialog (its own Go to Folder) is not the browser.
            "AXSheet" => continue,
            _ => {}
        }
        walk(&c, depth + 1, seen);
    }
}

// ---- the keystrokes ------------------------------------------------------

/// One step of typing a path into the panel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    /// A key with modifiers, as `Action.shortcut` spells it (`cmd+shift+g`, `enter`).
    Key(&'static str),
    /// The path onto the clipboard, then the paste shortcut.
    Paste,
    Wait(Duration),
}

/// Which desktop's file dialog the plan is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Toolkit {
    /// NSOpenPanel / NSSavePanel: `cmd+shift+g` opens the Go to Folder sheet.
    AppKit,
    /// GTK's file chooser: `ctrl+l` shows the location field.
    Gtk,
}

/// After the field's shortcut before the paste, and after the paste
/// before Return: the sheet has to come up and the text to land.
pub const SETTLE: Duration = Duration::from_millis(150);

/// The keystrokes that put `path` into the panel: the location field's
/// shortcut, the path pasted, Return. A trailing slash is kept: the Go to
/// Folder sheet accepts either.
pub fn plan(toolkit: Toolkit) -> Vec<Step> {
    let field = match toolkit {
        Toolkit::AppKit => "cmd+shift+g",
        Toolkit::Gtk => "ctrl+l",
    };
    vec![Step::Key(field), Step::Wait(SETTLE), Step::Paste, Step::Wait(SETTLE), Step::Key("enter")]
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::ax::element::Element;
    use objc2_app_kit::NSWorkspace;

    impl Win for Element {
        fn facts(&self) -> Option<Facts> {
            let v = self.attrs(&["AXRole", "AXSubrole", "AXTitle", "AXIdentifier"]);
            let role = Element::as_text(&v[0])?;
            Some(Facts { role, subrole: Element::as_text(&v[1]).unwrap_or_default(), title: Element::as_text(&v[2]).unwrap_or_default(), identifier: Element::as_text(&v[3]).unwrap_or_default() })
        }
        fn children(&self) -> Vec<Self> {
            self.elements("AXChildren")
        }
    }

    pub fn detect() -> Option<Dialog> {
        if !crate::ax::trusted() {
            return None;
        }
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let pid = app.processIdentifier();
        if pid == std::process::id() as i32 {
            return None;
        }
        let el = Element::app(pid)?;
        let window = el.focused_window()?;
        let kind = classify(&window)?;
        Some(Dialog { app: app.localizedName().map(|s| s.to_string()).unwrap_or_default(), pid, kind, title: window.title().filter(|t| !t.is_empty()) })
    }

    pub fn go(path: &str) -> Result<Dialog> {
        if !crate::ax::trusted() {
            return Err(Error::NeedsAccessibility);
        }
        let d = detect().ok_or(Error::NoDialog)?;
        for step in plan(Toolkit::AppKit) {
            match step {
                Step::Key(k) => crate::clipboard::send_key(k).map_err(|e| Error::Unavailable(e.to_string()))?,
                Step::Paste => crate::clipboard::paste_text(path).map_err(|e| Error::Unavailable(e.to_string()))?,
                Step::Wait(d) => std::thread::sleep(d),
            }
        }
        Ok(d)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    /// No window tree to read on Wayland; the plan runs blind against the app in front.
    pub fn detect() -> Option<Dialog> {
        None
    }

    pub fn go(path: &str) -> Result<Dialog> {
        for step in plan(Toolkit::Gtk) {
            match step {
                Step::Key(k) => crate::clipboard::send_key(k).map_err(|e| Error::Unavailable(e.to_string()))?,
                Step::Paste => crate::clipboard::paste_text(path).map_err(|e| Error::Unavailable(e.to_string()))?,
                Step::Wait(d) => std::thread::sleep(d),
            }
        }
        Ok(Dialog { app: String::new(), pid: 0, kind: Kind::Open, title: None })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub fn detect() -> Option<Dialog> {
        None
    }
    pub fn go(_: &str) -> Result<Dialog> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake element: facts and children.
    struct Fake(Facts, Vec<Fake>);
    fn n(role: &str, subrole: &str, title: &str, kids: Vec<Fake>) -> Fake {
        Fake(Facts { role: role.into(), subrole: subrole.into(), title: title.into(), identifier: String::new() }, kids)
    }
    fn with_id(mut f: Fake, id: &str) -> Fake {
        f.0.identifier = id.into();
        f
    }
    impl Win for &Fake {
        fn facts(&self) -> Option<Facts> {
            Some(self.0.clone())
        }
        fn children(&self) -> Vec<Self> {
            self.1.iter().collect()
        }
    }

    fn open_panel() -> Fake {
        n("AXWindow", "AXDialog", "Open", vec![
            n("AXGroup", "", "", vec![n("AXPopUpButton", "", "", vec![]), n("AXTextField", "AXSearchField", "Search", vec![])]),
            n("AXSplitGroup", "", "", vec![n("AXScrollArea", "", "", vec![]), n("AXBrowser", "", "", vec![])]),
            n("AXButton", "", "Open", vec![]),
        ])
    }

    /// TextEdit's standalone Open panel and its Save sheet, as AX reported them (`cargo run -p pal-core --example dialog`).
    #[test]
    fn appkits_identifiers_settle_it_whatever_the_role() {
        let open = with_id(n("AXWindow", "AXStandardWindow", "Open", vec![]), "open-panel");
        assert_eq!(classify(&&open), Some(Kind::Open), "a standalone panel is a standard window with the identifier");
        let save = with_id(n("AXSheet", "", "", vec![n("AXTextField", "", "", vec![])]), "save-panel");
        assert_eq!(classify(&&save), Some(Kind::Save));
    }

    #[test]
    fn an_open_panel_is_a_dialog_with_a_browser_and_a_search_field() {
        assert_eq!(classify(&&open_panel()), Some(Kind::Open));
        let sheet = n("AXSheet", "", "", open_panel().1);
        assert_eq!(classify(&&sheet), Some(Kind::Open), "a sheet on a document window");
    }

    #[test]
    fn a_save_as_field_makes_it_a_save_panel() {
        let mut p = open_panel();
        p.1.push(n("AXTextField", "", "Save As:", vec![]));
        assert_eq!(classify(&&p), Some(Kind::Save));
        let mut e = open_panel();
        e.1.push(n("AXTextField", "", "Export As:", vec![]));
        assert_eq!(classify(&&e), Some(Kind::Save), "an export sheet names its field differently");
        let mut f = open_panel();
        f.1.push(with_id(n("AXTextField", "", "", vec![]), "saveAsNameTextField"));
        assert_eq!(classify(&&f), Some(Kind::Save), "the field's label is a static text beside it; the identifier is the field's");
    }

    #[test]
    fn a_document_window_and_an_alert_are_not_panels() {
        let doc = n("AXWindow", "AXStandardWindow", "Untitled", vec![n("AXScrollArea", "", "", vec![n("AXTextArea", "", "", vec![])])]);
        assert_eq!(classify(&&doc), None);
        let alert = n("AXWindow", "AXDialog", "alert", vec![n("AXStaticText", "", "Save changes?", vec![]), n("AXButton", "", "Save", vec![])]);
        assert_eq!(classify(&&alert), None, "a dialog with no file browser is not a file dialog");
        let table_only = n("AXWindow", "AXDialog", "", vec![n("AXTable", "", "", vec![])]);
        assert_eq!(classify(&&table_only), None, "a browser without the search field or a popup could be any list");
    }

    #[test]
    fn the_plan_is_the_field_shortcut_the_paste_and_return() {
        assert_eq!(plan(Toolkit::AppKit), vec![Step::Key("cmd+shift+g"), Step::Wait(SETTLE), Step::Paste, Step::Wait(SETTLE), Step::Key("enter")]);
        assert_eq!(plan(Toolkit::Gtk)[0], Step::Key("ctrl+l"));
    }
}
