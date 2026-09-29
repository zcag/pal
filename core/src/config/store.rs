//! `[store]`: the edits Settings, the Store and the CLI make to it (each one
//! read-edit-write through [`ConfigFile::edit`], so the rest of the file
//! survives byte for byte), and the start-up [`reconcile`] of the listed
//! set against what is on disk.

use toml_edit::{Array, ArrayOfTables, DocumentMut, Item, Table, TableLike, Value};

use super::{installed_entry, split_installed, ConfigFile, Error, RegistryConfig, StoreConfig};
use crate::extensions::{Installed, Kind, Roots};
use crate::registry::{Channel, PAL};

impl ConfigFile {
    /// Lists `name` from `registry` in `installed`, replacing an entry for
    /// the same name from another registry (a re-pin).
    pub fn store_add_installed(&self, registry: &str, name: &str) -> Result<(), Error> {
        self.store_add_installed_all(registry, &[name.to_string()])
    }

    /// [`Self::store_add_installed`] for several names in one edit (the
    /// migration's list).
    pub fn store_add_installed_all(&self, registry: &str, names: &[String]) -> Result<(), Error> {
        self.edit(|doc| {
            let list = list(doc, "installed")?;
            for name in names {
                let entry = installed_entry(registry, name);
                list.retain(|v| v.as_str().is_none_or(|s| split_installed(s).1 != name || s == entry));
                if !list.iter().any(|v| v.as_str() == Some(&entry)) {
                    list.push(entry.as_str());
                }
            }
            Ok(())
        })
    }

    /// Drops every `installed` entry for `name`, whatever its registry.
    pub fn store_remove_installed(&self, name: &str) -> Result<(), Error> {
        self.edit(|doc| {
            retain(doc, "installed", |s| split_installed(s).1 != name);
            Ok(())
        })
    }

    /// Adds `name` to `disabled`, or drops it.
    pub fn store_set_disabled(&self, name: &str, disabled: bool) -> Result<(), Error> {
        self.edit(|doc| {
            retain(doc, "disabled", |s| s != name);
            if disabled {
                list(doc, "disabled")?.push(name);
            }
            Ok(())
        })
    }

    /// Appends a `[[store.registries]]` entry, replacing one of the same name.
    pub fn store_add_registry(&self, r: &RegistryConfig) -> Result<(), Error> {
        self.edit(|doc| {
            let regs = registries(doc)?;
            let mut t = Table::new();
            t["name"] = toml_edit::value(r.name.as_str());
            t["url"] = toml_edit::value(r.url.as_str());
            t["key"] = toml_edit::value(r.key.as_str());
            if let Some(a) = r.auto_update {
                t["auto_update"] = toml_edit::value(a);
            }
            if let Some(c) = r.channel {
                t["channel"] = toml_edit::value(c.as_str());
            }
            let at = regs.iter().position(|t| name_of(t) == Some(&r.name));
            match at {
                Some(i) => *regs.get_mut(i).expect("found") = t,
                None => {
                    regs.push(t);
                }
            }
            Ok(())
        })
    }

    /// Drops the `[[store.registries]]` entry named `name`, and every
    /// `installed` entry from it.
    pub fn store_remove_registry(&self, name: &str) -> Result<(), Error> {
        self.edit(|doc| {
            registries(doc)?.retain(|t| name_of(t) != Some(name));
            retain(doc, "installed", |s| split_installed(s).0 != name);
            Ok(())
        })
    }

    /// Moves a registry's pinned key (a signed rotation, `Refreshed::rotated_to`).
    pub fn store_set_registry_key(&self, name: &str, key: &str) -> Result<(), Error> {
        self.edit(|doc| {
            if let Some(t) = registries(doc)?.iter_mut().find(|t| name_of(t) == Some(name)) {
                t["key"] = toml_edit::value(key);
            }
            Ok(())
        })
    }

    /// Sets (or with `None` unsets) a registry's `auto_update` and
    /// `channel`; for `pal` the entry is created when there is none.
    pub fn store_set_registry(&self, name: &str, auto_update: Option<bool>, channel: Option<Channel>) -> Result<(), Error> {
        self.edit(|doc| {
            let regs = registries(doc)?;
            if !regs.iter().any(|t| name_of(t) == Some(name)) {
                if name != PAL {
                    return Ok(());
                }
                let mut t = Table::new();
                t["name"] = toml_edit::value(name);
                regs.push(t);
            }
            let t = regs.iter_mut().find(|t| name_of(t) == Some(name)).expect("just found or made");
            match auto_update {
                Some(a) => t["auto_update"] = toml_edit::value(a),
                None => drop(t.remove("auto_update")),
            }
            match channel {
                Some(c) => t["channel"] = toml_edit::value(c.as_str()),
                None => drop(t.remove("channel")),
            }
            // A `pal` entry that says nothing any more goes.
            regs.retain(|t| !(name_of(t) == Some(PAL) && t.len() == 1));
            Ok(())
        })
    }
}

