//! The one update check (docs/design/distribution.md "Update detection").
//! Settings, the Store palette, the bar badge, `pal update` and `pal list`
//! all read [`check`]; none of them compares builds itself.
//!
//! For every installed registry extension and every bundled one: the build
//! [`registry::best_build`] picks from its registry's cached index is an
//! update when its `seq` is higher than the installed build's and its hash
//! differs. Equal hashes are never an update, whatever the `seq`. A bundled
//! extension compares its `.pal-build.json` (written by the app's build)
//! with our registry the same way, unless a store copy (its update) is what
//! loads, in which case that copy is compared. The indexes are whatever
//! [`Registries::refresh`] cached last; how fresh that is, is
//! [`Registries::status`]'s answer.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::extensions::{Installed, Kind, Result, Store};
use crate::registry::{self, Build, Index, Registries, PAL};

/// `.pal-build.json` beside a bundled extension's manifest: the registry
/// build it is.
pub const BUILD_FILE: &str = ".pal-build.json";

/// A build as installed: from `.pal-build.json` or an install record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuildInfo {
    pub hash: String,
    pub seq: u64,
    #[serde(default)]
    pub commit: String,
    pub protocol: u32,
}

impl BuildInfo {
    /// `<dir>/.pal-build.json`, when there is a readable one.
    pub fn read(dir: &Path) -> Option<BuildInfo> {
        serde_json::from_slice(&std::fs::read(dir.join(BUILD_FILE)).ok()?).ok()
    }

    /// What `b` is once installed.
    pub fn of(b: &Build) -> BuildInfo {
        BuildInfo { hash: b.hash.clone(), seq: b.seq, commit: b.commit.clone(), protocol: b.protocol }
    }
}

/// Every bundled extension's build: `<root>/<name>/.pal-build.json` for
/// each directory with a `pal.json`; `None` for one without the file (a
/// dev checkout, never built).
pub fn bundled_builds(root: &Path) -> BTreeMap<String, Option<BuildInfo>> {
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().join("pal.json").is_file())
        .map(|e| (e.file_name().to_string_lossy().into_owned(), BuildInfo::read(&e.path())))
        .collect()
}

/// What the check needs besides the store and the registries.
#[derive(Debug, Clone, Default)]
pub struct Inputs {
    /// The bundled root's extensions and their builds ([`bundled_builds`]).
    pub bundled: BTreeMap<String, Option<BuildInfo>>,
    /// Names a later root provides (`extension_dirs`, a dev repo root that
    /// wins over the store): shown as local, never checked.
    pub local: BTreeSet<String>,
}

/// Where the compared copy lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    /// In the bundled root, no store copy over it.
    Bundled,
    /// In the store.
    Store,
    /// In a local root.
    Local,
}

/// One extension's answer.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum State {
    UpToDate,
    /// `to` is newer (higher `seq`, another hash).
    Update { to: Build },
    /// Every newer build needs this protocol or later: "needs a newer pal".
    NeedsNewerPal { protocol: u32 },
    /// The installed build was yanked; `replacement` is the newest good
    /// one, when there is one.
    Yanked { replacement: Option<Build> },
    /// Its registry is no longer followed, or no longer lists it.
    NoLongerListed { why: String },
    /// Its registry has no cached index yet: not known either way.
    Unchecked,
    /// Installed from source: never checked.
    Source,
    /// Hand-made, in a local root, or a bundled copy without a build file.
    Local,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Status {
    pub name: String,
    pub origin: Origin,
    /// The registry it updates from (ours for bundled ones).
    pub registry: Option<String>,
    /// The build installed, when known.
    pub installed: Option<BuildInfo>,
    #[serde(flatten)]
    pub state: State,
    /// Whether its registry applies updates by itself.
    pub auto_update: bool,
}

impl Status {
    /// The build to install to act on this status: an update, or a yanked
    /// build's replacement.
    pub fn target(&self) -> Option<&Build> {
        match &self.state {
            State::Update { to } => Some(to),
            State::Yanked { replacement } => replacement.as_ref(),
            _ => None,
        }
    }
}

