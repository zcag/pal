//! First launch: no config file yet, so write the commented template, so
//! what a new user opens to edit is a file that explains itself (its
//! `#:schema` line points at the published schema, so an editor can
//! validate it). A pal v1 config at the path is migrated first
//! (`pal_core::config::migrate`): kept whole as `config.v1.toml` and run
//! through the `scripts` extension, with a new `config.toml` pointing at
//! it. Any other existing file is left alone.

use pal_core::config::{migrate, ConfigFile};

/// Where a `base` that is gone from disk is looked for (the v1 checkout):
/// the `scripts` extension's `v1_repo` default, which lives in
/// zcag/pal-extensions now, so it is written here too.
pub(crate) fn v1_repo() -> String {
    "~/proj/pal-v1".to_string()
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
    /// The scripts manifest's default, where a checkout of the extensions has it.
    #[test]
    fn v1_repo_is_the_scripts_manifests_default() {
        let repos = pal_core::extensions::dev::repos(std::path::Path::new(crate::host::REPO));
        let Some((_, dir)) = pal_core::extensions::dev::extensions(&repos).into_iter().find(|(n, _)| n == "scripts") else { return };
        let manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("pal.json")).unwrap()).unwrap();
        let default = pal_core::config::spec_defaults(&manifest["settings"]).get("v1_repo").and_then(toml::Value::as_str).map(String::from);
        assert_eq!(default.as_deref(), Some(super::v1_repo().as_str()));
    }
}
