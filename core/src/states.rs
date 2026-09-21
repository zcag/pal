//! States: named variables the whole of pal reads (`docs/design/states.md`).
//! The user declares them in `[states]`, sets them by hand (for an hour,
//! until reset), derives them from one another with a Jinja expression,
//! feeds them from the CLI or an extension, and points bar items at them
//! (`show_when` / `hide_when`).
//!
//! This is the pure model: layers in, resolved values and the set that
//! changed out. Every write recomputes the whole table (tens of states,
//! once a minute at most from the clock) rather than walking a graph; the
//! dependency edges are still extracted, for the cycle check and for
//! "what depends on this".
//!
//! Resolution, per state: a manual value (with an optional expiry) wins,
//! else its expression, else what was published for it (an extension's
//! last `state.set`, a built-in's value), else its declared default
//! (`false` for a declared state, `null` for one only ever published).
//!
//! Names: the user's are bare (`working`), the built-ins bare and reserved
//! ([`BUILTINS`]), an extension's `<key>/<name>` (`sessions/working`).
//! In an expression, since `/` divides, an extension's is `sessions.working`
//! (its states as a map under its key) and any name at all is
//! `states['gmail@work/unread']`.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::OnceLock;

use minijinja::{Environment, Expression, UndefinedBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::Diagnostic;

/// The ready-made variables the app feeds (`app/src-tauri/src/states.rs`);
/// a `[states.<name>]` on one of these is a load error.
pub const BUILTINS: &[&str] = &["hour", "minute", "weekday", "date", "front_app", "awake_since", "network", "theme", "locked", "idle", "host", "panel"];

/// One `[states.<name>]` table.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Decl {
    /// A Jinja expression over other states (`hour >= 9 and hour < 18`);
    /// re-evaluated whenever a state it names changes. Without one the
    /// state is only ever set by hand, from the CLI or by a publisher.
    pub expr: Option<String>,
    /// The value with nothing set and no expression; `false` when absent.
    #[schemars(with = "Option<serde_json::Value>")]
    pub default: Option<toml::Value>,
    /// What the States palette shows under the name.
    pub description: Option<String>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

/// Which layer answered for a state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Manual,
    Expr,
    /// A publisher: the extension's key, or `builtin`.
    Published(String),
    Default,
}

/// A manual value: what `pal state set` / the palette put, until `until` (unix ms) or reset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manual {
    pub value: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<u64>,
}

/// A published value: an extension's last `state.set`, or a built-in's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Published {
    pub value: Value,
    pub who: String,
    /// Unix ms.
    pub at: u64,
}

/// What survives a relaunch (`<data dir>/states.json`): the manual and
/// published layers. Built-ins are not stored; they are read at startup.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Persisted {
    pub manual: BTreeMap<String, Manual>,
    pub published: BTreeMap<String, Published>,
}

/// One state as `pal state` and the palette list it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub value: Value,
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expr: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The expression failed to parse or evaluate; the state reads `null`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Declared in the config (else it exists because something set it).
    pub declared: bool,
    pub builtin: bool,
}

/// A parsed expression with the states it reads.
struct Compiled {
    expr: Expression<'static, 'static>,
    deps: BTreeSet<String>,
    /// `states[...]` in the source: reads anything, so depends on everything.
    any: bool,
}

/// What a bar item asks of the states (`docs/design/states.md`, "Rules"):
/// the user's `show_when`/`hide_when`, and the `when` of each rule, in
/// order, by id.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BarConditions {
    pub key: String,
    pub show_when: Option<String>,
    pub hide_when: Option<String>,
    pub rules: Vec<(String, String)>,
}

#[derive(Default)]
struct BarCond {
    show: Option<Compiled>,
    hide: Option<Compiled>,
    rules: Vec<(String, Compiled)>,
}

