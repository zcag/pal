//! pal's configuration: one TOML file, `~/.config/pal/config.toml`.
//!
//! The file is the source of truth and the settings UI is a front for it, so
//! everything here is built around the file rather than around the struct:
//!
//! - [`ConfigFile::load`] reads it into [`Config`], layering the file over the
//!   built-in defaults field by field. Keys the schema does not know are kept
//!   (in `extra` maps) and reported as [`Diagnostic`]s, never errors.
//! - [`ConfigFile::set`] / [`ConfigFile::unset`] edit the text surgically with
//!   `toml_edit`, so comments, order and spacing the user wrote survive.
//! - [`ConfigFile::watch`] re-loads on change and keeps the last good config
//!   live when a save does not parse.
//! - [`schema`] emits a JSON Schema for the typed part so editors validate and
//!   complete the file.
//! - [`migrate`] turns a pal v1 config found at the path into this shape
//!   on first run, keeping the v1 file aside for the `scripts` extension.
//! - [`secrets`] resolves `keychain:` / `env:` references lazily, so secrets
//!   never sit in the file as plain text.

mod edit;
pub mod instance;
pub mod migrate;
pub mod schema;
pub mod secrets;
pub mod specs;
mod watch;
use crate::fs;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::index::{Caps, Tier};
pub use edit::json_to_toml;
pub use watch::Watcher;

/// pal's settings: everything the settings view can set, in the file it
/// writes. (The set of keys is small and provisional; the mechanics around
/// them are what is settled.)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(
    title = "pal config",
    extend("additionalProperties" = false),
    extend("x-taplo-info" = { "authors": ["pal"], "patterns": ["**/pal/config.toml"] })
)]
pub struct Config {
    pub general: General,
    /// Per-palette settings, keyed by palette id.
    pub palettes: BTreeMap<String, Palette>,
    /// Bar items: the menu bar and sketchybar strips (`docs/design/bar.md`).
    pub bar: Bar,
    /// The sidebar: a live palette docked to a screen edge
    /// (`docs/design/switcher.md`).
    pub sidebar: Sidebar,
    /// Instances of `multi` extensions, keyed `<name>@<suffix>`
    /// (`[instances."gmail@work"]`; the table existing is what makes the
    /// instance) or by the bare name to title the default one
    /// (`docs/design/instances.md`).
    pub instances: BTreeMap<String, Instance>,
    /// States: named variables bar items and extensions read
    /// (`[states.working] expr = "hour >= 9 and hour < 18"`;
    /// `docs/design/states.md`).
    pub states: BTreeMap<String, crate::states::Decl>,
    /// Extension settings, keyed by extension name, or by instance key
    /// (`[extensions."gmail@work"]`, which inherits `[extensions.gmail]`
    /// except its secrets and `scope: "instance"` settings). Shape is
    /// whatever the extension declared.
    #[schemars(with = "BTreeMap<String, BTreeMap<String, serde_json::Value>>")]
    pub extensions: BTreeMap<String, toml::Table>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct General {
    /// Global hotkey that shows pal, e.g. `ctrl+space`, or several that
    /// all do (`["cmd+space", "ctrl+space"]`). Empty turns it off, for a
    /// compositor keybind that runs `pal toggle` instead. On macOS
    /// `cmd+space` is Spotlight's until its "Show Spotlight search"
    /// shortcut is unticked under System Settings > Keyboard > Keyboard
    /// Shortcuts; pal says so in Settings and registers it once it is free.
    pub hotkey: Hotkeys,
    pub theme: Theme,
    /// A theme file overriding pal's colours, radii and fonts
    /// (`pal_core::theme`, docs/config.md "Theme file"): a name, looked up
    /// as `<config dir>/themes/<name>.toml`, or a path (`~` expanded).
    /// Light and dark sections apply to the scheme `theme` (or the OS)
    /// picks; the file is watched and applies live. Empty is pal's own.
    pub theme_file: String,
    /// Compact mode: the panel 560 px wide with 32 px rows, no detail
    /// pane, and the footer folded into the search row (the primary
    /// action's hint on its right). `cmd+shift+m` in the panel flips it
    /// and writes it here, so it is remembered per profile.
    pub compact: bool,
    /// Start pal when you sign in: a LaunchAgent on macOS, a `pal.service`
    /// user unit on Linux (an XDG autostart entry without systemd). The
    /// same agent relaunches pal after a crash, on or off.
    pub launch_at_login: bool,
    /// Show pal's icon in the menu bar (macOS) or system tray (Linux). The
    /// app has no Dock icon, so this is the visible way to reach Settings
    /// and Quit; the hotkey and `pal settings` work without it.
    pub menu_bar_icon: bool,
    /// Where the panel appears on the screen with the pointer.
    pub position: Position,
    /// Look for a newer release 20 s after startup and once a day, in
    /// release builds (the GitHub release manifest; nothing is downloaded
    /// by the check). A found release shows on the Overview, the About
    /// page and as an "Install Update" row at the root; installing is
    /// always your click. `false` turns the automatic check off; "Check
    /// for Updates" still runs one on demand.
    pub check_updates: bool,
    /// Extra directories of extensions (one subdirectory per extension,
    /// like the store), for a dotfiles-managed set. Loaded after the
    /// bundled extensions and the store, so a name in a later directory
    /// replaces an earlier one. `~` is expanded. The host is restarted
    /// (`pal reload`) before a change here is seen.
    pub extension_dirs: Vec<String>,
    /// macOS: ask for the Accessibility permission (the system prompt, and
    /// System Settings on that pane) the first time the panel shows on a
    /// profile that has not hidden the Welcome tips yet. Paste and window
    /// switching need it; `false` leaves the ask to the Welcome row and to
    /// Settings > General > Permissions.
    pub ask_permissions_on_start: bool,
    /// When an app does not expose its selected text to the accessibility
    /// API (`selection.text()`, `{selection}` in a snippet), fall back to
    /// sending the copy shortcut and reading the clipboard, which is put
    /// back as it was. `false` keeps pal off the clipboard: the selection
    /// is then only what the API reports. macOS needs Accessibility for
    /// either.
    pub selection_snapshot: bool,
    /// A `pal://` link that acts (`run`, `form`, `paste`, `open?url=`, an
    /// extension's route; a web page can emit one) shows a confirm card
    /// first. `true` asks; `false` runs it straight away, for scripts that
    /// drive pal by link; a list of extension names asks for everything
    /// except links into those extensions (a name covers every instance of
    /// it, a key one instance). `install`, `update`, `remove` and
    /// `instance/*` always ask; the CLI never does (docs/design/links.md).
    pub deeplink_confirm: Confirm,
    /// How many rows one palette may show at the root for a typed query,
    /// by its tier: `{ primary = 8, normal = 6, catalog = 3 }`. The rest
    /// is a "N more in ..." row that opens the palette. The empty query
    /// and a palette's own level are never capped.
    pub root_caps: Caps,
    /// Palettes whose rows lead the others of their band at the root, in
    /// this order: `["browser-tabs/tabs", "windows/windows", "apps/apps",
    /// "pal/palettes"]` (a tab over a window over an app over a palette
    /// row, all over the rest). Each gets
    /// `root_first_step` more than the next, on top of its tier, which
    /// orders rows of equal standing and never lifts a row that only
    /// scatters the letters over one that has the typed word.
    pub root_first: Vec<String>,
    /// Points between two `root_first` palettes; `30` keeps the whole
    /// ladder under the word bonus (300) and the tier spread (150).
    pub root_first_step: f64,
    /// At the root, a palette with a row that has the typed word shows
    /// only those rows: `spo` is Spotify, not Spotify and six apps that
    /// spell it out of their bundle ids (they stay in the "N more" row).
    /// `false` leaves every match to the cap.
    pub root_cut: bool,
    /// The rows offered when a typed query matches nothing, in this order:
    /// `web` (Search the web, `search_engine`), `url` (Open as URL, when the
    /// query looks like one), then palette ids that opted in (`quicklinks`
    /// fills its `{query}` links, `calc` and `files` open with the query
    /// typed, any other input palette as "Ask <name>"). A fallback palette
    /// not named here comes after these, in load order; one named here that
    /// does not exist is skipped.
    pub fallbacks: Vec<String>,
    /// Show the fallback rows under the hits as well, not only when nothing
    /// matched.
    pub fallbacks_always: bool,
    /// The "Search the web" fallback's URL, `{query}` percent-encoded into it.
    pub search_engine: String,
    /// Typing a palette's alias (or its name, or its one-word title) and a
    /// space at the root jumps into that palette with the rest typed:
    /// `calc 2+2`, `emoji cat`. `false` leaves the space as a character.
    pub alias_space: bool,
    /// Backspace with nothing typed goes back a level, the way `cmd+backspace`
    /// does (never at the root; a row's own Backspace action, a folder's
    /// Go up, comes first; a view's keys are its own). `false` leaves it
    /// to the row alone.
    pub backspace_back: bool,
    /// Remember the last 20 root queries that led to a pick (never synced:
    /// `frecency.json` in the profile). Up at the top of an empty root
    /// list walks them; "Clear Search History" in pal's commands empties
    /// them. `false` neither records nor recalls.
    pub search_history: bool,
    /// What a re-show lands on: `"always"` back at the root (as before),
    /// `"never"` where you left (the level and the query kept), or `"after
    /// 90s"`: kept while the panel was hidden for less than that many
    /// seconds, the root after. A palette hotkey always opens its palette.
    #[schemars(with = "String")]
    pub pop_to_root: PopToRoot,
    /// The palettes whose `suggest()` rows lead the empty root ("Now"), in
    /// this order; suggesting palettes not named here follow in load order.
    pub now: Vec<String>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for General {
    fn default() -> Self {
        Self {
            hotkey: Hotkeys::default(),
            theme: Theme::System,
            theme_file: String::new(),
            compact: false,
            launch_at_login: false,
            menu_bar_icon: true,
            position: Position::Top,
            check_updates: true,
            extension_dirs: Vec::new(),
            ask_permissions_on_start: true,
            selection_snapshot: true,
            deeplink_confirm: Confirm::default(),
            root_caps: Caps::default(),
            root_first: DEFAULT_ROOT_FIRST.iter().map(|s| s.to_string()).collect(),
            root_first_step: 30.0,
            root_cut: true,
            fallbacks: DEFAULT_FALLBACKS.iter().map(|s| s.to_string()).collect(),
            fallbacks_always: false,
            search_engine: DEFAULT_SEARCH_ENGINE.into(),
            alias_space: true,
            backspace_back: true,
            search_history: true,
            pop_to_root: PopToRoot::default(),
            now: DEFAULT_NOW.iter().map(|s| s.to_string()).collect(),
            extra: BTreeMap::new(),
        }
    }
}

/// `general.fallbacks` when unset: the shell's two rows, then the bundled palettes that opt in.
pub const DEFAULT_FALLBACKS: [&str; 5] = ["web", "url", "quicklinks", "calc", "files"];
/// `[general] root_first` unset: what is open, then what can be opened.
pub const DEFAULT_ROOT_FIRST: [&str; 4] = ["browser-tabs/tabs", "windows/windows", "apps/apps", "pal/palettes"];
/// `general.search_engine` when unset.
pub const DEFAULT_SEARCH_ENGINE: &str = "https://www.google.com/search?q={query}";
/// `general.now` when unset: the next event, the running timer, what plays, what is on the clipboard.
pub const DEFAULT_NOW: [&str; 4] = ["calendar-today", "timer-timers", "media", "clipboard-rows"];

/// `general.pop_to_root`: `"always"`, `"never"`, or `"after 90s"` (any
/// whole number of seconds; `"after 2m"` and `"after 1h"` are read too).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PopToRoot {
    Always,
    Never,
    /// Keep the level while the panel was hidden for under this many seconds.
    After(u64),
}

impl Default for PopToRoot {
    fn default() -> Self {
        Self::After(90)
    }
}

impl PopToRoot {
    /// `"always"`, `"never"`, `"after 90s"` (spaces and case do not matter; a bare number is seconds).
    pub fn parse(s: &str) -> Option<Self> {
        let s = s.trim().to_lowercase();
        match s.as_str() {
            "always" | "immediately" => return Some(Self::Always),
            "never" => return Some(Self::Never),
            _ => {}
        }
        let rest = s.strip_prefix("after").unwrap_or(&s).trim();
        let (digits, unit) = rest.split_at(rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len()));
        let n: u64 = digits.parse().ok()?;
        let secs = match unit.trim() {
            "" | "s" | "sec" | "secs" | "second" | "seconds" => n,
            "m" | "min" | "mins" | "minute" | "minutes" => n.checked_mul(60)?,
            "h" | "hour" | "hours" => n.checked_mul(3600)?,
            _ => return None,
        };
        Some(if secs == 0 { Self::Always } else { Self::After(secs) })
    }