/// Every installed and bundled extension's status, by name.
pub fn check(store: &Store, regs: &Registries, inputs: &Inputs) -> Vec<Status> {
    let installed: BTreeMap<String, Installed> = store.list().unwrap_or_default().into_iter().map(|i| (i.name.clone(), i)).collect();
    let names: BTreeSet<&String> = installed.keys().chain(inputs.bundled.keys()).chain(inputs.local.iter()).collect();
    // Each index parsed once, not once per extension.
    let indexes: BTreeMap<&str, Index> = regs.sources().iter().filter_map(|s| Some((s.name.as_str(), regs.index(&s.name)?))).collect();
    names.into_iter().map(|name| status_of(name, installed.get(name), inputs, store, regs, &indexes)).collect()
}

fn status_of(name: &str, copy: Option<&Installed>, inputs: &Inputs, store: &Store, regs: &Registries, indexes: &BTreeMap<&str, Index>) -> Status {
    let plain = |origin, state| Status { name: name.into(), origin, registry: None, installed: None, state, auto_update: false };
    if inputs.local.contains(name) {
        return plain(Origin::Local, State::Local);
    }
    let (origin, registry, build) = match copy.map(Installed::kind) {
        Some(Kind::Registry { registry, hash, seq, protocol, .. }) => (Origin::Store, registry.to_string(), BuildInfo { hash: hash.into(), seq, protocol, commit: copy.and_then(|c| c.record.as_ref()?.commit.clone()).unwrap_or_default() }),
        Some(Kind::Source(_)) => return plain(Origin::Store, State::Source),
        Some(Kind::Hand) => return plain(Origin::Store, State::Local),
        None => match inputs.bundled.get(name) {
            Some(Some(b)) => (Origin::Bundled, PAL.to_string(), b.clone()),
            _ => return plain(Origin::Bundled, State::Local),
        },
    };
    let src = regs.source(&registry);
    let mut st = Status { name: name.into(), origin, registry: Some(registry.clone()), installed: Some(build.clone()), state: State::Unchecked, auto_update: src.is_some_and(|s| s.auto_update) };
    let Some(src) = src else {
        st.state = State::NoLongerListed { why: format!("registry {registry} is no longer followed") };
        return st;
    };
    let Some(index) = indexes.get(src.name.as_str()) else { return st };
    let Some(entry) = index.entry(name) else {
        st.state = State::NoLongerListed { why: format!("{registry} no longer lists {name}") };
        return st;
    };
    let bad = store.bad_builds(name);
    let best = registry::best_build(entry, registry::protocols(), registry::platform(), &bad);
    st.state = if entry.build(&build.hash).is_some_and(|b| b.yanked) {
        State::Yanked { replacement: best.filter(|b| b.hash != build.hash).cloned() }
    } else if let Some(to) = best.filter(|b| b.seq > build.seq && b.hash != build.hash) {
        State::Update { to: to.clone() }
    } else if let Some(protocol) = registry::needs_newer(entry, registry::protocols(), registry::platform(), &bad).filter(|_| newer_exists(entry, &build)) {
        State::NeedsNewerPal { protocol }
    } else {
        State::UpToDate
    };
    st
}

/// Whether the entry has a non-yanked build newer than `installed` with
/// another hash (the too-new one [`registry::needs_newer`] found).
fn newer_exists(entry: &registry::Entry, installed: &BuildInfo) -> bool {
    entry.builds.iter().any(|b| !b.yanked && b.seq > installed.seq && b.hash != installed.hash)
}

/// Installs what `status` points at ([`Status::target`]): the update, or a
/// yanked build's replacement. `None` when there is nothing to install.
pub fn apply(store: &Store, regs: &Registries, status: &Status) -> Option<Result<Installed>> {
    let build = status.target()?;
    let src = regs.source(status.registry.as_deref()?)?;
    let entry = regs.index(&src.name)?.entry(&status.name)?.clone();
    Some(store.install_build(src, &regs.build_keys(src), &entry, build))
}

