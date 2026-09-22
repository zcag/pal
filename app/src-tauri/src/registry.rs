//! What the host said about every palette, with the config file's say on
//! top: the meta as reported (`PaletteMeta`), whether `palettes.<id>` has
//! it enabled, which filter's rows the bucket holds, and whether its cached
//! listing is waiting for the refresh pass. `crate::index` drives the
//! listings and the commands; this is the table they consult. The palette
//! rows at the root (`pal/palettes`) are built from it too.

use std::collections::HashMap;
use std::sync::Mutex;

use pal_core::config::{instance, Config};
use pal_core::index::{Item, Source, Tier};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{commands, lock, welcome};

/// `PaletteMeta.lazy`: `true` on the wire is [`Lazy::Show`], `"visit"` is
/// [`Lazy::Visit`], absent or `false` is [`Lazy::No`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Lazy {
    #[default]
    No,
    Show,
    Visit,
}

impl Lazy {
    pub fn is_no(&self) -> bool {
        *self == Lazy::No
    }
}

impl Serialize for Lazy {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Lazy::No => s.serialize_bool(false),
            Lazy::Show => s.serialize_bool(true),
            Lazy::Visit => s.serialize_str("visit"),
        }
    }
}

impl<'de> Deserialize<'de> for Lazy {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Bool(bool),
            Str(String),
        }
        match Raw::deserialize(d)? {
            Raw::Bool(false) => Ok(Lazy::No),
            Raw::Bool(true) => Ok(Lazy::Show),
            Raw::Str(s) if s == "visit" => Ok(Lazy::Visit),
            Raw::Str(s) if s == "show" => Ok(Lazy::Show),
            Raw::Str(s) => Err(serde::de::Error::custom(format!("lazy: expected true, false or \"visit\", got {s:?}"))),
        }
    }
}

/// A palette as the host describes it (`PaletteMeta` in sdk/src/protocol.ts).
/// The optional fields ride to the UI untouched through `SourceView`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct PaletteMeta {
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub live: bool,
    #[serde(default)]
    pub input: bool,
    /// A glyph, emoji or hex as a string, or `{ tile }` / `{ glyph, color }`
    /// (sdk/src/icon.ts); opaque here, the UI's `iconOf` reads it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub columns: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// Open with the detail pane showing.
    #[serde(default, rename = "showDetail", skip_serializing_if = "std::ops::Not::not")]
    pub show_detail: bool,
    /// `"lazy"`: the palette answers `detail(id)`; the UI asks per item.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// `[{ id, title }]`, first the default; opaque here, the UI's dropdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filters: Option<Value>,
    /// The actions of every row that carries none (`Action[]`); opaque
    /// here, the UI merges them per row. Sent once per palette instead of
    /// once per item, so a catalog's listing is not half action titles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actions: Option<Value>,
    /// Seconds a listing stays good for: a cached one younger than this is
    /// not listed again on load. Absent: listed again on every load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl: Option<f64>,
    /// The palette's tier at the root as the manifest or the code says;
    /// `[palettes.<id>] tier` overrides it (`Registered::tier`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<Tier>,
    /// Lists inline at the root for queries its `match` accepts; the host
    /// does the matching (`inline` request), this only says who takes part.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inline: bool,
    /// The regex source behind `inline`, for the store; absent for a predicate.
    #[serde(default, rename = "match", skip_serializing_if = "Option::is_none")]
    pub match_: Option<String>,
    /// `ask`: the root offers an "Ask <title>" row when nothing matched
    /// (`crate::fallback`); `rows`: the palette answers `fallback(query)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
    /// The ask row's title with `{query}` in it, when the palette names one.
    #[serde(default, rename = "fallbackTitle", skip_serializing_if = "Option::is_none")]
    pub fallback_title: Option<String>,
    /// Extra words the palette's row at the root answers to (the
    /// manifest's `keywords`, the extension's and the palette's own):
    /// `gh` for GitHub, `ha` for Home Assistant.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keywords: Vec<String>,
    /// Answers `suggest()` for the empty root's "Now" section (the UI asks the host).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub suggest: bool,
    /// Tab (and a bare `x` with nothing typed) marks rows in it (`Palette.multi`); opaque here, the UI's.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub multi: bool,
    /// When the first listing of a run runs: at process start (`No`), at
    /// the first panel show (`Show`: a network palette), or the first time
    /// the user is inside the palette (`Visit`: a listing that prompts,
    /// 1Password's `op` authorising pal per app). The cached rows restore
    /// at startup either way, and from that listing on `ttl` and `live`
    /// apply as usual (`index::load_plan`).
    #[serde(default, skip_serializing_if = "Lazy::is_no")]
    pub lazy: Lazy,
    /// A view palette: seconds between re-asks of `view(ctx)` while its
    /// level is open; the page runs the timer (views.rs, Launcher.tsx).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<f64>,
    /// A view palette: the triggers that re-ask it while open (`media`,
    /// `wake`, `network`, `show`); opaque here, the page matches them
    /// against `pal://trigger`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<Vec<String>>,
    /// The switcher chord the manifest suggests (`alt+tab` for Windows);
    /// `palettes.<id>.hold` in the config wins, `""` there turns it off
    /// (`hotkey::apply`, switcher.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold: Option<String>,
}