    /// Whether a show `hidden_for` seconds after the hide keeps the level.
    pub fn keeps(self, hidden_for: f64) -> bool {
        match self {
            Self::Always => false,
            Self::Never => true,
            Self::After(secs) => hidden_for < secs as f64,
        }
    }
}

impl std::fmt::Display for PopToRoot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Always => f.write_str("always"),
            Self::Never => f.write_str("never"),
            Self::After(s) => write!(f, "after {s}s"),
        }
    }
}

impl Serialize for PopToRoot {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for PopToRoot {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Self::parse(&s).ok_or_else(|| serde::de::Error::custom(format!("pop_to_root: {s:?} is not \"always\", \"never\" or \"after <seconds>s\"")))
    }
}

/// `general.deeplink_confirm`: whether a link that acts shows the confirm
/// card. `true`/`false` for all, or the extensions whose links are trusted
/// (the card is skipped for `run`, `form` and routes into them).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum Confirm {
    /// `deeplink_confirm = true` (ask) or `false` (never).
    All(bool),
    /// `deeplink_confirm = ["timer", "quicklinks"]`: ask, except for these.
    Except(Vec<String>),
}

impl Confirm {
    /// Whether a link into `extension` (none for an app-level route like
    /// `paste`) shows the card. The list trusts by name (`"gmail"` covers
    /// every instance, `gmail@work` included) or by one key.
    pub fn asks(&self, extension: Option<&str>) -> bool {
        match self {
            Self::All(b) => *b,
            Self::Except(list) => !extension.is_some_and(|e| list.iter().any(|x| x.trim() == e || x.trim() == instance::name_of(e))),
        }
    }
}

impl Default for Confirm {
    fn default() -> Self {
        Self::All(true)
    }
}

/// `general.hotkey`: one combination, or a list that all show the panel.
/// The two spellings are one setting; each is written back as it was read
/// (the file's shape is kept until an edit needs the other one).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum Hotkeys {
    /// `hotkey = "ctrl+space"`; `""` is off.
    One(String),
    /// `hotkey = ["cmd+space", "ctrl+space"]`; `[]` is off.
    Many(Vec<String>),
}

impl Hotkeys {
    /// What registers: every entry trimmed, blanks dropped, in the file's order.
    pub fn list(&self) -> Vec<&str> {
        let entries: &[String] = match self {
            Self::One(s) => std::slice::from_ref(s),
            Self::Many(v) => v,
        };
        entries.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect()
    }

    /// No hotkey at all (`""` or `[]`, or only blanks).
    pub fn is_empty(&self) -> bool {
        self.list().is_empty()
    }

    /// The first entry: what one label (the menu bar hint, the Welcome tips) shows.
    pub fn first(&self) -> Option<&str> {
        self.list().first().copied()
    }
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self::One("ctrl+space".into())
    }
}

impl From<&str> for Hotkeys {
    fn from(s: &str) -> Self {
        Self::One(s.into())
    }
}

impl<const N: usize> From<[&str; N]> for Hotkeys {
    fn from(v: [&str; N]) -> Self {
        Self::Many(v.iter().map(|s| s.to_string()).collect())
    }
}

impl PartialEq<str> for Hotkeys {
    /// `hotkey == "ctrl+space"`: the one entry it is, whichever spelling.
    fn eq(&self, other: &str) -> bool {
        self.list() == [other]
    }
}

impl PartialEq<&str> for Hotkeys {
    fn eq(&self, other: &&str) -> bool {
        self == *other
    }
}

impl General {
    /// [`extension_dirs`](Self::extension_dirs) as paths, `~` expanded.
    pub fn extension_dirs(&self) -> Vec<PathBuf> {
        self.extension_dirs.iter().map(|d| fs::expand_home(d)).collect()
    }
}

/// `top`: a fifth of the way down, where Spotlight and Raycast sit.
/// `centre`: centred. `last`: wherever it was last shown.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Position {
    #[default]
    Top,
    Centre,
    Last,
}

/// Follow the OS, or force one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// Per-palette settings pal provides to every palette extension without it
/// declaring them. A palette absent from the file gets the defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Palette {
    pub enabled: bool,
    /// An extra keyword on the palette's row at the root, so typing it finds
    /// the palette; `Enter` then opens it as usual.
    pub alias: Option<String>,
    /// Hotkey that opens pal directly in this palette.
    pub hotkey: Option<String>,
    /// The switcher chord: held, it shows this palette flat with the cursor
    /// on row 2, every press steps (its `shift+` variant back), letting go
    /// of the modifier runs the row (`alt+tab` on Windows). `""` turns off
    /// the default the extension's manifest suggests.
    pub hold: Option<String>,
    /// Global hotkeys that run one of the palette's items without showing
    /// the panel, keyed by item id: `left_half = "ctrl+alt+left"` under
    /// `[palettes.window-management.item_hotkeys]`. The item's primary
    /// action runs as if picked.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub item_hotkeys: BTreeMap<String, String>,
    /// Icon override; the extension's own icon when unset.
    pub icon: Option<String>,
    /// The palette's tier at the root over what its manifest says:
    /// `primary` (reached by name, ranked up), `normal`, `catalog` (a big
    /// static list, ranked down and capped harder).
    pub tier: Option<Tier>,
    /// Settings the extension declared for this palette.
    #[schemars(with = "BTreeMap<String, serde_json::Value>")]
    pub settings: toml::Table,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for Palette {
    fn default() -> Self {
        Self { enabled: true, alias: None, hotkey: None, hold: None, item_hotkeys: BTreeMap::new(), icon: None, tier: None, settings: toml::Table::new(), extra: BTreeMap::new() }
    }
}

/// `[instances.<key>]`: one configured copy of a `multi` extension. The
/// key is fixed at creation (`<name>@<suffix>`, `instance::is_key`); the
/// bare name titles the default instance. Its settings live in
/// `[extensions.<key>]`, its palettes' in `[palettes."<key>-<palette>"]`,
/// its bar items' in `[bar.items."<key>/<id>"]`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Instance {
    /// The display name ("Work"): the suffix capitalised when unset. The
    /// default instance has none until you name it.
    pub title: Option<String>,
    /// The tile's colour, one of the twelve brand names (`red`, `amber`,
    /// `blue`, ...): picked from the suffix when unset. The default
    /// instance keeps the extension's own tile.
    pub tint: Option<String>,
    /// One or two characters in the tile's corner: the title's first
    /// letter when unset.
    pub badge: Option<String>,
    /// `false` parks the instance: not loaded, its rows and bar items gone,
    /// its settings kept.
    pub enabled: bool,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for Instance {
    fn default() -> Self {
        Self { title: None, tint: None, badge: None, enabled: true, extra: BTreeMap::new() }
    }
}


/// Where bar items are drawn. `auto`: sketchybar when it answers
/// (`sketchybar --query bar`), else the macOS menu bar.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BarTarget {
    #[default]
    Auto,
    Menubar,
    Sketchybar,
    Both,
    Off,
}

/// `[bar]`: the strips extensions draw on (`docs/design/bar.md`), the
/// hover timings, one table per target and one per item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Bar {
    /// Default target for every item; an item's own `target` overrides.
    pub target: BarTarget,
    /// Milliseconds the pointer rests on an item before a peek opens.
    pub hover_delay: u64,
    /// Milliseconds after the pointer has left both the item and the
    /// popover before a peek closes.
    pub hover_grace: u64,
    pub menubar: BarMenubar,
    pub sketchybar: BarSketchybar,
    /// Per-item settings, keyed `extension/id` (`[bar.items."github/notifications"]`).
    pub items: BTreeMap<String, BarItemConfig>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for Bar {
    fn default() -> Self {
        Self { target: BarTarget::Auto, hover_delay: 250, hover_grace: 400, menubar: BarMenubar::default(), sketchybar: BarSketchybar::default(), items: BTreeMap::new(), extra: BTreeMap::new() }
    }
}

