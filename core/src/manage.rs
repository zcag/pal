//! The extension operations as every UI runs them (Settings, the Store
//! palette, root search, Games, the CLI): the store change itself
//! (`crate::extensions`), then the config mirror (`[store] installed` and
//! `disabled`, UI first: the file follows what was done) and the usage
//! event (`crate::usage`, for our registry's extensions only). One path, so
//! no UI mirrors or counts differently.

use std::path::Path;

use crate::config::{ConfigFile, RegistryConfig};
use crate::extensions::{Error, Installed, Kind, Result, Roots, Store};
use crate::registry::{self, Preview, Refreshed, Registries, PAL};
use crate::updates::{self, Inputs, Status};
use crate::usage::{ErrorKind, Event, EventKind, From, Usage};

pub struct Manager {
    pub store: Store,
    pub registries: Registries,
    pub config: ConfigFile,
    pub inputs: Inputs,
    pub usage: Usage,
}

impl Manager {
    /// The store, registries and usage files at their places, the
    /// registries as `config` lists them now. `inputs` is what the app
    /// knows of its other roots.
    pub fn new(config: ConfigFile, inputs: Inputs) -> Manager {
        let registries = Registries::from_config(&config.load().config.store);
        Manager { store: Store::locate(), registries, config, inputs, usage: Usage::locate() }
    }

    pub fn roots(&self) -> Roots {
        Roots { bundled: self.inputs.bundled.keys().cloned().collect(), local: self.inputs.local.clone() }
    }

    /// Fetches every registry's index; a signed key rotation is written to
    /// the config at once.
    pub fn refresh(&self) -> Vec<(String, registry::Result<Refreshed>)> {
        let out = self.registries.refresh_all();
        for (name, r) in &out {
            if let Ok(Refreshed { rotated_to: Some(key), .. }) = r {
                let _ = self.config.store_set_registry_key(name, key);
            }
        }
        out
    }

    /// The one update check ([`updates::check`]).
    pub fn check(&self) -> Vec<Status> {
        updates::check(&self.store, &self.registries, &self.inputs)
    }

    /// Installs `name` from the registries (`Store::install`) and lists it.
    pub fn install(&self, name: &str, registry: Option<&str>, from: From) -> Result<Installed> {
        let r = self.store.install(&self.registries, name, registry, &self.roots());
        match &r {
            Ok(i) => {
                if let Kind::Registry { registry, hash, seq, .. } = i.kind() {
                    self.config.store_add_installed(registry, name)?;
                    if registry == PAL {
                        self.usage.record(Event::now(EventKind::Install, name, from).build(hash, seq));
                    }
                }
            }
            Err(e) => self.failed(name, registry.is_none_or(|r| r == PAL), from, e),
        }
        r
    }

    /// Installs a source (`Store::install_from`). Never listed in `[store]`
    /// and never counted: its name may be anything of anyone's.
    pub fn install_source(&self, spec: &str, bun: Option<&Path>) -> Result<Installed> {
        self.store.install_from(spec, bun, &self.roots())
    }

    /// Installs what `status` points at (an update, a yanked build's
    /// replacement), as `from` (`auto` for the background).
    pub fn apply(&self, status: &Status, from: From) -> Option<Result<Installed>> {
        let r = updates::apply(&self.store, &self.registries, status)?;
        let ours = status.registry.as_deref() == Some(PAL);
        match &r {
            Ok(i) if ours => {
                if let Kind::Registry { hash, seq, .. } = i.kind() {
                    self.usage.record(Event::now(EventKind::Update, &status.name, from).build(hash, seq));
                }
            }
            Err(e) => self.failed(&status.name, ours, from, e),
            _ => {}
        }
        Some(r)
    }

    /// Removes `name` from the store and from `[store] installed`. Its data stays.
    pub fn remove(&self, name: &str, from: From) -> Result<()> {
        let ours = self.is_ours(name);
        self.store.remove(name)?;
        self.config.store_remove_installed(name)?;
        if ours {
            self.usage.record(Event::now(EventKind::Remove, name, from));
        }
        Ok(())
    }

