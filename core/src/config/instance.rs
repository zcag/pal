//! Instance keys (`docs/design/instances.md`): one extension, several
//! configured copies. The default instance is the extension's bare name;
//! another is `<name>@<suffix>`, the one identity string every table, file
//! and link uses for it. These are the pure helpers on that string.

use std::collections::BTreeSet;

use toml_edit::{DocumentMut, Item, Table, TableLike};

use super::{ConfigFile, Error};

/// Longest suffix (`[a-z0-9][a-z0-9_-]{0,31}`).
pub const MAX_SUFFIX: usize = 32;

/// A manifest name (the directory, the config key): lowercase letters,
/// digits, `-`, `_`, `.`; not starting with a dot; no `@`.
pub fn valid_name(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('.') && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_' || b == b'.')
}

/// An instance suffix: `[a-z0-9][a-z0-9_-]{0,31}`, and never `default`
/// (the default instance is the bare name).
pub fn valid_suffix(s: &str) -> bool {
    let mut bytes = s.bytes();
    let first = bytes.next().is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    first && s.len() <= MAX_SUFFIX && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_') && s != "default"
}

/// `<name>@<suffix>` into its parts; a bare name has no suffix. Only the
/// first `@` splits, so a second one lands in the suffix and fails
/// [`is_key`].
pub fn split(key: &str) -> (&str, Option<&str>) {
    match key.split_once('@') {
        Some((name, suffix)) => (name, Some(suffix)),
        None => (key, None),
    }
}

/// The extension's name behind a key: `gmail` for `gmail@work` and for `gmail`.
pub fn name_of(key: &str) -> &str {
    split(key).0
}

/// Whether `s` is a well-formed non-default instance key: a valid name, one
/// `@`, a valid suffix.
pub fn is_key(s: &str) -> bool {
    matches!(split(s), (name, Some(suffix)) if valid_name(name) && valid_suffix(suffix))
}

/// The palette's key in the config file, `[palettes.<id>]`: the instance
/// key when the palette is named like the extension's *name* (`emoji`,
/// `gmail@work` for the `gmail` palette of `gmail@work`), else
/// `<key>-<palette>` (`clipboard-history`, `gmail@work-inbox`). Readable in
/// the file and needs no quoting without an `@`; the registry resolves it
/// back, so a clash between a hyphenated extension name and a palette is
/// the one case it cannot tell apart.
pub fn palette_id(key: &str, palette: &str) -> String {
    if name_of(key) == palette {
        key.to_string()
    } else {
        format!("{key}-{palette}")
    }
}

/// The ids of the setting specs a non-default instance never inherits from
/// the default's table: `kind: "secret"` (a token identifies the account)
/// and `scope: "instance"` (a Home Assistant `url`, a Slack `workspace`).
pub fn private_ids(specs: &serde_json::Value) -> BTreeSet<&str> {
    specs.as_array().into_iter().flatten().filter(|s| s["kind"] == "secret" || s["scope"] == "instance").filter_map(|s| s["id"].as_str()).collect()
}

// ---- the file edits --------------------------------------------------------

/// The instance's own config keys, as a dotted path with the segment
/// quoted (`instances."gmail@work".title`).
pub fn table_key(section: &str, key: &str) -> String {
    format!("{section}.{}", toml_edit::Key::new(key).display_repr())
}

/// Whether `[palettes.<id>]` belongs to the instance `key`: the key itself
/// (the palette named like the extension) or `<key>-<palette>`
/// (`palette_id`).
pub fn owns_palette(key: &str, id: &str) -> bool {
    id == key || id.strip_prefix(key).is_some_and(|rest| rest.starts_with('-'))
}

/// Whether `[bar.items.<k>]` belongs to the instance: `<key>/<id>`.
pub fn owns_bar_item(key: &str, item: &str) -> bool {
    item.strip_prefix(key).is_some_and(|rest| rest.starts_with('/'))
}

fn table_at<'a>(doc: &'a mut DocumentMut, path: &[&str]) -> Option<&'a mut dyn TableLike> {
    let mut t: &mut dyn TableLike = doc.as_table_mut();
    for k in path {
        t = t.get_mut(k)?.as_table_like_mut()?;
    }
    Some(t)
}

