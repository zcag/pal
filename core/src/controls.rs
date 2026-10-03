//! Controls and groups (`docs/design/controls.md`): what extensions
//! published of the four controls, keyed by instance key, and who serves a
//! control to whom. A group (`[groups.<id>]`) lists devices used together;
//! its `volume` and `inputs` name the member serving each, and its power is
//! every member's. A caller outside any group, or a control its group does
//! not bind, is served by itself. The app keeps one [`Table`] and routes
//! `core/controls.*` through it (`app/src-tauri/src/controls.rs`).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::config::Diagnostic;

/// The controls pal defines, as `sdk/src/protocol.ts` `CONTROL_NAMES`.
pub const NAMES: [&str; 4] = ["volume", "power", "inputs", "player"];
/// The controls a group binds to one member; power is every member's, players are never grouped.
pub const BOUND: [&str; 2] = ["volume", "inputs"];

/// `[groups.<id>]`: devices used together.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Group {
    /// What Settings shows ("Living room"); the id when unset.
    pub title: Option<String>,
    /// The devices: instance keys of extensions that provide a control (`appletv`, `samsungtv`).
    pub members: Vec<String>,
    /// The member serving the volume to every member; unset: each its own.
    pub volume: Option<String>,
    /// The member serving the inputs to every member; unset: each its own.
    pub inputs: Option<String>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Group {
    /// The member bound to `control` (`volume`, `inputs`), when it is one.
    pub fn binding(&self, control: &str) -> Option<&str> {
        let b = match control {
            "volume" => self.volume.as_deref(),
            "inputs" => self.inputs.as_deref(),
            _ => None,
        };
        b.filter(|k| self.members.iter().any(|m| m == k))
    }
}

/// A group id: lowercase letters, digits, `-` and `_`.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 48 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// The group `key` is in: the first by id (a key in two is a warning, the first wins).
pub fn group_of<'a>(groups: &'a BTreeMap<String, Group>, key: &str) -> Option<(&'a str, &'a Group)> {
    groups.iter().find(|(_, g)| g.members.iter().any(|m| m == key)).map(|(id, g)| (id.as_str(), g))
}

/// What is wrong with `[groups]`, as load warnings.
pub fn diagnostics(groups: &BTreeMap<String, Group>) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    let mut seen: BTreeMap<&str, &str> = BTreeMap::new();
    for (id, g) in groups {
        if !valid_id(id) {
            out.push(Diagnostic::warn(format!("groups.{id}"), "a group id is lowercase letters, digits, - and _"));
        }
        for m in &g.members {
            match seen.get(m.as_str()) {
                Some(first) => out.push(Diagnostic::warn(format!("groups.{id}.members"), format!("{m} is in group {first} already; that one wins"))),
                None => {
                    seen.insert(m, id);
                }
            }
        }
        for c in BOUND {
            let b = if c == "volume" { &g.volume } else { &g.inputs };
            if let Some(b) = b.as_deref().filter(|b| !g.members.iter().any(|m| m == b)) {
                out.push(Diagnostic::warn(format!("groups.{id}.{c}"), format!("{b} is not a member of the group; ignored")));
            }
        }
        out.extend(g.extra.keys().map(|k| Diagnostic::warn(format!("groups.{id}.{k}"), "unknown key")));
    }
    out
}

/// One change for `controls/changed`: `provider` published `control` (empty on a regroup), and the keys whose `get` answer may have moved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Change {
    pub control: String,
    pub provider: String,
    pub keys: Vec<String>,
}

/// Every published state, by `(instance key, control)`.
#[derive(Debug, Default)]
pub struct Table {
    published: BTreeMap<(String, String), Map<String, Value>>,
}

impl Table {
    /// `key`'s state of `control`; `None` withdraws. Answers the change, or nothing when the value is the one already there.
    pub fn publish(&mut self, groups: &BTreeMap<String, Group>, key: &str, control: &str, state: Option<Map<String, Value>>) -> Result<Option<Change>, String> {
        if !NAMES.contains(&control) {
            return Err(format!("no control {control}: one of {}", NAMES.join(", ")));
        }
        let at = (key.to_string(), control.to_string());
        let moved = match state {
            Some(s) => self.published.insert(at, s.clone()).as_ref() != Some(&s),
            None => self.published.remove(&at).is_some(),
        };
        Ok(moved.then(|| Change { control: control.into(), provider: key.into(), keys: affected(groups, key) }))
    }

    /// Everything `key` published goes (its extension unloaded).
    pub fn forget(&mut self, groups: &BTreeMap<String, Group>, key: &str) -> Vec<Change> {
        let gone: Vec<String> = self.published.keys().filter(|(k, _)| k == key).map(|(_, c)| c.clone()).collect();
        gone.into_iter()
            .map(|c| {
                self.published.remove(&(key.to_string(), c.clone()));
                Change { control: c, provider: key.into(), keys: affected(groups, key) }
            })
            .collect()
    }