impl PaletteMeta {
    /// Whether a listing taken at `listed_at` is still within `ttl`.
    /// Without a `ttl` nothing is.
    pub fn fresh(&self, listed_at: Option<u64>, now: u64) -> bool {
        match (self.ttl, listed_at) {
            (Some(ttl), Some(at)) => (now.saturating_sub(at) as f64) <= ttl,
            _ => false,
        }
    }

    /// The filter a plain list runs with: the first declared one.
    pub fn default_filter(&self) -> Option<String> {
        self.filters.as_ref()?.get(0)?.get("id")?.as_str().map(str::to_string)
    }

    /// Listed again on every show.
    pub fn relists_on_show(&self) -> bool {
        self.live && !self.input
    }
}

/// One palette's entry.
#[derive(Debug, Clone)]
pub struct Registered {
    pub source: Source,
    pub meta: PaletteMeta,
    /// The extension's title (its manifest), the palette row's subtitle.
    pub ext_title: String,
    /// `palettes.<id>.enabled` as last applied; off means no items, no row.
    pub enabled: bool,
    /// The filter whose rows are in the bucket now (`None`: no filters).
    pub filter: Option<String>,
    /// Each filter's rows as last listed, dropped when the palette lists again.
    pub filtered: HashMap<String, Vec<Item>>,
    /// Its cached listing is past its `ttl`: waiting for `refresh_expired`.
    pub deferred: bool,
    /// A `lazy` palette not listed this run yet: waiting for the first
    /// panel show (`index::on_shown`) or, `lazy: "visit"`, for the user
    /// to come inside it (`index::on_visit`).
    pub awaits_show: bool,
    /// The tier the root ranks it by: the config's `tier` over the meta's,
    /// `normal` when neither says. Kept current by `apply_config`.
    pub tier: Tier,
}

impl Registered {
    pub fn new(source: Source, meta: PaletteMeta, ext_title: String, config: &Config) -> Self {
        let p = config.palette(&palette_id(&source));
        let tier = p.tier.or(meta.tier).unwrap_or_default();
        Self { source, meta, ext_title, enabled: p.enabled, filter: None, filtered: HashMap::new(), deferred: false, awaits_show: false, tier }
    }
}

/// Metas by source, in load order. The index holds the items and the
/// `live` flag; this is the rest of what the host said about a palette.
#[derive(Default)]
pub struct Palettes(Mutex<Vec<Registered>>);

impl Palettes {
    /// Runs `f` with the registry locked; never held across an await, and
    /// never together with the index lock (`index::with_index`) except
    /// index-inside-registry in `sources`.
    pub fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Vec<Registered>) -> T) -> T {
        let st = app.state::<Palettes>();
        let mut reg = lock(&st.0);
        f(&mut reg)
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Registered>> {
        lock(&self.0)
    }

    /// Whether picks from this source are not worth remembering.
    pub fn is_transient(&self, source: &Source) -> bool {
        self.lock().iter().any(|r| &r.source == source && (r.meta.live || r.meta.input))
    }
}