/// The table. `configure` takes the config, the layer setters take one
/// value each, and every one answers the names whose resolved value
/// changed.
#[derive(Default)]
pub struct States {
    decls: BTreeMap<String, Decl>,
    exprs: BTreeMap<String, Compiled>,
    /// Per bar item key: `show_when`, `hide_when`, and its rules' `when` by id in order.
    bar: BTreeMap<String, BarCond>,
    manual: BTreeMap<String, Manual>,
    published: BTreeMap<String, Published>,
    resolved: BTreeMap<String, Value>,
    /// Expressions `configure` could not use (a parse error, a cycle): the state reads null.
    broken: BTreeMap<String, String>,
    /// Expressions that failed to evaluate last time.
    errors: BTreeMap<String, String>,
    diagnostics: Vec<Diagnostic>,
}

fn env() -> &'static Environment<'static> {
    static ENV: OnceLock<Environment<'static>> = OnceLock::new();
    ENV.get_or_init(|| {
        let mut e = Environment::new();
        // An unknown state is left out of the context, so it is undefined: falsy on its own, `not x` is true, and a comparison or an attribute read on it fails (the expression reads null) rather than sorting below every number as `none` would (`none < 20` is true in Jinja; a rule must not fire on a state nothing has fed).
        e.set_undefined_behavior(UndefinedBehavior::SemiStrict);
        e
    })
}

