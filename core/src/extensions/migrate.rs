//! The move from "everything bundled" to registries (docs/design/distribution.md
//! "Migration"), as helpers the app runs in the last full-bundle release:
//! which extensions are in use, without reading any manifest ([`in_use`],
//! helped by the local record of opens, [`mark_used`]), and turning store copies of our own repo's extensions into registry
//! installs ([`convert_legacy`]).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use super::refs::{mentions, palette_owner};
use super::{write_record, Kind, Record, Result, Spec, Store};
use crate::config::{instance, Config, DEFAULT_FALLBACKS};
use crate::frecency::Frecency;
use crate::registry::{self, Channel, PAL};

/// `<data dir>/extensions-used.json`: every extension whose palette was
/// opened here, with when last (unix seconds). Kept whether usage sharing
/// is on or off and never sent anywhere: it is what carries the extensions
/// someone uses over when the bundle shrinks (docs/design/distribution.md
/// "Migration").
pub const USED: &str = "extensions-used.json";

/// The record of opens in `data_dir` ([`USED`]), empty when there is none.
pub fn used(data_dir: &Path) -> BTreeMap<String, u64> {
    std::fs::read(data_dir.join(USED)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// A palette of `key`'s extension (an instance counts for its extension)
/// was opened now.
pub fn mark_used(data_dir: &Path, key: &str) -> std::io::Result<()> {
    let mut all = used(data_dir);
    all.insert(instance::name_of(key).to_string(), registry::now());
    crate::fs::write_atomic(&data_dir.join(USED), serde_json::to_vec_pretty(&all).unwrap_or_default())
}

/// The names in `known` (every name a registry or the bundled root has)
/// that this setup uses: opened here ([`USED`]), or mentioned by
/// `[extensions.<n>]`, `[instances.<n>*]`, a `[palettes.<id>]` table (a
/// hotkey, an alias, any setting), a `bar.items` key, the sidebar palette,
/// `general.fallbacks` when it is not the default, a `[states]` expression,
/// or a frecency entry. A storage file does not count: extensions write
/// theirs on their own (a cache), used or not; game progress shows as
/// opens. A palette id (`clipboard-history`, `gmail@work-inbox`)
/// is its extension's name or starts with it and a `-`, so it counts for
/// the longest known name it starts with.
pub fn in_use(config: &Config, data_dir: &Path, frecency: Option<&Frecency>, known: &BTreeSet<String>) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut name = |key: &str| {
        let n = instance::name_of(key);
        if known.contains(n) {
            out.insert(n.to_string());
        }
    };
    config.extensions.keys().for_each(|k| name(k));
    config.instances.keys().for_each(|k| name(k));
    for key in config.bar.items.keys() {
        name(key.split('/').next().unwrap_or_default());
    }
    if let Some(p) = config.features.sidebar.palette() {
        name(p.split('/').next().unwrap_or_default());
    }
    for f in frecency.map(|f| f.extensions()).unwrap_or_default() {
        name(f);
    }
    for n in used(data_dir).keys() {
        name(n);
    }
    // The default order names calc, files and quicklinks for everyone: only an order someone set says anything.
    let fallbacks = if config.general.fallbacks.iter().eq(DEFAULT_FALLBACKS.iter()) { &[][..] } else { &config.general.fallbacks[..] };
    for id in config.palettes.keys().chain(fallbacks.iter()) {
        if let Some(n) = palette_owner(id, known) {
            out.insert(n.to_string());
        }
    }
    for decl in config.states.values() {
        let Some(expr) = &decl.expr else { continue };
        out.extend(known.iter().filter(|n| mentions(expr, n)).cloned());
    }
    out
}

/// What [`convert_legacy`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Legacy {
    /// Store copies whose source was `github:zcag/pal/extensions/<n>[@ref]`,
    /// now registry installs from `pal`.
    pub converted: Vec<String>,
    /// Of those, the ones that shadow a bundled extension (problem 4 in the
    /// design): the app decides whether they go.
    pub shadowing: Vec<String>,
}