/// The palette's key in the config file, `palettes.<id>`: the extension's
/// name when the palette is named like it (`emoji`, `apps`), else
/// `<extension>-<palette>` (`clipboard-history`); for an instance the key
/// takes the name's place (`gmail@work`, `gmail@work-inbox`), the
/// comparison being against the extension's *name*
/// (`pal_core::config::instance::palette_id`).
pub fn palette_id(source: &Source) -> String {
    instance::palette_id(&source.extension, &source.palette)
}

/// Every palette the host reported, enabled or not, with its config id.
pub fn registered_palettes(app: &AppHandle) -> Vec<(String, Source)> {
    Palettes::with(app, |reg| reg.iter().map(|r| (palette_id(&r.source), r.source.clone())).collect())
}

/// The same with the switcher chord each manifest suggests (`PaletteMeta::hold`).
pub fn registered_holds(app: &AppHandle) -> Vec<(String, Source, Option<String>)> {
    Palettes::with(app, |reg| reg.iter().map(|r| (palette_id(&r.source), r.source.clone(), r.meta.hold.clone())).collect())
}

/// The source whose items are the palettes; its ids are `extension/palette`.
pub fn palettes_source() -> Source {
    Source::new("pal", "palettes")
}

/// The meta of a synthetic source (`pal/*`), which no extension reported.
pub fn synthetic_meta(source: &Source) -> Option<PaletteMeta> {
    let title = match source {
        s if *s == palettes_source() => "Palettes",
        s if *s == welcome::source() => "Welcome",
        s if *s == commands::source() => "pal",
        s if *s == crate::fallback::source() => "Fallback",
        _ => return None,
    };
    Some(PaletteMeta { name: source.palette.clone(), title: title.into(), ..Default::default() })
}

/// Every word the palette answers to besides its title: its own name,
/// its extension's, an instance's suffix (`work` for `gmail@work`, so
/// `work inbox` finds it), the config's `alias` and the manifest's
/// keywords, each once.
pub fn palette_keywords(r: &Registered, config: &Config) -> Vec<String> {
    let m = &r.meta;
    let mut keywords = vec![m.name.clone()];
    if r.source.extension != m.name {
        keywords.push(r.source.extension.clone());
    }
    if let (_, Some(suffix)) = instance::split(&r.source.extension) {
        keywords.push(suffix.to_string());
    }
    if let Some(alias) = config.palette(&palette_id(&r.source)).alias.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        keywords.push(alias.to_string());
    }
    for k in &m.keywords {
        if !keywords.contains(k) {
            keywords.push(k.clone());
        }
    }
    keywords
}

/// The source's path for the index (`Index::set_path`): the titles a
/// section header shows and every word the palette is reached by, so a
/// query can name the palette and the row at once (`tod address`). One
/// string, since the index only ever asks whether a typed word starts a
/// word of it.
pub fn palette_path(r: &Registered, config: &Config) -> String {
    let mut words = vec![r.ext_title.clone()];
    if r.meta.title != r.ext_title {
        words.push(r.meta.title.clone());
    }
    for k in palette_keywords(r, config) {
        if !words.iter().any(|w| w.eq_ignore_ascii_case(&k)) {
            words.push(k);
        }
    }
    words.join(" ")
}

/// The palette's row at the root: the title, the extension's title as
/// subtitle (left out when they are the same), [`palette_keywords`] as
/// its keywords, and the config's `icon` over the palette's own.
pub fn palette_row(r: &Registered, config: &Config) -> Item {
    let m = &r.meta;
    let keywords = palette_keywords(r, config);
    let p = config.palette(&palette_id(&r.source));
    Item {
        id: format!("{}/{}", r.source.extension, r.source.palette),
        name: m.title.clone(),
        subtitle: Some(r.ext_title.clone()).filter(|t| t != &m.title),
        keywords,
        icon: p.icon.clone().map(Value::String).or_else(|| m.icon.clone()),
        section: None,
        extra: serde_json::Map::default(),
    }
}