/// Which screen edge the sidebar docks to.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Edge {
    Left,
    #[default]
    Right,
}

/// `[sidebar]`: one live palette docked to a screen edge, peeked when the
/// pointer rests there, engaged by a click, a key or its hotkey; every
/// row numbered so `cmd+N` runs it (`docs/design/switcher.md`). The hover
/// timings are `[bar]`'s. macOS only: read and validated on Linux, nothing
/// built.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Sidebar {
    /// The palette it shows, `extension/palette`; empty (the default) is
    /// no sidebar: an edge that peeks is asked for, never shipped on.
    pub palette: String,
    /// The screen edge it docks to.
    pub edge: Edge,
    /// Which display: `cursor` (the one under the pointer at each show),
    /// `primary` (the one with the menu bar), or a display's name as the
    /// OS reports it (`Built-in Retina Display`).
    pub display: String,
    /// Width in points; the height follows the rows up to the work area.
    pub width: f64,
    /// The pointer at the edge peeks it.
    pub peek: bool,
    /// Milliseconds the pointer rests at the edge before the peek; 0 is at once.
    pub delay: u64,
    /// Milliseconds after the pointer has left the edge and the window before a peek closes.
    pub grace: u64,
    /// Global hotkey that engages it. Same syntax as `general.hotkey`; the
    /// root, palette and bar item hotkeys win a clash.
    pub hotkey: Option<String>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for Sidebar {
    fn default() -> Self {
        Self { palette: String::new(), edge: Edge::Right, display: "cursor".into(), width: 320.0, peek: true, delay: 0, grace: 150, hotkey: None, extra: BTreeMap::new() }
    }
}

impl Sidebar {
    /// The palette key, or none: an empty `palette` is no sidebar.
    pub fn palette(&self) -> Option<&str> {
        Some(self.palette.trim()).filter(|p| !p.is_empty())
    }
}

/// `badge_style`: how a count badge is drawn.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BadgeStyle {
    /// The number (` ·3` on the menu bar, in red on sketchybar's label).
    #[default]
    Count,
    /// A dot, whatever the number.
    Dot,
    /// Nothing; the count stays in the tooltip.
    None,
}

/// `font`: the text's face.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BarFont {
    /// The bar's own face.
    #[default]
    System,
    /// Monospace, for codes and times that must not jitter (SF Mono on the menu bar, Menlo on sketchybar).
    Mono,
}

/// How a target draws its items: the appearance keys of `[bar.menubar]`
/// and `[bar.sketchybar]`, each overridable per item in
/// `[bar.items."<key>"]` (`BarLookOverride`). The same key means the same
/// thing on both targets where the target can; the docs say where one cannot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct BarLook {
    /// A muted item's strength, in percent: a stale item and an item the
    /// extension colours `muted` draw at this opacity.
    pub dim: u32,
    /// The item's strength, in percent: every colour it draws (the icon,
    /// the text, the segments, the badge) at this alpha. A muted item is
    /// at `dim` of this (the two multiply: `opacity = 60`, `dim = 50` draws
    /// a stale item at 30).
    pub opacity: u32,
    /// Point size of the glyph and the text; `0` is the target's own (the
    /// menu bar's 13 pt text and 14 pt glyph, sketchybar's font).
    pub size: f64,
    /// Point size of the glyph alone; `0` follows `size`.
    pub icon_size: f64,
    /// Point size of the title and the segments alone; `0` follows `size`.
    pub text_size: f64,
    /// Points between the icon, the title and the segments.
    pub spacing: u32,
    /// Draw the icon.
    pub show_icon: bool,
    /// A glyph, an emoji or a short text drawn as the icon in place of the
    /// one the extension answers (what `BarItem.icon` takes as a string),
    /// or a picture: an absolute or `~/` path to an image file (PNG, JPEG,
    /// GIF, SVG), a `data:image/` URI or an `icon://` url. Only an item's
    /// own makes sense (every item the same icon is no bar), so a target
    /// leaves it unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Draw the title and the segments; off is a glyph-only item.
    pub show_title: bool,
    /// The tint: a colour name (`grey`, `blue`, `green`, `amber`, `red`,
    /// `violet`, `pink`, `teal`, `accent`, `text`, `muted`) or `#rrggbb`,
    /// drawn in place of the colour the extension answers. Unset keeps the
    /// extension's: a coloured item its own, the rest the bar's text colour.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The colour of an urgent item, a name or `#rrggbb`.
    pub urgent_color: String,
    /// The colour of a count badge and a dot, a name or `#rrggbb`. Unset
    /// draws them in the item's own colour (the tint; `urgent_color` while
    /// urgent), so a mail count is not red by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge_color: Option<String>,
    /// How a count badge is drawn: `count`, `dot` or `none`.
    pub badge_style: BadgeStyle,
    /// A fixed width in points, so a ticking timer does not jitter; `0`
    /// is the natural width. Text past it is clipped.
    pub width: u32,
    /// `system` or `mono`.
    pub font: BarFont,
    /// Longest title an item draws, in characters; longer text ends in an
    /// ellipsis. Apple's bar hides whatever runs into the notch or past the
    /// left edge, so a lyric line or a track title must stop short.
    pub max_chars: usize,
}

impl Default for BarLook {
    fn default() -> Self {
        Self { dim: 50, opacity: 100, size: 0.0, icon_size: 0.0, text_size: 0.0, spacing: 4, show_icon: true, icon: None, show_title: true, color: None, urgent_color: "destructive".into(), badge_color: None, badge_style: BadgeStyle::Count, width: 0, font: BarFont::System, max_chars: 32 }
    }
}

/// One item's say on each `BarLook` key; `None` is the target's default.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
pub struct BarLookOverride {
    /// A muted item's strength here, percent. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dim: Option<u32>,
    /// This item's strength, percent, on every colour it draws. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<u32>,
    /// Point size of the glyph and the text here. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    /// Point size of this item's glyph alone; `0` follows `size`. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_size: Option<f64>,
    /// Point size of this item's text alone; `0` follows `size`. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_size: Option<f64>,
    /// Points between the icon, the title and the segments here. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spacing: Option<u32>,
    /// Draw this item's icon. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_icon: Option<bool>,
    /// A glyph, an emoji or a short text drawn as this item's icon in place of the extension's. The extension's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Draw this item's title and segments. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_title: Option<bool>,
    /// This item's tint, a colour name or `#rrggbb`. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// This item's colour when urgent. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub urgent_color: Option<String>,
    /// The colour of this item's count badge and dot, a name or `#rrggbb`. The target's when unset (its own colour when that is too).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge_color: Option<String>,
    /// How this item's count badge is drawn. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge_style: Option<BadgeStyle>,
    /// A fixed width in points for this item; `0` is natural. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// `system` or `mono` for this item. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<BarFont>,
    /// This item's longest title, in characters. The target's when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<usize>,
}

impl BarLookOverride {
    /// This override with `o`'s set keys on top (a rule's over the item's).
    pub fn with(&self, o: &BarLookOverride) -> BarLookOverride {
        BarLookOverride {
            dim: o.dim.or(self.dim),
            opacity: o.opacity.or(self.opacity),
            size: o.size.or(self.size),
            icon_size: o.icon_size.or(self.icon_size),
            text_size: o.text_size.or(self.text_size),
            spacing: o.spacing.or(self.spacing),
            show_icon: o.show_icon.or(self.show_icon),
            icon: o.icon.clone().or_else(|| self.icon.clone()),
            show_title: o.show_title.or(self.show_title),
            color: o.color.clone().or_else(|| self.color.clone()),
            urgent_color: o.urgent_color.clone().or_else(|| self.urgent_color.clone()),
            badge_color: o.badge_color.clone().or_else(|| self.badge_color.clone()),
            badge_style: o.badge_style.or(self.badge_style),
            width: o.width.or(self.width),
            font: o.font.or(self.font),
            max_chars: o.max_chars.or(self.max_chars),
        }
    }
}

impl BarLook {
    /// This look with `o`'s keys on top.
    pub fn with(&self, o: &BarLookOverride) -> BarLook {
        BarLook {
            dim: o.dim.unwrap_or(self.dim).min(100),
            opacity: o.opacity.unwrap_or(self.opacity).min(100),
            size: o.size.unwrap_or(self.size).max(0.0),
            icon_size: o.icon_size.unwrap_or(self.icon_size).max(0.0),
            text_size: o.text_size.unwrap_or(self.text_size).max(0.0),
            spacing: o.spacing.unwrap_or(self.spacing),
            show_icon: o.show_icon.unwrap_or(self.show_icon),
            icon: o.icon.clone().or_else(|| self.icon.clone()).filter(|i| !i.trim().is_empty()),
            show_title: o.show_title.unwrap_or(self.show_title),
            color: o.color.clone().or_else(|| self.color.clone()).filter(|c| !c.is_empty()),
            urgent_color: o.urgent_color.clone().unwrap_or_else(|| self.urgent_color.clone()),
            badge_color: o.badge_color.clone().or_else(|| self.badge_color.clone()).filter(|c| !c.is_empty()),
            badge_style: o.badge_style.unwrap_or(self.badge_style),
            width: o.width.unwrap_or(self.width),
            font: o.font.unwrap_or(self.font),
            max_chars: o.max_chars.unwrap_or(self.max_chars).max(4),
        }
    }
}

/// `[bar.menubar]`: the macOS menu bar target. Hover off: Apple's bar has no hover convention.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct BarMenubar {
    /// A hover peeks the item's popover. Off: Apple's bar has no hover convention.
    pub open_on_hover: bool,
    #[serde(flatten)]
    pub look: BarLook,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

/// `[bar.sketchybar]`: the sketchybar target. Hover off too: a popover opens on a click, its hotkey, or a hover the owner asks for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct BarSketchybar {
    /// A hover peeks the item's popover. Off: a click opens and closes, like the menu bar; the owner's sketchybar may turn it on.
    pub open_on_hover: bool,
    /// Default position of pal's items: `left`, `right`, `center`, `q`,
    /// `e`, `before:<item>` or `after:<item>`.
    pub position: String,
    /// Overrides of the colour map, `0xAARRGGBB` per name (`red`,
    /// `muted`, `text`, ...), so a themed bar keeps its own palette.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub colors: BTreeMap<String, String>,
    #[serde(flatten)]
    pub look: BarLook,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for BarSketchybar {
    fn default() -> Self {
        Self { open_on_hover: false, position: "right".into(), colors: BTreeMap::new(), look: BarLook::default(), extra: BTreeMap::new() }
    }
}

