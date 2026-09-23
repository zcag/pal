//! Features: what pal does on its own, built into the app rather than
//! installed (`docs/design/model.md`). Each is a spec, `core/features/<id>.json`,
//! compiled in: its title, description, tile, the platforms it runs on,
//! the permission it needs, its `settings` (the `SettingSpec` shape
//! extensions use, so the Settings window renders them alike), and the
//! commands, states and bar items it contributes. The values live in
//! `[features.<id>]`, over the spec's defaults ([`Config::feature_settings`]).
//!
//! [`Config::feature_settings`]: crate::config::Config::feature_settings

use std::sync::OnceLock;

use serde_json::Value;

/// The specs as compiled in, in the order the Settings window lists them.
const SPECS: &[(&str, &str)] = &[
    ("clipboard", include_str!("../features/clipboard.json")),
    ("expansion", include_str!("../features/expansion.json")),
    ("switcher", include_str!("../features/switcher.json")),
    ("sidebar", include_str!("../features/sidebar.json")),
    ("reserve", include_str!("../features/reserve.json")),
    ("mouse", include_str!("../features/mouse.json")),
    ("keycast", include_str!("../features/keycast.json")),
];

/// Every spec, parsed once.
pub fn all() -> &'static [Value] {
    static PARSED: OnceLock<Vec<Value>> = OnceLock::new();
    PARSED.get_or_init(|| SPECS.iter().map(|(id, text)| serde_json::from_str(text).unwrap_or_else(|e| panic!("core/features/{id}.json: {e}"))).collect())
}

/// One feature's spec.
pub fn spec(id: &str) -> Option<&'static Value> {
    all().iter().find(|s| s["id"] == id)
}

/// Whether `id` names a feature.
pub fn is(id: &str) -> bool {
    SPECS.iter().any(|(i, _)| *i == id)
}

/// A feature's declared `settings` list (`Value::Null` for an unknown id).
pub fn settings(id: &str) -> &'static Value {
    static NULL: Value = Value::Null;
    spec(id).map_or(&NULL, |s| &s["settings"])
}

/// The ids of a feature's `boolean` settings that are commands too (every
/// one without `"command": false`): `Toggle <label>` at the root.
pub fn toggles(id: &str) -> Vec<&'static Value> {
    settings(id).as_array().into_iter().flatten().filter(|s| s["kind"] == "boolean" && s["command"] != false).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_spec_parses_and_is_named_by_its_file() {
        for (id, _) in SPECS {
            let s = spec(id).expect("parses");
            assert_eq!(s["id"], *id);
            assert!(s["title"].is_string() && s["description"].is_string(), "{id}: title and description");
            for set in s["settings"].as_array().into_iter().flatten() {
                assert!(set["id"].is_string() && set["kind"].is_string() && set["label"].is_string(), "{id}: {set}");
                assert!(set.get("bar").is_none(), "{id}: a feature's setting has no bar tag");
            }
        }
    }

    #[test]
    fn toggles_are_the_boolean_settings() {
        let ids: Vec<&str> = toggles("mouse").iter().filter_map(|s| s["id"].as_str()).collect();
        assert_eq!(ids, ["middle_click", "middle_click_tap", "reverse_trackpad", "reverse_mouse", "reverse_vertical", "reverse_horizontal"]);
        assert!(toggles("sidebar").is_empty());
        assert!(!is("github"));
    }
}
