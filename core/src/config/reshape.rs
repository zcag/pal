//! The one-time move of a config written before features existed
//! (`docs/design/model.md`, "Config"): the settings of what became a
//! feature leave `[extensions.<name>]`, `[general]` and `[sidebar]` for
//! `[features.<id>]`, keeping their comments. [`plan`] is the pure half;
//! the app runs [`ConfigFile::reshape`] once at startup, which keeps the
//! file as it was next to it.

use toml_edit::{DocumentMut, Item, Table};

use super::{ConfigFile, Error};

/// Where the file as it was goes, next to the config.
pub const BACKUP: &str = "config.pre-features.toml";

/// Whole extension tables that became a feature's: `[extensions.<from>]` to `[features.<to>]`.
const WHOLE: &[(&str, &str)] = &[("mouse", "mouse"), ("keycast", "keycast")];
/// Single keys: `[extensions.<ext>] <key>` to `[features.<feature>] <new>`.
const KEYS: &[(&str, &str, &str, &str)] = &[
    ("clipboard", "exclude_apps", "clipboard", "exclude_apps"),
    ("clipboard", "max_entries", "clipboard", "max_entries"),
    ("clipboard", "max_age_days", "clipboard", "max_age_days"),
    ("snippets", "expand", "expansion", "enabled"),
    ("snippets", "expand_prefix", "expansion", "prefix"),
    ("snippets", "expand_exclude_apps", "expansion", "exclude_apps"),
    ("snippets", "expand_hud", "expansion", "hud"),
    ("window-management", "keep_below_bar", "reserve", "enabled"),
    ("window-management", "bar_height", "reserve", "bar_height"),
];
/// Extension settings that became a bar item's own (`bar.<id>.settings`):
/// `[extensions.<ext>] <key>` to `[bar.items."<ext>/<item>".settings] <new>`,
/// for the default instance and every `<ext>@<suffix>` table alike.
const ITEM_KEYS: &[(&str, &str, &str, &str)] = &[
    ("audio", "level", "volume", "level"),
    ("bluetooth", "low_threshold", "battery", "low_threshold"),
    ("calendar", "near_minutes", "upcoming", "near_minutes"),
    ("calendar", "warn_minutes", "upcoming", "warn_minutes"),
    ("calendar", "urgent_minutes", "upcoming", "urgent_minutes"),
    ("displays", "bar_display", "brightness", "display"),
    ("github", "review_requests", "prs", "review_requests"),
    ("hue", "main_room", "home", "main_room"),
    ("hue", "bar_scenes", "home", "scenes"),
    ("media", "bar_artwork", "now-playing", "artwork"),
    ("odak", "today_sections", "today", "today_sections"),
    ("slack", "refresh", "unreads", "refresh"),
    ("spotify", "bar_lyrics", "playing", "lyrics"),
    ("stats", "cpu_label", "cpu", "label"),
    ("stats", "memory_label", "memory", "label"),
    ("stats", "disk_label", "disk", "label"),
    ("stats", "network_label", "network", "label"),
    ("stats", "load_label", "load", "label"),
    ("system", "awake_presets", "awake", "presets"),
];
/// Palettes that are gone: their `[palettes.<id>]` tables go too.
const GONE_PALETTES: &[&str] = &["mouse", "keycast"];

/// The feature's table, created (as a `[features.<id>]` header) when missing.
fn feature<'a>(doc: &'a mut DocumentMut, id: &str) -> &'a mut Table {
    let features = doc.entry("features").or_insert_with(|| {
        let mut t = Table::new();
        t.set_implicit(true);
        Item::Table(t)
    });
    let features = features.as_table_mut().expect("features is a table");
    features.entry(id).or_insert_with(|| Item::Table(Table::new())).as_table_mut().expect("a feature is a table")
}

/// Move one key, keeping its comment; a key already set on the feature wins.
fn move_key(doc: &mut DocumentMut, from: &[&str], key: &str, id: &str, to: &str, notes: &mut Vec<String>) {
    let mut at = doc.as_table_mut() as &mut Table;
    for part in from {
        match at.get_mut(part).and_then(Item::as_table_mut) {
            Some(t) => at = t,
            None => return,
        }
    }
    let Some((k, item)) = at.remove_entry(key) else { return };
    let dest = feature(doc, id);
    if dest.contains_key(to) {
        notes.push(format!("{}.{key}\tdropped: features.{id}.{to} is set", from.join(".")));
        return;
    }
    let mut k = k;
    if to != key {
        k = toml_edit::Key::new(to).with_leaf_decor(k.leaf_decor().clone());
    }
    dest.insert_formatted(&k, item);
    notes.push(format!("{}.{key}\tfeatures.{id}.{to}", from.join(".")));
}

