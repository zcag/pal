//! Bar items (`docs/design/bar.md`): extensions put glanceable state on
//! the bar. One model (`BarItem`), one `render` per item answered by the
//! host, drawn by two targets here, the macOS menu bar (`menubar`) and
//! sketchybar (`sketchybar`); rich content is the popover (`popover`),
//! the same on both. This module is the registry: every declared item
//! keyed `extension/id`, its last rendered state, the refresh timer, the
//! push coalescing, the diff that keeps a target untouched when nothing
//! changed, and the feed file the CLI reads (`pal bar list|json`).
//!
//! Render loop: an item is rendered when its extension loads, on its
//! poll (`refresh.every` from the manifest, or the item's own `refresh`
//! for the next one only, never under [`MIN_EVERY`]), on the triggers it
//! asked for (`show` when the panel or its popover shows, `wake`, `focus`,
//! `minute`), on a `bar.refresh` push, on `pal bar render`. A render is
//! one host request under [`RENDER_TIMEOUT`]; a failure keeps the last
//! item and marks it stale. A trigger during a render marks it due again.
//! A `bar.update` push replaces the item after [`PUSH_DEBOUNCE`] (the last
//! of a burst wins) and restarts the poll.
//!
//! `hidden: true` takes no space on any target and its timer keeps
//! running. `enabled = false` in `[bar.items.<key>]` removes the item and
//! its timer; the config is re-applied live (`apply_config`). A
//! `show_when`/`hide_when` there does the same by a state expression
//! (states.rs): while it holds the item off, no render runs; the flip
//! back renders once with reason `state`, as `on_states_changed` does for
//! an item that asked for `state:<name>` in `refresh.on`.
//!
//! Linux: no target yet ([`SUPPORTED`] is false). The registry still takes
//! every declared item (`pal bar list` and the Settings window see them)
//! and `[bar]` in the config is read as on macOS, but nothing renders, no
//! timer runs, no popover window is built, and `install` says so once.

pub mod colors;
pub mod glyph;
pub mod menubar;
pub mod popover;
pub mod sketchybar;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pal_core::config::{BadgeStyle, BarLook, BarLookOverride, BarShow, BarTarget, Config};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::{effects, lock, settings};

/// A render slower than this keeps the last item, marked stale.
pub const RENDER_TIMEOUT: Duration = Duration::from_secs(5);
/// Pushes within this window collapse into the last one.
pub const PUSH_DEBOUNCE: Duration = Duration::from_millis(100);
/// The poll floor, seconds: a push has none, a poll never runs faster.
pub const MIN_EVERY: f64 = 10.0;
/// Whether this platform draws bar items at all (macOS: the menu bar and
/// sketchybar). Off it the registry runs, nothing else does.
pub const SUPPORTED: bool = cfg!(target_os = "macos");

// ---- model ---------------------------------------------------------------

/// `BarSegment` in sdk/src/protocol.ts.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Segment {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
}

/// `BarItem.badge`: a count, or a dot.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Badge {
    Count(u64),
    Dot(DotTag),
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DotTag {
    Dot,
}

/// `BarItem.click`: an item's click uses `onOpen` even when it also has a
/// popover menu. A hover still peeks the menu.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Click {
    Open,
}

/// `BarItem.scroll`: actions emitted by sketchybar's wheel event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scroll {
    pub up: String,
    pub down: String,
}

/// `BarItem.empty`: what a hidden item draws when `[bar.items] show =
/// "always"` keeps it ([`BarItem::kept`]): the glyph, a title, the honest
/// tooltip and the popover. The extension offers it; the core decides.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Empty {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub menu: Option<Value>,
}

/// `BarItem` in sdk/src/protocol.ts: the item's whole state as `render`
/// answered it. `menu` stays opaque here (nodes, `{ palette }` or
/// `{ view }`): the popover page draws it.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct BarItem {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub empty: Option<Empty>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub segments: Vec<Segment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub badge: Option<Badge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub urgent: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stale: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll: Option<Scroll>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click: Option<Click>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub menu: Option<Value>,
    /// The facts the item knows, published as `<extension>/<name>` with the
    /// render (docs/design/states.md): what its rules and anyone's
    /// expressions read. Not drawn.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub states: BTreeMap<String, Value>,
}

/// What an `icon` value is, for the renderers.
#[derive(Debug, Clone, PartialEq)]
pub enum IconKind {
    /// One code point the bundled Nerd Font draws.
    Glyph(char),
    /// Anything else textual: an emoji, a letter; drawn as text.
    Text(String),
    /// `{ image }` or `{ app }`, decoded by `glyph::image`.
    Image { value: Value, template: bool },
}

impl BarItem {
    pub fn icon_kind(&self) -> Option<IconKind> {
        icon_kind(self.icon.as_ref()?)
    }

    /// Whether the item is drawn dim: stale, or coloured `muted` by the
    /// extension (a paused timer); never while urgent.
    pub fn muted(&self) -> bool {
        !self.urgent && (self.stale || self.color.as_deref() == Some("muted"))
    }

    /// The item as `[bar.items] show` keeps it: hidden with an `empty`
    /// shape under `always` is that shape on the strip, muted, no badge or
    /// segments, its menu the popover, in the hidden item's own frame (its
    /// per-render `icon_size`, `label_size`, `icon_width`, `position` and
    /// `refresh` stay, so the kept glyph sits where and as large as the
    /// item's other renders); anything else is itself (hidden without a
    /// shape hides either way). Read at draw time, not at render, so a
    /// config flip needs no re-render.
    pub fn kept(self, show: BarShow) -> BarItem {
        match (self.hidden, show, self.empty) {
            (true, BarShow::Always, Some(e)) => BarItem {
                icon: e.icon,
                title: e.title,
                tooltip: e.tooltip,
                menu: e.menu,
                color: Some("muted".into()),
                icon_size: self.icon_size,
                label_size: self.label_size,
                icon_width: self.icon_width,
                position: self.position,
                refresh: self.refresh,
                ..Default::default()
            },
            (_, _, empty) => BarItem { empty, ..self },
        }
    }

    /// The instance's label on the tooltips ("No unread mail (Work)"),
    /// the `empty` one too; a label already there is not stacked.
    fn label(&mut self, label: Option<&str>) {
        let relabel = |t: Option<&str>| labelled(t.and_then(|t| strip_label(t, label)), label);
        self.tooltip = relabel(self.tooltip.as_deref());
        if let Some(e) = self.empty.as_mut() {
            e.tooltip = relabel(e.tooltip.as_deref());
        }
    }

    /// The item with `look` applied: the look's own `icon` in place of the
    /// extension's, the icon and the text dropped where `show_icon` /
    /// `show_title` say so, the badge in `badge_style`, the tint over the
    /// extension's colour (`muted` stays: it is a state, not a colour), and
    /// hidden when nothing is left to draw.
    pub fn shaped(mut self, look: &BarLook) -> BarItem {
        if let Some(icon) = &look.icon {
            self.icon = Some(look_icon(icon));
        }
        if !look.show_icon {
            self.icon = None;
        }
        if !look.show_title {
            self.title = None;
            self.segments.clear();
        }
        self.badge = match (look.badge_style, self.badge) {
            (BadgeStyle::None, _) => None,
            (BadgeStyle::Dot, Some(Badge::Count(_))) => Some(Badge::Dot(DotTag::Dot)),
            (_, b) => b,
        };
        if let Some(c) = &look.color {
            if self.color.as_deref() != Some("muted") {
                self.color = Some(c.clone());
            }
        }
        if self.icon.is_none() && self.title.as_deref().is_none_or(str::is_empty) && self.segments.is_empty() && self.badge.is_none() {
            self.hidden = true;
        }
        self
    }

    /// The badge count, when the badge is one.
    pub fn count(&self) -> Option<u64> {
        match self.badge {
            Some(Badge::Count(n)) => Some(n),
            _ => None,
        }
    }

    pub fn dot(&self) -> bool {
        matches!(self.badge, Some(Badge::Dot(_)))
    }

    /// Whether a click or a hover has a popover to open.
    pub fn has_menu(&self) -> bool {
        self.menu.as_ref().is_some_and(|m| !m.is_null())
    }

    /// Whether a click/hotkey runs the extension's open action rather than
    /// opening this item's menu. The menu remains available to a hover peek.
    pub fn opens_directly(&self) -> bool {
        self.click == Some(Click::Open)
    }
}

/// A `[bar.items] icon` as the item carries it: a picture when it names
/// one (an absolute or `~/` path to an image file, a `data:image/` URI, an
/// `icon://` url), else the glyph, emoji or text it is.
pub fn look_icon(s: &str) -> Value {
    let s = s.trim();
    if s.starts_with('/') || s.starts_with("~/") {
        json!({ "image": pal_core::fs::expand_home(s).to_string_lossy() })
    } else if s.starts_with("data:image/") || s.starts_with("icon://") {
        json!({ "image": s })
    } else {
        Value::String(s.to_string())
    }
}