impl ConfigFile {
    /// `[instances."<name>@<suffix>"]` written, with `title` and `tint`
    /// when given: the table existing is what makes the instance, so an
    /// empty one is written as an explicit header. Refuses a key that is
    /// not well formed (`is_key`) or one the file already has.
    pub fn instance_add(&self, key: &str, title: Option<&str>, tint: Option<&str>) -> Result<(), Error> {
        if !is_key(key) {
            return Err(Error::Key(key.into()));
        }
        self.edit(|doc| {
            let instances = doc.as_table_mut().entry("instances").or_insert_with(|| {
                let mut t = Table::new();
                t.set_implicit(true);
                Item::Table(t)
            });
            let instances = instances.as_table_like_mut().ok_or_else(|| Error::NotATable("instances".into()))?;
            if instances.contains_key(key) {
                return Err(Error::IsATable(table_key("instances", key)));
            }
            let mut t = Table::new();
            if let Some(title) = title.map(str::trim).filter(|t| !t.is_empty()) {
                t.insert("title", toml_edit::value(title));
            }
            if let Some(tint) = tint.map(str::trim).filter(|t| !t.is_empty()) {
                t.insert("tint", toml_edit::value(tint));
            }
            instances.insert(key, Item::Table(t));
            Ok(())
        })
    }

