//! What the config says about extensions by name (docs/design/distribution.md
//! "Missing and leftover references"): which extension a palette id, a bar
//! item, a state expression or a table belongs to ([`references`]), the
//! references to extensions that are not there ([`leftovers`]), and
//! dropping every one of them ([`ConfigFile::forget_extension`], "Remove
//! and forget" and Settings' Forget).

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use toml_edit::{Item, TableLike};

use crate::config::instance::{name_of, table_key};
use crate::config::{split_installed, Config, ConfigFile, Error};

/// The longest name in `known` that `id` is, or starts with followed by
/// `-` (a palette of it), `@` (an instance of it) or `/` (an item of it).
pub fn palette_owner<'a>(id: &str, known: &'a BTreeSet<String>) -> Option<&'a str> {
    known.iter().filter(|n| id == n.as_str() || id.strip_prefix(n.as_str()).is_some_and(|rest| rest.starts_with(['-', '@', '/']))).max_by_key(|n| n.len()).map(String::as_str)
}

/// Whether `expr` reads a state of `name` (`name.playing`): the name as a
/// whole word followed by a dot.
pub fn mentions(expr: &str, name: &str) -> bool {
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    expr.match_indices(name).any(|(i, _)| {
        let before = expr[..i].chars().next_back();
        let after = expr[i + name.len()..].chars().next();
        !before.is_some_and(word) && after == Some('.')
    })
}

/// The extension a palette id or a bar item key names: the longest known
/// name it starts with, else its first part (`weather-now`, `gmail@work/unread`).
fn owner(id: &str, known: &BTreeSet<String>) -> String {
    palette_owner(id, known).map_or_else(|| name_of(id.split(['-', '/']).next().unwrap_or(id)).to_string(), str::to_string)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    /// An `[extensions.<n>]`, `[instances.<n>*]` or plain `[palettes.<id>]` table.
    Config,
    Hotkey,
    Bar,
    Alias,
    State,
    Fallback,
    Sidebar,
}

/// One place in the config that names an extension; `what` is its dotted key.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Ref {
    pub kind: RefKind,
    pub what: String,
}

/// The references to one extension that is not there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LeftOver {
    pub name: String,
    pub refs: Vec<Ref>,
}

/// Every reference the config makes to an extension, with the extension's
/// name. `known` (every name the app or a registry knows) attributes palette
/// ids to the longest name they start with and finds names in `[states]`
/// expressions; a fallback that is no known extension's (`web`, `url`) is
/// the app's own.
pub fn references(config: &Config, known: &BTreeSet<String>) -> Vec<(String, Ref)> {
    let mut out = Vec::new();
    let mut add = |name: String, kind, what: String| out.push((name, Ref { kind, what }));
    for k in config.extensions.keys() {
        add(name_of(k).into(), RefKind::Config, table_key("extensions", k));
    }
    for k in config.instances.keys() {
        add(name_of(k).into(), RefKind::Config, table_key("instances", k));
    }
    for (id, p) in &config.palettes {
        let (name, key) = (owner(id, known), table_key("palettes", id));
        let specific = [(p.hotkey.is_some(), RefKind::Hotkey, "hotkey"), (p.hold.is_some(), RefKind::Hotkey, "hold"), (!p.item_hotkeys.is_empty(), RefKind::Hotkey, "item_hotkeys"), (p.alias.is_some(), RefKind::Alias, "alias")];
        let mut any = false;
        for (_, kind, field) in specific.into_iter().filter(|(on, ..)| *on) {
            add(name.clone(), kind, format!("{key}.{field}"));
            any = true;
        }
        if !any {
            add(name, RefKind::Config, key);
        }
    }
    for k in config.bar.items.keys() {
        add(owner(k.split('/').next().unwrap_or(k), known), RefKind::Bar, table_key("bar.items", k));
    }
    if let Some(p) = config.features.sidebar.palette() {
        add(name_of(p.split('/').next().unwrap_or(p)).into(), RefKind::Sidebar, "features.sidebar.palette".into());
    }
    for id in &config.general.fallbacks {
        if let Some(n) = palette_owner(id, known) {
            add(n.into(), RefKind::Fallback, "general.fallbacks".into());
        }
    }
    for (s, decl) in &config.states {
        let Some(expr) = &decl.expr else { continue };
        for n in known.iter().filter(|n| mentions(expr, n)) {
            add(n.clone(), RefKind::State, table_key("states", s));
        }
    }
    out
}