/// `show`: what an item with nothing to say does with its slot.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BarShow {
    /// Off the strip while `render` answers `hidden` (the rule: an item earns its slot).
    #[default]
    Auto,
    /// Kept on the strip as the quiet shape its render offers (`BarItem.empty`:
    /// the glyph, an honest tooltip, the same popover), muted, without a badge.
    /// An item whose render offers none hides either way.
    Always,
}

/// `[bar.items."<extension>/<id>"]`: one item's settings; absent keys mean
/// the target's defaults.
/// One presentation rule of a bar item (`docs/design/states.md`, "Rules"):
/// while `when` (a state expression over the states the item publishes
/// and any other) is true, the item is hidden, urgent, or drawn with these
/// appearance keys. An extension declares its rules in `pal.json`
/// (`bar.<id>.rules`, an ordered list, later wins); the user overrides one
/// by its id here, any key alone (`[bar.items."power/battery".rules.low]
/// when = "power.level < 25"`), or adds one of their own (which needs
/// `when`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct BarRule {
    /// The state expression. Required on a rule of your own; on an
    /// extension's rule, unset keeps the extension's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    /// What the rule is for, on the Settings pane.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Off every target while the rule holds (its `empty` shape under
    /// `show = "always"`, as when the extension hides it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Drawn as an alarm while the rule holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub urgent: Option<bool>,
    /// A sketchybar position while the rule holds (`q` to bring a critical
    /// event centre, `left` to park a far one).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    /// The appearance while the rule holds, each key over the item's own.
    #[serde(flatten)]
    pub look: BarLookOverride,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl BarRule {
    /// `over` on top of this rule: every key `over` sets replaces this one's.
    pub fn with(&self, over: &BarRule) -> BarRule {
        let mut r = self.clone();
        if over.when.is_some() {
            r.when = over.when.clone();
        }
        if over.description.is_some() {
            r.description = over.description.clone();
        }
        if over.hidden.is_some() {
            r.hidden = over.hidden;
        }
        if over.urgent.is_some() {
            r.urgent = over.urgent;
        }
        if over.position.is_some() {
            r.position = over.position.clone();
        }
        r.look = self.look.with(&over.look);
        r
    }

    /// Whether the rule does anything when it holds.
    pub fn is_empty(&self) -> bool {
        self.hidden.is_none() && self.urgent.is_none() && self.position.is_none() && self.look == BarLookOverride::default()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct BarItemConfig {
    /// `false`: no slot on any target and no refresh timer.
    pub enabled: bool,
    /// `always` keeps the item on the strip when it has nothing to say, as
    /// the muted quiet shape its render offers; `auto` hides it then.
    pub show: BarShow,
    /// This item's target; the global `[bar] target` when unset.
    pub target: Option<BarTarget>,
    /// sketchybar position for this item (as `[bar.sketchybar] position`).
    pub position: Option<String>,
    /// Global hotkey that opens the item's popover engaged (or runs its open action).
    pub hotkey: Option<String>,
    /// A hover peeks this item; the target's default when unset.
    pub open_on_hover: Option<bool>,
    /// Order among pal's own items: ascending left to right on the menu
    /// bar and within a sketchybar position.
    pub order: Option<i64>,
    /// A state expression (`working`, `hour >= 9 and not deep`): the item
    /// is on the strip only while it is true. Read at draw time; no render
    /// while hidden.
    pub show_when: Option<String>,
    /// The opposite: the item leaves the strip while this is true. Both
    /// may be set.
    pub hide_when: Option<String>,
    /// The item's rules by id: an extension's overridden key by key, or
    /// one of your own (`BarRule`).
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub rules: BTreeMap<String, BarRule>,
    /// This item's appearance, each key over the target's default.
    #[serde(flatten)]
    pub look: BarLookOverride,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for BarItemConfig {
    fn default() -> Self {
        Self { enabled: true, show: BarShow::Auto, target: None, position: None, hotkey: None, open_on_hover: None, order: None, show_when: None, hide_when: None, rules: BTreeMap::new(), look: BarLookOverride::default(), extra: BTreeMap::new() }
    }
}

impl Bar {
    /// One item's settings, defaults when the file has no entry for it.
    pub fn item(&self, key: &str) -> std::borrow::Cow<'_, BarItemConfig> {
        self.items.get(key).map_or_else(|| std::borrow::Cow::Owned(BarItemConfig::default()), std::borrow::Cow::Borrowed)
    }

    /// One item's rules as they apply: the extension's (`manifest`, in
    /// its order) with the file's overrides by id on top, then the file's
    /// own rules (in key order). A rule of the file's own without `when`
    /// is left out.
    pub fn rules_of(&self, key: &str, manifest: &[(String, BarRule)]) -> Vec<(String, BarRule)> {
        let item = self.item(key);
        let mut out: Vec<(String, BarRule)> = manifest.iter().map(|(id, r)| (id.clone(), item.rules.get(id).map_or_else(|| r.clone(), |o| r.with(o)))).collect();
        out.extend(item.rules.iter().filter(|(id, r)| r.when.is_some() && !manifest.iter().any(|(m, _)| m == *id)).map(|(id, r)| (id.clone(), r.clone())));
        out
    }

    /// The target an item draws on: its own, else the global one.
    pub fn target_of(&self, key: &str) -> BarTarget {
        self.item(key).target.unwrap_or(self.target)
    }

    /// Whether `key` is drawn anywhere: enabled and not aimed at `off`. An
    /// item nothing draws is not rendered or polled either (a `[bar]
    /// target = "off"` config still asked the host for every item on its
    /// timer, otp and timer every 10 s).
    pub fn draws(&self, key: &str) -> bool {
        self.item(key).enabled && self.target_of(key) != BarTarget::Off
    }

    /// How `key` is drawn on `target`: the target's defaults with the
    /// item's own keys on top (`[bar.items."<key>"]`).
    pub fn look(&self, key: &str, target: BarTarget) -> BarLook {
        let base = match target {
            BarTarget::Sketchybar => &self.sketchybar.look,
            _ => &self.menubar.look,
        };
        base.with(&self.item(key).look)
    }

    /// The target's defaults with `over` on top: an item's keys with its
    /// active rules' merged in (`bar/mod.rs` `draw_for`).
    pub fn look_with(&self, target: BarTarget, over: &BarLookOverride) -> BarLook {
        let base = match target {
            BarTarget::Sketchybar => &self.sketchybar.look,
            _ => &self.menubar.look,
        };
        base.with(over)
    }

    /// Whether a hover peeks `key` on `target`: the item's say, else the target's.
    pub fn open_on_hover(&self, key: &str, target: BarTarget) -> bool {
        self.item(key).open_on_hover.unwrap_or(match target {
            BarTarget::Sketchybar => self.sketchybar.open_on_hover,
            _ => self.menubar.open_on_hover,
        })
    }

    /// The sketchybar position of `key`: its own, else the target's default.
    pub fn position_of(&self, key: &str) -> String {
        self.item(key).position.clone().unwrap_or_else(|| self.sketchybar.position.clone())
    }
}

impl Config {
    /// The palette's settings, defaults when the file has no entry for it.
    pub fn palette(&self, id: &str) -> std::borrow::Cow<'_, Palette> {
        self.palettes.get(id).map_or_else(|| std::borrow::Cow::Owned(Palette::default()), std::borrow::Cow::Borrowed)
    }

    /// Every instance of `name` the file describes, the default first
    /// (`[instances.<name>]` when the file titles it, else the defaults),
    /// then each `[instances."<name>@<suffix>"]` in key order; disabled
    /// ones included, so a list can show them parked. A table whose key is
    /// not well formed (`instance::is_key`) is left out, as `unknown_keys`
    /// warns about it.
    pub fn instances_of(&self, name: &str) -> Vec<(String, std::borrow::Cow<'_, Instance>)> {
        let mut out = vec![(name.to_string(), self.instances.get(name).map_or_else(|| std::borrow::Cow::Owned(Instance::default()), std::borrow::Cow::Borrowed))];
        out.extend(self.instances.iter().filter(|(k, _)| instance::is_key(k) && instance::name_of(k) == name).map(|(k, i)| (k.clone(), std::borrow::Cow::Borrowed(i))));
        out
    }

    /// The keys to load for `name`: the enabled instances, default first,
    /// when the extension declared `multi`; the bare name alone when it did
    /// not (a non-`multi` extension has no instances, whatever the file
    /// says; `[instances.<name>] enabled` still parks it).
    pub fn instance_keys(&self, name: &str, multi: bool) -> Vec<String> {
        self.instances_of(name).into_iter().filter(|(k, i)| i.enabled && (multi || k == name)).map(|(k, _)| k).collect()
    }

    /// An extension's settings as it should see them: the defaults its
    /// manifest declares, with every key the file sets under
    /// `[extensions.<key>]` on top. For a non-default instance
    /// (`gmail@work`) the default's table (`[extensions.gmail]`) sits in
    /// between, minus the settings `specs` declares `kind: "secret"` or
    /// `scope: "instance"` (`instance::private_ids`): a token or a server
    /// url identifies the account and is never inherited. Each layer is one
    /// level deep, a set key replacing whole. Keys the manifest does not
    /// declare pass through (and inherit), so a setting written ahead of an
    /// upgrade is not lost.
    pub fn extension_settings(&self, key: &str, manifest_defaults: &toml::Table, specs: &serde_json::Value) -> toml::Table {
        let name = instance::name_of(key);
        let base = if name == key { None } else { self.extensions.get(name).map(|t| inheritable(t, specs)) };
        overlay(&overlay(manifest_defaults, base.as_ref()), self.extensions.get(key))
    }

    /// The same for one palette's declared settings, over
    /// `[palettes.<id>].settings` with `id` from `instance::palette_id`; a
    /// non-default instance's palette inherits the default's
    /// (`[palettes.gmail-inbox]` under `[palettes."gmail@work-inbox"]`), the
    /// same secrets and `scope: "instance"` ids skipped. The pal-provided
    /// keys (`enabled`, `alias`, `hotkey`, `hold`, `icon`, `tier`) never inherit.
    pub fn palette_settings(&self, key: &str, palette: &str, manifest_defaults: &toml::Table, specs: &serde_json::Value) -> toml::Table {
        let name = instance::name_of(key);
        let base = if name == key { None } else { self.palettes.get(&instance::palette_id(name, palette)).map(|p| inheritable(&p.settings, specs)) };
        overlay(&overlay(manifest_defaults, base.as_ref()), self.palettes.get(&instance::palette_id(key, palette)).map(|p| &p.settings))
    }

    /// [`extension_settings`](Self::extension_settings) from the manifest's
    /// `settings` list itself, with every `kind: "secret"` value that is a
    /// `keychain:` / `env:` reference resolved through `store`. A reference
    /// that does not resolve stays as written and is logged, so a missing
    /// secret never keeps the extension from loading; values of any other
    /// kind are passed through untouched, reference-shaped or not. Resolved
    /// on the instance's final table, so `keychain:pal/gmail@work-token` is
    /// looked up per instance.
    pub fn extension_settings_resolved(&self, key: &str, specs: &serde_json::Value, store: &dyn secrets::SecretStore) -> toml::Table {
        let mut t = self.extension_settings(key, &spec_defaults(specs), specs);
        secrets::resolve_declared(&mut t, specs, store);
        t
    }

    /// The same for one palette's declared settings.
    pub fn palette_settings_resolved(&self, key: &str, palette: &str, specs: &serde_json::Value, store: &dyn secrets::SecretStore) -> toml::Table {
        let mut t = self.palette_settings(key, palette, &spec_defaults(specs), specs);
        secrets::resolve_declared(&mut t, specs, store);
        t
    }

    /// Unknown keys as diagnostics. The keys stay in the `extra` maps and in
    /// the file; this only makes them visible.
    fn unknown_keys(&self) -> Vec<Diagnostic> {
        let unknown = |prefix: &str, extra: &BTreeMap<String, toml::Value>| {
            extra.keys().map(|k| Diagnostic::warn(format!("{prefix}{k}"), "unknown key")).collect::<Vec<_>>()
        };
        let mut out = unknown("", &self.extra);
        out.extend(unknown("general.", &self.general.extra));
        for (id, p) in &self.palettes {
            out.extend(unknown(&format!("palettes.{id}."), &p.extra));
        }
        out.extend(unknown("bar.", &self.bar.extra));
        out.extend(unknown("bar.menubar.", &self.bar.menubar.extra));
        out.extend(unknown("bar.sketchybar.", &self.bar.sketchybar.extra));
        for (key, i) in &self.bar.items {
            out.extend(unknown(&format!("bar.items.{key}."), &i.extra));
            for (id, r) in &i.rules {
                out.extend(unknown(&format!("bar.items.{key}.rules.{id}."), &r.extra));
            }
        }
        for (key, d) in &self.states {
            out.extend(unknown(&format!("states.{key}."), &d.extra));
        }
        out.extend(unknown("sidebar.", &self.sidebar.extra));
        for (key, i) in &self.instances {
            if !(instance::is_key(key) || instance::valid_name(key)) {
                out.push(Diagnostic::warn(format!("instances.{key}"), "not an instance key: <name>@<suffix>, the suffix lowercase letters, digits, - and _ (not \"default\"), or a bare name for the default instance"));
            }
            out.extend(unknown(&format!("instances.{key}."), &i.extra));
        }
        out
    }
}

/// The defaults a manifest's `settings` list declares (`pal.json`:
/// `[{ "id", "kind", "default", .. }]`, as JSON), as the table
/// [`Config::extension_settings`] overlays. An entry without a default, or
/// whose default is `null`, declares no key.
pub fn spec_defaults(specs: &serde_json::Value) -> toml::Table {
    let mut t = toml::Table::new();
    for spec in specs.as_array().into_iter().flatten() {
        if let (Some(id), Some(d)) = (spec["id"].as_str(), spec.get("default").filter(|d| !d.is_null())) {
            if let Ok(v) = toml::Value::try_from(d) {
                t.insert(id.to_string(), v);
            }
        }
    }
    t
}

/// `defaults` with `set` on top, one level deep: a set key replaces the
/// default whole (a list is not appended to, a table not merged).
fn overlay(defaults: &toml::Table, set: Option<&toml::Table>) -> toml::Table {
    let mut out = defaults.clone();
    if let Some(set) = set {
        out.extend(set.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    out
}

/// `set` without the keys a non-default instance never inherits (`instance::private_ids`).
fn inheritable(set: &toml::Table, specs: &serde_json::Value) -> toml::Table {
    let private = instance::private_ids(specs);
    set.iter().filter(|(k, _)| !private.contains(k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()
}

/// How much a [`Diagnostic`] matters: a warning leaves the config usable
/// as loaded, an error means the file did not load and the config shown is
/// the defaults or the last good one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Warning,
    Error,
}

/// Something worth telling the user about the file, tied to where it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub level: Level,
    /// Dotted key path (`palettes.clipboard.enabld`), empty for whole-file problems.
    pub path: String,
    /// 1-based line, when known.
    pub line: Option<usize>,
    pub message: String,
}

impl Diagnostic {
    /// A warning at `path` (a dotted key, empty for the whole file).
    pub fn warn(path: String, message: impl Into<String>) -> Self {
        Self { level: Level::Warning, path, line: None, message: message.into() }
    }

    fn parse(text: &str, e: toml::de::Error) -> Self {
        // Newlines before the span, not `lines().count()`: that drops the
        // empty last piece, so an error at the start of a line came out one
        // line early.
        let line = e.span().map(|s| text.as_bytes()[..s.start.min(text.len())].iter().filter(|&&b| b == b'\n').count() + 1);
        Self { level: Level::Error, path: String::new(), line, message: e.message().to_string() }
    }

    fn io(e: &std::io::Error) -> Self {
        Self { level: Level::Error, path: String::new(), line: None, message: e.to_string() }
    }
}

/// A load's outcome. `config` is always usable: defaults when the file is
/// missing, the last good config when a watched save does not parse.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Loaded {
    pub path: PathBuf,
    pub config: Config,
    pub diagnostics: Vec<Diagnostic>,
}

impl Loaded {
    /// True when the file did not load and `config` is a stand-in.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.level == Level::Error)
    }
}

/// What an edit or a watch can fail with. Loading never fails: see [`Loaded`].
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    /// The file is not TOML, so there is no text to edit in place.
    #[error("{path}: {source}")]
    Parse { path: PathBuf, source: toml_edit::TomlError },
    /// A dotted key that does not parse (`a..b`, an unclosed quote).
    #[error("bad key {0:?}")]
    Key(String),
    #[error("{0}: not a table, cannot set a key under it")]
    NotATable(String),
    /// Setting a plain value over a `[table]` would drop everything in it.
    #[error("{0}: is a table, unset it first")]
    IsATable(String),
    #[error("{0} changed on disk while editing")]
    Contended(PathBuf),
    #[error("watch: {0}")]
    Watch(#[from] notify::Error),
}

/// Parse config text: defaults layered under the file. `Err` only when the
/// text is not TOML; unknown keys come back as warnings alongside the config.
pub fn parse(text: &str) -> Result<(Config, Vec<Diagnostic>), Diagnostic> {
    let config: Config = toml::from_str(text).map_err(|e| Diagnostic::parse(text, e))?;
    let diags = config.unknown_keys();
    Ok((config, diags))
}

/// Where the schema for the `#:schema` directive is published: the
/// committed copy on `main`, so nothing is written next to the file.
pub const SCHEMA_URL: &str = "https://raw.githubusercontent.com/zcag/pal/main/core/schema/config.schema.json";

/// Header written when an edit creates the file. `#:schema` is taplo's
/// directive (a URL is accepted).
pub const TEMPLATE: &str = "#:schema https://raw.githubusercontent.com/zcag/pal/main/core/schema/config.schema.json\n# pal settings. The settings view writes this file; editing by hand is fine too.\n";

/// The config file: where it is, and everything done to it.
#[derive(Debug, Clone)]
pub struct ConfigFile {
    path: PathBuf,
}

impl ConfigFile {
    /// A config file at `path`; it need not exist yet.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// `$PAL_CONFIG`, else `$XDG_CONFIG_HOME/pal/config.toml`, else
    /// `~/.config/pal/config.toml` (on macOS too, see [`fs::config_dir`]).
    pub fn locate() -> Self {
        match std::env::var_os("PAL_CONFIG").filter(|p| !p.is_empty()) {
            Some(p) => Self::new(p),
            None => Self::new(fs::config_dir().join("config.toml")),
        }
    }

    /// The path as given (a symlink stays a symlink here).
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Which config this is, as a directory name: `default` for the
    /// default location, else the first 8 hex of the sha256 of the
    /// canonical path (a dev instance run under `$PAL_CONFIG=.../dev.toml`). Two
    /// config files must not share an index cache or a frecency file: a
    /// palette enabled in one is not in the other.
    pub fn profile(&self) -> String {
        if self.path == fs::config_dir().join("config.toml") {
            return "default".into();
        }
        use sha2::{Digest, Sha256};
        // A file that does not exist yet keys on its canonical directory, so
        // the key does not move once it is created (`/var` is `/private/var`
        // on macOS).
        let canon = std::fs::canonicalize(&self.path).unwrap_or_else(|_| {
            let dir = self.path.parent().and_then(|d| std::fs::canonicalize(d).ok());
            match (dir, self.path.file_name()) {
                (Some(d), Some(f)) => d.join(f),
                _ => self.path.clone(),
            }
        });
        let hash = Sha256::digest(canon.to_string_lossy().as_bytes());
        hash.iter().take(4).map(|b| format!("{b:02x}")).collect()
    }

    /// `<data dir>/<profile>`: where this config's index cache and frecency
    /// file live (`clipboard.db` stays one level up, it is history, not a
    /// view of one config).
    pub fn data_dir(&self) -> PathBuf {
        fs::data_dir().join(self.profile())
    }

    /// The real file behind any symlink (dotfiles setups), or `path` while
    /// it does not exist yet. Edits and watches work on this one so a write
    /// never replaces a symlink with a plain file.
    pub(crate) fn target(&self) -> PathBuf {
        std::fs::canonicalize(&self.path).unwrap_or_else(|_| self.path.clone())
    }

    /// Read and parse. A missing file is the defaults, not an error; a file
    /// that does not parse is the defaults plus an error diagnostic (the
    /// watcher is what remembers the last good config across that).
    pub fn load(&self) -> Loaded {
        self.loaded(std::fs::read_to_string(self.target()).as_deref())
    }

    /// [`load`](Self::load) over a read already done, so the watcher parses
    /// the same bytes it compared.
    pub(crate) fn loaded(&self, read: Result<&str, &std::io::Error>) -> Loaded {
        let path = self.path.clone();
        let text = match read {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => "",
            Err(e) => return Loaded { path, config: Config::default(), diagnostics: vec![Diagnostic::io(e)] },
        };
        match parse(text) {
            Ok((config, diagnostics)) => Loaded { path, config, diagnostics },
            Err(d) => Loaded { path, config: Config::default(), diagnostics: vec![d] },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_empty() {
        let (c, d) = parse("").unwrap();
        assert_eq!(c, Config::default());
        assert_eq!(c.general.hotkey, "ctrl+space");
        assert_eq!(c.general.theme, Theme::System);
        assert!(d.is_empty());
    }

    #[test]
    fn file_layers_over_defaults_per_field() {
        let (c, d) = parse(
            r#"
[general]
theme = "dark"

[palettes.clipboard]
alias = "cb"
settings.history = 200

[palettes.window-management.item_hotkeys]
left_half = "ctrl+alt+left"
maximize = "ctrl+alt+enter"

[extensions.github]
token = "keychain:pal/github-token"
"#,
        )
        .unwrap();
        assert!(d.is_empty());
        assert_eq!(c.general.hotkey, "ctrl+space", "untouched field keeps its default");
        assert_eq!(c.general.theme, Theme::Dark);
        let cb = &c.palettes["clipboard"];
        assert!(cb.enabled, "default survives next to a set sibling");
        assert_eq!(cb.alias.as_deref(), Some("cb"));
        assert_eq!(cb.settings["history"].as_integer(), Some(200));
        assert!(cb.item_hotkeys.is_empty());
        let wm = &c.palettes["window-management"];
        assert_eq!(wm.item_hotkeys.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect::<Vec<_>>(), [("left_half", "ctrl+alt+left"), ("maximize", "ctrl+alt+enter")]);
        assert!(!toml::to_string(&c).unwrap().contains("item_hotkeys = {}"), "an empty map is not written back");
        assert_eq!(c.extensions["github"]["token"].as_str(), Some("keychain:pal/github-token"));
        assert!(c.palette("nope").enabled);
    }

    #[test]
    fn general_additions_have_defaults() {
        let (c, _) = parse("").unwrap();
        assert!(!c.general.launch_at_login);
        assert!(c.general.menu_bar_icon, "the icon is on until turned off");
        assert!(c.general.check_updates, "the daily check is on until turned off");
        assert_eq!(c.general.position, Position::Top);
        assert!(c.general.extension_dirs.is_empty());
        let (c, d) = parse("[general]\nlaunch_at_login = true\nmenu_bar_icon = false\nposition = \"centre\"\ncheck_updates = false\nextension_dirs = [\"~/dotfiles/pal\", \"/opt/pal-ext\"]\n").unwrap();
        assert!(d.is_empty());
        assert!(c.general.launch_at_login);
        assert!(!c.general.menu_bar_icon);
        assert!(!c.general.check_updates);
        assert_eq!(c.general.position, Position::Centre);
        assert_eq!(c.general.extension_dirs(), [dirs::home_dir().unwrap().join("dotfiles/pal"), PathBuf::from("/opt/pal-ext")], "tilde expanded, order kept");
        assert!(parse("[general]\nposition = \"middle\"\n").is_err(), "an unknown position is a parse error, not a warning");
    }

    #[test]
    fn backspace_back_is_on_until_turned_off() {
        let (c, _) = parse("").unwrap();
        assert!(c.general.backspace_back);
        let (c, d) = parse("[general]\nbackspace_back = false\n").unwrap();
        assert!(d.is_empty());
        assert!(!c.general.backspace_back);
    }

    #[test]
    fn bar_defaults_and_per_item_overrides() {
        let (c, d) = parse("").unwrap();
        assert!(d.is_empty());
        assert_eq!(c.bar.target, BarTarget::Auto);
        assert_eq!((c.bar.hover_delay, c.bar.hover_grace), (250, 400));
        assert!(!c.bar.menubar.open_on_hover, "Apple's bar has no hover convention");
        assert!(!c.bar.sketchybar.open_on_hover, "click to open and close on every target; hover is opt-in");
        assert_eq!(c.bar.sketchybar.position, "right");
        assert!(c.bar.item("github/notifications").enabled);
        assert_eq!(c.bar.item("github/notifications").show, BarShow::Auto, "an item earns its slot unless told otherwise");
        assert_eq!(c.bar.target_of("github/notifications"), BarTarget::Auto);
        assert!(!c.bar.open_on_hover("x/y", BarTarget::Sketchybar));
        assert!(!c.bar.open_on_hover("x/y", BarTarget::Menubar));
        let (c, d) = parse(
            r#"
[bar]
target = "both"
hover_delay = 100

[bar.menubar]
open_on_hover = true

[bar.sketchybar]
position = "before:clock"
colors = { red = "0xffe78284", muted = "0xff737994" }

[bar.items."github/notifications"]
enabled = false
target = "menubar"
position = "after:pal.github.prs"
hotkey = "ctrl+alt+n"
open_on_hover = false
order = 20
show = "always"
"#,
        )
        .unwrap();
        assert!(d.is_empty());
        assert_eq!(c.bar.target, BarTarget::Both);
        assert_eq!((c.bar.hover_delay, c.bar.hover_grace), (100, 400), "an untouched sibling keeps its default");
        assert!(c.bar.menubar.open_on_hover);
        assert_eq!(c.bar.sketchybar.colors["red"], "0xffe78284");
        let n = c.bar.item("github/notifications");
        assert!(!n.enabled);
        assert_eq!(n.hotkey.as_deref(), Some("ctrl+alt+n"));
        assert_eq!(n.order, Some(20));
        assert_eq!(n.show, BarShow::Always);
        assert!(parse("[bar.items.\"a/b\"]\nshow = \"never\"\n").is_err(), "show is auto or always");
        assert_eq!(c.bar.target_of("github/notifications"), BarTarget::Menubar);
        assert!(!c.bar.open_on_hover("github/notifications", BarTarget::Menubar), "the item's say beats the target's");
        assert!(c.bar.open_on_hover("other/item", BarTarget::Menubar), "the target's default for the rest");
        assert_eq!(c.bar.position_of("github/notifications"), "after:pal.github.prs");
        assert_eq!(c.bar.position_of("other/item"), "before:clock");
        assert!(!c.bar.draws("github/notifications"), "disabled");
        assert!(c.bar.draws("other/item"));
        let (c, _) = parse("[bar]\ntarget = \"off\"\n[bar.items.\"a/b\"]\ntarget = \"menubar\"\n[bar.items.\"c/d\"]\ntarget = \"off\"\n").unwrap();
        assert!(!c.bar.draws("x/y"), "off everywhere: nothing renders or polls");
        assert!(c.bar.draws("a/b"), "an item aimed at a target still draws");
        let (c, _) = parse("[bar]\ntarget = \"auto\"\n[bar.items.\"c/d\"]\ntarget = \"off\"\n").unwrap();
        assert!(!c.bar.draws("c/d") && c.bar.draws("x/y"));
        assert!(parse("[bar]\ntarget = \"tray\"\n").is_err(), "an unknown target is a parse error");
        let (_, d) = parse("[bar]\nhover = 1\n[bar.items.\"a/b\"]\nenable = true\n").unwrap();
        assert_eq!(d.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(), ["bar.hover", "bar.items.a/b.enable"]);
    }

    #[test]
    fn sidebar_defaults_and_overrides() {
        let (c, d) = parse("").unwrap();
        assert!(d.is_empty());
        assert_eq!(c.sidebar.palette(), None, "off until a palette is named: a strip at the edge is opt-in");
        assert_eq!((c.sidebar.edge, c.sidebar.display.as_str(), c.sidebar.width, c.sidebar.peek, c.sidebar.hotkey), (Edge::Right, "cursor", 320.0, true, None));
        assert_eq!((c.sidebar.delay, c.sidebar.grace), (0, 150), "a peek is instant and lingers a beat");
        let (c, d) = parse("[sidebar]\npalette = \"apps/apps\"\nedge = \"left\"\ndisplay = \"primary\"\nwidth = 400\npeek = false\nhotkey = \"ctrl+alt+tab\"\n").unwrap();
        assert!(d.is_empty());
        assert_eq!((c.sidebar.palette(), c.sidebar.edge, c.sidebar.display.as_str(), c.sidebar.width, c.sidebar.peek), (Some("apps/apps"), Edge::Left, "primary", 400.0, false));
        assert_eq!(c.sidebar.hotkey.as_deref(), Some("ctrl+alt+tab"));
        let (c, _) = parse("[sidebar]\npalette = \" \"\n").unwrap();
        assert_eq!(c.sidebar.palette(), None, "blank is no sidebar");
        assert!(parse("[sidebar]\nedge = \"top\"\n").is_err(), "left or right");
        let (_, d) = parse("[sidebar]\nside = \"left\"\n").unwrap();
        assert_eq!(d.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(), ["sidebar.side"]);
    }

    #[test]
    fn bar_look_resolves_item_over_target_default() {
        let (c, d) = parse("").unwrap();
        assert!(d.is_empty());
        let l = c.bar.look("x/y", BarTarget::Menubar);
        assert_eq!((l.dim, l.size, l.spacing, l.width, l.max_chars), (50, 0.0, 4, 0, 32));
        assert!(l.show_icon && l.show_title && l.color.is_none());
        assert_eq!((l.urgent_color.as_str(), l.badge_style, l.font), ("destructive", BadgeStyle::Count, BarFont::System));
        assert_eq!((l.opacity, l.icon_size, l.text_size), (100, 0.0, 0.0));
        assert!(l.icon.is_none() && l.badge_color.is_none(), "the badge follows the tint and the icon is the extension's");
        assert_eq!(c.bar.look("x/y", BarTarget::Sketchybar), l, "both targets start from the same look");
        let (c, d) = parse(
            r##"
[bar.menubar]
dim = 35
size = 12
font = "mono"
max_chars = 20
color = "#ff8800"

[bar.sketchybar]
spacing = 6
badge_style = "dot"
urgent_color = "amber"
badge_color = "grey"
opacity = 80
width = 90
show_icon = false

[bar.items."timer/timer"]
size = 11
icon_size = 16
text_size = 9.5
icon = "󰔛"
opacity = 70
color = "blue"
badge_color = "#ff0000"
badge_style = "none"
show_title = false
max_chars = 2
"##,
        )
        .unwrap();
        assert!(d.is_empty(), "{d:?}");
        let m = c.bar.look("x/y", BarTarget::Menubar);
        assert_eq!((m.dim, m.size, m.font, m.max_chars, m.color.as_deref()), (35, 12.0, BarFont::Mono, 20, Some("#ff8800")));
        assert_eq!((m.spacing, m.badge_style, m.urgent_color.as_str(), m.width), (4, BadgeStyle::Count, "destructive", 0), "the other target's keys do not leak");
        let s = c.bar.look("x/y", BarTarget::Sketchybar);
        assert_eq!((s.spacing, s.badge_style, s.urgent_color.as_str(), s.width, s.show_icon), (6, BadgeStyle::Dot, "amber", 90, false));
        assert_eq!((s.dim, s.size, s.font), (50, 0.0, BarFont::System));
        assert_eq!((s.badge_color.as_deref(), s.opacity, m.badge_color.as_deref(), m.opacity), (Some("grey"), 80, None, 100));
        let t = c.bar.look("timer/timer", BarTarget::Menubar);
        assert_eq!((t.size, t.color.as_deref(), t.badge_style, t.show_title), (11.0, Some("blue"), BadgeStyle::None, false), "the item's keys win");
        assert_eq!((t.icon_size, t.text_size, t.icon.as_deref(), t.opacity, t.badge_color.as_deref()), (16.0, 9.5, Some("󰔛"), 70, Some("#ff0000")));
        assert_eq!((t.dim, t.font), (35, BarFont::Mono), "the rest come from the target");
        assert_eq!(t.max_chars, 4, "a floor under max_chars");
        let ts = c.bar.look("timer/timer", BarTarget::Sketchybar);
        assert_eq!((ts.size, ts.spacing, ts.badge_style), (11.0, 6, BadgeStyle::None), "the same overrides over sketchybar's defaults");
        assert_eq!(ts.badge_color.as_deref(), Some("#ff0000"), "the item's badge colour over the target's");
        assert!(c.bar.look("x/y", BarTarget::Auto) == m && c.bar.look("x/y", BarTarget::Both) == m, "auto and both read the menu bar's");
        let (c, _) = parse("[bar.menubar]\ndim = 300\nopacity = 150\n[bar.items.\"a/b\"]\nsize = -3\nicon_size = -1\nicon = \" \"\nbadge_color = \"\"\n").unwrap();
        let l = c.bar.look("a/b", BarTarget::Menubar);
        assert_eq!((l.dim, l.opacity, l.size, l.icon_size), (100, 100, 0.0, 0.0), "clamped");
        assert!(l.icon.is_none() && l.badge_color.is_none(), "blank is unset");
        assert!(parse("[bar.menubar]\nbadge_style = \"pill\"\n").is_err(), "an unknown badge style is a parse error");
        assert!(parse("[bar.items.\"a/b\"]\nfont = \"serif\"\n").is_err());
        let (_, d) = parse("[bar.menubar]\nsizes = 1\n[bar.items.\"a/b\"]\ncolour = \"red\"\n").unwrap();
        assert_eq!(d.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(), ["bar.menubar.sizes", "bar.items.a/b.colour"], "unknown keys still land in the diagnostics through the flatten");
    }

    #[test]
    fn extension_settings_overlay_manifest_defaults() {
        let defaults: toml::Table = toml::from_str("max_entries = 200\nexclude_apps = [\"1Password\"]\nprimary_action = \"paste\"\n").unwrap();
        let (c, _) = parse("[extensions.clipboard]\nmax_entries = 500\nexclude_apps = []\nundeclared = 1\n\n[palettes.emoji.settings]\nskin = \"medium\"\n").unwrap();
        let s = c.extension_settings("clipboard", &defaults, &serde_json::Value::Null);
        assert_eq!(s["max_entries"].as_integer(), Some(500));
        assert_eq!(s["exclude_apps"].as_array().map(Vec::len), Some(0), "a set list replaces the default, no append");
        assert_eq!(s["primary_action"].as_str(), Some("paste"), "untouched key keeps its default");
        assert_eq!(s["undeclared"].as_integer(), Some(1), "undeclared keys pass through");
        assert_eq!(c.extension_settings("nope", &defaults, &serde_json::Value::Null), defaults, "no file entry: the defaults as given");
        let pd: toml::Table = toml::from_str("skin = \"none\"\ncolumns = 8\n").unwrap();
        let p = c.palette_settings("emoji", "emoji", &pd, &serde_json::Value::Null);
        assert_eq!(p["skin"].as_str(), Some("medium"));
        assert_eq!(p["columns"].as_integer(), Some(8));
        assert_eq!(c.palette_settings("apps", "apps", &pd, &serde_json::Value::Null), pd);
    }

    #[test]
    fn confirm_trusts_by_name_or_key() {
        let except = Confirm::Except(vec!["gmail".into(), " github@work ".into()]);
        assert!(!except.asks(Some("gmail")), "the name itself");
        assert!(!except.asks(Some("gmail@work")), "a name covers every instance");
        assert!(!except.asks(Some("github@work")), "a key, trimmed, covers that instance");
        assert!(except.asks(Some("github")), "not the default of a key");
        assert!(except.asks(Some("github@home")), "nor another instance");
        assert!(except.asks(None), "an app-level route is never in the list");
        assert!(!Confirm::All(false).asks(Some("gmail@work")));
        assert!(Confirm::All(true).asks(None));
    }

    #[test]
    fn instance_keys_default_first_and_disabled_skipped() {
        let (c, d) = parse(
            r#"
[instances."gmail@work"]
title = "Work"
tint = "amber"
badge = "W"

[instances."gmail@old"]
enabled = false

[instances.gmail]
title = "Personal"

[instances."gmail@home"]

[instances."other@x"]
"#,
        )
        .unwrap();
        assert!(d.is_empty());
        assert_eq!(c.instance_keys("gmail", true), ["gmail", "gmail@home", "gmail@work"], "the default first, then key order, the disabled one skipped");
        assert_eq!(c.instance_keys("gmail", false), ["gmail"], "not multi: the bare name alone, whatever the file says");
        assert_eq!(c.instance_keys("other", true), ["other", "other@x"]);
        assert_eq!(c.instance_keys("none", true), ["none"], "no tables at all: the default");
        let all = c.instances_of("gmail");
        assert_eq!(all.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["gmail", "gmail@home", "gmail@old", "gmail@work"], "instances_of lists the parked one too");
        assert_eq!(all[0].1.title.as_deref(), Some("Personal"));
        let work = &all[3].1;
        assert_eq!((work.title.as_deref(), work.tint.as_deref(), work.badge.as_deref(), work.enabled), (Some("Work"), Some("amber"), Some("W"), true));
        let home = &all[1].1;
        assert_eq!(**home, Instance::default(), "an empty table is an instance with every default");
        assert!(!all[2].1.enabled);
        let (c, _) = parse("[instances.gmail]
enabled = false
").unwrap();
        assert_eq!(c.instance_keys("gmail", true), Vec::<String>::new(), "the default parks too");
        assert_eq!(c.instance_keys("gmail", false), Vec::<String>::new());
    }

    #[test]
    fn inheritance_skips_secrets_and_instance_scope() {
        let specs = serde_json::json!([
            { "kind": "secret", "id": "token", "default": "" },
            { "kind": "text", "id": "url", "scope": "instance", "default": "" },
            { "kind": "text", "id": "org", "default": "" },
            { "kind": "number", "id": "days", "default": 7 },
        ]);
        let (c, _) = parse(
            r#"
[extensions.github]
token = "keychain:pal/github-token"
url = "https://a"
org = "acme"
days = 30
undeclared = "yes"

[extensions."github@work"]
days = 3

[palettes.github-prs.settings]
columns = 2
key = "keychain:x"

[palettes."github@work-prs".settings]
limit = 5
"#,
        )
        .unwrap();
        let d = spec_defaults(&specs);
        let base = c.extension_settings("github", &d, &specs);
        assert_eq!(base["token"].as_str(), Some("keychain:pal/github-token"), "the default instance is unaffected");
        assert_eq!(base["days"].as_integer(), Some(30));
        let work = c.extension_settings("github@work", &d, &specs);
        assert_eq!(work["org"].as_str(), Some("acme"), "a plain setting inherits");
        assert_eq!(work["undeclared"].as_str(), Some("yes"), "an undeclared key inherits too");
        assert_eq!(work["days"].as_integer(), Some(3), "its own table wins");
        assert_eq!(work["token"].as_str(), Some(""), "a secret falls to the manifest default, never the default instance's");
        assert_eq!(work["url"].as_str(), Some(""), "scope: instance likewise");
        assert_eq!(c.extension_settings("github@home", &d, &specs)["days"].as_integer(), Some(30), "no table of its own: the inherited layer stands");
        let pspecs = serde_json::json!([{ "kind": "secret", "id": "key" }, { "kind": "number", "id": "columns", "default": 1 }]);
        let pd = spec_defaults(&pspecs);
        let p = c.palette_settings("github@work", "prs", &pd, &pspecs);
        assert_eq!(p["columns"].as_integer(), Some(2), "a palette's declared setting inherits from the default instance's palette");
        assert_eq!(p["limit"].as_integer(), Some(5));
        assert!(!p.contains_key("key"), "a palette secret does not");
        assert_eq!(c.palette_settings("github", "prs", &pd, &pspecs)["key"].as_str(), Some("keychain:x"));
        // Resolution runs on the final table, so the reference is the instance's own.
        use secrets::MemStore;
        let store = MemStore::from(std::collections::HashMap::from([("pal/github@work-token".to_string(), "ghp_w".to_string()), ("pal/github-token".to_string(), "ghp_p".to_string())]));
        let (c, _) = parse("[extensions.github]
token = \"keychain:pal/github-token\"\n[extensions.\"github@work\"]\ntoken = \"keychain:pal/github@work-token\"\n").unwrap();
        assert_eq!(c.extension_settings_resolved("github@work", &specs, &store)["token"].as_str(), Some("ghp_w"));
        assert_eq!(c.extension_settings_resolved("github", &specs, &store)["token"].as_str(), Some("ghp_p"));
    }

    #[test]
    fn unknown_keys_under_instances() {
        let (c, d) = parse("[instances.\"gmail@work\"]\ntitel = \"x\"\n\n[instances.\"bad@@key\"]\n\n[instances.\"gmail@default\"]\n\n[instances.gmail]\ntitle = \"Personal\"\n").unwrap();
        let paths: Vec<_> = d.iter().map(|d| (d.path.as_str(), d.message.as_str())).collect();
        assert_eq!(paths.len(), 3, "{paths:?}");
        assert!(paths[0].0 == "instances.bad@@key" && paths[0].1.starts_with("not an instance key"));
        assert_eq!(paths[1], ("instances.gmail@default", paths[1].1), "default is not a suffix");
        assert_eq!(paths[2], ("instances.gmail@work.titel", "unknown key"));
        assert_eq!(c.instances["gmail@work"].extra["titel"].as_str(), Some("x"), "kept");
        assert_eq!(c.instance_keys("gmail", true), ["gmail", "gmail@work"], "a malformed key is never loaded");
    }

    #[test]
    fn spec_defaults_take_id_and_default() {
        let specs = serde_json::json!([
            { "kind": "number", "id": "n", "default": 3, "min": 1 },
            { "kind": "list", "id": "l", "default": ["a"] },
            { "kind": "secret", "id": "token" },
            { "kind": "text", "id": "t", "default": null },
        ]);
        let d = spec_defaults(&specs);
        assert_eq!(d["n"].as_integer(), Some(3));
        assert_eq!(d["l"].as_array().map(Vec::len), Some(1));
        assert!(!d.contains_key("token") && !d.contains_key("t"), "no default, no key");
        assert!(spec_defaults(&serde_json::Value::Null).is_empty());
    }

    #[test]
    fn resolved_settings_fetch_declared_secrets_only() {
        use secrets::MemStore;
        let store = MemStore::from(std::collections::HashMap::from([("pal/github-token".to_string(), "ghp_x".to_string())]));
        let specs = serde_json::json!([
            { "kind": "secret", "id": "token" },
            { "kind": "secret", "id": "other" },
            { "kind": "text", "id": "note", "default": "keychain:pal/github-token" },
            { "kind": "text", "id": "url", "default": "https://x" },
        ]);
        let (c, _) = parse("[extensions.github]\ntoken = \"keychain:pal/github-token\"\nother = \"keychain:pal/missing\"\nundeclared = \"keychain:pal/github-token\"\n\n[palettes.github.settings]\ntoken = \"keychain:pal/github-token\"\n").unwrap();
        let s = c.extension_settings_resolved("github", &specs, &store);
        assert_eq!(s["token"].as_str(), Some("ghp_x"), "a declared secret is fetched");
        assert_eq!(s["other"].as_str(), Some("keychain:pal/missing"), "a miss keeps the reference");
        assert_eq!(s["note"].as_str(), Some("keychain:pal/github-token"), "only kind: secret is resolved");
        assert_eq!(s["undeclared"].as_str(), Some("keychain:pal/github-token"), "an undeclared key is never resolved");
        assert_eq!(s["url"].as_str(), Some("https://x"));
        assert_eq!(c.extension_settings_resolved("github", &serde_json::Value::Null, &store)["token"].as_str(), Some("keychain:pal/github-token"), "no specs, no resolution");
        assert_eq!(c.palette_settings_resolved("github", "github", &specs, &store)["token"].as_str(), Some("ghp_x"));
        std::env::set_var("PAL_TEST_RESOLVED", "from-env");
        let (c, _) = parse("[extensions.github]\ntoken = \"env:PAL_TEST_RESOLVED\"\n").unwrap();
        assert_eq!(c.extension_settings_resolved("github", &specs, &store)["token"].as_str(), Some("from-env"));
    }

    #[test]
    fn unknown_keys_are_kept_and_reported() {
        let (c, d) = parse(
            r#"
[general]
hotkey = "alt+space"
hotkeys = "typo"

[palette]
old = true

[palettes.x]
enabld = false
"#,
        )
        .unwrap();
        let paths: Vec<_> = d.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, ["palette", "general.hotkeys", "palettes.x.enabld"]);
        assert!(d.iter().all(|d| d.level == Level::Warning && d.message == "unknown key"));
        assert_eq!(c.general.hotkey, "alt+space");
        assert_eq!(c.general.extra["hotkeys"].as_str(), Some("typo"));
        assert!(c.palettes["x"].enabled, "typo'd key does not reach the real one");
        assert_eq!(c.extra["palette"]["old"].as_bool(), Some(true));
    }

    #[test]
    fn root_hotkey_is_a_string_or_a_list() {
        let (c, _) = parse("[general]\nhotkey = \"alt+space\"\n").unwrap();
        assert_eq!(c.general.hotkey, Hotkeys::One("alt+space".into()));
        assert_eq!(c.general.hotkey, "alt+space");
        assert_eq!(c.general.hotkey.list(), ["alt+space"]);
        assert!(toml::to_string(&c).unwrap().contains("hotkey = \"alt+space\"\n"), "a string is written back as a string");
        let (c, d) = parse("[general]\nhotkey = [\"cmd+space\", \" ctrl+space \", \"\"]\n").unwrap();
        assert!(d.is_empty());
        assert_eq!(c.general.hotkey, Hotkeys::from(["cmd+space", " ctrl+space ", ""]));
        assert_eq!(c.general.hotkey.list(), ["cmd+space", "ctrl+space"], "trimmed, blanks dropped");
        assert_eq!(c.general.hotkey.first(), Some("cmd+space"));
        assert!(toml::to_string(&c).unwrap().contains("hotkey = [\"cmd+space\", \" ctrl+space \", \"\"]\n"), "a list is written back as a list, verbatim");
        for off in ["\"\"", "[]", "[\"\", \" \"]"] {
            let (c, _) = parse(&format!("[general]\nhotkey = {off}\n")).unwrap();
            assert!(c.general.hotkey.is_empty(), "{off} is off");
            assert_eq!(c.general.hotkey.first(), None);
        }
        assert_eq!(Hotkeys::from(["ctrl+space"]), "ctrl+space", "a one-entry list is that key");
        assert!(Hotkeys::from(["a", "b"]) != "a");
        assert!(parse("[general]\nhotkey = 3\n").is_err(), "a number is neither spelling");
        assert!(parse("[general]\nhotkey = [1]\n").is_err());
    }

    #[test]
    fn parse_error_has_line() {
        let d = parse("[general]\ntheme = \"dark\"\nhotkey = \n").unwrap_err();
        assert_eq!(d.level, Level::Error);
        assert_eq!(d.line, Some(3));
        assert!(d.path.is_empty());
    }

    #[test]
    fn bad_enum_is_an_error() {
        let d = parse("[general]\ntheme = \"blue\"\n").unwrap_err();
        assert_eq!(d.line, Some(2));
        assert!(d.message.contains("blue"), "{}", d.message);
    }

    #[test]
    fn error_at_line_start_gets_its_own_line() {
        assert_eq!(parse("x = 1\n]\n").unwrap_err().line, Some(2));
        assert_eq!(parse("x = 1\n\n\n= 2\n").unwrap_err().line, Some(4));
        assert_eq!(parse("= 2").unwrap_err().line, Some(1));
    }

    #[test]
    fn unreadable_file_is_an_error_diagnostic() {
        let dir = tempfile::tempdir().unwrap();
        let l = ConfigFile::new(dir.path()).load();
        assert!(l.has_errors(), "a directory does not read as a file");
        assert_eq!(l.config, Config::default());
    }

    #[test]
    fn load_missing_is_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let l = ConfigFile::new(dir.path().join("config.toml")).load();
        assert_eq!(l.config, Config::default());
        assert!(l.diagnostics.is_empty());
    }

    /// Env is process-global: the test that flips it and the one that
    /// reads `config_dir` twice in one call take turns.
    static ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn template_points_at_the_published_schema() {
        assert_eq!(TEMPLATE.lines().next(), Some(format!("#:schema {SCHEMA_URL}").as_str()));
    }

    #[test]
    fn locate_honours_env() {
        let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("PAL_CONFIG", "/x/pal.toml");
        assert_eq!(ConfigFile::locate().path(), Path::new("/x/pal.toml"));
        std::env::remove_var("PAL_CONFIG");
        std::env::set_var("XDG_CONFIG_HOME", "/xdg");
        assert_eq!(ConfigFile::locate().path(), Path::new("/xdg/pal/config.toml"));
        std::env::remove_var("XDG_CONFIG_HOME");
        assert!(ConfigFile::locate().path().ends_with(".config/pal/config.toml"), "dotfile location on every platform");
    }

    #[test]
    fn profile_keys_on_the_path() {
        let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(ConfigFile::new(fs::config_dir().join("config.toml")).profile(), "default");
        let dir = tempfile::tempdir().unwrap();
        let a = ConfigFile::new(dir.path().join("pali.toml"));
        let b = ConfigFile::new(dir.path().join("other.toml"));
        let pa = a.profile();
        assert_eq!(pa.len(), 8);
        assert!(pa.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(pa, b.profile());
        assert_eq!(a.data_dir(), fs::data_dir().join(&pa));
        std::fs::write(a.path(), "").unwrap();
        assert_eq!(pa, a.profile(), "the same key once the file exists");
        // A symlink to the file keys as the file it points at.
        let link = dir.path().join("link.toml");
        std::os::unix::fs::symlink(a.path(), &link).unwrap();
        assert_eq!(ConfigFile::new(&link).profile(), pa);
    }
}