fn store(doc: &mut DocumentMut) -> Result<&mut dyn TableLike, Error> {
    let item = doc.entry("store").or_insert_with(|| {
        let mut t = Table::new();
        t.set_implicit(true);
        Item::Table(t)
    });
    item.as_table_like_mut().ok_or_else(|| Error::NotATable("store".into()))
}

fn list<'a>(doc: &'a mut DocumentMut, key: &str) -> Result<&'a mut Array, Error> {
    store(doc)?.entry(key).or_insert(Item::Value(Value::Array(Array::new()))).as_array_mut().ok_or_else(|| Error::NotATable(format!("store.{key}")))
}

/// Keeps the string entries of `store.<key>` that `keep` accepts; creates
/// nothing when there is no such list.
fn retain(doc: &mut DocumentMut, key: &str, keep: impl Fn(&str) -> bool) {
    // `as_table_like_mut().get_mut`, not `Item::get_mut`, which inserts an empty item.
    if let Some(list) = doc.get_mut("store").and_then(Item::as_table_like_mut).and_then(|s| s.get_mut(key)).and_then(Item::as_array_mut) {
        list.retain(|v| v.as_str().is_none_or(&keep));
    }
}

/// `store.registries` as an array of tables; an inline array of inline
/// tables is respelled as one, the same data.
fn registries(doc: &mut DocumentMut) -> Result<&mut ArrayOfTables, Error> {
    let item = store(doc)?.entry("registries").or_insert(Item::ArrayOfTables(ArrayOfTables::new()));
    if !item.is_array_of_tables() {
        let taken = std::mem::take(item);
        *item = Item::ArrayOfTables(taken.into_array_of_tables().map_err(|_| Error::NotATable("store.registries".into()))?);
    }
    item.as_array_of_tables_mut().ok_or_else(|| Error::NotATable("store.registries".into()))
}

fn name_of(t: &Table) -> Option<&str> {
    t.get("name").and_then(Item::as_str)
}

/// What the start-up reconcile should do.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct Plan {
    /// Listed and missing: `(registry, name)` to install in the background.
    pub install: Vec<(String, String)>,
    /// In the store and not listed: shown as *not in config*, never added
    /// by themselves (a hand-made extension must not end up in a list
    /// another machine installs from a registry).
    pub unlisted: Vec<String>,
}

