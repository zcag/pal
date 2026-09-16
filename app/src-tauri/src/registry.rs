//! What the host said about every palette, with the config file's say on
//! top: the meta as reported (`PaletteMeta`), whether `palettes.<id>` has
//! it enabled, which filter's rows the bucket holds, and whether its cached
//! listing is waiting for the refresh pass. `crate::index` drives the
//! listings and the commands; this is the table they consult. The palette
//! rows at the root (`pal/palettes`) are built from it too.

use std::collections::HashMap;
use std::sync::Mutex;

use pal_core::config::Config;
use pal_core::index::{Item, Source, Tier};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{commands, lock, welcome};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
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
    /// The tier the root ranks it by: the config's `tier` over the meta's,
    /// `normal` when neither says. Kept current by `apply_config`.
    pub tier: Tier,
}

impl Registered {
    pub fn new(source: Source, meta: PaletteMeta, ext_title: String, config: &Config) -> Self {
        let p = config.palette(&palette_id(&source));
        let tier = p.tier.or(meta.tier).unwrap_or_default();
        Self { source, meta, ext_title, enabled: p.enabled, filter: None, filtered: HashMap::new(), deferred: false, tier }
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
/// `<extension>-<palette>` (`clipboard-history`). Readable in the file and
/// needs no quoting; the registry resolves it back, so a clash between a
/// hyphenated extension name and a palette is the one case it cannot tell
/// apart.
pub fn palette_id(source: &Source) -> String {
    if source.extension == source.palette {
        source.extension.clone()
    } else {
        format!("{}-{}", source.extension, source.palette)
    }
}

/// Every palette the host reported, enabled or not, with its config id.
pub fn registered_palettes(app: &AppHandle) -> Vec<(String, Source)> {
    Palettes::with(app, |reg| reg.iter().map(|r| (palette_id(&r.source), r.source.clone())).collect())
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
        _ => return None,
    };
    Some(PaletteMeta { name: source.palette.clone(), title: title.into(), ..Default::default() })
}

/// The palette's row at the root: the title, the extension's title as
/// subtitle (left out when they are the same), the name and extension as
/// keywords plus the config's `alias`, and the config's `icon` over the
/// palette's own.
pub fn palette_row(r: &Registered, config: &Config) -> Item {
    let m = &r.meta;
    let mut keywords = vec![m.name.clone()];
    if r.source.extension != m.name {
        keywords.push(r.source.extension.clone());
    }
    let p = config.palette(&palette_id(&r.source));
    if let Some(alias) = p.alias.as_deref().map(str::trim).filter(|a| !a.is_empty()) {
        keywords.push(alias.to_string());
    }
    Item {
        id: format!("{}/{}", r.source.extension, r.source.palette),
        name: m.title.clone(),
        subtitle: Some(r.ext_title.clone()).filter(|t| t != &m.title),
        keywords,
        icon: p.icon.clone().or_else(|| m.icon.clone()).map(Value::String),
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
        m.icon = Some("x".into());
        let r = Registered::new(Source::new("clipboard", "history"), m, "Clipboard".into(), &c);
        let row = palette_row(&r, &c);
        assert_eq!(row.id, "clipboard/history");
        assert_eq!(row.name, "Clipboard History");
        assert_eq!(row.subtitle.as_deref(), Some("Clipboard"));
        assert_eq!(row.keywords, ["history", "clipboard", "cb"], "name, extension, trimmed alias");
        assert_eq!(row.icon, Some(json!("\u{f0a0}")), "the config's icon wins");

        let c = Config::default();
        let r = Registered::new(Source::new("windows", "windows"), meta("windows", "Windows"), "Windows".into(), &c);
        let row = palette_row(&r, &c);
        assert_eq!(row.subtitle, None, "no subtitle when it repeats the title");
        assert_eq!(row.keywords, ["windows"], "no extension keyword when it is the name");
        assert_eq!(row.icon, None);
        assert!(r.enabled, "enabled unless the file says otherwise");
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
