//! The config as sync sees it (docs/design/accounts.md "What syncs"): the
//! file's values as dotted keys, one per leaf (`general.theme`,
//! `palettes.files.enabled`, `store.installed`; an array is one leaf), and
//! the keys that belong to one machine and never leave it.
//!
//! Only what the file says is a key: a default the file leaves out is no
//! value, so a machine that never touched `general.theme` takes the other's
//! and one that sets it back to the default (the key unset) sends the
//! removal. Incoming values go through [`ConfigFile::set_many`], the edit
//! path Settings uses, so the file keeps its comments and formatting.
//!
//! [`LOCAL`] is the machine-local list, documented in docs/config.md
//! "Sync". On top of it, an extension's or a feature's declared setting
//! is local when it is a `hotkey` or a `path`, or says `"local": true`
//! ([`declared_local`]).

use std::collections::BTreeMap;

use serde_json::Value;

use super::{ConfigFile, Error};

/// Keys (and everything under them) that stay on this machine. `*` is any
/// one segment. Hotkeys, where the bar draws, the menu bar icon, startup,
/// usage sharing and paths (theme file, extension dirs, the folder lists of
/// bundled extensions); everything else syncs.
pub const LOCAL: &[&str] = &[
    "general.hotkey",
    "general.launch_at_login",
    "general.menu_bar_icon",
    "general.usage",
    "general.extension_dirs",
    "general.theme_file",
    "palettes.*.hotkey",
    "palettes.*.hold",
    "palettes.*.item_hotkeys",
    "bar.target",
    "bar.sketchybar.position",
    "bar.items.*.target",
    "bar.items.*.position",
    "bar.items.*.hotkey",
    "bar.items.*.rules.*.position",
    "features.*.hotkeys",
    "features.sidebar.hotkey",
    "features.sidebar.display",
    // Bundled extensions' lists of folders: a `list`, so the kind cannot say.
    "extensions.apps.folders",
    "extensions.files.folders",
    "extensions.make.projects",
    "extensions.services.agent_dirs",
];

/// A dotted key's segments, quotes resolved (`palettes."a.b".enabled` is
/// three). `None` for text that is not a key.
pub fn segments(key: &str) -> Option<Vec<String>> {
    toml_edit::Key::parse(key).ok().map(|ks| ks.iter().map(|k| k.get().to_string()).collect())
}

/// A segment as a dotted key writes it: bare when TOML allows, else quoted.
pub fn quote(seg: &str) -> String {
    if !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        seg.to_string()
    } else {
        serde_json::to_string(seg).unwrap_or_default()
    }
}

/// The local list in force: [`LOCAL`] plus what the loaded extensions
/// declare.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Local {
    patterns: Vec<Vec<String>>,
}

impl Default for Local {
    fn default() -> Self {
        Local::new(LOCAL.iter().map(|s| s.to_string()))
    }
}

impl Local {
    pub fn new(patterns: impl IntoIterator<Item = String>) -> Local {
        // `*` is no bare key: spelled as a quoted one to parse.
        let parse = |p: &str| segments(p).or_else(|| segments(&p.split('.').map(|s| if s == "*" { "\"*\"" } else { s }).collect::<Vec<_>>().join(".")));
        Local { patterns: patterns.into_iter().filter_map(|p| parse(&p)).collect() }
    }

    /// [`LOCAL`] and the declared local settings of `manifests`
    /// (`(key, pal.json)` of every loaded extension) and of the features.
    pub fn with_manifests(manifests: &[(String, Value)]) -> Local {
        let mut all: Vec<String> = LOCAL.iter().map(|s| s.to_string()).collect();
        all.extend(declared_local(manifests));
        Local::new(all)
    }

    /// The patterns as dotted keys, for Settings to mark its rows.
    pub fn patterns(&self) -> Vec<String> {
        self.patterns.iter().map(|p| p.iter().map(|s| if s == "*" { s.clone() } else { quote(s) }).collect::<Vec<_>>().join(".")).collect()
    }