/// `[store] installed` against the store's contents (`Store::list`). A name
/// a bundled or local root provides is never installed from the list, and
/// a store copy of a bundled extension (its update from our registry) is
/// not "unlisted".
pub fn reconcile(store: &StoreConfig, installed: &[Installed], roots: &Roots) -> Plan {
    let listed = store.installed();
    let install = listed.iter().filter(|(_, n)| !installed.iter().any(|i| &i.name == n) && !roots.bundled.contains(n) && !roots.local.contains(n)).cloned().collect();
    let unlisted = installed
        .iter()
        .filter(|i| !listed.iter().any(|(_, n)| n == &i.name))
        .filter(|i| !(roots.bundled.contains(&i.name) && matches!(i.kind(), Kind::Registry { registry, .. } if registry == PAL)))
        .map(|i| i.name.clone())
        .collect();
    Plan { install, unlisted }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(text: &str) -> (tempfile::TempDir, ConfigFile) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, text).unwrap();
        (dir, ConfigFile::new(path))
    }

    fn read(f: &ConfigFile) -> String {
        std::fs::read_to_string(f.path()).unwrap()
    }

    #[test]
    fn installed_and_disabled_round_trip() {
        let (_d, f) = file("# mine\n[general]\ntheme = \"dark\" # keep\n");
        f.store_remove_installed("x").unwrap();
        f.store_set_disabled("x", false).unwrap();
        f.store_remove_registry("x").unwrap();
        assert_eq!(read(&f), "# mine\n[general]\ntheme = \"dark\" # keep\n", "removing what is not there writes nothing");
        f.store_add_installed("pal", "weather").unwrap();
        f.store_add_installed("acme", "todo").unwrap();
        f.store_add_installed("pal", "weather").unwrap();
        f.store_set_disabled("hue", true).unwrap();
        let text = read(&f);
        assert!(text.starts_with("# mine\n[general]\ntheme = \"dark\" # keep\n"), "{text}");
        let c = f.load().config;
        assert_eq!(c.store.installed, ["weather", "acme:todo"]);
        assert_eq!(c.store.installed(), [("pal".to_string(), "weather".to_string()), ("acme".into(), "todo".into())]);
        assert!(c.store.is_disabled("hue"));
        // A re-pin replaces the other registry's entry.
        f.store_add_installed("beta", "todo").unwrap();
        assert_eq!(f.load().config.store.installed, ["weather", "beta:todo"]);
        f.store_remove_installed("todo").unwrap();
        f.store_set_disabled("hue", false).unwrap();
        let c = f.load().config;
        assert_eq!((c.store.installed.as_slice(), c.store.disabled.is_empty()), (&["weather".to_string()][..], true));
        assert!(f.load().diagnostics.is_empty());
    }

    #[test]
    fn registries_round_trip() {
        let (_d, f) = file("[store]\ninstalled = [\"acme:todo\", \"weather\"]\n");
        let acme = RegistryConfig { name: "acme".into(), url: "https://a/index.json".into(), key: "K1".into(), ..Default::default() };
        f.store_add_registry(&acme).unwrap();
        f.store_add_registry(&RegistryConfig { name: "beta".into(), url: "https://b".into(), key: "B".into(), auto_update: Some(false), channel: Some(Channel::Edge), ..Default::default() }).unwrap();
        f.store_set_registry_key("acme", "K2").unwrap();
        let c = f.load().config;
        assert_eq!(c.store.registries.len(), 2);
        assert_eq!(c.store.registries[0].key, "K2");
        assert_eq!((c.store.registries[1].auto_update, c.store.registries[1].channel), (Some(false), Some(Channel::Edge)));
        assert!(read(&f).contains("[[store.registries]]"), "{}", read(&f));

        // Ours: only channel and auto_update, and the entry goes when it says nothing.
        f.store_set_registry("pal", None, Some(Channel::Edge)).unwrap();
        assert_eq!(f.load().config.store.registries[2].channel, Some(Channel::Edge));
        assert_eq!(crate::registry::sources(&f.load().config.store)[0].channel, Channel::Edge);
        f.store_set_registry("pal", None, None).unwrap();
        assert_eq!(f.load().config.store.registries.len(), 2);

        f.store_remove_registry("acme").unwrap();
        let c = f.load().config;
        assert_eq!(c.store.registries.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["beta"]);
        assert_eq!(c.store.installed, ["weather"], "its installs go from the list with it");
    }

    #[test]
    fn an_inline_registries_array_is_edited_too() {
        let (_d, f) = file("[store]\nregistries = [{ name = \"acme\", url = \"u\", key = \"k\" }]\n");
        f.store_set_registry_key("acme", "k2").unwrap();
        assert_eq!(f.load().config.store.registries[0].key, "k2");
    }

    #[test]
    fn store_config_defaults_and_warnings() {
        let (c, d) = super::super::parse("").unwrap();
        assert!(c.store.auto_update && c.general.usage && d.is_empty());
        let (_, d) = super::super::parse("[store]\nbogus = 1\n[[store.registries]]\nname = \"x\"\n[[store.registries]]\nname = \"pal\"\nchannel = \"edge\"\n").unwrap();
        let paths: Vec<_> = d.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, ["store.bogus", "store.registries.0"], "{d:?}");
    }

    #[test]
    fn reconcile_installs_listed_and_reports_unlisted() {
        use std::collections::BTreeSet;
        use std::path::PathBuf;
        let rec = |registry: &str| crate::extensions::Record::from_registry(registry, Channel::Stable, "h", 1, 1, "c");
        let inst = |name: &str, record: Option<crate::extensions::Record>| Installed { name: name.into(), version: String::new(), dir: PathBuf::new(), record };
        let (c, _) = super::super::parse("[store]\ninstalled = [\"weather\", \"acme:todo\", \"calc\", \"mine\", \"here\"]\n").unwrap();
        let on_disk = [inst("weather", Some(rec("pal"))), inst("tan", None), inst("apps", Some(rec("pal"))), inst("gh", Some(crate::extensions::Record::from_source("github:a/b")))];
        let roots = Roots { bundled: BTreeSet::from(["calc".into(), "apps".into()]), local: BTreeSet::from(["mine".into()]) };
        let plan = reconcile(&c.store, &on_disk, &roots);
        assert_eq!(plan.install, [("acme".to_string(), "todo".to_string()), ("pal".into(), "here".into())], "missing ones only; bundled and local names never");
        assert_eq!(plan.unlisted, ["tan", "gh"], "the bundled update is not unlisted");
    }
}
