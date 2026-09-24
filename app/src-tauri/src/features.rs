//! Features at run time (`docs/design/model.md`; the specs are
//! `pal_core::features`): what the Settings window's Features page shows
//! for each (on or off, what it is doing, the permission it waits on),
//! and their commands.
//!
//! A command is `<feature>.<id>`: every `boolean` setting of a feature
//! (its flip, "Reverse scrolling on the mouse" with an on/off tag) and the
//! spec's own `commands` (keycast's start, stop and modes). They are rows
//! of pal's own source (`commands.rs`), so they are found at the root,
//! remembered, and reached as `pal command mouse.reverse_mouse` and
//! `pal://commands/keycast.toggle`; a chord in `[features.<id>.hotkeys]`
//! runs one (`hotkey::Target::Command`). The rows follow the config and
//! keycast's state ([`sync`]).

use pal_core::config::Config;
use pal_core::index::Item;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{commands, keycast, permissions, settings};

/// Whether this platform runs the feature (the spec's `platforms`, all when absent).
pub fn available(spec: &Value) -> bool {
    let os = if cfg!(target_os = "macos") { "macos" } else { "linux" };
    spec["platforms"].as_array().is_none_or(|p| p.iter().any(|x| x == os))
}

fn available_id(id: &str) -> bool {
    pal_core::features::spec(id).is_some_and(available)
}

/// A boolean setting's value as resolved.
fn flag(config: &Config, id: &str, setting: &str) -> bool {
    config.feature_settings(id).get(setting).and_then(toml::Value::as_bool).unwrap_or(false)
}

/// The feature's headline state: what its card's switch shows and what
/// the Overview counts.
fn on(app: &AppHandle, config: &Config, id: &str) -> bool {
    match id {
        "clipboard" => true,
        "keycast" => keycast::active(app),
        "sidebar" => config.features.sidebar.palette().is_some(),
        "switcher" => config.palette("windows").hold.as_deref().is_some_and(|h| !h.trim().is_empty()),
        "mouse" => ["middle_click", "reverse_trackpad", "reverse_mouse", "hide_pointer"].iter().any(|s| flag(config, id, s)),
        _ => pal_core::features::spec(id).and_then(|s| s["toggle"].as_str()).is_some_and(|t| flag(config, id, t)),
    }
}

/// A line on what the feature is doing, when there is more to say than on or off.
fn note(app: &AppHandle, id: &str) -> Option<String> {
    match id {
        "keycast" => keycast::active(app).then(|| format!("Showing {}", keycast::status(app).mode.word())),
        "mouse" => crate::mouse::note().map(str::to_string),
        _ => None,
    }
}

/// Whether the permission a spec names is granted (or none is named).
fn granted(which: Option<&str>, p: &permissions::Status) -> bool {
    match which {
        Some("accessibility") => p.accessibility,
        Some("input_monitoring") => p.input_monitoring,
        _ => true,
    }
}

/// One feature for the Settings window: the spec, whether it runs here,
/// its headline state, and whether it waits on its permission (only
/// said while it is on: a feature that is off needs nothing yet).
pub fn view(app: &AppHandle, config: &Config, perms: &permissions::Status) -> Vec<Value> {
    pal_core::features::all()
        .iter()
        .map(|spec| {
            let id = spec["id"].as_str().unwrap_or_default();
            let on = on(app, config, id);
            json!({
                "spec": spec,
                "available": available(spec),
                "on": on,
                "needs": spec["permission"].as_str().filter(|p| on && !granted(Some(p), perms)),
                "note": note(app, id),
                "hotkeys": config.feature_hotkeys(id).into_iter().map(|(k, v)| (k, json!(v))).collect::<serde_json::Map<String, Value>>(),
            })
        })
        .collect()
}

// ---- commands ------------------------------------------------------------------

/// A toggle's name for its root row and the HUD: the feature's title for
/// its headline switch (the spec's `toggle`: "Text expansion"), else the
/// setting's `text` when it reads as a name ("Reverse scrolling on the
/// mouse"), else its label.
fn toggle_name(spec: &Value, setting: &Value) -> String {
    if spec["toggle"] == setting["id"] {
        return spec["title"].as_str().unwrap_or_default().to_string();
    }
    setting["text"].as_str().filter(|t| t.len() <= 48).or(setting["label"].as_str()).unwrap_or_default().to_string()
}

