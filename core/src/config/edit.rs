//! Surgical edits: the file's text is what gets changed, never a struct
//! serialised back over it, so everything the user wrote around the touched
//! key survives byte for byte.

use std::path::Path;

use toml_edit::{DocumentMut, InlineTable, Item, Key, Table, TableLike, Value};

use super::{ConfigFile, Error, TEMPLATE};
use crate::fs;

impl ConfigFile {
    /// Set `key` (dotted, quotes allowed: `palettes."my.id".enabled`) to
    /// `value`. Missing tables on the way are created as `[headers]`; an
    /// existing key keeps its spacing and trailing comment. A `[table]` at
    /// `key` is only replaced by an inline table (same data, other spelling),
    /// anything else is [`Error::IsATable`].
    pub fn set(&self, key: &str, value: impl Into<Value>) -> Result<(), Error> {
        let value = value.into();
        self.edit(|doc| set(doc, key, value))
    }

    /// [`Self::set`] for a JSON value, the shape a UI hands over.
    pub fn set_json(&self, key: &str, value: serde_json::Value) -> Result<(), Error> {
        let value = json_to_toml(value);
        self.edit(|doc| set(doc, key, value))
    }

    /// Remove `key` (a whole table when it names one) and its own comments;
    /// the tables above it stay, even when that leaves an empty `[header]`.
    /// A key that is not there is not an error.
    pub fn unset(&self, key: &str) -> Result<(), Error> {
        self.edit(|doc| unset(doc, key))
    }

    /// Read, change, write back atomically. One call, one write, so several
    /// keys can change under one file event. Nothing is written when `f`
    /// fails or leaves the text as it was.
    pub fn edit(&self, f: impl FnOnce(&mut DocumentMut) -> Result<(), Error>) -> Result<(), Error> {
        let target = self.target();
        let io = |source| Error::Io { path: target.clone(), source };
        let stamp = |t: &Path| std::fs::metadata(t).and_then(|m| m.modified()).ok();
        let before = stamp(&target);
        let (text, fresh) = match std::fs::read_to_string(&target) {
            Ok(t) => (t, false),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), true),
            Err(e) => return Err(io(e)),
        };
        let mut doc: DocumentMut = text.parse().map_err(|source| Error::Parse { path: target.clone(), source })?;
        f(&mut doc)?;
        let out = if fresh { format!("{TEMPLATE}\n{doc}") } else { doc.to_string() };
        if out == text {
            return Ok(());
        }
        // A hand edit that landed while we held the text would be lost by
        // our write; refuse rather than clobber. The caller can retry. (The
        // stamp has the filesystem's mtime resolution, and a write between
        // this check and the rename still slips through.)
        if stamp(&target) != before {
            return Err(Error::Contended(target));
        }
        fs::write_atomic(&target, &out).map_err(io)
    }
}

/// The dotted key's parts; `Error::Key` rather than a literal key for text
/// that does not parse, so a typo like `a..b` cannot land in the file.
fn keys(path: &str) -> Result<(Key, Vec<Key>), Error> {
    let mut keys = Key::parse(path).map_err(|_| Error::Key(path.into()))?;
    let last = keys.pop().ok_or_else(|| Error::Key(path.into()))?;
    Ok((last, keys))
}

pub(super) fn set(doc: &mut DocumentMut, path: &str, mut value: Value) -> Result<(), Error> {
    let (last, parents) = keys(path)?;
    let mut table: &mut dyn TableLike = doc.as_table_mut();
    let (mut walked, mut inline) = (String::new(), false);
    for k in &parents {
        walked.push_str(k.get());
        // An intermediate that does not exist yet takes its parent's shape:
        // a header table under headers, an inline table inside an inline one.
        let item = table.entry(k.get()).or_insert_with(|| {
            if inline {
                Item::Value(InlineTable::new().into())
            } else {
                let mut t = Table::new();
                t.set_implicit(true);
                Item::Table(t)
            }
        });
        inline = item.is_inline_table();
        table = item.as_table_like_mut().ok_or_else(|| Error::NotATable(walked.clone()))?;
        walked.push('.');
    }
    match table.get_mut(last.get()) {
        Some(Item::Value(old)) => {
            *value.decor_mut() = old.decor().clone();
            *old = value;
        }
        // The same data spelled the other way: swap the spelling.
        Some(item @ Item::Table(_)) if value.is_inline_table() => *item = Item::Value(value),
        Some(item @ Item::ArrayOfTables(_)) if value.is_array() => *item = Item::Value(value),
        Some(Item::None) | None => {
            table.insert(last.get(), Item::Value(value));
        }
        Some(_) => return Err(Error::IsATable(path.into())),
    }
    // A table that now holds a value of its own must print its header.
    if !parents.is_empty() {
        if let Some(parent) = nested_table(doc, &parents) {
            parent.set_implicit(false);
        }
    }
    Ok(())
}