    fn state(&self, key: &str, control: &str) -> Option<&Map<String, Value>> {
        self.published.get(&(key.to_string(), control.to_string()))
    }

    /// `key`'s state with `provider` on it.
    fn served(&self, key: &str, control: &str) -> Option<Value> {
        let s = self.state(key, control)?;
        let mut v = s.clone();
        v.insert("provider".into(), json!({ "key": key, "device": s.get("device") }));
        Some(Value::Object(v))
    }

    /// `control` as it is served to `caller` (`controls.get`): its group's binding, else itself; power in a group is every member's.
    pub fn get(&self, groups: &BTreeMap<String, Group>, caller: &str, control: &str) -> Option<Value> {
        let group = group_of(groups, caller).map(|(_, g)| g);
        if control == "power" {
            if let Some(g) = group {
                let members: Vec<(&str, &Map<String, Value>)> = g.members.iter().filter_map(|m| self.state(m, "power").map(|s| (m.as_str(), s))).collect();
                let (first, state) = *members.iter().find(|(k, _)| *k == caller).or(members.first())?;
                let any = |f: &str| members.iter().any(|(_, s)| s.get(f) == Some(&Value::Bool(true)));
                let known = members.iter().any(|(_, s)| s.get("on").is_some_and(Value::is_boolean));
                let mut v = Map::new();
                if known {
                    v.insert("on".into(), json!(any("on")));
                }
                if any("busy") {
                    v.insert("busy".into(), json!(true));
                }
                v.insert("provider".into(), json!({ "key": first, "device": state.get("device") }));
                v.insert("members".into(), Value::Array(members.iter().map(|(k, s)| { let mut m = (*s).clone(); m.insert("key".into(), json!(k)); Value::Object(m) }).collect()));
                return Some(Value::Object(v));
            }
        }
        match group.and_then(|g| g.binding(control)) {
            Some(b) => self.served(b, control),
            None => self.served(caller, control),
        }
    }

    /// Every provider's state of `control` (`controls.all`), by key.
    pub fn all(&self, control: &str) -> Vec<Value> {
        self.published.keys().filter(|(_, c)| c == control).filter_map(|(k, _)| self.served(k, control)).collect()
    }

    /// Who `controls.run` lands on for `caller`: the group's binding, every member that published power in a group, else the caller.
    pub fn targets(&self, groups: &BTreeMap<String, Group>, caller: &str, control: &str) -> Vec<String> {
        let group = group_of(groups, caller).map(|(_, g)| g);
        if control == "power" {
            if let Some(g) = group {
                let members: Vec<String> = g.members.iter().filter(|m| self.state(m, "power").is_some()).cloned().collect();
                if !members.is_empty() {
                    return members;
                }
            }
        }
        vec![group.and_then(|g| g.binding(control)).unwrap_or(caller).to_string()]
    }

    /// Every key published, with what (Settings › Groups names devices by it).
    pub fn snapshot(&self) -> BTreeMap<String, BTreeMap<String, Value>> {
        let mut out: BTreeMap<String, BTreeMap<String, Value>> = BTreeMap::new();
        for ((k, c), s) in &self.published {
            out.entry(k.clone()).or_default().insert(c.clone(), Value::Object(s.clone()));
        }
        out
    }
}

/// The keys whose answers a publish by `key` can move: itself and its group's members.
fn affected(groups: &BTreeMap<String, Group>, key: &str) -> Vec<String> {
    let mut keys: BTreeSet<String> = BTreeSet::from([key.to_string()]);
    if let Some((_, g)) = group_of(groups, key) {
        keys.extend(g.members.iter().cloned());
    }
    keys.into_iter().collect()
}

/// The changes a `[groups]` edit makes: every control, for every member of a group that changed (before or after).
pub fn regrouped(prev: &BTreeMap<String, Group>, next: &BTreeMap<String, Group>) -> Vec<Change> {
    let ids: BTreeSet<&String> = prev.keys().chain(next.keys()).collect();
    let mut keys = BTreeSet::new();
    for id in ids {
        let (a, b) = (prev.get(id), next.get(id));
        if a != b {
            keys.extend(a.into_iter().chain(b).flat_map(|g| g.members.iter().cloned()));
        }
    }
    if keys.is_empty() {
        return Vec::new();
    }
    let keys: Vec<String> = keys.into_iter().collect();
    NAMES.iter().filter(|c| **c != "player").map(|c| Change { control: c.to_string(), provider: String::new(), keys: keys.clone() }).collect()
}