pub fn icon_kind(v: &Value) -> Option<IconKind> {
    if let Some(s) = v.as_str() {
        let s = s.trim();
        let mut chars = s.chars();
        return match (chars.next(), chars.next()) {
            (None, _) => None,
            (Some(c), None) if glyph::has_glyph(c) => Some(IconKind::Glyph(c)),
            _ => Some(IconKind::Text(s.to_string())),
        };
    }
    if v.get("image").is_some() || v.get("app").is_some() {
        return Some(IconKind::Image { value: v.clone(), template: v.get("template").and_then(Value::as_bool).unwrap_or(false) });
    }
    None
}

/// `BarRefresh` in sdk/src/protocol.ts.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Refresh {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub on: Vec<String>,
}

/// `BarMeta` in host/src/host.ts: `ManifestBar` (sdk/src/protocol.ts)
/// with the id it was declared under and whether the code has a
/// `BarSource` for it (`source: false` is declared with no `render`:
/// never rendered, an error row in Settings).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestBar {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default = "yes")]
    pub source: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<Refresh>,
    /// Named, static states for the Settings preview only. The registry
    /// never renders these to a real bar.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub mocks: BTreeMap<String, ManifestBarMock>,
    /// The extension's presentation rules, in order (`docs/design/states.md`,
    /// "Rules"): each `{ id, when, hidden?, urgent?, ...look }`; the file
    /// overrides one by id (`Bar::rules_of`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<ManifestBarRule>,
}

/// One `ManifestBar.rules[]` entry: a `BarRule` with its id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestBarRule {
    pub id: String,
    #[serde(flatten)]
    pub rule: pal_core::config::BarRule,
}

/// One `ManifestBar.mocks.<id>` entry. `item` is the same complete state an
/// extension's render returns, but exists only for Settings to preview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestBarMock {
    pub title: String,
    pub item: BarItem,
}

fn yes() -> bool {
    true
}

impl Default for ManifestBar {
    fn default() -> Self {
        Self { id: String::new(), title: String::new(), source: true, description: None, refresh: None, mocks: BTreeMap::new(), rules: Vec::new() }
    }
}

impl ManifestBar {
    fn wants(&self, trigger: &str) -> bool {
        self.refresh.as_ref().is_some_and(|r| r.on.iter().any(|t| t == trigger))
    }
}