    /// Whether `key` stays on this machine: a pattern is the key or one
    /// of its parents. A key that does not parse never syncs either.
    pub fn is_local(&self, key: &str) -> bool {
        let Some(segs) = segments(key) else { return true };
        self.patterns.iter().any(|p| p.len() <= segs.len() && p.iter().zip(&segs).all(|(a, b)| a == "*" || a == b))
    }
}

/// Settings that are local by their spec: `hotkey` and `path` kinds and
/// `"local": true`.
fn local_ids(specs: &Value) -> impl Iterator<Item = &str> {
    specs.as_array().into_iter().flatten().filter(|s| s["kind"] == "hotkey" || s["kind"] == "path" || s["local"] == true).filter_map(|s| s["id"].as_str())
}

/// The config keys of every declared local setting: an extension's own
/// (`extensions.<key>.<id>`), its palettes' (`palettes.<palette id>.settings.<id>`),
/// its bar items' (`bar.items."<key>/<item>".settings.<id>`) and the
/// features' (`features.<id>.<setting>`).
pub fn declared_local(manifests: &[(String, Value)]) -> Vec<String> {
    let mut out = Vec::new();
    for (key, m) in manifests {
        out.extend(local_ids(&m["settings"]).map(|id| format!("extensions.{}.{}", quote(key), quote(id))));
        for (pid, p) in m["palettes"].as_object().into_iter().flatten() {
            let palette = super::instance::palette_id(key, pid);
            out.extend(local_ids(&p["settings"]).map(|id| format!("palettes.{}.settings.{}", quote(&palette), quote(id))));
        }
        for (bid, b) in m["bar"].as_object().into_iter().flatten() {
            out.extend(local_ids(&b["settings"]).map(|id| format!("bar.items.{}.settings.{}", quote(&format!("{key}/{bid}")), quote(id))));
        }
    }
    for spec in crate::features::all() {
        let id = spec["id"].as_str().unwrap_or_default();
        out.extend(local_ids(&spec["settings"]).map(|s| format!("features.{}.{}", quote(id), quote(s))));
    }
    out
}

/// The file's values, one per leaf, keyed by dotted path. An empty table
/// is no value; an array (of tables too) is one leaf. A file that is
/// missing is empty; one that does not parse is an error, so nothing is
/// pushed from a half-saved file.
pub fn flatten_file(file: &ConfigFile) -> Result<BTreeMap<String, Value>, Error> {
    let path = file.target();
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(source) => return Err(Error::Io { path, source }),
    };
    let doc: toml_edit::DocumentMut = text.parse().map_err(|source| Error::Parse { path, source })?;
    let table: toml::Table = toml::from_str(&doc.to_string()).unwrap_or_default();
    Ok(flatten(&serde_json::to_value(table).unwrap_or_default()))
}