/// Every feature command as a root row, for `commands::rows`: the
/// toggles with their state as a tag, then the declared commands
/// (keycast's rows say whether it is on).
pub fn rows(app: &AppHandle, config: &Config) -> Vec<Item> {
    let mut out = Vec::new();
    for spec in pal_core::features::all().iter().filter(|s| available(s)) {
        let id = spec["id"].as_str().unwrap_or_default();
        let title = spec["title"].as_str().unwrap_or(id);
        let icon = spec["icon"].clone();
        let words: Vec<String> = title.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect();
        let row = |cmd: &str, name: String, subtitle: String, extra: &[&str], accessories: Value| {
            let mut keywords = words.clone();
            keywords.extend(extra.iter().map(|k| k.to_string()));
            let mut extra = serde_json::Map::new();
            extra.insert("accessories".into(), accessories);
            Item { id: format!("{id}.{cmd}"), name, subtitle: Some(subtitle).filter(|s| !s.is_empty()), keywords, icon: Some(icon.clone()), section: None, extra }
        };
        for s in pal_core::features::toggles(id) {
            let setting = s["id"].as_str().unwrap_or_default();
            let on = flag(config, id, setting);
            let tag = json!([{ "tag": if on { "on" } else { "off" }, "color": if on { "green" } else { "muted" } }]);
            let mut words: Vec<&str> = vec!["toggle", "turn", if on { "off" } else { "on" }];
            words.extend(s["label"].as_str());
            out.push(row(setting, toggle_name(spec, s), title.to_string(), &words, tag));
        }
        let active = id == "keycast" && keycast::active(app);
        for c in spec["commands"].as_array().into_iter().flatten() {
            let cmd = c["id"].as_str().unwrap_or_default();
            if id == "keycast" && cmd == "stop" && !active {
                continue;
            }
            let name = match (id, cmd) {
                ("keycast", "toggle") if active => "Stop keycast".to_string(),
                ("keycast", "toggle") => "Start keycast".to_string(),
                _ => c["title"].as_str().unwrap_or(cmd).to_string(),
            };
            let words: Vec<&str> = c["keywords"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
            let tag = if active && cmd == "toggle" { json!([{ "tag": "on", "color": "red" }]) } else { json!([]) };
            out.push(row(cmd, name, c["subtitle"].as_str().unwrap_or(title).to_string(), &words, tag));
        }
    }
    out
}

/// A command id's two halves, when it names a feature's command: `mouse.reverse_mouse`.
pub fn split(id: &str) -> Option<(&str, &str)> {
    id.split_once('.').filter(|(f, _)| pal_core::features::is(f))
}

/// Run `<feature>.<command>`: a toggle flips its setting in the file
/// (the reload applies it), a declared command acts. The Effect for the
/// caller: the HUD's line.
pub fn run(app: &AppHandle, id: &str) -> Result<Value, String> {
    let (feature, cmd) = split(id).ok_or_else(|| format!("no feature command {id}"))?;
    if !available_id(feature) {
        return Err(format!("{feature} is not available on this platform"));
    }
    let spec = pal_core::features::spec(feature).expect("a feature");
    if let Some(s) = pal_core::features::toggles(feature).into_iter().find(|s| s["id"] == cmd) {
        let now = !flag(&settings::config(app), feature, cmd);
        settings::file(app).set_json(&format!("features.{feature}.{cmd}"), json!(now)).map_err(|e| e.to_string())?;
        return Ok(json!({ "hud": format!("{}: {}", toggle_name(spec, s), if now { "on" } else { "off" }) }));
    }
    match (feature, cmd) {
        ("keycast", "toggle") => keycast::toggle(app, None).map(|st| hud_keycast(&st)),
        ("keycast", "stop") => Ok(hud_keycast(&keycast::stop(app))),
        ("keycast", m) => {
            let mode = keycast::Mode::parse(m).ok_or_else(|| format!("no feature command {id}"))?;
            keycast::start(app, Some(mode)).map(|st| hud_keycast(&st))
        }
        _ => Err(format!("no feature command {id}")),
    }
}

fn hud_keycast(st: &keycast::Status) -> Value {
    json!({ "hud": if st.active { format!("Keycast on: {}", st.mode.word()) } else { "Keycast off".into() } })
}

/// `feature_run`: the Settings window's Start / Stop on a card (`<feature>.<command>`), the HUD's line shown.
#[tauri::command(async)]
pub fn feature_run(app: AppHandle, id: String) -> Result<(), String> {
    let r = run(&app, &id)?;
    if let Some(line) = r["hud"].as_str() {
        crate::hud::show(&app, line);
    }
    Ok(())
}

/// The command rows again: the config changed, keycast started or stopped.
pub fn sync(app: &AppHandle) {
    commands::sync(app);
}

// ---- bar items -------------------------------------------------------------------

/// Register every available feature's bar items (its spec's `bar`); once,
/// at startup, after the bar.
pub fn install(app: &AppHandle) {
    for spec in pal_core::features::all().iter().filter(|s| available(s)) {
        let bars = crate::bar::manifest_bars(&spec["bar"]);
        if !bars.is_empty() {
            crate::bar::register_native(app, spec["id"].as_str().unwrap_or_default(), bars);
        }
    }
}

/// A feature's bar item rendered, as the `BarItem` JSON an extension's render answers.
pub fn bar_item(app: &AppHandle, key: &str) -> Result<Value, String> {
    match key {
        "keycast/active" => Ok(keycast::bar_item(app)),
        _ => Err(format!("no feature bar item {key}")),
    }
}

/// An action in a feature item's popover: the Effect.
pub fn bar_action(app: &AppHandle, key: &str, action: &str) -> Result<Value, String> {
    match key {
        "keycast/active" => keycast::bar_action(app, action),
        _ => Err(format!("no feature bar item {key}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_id_names_a_feature() {
        assert_eq!(split("mouse.reverse_mouse"), Some(("mouse", "reverse_mouse")));
        assert_eq!(split("keycast.toggle"), Some(("keycast", "toggle")));
        assert_eq!(split("settings"), None);
        assert_eq!(split("github.prs"), None, "only a feature's");
    }

    #[test]
    fn a_toggle_row_reads_its_setting() {
        let name = |f: &str, id: &str| toggle_name(pal_core::features::spec(f).unwrap(), pal_core::features::toggles(f).into_iter().find(|s| s["id"] == id).unwrap());
        assert_eq!(name("mouse", "reverse_mouse"), "Reverse scrolling on the mouse");
        assert_eq!(name("expansion", "enabled"), "Text expansion", "the headline switch is the feature");
        assert_eq!(name("reserve", "enabled"), "Keep below the bar");
    }
}