/// `extension/loaded` carries `bar` as a list of entries (with `id`) or a
/// map keyed by id; both read.
pub fn manifest_bars(v: &Value) -> Vec<ManifestBar> {
    match v {
        Value::Array(a) => a.iter().filter_map(|e| serde_json::from_value::<ManifestBar>(e.clone()).ok()).filter(|m| !m.id.is_empty()).collect(),
        Value::Object(o) => o
            .iter()
            .filter_map(|(id, e)| {
                let mut m: ManifestBar = serde_json::from_value(e.clone()).ok()?;
                m.id = id.clone();
                Some(m)
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Seconds until the next poll of an item whose manifest says `every` and
/// whose last render asked for `refresh` (this once): the item's ask, else
/// the manifest's, never under [`MIN_EVERY`]; `None` when neither asks.
pub fn next_poll(manifest_every: Option<f64>, item_refresh: Option<f64>) -> Option<Duration> {
    let secs = item_refresh.or(manifest_every)?;
    if !secs.is_finite() || secs <= 0.0 {
        return None;
    }
    Some(Duration::from_secs_f64(secs.max(MIN_EVERY)))
}

/// `extension/id` from the two names; the key every table here uses.
pub fn key_of(ext: &str, id: &str) -> String {
    format!("{ext}/{id}")
}

/// The two names back from a key.
pub fn split_key(key: &str) -> Option<(&str, &str)> {
    key.split_once('/').filter(|(e, i)| !e.is_empty() && !i.is_empty() && !i.contains('/'))
}

/// A rectangle in logical screen points, top-left origin: the anchor a
/// target reports for an item.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    /// `x,y,w,h`, the CLI's spelling.
    pub fn parse(s: &str) -> Option<Rect> {
        let v: Vec<f64> = s.split(',').map(|p| p.trim().parse().ok()).collect::<Option<_>>()?;
        match v[..] {
            [x, y, w, h] => Some(Rect { x, y, w, h }),
            _ => None,
        }
    }
}

// ---- registry ------------------------------------------------------------

/// Which renderer draws an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Menubar,
    Sketchybar,
}

/// The renderers behind [`Kind`]: draw the strip, report the anchor, build
/// no menus (events reach `popover` through `on_click` / `on_hover`).
pub trait Target {
    /// Draw `draw` for `key`, or remove the item when `None` (the item is
    /// not on this target). A hidden item is the target's to hide.
    fn apply(&self, app: &AppHandle, key: &str, draw: Option<&Draw>);
    fn remove(&self, app: &AppHandle, key: &str);
    /// Everything pal put on the target, on quit and `enabled = false`.
    fn remove_all(&self, app: &AppHandle);
    fn anchor(&self, app: &AppHandle, key: &str) -> Option<Rect>;
}

/// What a target draws: the item as the look shaped it
/// ([`BarItem::shaped`]), and the config that places and styles it.
#[derive(Debug, Clone, PartialEq)]
pub struct Draw {
    pub item: BarItem,
    pub order: i64,
    pub position: String,
    /// A hover peeks (the target's `open_on_hover`, per item overridable).
    pub hover: bool,
    /// The target's appearance with the item's overrides (`Bar::look`).
    pub look: BarLook,
}

impl Draw {
    /// A dynamic glyph size wins over the item's configured appearance:
    /// the look's `icon_size`, else its `size`.
    pub fn icon_size(&self) -> f64 {
        self.item.icon_size.unwrap_or(if self.look.icon_size > 0.0 { self.look.icon_size } else { self.look.size })
    }

    /// A dynamic label size wins over the item's configured appearance:
    /// the look's `text_size`, else its `size`.
    pub fn label_size(&self) -> f64 {
        self.item.label_size.unwrap_or(if self.look.text_size > 0.0 { self.look.text_size } else { self.look.size })
    }

    /// The colour spec the item is drawn in: `urgent_color` when urgent,
    /// `muted` when [`BarItem::muted`], else the item's own (the look's
    /// tint already applied); `None` is the bar's text colour.
    pub fn tint(&self) -> Option<&str> {
        if self.item.urgent {
            Some(&self.look.urgent_color)
        } else if self.item.muted() {
            Some("muted")
        } else {
            self.item.color.as_deref()
        }
    }

    /// The colour spec of the count badge and the dot: the look's
    /// `badge_color`, else the item's [`tint`](Self::tint); a stale item's
    /// is muted like the rest of it.
    pub fn badge_tint(&self) -> Option<&str> {
        if self.item.stale && !self.item.urgent {
            Some("muted")
        } else {
            self.look.badge_color.as_deref().or_else(|| self.tint())
        }
    }
}

/// One declared item.
#[derive(Debug, Clone)]
pub struct Entry {
    pub manifest: ManifestBar,
    pub last: Option<BarItem>,
    pub rendered_at: Option<Instant>,
    /// Unix seconds of the last successful render, for the feed file.
    pub rendered_unix: Option<u64>,
    /// The last render failed or timed out: the item is drawn muted.
    pub stale: bool,
    pub rendering: bool,
    /// A trigger landed during a render: one more once it is done.
    pub due_again: bool,
    /// Bumped to cancel the sleeping poll task.
    pub timer_gen: u64,
    /// Seeded by `PAL_BAR_FIXTURE`: no host behind it.
    pub fixture: bool,
    /// Off every target by its `show_when`/`hide_when` (states.rs); the
    /// flip back renders rather than re-draws the last item.
    pub held: bool,
    /// The instance's label ("Work") for an item of a `multi` extension's
    /// instance that is not alone (settings.rs `InstanceInfo::label`):
    /// appended to the tooltip and the popover's title. The strip itself is
    /// not marked (docs/design/instances.md, Identity).
    pub instance: Option<String>,
}

/// `<tooltip> (<label>)`, or the label alone when the item has no
/// tooltip; the tooltip as it is without a label.
pub fn labelled(tooltip: Option<&str>, label: Option<&str>) -> Option<String> {
    match (tooltip, label) {
        (t, None) => t.map(str::to_string),
        (Some(t), Some(l)) if !t.is_empty() => Some(format!("{t} ({l})")),
        (_, Some(l)) => Some(l.to_string()),
    }
}

/// The registry, managed state.
#[derive(Default)]
pub struct Bar {
    entries: Mutex<BTreeMap<String, Entry>>,
    pending: Mutex<HashMap<String, (BarItem, u64)>>,
    seq: AtomicU64,
    sketchybar: AtomicBool,
}

impl Bar {
    fn with<T>(app: &AppHandle, f: impl FnOnce(&mut BTreeMap<String, Entry>) -> T) -> T {
        let st = app.state::<Bar>();
        let mut e = lock(&st.entries);
        f(&mut e)
    }
}

/// Whether sketchybar answered its last probe.
pub fn sketchybar_alive(app: &AppHandle) -> bool {
    app.state::<Bar>().sketchybar.load(Ordering::Relaxed)
}

/// The kinds an item with `target` goes to: `auto` is sketchybar when it
/// answers, else the menu bar.
pub fn kinds(target: BarTarget, sketchybar_alive: bool) -> Vec<Kind> {
    if !SUPPORTED {
        return vec![];
    }
    match target {
        BarTarget::Auto if sketchybar_alive => vec![Kind::Sketchybar],
        BarTarget::Auto | BarTarget::Menubar => vec![Kind::Menubar],
        BarTarget::Sketchybar => vec![Kind::Sketchybar],
        BarTarget::Both => vec![Kind::Menubar, Kind::Sketchybar],
        BarTarget::Off => vec![],
    }
}

fn target(kind: Kind) -> &'static dyn Target {
    match kind {
        Kind::Menubar => &menubar::MenuBar,
        Kind::Sketchybar => &sketchybar::Sketchybar,
    }
}

fn unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

pub fn install(app: &AppHandle) {
    app.manage(Bar::default());
    popover::install(app);
    if !SUPPORTED {
        eprintln!("bar\tnot on Linux yet; [bar] is read, items are registered, none is drawn, no popover window is built");
        return;
    }
    menubar::install(app);
    sketchybar::install(app);
    triggers::install(app);
    fixture::seed(app);
}

/// `key`'s rules as they apply now: the manifest's with the file's on top (`Bar::rules_of`).
pub fn rules_of(config: &Config, key: &str, manifest: &ManifestBar) -> Vec<(String, pal_core::config::BarRule)> {
    let m: Vec<(String, pal_core::config::BarRule)> = manifest.rules.iter().map(|r| (r.id.clone(), r.rule.clone())).collect();
    config.bar.rules_of(key, &m)
}

/// Every item's conditions for `states::States::configure`: the file's
/// `show_when`/`hide_when`, and its rules' `when` (a registered item's
/// from its manifest with the file's overrides; an item in the file alone
/// gets the file's own rules).
pub fn conditions(app: &AppHandle, config: &Config) -> Vec<pal_core::states::BarConditions> {
    let registered: BTreeMap<String, ManifestBar> = app.try_state::<Bar>().map(|st| lock(&st.entries).iter().map(|(k, e)| (k.clone(), e.manifest.clone())).collect()).unwrap_or_default();
    let mut keys: BTreeSet<String> = registered.keys().cloned().collect();
    keys.extend(config.bar.items.keys().cloned());
    keys.into_iter()
        .map(|key| {
            let item = config.bar.item(&key);
            let rules = rules_of(config, &key, registered.get(&key).unwrap_or(&ManifestBar::default())).into_iter().filter_map(|(id, r)| r.when.map(|w| (id, w))).collect();
            pal_core::states::BarConditions { key: key.clone(), show_when: item.show_when.clone(), hide_when: item.hide_when.clone(), rules }
        })
        .filter(|c| c.show_when.is_some() || c.hide_when.is_some() || !c.rules.is_empty())
        .collect()
}

/// Whether `key` is drawn here: the config says so, its state condition
/// holds, and the platform can.
fn draws(app: &AppHandle, config: &Config, key: &str) -> bool {
    SUPPORTED && config.bar.draws(key) && crate::states::shows(app, key)
}

/// The host loaded an extension (an instance of one: `ext` is the key):
/// register its items (replacing what it declared before) and render
/// each. Nothing in the manifest: its items go. `instance` is the label
/// the tooltips carry, see [`Entry::instance`].
pub fn on_extension_loaded(app: &AppHandle, ext: &str, bars: Vec<ManifestBar>, instance: Option<String>) {
    let config = settings::config(app);
    let (added, gone): (Vec<String>, Vec<String>) = Bar::with(app, |e| {
        let gone: Vec<String> = e.keys().filter(|k| k.starts_with(&format!("{ext}/")) && !bars.iter().any(|b| key_of(ext, &b.id) == **k)).cloned().collect();
        for k in &gone {
            e.remove(k);
        }
        let mut added = Vec::new();
        for m in bars {
            let key = key_of(ext, &m.id);
            let entry = e.entry(key.clone()).or_insert_with(|| Entry { manifest: m.clone(), last: None, rendered_at: None, rendered_unix: None, stale: false, rendering: false, due_again: false, timer_gen: 0, fixture: false, held: false, instance: None });
            entry.manifest = m;
            entry.fixture = false;
            entry.instance = instance.clone();
            // A label that changed (the second instance appeared) shows on the next draw.
            if let Some(last) = entry.last.as_mut() {
                last.label(entry.instance.as_deref());
            }
            added.push(key);
        }
        (added, gone)
    });
    for k in &gone {
        forget(app, k);
    }
    crate::states::reconfigure_bar(app);
    for k in &added {
        let source = entry(app, k).is_some_and(|e| e.manifest.source);
        if !source {
            eprintln!("bar\t{k}\tregistered\tno render in the code; never rendered");
        } else if draws(app, &config, k) {
            eprintln!("bar\t{k}\tregistered");
            render(app, k, "load");
        } else {
            eprintln!("bar\t{k}\tregistered\tnot drawn{}", if SUPPORTED { "" } else { " on Linux" });
        }
    }
    write_feed(app);
}

/// The extension errored or went: its items leave every target.
pub fn remove_extension(app: &AppHandle, ext: &str) {
    let keys: Vec<String> = Bar::with(app, |e| {
        let keys: Vec<String> = e.keys().filter(|k| k.starts_with(&format!("{ext}/"))).cloned().collect();
        for k in &keys {
            e.remove(k);
        }
        keys
    });
    for k in &keys {
        forget(app, k);
    }
    if !keys.is_empty() {
        write_feed(app);
    }
}

/// Off every target, the popover down if it showed it.
fn forget(app: &AppHandle, key: &str) {
    for kind in [Kind::Menubar, Kind::Sketchybar] {
        target(kind).remove(app, key);
    }
    popover::on_item_gone(app, key);
}

/// Every pal item off every target: quit.
pub fn remove_all(app: &AppHandle) {
    for kind in [Kind::Menubar, Kind::Sketchybar] {
        target(kind).remove_all(app);
    }
}

/// The keys registered, in order, with what is known about each: the CLI's
/// `list` reads the feed file this also writes.
pub fn snapshot(app: &AppHandle) -> Vec<(String, Entry)> {
    Bar::with(app, |e| e.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
}

pub fn entry(app: &AppHandle, key: &str) -> Option<Entry> {
    Bar::with(app, |e| e.get(key).cloned())
}

/// The last rendered item as the strip shows it ([`BarItem::kept`] under
/// the config's `show`): what a click, a hover or the popover reads, so
/// an item kept on the strip opens its `empty` menu. `None` while it has
/// never rendered.
pub fn drawn(app: &AppHandle, key: &str) -> Option<BarItem> {
    let item = entry(app, key)?.last?;
    Some(item.kept(settings::config(app).bar.item(key).show))
}

// ---- render --------------------------------------------------------------

/// Ask the host for the item now (`reason` rides in the ctx), off the
/// caller's thread. A render already running marks it due again instead.
pub fn render(app: &AppHandle, key: &str, reason: &'static str) {
    let key = key.to_string();
    let app = app.clone();
    tauri::async_runtime::spawn(async move { render_now(app, key, reason).await });
}

async fn render_now(app: AppHandle, key: String, reason: &'static str) {
    let Some((ext, id)) = split_key(&key).map(|(e, i)| (e.to_string(), i.to_string())) else { return };
    let start = Bar::with(&app, |e| {
        let entry = e.get_mut(&key)?;
        if entry.fixture || !entry.manifest.source {
            return None;
        }
        if entry.rendering {
            entry.due_again = true;
            return None;
        }
        entry.rendering = true;
        Some(())
    });
    if start.is_none() {
        return;
    }
    let Some(host) = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()) else {
        Bar::with(&app, |e| e.get_mut(&key).map(|en| en.rendering = false));
        return;
    };
    let t0 = Instant::now();
    let params = json!({ "extension": ext, "id": id, "ctx": { "reason": reason, "compact": true } });
    let r = tokio::time::timeout(RENDER_TIMEOUT, host.request("bar/render", params)).await;
    let item = match r {
        // A limit the host checks (`checkBarItem`) comes back as `{ id, error }`.
        Ok(Ok(v)) if v.get("error").is_some() => {
            eprintln!("bar\t{key}\tfailed\t{}", v["error"].as_str().unwrap_or("error"));
            None
        }
        Ok(Ok(v)) => match serde_json::from_value::<BarItem>(v) {
            Ok(item) => Some(item),
            Err(e) => {
                eprintln!("bar\t{key}\tfailed\tbad item: {e}");
                None
            }
        },
        Ok(Err(e)) => {
            eprintln!("bar\t{key}\tfailed\t{e}");
            None
        }
        Err(_) => {
            eprintln!("bar\t{key}\tfailed\ttimed out after {RENDER_TIMEOUT:?}");
            None
        }
    };
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    match item {
        Some(item) => {
            eprintln!("bar\t{key}\trendered\t{ms:.1}ms\t{reason}\t{}", summary(&item));
            set(&app, &key, item, false);
        }
        None => set_stale(&app, &key),
    }
    let again = Bar::with(&app, |e| {
        let Some(entry) = e.get_mut(&key) else { return false };
        entry.rendering = false;
        std::mem::take(&mut entry.due_again)
    });
    if again {
        render(&app, &key, reason);
    } else {
        schedule(&app, &key);
    }
}

/// One line about an item for the log.
fn summary(item: &BarItem) -> String {
    if item.hidden {
        return "hidden".into();
    }
    let mut s = item.title.clone().unwrap_or_default();
    if let Some(n) = item.count() {
        s.push_str(&format!(" badge={n}"));
    }
    if item.dot() {
        s.push_str(" badge=dot");
    }
    if !item.segments.is_empty() {
        s.push_str(&format!(" {} segments", item.segments.len()));
    }
    if item.has_menu() {
        s.push_str(" menu");
    }
    s.trim().to_string()
}

/// A failed render: the last item stays, drawn stale.
fn set_stale(app: &AppHandle, key: &str) {
    let changed = Bar::with(app, |e| {
        let Some(entry) = e.get_mut(key) else { return false };
        let was = entry.stale;
        entry.stale = true;
        !was && entry.last.is_some()
    });
    if changed {
        sync(app, key);
    }
}

/// `t` without a ` (<label>)` it already ends in, so a re-registration does not stack them.
fn strip_label<'a>(t: &'a str, label: Option<&str>) -> Option<&'a str> {
    match label {
        Some(l) => Some(t.strip_suffix(&format!(" ({l})")).unwrap_or(t)),
        None => Some(t),
    }
}