/// The rows of `pal/palettes`: every enabled palette, in load order.
pub fn palette_rows(reg: &[Registered], config: &Config) -> Vec<Item> {
    reg.iter().filter(|r| r.enabled).map(|r| palette_row(r, config)).collect()
}

/// Replace the extension's entries with what it reported now. An entry
/// that was there keeps its filter state, so a palette whose cached
/// listing stands (`ttl`) does not list again on the next filter swap.
pub fn replace_extension(reg: &mut Vec<Registered>, ext: &str, ext_title: &str, metas: &[PaletteMeta], config: &Config) {
    let old: Vec<Registered> = reg.iter().filter(|r| r.source.extension == ext).cloned().collect();
    reg.retain(|r| r.source.extension != ext);
    reg.extend(metas.iter().map(|m| {
        let mut r = Registered::new(Source::new(ext, &m.name), m.clone(), ext_title.to_string(), config);
        if let Some(o) = old.iter().find(|o| o.source == r.source) {
            r.filter.clone_from(&o.filter);
            r.filtered.clone_from(&o.filtered);
        }
        r
    }));
}

/// Apply `next`'s `enabled` flags (and its `tier` overrides, which take
/// effect on the next query): the sources switched off and the ones
/// switched on (with their meta, to list them).
pub fn toggle_enabled(reg: &mut [Registered], next: &Config) -> (Vec<Source>, Vec<(Source, PaletteMeta)>) {
    let (mut off, mut on) = (Vec::new(), Vec::new());
    for r in reg.iter_mut() {
        let p = next.palette(&palette_id(&r.source));
        r.tier = p.tier.or(r.meta.tier).unwrap_or_default();
        let wanted = p.enabled;
        if wanted == r.enabled {
            continue;
        }
        r.enabled = wanted;
        if wanted {
            on.push((r.source.clone(), r.meta.clone()));
        } else {
            off.push(r.source.clone());
        }
    }
    (off, on)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pal_core::config::Palette;
    use serde_json::json;

    fn meta(name: &str, title: &str) -> PaletteMeta {
        PaletteMeta { name: name.into(), title: title.into(), ..Default::default() }
    }

    fn config(overrides: &[(&str, Palette)]) -> Config {
        let mut c = Config::default();
        for (id, p) in overrides {
            c.palettes.insert((*id).into(), p.clone());
        }
        c
    }

    fn palette(enabled: bool, alias: Option<&str>, icon: Option<&str>) -> Palette {
        Palette { enabled, alias: alias.map(Into::into), icon: icon.map(Into::into), ..Default::default() }
    }

    #[test]
    fn ids_read_back_from_the_file() {
        assert_eq!(palette_id(&Source::new("emoji", "emoji")), "emoji");
        assert_eq!(palette_id(&Source::new("clipboard", "history")), "clipboard-history");
    }

    #[test]
    fn palette_id_of_an_instance() {
        assert_eq!(palette_id(&Source::new("gmail@work", "gmail")), "gmail@work", "named like the extension's name: the key");
        assert_eq!(palette_id(&Source::new("gmail@work", "inbox")), "gmail@work-inbox");
        let c = config(&[("gmail@work-inbox", palette(false, Some("wi"), None))]);
        let r = Registered::new(Source::new("gmail@work", "inbox"), meta("inbox", "Inbox (Work)"), "Gmail".into(), &c);
        assert!(!r.enabled, "[palettes.\"gmail@work-inbox\"] is the instance's palette");
        let row = palette_row(&r, &c);
        assert_eq!(row.id, "gmail@work/inbox");
        assert_eq!(row.keywords, ["inbox", "gmail@work", "work", "wi"], "name, key, the instance's suffix, alias");
        assert_eq!(row.subtitle.as_deref(), Some("Gmail"), "the subtitle stays the extension's title");
    }

    #[test]
    fn meta_freshness_filters_and_relist() {
        let mut m = meta("p", "P");
        assert!(!m.fresh(Some(10), 20), "no ttl: never fresh");
        m.ttl = Some(60.0);
        assert!(m.fresh(Some(1000), 1060));
        assert!(!m.fresh(Some(1000), 1061));
        assert!(m.fresh(Some(2000), 1000), "a clock that went back still counts as fresh");
        assert!(!m.fresh(None, 1000), "never listed: not fresh");
        assert_eq!(m.default_filter(), None);
        m.filters = Some(json!([{ "id": "open", "title": "Open" }, { "id": "all" }]));
        assert_eq!(m.default_filter().as_deref(), Some("open"));
        m.filters = Some(json!([]));
        assert_eq!(m.default_filter(), None);
        assert!(!m.relists_on_show());
        m.live = true;
        assert!(m.relists_on_show());
        m.input = true;
        assert!(!m.relists_on_show(), "an input palette lists per keystroke instead");
    }

    #[test]
    fn palette_row_from_meta_and_config() {
        let c = config(&[("clipboard-history", palette(true, Some("  cb "), Some("\u{f0a0}")))]);
        let mut m = meta("history", "Clipboard History");
        m.icon = Some(json!({ "tile": { "glyph": "x", "bg": "violet" } }));
        let r = Registered::new(Source::new("clipboard", "history"), m, "Clipboard".into(), &c);
        let row = palette_row(&r, &c);
        assert_eq!(row.id, "clipboard/history");
        assert_eq!(row.name, "Clipboard History");
        assert_eq!(row.subtitle.as_deref(), Some("Clipboard"));
        assert_eq!(row.keywords, ["history", "clipboard", "cb"], "name, extension, trimmed alias");
        let mut m = r.meta.clone();
        m.keywords = vec!["clip".into(), "cb".into()];
        let r = Registered::new(Source::new("clipboard", "history"), m, "Clipboard".into(), &c);
        assert_eq!(palette_row(&r, &c).keywords, ["history", "clipboard", "cb", "clip"], "the manifest's keywords after, once each");
        assert_eq!(row.icon, Some(json!("\u{f0a0}")), "the config's icon wins");
        let r = Registered::new(Source::new("clipboard", "history"), r.meta.clone(), "Clipboard".into(), &Config::default());
        assert_eq!(palette_row(&r, &Config::default()).icon, Some(json!({ "tile": { "glyph": "x", "bg": "violet" } })), "the meta's tile rides through whole");

        let c = Config::default();
        let r = Registered::new(Source::new("windows", "windows"), meta("windows", "Windows"), "Windows".into(), &c);
        let row = palette_row(&r, &c);
        assert_eq!(row.subtitle, None, "no subtitle when it repeats the title");
        assert_eq!(row.keywords, ["windows"], "no extension keyword when it is the name");
        assert_eq!(row.icon, None);
        assert!(r.enabled, "enabled unless the file says otherwise");
    }

    #[test]
    fn palette_path_is_both_titles_and_every_word_the_palette_answers_to() {
        let c = config(&[("clipboard-history", palette(true, Some("  cb "), None))]);
        let mut m = meta("history", "Clipboard History");
        m.keywords = vec!["clip".into()];
        let r = Registered::new(Source::new("clipboard", "history"), m, "Clipboard".into(), &c);
        assert_eq!(palette_path(&r, &c), "Clipboard Clipboard History history cb clip", "the extension's title, the palette's, then its keywords");
        let c = Config::default();
        let r = Registered::new(Source::new("windows", "windows"), meta("windows", "Windows"), "Windows".into(), &c);
        assert_eq!(palette_path(&r, &c), "Windows", "a title said three times is said once");
    }

    #[test]
    fn palette_rows_skip_disabled() {
        let c = config(&[("b", palette(false, None, None))]);
        let reg = vec![
            Registered::new(Source::new("a", "a"), meta("a", "A"), "A".into(), &c),
            Registered::new(Source::new("b", "b"), meta("b", "B"), "B".into(), &c),
        ];
        assert_eq!(palette_rows(&reg, &c).iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["a/a"]);
    }

    #[test]
    fn toggle_enabled_diffs_against_the_new_config() {
        let c = config(&[("b", palette(false, None, None))]);
        let mut reg = vec![
            Registered::new(Source::new("a", "a"), meta("a", "A"), "A".into(), &c),
            Registered::new(Source::new("b", "b"), meta("b", "B"), "B".into(), &c),
            Registered::new(Source::new("c", "c"), meta("c", "C"), "C".into(), &c),
        ];
        let next = config(&[("a", palette(false, None, None))]);
        let (off, on) = toggle_enabled(&mut reg, &next);
        assert_eq!(off, [Source::new("a", "a")]);
        assert_eq!(on.iter().map(|(s, m)| (s.palette.as_str(), m.title.as_str())).collect::<Vec<_>>(), [("b", "B")]);
        assert_eq!(reg.iter().map(|r| r.enabled).collect::<Vec<_>>(), [false, true, true]);
        let (off, on) = toggle_enabled(&mut reg, &next);
        assert!(off.is_empty() && on.is_empty(), "the same config again changes nothing");
    }

    #[test]
    fn tier_from_the_manifest_then_the_config() {
        let c = Config::default();
        let plain = Registered::new(Source::new("docker", "docker"), meta("docker", "Docker"), "Docker".into(), &c);
        assert_eq!(plain.tier, Tier::Normal, "neither says: normal");
        // The meta carries what the host merged from pal.json and the code.
        let m: PaletteMeta = serde_json::from_value(json!({ "name": "emoji", "title": "Emoji", "live": true, "input": false, "tier": "catalog" })).unwrap();
        assert_eq!(m.tier, Some(Tier::Catalog));
        let emoji = Registered::new(Source::new("emoji", "emoji"), m.clone(), "Emoji".into(), &c);
        assert_eq!(emoji.tier, Tier::Catalog);
        assert_eq!(serde_json::to_value(&m).unwrap()["tier"], "catalog", "and rides to the UI");
        // `[palettes.emoji] tier = "primary"` wins, and a config change re-resolves it.
        let c = config(&[("emoji", Palette { tier: Some(Tier::Primary), ..Default::default() })]);
        assert_eq!(Registered::new(Source::new("emoji", "emoji"), m.clone(), "Emoji".into(), &c).tier, Tier::Primary);
        let mut reg = vec![emoji];
        toggle_enabled(&mut reg, &c);
        assert_eq!(reg[0].tier, Tier::Primary);
        toggle_enabled(&mut reg, &Config::default());
        assert_eq!(reg[0].tier, Tier::Catalog, "unset again: back to the manifest's");
        // The file spells it as the manifest does.
        let c: Config = toml::from_str("[palettes.emoji]\ntier = \"catalog\"\n[general]\nroot_caps = { primary = 5, catalog = 2 }\n").unwrap();
        assert_eq!(c.palette("emoji").tier, Some(Tier::Catalog));
        assert_eq!(c.general.root_caps, pal_core::index::Caps { primary: 5, normal: 6, catalog: 2 });
    }

    #[test]
    fn replace_extension_keeps_filter_state_and_drops_the_rest() {
        let c = Config::default();
        let mut reg = vec![
            Registered::new(Source::new("x", "one"), meta("one", "One"), "X".into(), &c),
            Registered::new(Source::new("x", "two"), meta("two", "Two"), "X".into(), &c),
            Registered::new(Source::new("y", "y"), meta("y", "Y"), "Y".into(), &c),
        ];
        reg[0].filter = Some("open".into());
        reg[0].filtered.insert("open".into(), Vec::new());
        reg[0].deferred = true;
        let mut renamed = meta("one", "One again");
        renamed.ttl = Some(5.0);
        replace_extension(&mut reg, "x", "X2", &[renamed, meta("three", "Three")], &c);
        let names: Vec<&str> = reg.iter().map(|r| r.source.palette.as_str()).collect();
        assert_eq!(names, ["y", "one", "three"], "the extension's entries go last, `two` is gone");
        let one = &reg[1];
        assert_eq!(one.meta.title, "One again");
        assert_eq!(one.ext_title, "X2");
        assert_eq!(one.filter.as_deref(), Some("open"), "filter state survives a reload");
        assert!(one.filtered.contains_key("open"));
        assert!(!one.deferred, "deferral is decided again after a reload");
        assert!(reg[2].filter.is_none());
    }
}