/// A group id for `title` not taken in `groups`: its words slugged (`Living room` → `living-room`), a number on a clash.
pub fn new_id(groups: &BTreeMap<String, Group>, title: &str) -> String {
    let mut base: String = title.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    base = base.split('-').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-");
    base.truncate(40);
    if base.is_empty() {
        base = "group".into();
    }
    if !groups.contains_key(&base) {
        return base;
    }
    (2..).map(|n| format!("{base}-{n}")).find(|id| !groups.contains_key(id)).unwrap_or(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(v: Value) -> Option<Map<String, Value>> {
        v.as_object().cloned()
    }

    fn living() -> BTreeMap<String, Group> {
        BTreeMap::from([("living-room".to_string(), Group { title: Some("Living room".into()), members: vec!["appletv".into(), "samsungtv".into()], volume: Some("samsungtv".into()), inputs: Some("samsungtv".into()), ..Default::default() })])
    }

    #[test]
    fn a_group_serves_the_bound_member_and_an_outsider_itself() {
        let g = living();
        let mut t = Table::default();
        t.publish(&g, "samsungtv", "volume", st(json!({ "level": 0.24, "device": "75\" Neo QLED" }))).unwrap();
        t.publish(&g, "appletv", "volume", st(json!({ "level": 0.9 }))).unwrap();
        let v = t.get(&g, "appletv", "volume").unwrap();
        assert_eq!((v["level"].as_f64(), v["provider"]["key"].as_str(), v["provider"]["device"].as_str()), (Some(0.24), Some("samsungtv"), Some("75\" Neo QLED")), "the Apple TV's volume is the TV's");
        assert_eq!(t.targets(&g, "appletv", "volume"), ["samsungtv"]);
        assert_eq!(t.get(&BTreeMap::new(), "appletv", "volume").unwrap()["level"], json!(0.9), "ungrouped: its own");
        assert_eq!(t.targets(&BTreeMap::new(), "appletv", "volume"), ["appletv"]);
        assert!(t.get(&g, "appletv", "inputs").is_none(), "bound to a member that published nothing: nobody serves it");
        assert!(t.get(&g, "spotify", "volume").is_none(), "not a member, published nothing");
    }

    #[test]
    fn power_in_a_group_is_every_members() {
        let g = living();
        let mut t = Table::default();
        t.publish(&g, "appletv", "power", st(json!({ "on": false }))).unwrap();
        t.publish(&g, "samsungtv", "power", st(json!({ "on": true, "busy": true }))).unwrap();
        let p = t.get(&g, "appletv", "power").unwrap();
        assert_eq!((p["on"].as_bool(), p["busy"].as_bool(), p["provider"]["key"].as_str()), (Some(true), Some(true), Some("appletv")));
        assert_eq!(p["members"].as_array().map(Vec::len), Some(2));
        assert_eq!(t.targets(&g, "samsungtv", "power"), ["appletv", "samsungtv"]);
        assert_eq!(t.targets(&g, "appletv", "player"), ["appletv"], "players are never grouped");
    }

    #[test]
    fn a_publish_names_who_it_moves_and_a_repeat_moves_nothing() {
        let g = living();
        let mut t = Table::default();
        let c = t.publish(&g, "samsungtv", "volume", st(json!({ "level": 0.1 }))).unwrap().unwrap();
        assert_eq!((c.provider.as_str(), c.keys.clone()), ("samsungtv", vec!["appletv".to_string(), "samsungtv".to_string()]));
        assert!(t.publish(&g, "samsungtv", "volume", st(json!({ "level": 0.1 }))).unwrap().is_none());
        assert!(t.publish(&g, "x", "brightness", None).is_err());
        assert_eq!(t.all("volume").len(), 1);
        assert_eq!(t.forget(&g, "samsungtv").len(), 1);
        assert!(t.all("volume").is_empty());
    }

    #[test]
    fn config_warnings_and_ids() {
        let mut g = living();
        g.insert("bed".into(), Group { members: vec!["appletv".into()], volume: Some("hue".into()), ..Default::default() });
        g.insert("Bad Id".into(), Group::default());
        let d: Vec<(String, String)> = diagnostics(&g).into_iter().map(|d| (d.path, d.message)).collect();
        assert!(d.iter().any(|(p, m)| p == "groups.bed.volume" && m.contains("not a member")), "{d:?}");
        assert!(d.iter().any(|(p, m)| p == "groups.living-room.members" && m.contains("in group bed already")), "{d:?}");
        assert!(d.iter().any(|(p, _)| p == "groups.Bad Id"), "{d:?}");
        assert_eq!(group_of(&g, "appletv").map(|(id, _)| id), Some("bed"), "the first by id wins");
        assert_eq!(new_id(&living(), "Living room"), "living-room-2");
        assert_eq!(new_id(&BTreeMap::new(), "  Bed / Room! "), "bed-room");
        assert_eq!(new_id(&BTreeMap::new(), "🎬"), "group");
    }

    #[test]
    fn regrouping_moves_the_members_of_changed_groups_only() {
        let prev = living();
        let mut next = living();
        assert!(regrouped(&prev, &next).is_empty());
        next.get_mut("living-room").unwrap().volume = None;
        let c = regrouped(&prev, &next);
        assert_eq!(c.len(), 3, "volume, power, inputs: players are not grouped");
        assert_eq!(c[0].keys, ["appletv", "samsungtv"]);
    }
}