/// The item's new state (a render, a push): stored, and the targets
/// touched only when something changed. `push` says it came from
/// `bar.update`, which restarts the poll. The instance's label goes on
/// the tooltip here, before the compare, so an unchanged render stays
/// unchanged.
fn set(app: &AppHandle, key: &str, mut item: BarItem, push: bool) {
    // The item's facts first, so the draw below sees its rules by them.
    if let Some((ext, _)) = split_key(key) {
        crate::states::publish_many(app, ext, std::mem::take(&mut item.states));
    }
    let changed = Bar::with(app, |e| {
        let entry = e.get_mut(key)?;
        item.label(entry.instance.as_deref());
        let same = entry.last.as_ref() == Some(&item) && !entry.stale;
        entry.last = Some(item);
        entry.stale = false;
        entry.rendered_at = Some(Instant::now());
        entry.rendered_unix = Some(unix_secs());
        Some(!same)
    });
    match changed {
        None => eprintln!("bar\t{key}\tset after removal; dropped"),
        Some(false) => {}
        Some(true) => {
            sync(app, key);
            popover::on_item_changed(app, key);
        }
    }
    if push {
        schedule(app, key);
    }
}

/// The last render with the rules that hold applied (`active`, in rule
/// order, later wins): presence, urgency and position on the item, a
/// rule's tint over the render's, the other appearance keys merged over
/// the file's own into the look override returned beside it. `None`
/// while the item has never rendered.
fn ruled(config: &Config, key: &str, entry: &Entry, active: &[String]) -> Option<(BarItem, BarLookOverride)> {
    let cfg = config.bar.item(key);
    let mut item = entry.last.clone()?;
    let mut over = cfg.look.clone();
    for (_, rule) in rules_of(config, key, &entry.manifest).into_iter().filter(|(id, _)| active.contains(id)) {
        if let Some(h) = rule.hidden {
            item.hidden = h;
        }
        if let Some(u) = rule.urgent {
            item.urgent = u;
        }
        if rule.position.is_some() {
            item.position = rule.position.clone();
        }
        // A rule's tint is the decision, a `muted` from the render included, and over the file's item-level `color` (a preference, which leaves muted alone).
        if let Some(c) = &rule.look.color {
            item.color = Some(c.clone());
            over.color = None;
        }
        over = over.with(&BarLookOverride { color: None, ..rule.look.clone() });
    }
    Some((item, over))
}

/// The item as drawn: the last state with its rules applied and as
/// `show` keeps it, with `stale` from the registry, and the config that
/// places it. `None` while it has never rendered.
fn draw_for(config: &Config, key: &str, entry: &Entry, kind: Kind, active: &[String]) -> Option<Draw> {
    let cfg = config.bar.item(key);
    let (item, over) = ruled(config, key, entry, active)?;
    let mut item = item.kept(cfg.show);
    item.stale = item.stale || entry.stale;
    let target = match kind {
        Kind::Sketchybar => BarTarget::Sketchybar,
        Kind::Menubar => BarTarget::Menubar,
    };
    let hover = item.has_menu() && config.bar.open_on_hover(key, target);
    let look = config.bar.look_with(target, &over);
    let position = item.position.clone().unwrap_or_else(|| config.bar.position_of(key));
    Some(Draw { item: item.shaped(&look), order: cfg.order.unwrap_or(0), position, hover, look })
}

/// Push `key`'s state to every target: drawn where its target says and
/// it is enabled, removed elsewhere. Then the feed file.
fn sync(app: &AppHandle, key: &str) {
    let config = settings::config(app);
    let entry = entry(app, key);
    let wanted = kinds(config.bar.target_of(key), sketchybar_alive(app));
    let enabled = draws(app, &config, key);
    let active = crate::states::active_rules(app, key);
    for kind in [Kind::Menubar, Kind::Sketchybar] {
        let draw = entry.as_ref().filter(|_| enabled && wanted.contains(&kind)).and_then(|e| draw_for(&config, key, e, kind, &active));
        target(kind).apply(app, key, draw.as_ref());
    }
    write_feed(app);
}

/// Every item again: the config changed, sketchybar came or went.
pub fn sync_all(app: &AppHandle) {
    for (key, _) in snapshot(app) {
        sync(app, &key);
    }
}

/// (Re)arm the poll for `key` from its manifest and its last `refresh`.
fn schedule(app: &AppHandle, key: &str) {
    let config = settings::config(app);
    let next = Bar::with(app, |e| {
        let entry = e.get_mut(key)?;
        entry.timer_gen += 1;
        if entry.fixture || !draws(app, &config, key) {
            return None;
        }
        let every = entry.manifest.refresh.as_ref().and_then(|r| r.every);
        next_poll(every, entry.last.as_ref().and_then(|i| i.refresh)).map(|d| (d, entry.timer_gen))
    });
    let Some((after, gen)) = next else { return };
    let (app, key) = (app.clone(), key.to_string());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(after).await;
        let current = Bar::with(&app, |e| e.get(&key).is_some_and(|en| en.timer_gen == gen));
        if current {
            render(&app, &key, "every");
        }
    });
}

/// `bar.update` from the extension: the item replaces the last one after
/// [`PUSH_DEBOUNCE`]; a burst lands once, with the last state.
pub fn update(app: &AppHandle, key: &str, item: BarItem) {
    let st = app.state::<Bar>();
    let seq = st.seq.fetch_add(1, Ordering::Relaxed) + 1;
    lock(&st.pending).insert(key.to_string(), (item, seq));
    let (app, key) = (app.clone(), key.to_string());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(PUSH_DEBOUNCE).await;
        let st = app.state::<Bar>();
        let take = {
            let mut p = lock(&st.pending);
            match p.get(&key) {
                Some((_, s)) if *s == seq => p.remove(&key).map(|(i, _)| i),
                _ => None,
            }
        };
        if let Some(item) = take {
            eprintln!("bar\t{key}\tpushed\t{}", summary(&item));
            set(&app, &key, item, true);
        }
    });
}

/// Every enabled item that asked for `trigger` renders now; the pages
/// hear it too (`pal://trigger`), for a view level whose palette lists it
/// under `on` (views.rs).
pub fn trigger(app: &AppHandle, trigger: &'static str) {
    crate::events::emit(app, crate::events::TRIGGER, json!({ "name": trigger }));
    let config = settings::config(app);
    let keys: Vec<String> = Bar::with(app, |e| e.iter().filter(|(_, en)| !en.fixture && en.manifest.wants(trigger)).map(|(k, _)| k.clone()).collect());
    let keys: Vec<String> = keys.into_iter().filter(|k| draws(app, &config, k)).collect();
    for k in keys {
        render(app, &k, trigger);
    }
}

/// The panel is showing (`pal://shown`): the `show` trigger.
pub fn on_shown(app: &AppHandle) {
    trigger(app, "show");
}