/// After an app update: every store copy of a bundled extension from our
/// registry whose hash equals the new bundled build's, or whose `seq` is
/// lower, is removed (the bundled copy is as new or newer). Returns the
/// removed names.
pub fn cleanup_after_app_update(store: &Store, bundled: &BTreeMap<String, Option<BuildInfo>>) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for i in store.list()? {
        let Some(Some(b)) = bundled.get(&i.name) else { continue };
        let Kind::Registry { registry, hash, seq, .. } = i.kind() else { continue };
        if registry == PAL && (hash == b.hash || seq < b.seq) {
            store.remove(&i.name)?;
            out.push(i.name.clone());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::tests::Fixture;
    use crate::extensions::Roots;

    fn build(v: &serde_json::Value) -> Build {
        serde_json::from_value(v.clone()).unwrap()
    }

    fn info(b: &Build) -> BuildInfo {
        BuildInfo::of(b)
    }

    #[test]
    fn the_update_matrix() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("data/extensions"));
        // Our registry, served locally under its own name.
        let mut fx = Fixture::new(PAL);
        let (a1, a2) = (fx.build("behind", "1", 100, 1, None), fx.build("behind", "2", 200, 1, None));
        fx.list("behind", vec![a1.clone()], None);
        let same = fx.build("same", "1", 100, 1, None);
        fx.list("same", vec![same.clone()], None);
        let low = fx.build("lower", "1", 100, 1, None);
        fx.list("lower", vec![low.clone()], None);
        let y = fx.build("yank", "1", 100, 1, None);
        let y2 = fx.build("yank", "0", 90, 1, None);
        fx.list("yank", vec![y.clone(), y2.clone()], None);
        let n = fx.build("newer-pal", "1", 100, 1, None);
        fx.list("newer-pal", vec![n.clone()], None);
        let g = fx.build("gone", "1", 100, 1, None);
        fx.list("gone", vec![g], None);
        let regs = Registries::new(tmp.path().join("cache"), vec![fx.source()]);
        regs.refresh(PAL).unwrap();
        let none = Roots::default();
        for name in ["behind", "same", "lower", "yank", "newer-pal", "gone"] {
            store.install(&regs, name, None, &none).unwrap();
        }

        // Then the registry moves on.
        fx.list("behind", vec![a2.clone(), a1.clone()], None);
        // A higher seq with the same hash: the same build, never an update.
        let mut same_higher = same.clone();
        same_higher["seq"] = 300.into();
        let sig = fx.key.sign(registry::statement("same", same["hash"].as_str().unwrap(), 300, 1).as_bytes());
        same_higher["sig"] = sig.into();
        fx.list("same", vec![same_higher, same.clone()], None);
        // A lower seq with another hash: not newer.
        let low2 = fx.build("lower", "other", 50, 1, None);
        fx.list("lower", vec![low.clone(), low2], None);
        let mut yanked = y.clone();
        yanked["yanked"] = true.into();
        fx.list("yank", vec![yanked, y2.clone()], None);
        let n2 = fx.build("newer-pal", "2", 200, registry::PROTOCOL + 1, None);
        fx.list("newer-pal", vec![n2, n.clone()], None);
        fx.entries.retain(|e| e["name"] != "gone");
        fx.publish();
        regs.refresh(PAL).unwrap();
        // A bundled one behind, one equal, one without a build file; a local one.
        let bundled_old = fx.build("bundled", "old", 10, 1, None);
        let bundled_new = fx.build("bundled", "new", 20, 1, None);
        fx.list("bundled", vec![bundled_new.clone(), bundled_old.clone()], None);
        let eq = fx.build("bundled-eq", "x", 10, 1, None);
        fx.list("bundled-eq", vec![eq.clone()], None);
        regs.refresh(PAL).unwrap();
        // A hand-made one and a source install.
        std::fs::create_dir_all(store.dir().join("hand")).unwrap();
        std::fs::write(store.dir().join("hand/pal.json"), r#"{"name":"hand"}"#).unwrap();
        let inputs = Inputs {
            bundled: BTreeMap::from([("bundled".into(), Some(info(&build(&bundled_old)))), ("bundled-eq".into(), Some(info(&build(&eq)))), ("dev".into(), None), ("same".into(), Some(info(&build(&same))))]),
            local: BTreeSet::from(["mine".into()]),
        };

        let all = check(&store, &regs, &inputs);
        let of = |n: &str| all.iter().find(|s| s.name == n).unwrap_or_else(|| panic!("no {n}")).clone();
        assert_eq!(of("behind").state, State::Update { to: build(&a2) });
        assert_eq!(of("behind").installed.unwrap().seq, 100);
        assert_eq!(of("same").state, State::UpToDate, "equal hashes, higher seq");
        assert_eq!(of("same").origin, Origin::Store, "the store copy over the bundled one is what is compared");
        assert_eq!(of("lower").state, State::UpToDate, "lower seq, other hash");
        assert_eq!(of("yank").state, State::Yanked { replacement: Some(build(&y2)) });
        assert_eq!(of("newer-pal").state, State::NeedsNewerPal { protocol: registry::PROTOCOL + 1 });
        assert_eq!(of("bundled").state, State::Update { to: build(&bundled_new) });
        assert_eq!((of("bundled").origin, of("bundled").registry.as_deref()), (Origin::Bundled, Some(PAL)));
        assert_eq!(of("bundled-eq").state, State::UpToDate);
        assert_eq!(of("dev").state, State::Local);
        assert_eq!((of("mine").origin, of("mine").state), (Origin::Local, State::Local));
        assert_eq!(of("hand").state, State::Local);
        assert!(of("behind").auto_update);

        // A bad build is not offered.
        store.mark_bad("behind", a2["hash"].as_str().unwrap()).unwrap();
        assert_eq!(check(&store, &regs, &inputs).iter().find(|s| s.name == "behind").unwrap().state, State::UpToDate);

        // Apply takes the target and records it.
        let yank = of("yank");
        let got = apply(&store, &regs, &yank).unwrap().unwrap();
        assert_eq!(got.record.unwrap().hash.as_deref(), y2["hash"].as_str());
        assert!(apply(&store, &regs, &of("same")).is_none());
        let b = of("bundled");
        apply(&store, &regs, &b).unwrap().unwrap();
        assert_eq!(check(&store, &regs, &inputs).iter().find(|s| s.name == "bundled").unwrap().origin, Origin::Store, "the update is a store copy over the bundled one");

        // Gone from the index, and a registry no longer followed.
        assert!(matches!(of("gone").state, State::NoLongerListed { .. }));
        let unfollowed = Registries::new(tmp.path().join("cache2"), vec![]);
        let st = check(&store, &unfollowed, &inputs);
        assert!(matches!(st.iter().find(|s| s.name == "behind").unwrap().state, State::NoLongerListed { .. }));
    }

    #[test]
    fn unchecked_without_a_cached_index() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("extensions"));
        let fx = Fixture::new(PAL);
        let regs = Registries::new(tmp.path().join("cache"), vec![fx.source()]);
        let inputs = Inputs { bundled: BTreeMap::from([("calc".into(), Some(BuildInfo { hash: "h".into(), seq: 1, commit: String::new(), protocol: 1 }))]), local: BTreeSet::new() };
        assert_eq!(check(&store, &regs, &inputs)[0].state, State::Unchecked, "never reads as up to date");
    }

    #[test]
    fn cleanup_after_an_app_update() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("data/extensions"));
        let mut fx = Fixture::new(PAL);
        let (old, mid, new) = (fx.build("a", "old", 10, 1, None), fx.build("b", "mid", 20, 1, None), fx.build("c", "new", 30, 1, None));
        fx.list("a", vec![old.clone()], None);
        fx.list("b", vec![mid.clone()], None);
        fx.list("c", vec![new.clone()], None);
        let regs = Registries::new(tmp.path().join("cache"), vec![fx.source()]);
        regs.refresh(PAL).unwrap();
        for n in ["a", "b", "c"] {
            store.install(&regs, n, None, &Roots::default()).unwrap();
        }
        let bi = |hash: &str, seq| Some(BuildInfo { hash: hash.into(), seq, commit: String::new(), protocol: 1 });
        // a: the new bundled build is newer; b: the same build; c: the store copy is newer.
        let bundled = BTreeMap::from([("a".into(), bi("x", 15)), ("b".into(), bi(mid["hash"].as_str().unwrap(), 5)), ("c".into(), bi("y", 25))]);
        assert_eq!(cleanup_after_app_update(&store, &bundled).unwrap(), ["a", "b"]);
        assert_eq!(store.list().unwrap().iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["c"]);
    }

    #[test]
    fn bundled_builds_reads_the_build_files() {
        let tmp = tempfile::tempdir().unwrap();
        for (n, build) in [("calc", Some(r#"{"hash":"h","seq":3,"commit":"c","protocol":1}"#)), ("dev", None)] {
            std::fs::create_dir_all(tmp.path().join(n)).unwrap();
            std::fs::write(tmp.path().join(n).join("pal.json"), "{}").unwrap();
            if let Some(b) = build {
                std::fs::write(tmp.path().join(n).join(BUILD_FILE), b).unwrap();
            }
        }
        std::fs::create_dir_all(tmp.path().join("not-an-extension")).unwrap();
        let got = bundled_builds(tmp.path());
        assert_eq!(got.len(), 2);
        assert_eq!(got["calc"].as_ref().unwrap().seq, 3);
        assert!(got["dev"].is_none());
    }
}
