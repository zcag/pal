//! The strip parity snapshot (docs/design/screenshots.md, "Parity"): what
//! the two real renderers draw for every item the gallery and the Settings
//! preview show, written as data to `app/src/ui/__tests__/bar-parity.json`.
//! The menu bar half is [`menubar::describe`], the sketchybar half the
//! renderer's own [`sketchybar::props`]. This test fails when a renderer
//! changes and the snapshot was not written again
//! (`PAL_UPDATE_PARITY=1 cargo test -p pal parity`); the vitest
//! `bar-parity.test.ts` then fails until `ui/BarStrip.tsx` draws the same.
//!
//! The items: every gallery fixture's item (`test/shots/bar-*.json` in the
//! extension repos, `pal_core::extensions::dev`) under each of [`LOOKS`],
//! its states and every manifest mock (`<name>/pal.json` `bar.<id>.mocks`,
//! what Settings previews) under the default look; each in both themes.
//! The snapshot keeps each case's item, so the check draws those again and
//! needs no checkout of the extensions: a mock changed in an extension repo
//! never breaks pal, and `PAL_UPDATE_PARITY=1` takes the items afresh from
//! the checkouts.

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

/// The extension repos' checkouts.
fn repos() -> Vec<pal_core::extensions::dev::Repo> {
    pal_core::extensions::dev::repos(&root())
}

/// Every bar fixture in the extension repos, by file name.
fn bar_fixtures() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = repos().iter().filter(|r| r.shots.is_dir()).flat_map(|r| sorted(&r.shots, |n| n.starts_with("bar-") && n.ends_with(".json"))).collect();
    v.sort_by_key(|p| p.file_name().map(|n| n.to_os_string()));
    v
}