/// The config was reloaded: items switched off leave, ones switched on
/// render, the rest are re-placed (target, position, order, hover).
pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    if prev.bar == next.bar {
        return;
    }
    if SUPPORTED {
        // A target that now wants sketchybar asks whether it is up; a change re-syncs everything again.
        sketchybar::reprobe(app, "config");
    }
    let keys: Vec<String> = Bar::with(app, |e| e.keys().cloned().collect());
    for key in &keys {
        let (was, now) = (draws(app, prev, key), draws(app, next, key));
        if !was && now {
            render(app, key, "settings");
        } else if was && !now {
            schedule(app, key);
            forget(app, key);
        }
        sync(app, key);
    }
}

/// States changed (states.rs): every item whose `show_when`/`hide_when`
/// reads one of `changed` (every conditioned item with `all`) is placed by
/// its condition now, and one whose `refresh.on` lists `state:<name>`
/// renders (`state:*`: on any change). Coming back from held-off renders
/// too: what it last drew is as old as the hold.
pub fn on_states_changed(app: &AppHandle, changed: &[String], all: bool) {
    if app.try_state::<Bar>().is_none() {
        return; // the built-ins' first values land before the registry exists
    }
    let config = settings::config(app);
    let conditioned: Vec<String> = if all { conditions(app, &config).into_iter().map(|c| c.key).collect() } else { crate::states::bar_items_reading(app, changed) };
    let triggered: Vec<String> = Bar::with(app, |e| e.iter().filter(|(_, en)| !en.fixture && (changed.iter().any(|n| en.manifest.wants(&format!("state:{n}"))) || (!changed.is_empty() && en.manifest.wants("state:*")))).map(|(k, _)| k.clone()).collect());
    for key in conditioned {
        let now = draws(app, &config, &key);
        let held = Bar::with(app, |e| e.get_mut(&key).map(|en| std::mem::replace(&mut en.held, !now)));
        match (held, now) {
            (None, _) => {}
            (Some(true), true) => render(app, &key, "state"),
            (Some(false), true) => sync(app, &key),
            (_, false) => {
                schedule(app, &key);
                forget(app, &key);
                write_feed(app);
            }
        }
    }
    for key in triggered {
        if draws(app, &config, &key) {
            render(app, &key, "state");
        }
    }
}

/// A manual value was set or reset (states.rs): the items that asked for
/// `state:*` render, whether or not a resolved value moved (holding a
/// state at the value it already had is still something to show).
pub fn on_states_held(app: &AppHandle) {
    if app.try_state::<Bar>().is_none() {
        return;
    }
    let config = settings::config(app);
    let keys: Vec<String> = Bar::with(app, |e| e.iter().filter(|(_, en)| !en.fixture && en.manifest.wants("state:*")).map(|(k, _)| k.clone()).collect());
    for key in keys {
        if draws(app, &config, &key) {
            render(app, &key, "state");
        }
    }
}

/// The host's `settings/changed` for `ext`: its items render again.
pub fn on_settings_changed(app: &AppHandle, exts: &[String]) {
    let keys: Vec<String> = Bar::with(app, |e| e.keys().filter(|k| exts.iter().any(|x| k.starts_with(&format!("{x}/")))).cloned().collect());
    for k in keys {
        render(app, &k, "settings");
    }
}

// ---- actions -------------------------------------------------------------

/// `bar/action`: the extension's `onAction`, its Effect run with `window`
/// as the one the pick came from; a `keep` renders the item again. The
/// envelope comes back for the page.
pub async fn action(app: &AppHandle, key: &str, action: &str, anchor: &str, window: &str, values: Option<Value>) -> Result<Value, String> {
    let (ext, id) = split_key(key).ok_or_else(|| format!("bad key {key}"))?;
    let fixture = entry(app, key).ok_or_else(|| format!("no bar item {key}"))?.fixture;
    let r = if fixture {
        json!({ "hud": format!("{key}: {action}") })
    } else {
        let host = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()).ok_or("no host")?;
        let mut ctx = json!({ "reason": "open", "anchor": anchor, "compact": true });
        // What a control in the popover read (`BarCtx.values`): the view's text field on Enter, a form's fields, a slider's fraction.
        if let Some(v) = values.filter(|v| v.is_object()) {
            ctx["values"] = v;
        }
        host.request("bar/action", json!({ "extension": ext, "id": id, "action": action, "ctx": ctx })).await?
    };
    let r = effects::apply_from(app, r, window).await?;
    if r.get("keep").is_some() {
        render(app, key, "update");
    }
    Ok(r)
}

/// `bar/open`: a click on an item with no `menu`; the extension's
/// `onOpen` answers an Effect. A `push`, `view`, `show`, `form` or `toast`
/// in it opens the popover engaged with that level.
pub async fn open(app: &AppHandle, key: &str, anchor: &str, rect: Option<Rect>) -> Result<Value, String> {
    let (ext, id) = split_key(key).ok_or_else(|| format!("bad key {key}"))?;
    let fixture = entry(app, key).ok_or_else(|| format!("no bar item {key}"))?.fixture;
    let r = if fixture {
        json!({ "hud": format!("{key}: open") })
    } else {
        let host = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()).ok_or("no host")?;
        host.request("bar/open", json!({ "extension": ext, "id": id, "ctx": { "reason": "open", "anchor": anchor, "compact": true } })).await?
    };
    let r = effects::apply_from(app, r, popover::WINDOW).await?;
    if effects::stays_open(&r) {
        popover::open_effect(app, key, rect, &r);
    }
    if r.get("keep").is_some() {
        render(app, key, "update");
    }
    Ok(r)
}

/// `bar/shown`: the popover opened on `key` (a peek counts).
pub fn shown(app: &AppHandle, key: &str) {
    let Some((ext, id)) = split_key(key).map(|(e, i)| (e.to_string(), i.to_string())) else { return };
    if entry(app, key).is_some_and(|e| e.fixture) {
        return;
    }
    let Some(host) = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()) else { return };
    tauri::async_runtime::spawn(async move {
        if let Err(e) = host.notify("bar/shown", json!({ "extension": ext, "id": id, "ctx": { "reason": "open", "compact": true } })).await {
            eprintln!("bar\t{ext}/{id}\tshown notify failed\t{e}");
        }
    });
    let wants = entry(app, key).is_some_and(|e| e.manifest.wants("show"));
    if wants {
        render(app, key, "show");
    }
}

// ---- bridge --------------------------------------------------------------

/// `core/bar.update {extension, id, item}` and `core/bar.refresh
/// {extension, id}` from the host (bridge.rs).
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let ext = params["extension"].as_str().ok_or("bar: no extension")?;
    let id = params["id"].as_str().ok_or("bar: no id")?;
    let key = key_of(ext, id);
    if entry(app, &key).is_none() {
        return Err(format!("bar: {key} is not declared in the manifest"));
    }
    match func {
        "update" => {
            let item: BarItem = serde_json::from_value(params["item"].clone()).map_err(|e| format!("bar.update: bad item: {e}"))?;
            update(app, &key, item);
            Ok(Value::Null)
        }
        "refresh" => {
            render(app, &key, "update");
            Ok(Value::Null)
        }
        _ => Err(format!("unknown bar function {func}")),
    }
}

// ---- feed ----------------------------------------------------------------

/// `<data dir>/bar.json`: every item's last state, what `pal bar list`
/// and `pal bar json` read in their own process (the single-instance
/// channel is one way). Phase 3 grows it into the waybar feed.
pub fn feed_path() -> std::path::PathBuf {
    pal_core::fs::data_dir().join("bar.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedEntry {
    pub title: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stale: bool,
    /// Off every target by its `show_when`/`hide_when` (states.rs).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub held: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<BarItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Feed {
    pub items: BTreeMap<String, FeedEntry>,
}

/// The feed says what the strip shows: an item `show = "always"` keeps is its kept shape here too.
fn write_feed(app: &AppHandle) {
    let config = settings::config(app);
    // As drawn: the rules that hold and `show` applied, so `pal bar list` says what the strip shows.
    let feed = Feed { items: snapshot(app).into_iter().map(|(k, e)| { let active = crate::states::active_rules(app, &k); let item = ruled(&config, &k, &e, &active).map(|(i, _)| i.kept(config.bar.item(&k).show)); (k, FeedEntry { title: e.manifest.title, stale: e.stale, held: e.held, rendered_at: e.rendered_unix, item }) }).collect() };
    let path = feed_path();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(e) = pal_core::fs::write_atomic(&path, serde_json::to_vec_pretty(&feed).unwrap_or_default()) {
            eprintln!("bar\tfeed write failed\t{e}");
        }
    });
}