    /// Back to the previous generation (`Store::rollback`).
    pub fn rollback(&self, name: &str, from: From) -> Result<Installed> {
        let i = self.store.rollback(name)?;
        if let Kind::Registry { registry: PAL, hash, seq, .. } = i.kind() {
            self.usage.record(Event::now(EventKind::Rollback, name, from).build(hash, seq));
        }
        Ok(i)
    }

    /// Turns `name` off or on (`[store] disabled`), installed or not.
    pub fn set_disabled(&self, name: &str, disabled: bool, from: From) -> Result<()> {
        self.config.store_set_disabled(name, disabled)?;
        if self.is_ours(name) {
            self.usage.record(Event::now(if disabled { EventKind::Disable } else { EventKind::Enable }, name, from));
        }
        Ok(())
    }

    /// Follows the registry `preview` checked, pinning its key. Its name
    /// must be new and not ours.
    pub fn add_registry(&self, preview: &Preview) -> Result<()> {
        if preview.name == PAL || !crate::extensions::safe_name(&preview.name) || self.registries.source(&preview.name).is_some() {
            return Err(Error::Manifest(format!("a registry named {:?} is already followed or not allowed", preview.name)));
        }
        self.config.store_add_registry(&RegistryConfig { name: preview.name.clone(), url: preview.url.clone(), key: preview.key.clone(), ..Default::default() })?;
        Ok(())
    }

    /// Stops following `name` (never ours) and drops its cache. Its
    /// extensions stay installed and are reported as no longer listed.
    pub fn remove_registry(&self, name: &str) -> Result<()> {
        if name == PAL {
            return Err(Error::Manifest("pal's own registry cannot be removed".into()));
        }
        self.config.store_remove_registry(name)?;
        self.registries.forget(name);
        Ok(())
    }

    /// Whether `name` is ours to count: bundled, or installed from our registry.
    fn is_ours(&self, name: &str) -> bool {
        self.inputs.bundled.contains_key(name) || self.store.get(name).is_ok_and(|i| matches!(i.kind(), Kind::Registry { registry: PAL, .. }))
    }