    /// Every table of the instance `key` removed, `[instances.<key>]`,
    /// `[extensions.<key>]`, each `[palettes."<key>*"]` of its own
    /// (`owns_palette`) and each `[bar.items."<key>/*"]`, in one edit.
    /// Answers the dotted keys it removed. The default instance is not a
    /// key (`is_key`) and is refused: the extension's own tables stay.
    pub fn instance_remove(&self, key: &str) -> Result<Vec<String>, Error> {
        if !is_key(key) {
            return Err(Error::Key(key.into()));
        }
        let mut removed = Vec::new();
        self.edit(|doc| {
            for section in ["instances", "extensions"] {
                if let Some(t) = table_at(doc, &[section]) {
                    if t.remove(key).is_some() {
                        removed.push(table_key(section, key));
                    }
                }
            }
            let owned = |t: &dyn TableLike, owns: fn(&str, &str) -> bool| t.iter().map(|(k, _)| k.to_string()).filter(|k| owns(key, k)).collect::<Vec<_>>();
            if let Some(t) = table_at(doc, &["palettes"]) {
                for id in owned(t, owns_palette) {
                    t.remove(&id);
                    removed.push(table_key("palettes", &id));
                }
            }
            if let Some(t) = table_at(doc, &["bar", "items"]) {
                for id in owned(t, owns_bar_item) {
                    t.remove(&id);
                    removed.push(table_key("bar.items", &id));
                }
            }
            Ok(())
        })?;
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(text: &str) -> (tempfile::TempDir, ConfigFile) {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("config.toml");
        std::fs::write(&p, text).unwrap();
        (d, ConfigFile::new(p))
    }

    #[test]
    fn instances_add_writes_the_table_and_refuses_a_second() {
        let (_d, f) = file("[general]\nhotkey = \"ctrl+space\"\n");
        f.instance_add("gmail@work", Some("Work"), Some("amber")).unwrap();
        f.instance_add("gmail@home", None, None).unwrap();
        let text = std::fs::read_to_string(f.path()).unwrap();
        assert!(text.contains("[instances.\"gmail@work\"]\ntitle = \"Work\"\ntint = \"amber\"\n"), "{text}");
        assert!(text.contains("[instances.\"gmail@home\"]\n"), "an empty table is written as its header: {text}");
        let (c, d) = super::super::parse(&text).unwrap();
        assert!(d.is_empty(), "{d:?}");
        assert_eq!(c.instances["gmail@work"].title.as_deref(), Some("Work"));
        assert!(c.instances.contains_key("gmail@home"));
        assert!(matches!(f.instance_add("gmail@work", None, None), Err(Error::IsATable(_))), "already there");
        assert!(matches!(f.instance_add("gmail", None, None), Err(Error::Key(_))), "the default is not added");
        assert!(matches!(f.instance_add("gmail@Work", None, None), Err(Error::Key(_))));
    }

    #[test]
    fn instances_remove_unsets_every_table() {
        let text = "[extensions.gmail]\nsignature = \"C\"\n\n[instances.\"gmail@work\"]\ntitle = \"Work\"\n\n[extensions.\"gmail@work\"]\ntoken = \"keychain:pal/gmail@work-token\"\n\n[palettes.\"gmail@work\"]\nalias = \"gw\"\n\n[palettes.\"gmail@work-inbox\"]\nhotkey = \"ctrl+alt+w\"\n\n[palettes.gmail-inbox]\nhotkey = \"ctrl+alt+g\"\n\n[palettes.\"gmail@workshop-inbox\"]\n\n[bar.items.\"gmail@work/unread\"]\norder = 30\n\n[bar.items.\"gmail/unread\"]\norder = 10\n";
        let (_d, f) = file(text);
        let removed = f.instance_remove("gmail@work").unwrap();
        assert_eq!(removed, ["instances.\"gmail@work\"", "extensions.\"gmail@work\"", "palettes.\"gmail@work\"", "palettes.\"gmail@work-inbox\"", "bar.items.\"gmail@work/unread\""]);
        let after = std::fs::read_to_string(f.path()).unwrap();
        let (c, _) = super::super::parse(&after).unwrap();
        assert_eq!(c.extensions["gmail"]["signature"].as_str(), Some("C"), "the default's table stays");
        assert!(!c.instances.contains_key("gmail@work") && !c.extensions.contains_key("gmail@work"));
        assert_eq!(c.palettes.keys().collect::<Vec<_>>(), ["gmail-inbox", "gmail@workshop-inbox"], "another instance's palette with the key as a prefix is not its own");
        assert_eq!(c.bar.items.keys().collect::<Vec<_>>(), ["gmail/unread"]);
        assert!(f.instance_remove("gmail@nothing").unwrap().is_empty(), "nothing to remove is not an error");
        assert!(matches!(f.instance_remove("gmail"), Err(Error::Key(_))), "the default is never removed");
    }

    #[test]
    fn split_name_of_and_is_key() {
        assert_eq!(split("gmail"), ("gmail", None));
        assert_eq!(split("gmail@work"), ("gmail", Some("work")));
        assert_eq!(split("gmail@w@x"), ("gmail", Some("w@x")), "only the first @ splits");
        assert_eq!(name_of("gmail@work"), "gmail");
        assert_eq!(name_of("home-assistant@flat_2"), "home-assistant");
        assert_eq!(name_of("gmail"), "gmail");
        for ok in ["gmail@work", "home-assistant@flat_2", "a@b", "x.y@0-a"] {
            assert!(is_key(ok), "{ok}");
        }
        for bad in ["gmail", "gmail@", "@work", "gmail@w@x", "gmail@Work", "gmail@-work", "gmail@default", "Gmail@work", ".g@work", "gmail@wörk", "gmail@a.b"] {
            assert!(!is_key(bad), "{bad}");
        }
        assert!(is_key(&format!("g@{}", "a".repeat(MAX_SUFFIX))));
        assert!(!is_key(&format!("g@{}", "a".repeat(MAX_SUFFIX + 1))), "a suffix has a length");
        assert!(valid_name("home-assistant") && valid_name("a.b_c") && !valid_name(".hidden") && !valid_name("") && !valid_name("g@w"));
    }

    #[test]
    fn palette_id_of_an_instance() {
        assert_eq!(palette_id("emoji", "emoji"), "emoji");
        assert_eq!(palette_id("clipboard", "history"), "clipboard-history");
        assert_eq!(palette_id("gmail@work", "gmail"), "gmail@work", "named like the extension's name: the key");
        assert_eq!(palette_id("gmail@work", "inbox"), "gmail@work-inbox");
    }

    #[test]
    fn private_ids_are_secrets_and_instance_scoped() {
        let specs = serde_json::json!([
            { "id": "token", "kind": "secret" },
            { "id": "url", "kind": "text", "scope": "instance" },
            { "id": "org", "kind": "text" },
            { "kind": "text" },
        ]);
        assert_eq!(private_ids(&specs).into_iter().collect::<Vec<_>>(), ["token", "url"]);
        assert!(private_ids(&serde_json::Value::Null).is_empty());
    }
}
