//! First launch: no config file yet, so write the commented template, so
//! what a new user opens to edit is a file that explains itself (its
//! `#:schema` line points at the published schema, so an editor can
//! validate it). A pal v1 config at the path is migrated first
//! (`pal_core::config::migrate`): kept whole as `config.v1.toml` and run
//! through the `scripts` extension, with a new `config.toml` pointing at
//! it. Any other existing file is left alone.

use pal_core::config::{migrate, spec_defaults, ConfigFile};

/// The `scripts` extension's `v1_repo` default: where a `base` that is
/// gone from disk is looked for (the v1 checkout).
const SCRIPTS_MANIFEST: &str = include_str!("../../../extensions/scripts/pal.json");

fn v1_repo() -> String {
    let manifest: serde_json::Value = serde_json::from_str(SCRIPTS_MANIFEST).expect("bundled pal.json parses");
    spec_defaults(&manifest["settings"]).get("v1_repo").and_then(toml::Value::as_str).unwrap_or("~/proj/pal-v1").to_string()
}

pub fn install() {
    let file = ConfigFile::locate();
    match migrate::migrate(&file, &v1_repo()) {
        Ok(Some(m)) => m.notes.iter().for_each(|n| eprintln!("migrate\t{n}")),
        Ok(None) => {}
        Err(e) => eprintln!("migrate\tfailed\t{e}"),
    }
    if !file.path().exists() {
        // An empty edit on a missing file creates it from `TEMPLATE`.
        match file.edit(|_| Ok(())) {
            Ok(()) => eprintln!("config\tcreated\t{}", file.path().display()),
            Err(e) => eprintln!("config\tcreate failed\t{e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn v1_repo_comes_from_the_scripts_manifest() {
        assert_eq!(super::v1_repo(), "~/proj/pal-v1");
    }
}