pub fn read_feed() -> Feed {
    std::fs::read(feed_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

// ---- triggers ------------------------------------------------------------

mod triggers {
    use super::*;

    /// The clock tick (`minute`), and on macOS the workspace's wake and
    /// activate notifications (`wake`, `focus`); wake and a Space change
    /// also probe for sketchybar again (`sketchybar::reprobe`), and an
    /// activation stamps the core's focus history
    /// (`windows::stamp_focused`).
    pub fn install(app: &AppHandle) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                trigger(&handle, "minute");
            }
        });
        #[cfg(target_os = "macos")]
        macos::install(app);
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        use objc2_app_kit::{NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification, NSWorkspaceDidActivateApplicationNotification, NSWorkspaceDidWakeNotification};
        use objc2_foundation::NSNotification;

        pub fn install(app: &AppHandle) {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                let center = NSWorkspace::sharedWorkspace().notificationCenter();
                let observe = |name, f: Box<dyn Fn() + 'static>| {
                    let block = block2::RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| f());
                    // The observer token is leaked on purpose: the observation lasts the process.
                    let token = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block) };
                    std::mem::forget(token);
                };
                let h = handle.clone();
                observe(unsafe { NSWorkspaceDidWakeNotification }, Box::new(move || trigger(&h, "wake")));
                let h = handle.clone();
                observe(unsafe { NSWorkspaceDidActivateApplicationNotification }, Box::new(move || { crate::windows::stamp_focused(); trigger(&h, "focus") }));
                for (name, why) in [(unsafe { NSWorkspaceDidWakeNotification }, "wake"), (unsafe { NSWorkspaceActiveSpaceDidChangeNotification }, "space")] {
                    let h = handle.clone();
                    observe(name, Box::new(move || sketchybar::reprobe(&h, why)));
                }
            });
        }
    }
}

// ---- fixture -------------------------------------------------------------

mod fixture {
    use super::*;