/// Rewrites the record of every store copy installed from our repo's
/// source (`github:zcag/pal/extensions/<n>[@ref]`, `<n>` its own name) as
/// a registry install from `pal`: the hash is the tree's own, `seq` 0 so
/// any published build counts as newer, the commit the one it was fetched
/// at. The files stay as they are.
pub fn convert_legacy(store: &Store, bundled: &BTreeSet<String>) -> Result<Legacy> {
    let _lock = store.lock()?;
    let mut out = Legacy::default();
    for i in store.list()? {
        let Kind::Source(spec) = i.kind() else { continue };
        let ours = matches!(Spec::parse(spec), Ok(Spec::GitHub { owner, repo, subdir: Some(d), .. }) if owner == "zcag" && repo == "pal" && d == format!("extensions/{}", i.name));
        if !ours {
            continue;
        }
        // A tree that does not hash (a symlink bun left) still converts: an
        // empty hash equals no build, so the next published one replaces it.
        let hash = registry::tree_hash(&i.dir).unwrap_or_default();
        let commit = i.record.as_ref().and_then(|r| r.commit_or_etag.clone()).unwrap_or_default();
        write_record(&i.dir, &Record::from_registry(PAL, Channel::Stable, &hash, 0, registry::PROTOCOL, &commit))?;
        if bundled.contains(&i.name) {
            out.shadowing.push(i.name.clone());
        }
        out.converted.push(i.name);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn in_use_reads_every_mention() {
        let tmp = tempfile::tempdir().unwrap();
        let (config, _) = crate::config::parse(
            r#"
[general]
fallbacks = ["web", "quicklinks"]
[extensions.github]
token = "x"
[instances."gmail@work"]
[palettes.window-management-left]
alias = "l"
[palettes."clipboard-history"]
enabled = false
[bar.items."weather@home/now"]
[features.sidebar]
palette = "spotify/player"
[states.music]
expr = "spotify2.playing or not hue.on"
"#,
        )
        .unwrap();
        std::fs::create_dir_all(tmp.path().join("storage")).unwrap();
        std::fs::write(tmp.path().join("storage/github.json"), "{}").unwrap();
        mark_used(tmp.path(), "2048").unwrap();
        mark_used(tmp.path(), "gmail@home").unwrap();
        let mut f = Frecency::in_memory();
        f.record(&crate::frecency::Key::new("emoji", "emoji", "x"), std::time::SystemTime::now());
        let all = known(&["github", "gmail", "window", "window-management", "clipboard", "weather", "spotify", "spotify2", "hue", "2048", "emoji", "quicklinks", "unused", "on"]);
        let got = in_use(&config, tmp.path(), Some(&f), &all);
        assert_eq!(got, known(&["2048", "clipboard", "emoji", "github", "gmail", "hue", "quicklinks", "spotify", "spotify2", "weather", "window-management"]));
    }

    #[test]
    fn a_storage_file_or_the_default_fallbacks_are_not_use() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("storage")).unwrap();
        std::fs::write(tmp.path().join("storage/github.json"), "{}").unwrap();
        let all = known(&["github", "calc", "files", "quicklinks", "2048"]);
        let fresh = Config::default();
        assert!(in_use(&fresh, tmp.path(), None, &all).is_empty(), "a cache github wrote itself, and the default fallback order, say nothing");
        let (set, _) = crate::config::parse("[general]\nfallbacks = [\"web\", \"url\", \"quicklinks\", \"calc\", \"files\", \"github\"]\n").unwrap();
        assert_eq!(in_use(&set, tmp.path(), None, &all), known(&["calc", "files", "github", "quicklinks"]), "an order someone set counts whole");
        mark_used(tmp.path(), "2048").unwrap();
        let t = used(tmp.path())["2048"];
        assert!(t > 1_700_000_000);
        assert_eq!(in_use(&fresh, tmp.path(), None, &all), known(&["2048"]), "opened here: in use");
    }

    #[test]
    fn legacy_source_installs_become_registry_installs() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("extensions"));
        for (name, source) in [("calc", "github:zcag/pal/extensions/calc@v0.7.2"), ("wordle", "github:zcag/pal/extensions/wordle"), ("other", "github:someone/pal/extensions/other"), ("wrong", "github:zcag/pal/extensions/calc")] {
            let d = store.dir().join(name);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("pal.json"), format!(r#"{{"name":"{name}"}}"#)).unwrap();
            std::fs::write(d.join(super::super::RECORD), format!(r#"{{"source":"{source}","installed_at":1,"commit_or_etag":"abc"}}"#)).unwrap();
        }
        let out = convert_legacy(&store, &known(&["calc"])).unwrap();
        assert_eq!(out, Legacy { converted: vec!["calc".into(), "wordle".into()], shadowing: vec!["calc".into()] });
        let w = store.get("wordle").unwrap();
        let hash = registry::tree_hash(&w.dir).unwrap();
        assert_eq!(w.kind(), Kind::Registry { registry: "pal", channel: Channel::Stable, hash: &hash, seq: 0, protocol: registry::PROTOCOL });
        assert_eq!(w.record.unwrap().commit.as_deref(), Some("abc"));
        assert!(matches!(store.get("other").unwrap().kind(), Kind::Source(_)));
        assert!(matches!(store.get("wrong").unwrap().kind(), Kind::Source(_)), "a different name's source is not ours to convert");
    }
}