/// One extension's pal.json in the extension repos.
fn manifest(ext: &str) -> Option<Value> {
    let (_, dir) = pal_core::extensions::dev::extensions(&repos()).into_iter().find(|(n, _)| n == ext)?;
    serde_json::from_str(&std::fs::read_to_string(dir.join("pal.json")).ok()?).ok()
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
    for p in bar_fixtures() {
        let fx = read(&p);
        let name = p.file_stem().unwrap().to_string_lossy().to_string();
        out.push((name.clone(), strip_only(&fx["item"]), true));
        for s in fx["states"].as_array().into_iter().flatten() {
            let mut merged = fx["item"].as_object().cloned().unwrap_or_default();
            merged.extend(s["item"].as_object().cloned().unwrap_or_default());
            out.push((format!("{name}#{}", s["id"].as_str().unwrap_or("?")), strip_only(&Value::Object(merged)), false));
        }
    }
    for (ext, p) in pal_core::extensions::dev::extensions(&repos()) {
        let Ok(text) = std::fs::read_to_string(p.join("pal.json")) else { continue };
        let m: Value = serde_json::from_str(&text).unwrap();
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

/// One case: the item drawn under a look, both themes.
fn case(name: &str, look_name: &str, over: &Value, item: &Value) -> Value {
    let look = BarLook::default().with(&serde_json::from_value::<BarLookOverride>(over.clone()).unwrap());
    json!({ "name": name, "look": look_name, "look_file": over, "item": item, "dark": drawn(item, &look, true), "light": drawn(item, &look, false) })
}

/// The cases from the extension repos' items ([`items`]).
fn snapshot() -> Vec<Value> {
    let mut cases = vec![];
    for (name, item, every_look) in items() {
        for (look_name, over) in LOOKS.iter().take(if every_look { LOOKS.len() } else { 1 }) {
            cases.push(case(&name, look_name, &serde_json::from_str(over).unwrap(), &item));
        }
    }
    cases
}

#[test]
fn parity_snapshot_is_current() {
    let path = root().join("app/src/ui/__tests__/bar-parity.json");
    let was = std::fs::read_to_string(&path).unwrap_or_default();
    // Written afresh from the checkouts, or the snapshot's own items drawn again.
    let update = std::env::var_os("PAL_UPDATE_PARITY").is_some();
    let cases: Vec<Value> = if update {
        snapshot()
    } else {
        let old: Value = serde_json::from_str(&was).expect("bar-parity.json: run PAL_UPDATE_PARITY=1 cargo test -p pal parity with the extension repos checked out");
        old["cases"].as_array().unwrap().iter().map(|c| case(c["name"].as_str().unwrap(), c["look"].as_str().unwrap(), &c["look_file"], &c["item"])).collect()
    };
    // One case a line: a diff names the items whose drawing moved.
    let lines: Vec<String> = cases.iter().map(|c| serde_json::to_string(c).unwrap()).collect();
    let now = format!("{{\"cases\": [\n{}\n]}}\n", lines.join(",\n"));
    if update {
        std::fs::write(&path, &now).unwrap();
        return;
    }
    // The first case that moved, both ways, so a failure on another machine (CI) says what differs there.
    let moved = was.lines().zip(now.lines()).find(|(a, b)| a != b).map(|(a, b)| format!("\nwas: {a}\nnow: {b}")).unwrap_or_default();
    assert!(was == now, "the strip parity snapshot is stale: a renderer changed. Run `PAL_UPDATE_PARITY=1 cargo test -p pal parity`, then `npx vitest run bar-parity` in app/ (BarStrip.tsx must draw the same){moved}");
}

/// The menu bar's real pixels for a few fixture items, to set beside the
/// gallery's strip by eye (docs/design/screenshots.md, "Parity"): run with
/// `PAL_PARITY_DUMP=<dir> cargo test -p pal dump_menubar_pictures -- --ignored`.
#[test]
#[ignore]
fn dump_menubar_pictures() {
    let Some(dir) = std::env::var_os("PAL_PARITY_DUMP") else { return };
    let dir = PathBuf::from(dir);
    std::fs::create_dir_all(&dir).unwrap();
    for (name, item, _) in items().into_iter().filter(|(n, _, all)| *all && n.starts_with("bar-")) {
        for dark in [true, false] {
            let raw: BarItem = serde_json::from_value(item.clone()).unwrap();
            let look = BarLook::default();
            let draw = Draw { item: raw.shaped(&look), order: 0, position: "right".into(), hover: false, look };
            let palette = Palette::new(dark, &BTreeMap::new());
            let Some((png, template)) = menubar::picture(&draw, &palette) else { continue };
            let theme = if dark { "dark" } else { "light" };
            std::fs::write(dir.join(format!("{name}-{theme}{}.png", if template { "-template" } else { "" })), png).unwrap();
        }
    }
}

/// A bar fixture shows what the bar would draw: the core applies the
/// manifest's rules (`ruled`, mod.rs) over what `render` answered, by the
/// states the item publishes, so a fixture item whose rules hold must
/// already carry their urgency, tint and presence, or its picture is a
/// strip the bar never shows (WhatsApp's direct message, red on the bar,
/// drew plain).
#[test]
fn fixtures_carry_what_their_rules_draw() {
    let mut wrong = vec![];
    for p in bar_fixtures() {
        let fx = read(&p);
        let Some((ext, id)) = fx["key"].as_str().and_then(|k| k.split_once('/')) else { continue };
        let Some(m) = manifest(ext) else { continue };
        let rules = m["bar"][id]["rules"].as_array().cloned().unwrap_or_default();
        if rules.is_empty() {
            continue;
        }
        let mut shown = vec![("item".to_string(), fx["item"].clone())];
        for st in fx["states"].as_array().into_iter().flatten() {
            let mut merged = fx["item"].as_object().cloned().unwrap_or_default();
            merged.extend(st["item"].as_object().cloned().unwrap_or_default());
            shown.push((st["id"].as_str().unwrap_or("?").to_string(), Value::Object(merged)));
        }
        for (state, item) in shown {
            let mut table = pal_core::states::States::default();
            for (name, v) in item["states"].as_object().into_iter().flatten() {
                let _ = table.publish(&format!("{ext}/{name}"), ext, v.clone());
            }
            let (mut urgent, mut color, mut hidden) = (item["urgent"].as_bool().unwrap_or(false), item["color"].as_str().map(str::to_string), item["hidden"].as_bool().unwrap_or(false));
            for r in &rules {
                let Some(when) = r["when"].as_str() else { continue };
                if !table.eval(when).is_ok_and(|v| v == Value::Bool(true)) {
                    continue;
                }
                if let Some(u) = r["urgent"].as_bool() {
                    urgent = u;
                }
                if let Some(c) = r["color"].as_str() {
                    color = Some(c.to_string());
                }
                if let Some(h) = r["hidden"].as_bool() {
                    hidden = h;
                }
            }
            let has = (item["urgent"].as_bool().unwrap_or(false), item["color"].as_str().map(str::to_string), item["hidden"].as_bool().unwrap_or(false));
            if has != (urgent, color.clone(), hidden) {
                wrong.push(format!("{} ({state}): the rules draw urgent {urgent}, color {color:?}, hidden {hidden}; the fixture has {has:?}", p.file_name().unwrap().to_string_lossy()));
            }
        }
    }
    assert!(wrong.is_empty(), "bar fixtures that do not show what their manifest rules draw (set urgent/color/hidden in the fixture as the core would, or pick a state the rules leave alone):\n{}", wrong.join("\n"));
}
