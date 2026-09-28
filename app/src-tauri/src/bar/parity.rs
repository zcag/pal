//! The strip parity snapshot (docs/design/screenshots.md, "Parity"): what
//! the two real renderers draw for every item the gallery and the Settings
//! preview show, written as data to `app/src/ui/__tests__/bar-parity.json`.
//! The menu bar half is [`menubar::describe`], the sketchybar half the
//! renderer's own [`sketchybar::props`]. This test fails when a renderer
//! changes and the snapshot was not written again
//! (`PAL_UPDATE_PARITY=1 cargo test -p pal parity`); the vitest
//! `bar-parity.test.ts` then fails until `ui/BarStrip.tsx` draws the same.
//!
//! The items: every gallery fixture's item (`app/src/gallery/shots/bar-*.json`)
//! under each of [`LOOKS`], its states and every manifest mock
//! (`extensions/*/pal.json` `bar.<id>.mocks`, what Settings previews) under
//! the default look; each in both themes.

use super::colors::Palette;
use super::{menubar, sketchybar, BarItem, Draw};
use pal_core::config::{BarLook, BarLookOverride};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Look overrides in the config file's spelling, each a way the strip is drawn differently.
const LOOKS: &[(&str, &str)] = &[
    ("default", "{}"),
    ("mono", r#"{"font":"mono","width":72}"#),
    ("dot", r#"{"badge_style":"dot"}"#),
    ("badge-colour", r#"{"badge_color":"red"}"#),
    ("faded", r#"{"opacity":60}"#),
    ("no-title", r#"{"show_title":false}"#),
    ("sized", r#"{"icon_size":18,"text_size":15}"#),
    ("tinted", r#"{"color":"teal"}"#),
    ("own-icon", r#"{"icon":"🔔"}"#),
    ("blank-icon", r#"{"icon":"  "}"#),
];

/// The sketchybar properties a picture depends on (the scripts and the image icon's file aside).
const SKETCHY_KEYS: &[&str] = &[
    "drawing", "icon", "icon.drawing", "icon.color", "icon.font.size", "icon.width", "icon.padding_left", "icon.padding_right", "label", "label.drawing", "label.color", "label.font.size", "label.font.family",
    "label.width", "label.max_chars", "label.padding_left", "label.padding_right", "background.drawing", "background.color", "background.height", "background.corner_radius",
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(p: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn sorted(dir: &Path, keep: impl Fn(&str) -> bool) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(&keep)).collect();
    v.sort();
    v
}

/// The item without what the strip does not draw (the popover, the tooltip, the states it publishes).
fn strip_only(v: &Value) -> Value {
    let mut o = v.as_object().cloned().unwrap_or_default();
    for k in ["menu", "tooltip", "states", "click", "scroll", "refresh"] {
        o.remove(k);
    }
    Value::Object(o)
}

/// `(name, item, whether every look applies)`: the gallery's items and states, then the manifests' mocks.
fn items() -> Vec<(String, Value, bool)> {
    let mut out = vec![];
    for p in sorted(&root().join("app/src/gallery/shots"), |n| n.starts_with("bar-") && n.ends_with(".json")) {
        let fx = read(&p);
        let name = p.file_stem().unwrap().to_string_lossy().to_string();
        out.push((name.clone(), strip_only(&fx["item"]), true));
        for s in fx["states"].as_array().into_iter().flatten() {
            let mut merged = fx["item"].as_object().cloned().unwrap_or_default();
            merged.extend(s["item"].as_object().cloned().unwrap_or_default());
            out.push((format!("{name}#{}", s["id"].as_str().unwrap_or("?")), strip_only(&Value::Object(merged)), false));
        }
    }
    for p in sorted(&root().join("extensions"), |_| true) {
        let Ok(text) = std::fs::read_to_string(p.join("pal.json")) else { continue };
        let m: Value = serde_json::from_str(&text).unwrap();
        let ext = p.file_name().unwrap().to_string_lossy().to_string();
        let bars: BTreeMap<String, Value> = m["bar"].as_object().map(|o| o.clone().into_iter().collect()).unwrap_or_default();
        for (id, bar) in bars {
            let mocks: BTreeMap<String, Value> = bar["mocks"].as_object().map(|o| o.clone().into_iter().collect()).unwrap_or_default();
            for (mid, mock) in mocks {
                out.push((format!("{ext}/{id}@{mid}"), strip_only(&mock["item"]), false));
            }
        }
    }
    out
}

fn drawn(item: &Value, look: &BarLook, dark: bool) -> Value {
    let raw: BarItem = serde_json::from_value(item.clone()).unwrap_or_else(|e| panic!("{item}: {e}"));
    let draw = Draw { item: raw.shaped(look), order: 0, position: "right".into(), hover: false, look: look.clone() };
    let palette = Palette::new(dark, &BTreeMap::new());
    let r = sketchybar::props("x/y", &draw, &palette, "/pal");
    let sketchy: Vec<Value> = r
        .order
        .iter()
        .map(|name| {
            let p = &r.props[name];
            let keep: Map<String, Value> = SKETCHY_KEYS.iter().filter_map(|k| p.get(*k).map(|v| (k.to_string(), Value::String(v.clone())))).collect();
            Value::Object(keep)
        })
        .collect();
    json!({ "menubar": menubar::describe(&draw, &palette), "sketchybar": sketchy })
}

fn snapshot() -> Value {
    let mut cases = vec![];
    for (name, item, every_look) in items() {
        for (look_name, over) in LOOKS.iter().take(if every_look { LOOKS.len() } else { 1 }) {
            let over_v: Value = serde_json::from_str(over).unwrap();
            let look = BarLook::default().with(&serde_json::from_value::<BarLookOverride>(over_v.clone()).unwrap());
            cases.push(json!({ "name": name, "look": look_name, "look_file": over_v, "item": item, "dark": drawn(&item, &look, true), "light": drawn(&item, &look, false) }));
        }
    }
    json!({ "cases": cases })
}

#[test]
fn parity_snapshot_is_current() {
    let path = root().join("app/src/ui/__tests__/bar-parity.json");
    // One case a line: a diff names the items whose drawing moved.
    let cases: Vec<String> = snapshot()["cases"].as_array().unwrap().iter().map(|c| serde_json::to_string(c).unwrap()).collect();
    let now = format!("{{\"cases\": [\n{}\n]}}\n", cases.join(",\n"));
    if std::env::var_os("PAL_UPDATE_PARITY").is_some() {
        std::fs::write(&path, &now).unwrap();
        return;
    }
    let was = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(was == now, "the strip parity snapshot is stale: a renderer, a fixture or a mock changed. Run `PAL_UPDATE_PARITY=1 cargo test -p pal parity`, then `npx vitest run bar-parity` in app/ (BarStrip.tsx must draw the same)");
}