/// The references to extensions not in `present` (loaded, failed, turned
/// off, bundled, installed or waiting to be), by name.
pub fn leftovers(config: &Config, present: &BTreeSet<String>, known: &BTreeSet<String>) -> Vec<LeftOver> {
    let mut by: BTreeMap<String, BTreeSet<Ref>> = BTreeMap::new();
    for (name, r) in references(config, known) {
        if !present.contains(&name) {
            by.entry(name).or_default().insert(r);
        }
    }
    by.into_iter().map(|(name, refs)| LeftOver { name, refs: refs.into_iter().collect() }).collect()
}

/// What [`ConfigFile::forget_extension`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Forgotten {
    /// The dotted keys removed (a `[states.<s>]` that read the extension
    /// goes whole; `general.fallbacks` loses the entries of it).
    pub removed: Vec<String>,
    /// The `keychain:` references the removed settings held: the caller
    /// deletes those secrets.
    pub secrets: Vec<String>,
}

impl ConfigFile {
    /// Every reference to extension `name` out of the file, in one edit:
    /// `[extensions.<n>]` and `[instances.<n>*]` (each instance's too), its
    /// `[palettes.<id>]` and `[bar.items."<n>/*"]` tables, its fallbacks,
    /// the sidebar palette when it is one of its, the `[states]` whose
    /// expression reads it, and its `[store] installed` and `disabled`
    /// entries. `known` attributes palette ids as in [`references`].
    pub fn forget_extension(&self, name: &str, known: &BTreeSet<String>) -> Result<Forgotten, Error> {
        let mut known = known.clone();
        known.insert(name.to_string());
        let owns = |id: &str| owner(id, &known) == name;
        let config = self.load().config;
        let mut out = Forgotten::default();
        let mut secret = |v: &toml::Value| collect_secrets(v, &mut out.secrets);
        config.extensions.iter().filter(|(k, _)| name_of(k) == name).for_each(|(_, t)| t.values().for_each(&mut secret));
        config.palettes.iter().filter(|(id, _)| owns(id)).for_each(|(_, p)| p.settings.values().for_each(&mut secret));
        let removed = &mut out.removed;
        self.edit(|doc| {
            for section in ["extensions", "instances"] {
                drop_keys(doc.as_table_mut(), &[section], section, |k| name_of(k) == name, removed);
            }
            drop_keys(doc.as_table_mut(), &["palettes"], "palettes", |k| owns(k), removed);
            drop_keys(doc.as_table_mut(), &["bar", "items"], "bar.items", |k| owns(k.split('/').next().unwrap_or(k)), removed);
            drop_keys(doc.as_table_mut(), &["states"], "states", |k| config.states.get(k).and_then(|d| d.expr.as_deref()).is_some_and(|e| mentions(e, name)), removed);
            if let Some(list) = table_at(doc.as_table_mut(), &["general"]).and_then(|g| g.get_mut("fallbacks")).and_then(Item::as_array_mut) {
                let n = list.len();
                list.retain(|v| v.as_str().is_none_or(|id| palette_owner(id, &known) != Some(name)));
                if list.len() != n {
                    removed.push("general.fallbacks".into());
                }
            }
            if config.features.sidebar.palette().is_some_and(|p| name_of(p.split('/').next().unwrap_or(p)) == name) {
                if let Some(t) = table_at(doc.as_table_mut(), &["features", "sidebar"]) {
                    t.remove("palette");
                    removed.push("features.sidebar.palette".into());
                }
            }
            if let Some(store) = table_at(doc.as_table_mut(), &["store"]) {
                for (key, of) in [("installed", true), ("disabled", false)] {
                    if let Some(list) = store.get_mut(key).and_then(Item::as_array_mut) {
                        let n = list.len();
                        list.retain(|v| v.as_str().is_none_or(|s| (if of { split_installed(s).1 } else { s }) != name));
                        if list.len() != n {
                            removed.push(format!("store.{key}"));
                        }
                    }
                }
            }
            Ok(())
        })?;
        out.secrets.sort();
        out.secrets.dedup();
        Ok(out)
    }
}

fn table_at<'a>(mut t: &'a mut dyn TableLike, path: &[&str]) -> Option<&'a mut dyn TableLike> {
    for k in path {
        t = t.get_mut(k)?.as_table_like_mut()?;
    }
    Some(t)
}

/// Removes the keys of the table at `path` that `drop` picks, noting each as `<section>.<key>`.
fn drop_keys(root: &mut dyn TableLike, path: &[&str], section: &str, drop: impl Fn(&str) -> bool, removed: &mut Vec<String>) {
    let Some(t) = table_at(root, path) else { return };
    let keys: Vec<String> = t.iter().map(|(k, _)| k.to_string()).filter(|k| drop(k)).collect();
    for k in keys {
        t.remove(&k);
        removed.push(table_key(section, &k));
    }
}

