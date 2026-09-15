//! JSON Schema for the typed part of the file, for editors.
//!
//! taplo (VS Code "Even Better TOML", nvim via LSP) reads a `#:schema <path
//! or url>` comment on the file's first line; [`TEMPLATE`](super::TEMPLATE)
//! writes one pointing at `./config.schema.json`, and [`install`] puts the
//! schema there. The `x-taplo-info.patterns` on the root also lets taplo's
//! catalog match `**/pal/config.toml` without the directive once the schema
//! is published at a URL.

use std::path::{Path, PathBuf};

use super::Config;

pub const FILE_NAME: &str = "config.schema.json";

/// The schema as pretty JSON. Committed copy: `core/schema/config.schema.json`.
pub fn json() -> String {
    // TOML has no null: an unset `Option` is an absent key, so neither the
    // `null` type nor a `null` default belongs in what the editor shows.
    let mut schema = schemars::schema_for!(Config).to_value();
    strip_null(&mut schema);
    serde_json::to_string_pretty(&schema).expect("schema is JSON") + "\n"
}

fn strip_null(v: &mut serde_json::Value) {
    use serde_json::Value::{Array, Object};
    match v {
        Object(o) => {
            if o.get("default").is_some_and(serde_json::Value::is_null) {
                o.remove("default");
            }
            if let Some(Array(types)) = o.get_mut("type") {
                types.retain(|t| t != "null");
                if let [one] = types.as_slice() {
                    let one = one.clone();
                    o.insert("type".into(), one);
                }
            }
            o.values_mut().for_each(strip_null);
        }
        Array(a) => a.iter_mut().for_each(strip_null),
        _ => {}
    }
}

/// Write the schema next to `config_path` (only when its bytes differ, so
/// nothing watching the directory wakes for nothing). Returns the path.
pub fn install(config_path: &Path) -> std::io::Result<PathBuf> {
    let path = config_path.parent().unwrap_or(Path::new(".")).join(FILE_NAME);
    let text = json();
    if std::fs::read_to_string(&path).ok().as_deref() != Some(&text) {
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, text)?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_schema_is_current() {
        let committed = concat!(env!("CARGO_MANIFEST_DIR"), "/schema/config.schema.json");
        let on_disk = std::fs::read_to_string(committed).unwrap_or_default();
        assert!(on_disk == json(), "schema is stale: run `cargo run -p pal-core --example schema`");
    }

    #[test]
    fn shape() {
        let s: serde_json::Value = serde_json::from_str(&json()).unwrap();
        assert_eq!(s["additionalProperties"], false, "unknown top-level keys are flagged in the editor");
        assert_eq!(s["x-taplo-info"]["patterns"][0], "**/pal/config.toml");
        let general = &s["$defs"]["General"];
        assert_eq!(general["additionalProperties"], false);
        assert!(general["properties"]["extra"].is_null(), "the catch-all map is not a key to complete");
        assert_eq!(s["$defs"]["Theme"]["enum"], serde_json::json!(["system", "light", "dark"]));
        let palette = &s["$defs"]["Palette"]["properties"];
        assert_eq!(palette["enabled"]["default"], true);
        assert_eq!(palette["alias"]["type"], "string", "no null type: TOML cannot write one");
        assert!(palette["alias"]["default"].is_null(), "no `default: null` either");
    }

    #[test]
    fn install_writes_next_to_config() {
        let dir = tempfile::tempdir().unwrap();
        let p = install(&dir.path().join("pal").join("config.toml")).unwrap();
        assert_eq!(p, dir.path().join("pal").join(FILE_NAME));
        let m = std::fs::metadata(&p).unwrap().modified().unwrap();
        install(&dir.path().join("pal").join("config.toml")).unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().modified().unwrap(), m, "unchanged schema is not rewritten");
    }
}