    fn failed(&self, name: &str, ours: bool, from: From, e: &Error) {
        let kind = match e {
            Error::Download(_) => ErrorKind::Download,
            Error::Registry(registry::Error::Network(..)) => ErrorKind::Offline,
            Error::Verify(..) | Error::Registry(_) => ErrorKind::Verify,
            Error::NeedsNewer(..) | Error::Platform(..) => ErrorKind::Incompatible,
            // Refusals (a clash, unknown, exists) are answers, not failures.
            _ => return,
        };
        if ours {
            self.usage.record(Event::now(EventKind::Fail, name, from).error(kind));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::tests::Fixture;
    use crate::registry::tests::index_json;
    use crate::registry::Source;
    use crate::testutil::Signer;
    use std::collections::{BTreeMap, BTreeSet};

    fn manager(tmp: &Path, sources: Vec<Source>) -> Manager {
        let usage = Usage::at(tmp.join("data"));
        usage.set_enabled(true).unwrap();
        let inputs = Inputs { bundled: BTreeMap::from([("calc".into(), None)]), local: BTreeSet::new() };
        Manager { store: Store::at(tmp.join("data/extensions")), registries: Registries::new(tmp.join("cache"), sources), config: ConfigFile::new(tmp.join("config.toml")), inputs, usage }
    }

    fn queued(m: &Manager) -> Vec<Event> {
        std::fs::read_to_string(m.usage.dir().join("usage-queue.jsonl")).unwrap_or_default().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    #[test]
    fn operations_mirror_the_config_and_count_ours_only() {
        let tmp = tempfile::tempdir().unwrap();
        let (mut ours, mut acme) = (Fixture::new(PAL), Fixture::new("acme"));
        for fx in [&mut ours, &mut acme] {
            let b = fx.build("todo", "x", 1, 1, None);
            fx.list("todo", vec![b], None);
            let only = format!("{}-only", fx.name);
            let b = fx.build(&only, "x", 1, 1, None);
            fx.list(&only, vec![b], None);
        }
        let m = manager(tmp.path(), vec![ours.source(), acme.source()]);
        assert!(m.refresh().iter().all(|(_, r)| r.is_ok()));

        m.install("todo", None, From::Store).unwrap();
        m.install("acme-only", None, From::Cli).unwrap();
        assert_eq!(m.config.load().config.store.installed, ["todo", "acme:acme-only"]);
        let ev = queued(&m);
        assert_eq!(ev.iter().map(|e| (e.kind, e.ext.as_str(), e.from)).collect::<Vec<_>>(), [(EventKind::Install, "todo", From::Store)], "never another registry's names");
        assert!(ev[0].hash.is_some());

        m.set_disabled("todo", true, From::Settings).unwrap();
        m.set_disabled("acme-only", true, From::Settings).unwrap();
        assert_eq!(m.config.load().config.store.disabled, ["todo", "acme-only"]);
        m.remove("acme-only", From::Cli).unwrap();
        m.remove("todo", From::Cli).unwrap();
        assert!(m.config.load().config.store.installed.is_empty());
        assert_eq!(queued(&m).iter().map(|e| e.kind).collect::<Vec<_>>(), [EventKind::Install, EventKind::Disable, EventKind::Remove]);

        // A failed install of ours is counted with its kind only.
        let bad = ours.build("broken", "x", 1, 1, Some(&Signer::new()));
        ours.list("broken", vec![bad], None);
        m.refresh();
        assert!(matches!(m.install("broken", None, From::Search), Err(Error::Verify(..))));
        let last = queued(&m).pop().unwrap();
        assert_eq!((last.kind, last.error), (EventKind::Fail, Some(ErrorKind::Verify)));
        assert!(!m.config.load().config.store.installed.contains(&"broken".to_string()));
    }

    #[test]
    fn registries_are_added_rotated_and_removed_through_the_config() {
        let tmp = tempfile::tempdir().unwrap();
        let mut acme = Fixture::new("acme");
        let b = acme.build("todo", "x", 1, 1, None);
        acme.list("todo", vec![b], None);
        let p = registry::preview(&acme.source().url, Some(&acme.key.public)).unwrap();
        let m = manager(tmp.path(), vec![]);
        m.add_registry(&p).unwrap();
        let c = m.config.load().config;
        assert_eq!((c.store.registries[0].name.as_str(), c.store.registries[0].key.as_str()), ("acme", acme.key.public.as_str()));
        assert!(m.add_registry(&Preview { name: PAL.into(), ..p.clone() }).is_err(), "never a second pal");

        // Followed as the config says; a signed rotation lands in the config.
        let m = manager(tmp.path(), registry::sources(&c.store).into_iter().filter(|s| !s.is_ours()).collect());
        let next = Signer::new();
        let publish = |at: &str, announce: Option<&str>, by: &Signer| {
            let text = index_json("acme", at, announce, serde_json::json!([]));
            acme.server.ok("/acme/index.json", text.clone());
            acme.server.ok("/acme/index.json.minisig", by.sign(text.as_bytes()));
        };
        publish("2026-09-30T13:00:00Z", Some(&next.public), &acme.key);
        assert!(m.refresh().iter().all(|(_, r)| r.is_ok()));
        publish("2026-09-30T14:00:00Z", None, &next);
        let r = m.refresh();
        assert!(r[0].1.is_ok(), "{r:?}");
        assert_eq!(m.config.load().config.store.registries[0].key, next.public);

        assert!(m.remove_registry(PAL).is_err());
        m.remove_registry("acme").unwrap();
        assert!(m.config.load().config.store.registries.is_empty());
    }
}