fn nested_table<'a>(doc: &'a mut DocumentMut, path: &[Key]) -> Option<&'a mut Table> {
    let mut t = doc.as_table_mut();
    for k in path {
        t = t.get_mut(k.get())?.as_table_mut()?;
    }
    Some(t)
}

fn unset(doc: &mut DocumentMut, path: &str) -> Result<(), Error> {
    let (last, parents) = keys(path)?;
    let mut table: &mut dyn TableLike = doc.as_table_mut();
    for k in &parents {
        match table.get_mut(k.get()).and_then(Item::as_table_like_mut) {
            Some(t) => table = t,
            None => return Ok(()),
        }
    }
    table.remove(last.get());
    Ok(())
}

/// JSON to a TOML value. `null` has no TOML form and becomes an empty string;
/// callers that mean "remove" should [`ConfigFile::unset`].
pub fn json_to_toml(v: serde_json::Value) -> Value {
    use serde_json::Value as J;
    match v {
        J::Null => "".into(),
        J::Bool(b) => b.into(),
        J::Number(n) => n.as_i64().map_or_else(|| n.as_f64().unwrap_or(0.0).into(), Value::from),
        J::String(s) => s.into(),
        J::Array(a) => a.into_iter().map(json_to_toml).collect::<toml_edit::Array>().into(),
        J::Object(o) => o.into_iter().map(|(k, v)| (k, json_to_toml(v))).collect::<InlineTable>().into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ODD: &str = r#"#:schema ./config.schema.json
# pal settings, hand-tuned.

[general]
hotkey   =   "alt+space"    # taken on hornet, works on marko
theme = "dark"


[palettes]
  # Off by choice, not by platform.
  [palettes.ffbookmarks]
  enabled = false

  [palettes.clipboard]
  alias = "cb" # short
  settings = { history = 200, sensitive = false }

[extensions.github]
token = "keychain:pal/github-token"
"#;

    fn file(text: &str) -> (tempfile::TempDir, ConfigFile) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("config.toml");
        std::fs::write(&p, text).unwrap();
        (dir, ConfigFile::new(p))
    }

    fn read(f: &ConfigFile) -> String {
        std::fs::read_to_string(f.path()).unwrap()
    }

    /// Everything but the changed line must be byte-identical.
    fn assert_only_line_changed(before: &str, after: &str, line: usize, expect: &str) {
        let (b, a): (Vec<_>, Vec<_>) = (before.lines().collect(), after.lines().collect());
        assert_eq!(b.len(), a.len(), "line count changed:\n{after}");
        for (i, (x, y)) in b.iter().zip(&a).enumerate() {
            if i == line {
                assert_eq!(*y, expect);
            } else {
                assert_eq!(x, y, "line {i} changed");
            }
        }
        assert_eq!(before.ends_with('\n'), after.ends_with('\n'));
    }

    #[test]
    fn set_existing_keeps_spacing_and_comment() {
        let (_d, f) = file(ODD);
        f.set("general.hotkey", "ctrl+space").unwrap();
        assert_only_line_changed(ODD, &read(&f), 4, r#"hotkey   =   "ctrl+space"    # taken on hornet, works on marko"#);
    }

    #[test]
    fn set_list_over_string_keeps_the_line() {
        // Adding a second root hotkey in Settings: the string becomes a
        // list on its line, comment and spacing kept; back to one entry
        // it stays a list, the shape the file now has.
        let (_d, f) = file(ODD);
        f.set_json("general.hotkey", serde_json::json!(["alt+space", "ctrl+space"])).unwrap();
        assert_only_line_changed(ODD, &read(&f), 4, r#"hotkey   =   ["alt+space", "ctrl+space"]    # taken on hornet, works on marko"#);
        let cfg = super::super::parse(&read(&f)).unwrap().0;
        assert_eq!(cfg.general.hotkey.list(), ["alt+space", "ctrl+space"]);
        let before = read(&f);
        f.set_json("general.hotkey", serde_json::json!(["ctrl+space"])).unwrap();
        assert_only_line_changed(&before, &read(&f), 4, r#"hotkey   =   ["ctrl+space"]    # taken on hornet, works on marko"#);
        f.set("general.hotkey", "ctrl+space").unwrap();
        assert_only_line_changed(&before, &read(&f), 4, r#"hotkey   =   "ctrl+space"    # taken on hornet, works on marko"#);
    }

    #[test]
    fn set_inside_indented_subtable() {
        let (_d, f) = file(ODD);
        f.set("palettes.ffbookmarks.enabled", true).unwrap();
        assert_only_line_changed(ODD, &read(&f), 11, "  enabled = true");
    }

    #[test]
    fn set_inside_inline_table() {
        let (_d, f) = file(ODD);
        f.set("palettes.clipboard.settings.history", 500).unwrap();
        assert_only_line_changed(ODD, &read(&f), 15, "  settings = { history = 500, sensitive = false }");
    }

    #[test]
    fn set_new_key_in_existing_table_appends_there() {
        let (_d, f) = file(ODD);
        f.set("general.theme2", "x").unwrap();
        let after = read(&f);
        let inserted = after.lines().position(|l| l == "theme2 = \"x\"").unwrap();
        assert_eq!(inserted, 6, "right after theme, before the blank lines:\n{after}");
        let mut expected: Vec<_> = ODD.lines().collect();
        expected.insert(6, "theme2 = \"x\"");
        assert_eq!(after.lines().collect::<Vec<_>>(), expected);
    }

    #[test]
    fn set_new_table_goes_after_its_siblings() {
        let (_d, f) = file(ODD);
        f.set("palettes.emoji.alias", "e").unwrap();
        let after = read(&f);
        let mut expected: Vec<_> = ODD.lines().collect();
        expected.splice(16..16, ["", "[palettes.emoji]", "alias = \"e\""]);
        assert_eq!(after.lines().collect::<Vec<_>>(), expected, "\n{after}");
        assert!(after.ends_with("\"\n") && !after.ends_with("\n\n"));
        let cfg = super::super::parse(&after).unwrap().0;
        assert_eq!(cfg.palettes["emoji"].alias.as_deref(), Some("e"));
    }

    #[test]
    fn set_deep_new_path_uses_implicit_parents() {
        let (_d, f) = file("");
        f.set("extensions.github.token", "env:GH").unwrap();
        assert_eq!(read(&f), "[extensions.github]\ntoken = \"env:GH\"\n");
    }

    #[test]
    fn set_quoted_key_and_json_values() {
        let (_d, f) = file("");
        f.set(r#"palettes."my.pal".enabled"#, false).unwrap();
        f.set_json("extensions.x.list", serde_json::json!([1, "a", {"k": true}])).unwrap();
        f.set_json("extensions.x.f", serde_json::json!(1.5)).unwrap();
        let cfg = super::super::parse(&read(&f)).unwrap().0;
        assert!(!cfg.palettes["my.pal"].enabled);
        assert_eq!(cfg.extensions["x"]["list"][2]["k"].as_bool(), Some(true));
        assert_eq!(cfg.extensions["x"]["f"].as_float(), Some(1.5));
    }

    #[test]
    fn set_under_a_value_is_an_error() {
        let (_d, f) = file(ODD);
        let e = f.set("general.hotkey.x", 1).unwrap_err();
        assert!(matches!(e, Error::NotATable(ref p) if p == "general.hotkey"), "{e}");
        assert_eq!(read(&f), ODD, "a failed edit writes nothing");
    }

    #[test]
    fn set_over_a_table_is_an_error_unless_inline() {
        let (_d, f) = file(ODD);
        let e = f.set("general", 1).unwrap_err();
        assert!(matches!(e, Error::IsATable(ref p) if p == "general"), "{e}");
        let e = f.set("palettes.clipboard", "x").unwrap_err();
        assert!(matches!(e, Error::IsATable(_)), "{e}");
        assert_eq!(read(&f), ODD);
        f.set_json("palettes.ffbookmarks", serde_json::json!({"enabled": true, "alias": "fb"})).unwrap();
        let cfg = super::super::parse(&read(&f)).unwrap().0;
        assert!(cfg.palettes["ffbookmarks"].enabled);
        assert_eq!(cfg.palettes["ffbookmarks"].alias.as_deref(), Some("fb"));
        assert_eq!(cfg.palettes["clipboard"].alias.as_deref(), Some("cb"), "siblings untouched");
    }

    #[test]
    fn bad_key_is_an_error() {
        let (_d, f) = file(ODD);
        for k in ["", "a..b", "a.\"b", ".a"] {
            assert!(matches!(f.set(k, 1).unwrap_err(), Error::Key(ref p) if p == k), "set {k:?}");
            assert!(matches!(f.unset(k).unwrap_err(), Error::Key(_)), "unset {k:?}");
        }
        assert_eq!(read(&f), ODD);
    }

    #[test]
    fn unset_removes_only_that_line() {
        let (_d, f) = file(ODD);
        f.unset("general.theme").unwrap();
        let mut expected: Vec<_> = ODD.lines().collect();
        expected.remove(5);
        assert_eq!(read(&f).lines().collect::<Vec<_>>(), expected);
        let before = read(&f);
        f.unset("nope.nothing").unwrap();
        f.unset("general.gone").unwrap();
        f.unset("general.hotkey.x").unwrap();
        assert_eq!(read(&f), before, "missing keys are a no-op");
    }

    #[test]
    fn unset_table_drops_its_block() {
        let (_d, f) = file(ODD);
        f.unset("palettes.clipboard").unwrap();
        let cfg = super::super::parse(&read(&f)).unwrap().0;
        assert!(!cfg.palettes.contains_key("clipboard"));
        assert!(cfg.palettes.contains_key("ffbookmarks"));
    }

    #[test]
    fn unparseable_file_is_a_parse_error() {
        let (_d, f) = file("[general\n");
        let e = f.set("general.theme", "dark").unwrap_err();
        assert!(matches!(e, Error::Parse { .. }), "{e}");
        assert_eq!(read(&f), "[general\n");
    }

    #[test]
    fn noop_edit_does_not_rewrite() {
        let (_d, f) = file(ODD);
        let before = std::fs::metadata(f.path()).unwrap().modified().unwrap();
        f.set("general.theme", "dark").unwrap();
        assert_eq!(std::fs::metadata(f.path()).unwrap().modified().unwrap(), before);
    }

    #[test]
    fn missing_file_starts_from_template() {
        let dir = tempfile::tempdir().unwrap();
        let f = ConfigFile::new(dir.path().join("sub").join("config.toml"));
        f.set("general.theme", "light").unwrap();
        assert_eq!(read(&f), format!("{TEMPLATE}\n[general]\ntheme = \"light\"\n"));
    }

    #[test]
    fn edit_follows_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("dotfiles.toml");
        std::fs::write(&real, "[general]\ntheme = \"dark\"\n").unwrap();
        let link = dir.path().join("config.toml");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        ConfigFile::new(&link).set("general.theme", "light").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().is_symlink(), "symlink survived the write");
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "[general]\ntheme = \"light\"\n");
    }

    #[test]
    fn contended_edit_is_refused() {
        let (_d, f) = file(ODD);
        let e = f
            .edit(|doc| {
                std::fs::write(f.path(), "[general]\ntheme = \"light\"\n").unwrap();
                // mtime granularity: make sure the concurrent write is later.
                let later = std::time::SystemTime::now() + std::time::Duration::from_secs(1);
                std::fs::File::open(f.path()).unwrap().set_modified(later).unwrap();
                doc["general"]["theme"] = toml_edit::value("dark2");
                Ok(())
            })
            .unwrap_err();
        assert!(matches!(e, Error::Contended(_)), "{e}");
        assert_eq!(read(&f), "[general]\ntheme = \"light\"\n", "hand edit kept");
    }
}
