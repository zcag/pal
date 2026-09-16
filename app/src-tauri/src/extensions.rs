//! The extensions capability for the store palette: `core/extensions.list`
//! answers every extension the app knows (bundled, from the user store,
//! from `general.extension_dirs`), with where each came from and its
//! version, so the palette can tag what is installed and what is behind
//! the site. `install`, `update` and `remove` hand the work to the deep
//! link routes (`pal://install/<spec>` and its twins, deeplink.rs) and
//! return at once: the bridge runs on the host's blocking thread and the
//! store restarts the host, so a reply after the work would never arrive.
//! The trusted path (no card) is right here: the palette asks through
//! `Action.confirm` before it calls, and Enter in the panel is the user's
//! hand. The HUD says "Installing…" and then the outcome, as for a link.

use std::path::Path;

use pal_core::extensions::Store;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::settings;

/// One extension as the palette sees it (`InstalledExtension` in api.ts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Row {
    pub name: String,
    /// The manifest's `version`; empty when it states none.
    pub version: String,
    pub root: String,
    pub loaded: bool,
    /// Installed by `pal install` (the user store): can be updated and removed.
    pub store: bool,
    /// Ships with the app: neither the store's nor a configured directory's.
    pub bundled: bool,
}

/// Where an extension came from, by its root: the store's directory, one
/// of `general.extension_dirs`, else the bundled tree.
fn classify(root: &str, store_dir: &Path, extra: &[std::path::PathBuf]) -> (bool, bool) {
    let r = Path::new(root);
    let store = r == store_dir;
    let bundled = !store && !extra.iter().any(|d| d == r);
    (store, bundled)
}

/// What `list` reads of one registered extension: the manifest's name
/// (an instance of a `multi` extension shares it), its manifest, its root
/// and whether it loaded.
pub struct Known<'a> {
    pub name: &'a str,
    pub manifest: &'a Value,
    pub root: &'a str,
    pub loaded: bool,
}

fn row(e: &Known, store_dir: &Path, extra: &[std::path::PathBuf]) -> Row {
    let (store, bundled) = classify(e.root, store_dir, extra);
    Row {
        name: e.name.to_string(),
        version: e.manifest.get("version").map(|v| match v { Value::String(s) => s.clone(), other => other.to_string() }).unwrap_or_default(),
        root: e.root.to_string(),
        loaded: e.loaded,
        store,
        bundled,
    }
}

/// One row per extension name, by name: a `multi` extension registered
/// once per instance is still one extension to install or remove, and a
/// loaded instance counts for the whole.
pub fn rows<'a>(known: impl IntoIterator<Item = Known<'a>>, store_dir: &Path, extra: &[std::path::PathBuf]) -> Vec<Row> {
    let mut out: Vec<Row> = Vec::new();
    for k in known {
        match out.iter_mut().find(|r| r.name == k.name) {
            Some(r) => r.loaded |= k.loaded,
            None => out.push(row(&k, store_dir, extra)),
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn list(app: &AppHandle) -> Vec<Row> {
    let store_dir = Store::locate().dir().to_path_buf();
    let extra = settings::config(app).general.extension_dirs();
    let exts = settings::extensions(app);
    rows(exts.iter().map(|e| Known { name: &e.name, manifest: &e.manifest, root: &e.root, loaded: e.loaded }), &store_dir, &extra)
}

/// A store name or spec as the link grammar takes it: no slashes that
/// would read as more parts, nothing empty.
fn part(params: &Value, key: &str) -> Result<String, String> {
    let s = params.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| format!("extensions: `{key}` is required"))?;
    Ok(s.to_string())
}

pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "list" => serde_json::to_value(list(app)).map_err(|e| e.to_string()),
        "install" => {
            let spec = part(&params, "spec")?;
            crate::deeplink::handle_trusted(app, &format!("pal://install/{spec}"));
            Ok(Value::Null)
        }
        "update" => {
            let name = part(&params, "name")?;
            crate::deeplink::handle_trusted(app, &format!("pal://update/{name}"));
            Ok(Value::Null)
        }
        "remove" => {
            let name = part(&params, "name")?;
            crate::deeplink::handle_trusted(app, &format!("pal://remove/{name}"));
            Ok(Value::Null)
        }
        _ => Err(format!("unknown extensions.{func}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn a_root_says_where_an_extension_came_from() {
        let store = PathBuf::from("/data/pal/extensions");
        let extra = vec![PathBuf::from("/home/x/dotfiles/pal")];
        assert_eq!(classify("/data/pal/extensions", &store, &extra), (true, false));
        assert_eq!(classify("/home/x/dotfiles/pal", &store, &extra), (false, false));
        assert_eq!(classify("/app/resources/extensions", &store, &extra), (false, true));
    }

    #[test]
    fn rows_carry_the_manifest_version_as_text_and_one_row_per_name() {
        let store = PathBuf::from("/data/pal/extensions");
        let (calc, x, y, gmail) = (json!({ "version": "0.2.0" }), json!({ "version": 2 }), json!({}), json!({ "version": "1.0.0", "multi": true }));
        let known = vec![
            Known { name: "calc", manifest: &calc, root: "/app/resources/extensions", loaded: true },
            Known { name: "x", manifest: &x, root: "/data/pal/extensions", loaded: true },
            Known { name: "y", manifest: &y, root: "/data/pal/extensions", loaded: false },
            Known { name: "gmail", manifest: &gmail, root: "/data/pal/extensions", loaded: false },
            Known { name: "gmail", manifest: &gmail, root: "/data/pal/extensions", loaded: true },
        ];
        let r = rows(known, &store, &[]);
        assert_eq!(r[0], Row { name: "calc".into(), version: "0.2.0".into(), root: "/app/resources/extensions".into(), loaded: true, store: false, bundled: true });
        assert_eq!(r.iter().filter(|r| r.name == "gmail").count(), 1, "an instance per row on the registry, one extension here");
        assert!(r.iter().find(|r| r.name == "gmail").unwrap().loaded, "a loaded instance counts for the whole");
        assert_eq!(r.iter().find(|r| r.name == "x").unwrap().version, "2", "a numeric version reads as text");
        assert_eq!(r.iter().find(|r| r.name == "y").unwrap().version, "", "none stated");
        assert!(r.iter().find(|r| r.name == "y").unwrap().store);
    }

    #[test]
    fn install_update_and_remove_need_their_part() {
        assert_eq!(part(&json!({ "spec": " wordle " }), "spec").unwrap(), "wordle");
        assert!(part(&json!({}), "name").unwrap_err().contains("required"));
        assert!(part(&json!({ "name": "" }), "name").is_err());
    }
}
