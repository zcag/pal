//! The extension operations as every UI runs them (Settings, the Store
//! palette, root search, Games, the CLI): the store change itself
//! (`crate::extensions`), then the config mirror (`[store] installed` and
//! `disabled`, UI first: the file follows what was done) and the usage
//! event (`crate::usage`, for our registry's extensions only). One path, so
//! no UI mirrors or counts differently.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;

use crate::config::{ConfigFile, RegistryConfig};
use crate::extensions::{Error, Installed, Kind, Result, Roots, Store};
use crate::registry::{self, Listing, Preview, Refreshed, Registries, PAL};
use crate::updates::{self, BuildInfo, Inputs, Status};
use crate::usage::{ErrorKind, Event, EventKind, From, Usage};

/// One listed extension of one registry, as the Store, root search and
/// Games offer it (`Available` in docs/design/distribution.md's contract).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Available {
    pub name: String,
    pub registry: String,
    pub listing: Listing,
    /// What is installed is this registry's build of it (a bundled one is ours).
    pub installed: bool,
    /// Ours, and comes with pal.
    pub bundled: bool,
    /// A build runs here and no other source has the name.
    pub installable: bool,
    /// Why not installable: `needs pal with protocol N`, `not for this
    /// platform`, `provided by <registry>`, `a local copy`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<String>,
    /// The build an install would get.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build: Option<BuildInfo>,
}

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

    /// Every extension every cached index lists, ours first, each with
    /// whether it is installed and can be.
    pub fn available(&self) -> Vec<Available> {
        let copies: BTreeMap<String, Installed> = self.store.list().unwrap_or_default().into_iter().map(|i| (i.name.clone(), i)).collect();
        let mut out = Vec::new();
        for src in self.registries.sources() {
            let Some(index) = self.registries.index(&src.name) else { continue };
            for e in index.extensions {
                let copy = copies.get(&e.name).map(Installed::kind);
                let bundled = src.is_ours() && self.inputs.bundled.contains_key(&e.name);
                let local = self.inputs.local.contains(&e.name);
                let installed = !local && match copy {
                    Some(Kind::Registry { registry, .. }) => registry == src.name,
                    Some(_) => false,
                    None => bundled,
                };
                let bad = self.store.bad_builds(&e.name);
                let best = registry::best_build(&e, registry::protocols(), registry::platform(), &bad);
                let blocked = match copy {
                    _ if local => Some("a local copy".to_string()),
                    Some(Kind::Registry { registry, .. }) if registry != src.name => Some(format!("provided by {registry}")),
                    Some(Kind::Source(_) | Kind::Hand) => Some("a local copy".into()),
                    _ if !src.is_ours() && self.inputs.bundled.contains_key(&e.name) => Some(format!("provided by {PAL}")),
                    _ if best.is_some() => None,
                    _ => Some(match registry::needs_newer(&e, registry::protocols(), registry::platform(), &bad) {
                        Some(p) => format!("needs pal with protocol {p}"),
                        None if !e.runs_on(registry::platform()) => "not for this platform".into(),
                        None => "no build to install".into(),
                    }),
                };
                out.push(Available { build: best.map(BuildInfo::of), installable: blocked.is_none(), blocked, installed, bundled, registry: src.name.clone(), listing: e.listing, name: e.name });
            }
        }
        out
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

    /// Follows the registry `preview` checked, pinning its key, with the
    /// `password` it asked for kept in the keychain. Its name must be new
    /// and not ours.
    pub fn add_registry(&self, preview: &Preview, password: Option<&str>) -> Result<()> {
        if preview.name == PAL || !crate::extensions::safe_name(&preview.name) || self.registries.source(&preview.name).is_some() {
            return Err(Error::Manifest(format!("a registry named {:?} is already followed or not allowed", preview.name)));
        }
        let auth = password.filter(|p| !p.trim().is_empty()).map(|p| self.keep_password(&preview.name, p)).transpose()?;
        self.config.store_add_registry(&RegistryConfig { name: preview.name.clone(), url: preview.url.clone(), key: preview.key.clone(), auth, ..Default::default() })?;
        Ok(())
    }

    /// A followed registry's password: into the keychain, its reference
    /// into the config. Checked at its next fetch.
    pub fn set_registry_password(&self, name: &str, password: &str) -> Result<()> {
        if name == PAL || self.config.load().config.store.registries.iter().all(|r| r.name != name) {
            return Err(Error::Manifest(format!("no registry named {name:?} is followed")));
        }
        if password.trim().is_empty() {
            return Err(Error::Manifest("the password is empty".into()));
        }
        let auth = self.keep_password(name, password)?;
        self.config.store_set_registry_auth(name, &auth)?;
        Ok(())
    }

    fn keep_password(&self, registry: &str, password: &str) -> Result<String> {
        let key = password_key(registry);
        self.registries.secrets().set(&key, password.trim()).map_err(|e| Error::Manifest(format!("could not keep the password: {e}")))?;
        Ok(format!("keychain:{key}"))
    }

    /// Stops following `name` (never ours) and drops its cache and the
    /// password pal kept for it. Its extensions stay installed and are
    /// reported as no longer listed.
    pub fn remove_registry(&self, name: &str) -> Result<()> {
        if name == PAL {
            return Err(Error::Manifest("pal's own registry cannot be removed".into()));
        }
        let kept = self.config.load().config.store.registries.iter().any(|r| r.name == name && r.auth.as_deref() == Some(&format!("keychain:{}", password_key(name))));
        self.config.store_remove_registry(name)?;
        self.registries.forget(name);
        if kept {
            let _ = self.registries.secrets().delete(&password_key(name));
        }
        Ok(())
    }

    /// Whether `name` is ours to count (docs/usage.md): bundled, or
    /// installed from our registry. Another registry's names never leave.
    pub fn is_ours(&self, name: &str) -> bool {
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

/// Where pal keeps a registry's password: `keychain:pal/registry-<name>`.
fn password_key(registry: &str) -> String {
    format!("pal/registry-{registry}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::secrets::{MemStore, SecretStore};
    use crate::extensions::tests::Fixture;
    use crate::registry::tests::index_json;
    use crate::registry::Source;
    use crate::testutil::Signer;
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::Arc;

    fn manager(tmp: &Path, sources: Vec<Source>) -> Manager {
        manager_with(tmp, sources, Arc::new(MemStore::default()))
    }

    fn manager_with(tmp: &Path, sources: Vec<Source>, secrets: Arc<MemStore>) -> Manager {
        let usage = Usage::at(tmp.join("data"));
        usage.set_enabled(true).unwrap();
        let inputs = Inputs { bundled: BTreeMap::from([("calc".into(), None)]), local: BTreeSet::new() };
        Manager { store: Store::at(tmp.join("data/extensions")), registries: Registries::new(tmp.join("cache"), sources).with_secrets(secrets), config: ConfigFile::new(tmp.join("config.toml")), inputs, usage }
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
    fn available_says_what_is_installed_and_what_can_be() {
        let tmp = tempfile::tempdir().unwrap();
        let (mut ours, mut acme) = (Fixture::new(PAL), Fixture::new("acme"));
        for (fx, names) in [(&mut ours, &["todo", "calc", "mine", "later", "elsewhere"][..]), (&mut acme, &["todo", "calc", "extra"][..])] {
            for n in names {
                let protocol = if *n == "later" { registry::PROTOCOL + 1 } else { 1 };
                let b = fx.build(n, "x", 1, protocol, None);
                fx.list(n, vec![b], (*n == "elsewhere").then_some(&["plan9"][..]));
            }
        }
        let mut m = manager(tmp.path(), vec![ours.source(), acme.source()]);
        m.inputs.local.insert("mine".into());
        m.refresh();
        m.install("extra", None, From::Store).unwrap();
        let all = m.available();
        let of = |r: &str, n: &str| all.iter().find(|a| a.registry == r && a.name == n).unwrap_or_else(|| panic!("no {r}/{n}")).clone();
        let todo = of(PAL, "todo");
        assert!(todo.installable && !todo.installed && todo.blocked.is_none() && todo.build.is_some());
        assert!(of("acme", "todo").installable, "listed twice: either may be installed");
        let calc = of(PAL, "calc");
        assert!(calc.bundled && calc.installed, "a bundled one is ours, installed");
        assert_eq!(of("acme", "calc").blocked.as_deref(), Some("provided by pal"));
        assert_eq!(of(PAL, "mine").blocked.as_deref(), Some("a local copy"));
        assert_eq!(of(PAL, "later").blocked, Some(format!("needs pal with protocol {}", registry::PROTOCOL + 1)));
        assert_eq!(of(PAL, "elsewhere").blocked.as_deref(), Some("not for this platform"));
        assert!(of("acme", "extra").installed && of("acme", "extra").installable);
        assert_eq!(all.iter().position(|a| a.registry == "acme"), Some(5), "ours first");
    }

    #[test]
    fn registries_are_added_rotated_and_removed_through_the_config() {
        let tmp = tempfile::tempdir().unwrap();
        let mut acme = Fixture::new("acme");
        let b = acme.build("todo", "x", 1, 1, None);
        acme.list("todo", vec![b], None);
        let p = registry::preview(&acme.source().url, Some(&acme.key.public), None).unwrap();
        let m = manager(tmp.path(), vec![]);
        m.add_registry(&p, None).unwrap();
        let c = m.config.load().config;
        assert_eq!((c.store.registries[0].name.as_str(), c.store.registries[0].key.as_str()), ("acme", acme.key.public.as_str()));
        assert!(m.add_registry(&Preview { name: PAL.into(), ..p.clone() }, None).is_err(), "never a second pal");

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

    #[test]
    fn a_registry_behind_a_password() {
        let tmp = tempfile::tempdir().unwrap();
        let (mut acme, cdn) = (Fixture::new("acme"), Fixture::new("cdn"));
        let here = acme.build("todo", "x", 1, 1, None);
        let elsewhere = cdn.build("notes", "y", 1, 1, Some(&acme.key));
        acme.list("todo", vec![here], None);
        acme.list("notes", vec![elsewhere], None);
        acme.server.header(r#"WWW-Authenticate: Bearer realm="acme", hint="Ask Ada""#);
        acme.server.handle(|r| match r.headers.get("authorization").map(String::as_str) {
            Some("Bearer s3cret") => None,
            Some(_) => Some((403, Vec::new())),
            None => Some((401, Vec::new())),
        });
        let url = acme.source().url;
        let gate = |r: registry::Result<Preview>| match r {
            Err(registry::Error::Password { gate, .. }) => (gate.realm.unwrap_or_default(), gate.hint.unwrap_or_default(), gate.refused),
            r => panic!("{r:?}"),
        };
        assert_eq!(gate(registry::preview(&url, Some(&acme.key.public), None)), ("acme".into(), "Ask Ada".into(), false));
        assert_eq!(gate(registry::preview(&url, Some(&acme.key.public), Some("nope"))), ("acme".into(), "Ask Ada".into(), true));
        let p = registry::preview(&url, Some(&acme.key.public), Some("s3cret")).unwrap();

        let secrets = Arc::new(MemStore::default());
        manager_with(tmp.path(), vec![], secrets.clone()).add_registry(&p, Some("s3cret")).unwrap();
        let c = ConfigFile::new(tmp.path().join("config.toml")).load().config;
        assert_eq!(c.store.registries[0].auth.as_deref(), Some("keychain:pal/registry-acme"));
        assert_eq!(secrets.get("pal/registry-acme").unwrap(), "s3cret");
        assert!(!std::fs::read_to_string(tmp.path().join("config.toml")).unwrap().contains("s3cret"), "only the reference is written");

        let followed = |secrets: &Arc<MemStore>| manager_with(tmp.path(), registry::sources(&ConfigFile::new(tmp.path().join("config.toml")).load().config.store).into_iter().filter(|s| !s.is_ours()).collect(), secrets.clone());
        let m = followed(&secrets);
        assert!(m.refresh().iter().all(|(_, r)| r.is_ok()));
        assert_eq!(m.registries.status()[0].gate, None);
        m.install("todo", None, From::Cli).unwrap();
        m.install("notes", None, From::Cli).unwrap();
        let auth_of = |s: &crate::testutil::Server, at: &str| s.requests.lock().unwrap().iter().filter(|r| r.path.starts_with(at)).map(|r| r.headers.get("authorization").cloned()).collect::<Vec<_>>();
        assert_eq!(auth_of(&acme.server, "/pkg/"), vec![Some("Bearer s3cret".to_string())]);
        assert_eq!(auth_of(&acme.server, "/acme/").last(), Some(&Some("Bearer s3cret".to_string())), "the index and its signature");
        assert_eq!(auth_of(&cdn.server, "/"), vec![None], "a package on another origin never gets the password");

        secrets.set("pal/registry-acme", "old").unwrap();
        acme.publish();
        let r = m.refresh();
        assert!(matches!(&r[0].1, Err(registry::Error::Password { gate, .. }) if gate.refused), "{r:?}");
        let st = &m.registries.status()[0];
        assert_eq!((st.gate.clone(), st.auth), (Some(registry::Gate { realm: Some("acme".into()), hint: Some("Ask Ada".into()), refused: true }), true));
        assert!(m.store.get("todo").is_ok(), "what is installed stays");

        m.set_registry_password("acme", "s3cret").unwrap();
        assert!(m.refresh()[0].1.is_ok());
        assert_eq!(m.registries.status()[0].gate, None);
        assert!(m.set_registry_password("nobody", "x").is_err() && m.set_registry_password(PAL, "x").is_err());

        secrets.delete("pal/registry-acme").unwrap();
        let m = followed(&secrets);
        acme.publish();
        assert!(m.refresh()[0].1.is_err());
        assert_eq!(m.registries.status()[0].gate.as_ref().map(|g| g.refused), Some(false), "a machine without it is asked, not told it was wrong");

        m.set_registry_password("acme", "s3cret").unwrap();
        m.remove_registry("acme").unwrap();
        assert!(secrets.get("pal/registry-acme").is_err(), "the password goes with the registry");
    }
}