/// A user's or built-in name: lowercase letters, digits, `_`.
pub fn is_bare(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// Any name: bare, or `<extension key>/<bare>`.
pub fn is_name(name: &str) -> bool {
    match name.split_once('/') {
        None => is_bare(name),
        Some((ext, n)) => (crate::config::instance::is_key(ext) || crate::config::instance::valid_name(ext)) && is_bare(n),
    }
}

/// A JSON scalar: what a state may hold.
pub fn is_scalar(v: &Value) -> bool {
    !matches!(v, Value::Array(_) | Value::Object(_))
}

fn compile(src: &str) -> Result<Compiled, String> {
    let expr = env().compile_expression_owned(src.to_string()).map_err(|e| e.to_string())?;
    let mut deps = BTreeSet::new();
    let mut any = false;
    for v in expr.undeclared_variables(true) {
        if v == "states" || v.starts_with("states.") || v.starts_with("states[") {
            any = true;
            continue;
        }
        // `sessions.working` reads the state `sessions/working`, or a bare `sessions` with an attribute: both are recorded, since the extension's may not exist yet.
        let (head, rest) = v.split_once('.').map_or((v.as_str(), None), |(h, r)| (h, Some(r)));
        deps.insert(head.to_string());
        if let Some(r) = rest {
            deps.insert(format!("{head}/{r}"));
        }
    }
    Ok(Compiled { expr, deps, any })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn toml_to_json(v: &toml::Value) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

impl States {
    /// The config's `[states]` and every bar item's conditions, replacing
    /// the last configuration. Answers the names whose value changed; the
    /// diagnostics are kept ([`Self::diagnostics`]).
    pub fn configure(&mut self, decls: &BTreeMap<String, Decl>, bar: &[BarConditions]) -> Vec<String> {
        let mut diags = Vec::new();
        self.decls.clear();
        self.exprs.clear();
        self.bar.clear();
        self.broken.clear();
        for (name, d) in decls {
            if BUILTINS.contains(&name.as_str()) {
                diags.push(Diagnostic::warn(format!("states.{name}"), "a built-in state; pick another name"));
                continue;
            }
            if !is_bare(name) {
                diags.push(Diagnostic::warn(format!("states.{name}"), "not a state name: lowercase letters, digits and _"));
                continue;
            }
            if let Some(d) = &d.default {
                if !is_scalar(&toml_to_json(d)) {
                    diags.push(Diagnostic::warn(format!("states.{name}.default"), "a state holds a scalar (true, 3, \"home\"); ignored"));
                }
            }
            self.decls.insert(name.clone(), d.clone());
        }
        let known = |n: &str| self.decls.contains_key(n) || self.published.contains_key(n) || self.manual.contains_key(n) || BUILTINS.contains(&n);
        for (name, d) in &self.decls {
            if let Some(src) = &d.expr {
                match compile(src) {
                    Ok(c) => {
                        // One warning per name read: `a.b` recorded `a` and `a/b`, and either being a state (or `a` an extension with states) is fine.
                        for dep in c.deps.iter().filter(|d| !d.contains('/')) {
                            let slashed = c.deps.iter().any(|d| d.starts_with(&format!("{dep}/")) && known(d));
                            let prefix = self.published.keys().any(|k| k.starts_with(&format!("{dep}/")));
                            if !known(dep) && !slashed && !prefix {
                                diags.push(Diagnostic::warn(format!("states.{name}.expr"), format!("`{dep}` is not a state; the expression reads null until something sets it")));
                            }
                        }
                        self.exprs.insert(name.clone(), c);
                    }
                    Err(e) => {
                        diags.push(Diagnostic::warn(format!("states.{name}.expr"), e.clone()));
                        self.broken.insert(name.clone(), e);
                    }
                }
            }
        }
        for b in bar {
            let key = &b.key;
            let mut one = |src: &str, which: &str| match compile(src) {
                Ok(c) => Some(c),
                Err(e) => {
                    diags.push(Diagnostic::warn(format!("bar.items.{key}.{which}"), e));
                    None
                }
            };
            let show = b.show_when.as_deref().and_then(|s| one(s, "show_when"));
            let hide = b.hide_when.as_deref().and_then(|s| one(s, "hide_when"));
            let rules: Vec<(String, Compiled)> = b.rules.iter().filter_map(|(id, w)| one(w, &format!("rules.{id}.when")).map(|c| (id.clone(), c))).collect();
            if show.is_some() || hide.is_some() || !rules.is_empty() {
                self.bar.insert(key.clone(), BarCond { show, hide, rules });
            }
        }
        for cycle in self.cycles() {
            diags.push(Diagnostic::warn(format!("states.{}.expr", cycle[0]), format!("a cycle: {}; each reads null", cycle.join(" -> "))));
            for n in cycle {
                self.exprs.remove(&n);
                self.broken.insert(n, "a cycle".into());
            }
        }
        self.diagnostics = diags;
        self.recompute()
    }

    /// The problems the last `configure` found.
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }

    /// Restore the persisted layers (at startup, before `configure`).
    pub fn load(&mut self, p: Persisted) -> Vec<String> {
        self.manual = p.manual;
        self.published = p.published;
        self.recompute()
    }

    /// The layers to persist.
    pub fn persisted(&self) -> Persisted {
        Persisted { manual: self.manual.clone(), published: self.published.clone() }
    }

    /// `pal state set`: the manual layer, until `until` (unix ms) or reset.
    pub fn set_manual(&mut self, name: &str, value: Value, until: Option<u64>) -> Result<Vec<String>, String> {
        if !is_name(name) {
            return Err(format!("not a state name: {name}"));
        }
        if !is_scalar(&value) {
            return Err("a state holds a scalar (true, 3, \"home\")".into());
        }
        self.manual.insert(name.to_string(), Manual { value, until });
        Ok(self.recompute())
    }

    /// `pal state reset`: the manual layer goes.
    pub fn reset(&mut self, name: &str) -> Vec<String> {
        self.manual.remove(name);
        self.recompute()
    }

    /// A publisher's value: `who` is the extension's key (`state.set` lands
    /// under `<who>/<name>`) or `builtin`. `null` withdraws it.
    pub fn publish(&mut self, name: &str, who: &str, value: Value) -> Result<Vec<String>, String> {
        if !is_name(name) {
            return Err(format!("not a state name: {name}"));
        }
        if !is_scalar(&value) {
            return Err("a state holds a scalar (true, 3, \"home\")".into());
        }
        if value.is_null() {
            self.published.remove(name);
        } else {
            self.published.insert(name.to_string(), Published { value, who: who.to_string(), at: now_ms() });
        }
        Ok(self.recompute())
    }

    /// Drop the manual values whose `until` has passed at `now` (unix ms).
    pub fn expire(&mut self, now: u64) -> Vec<String> {
        let before = self.manual.len();
        self.manual.retain(|_, m| m.until.is_none_or(|u| u > now));
        if self.manual.len() == before {
            return Vec::new();
        }
        self.recompute()
    }

    /// The nearest `until` among the manual values.
    pub fn next_expiry(&self) -> Option<u64> {
        self.manual.values().filter_map(|m| m.until).min()
    }

    /// The resolved value; `None` when no such state.
    pub fn get(&self, name: &str) -> Option<&Value> {
        self.resolved.get(name)
    }

    /// Every state, by name.
    pub fn values(&self) -> &BTreeMap<String, Value> {
        &self.resolved
    }

    /// Every state as the CLI and the palette list them.
    pub fn list(&self) -> Vec<Entry> {
        self.names()
            .into_iter()
            .map(|name| {
                let d = self.decls.get(&name);
                let (source, until) = self.source_of(&name);
                Entry {
                    value: self.resolved.get(&name).cloned().unwrap_or(Value::Null),
                    source,
                    until,
                    expr: d.and_then(|d| d.expr.clone()),
                    description: d.and_then(|d| d.description.clone()),
                    error: self.broken.get(&name).or_else(|| self.errors.get(&name)).cloned(),
                    declared: d.is_some(),
                    builtin: BUILTINS.contains(&name.as_str()),
                    name,
                }
            })
            .collect()
    }

    /// Whether the bar item `key` shows by its `show_when`/`hide_when`
    /// (true without either).
    pub fn shows(&self, key: &str) -> bool {
        let Some(b) = self.bar.get(key) else { return true };
        let ctx = self.context();
        let truthy = |c: &Compiled| c.expr.eval(&ctx).map(|v| v.is_true()).unwrap_or(false);
        b.show.as_ref().is_none_or(truthy) && !b.hide.as_ref().is_some_and(truthy)
    }

    /// The ids of the bar item's rules whose `when` holds now, in rule order.
    pub fn active_rules(&self, key: &str) -> Vec<String> {
        let Some(b) = self.bar.get(key) else { return Vec::new() };
        let ctx = self.context();
        b.rules.iter().filter(|(_, c)| c.expr.eval(&ctx).map(|v| v.is_true()).unwrap_or(false)).map(|(id, _)| id.clone()).collect()
    }

    /// The bar items whose `show_when`/`hide_when` or a rule reads one of `changed`.
    pub fn bar_items_reading(&self, changed: &[String]) -> Vec<String> {
        let reads = |c: &Compiled| c.any || c.deps.iter().any(|d| changed.contains(d));
        self.bar
            .iter()
            .filter(|(_, b)| b.show.as_ref().is_some_and(reads) || b.hide.as_ref().is_some_and(reads) || b.rules.iter().any(|(_, c)| reads(c)))
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// `pal state eval`: an expression against the table now.
    pub fn eval(&self, src: &str) -> Result<Value, String> {
        let c = compile(src)?;
        let v = c.expr.eval(self.context()).map_err(|e| e.to_string())?;
        Ok(serde_json::to_value(v).unwrap_or(Value::Null))
    }

    fn names(&self) -> BTreeSet<String> {
        let mut n: BTreeSet<String> = BUILTINS.iter().map(|s| s.to_string()).collect();
        n.extend(self.decls.keys().cloned());
        n.extend(self.manual.keys().cloned());
        n.extend(self.published.keys().cloned());
        n
    }

    fn source_of(&self, name: &str) -> (Source, Option<u64>) {
        if let Some(m) = self.manual.get(name) {
            return (Source::Manual, m.until);
        }
        if self.exprs.contains_key(name) || self.broken.contains_key(name) {
            return (Source::Expr, None);
        }
        if let Some(p) = self.published.get(name) {
            return (Source::Published(p.who.clone()), None);
        }
        (Source::Default, None)
    }

    /// The expression context: bare names as variables, an extension's
    /// states as a map under its key, and `states` with every name.
    fn context(&self) -> minijinja::Value {
        let mut top: BTreeMap<String, Value> = BTreeMap::new();
        let mut maps: BTreeMap<String, serde_json::Map<String, Value>> = BTreeMap::new();
        for (name, v) in self.resolved.iter().filter(|(_, v)| !v.is_null()) {
            match name.split_once('/') {
                Some((ext, n)) => {
                    maps.entry(ext.to_string()).or_default().insert(n.to_string(), v.clone());
                }
                None => {
                    top.insert(name.clone(), v.clone());
                }
            }
        }
        for (ext, m) in maps {
            top.entry(ext).or_insert(Value::Object(m));
        }
        let all: serde_json::Map<String, Value> = self.resolved.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
        top.insert("states".into(), Value::Object(all));
        minijinja::Value::from_serialize(&top)
    }

    /// Every state from its layers, expressions in dependency order; the
    /// names whose value changed since the last time.
    fn recompute(&mut self) -> Vec<String> {
        let before = std::mem::take(&mut self.resolved);
        self.errors.clear();
        // The layers below the expressions first; a broken expression reads null unless set by hand.
        for name in self.names() {
            if self.exprs.contains_key(&name) {
                continue;
            }
            if self.broken.contains_key(&name) && !self.manual.contains_key(&name) {
                self.resolved.insert(name, Value::Null);
                continue;
            }
            let v = self.manual.get(&name).map(|m| m.value.clone()).or_else(|| self.published.get(&name).map(|p| p.value.clone())).unwrap_or_else(|| self.default_of(&name));
            self.resolved.insert(name, v);
        }
        for name in self.order() {
            let v = match self.manual.get(&name) {
                Some(m) => m.value.clone(),
                None => {
                    let ctx = self.context();
                    match self.exprs[&name].expr.eval(ctx) {
                        Ok(v) => match serde_json::to_value(&v) {
                            Ok(v) if is_scalar(&v) => v,
                            _ => {
                                self.errors.insert(name.clone(), "the expression is not a scalar".into());
                                Value::Null
                            }
                        },
                        Err(e) => {
                            self.errors.insert(name.clone(), e.to_string());
                            Value::Null
                        }
                    }
                }
            };
            self.resolved.insert(name, v);
        }
        // Absent and null are the same value: a built-in nothing has fed yet is not a change.
        let of = |m: &BTreeMap<String, Value>, k: &str| m.get(k).cloned().unwrap_or(Value::Null);
        self.resolved.keys().chain(before.keys()).filter(|k| of(&before, k) != of(&self.resolved, k)).cloned().collect::<BTreeSet<_>>().into_iter().collect()
    }

    fn default_of(&self, name: &str) -> Value {
        match self.decls.get(name) {
            Some(d) => d.default.as_ref().map(toml_to_json).filter(is_scalar).unwrap_or(Value::Bool(false)),
            None => Value::Null,
        }
    }

    /// The expression states in an order where every dependency comes
    /// first (the graph is acyclic after `configure`; an `any` reads the
    /// rest, so it goes last).
    fn order(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut done: HashSet<String> = HashSet::new();
        let mut pending: Vec<&String> = self.exprs.keys().collect();
        while !pending.is_empty() {
            let (ready, rest): (Vec<_>, Vec<_>) = pending.into_iter().partition(|n| {
                let c = &self.exprs[*n];
                !c.any && c.deps.iter().all(|d| !self.exprs.contains_key(d) || done.contains(d))
            });
            if ready.is_empty() {
                // Only `any` readers (or a cycle configure missed): in name order.
                out.extend(rest.into_iter().cloned());
                break;
            }
            for n in ready {
                done.insert(n.clone());
                out.push(n.clone());
            }
            pending = rest;
        }
        out
    }

    /// Every cycle among the expression states, each as its path.
    fn cycles(&self) -> Vec<Vec<String>> {
        let mut found = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for start in self.exprs.keys() {
            let mut stack = vec![(start.clone(), vec![start.clone()])];
            while let Some((n, path)) = stack.pop() {
                let Some(c) = self.exprs.get(&n) else { continue };
                for d in &c.deps {
                    if d == start {
                        if !seen.contains(start) {
                            found.push(path.clone());
                        }
                        for p in &path {
                            seen.insert(p.clone());
                        }
                    } else if !path.contains(d) && self.exprs.contains_key(d) {
                        let mut p = path.clone();
                        p.push(d.clone());
                        stack.push((d.clone(), p));
                    }
                }
            }
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn decl(expr: &str) -> Decl {
        Decl { expr: Some(expr.into()), ..Decl::default() }
    }

    fn table(pairs: &[(&str, Decl)]) -> BTreeMap<String, Decl> {
        pairs.iter().map(|(k, d)| (k.to_string(), d.clone())).collect()
    }

    #[test]
    fn layers_resolve_in_order() {
        let mut s = States::default();
        s.configure(&table(&[("working", decl("hour >= 9 and hour < 18")), ("deep", Decl::default())]), &[]);
        assert_eq!(s.get("hour"), Some(&Value::Null), "null until the app feeds it");
        assert_eq!(s.get("working"), Some(&Value::Null), "a comparison against an unknown is unknown");
        assert_eq!(s.get("deep"), Some(&json!(false)), "a declared state without a value is false");
        let changed = s.publish("hour", "builtin", json!(10)).unwrap();
        assert_eq!(changed, ["hour", "working"]);
        assert_eq!(s.get("working"), Some(&json!(true)));
        assert!(s.publish("hour", "builtin", json!(20)).unwrap().contains(&"working".to_string()));
        assert_eq!(s.get("working"), Some(&json!(false)));
        s.set_manual("working", json!(true), Some(u64::MAX)).unwrap();
        assert_eq!(s.get("working"), Some(&json!(true)));
        assert_eq!(s.source_of("working"), (Source::Manual, Some(u64::MAX)));
        assert_eq!(s.reset("working"), ["working"]);
        assert_eq!(s.get("working"), Some(&json!(false)));
        assert_eq!(s.source_of("working").0, Source::Expr);
    }

    #[test]
    fn manual_expires() {
        let mut s = States::default();
        s.set_manual("deep", json!(true), Some(100)).unwrap();
        assert_eq!(s.next_expiry(), Some(100));
        assert!(s.expire(99).is_empty());
        assert_eq!(s.expire(100), ["deep"]);
        assert_eq!(s.get("deep"), None, "an undeclared state goes with its last layer");
    }

    #[test]
    fn extension_states_are_maps_in_expressions() {
        let mut s = States::default();
        s.publish("sessions/working", "sessions", json!(2)).unwrap();
        s.publish("gmail@work/unread", "gmail@work", json!(4)).unwrap();
        s.configure(&table(&[("busy", decl("sessions.working > 0 or states['gmail@work/unread'] > 10"))]), &[]);
        assert_eq!(s.get("busy"), Some(&json!(true)));
        assert!(s.exprs["busy"].any);
        assert!(s.exprs["busy"].deps.contains("sessions/working"));
        s.publish("sessions/working", "sessions", json!(0)).unwrap();
        assert_eq!(s.get("busy"), Some(&json!(false)));
        s.publish("sessions/working", "sessions", Value::Null).unwrap();
        assert_eq!(s.get("sessions/working"), None, "withdrawn");
        assert_eq!(s.get("busy"), Some(&Value::Null), "an attribute of a missing map is unknown");
        s.configure(&table(&[("quiet", decl("not sessions"))]), &[]);
        assert_eq!(s.get("quiet"), Some(&json!(true)), "a bare unknown is falsy");
    }

    #[test]
    fn errors_and_unknowns_read_null() {
        let mut s = States::default();
        s.configure(&table(&[("a", decl("nothing > 3")), ("b", decl("hour >")), ("c", decl("hour"))]), &[]);
        let paths: Vec<&str> = s.diagnostics().iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, ["states.a.expr", "states.b.expr"]);
        assert_eq!(s.get("b"), Some(&Value::Null));
        assert_eq!(s.get("c"), Some(&Value::Null), "an undefined built-in is null, not false");
        let e = s.list().into_iter().find(|e| e.name == "b").unwrap();
        assert!(e.error.is_some() && e.declared && !e.builtin);
    }

    #[test]
    fn cycles_are_reported_and_null() {
        let mut s = States::default();
        s.configure(&table(&[("a", decl("b")), ("b", decl("a")), ("c", decl("true"))]), &[]);
        assert_eq!(s.diagnostics().len(), 1);
        assert!(s.diagnostics()[0].message.contains("a -> b"));
        assert_eq!(s.get("a"), Some(&Value::Null));
        assert_eq!(s.get("c"), Some(&json!(true)));
    }

    #[test]
    fn builtins_and_bad_names_are_refused() {
        let mut s = States::default();
        s.configure(&table(&[("hour", decl("1")), ("Bad-Name", Decl::default())]), &[]);
        assert_eq!(s.diagnostics().len(), 2);
        assert!(s.set_manual("a/b/c", json!(1), None).is_err());
        assert!(s.set_manual("x", json!([1]), None).is_err());
        assert!(s.set_manual("sessions/working", json!(1), None).is_ok());
    }

    #[test]
    fn bar_items_follow_their_expressions() {
        let mut s = States::default();
        s.publish("hour", "builtin", json!(10)).unwrap();
        let cond = |key: &str, show: Option<&str>, hide: Option<&str>, rules: &[(&str, &str)]| BarConditions { key: key.into(), show_when: show.map(String::from), hide_when: hide.map(String::from), rules: rules.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect() };
        s.configure(&table(&[("working", decl("hour >= 9"))]), &[cond("github/prs", Some("working"), None, &[]), cond("spotify/playing", None, Some("working and states.deep"), &[]), cond("x/y", Some("hour >"), None, &[]), cond("power/battery", None, None, &[("low", "power.level < 20"), ("warn", "power.level < 50"), ("bad", "hour <")])]);
        assert!(s.shows("github/prs"));
        assert!(s.shows("spotify/playing"));
        assert!(s.shows("x/y"), "a bad expression shows the item and is a diagnostic");
        assert_eq!(s.diagnostics().len(), 2, "the bad show_when and the bad rule");
        assert!(s.active_rules("power/battery").is_empty(), "no level yet: none holds");
        s.publish("power/level", "power", json!(15)).unwrap();
        assert_eq!(s.active_rules("power/battery"), ["low", "warn"], "in rule order");
        assert_eq!(s.bar_items_reading(&["power/level".into()]), ["power/battery", "spotify/playing"], "the rule reader, and the `states.` reader of everything");
        s.set_manual("deep", json!(true), None).unwrap();
        assert!(!s.shows("spotify/playing"));
        let mut r = s.bar_items_reading(&["working".into()]);
        r.sort();
        assert_eq!(r, ["github/prs", "spotify/playing"]);
        assert_eq!(s.bar_items_reading(&["hour".into()]), ["spotify/playing"], "`states.` reads everything");
    }

    #[test]
    fn eval_and_persist() {
        let mut s = States::default();
        s.publish("hour", "builtin", json!(10)).unwrap();
        s.set_manual("deep", json!("yes"), Some(5)).unwrap();
        assert_eq!(s.eval("hour * 2").unwrap(), json!(20));
        assert_eq!(s.eval("deep ~ '!'").unwrap(), json!("yes!"));
        assert!(s.eval("hour +").is_err());
        let p = s.persisted();
        let mut t = States::default();
        assert_eq!(t.load(p.clone()), ["deep", "hour"]);
        assert_eq!(t.persisted(), p);
        assert_eq!(serde_json::to_value(&p).unwrap()["manual"]["deep"], json!({ "value": "yes", "until": 5 }));
    }

    #[test]
    fn list_names_every_layer() {
        let mut s = States::default();
        s.configure(&table(&[("working", Decl { expr: Some("hour > 1".into()), description: Some("On the clock".into()), ..Decl::default() })]), &[]);
        s.publish("sessions/n", "sessions", json!(1)).unwrap();
        let l = s.list();
        assert_eq!(l.len(), BUILTINS.len() + 2);
        let w = l.iter().find(|e| e.name == "working").unwrap();
        assert_eq!((w.description.as_deref(), &w.source, w.declared), (Some("On the clock"), &Source::Expr, true));
        let n = l.iter().find(|e| e.name == "sessions/n").unwrap();
        assert_eq!((&n.source, n.declared), (&Source::Published("sessions".into()), false));
        assert!(l.iter().find(|e| e.name == "hour").unwrap().builtin);
    }
}