/// [`flatten_file`] over a JSON object.
pub fn flatten(v: &Value) -> BTreeMap<String, Value> {
    fn walk(prefix: &str, v: &Value, out: &mut BTreeMap<String, Value>) {
        match v {
            Value::Object(m) => {
                for (k, v) in m {
                    let key = if prefix.is_empty() { quote(k) } else { format!("{prefix}.{}", quote(k)) };
                    walk(&key, v, out);
                }
            }
            _ if prefix.is_empty() => {}
            _ => {
                out.insert(prefix.to_string(), v.clone());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk("", v, &mut out);
    out
}

/// Writes incoming values into the file in one edit (`null` unsets). A
/// key the file cannot take as one edit (a value where a table is) is
/// tried alone, so one odd key costs the others nothing; what failed is
/// returned.
pub fn apply(file: &ConfigFile, values: &[(String, Value)]) -> Vec<(String, String)> {
    let changes = |vs: &[(String, Value)]| vs.iter().map(|(k, v)| (k.clone(), (!v.is_null()).then(|| v.clone()))).collect::<Vec<_>>();
    if values.is_empty() || file.set_many(changes(values)).is_ok() {
        return Vec::new();
    }
    values.iter().filter_map(|kv| file.set_many(changes(std::slice::from_ref(kv))).err().map(|e| (kv.0.clone(), e.to_string()))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn local_patterns_match_keys_and_what_is_under_them() {
        let l = Local::default();
        for k in ["general.hotkey", "general.usage", "palettes.files.hotkey", "palettes.\"a.b\".item_hotkeys.left", "bar.items.\"github/prs\".position", "bar.target", "features.mouse.hotkeys.zoom", "extensions.files.folders"] {
            assert!(l.is_local(k), "{k}");
        }
        for k in ["general.theme", "general.position", "palettes.files.enabled", "store.installed", "bar.hover_delay", "extensions.files.exclude", "features.sidebar.width", "instances.\"gmail@work\".title"] {
            assert!(!l.is_local(k), "{k}");
        }
        assert!(l.is_local("a..b"), "a key that does not parse never syncs");
    }

    #[test]
    fn declared_hotkeys_and_paths_are_local() {
        let m = json!({
            "settings": [{ "id": "vault", "kind": "path" }, { "id": "token", "kind": "secret" }, { "id": "cache", "kind": "text", "local": true }],
            "palettes": { "notes": { "settings": [{ "id": "root", "kind": "path" }] } },
            "bar": { "unread": { "settings": [{ "id": "key", "kind": "hotkey" }] } },
        });
        let l = Local::with_manifests(&[("obsidian".into(), m.clone()), ("obsidian@work".into(), m)]);
        assert!(l.is_local("extensions.obsidian.vault"));
        assert!(l.is_local("extensions.\"obsidian@work\".vault"), "an instance's own table");
        assert!(l.is_local("extensions.obsidian.cache"));
        assert!(!l.is_local("extensions.obsidian.token"), "a secret's reference syncs");
        assert!(l.is_local("palettes.obsidian-notes.settings.root"));
        assert!(l.is_local("bar.items.\"obsidian/unread\".settings.key"));
        assert!(l.is_local("features.switcher.app_switcher"), "a feature's hotkey setting");
        assert!(l.patterns().contains(&"extensions.\"obsidian@work\".vault".to_string()));
    }

    #[test]
    fn flatten_is_one_key_per_leaf() {
        let v = json!({ "general": { "theme": "dark", "root_caps": { "primary": 8 } }, "palettes": { "a.b": { "enabled": false }, "empty": {} }, "store": { "installed": ["weather"], "registries": [{ "name": "x" }] } });
        let f = flatten(&v);
        assert_eq!(f.keys().collect::<Vec<_>>(), ["general.root_caps.primary", "general.theme", "palettes.\"a.b\".enabled", "store.installed", "store.registries"]);
        assert_eq!(f["store.registries"], json!([{ "name": "x" }]));
    }

    #[test]
    fn apply_goes_through_the_edit_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "# mine\n[general]\ntheme = \"light\" # keep this\ncompact = true\n").unwrap();
        let file = ConfigFile::new(&path);
        let failed = apply(&file, &[("general.theme".into(), json!("dark")), ("general.compact".into(), Value::Null), ("palettes.\"a.b\".enabled".into(), json!(false))]);
        assert!(failed.is_empty(), "{failed:?}");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# mine\n") && text.contains("theme = \"dark\" # keep this"), "{text}");
        assert!(!text.contains("compact"), "{text}");
        let f = flatten_file(&file).unwrap();
        assert_eq!(f.get("palettes.\"a.b\".enabled"), Some(&json!(false)));
        // One key the file cannot take costs the others nothing.
        let failed = apply(&file, &[("general.theme.x".into(), json!(1)), ("general.design".into(), json!("frappe"))]);
        assert_eq!(failed.iter().map(|f| f.0.as_str()).collect::<Vec<_>>(), ["general.theme.x"]);
        assert_eq!(flatten_file(&file).unwrap()["general.design"], json!("frappe"));
    }
}