/// Move `[extensions.<table>] <key>` to `[bar.items."<item>".settings] <to>`, keeping its comment; a key already set there wins.
fn move_item_key(doc: &mut DocumentMut, table: &str, key: &str, item: &str, to: &str, notes: &mut Vec<String>) {
    let Some((k, value)) = doc.get_mut("extensions").and_then(Item::as_table_mut).and_then(|e| e.get_mut(table)).and_then(Item::as_table_mut).and_then(|t| t.remove_entry(key)) else { return };
    let implicit = |t: &mut Table| { t.set_implicit(true); };
    let bar = doc.entry("bar").or_insert_with(|| { let mut t = Table::new(); implicit(&mut t); Item::Table(t) }).as_table_mut().expect("bar is a table");
    let items = bar.entry("items").or_insert_with(|| { let mut t = Table::new(); implicit(&mut t); Item::Table(t) }).as_table_mut().expect("bar.items is a table");
    let entry = items.entry(item).or_insert_with(|| Item::Table(Table::new())).as_table_mut().expect("a bar item is a table");
    let settings = entry.entry("settings").or_insert_with(|| { let mut t = Table::new(); implicit(&mut t); Item::Table(t) }).as_table_mut().expect("settings is a table");
    let from = format!("extensions.{table}.{key}");
    if settings.contains_key(to) {
        return notes.push(format!("{from}\tdropped: bar.items.\"{item}\".settings.{to} is set"));
    }
    settings.insert_formatted(&toml_edit::Key::new(to).with_leaf_decor(k.leaf_decor().clone()), value);
    notes.push(format!("{from}\tbar.items.\"{item}\".settings.{to}"));
}

/// Drop `[<parent>.<name>]` when nothing is left in it.
fn drop_empty(doc: &mut DocumentMut, parent: &str, name: &str) {
    if let Some(p) = doc.get_mut(parent).and_then(Item::as_table_mut) {
        if p.get(name).and_then(Item::as_table).is_some_and(Table::is_empty) {
            p.remove(name);
        }
    }
}

/// The file's text reshaped, and one note per move; `None` when there was nothing to move.
pub fn plan(text: &str) -> Result<Option<(String, Vec<String>)>, toml_edit::TomlError> {
    let mut doc: DocumentMut = text.parse()?;
    let mut notes = Vec::new();
    for (from, to) in WHOLE {
        let Some(t) = doc.get_mut("extensions").and_then(Item::as_table_mut).and_then(|e| e.remove(from)) else { continue };
        let Item::Table(t) = t else { continue };
        let keys: Vec<String> = t.iter().map(|(k, _)| k.to_string()).collect();
        let dest = feature(&mut doc, to);
        for (k, v) in t.into_iter() {
            if !dest.contains_key(&k) {
                dest.insert(&k, v);
            }
        }
        notes.push(format!("extensions.{from}\tfeatures.{to} ({})", keys.join(", ")));
    }
    for (ext, key, id, to) in KEYS {
        move_key(&mut doc, &["extensions", ext], key, id, to, &mut notes);
        drop_empty(&mut doc, "extensions", ext);
    }
    move_key(&mut doc, &["general"], "app_switcher", "switcher", "app_switcher", &mut notes);
    let instances: Vec<String> = doc.get("extensions").and_then(Item::as_table).map(|t| t.iter().map(|(k, _)| k.to_string()).collect()).unwrap_or_default();
    for (ext, key, item, to) in ITEM_KEYS {
        for table in instances.iter().filter(|k| super::instance::name_of(k) == *ext) {
            move_item_key(&mut doc, table, key, &format!("{table}/{item}"), to, &mut notes);
            drop_empty(&mut doc, "extensions", table);
        }
    }
    if let Some(Item::Table(t)) = doc.remove("sidebar") {
        let dest = feature(&mut doc, "sidebar");
        for (k, v) in t.into_iter() {
            if !dest.contains_key(&k) {
                dest.insert(&k, v);
            }
        }
        notes.push("sidebar\tfeatures.sidebar".into());
    }
    for p in GONE_PALETTES {
        if doc.get_mut("palettes").and_then(Item::as_table_mut).and_then(|t| t.remove(p)).is_some() {
            notes.push(format!("palettes.{p}\tdropped: the palette is a feature now"));
        }
    }
    Ok((!notes.is_empty()).then(|| (doc.to_string(), notes)))
}