fn collect_secrets(v: &toml::Value, out: &mut Vec<String>) {
    match v {
        toml::Value::String(s) if s.starts_with("keychain:") => out.push(s.clone()),
        toml::Value::Array(a) => a.iter().for_each(|v| collect_secrets(v, out)),
        toml::Value::Table(t) => t.values().for_each(|v| collect_secrets(v, out)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    const TEXT: &str = r#"
[general]
fallbacks = ["web", "weather-now", "calc"]

[extensions.weather]
token = "keychain:pal/weather-token"
units = "metric"

[extensions."weather@home"]
key = "keychain:pal/weather@home-key"

[instances."weather@home"]
title = "Home"

[palettes.weather]
hotkey = "alt+w"

[palettes.weather-now]
alias = "wn"

[palettes.window-management-left]
hotkey = "ctrl+l"

[palettes.gone-thing]
enabled = false

[bar.items."weather/now"]
order = 1

[bar.items."calc/x"]

[features.sidebar]
palette = "weather/now"

[states.outside]
expr = "weather.raining"

[states.work]
expr = "hour >= 9"

[store]
installed = ["weather", "acme:todo"]
disabled = ["weather"]
"#;

    #[test]
    fn leftovers_name_every_reference_to_what_is_not_there() {
        let (config, _) = crate::config::parse(TEXT).unwrap();
        let all = known(&["weather", "calc", "window", "window-management"]);
        let got = leftovers(&config, &known(&["calc", "window-management"]), &all);
        assert_eq!(got.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), ["gone", "weather"], "an unknown palette id is its first part's");
        let w = &got[1].refs;
        let has = |kind, what: &str| w.iter().any(|r| r.kind == kind && r.what == what);
        assert!(has(RefKind::Config, "extensions.weather") && has(RefKind::Config, "extensions.\"weather@home\"") && has(RefKind::Config, "instances.\"weather@home\""));
        assert!(has(RefKind::Hotkey, "palettes.weather.hotkey") && has(RefKind::Alias, "palettes.weather-now.alias"));
        assert!(has(RefKind::Bar, "bar.items.\"weather/now\"") && has(RefKind::Sidebar, "features.sidebar.palette"));
        assert!(has(RefKind::Fallback, "general.fallbacks") && has(RefKind::State, "states.outside"));
        assert!(!got.iter().any(|l| l.name == "web"), "the app's own fallback is no extension");
        assert!(leftovers(&config, &all, &all).iter().all(|l| l.name == "gone"));
    }

    #[test]
    fn forget_drops_every_reference_and_names_the_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let f = ConfigFile::new(dir.path().join("config.toml"));
        std::fs::write(f.path(), TEXT).unwrap();
        let out = f.forget_extension("weather", &known(&["calc", "window-management"])).unwrap();
        assert_eq!(out.secrets, ["keychain:pal/weather-token", "keychain:pal/weather@home-key"]);
        let (c, d) = crate::config::parse(&std::fs::read_to_string(f.path()).unwrap()).unwrap();
        assert!(d.is_empty(), "{d:?}");
        assert!(c.extensions.is_empty() && c.instances.is_empty());
        assert_eq!(c.palettes.keys().collect::<Vec<_>>(), ["gone-thing", "window-management-left"]);
        assert_eq!(c.bar.items.keys().collect::<Vec<_>>(), ["calc/x"]);
        assert_eq!(c.general.fallbacks, ["web", "calc"]);
        assert!(c.features.sidebar.palette().is_none());
        assert_eq!(c.states.keys().collect::<Vec<_>>(), ["work"]);
        assert_eq!((c.store.installed.as_slice(), c.store.disabled.is_empty()), (&["acme:todo".to_string()][..], true));
        assert!(out.removed.contains(&"store.installed".to_string()) && out.removed.contains(&"features.sidebar.palette".to_string()));
        assert_eq!(f.forget_extension("weather", &known(&[])).unwrap(), Forgotten::default(), "twice is nothing");
    }

    #[test]
    fn mentions_is_a_whole_word() {
        assert!(mentions("hue.on and x", "hue"));
        assert!(!mentions("bighue.on", "hue"));
        assert!(!mentions("hue_x.on", "hue"));
        assert!(!mentions("hue and x", "hue"));
    }
}