    /// `PAL_BAR_FIXTURE`: JSON (inline, or a path to a file) of
    /// `[{ extension, id, title, item }]`, seeded as items with no host
    /// behind them, for verifying the strips and the popover without an
    /// extension. Renders are skipped for them; an action answers a HUD line.
    pub fn seed(app: &AppHandle) {
        let Some(raw) = std::env::var("PAL_BAR_FIXTURE").ok().filter(|s| !s.trim().is_empty()) else { return };
        let text = if raw.trim_start().starts_with(['[', '{']) { raw } else { std::fs::read_to_string(&raw).unwrap_or_default() };
        let rows: Vec<Value> = match serde_json::from_str(&text) {
            Ok(Value::Array(a)) => a,
            _ => return eprintln!("bar\tfixture\tPAL_BAR_FIXTURE is not a JSON array"),
        };
        let mut keys = Vec::new();
        Bar::with(app, |e| {
            for r in rows {
                let (Some(ext), Some(id)) = (r["extension"].as_str(), r["id"].as_str()) else { continue };
                let Ok(item) = serde_json::from_value::<BarItem>(r["item"].clone()) else { continue };
                let key = key_of(ext, id);
                let manifest = ManifestBar { id: id.into(), title: r["title"].as_str().unwrap_or(id).into(), ..Default::default() };
                e.insert(key.clone(), Entry { manifest, last: Some(item), rendered_at: Some(Instant::now()), rendered_unix: Some(unix_secs()), stale: false, rendering: false, due_again: false, timer_gen: 0, fixture: true, held: false, instance: None });
                keys.push(key);
            }
        });
        eprintln!("bar\tfixture\t{} items: {}", keys.len(), keys.join(", "));
        for k in &keys {
            sync(app, k);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_parses_the_wire_shape_and_diffs_by_value() {
        let a: BarItem = serde_json::from_value(json!({ "icon": "\u{f09b}", "badge": 3, "tooltip": "3 unread", "menu": [{ "type": "item", "id": "open", "title": "Open" }] })).unwrap();
        assert_eq!(a.count(), Some(3));
        assert!(!a.dot());
        assert!(a.has_menu());
        assert!(!a.opens_directly());
        assert_eq!(a.icon_kind(), Some(IconKind::Glyph('\u{f09b}')));
        let b: BarItem = serde_json::from_value(json!({ "icon": "🔔", "badge": "dot", "title": "x", "segments": [{ "id": "a", "text": "1", "color": "red" }] })).unwrap();
        assert!(b.dot());
        assert_eq!(b.icon_kind(), Some(IconKind::Text("🔔".into())));
        assert_eq!(b.segments[0].color.as_deref(), Some("red"));
        let img: BarItem = serde_json::from_value(json!({ "icon": { "image": "data:image/png;base64,AA==", "template": true } })).unwrap();
        assert!(matches!(img.icon_kind(), Some(IconKind::Image { template: true, .. })));
        assert!(serde_json::from_value::<BarItem>(json!({ "badge": "blob" })).is_err(), "a badge is a count or dot");
        let same: BarItem = serde_json::from_value(json!({ "icon": "\u{f09b}", "badge": 3, "tooltip": "3 unread", "menu": [{ "type": "item", "id": "open", "title": "Open" }] })).unwrap();
        assert_eq!(a, same, "the diff is by value: an identical render touches no target");
        assert_ne!(a, BarItem { badge: Some(Badge::Count(4)), ..a.clone() });
        let hidden: BarItem = serde_json::from_value(json!({ "hidden": true })).unwrap();
        assert!(hidden.hidden && !hidden.has_menu());
        assert_eq!(serde_json::to_value(&hidden).unwrap(), json!({ "hidden": true }), "unset fields are not written");
        let direct: BarItem = serde_json::from_value(json!({ "click": "open", "menu": [] })).unwrap();
        assert!(direct.has_menu() && direct.opens_directly(), "a direct item keeps its menu for hover");
        assert_eq!(serde_json::to_value(&direct).unwrap(), json!({ "click": "open", "menu": [] }));
        let dynamic: BarItem = serde_json::from_value(json!({ "background": "amber", "icon_size": 18, "label_size": 11, "icon_width": 31, "position": "q" })).unwrap();
        assert_eq!(dynamic.background.as_deref(), Some("amber"));
        assert_eq!((dynamic.icon_size, dynamic.label_size, dynamic.icon_width, dynamic.position.as_deref()), (Some(18.0), Some(11.0), Some(31.0), Some("q")));
        let scroll: BarItem = serde_json::from_value(json!({ "scroll": { "up": "next", "down": "previous" } })).unwrap();
        assert_eq!(scroll.scroll.as_ref().map(|s| (s.up.as_str(), s.down.as_str())), Some(("next", "previous")));
    }

    #[test]
    fn tint_follows_urgent_then_muted_then_own() {
        let draw = |item: BarItem, look: BarLook| Draw { item, order: 0, position: "right".into(), hover: false, look };
        let mut i = BarItem { color: Some("green".into()), ..Default::default() };
        assert_eq!(draw(i.clone(), BarLook::default()).tint(), Some("green"));
        i.stale = true;
        assert!(i.muted());
        assert_eq!(draw(i.clone(), BarLook::default()).tint(), Some("muted"), "stale dims");
        i.urgent = true;
        assert!(!i.muted(), "an alarm is never dim");
        assert_eq!(draw(i.clone(), BarLook::default()).tint(), Some("destructive"));
        assert_eq!(draw(i, BarLook { urgent_color: "#ff8800".into(), ..Default::default() }).tint(), Some("#ff8800"), "the look's urgent colour");
        assert_eq!(draw(BarItem::default(), BarLook::default()).tint(), None, "no colour: the bar's text colour");
        assert!(BarItem { color: Some("muted".into()), ..Default::default() }.muted(), "the extension's muted is the same dim");
    }

    #[test]
    fn badge_tint_follows_the_item_unless_the_look_says() {
        let draw = |item: BarItem, look: BarLook| Draw { item, order: 0, position: "right".into(), hover: false, look };
        let green = BarItem { color: Some("green".into()), badge: Some(Badge::Count(3)), ..Default::default() };
        assert_eq!(draw(green.clone(), BarLook::default()).badge_tint(), Some("green"), "unset: the tint");
        assert_eq!(draw(BarItem::default(), BarLook::default()).badge_tint(), None, "no colour: the bar's text colour, not red");
        assert_eq!(draw(green.clone(), BarLook { badge_color: Some("red".into()), ..Default::default() }).badge_tint(), Some("red"));
        assert_eq!(draw(BarItem { urgent: true, ..green.clone() }, BarLook::default()).badge_tint(), Some("destructive"), "urgent: the urgent colour");
        assert_eq!(draw(BarItem { urgent: true, ..green.clone() }, BarLook { badge_color: Some("grey".into()), ..Default::default() }).badge_tint(), Some("grey"), "a set colour holds while urgent");
        assert_eq!(draw(BarItem { stale: true, ..green }, BarLook { badge_color: Some("red".into()), ..Default::default() }).badge_tint(), Some("muted"), "stale mutes the badge with the rest");
    }

    #[test]
    fn sizes_split_then_follow_size_then_the_item() {
        let draw = |item: BarItem, look: BarLook| Draw { item, order: 0, position: "right".into(), hover: false, look };
        let d = draw(BarItem::default(), BarLook { size: 12.0, ..Default::default() });
        assert_eq!((d.icon_size(), d.label_size()), (12.0, 12.0), "size sets both");
        let d = draw(BarItem::default(), BarLook { size: 12.0, icon_size: 16.0, ..Default::default() });
        assert_eq!((d.icon_size(), d.label_size()), (16.0, 12.0), "icon_size the glyph alone");
        let d = draw(BarItem::default(), BarLook { text_size: 9.0, ..Default::default() });
        assert_eq!((d.icon_size(), d.label_size()), (0.0, 9.0), "text_size the text alone, the glyph at the bar's own");
        let d = draw(BarItem { icon_size: Some(18.0), label_size: Some(11.0), ..Default::default() }, BarLook { size: 12.0, icon_size: 16.0, text_size: 9.0, ..Default::default() });
        assert_eq!((d.icon_size(), d.label_size()), (18.0, 11.0), "the item's dynamic sizes still win");
    }

    #[test]
    fn shaped_applies_the_look() {
        let item: BarItem = serde_json::from_value(json!({ "icon": "\u{f09b}", "title": "prs", "badge": 3, "color": "green", "segments": [{ "id": "a", "text": "1" }] })).unwrap();
        let same = item.clone().shaped(&BarLook::default());
        assert_eq!(same, item, "the defaults change nothing");
        let glyph_only = item.clone().shaped(&BarLook { show_title: false, ..Default::default() });
        assert!(glyph_only.title.is_none() && glyph_only.segments.is_empty() && glyph_only.icon.is_some());
        let no_icon = item.clone().shaped(&BarLook { show_icon: false, ..Default::default() });
        assert!(no_icon.icon.is_none() && no_icon.title.is_some());
        assert_eq!(item.clone().shaped(&BarLook { badge_style: BadgeStyle::Dot, ..Default::default() }).badge, Some(Badge::Dot(DotTag::Dot)), "a count drawn as a dot");
        assert_eq!(item.clone().shaped(&BarLook { badge_style: BadgeStyle::None, ..Default::default() }).badge, None);
        assert_eq!(item.clone().shaped(&BarLook { color: Some("blue".into()), ..Default::default() }).color.as_deref(), Some("blue"), "the tint replaces the extension's colour");
        let paused = BarItem { color: Some("muted".into()), ..item.clone() }.shaped(&BarLook { color: Some("blue".into()), ..Default::default() });
        assert_eq!(paused.color.as_deref(), Some("muted"), "muted is a state and stays");
        let own = item.clone().shaped(&BarLook { icon: Some("🔔".into()), ..Default::default() });
        assert_eq!(own.icon, Some(json!("🔔")), "the look's icon replaces the extension's");
        assert_eq!(own.icon_kind(), Some(IconKind::Text("🔔".into())));
        assert!(BarItem::default().shaped(&BarLook { icon: Some("\u{f09b}".into()), ..Default::default() }).icon.is_some(), "and gives an item without one an icon");
        let picture = item.clone().shaped(&BarLook { icon: Some("~/icons/work.svg".into()), ..Default::default() });
        assert_eq!(picture.icon, Some(json!({ "image": pal_core::fs::expand_home("~/icons/work.svg").to_string_lossy() })), "a path is a picture, the tilde expanded");
        assert!(matches!(picture.icon_kind(), Some(IconKind::Image { template: false, .. })));
        assert_eq!(look_icon("data:image/png;base64,AA=="), json!({ "image": "data:image/png;base64,AA==" }));
        assert_eq!(look_icon(" 3 "), json!("3"), "anything else is the text it is");
        assert!(item.clone().shaped(&BarLook { icon: Some("🔔".into()), show_icon: false, ..Default::default() }).icon.is_none(), "show_icon off drops it all the same");
        let gone = item.shaped(&BarLook { show_icon: false, show_title: false, badge_style: BadgeStyle::None, ..Default::default() });
        assert!(gone.hidden, "nothing left to draw takes no slot");
    }

    #[test]
    fn poll_floor_and_the_items_own_ask() {
        assert_eq!(next_poll(Some(300.0), None), Some(Duration::from_secs(300)));
        assert_eq!(next_poll(Some(300.0), Some(60.0)), Some(Duration::from_secs(60)), "the item's refresh wins this once");
        assert_eq!(next_poll(Some(3.0), None), Some(Duration::from_secs(10)), "never under the floor");
        assert_eq!(next_poll(None, Some(1.0)), Some(Duration::from_secs(10)));
        assert_eq!(next_poll(None, None), None, "no poll without an ask");
        assert_eq!(next_poll(Some(0.0), None), None);
        assert_eq!(next_poll(Some(f64::NAN), None), None);
    }

    #[test]
    fn manifest_bars_read_a_list_or_a_map() {
        let list = manifest_bars(&json!([{ "id": "notifications", "title": "Notifications", "source": true, "refresh": { "every": 60, "on": ["show"] } }, { "title": "no id" }, { "id": "declared", "title": "No code", "source": false }]));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "notifications");
        assert!(list[0].source, "the host says the code has a render");
        assert!(!list[1].source, "declared with no render: registered, never rendered");
        assert!(list[0].wants("show") && !list[0].wants("wake"));
        let map = manifest_bars(&json!({ "otp": { "title": "Latest code", "refresh": { "every": 10 }, "mocks": { "copied": { "title": "Code copied", "item": { "icon": "󰢬", "title": "123 456", "color": "green" } } } } }));
        assert_eq!(map[0].id, "otp");
        assert_eq!(map[0].refresh.as_ref().unwrap().every, Some(10.0));
        assert_eq!(map[0].mocks["copied"].title, "Code copied");
        assert_eq!(map[0].mocks["copied"].item.title.as_deref(), Some("123 456"));
        assert!(manifest_bars(&Value::Null).is_empty());
    }

    #[test]
    fn keys_and_targets() {
        assert_eq!(key_of("github", "prs"), "github/prs");
        assert_eq!(split_key("github/prs"), Some(("github", "prs")));
        assert_eq!(split_key("github"), None);
        assert_eq!(split_key("a/b/c"), None);
        // An instance key takes the extension's place: `<key>/<id>` (docs/design/instances.md).
        assert_eq!(key_of("gmail@work", "unread"), "gmail@work/unread");
        assert_eq!(split_key("gmail@work/unread"), Some(("gmail@work", "unread")));
        assert_eq!(labelled(Some("3 unread"), Some("Work")).as_deref(), Some("3 unread (Work)"), "the instance's label on the tooltip");
        assert_eq!(labelled(None, Some("Work")).as_deref(), Some("Work"));
        assert_eq!(labelled(Some(""), Some("Work")).as_deref(), Some("Work"));
        assert_eq!(labelled(Some("3 unread"), None).as_deref(), Some("3 unread"), "a lone default is not marked");
        assert_eq!(labelled(None, None), None);
        assert_eq!(strip_label("3 unread (Work)", Some("Work")), Some("3 unread"));
        assert_eq!(strip_label("3 unread", Some("Work")), Some("3 unread"));
        if SUPPORTED {
            assert_eq!(kinds(BarTarget::Auto, true), [Kind::Sketchybar]);
            assert_eq!(kinds(BarTarget::Auto, false), [Kind::Menubar]);
            assert_eq!(kinds(BarTarget::Both, false), [Kind::Menubar, Kind::Sketchybar]);
        } else {
            assert!(kinds(BarTarget::Both, true).is_empty(), "no target draws off macOS");
        }
        assert!(kinds(BarTarget::Off, true).is_empty());
        assert_eq!(Rect::parse("1,2,3.5,4"), Some(Rect { x: 1.0, y: 2.0, w: 3.5, h: 4.0 }));
        assert_eq!(Rect::parse("1,2"), None);
    }

    #[test]
    fn draw_carries_the_placement_and_hidden_reaches_the_target() {
        let (config, _) = pal_core::config::parse("[bar.menubar]\nsize = 12\n[bar.items.\"x/y\"]\norder = 5\nposition = \"left\"\nopen_on_hover = true\nbadge_style = \"dot\"\n").unwrap();
        let item: BarItem = serde_json::from_value(json!({ "hidden": true, "menu": { "palette": "apps" } })).unwrap();
        let entry = Entry { manifest: ManifestBar::default(), last: Some(item), rendered_at: None, rendered_unix: None, stale: true, rendering: false, due_again: false, timer_gen: 0, fixture: false, held: false, instance: None };
        let d = draw_for(&config, "x/y", &entry, Kind::Menubar, &[]).unwrap();
        assert!(d.item.hidden, "a hidden item is handed over: the target takes its slot away, its timer keeps running");
        assert!(d.item.stale, "the registry's stale rides on the item");
        assert_eq!((d.order, d.position.as_str(), d.hover), (5, "left", true));
        assert_eq!((d.look.size, d.look.badge_style), (12.0, BadgeStyle::Dot), "the look rides on the draw: the target's default with the item's keys");
        assert_eq!(draw_for(&config, "x/y", &entry, Kind::Sketchybar, &[]).unwrap().look.size, 0.0, "sketchybar's own defaults");
        let counted = Entry { last: Some(BarItem { badge: Some(Badge::Count(3)), icon: Some(json!("\u{f09b}")), ..Default::default() }), ..entry.clone() };
        assert_eq!(draw_for(&config, "x/y", &counted, Kind::Menubar, &[]).unwrap().item.badge, Some(Badge::Dot(DotTag::Dot)), "the item is shaped by the look before the target sees it");
        let none = Entry { last: None, ..entry };
        assert!(draw_for(&config, "x/y", &none, Kind::Menubar, &[]).is_none(), "nothing to draw before the first render");
        let (config, _) = pal_core::config::parse("").unwrap();
        let entry = Entry { manifest: ManifestBar::default(), last: Some(BarItem { menu: Some(json!([])), ..Default::default() }), rendered_at: None, rendered_unix: None, stale: false, rendering: false, due_again: false, timer_gen: 0, fixture: false, held: false, instance: None };
        assert!(!draw_for(&config, "x/y", &entry, Kind::Sketchybar, &[]).unwrap().hover, "no target peeks by default");
        assert!(!draw_for(&config, "x/y", &entry, Kind::Menubar, &[]).unwrap().hover);
        let no_menu = Entry { last: Some(BarItem::default()), ..entry };
        assert!(!draw_for(&config, "x/y", &no_menu, Kind::Sketchybar, &[]).unwrap().hover, "an item with no menu never peeks");
    }

    #[test]
    fn active_rules_decide_presence_urgency_tint_and_position_in_order() {
        let (config, _) = pal_core::config::parse("[bar.items.\"power/battery\"]\ncolor = \"blue\"\n[bar.items.\"power/battery\".rules.low]\nwhen = \"power.level < 25\"\nsize = 14\n[bar.items.\"power/battery\".rules.focus]\nwhen = \"not working\"\nhidden = true\n").unwrap();
        let rule = |id: &str, json: serde_json::Value| ManifestBarRule { id: id.into(), rule: serde_json::from_value(json).unwrap() };
        let manifest = ManifestBar { rules: vec![rule("fine", json!({ "when": "power.level >= 50", "hidden": true })), rule("low", json!({ "when": "power.level < 20", "color": "amber", "urgent": true })), rule("critical", json!({ "when": "power.level < 10", "color": "red", "position": "q" }))], ..ManifestBar::default() };
        let item: BarItem = serde_json::from_value(json!({ "icon": "x", "title": "42%", "color": "muted", "empty": { "icon": "x" } })).unwrap();
        let entry = Entry { manifest, last: Some(item), rendered_at: None, rendered_unix: None, stale: false, rendering: false, due_again: false, timer_gen: 0, fixture: false, held: false, instance: None };
        let rules = rules_of(&config, "power/battery", &entry.manifest);
        assert_eq!(rules.iter().map(|(id, r)| (id.as_str(), r.when.as_deref().unwrap())).collect::<Vec<_>>(), [("fine", "power.level >= 50"), ("low", "power.level < 25"), ("critical", "power.level < 10"), ("focus", "not working")], "the manifest's in order with the file's when on top, then the file's own");
        assert_eq!(rules[1].1.look.size, Some(14.0), "a key the file adds to an extension's rule");
        assert_eq!(rules[1].1.look.color.as_deref(), Some("amber"), "a key the file leaves keeps the extension's");
        let d = draw_for(&config, "power/battery", &entry, Kind::Menubar, &[]).unwrap();
        assert_eq!((d.item.hidden, d.item.color.as_deref(), d.item.urgent), (false, Some("muted"), false), "no rule holds: the render's own, the file's blue leaves muted alone");
        let d = draw_for(&config, "power/battery", &entry, Kind::Menubar, &["low".into()]).unwrap();
        assert_eq!((d.item.hidden, d.item.color.as_deref(), d.item.urgent, d.look.size), (false, Some("amber"), true, 14.0), "a rule's tint replaces the render's muted; its size rides on the look");
        let d = draw_for(&config, "power/battery", &entry, Kind::Menubar, &["low".into(), "critical".into()]).unwrap();
        assert_eq!((d.item.color.as_deref(), d.position.as_str(), d.item.urgent), (Some("red"), "q", true), "later wins on the tint; the position moves; urgent stays from the earlier rule");
        let d = draw_for(&config, "power/battery", &entry, Kind::Menubar, &["focus".into()]).unwrap();
        assert!(d.item.hidden, "a rule of the file's own hides");
        let (always, _) = pal_core::config::parse("[bar.items.\"power/battery\"]\nshow = \"always\"\n").unwrap();
        let d = draw_for(&always, "power/battery", &entry, Kind::Menubar, &["fine".into()]).unwrap();
        assert!(!d.item.hidden && d.item.color.as_deref() == Some("muted"), "a rule's hidden takes the empty shape under show = always, as the render's would");
    }

    #[test]
    fn show_always_keeps_the_empty_shape_muted() {
        let quiet: BarItem = serde_json::from_value(json!({ "hidden": true, "empty": { "icon": "\u{f09b}", "tooltip": "No unread mail", "menu": { "palette": "mail" } } })).unwrap();
        assert_eq!(serde_json::to_value(&quiet).unwrap()["empty"]["tooltip"], "No unread mail", "the shape rides the wire and the feed");
        assert_eq!(quiet.clone().kept(BarShow::Auto), quiet, "auto: hidden, the shape kept for a later flip");
        let kept = quiet.clone().kept(BarShow::Always);
        assert!(!kept.hidden && kept.empty.is_none());
        assert_eq!((kept.icon.as_ref(), kept.tooltip.as_deref(), kept.color.as_deref()), (Some(&json!("\u{f09b}")), Some("No unread mail"), Some("muted")), "the empty shape, muted");
        assert!(kept.has_menu() && kept.badge.is_none() && kept.segments.is_empty() && kept.title.is_none(), "no badge, no segments, no title unless the shape gives one");
        let bare: BarItem = serde_json::from_value(json!({ "hidden": true, "menu": { "palette": "mail" } })).unwrap();
        assert!(bare.clone().kept(BarShow::Always).hidden, "no shape to draw: hidden either way (signed out)");
        let loud: BarItem = serde_json::from_value(json!({ "icon": "\u{f09b}", "badge": 3, "empty": { "icon": "\u{f09b}" } })).unwrap();
        assert_eq!(loud.clone().kept(BarShow::Always), loud, "an item with something to say is itself");
        let reading: BarItem = serde_json::from_value(json!({ "hidden": true, "empty": { "icon": "\u{e30d}", "title": "12°" } })).unwrap();
        assert_eq!(reading.kept(BarShow::Always).title.as_deref(), Some("12°"), "a title the shape gives is drawn (weather's reading)");
        let framed: BarItem = serde_json::from_value(json!({ "hidden": true, "icon_size": 18, "icon_width": 31, "position": "q", "scroll": { "up": "u", "down": "d" }, "click": "open", "empty": { "icon": "\u{f057f}" } })).unwrap();
        let framed = framed.kept(BarShow::Always);
        assert_eq!((framed.icon_size, framed.icon_width, framed.position.as_deref()), (Some(18.0), Some(31.0), Some("q")), "the hidden item's frame stays (audio's glyph slot)");
        assert!(framed.scroll.is_none() && framed.click.is_none(), "its actions do not: nothing to act on");

        let (config, _) = pal_core::config::parse("[bar.items.\"x/y\"]\nshow = \"always\"\n[bar.items.\"x/z\"]\nbadge_style = \"dot\"\n").unwrap();
        let entry = Entry { manifest: ManifestBar::default(), last: Some(quiet.clone()), rendered_at: None, rendered_unix: None, stale: false, rendering: false, due_again: false, timer_gen: 0, fixture: false, held: false, instance: None };
        let d = draw_for(&config, "x/y", &entry, Kind::Menubar, &[]).unwrap();
        assert!(!d.item.hidden && d.item.muted(), "the config keeps it on the strip, dim");
        assert_eq!(d.tint(), Some("muted"));
        assert!(draw_for(&config, "x/z", &entry, Kind::Menubar, &[]).unwrap().item.hidden, "auto is the default: off the strip");
        let stale = Entry { stale: true, ..entry };
        assert!(draw_for(&config, "x/y", &stale, Kind::Menubar, &[]).unwrap().item.stale, "the registry's stale rides on the kept shape too");

        let mut labelled = quiet;
        labelled.label(Some("Work"));
        assert_eq!(labelled.empty.as_ref().unwrap().tooltip.as_deref(), Some("No unread mail (Work)"), "the instance's label reaches the empty tooltip");
        labelled.label(Some("Work"));
        assert_eq!(labelled.empty.as_ref().unwrap().tooltip.as_deref(), Some("No unread mail (Work)"), "and is not stacked on a re-registration");
    }
}