impl ConfigFile {
    /// Reshape the file when it still has settings of what became a
    /// feature: the old text to [`BACKUP`] (once: an existing backup is
    /// kept), the new one written in place. The notes, or none when there
    /// was nothing to move.
    pub fn reshape(&self) -> Result<Vec<String>, Error> {
        let target = self.target();
        let Ok(text) = std::fs::read_to_string(&target) else { return Ok(Vec::new()) };
        let Some((out, notes)) = plan(&text).map_err(|source| Error::Parse { path: target.clone(), source })? else { return Ok(Vec::new()) };
        let io = |source| Error::Io { path: target.clone(), source };
        let backup = target.with_file_name(BACKUP);
        if !backup.exists() {
            crate::fs::write_atomic(&backup, &text).map_err(io)?;
        }
        crate::fs::write_atomic(&target, &out).map_err(io)?;
        Ok(notes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OLD: &str = r#"[general]
hotkey = "ctrl+space"
app_switcher = "alt+tab"

[extensions.clipboard]
max_entries = 500
primary_action = "copy"

[extensions.snippets]
expand = true   # as I type

[sidebar]
palette = "windows/windows"
edge = "left"

[palettes.windows]
hold = "cmd+tab"

[palettes.keycast]
alias = "kc"

[extensions.window-management]
keep_below_bar = true   # off the strip

[extensions.mouse]
middle_click = true
reverse_mouse = true
"#;

    #[test]
    fn moves_every_feature_setting_and_keeps_the_rest() {
        let (out, notes) = plan(OLD).unwrap().expect("something to move");
        let (c, d) = super::super::parse(&out).unwrap();
        assert!(d.is_empty(), "{d:?}\n{out}");
        assert_eq!(c.feature_settings("clipboard")["max_entries"].as_integer(), Some(500));
        assert_eq!(c.extensions["clipboard"].get("max_entries"), None);
        assert_eq!(c.extensions["clipboard"]["primary_action"].as_str(), Some("copy"), "the palette's setting stays");
        assert_eq!(c.feature_settings("expansion")["enabled"].as_bool(), Some(true));
        assert!(!c.extensions.contains_key("snippets"), "an emptied table goes");
        assert_eq!(c.feature_settings("reserve")["enabled"].as_bool(), Some(true));
        assert_eq!(c.feature_settings("mouse")["reverse_mouse"].as_bool(), Some(true));
        assert_eq!(c.feature_settings("switcher")["app_switcher"].as_str(), Some("alt+tab"));
        assert_eq!(c.features.sidebar.palette(), Some("windows/windows"));
        assert_eq!(c.palettes["windows"].hold.as_deref(), Some("cmd+tab"), "the hold stays the palette's");
        assert!(!c.palettes.contains_key("keycast"));
        assert!(out.contains("enabled = true   # as I type"), "a renamed key keeps its comment:\n{out}");
        assert!(out.contains("enabled = true   # off the strip"), "{out}");
        assert_eq!(notes.len(), 7, "{notes:?}");
        assert_eq!(plan(&out).unwrap(), None, "a second run has nothing to do");
    }

    #[test]
    fn bar_item_settings_move_to_their_item() {
        let text = "[extensions.stats]\ninterval = 2\ncpu_label = \"none\"   # quiet\n\n[extensions.system]\nawake_presets = [\"1h\"]\n\n[bar.items.\"stats/cpu\"]\norder = 3\n";
        let (out, notes) = plan(text).unwrap().unwrap();
        let (c, d) = super::super::parse(&out).unwrap();
        assert!(d.is_empty(), "{d:?}\n{out}");
        assert_eq!(c.bar.items["stats/cpu"].settings["label"].as_str(), Some("none"));
        assert_eq!(c.bar.items["stats/cpu"].order, Some(3), "the item's own table keeps what it had");
        assert_eq!(c.extensions["stats"]["interval"].as_integer(), Some(2), "the palette's setting stays");
        assert!(!c.extensions["stats"].contains_key("cpu_label"));
        assert_eq!(c.bar.items["system/awake"].settings["presets"].as_array().map(|a| a.len()), Some(1));
        assert!(!c.extensions.contains_key("system"), "an emptied table goes");
        assert!(out.contains("label = \"none\"   # quiet"), "{out}");
        assert_eq!(notes.len(), 2, "{notes:?}");
        assert_eq!(plan(&out).unwrap(), None);
    }

    #[test]
    fn a_set_feature_key_wins() {
        let (out, notes) = plan("[extensions.snippets]\nexpand = true\n\n[features.expansion]\nenabled = false\n").unwrap().unwrap();
        let (c, _) = super::super::parse(&out).unwrap();
        assert_eq!(c.feature_settings("expansion")["enabled"].as_bool(), Some(false));
        assert!(notes[0].contains("dropped"), "{notes:?}");
    }

    #[test]
    fn nothing_to_move() {
        assert_eq!(plan("[general]\ntheme = \"dark\"\n").unwrap(), None);
        assert_eq!(plan("").unwrap(), None);
    }
}
