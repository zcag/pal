//! The sync client (docs/design/accounts.md "Sync"): extension storage of
//! the extensions that opted in (`"sync"` in `pal.json`) and the config's
//! synced keys, pushed to the account and pulled from it.
//!
//! Everything synced is a value under a key in a space: `ext:<key>` for
//! an extension's storage (an instance has its own), `config` for the
//! config's dotted keys ([`crate::config::sync`]). Per key, [`State`] keeps
//! the revision this machine last saw and the value it had then (the base
//! a `sum` counts from), in `<data dir>/sync-state.json`.
//!
//! - **Push**: a storage write marks its key dirty ([`Sync::mark`], from
//!   the storage watch); a config change makes the next push compare every
//!   key with its base. A push goes out [`DEBOUNCE_MS`] after the last
//!   change, every dirty key with its base revision; the server stores it
//!   as sent when nobody wrote it since, else merges by the key's rule,
//!   and what it answers is taken back.
//! - **Pull**: everything after the last revision seen, on panel show at
//!   most once a [`SHOW_GAP_MS`], every [`PULL_EVERY_MS`], after a push. A
//!   key still dirty here is left alone: its next push merges.
//! - **First sign-in** ([`Sync::first`]): every local key goes with base 0,
//!   so the server merges it with what it has; neither side replaces the
//!   other.
//!
//! A key whose rule is `local` and the config's machine-local keys never
//! leave. Values that arrive are written with `Storage::put` (no mark) and
//! the config's edit path, and come back as [`Changed`] for the host's
//! `storage/changed`.
//!
//! Time is passed in (unix ms), so the tests drive it.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::account::{Client, Error, Result};
use crate::config::instance::name_of;
use crate::config::sync::{flatten_file, Local};
use crate::config::ConfigFile;
use crate::fs::write_atomic;
use crate::storage::Storage;

/// A change waits this long for the next one before it is pushed.
pub const DEBOUNCE_MS: u64 = 3_000;
/// A pull at least this often.
pub const PULL_EVERY_MS: u64 = 15 * 60_000;
/// The panel showing pulls at most this often.
pub const SHOW_GAP_MS: u64 = 60_000;
/// After a failed exchange, nothing is tried for this long.
pub const RETRY_MS: u64 = 60_000;
/// The config's space.
pub const CONFIG: &str = "config";
const STATE: &str = "sync-state.json";

/// `ext:<key>`, an extension's storage space.
pub fn space_of(extension: &str) -> String {
    format!("ext:{extension}")
}

// ---- rules ---------------------------------------------------------------

/// How the server merges two writes of a key (the spec's "Merge rules").
#[derive(Debug, Clone, PartialEq)]
pub enum Rule {
    Max,
    Min,
    Union,
    Sum,
    Latest,
    /// Never synced.
    Local,
    /// An object, field by field; a field not listed is `latest`.
    Fields(BTreeMap<String, Rule>),
}

impl Rule {
    /// `"max"`, ..., `"local"`, or `{"fields": {...}}` (no `local` inside).
    pub fn parse(v: &Value) -> std::result::Result<Rule, String> {
        Rule::parse_in(v, false)
    }

    fn parse_in(v: &Value, nested: bool) -> std::result::Result<Rule, String> {
        match v {
            Value::String(s) => match s.as_str() {
                "max" => Ok(Rule::Max),
                "min" => Ok(Rule::Min),
                "union" => Ok(Rule::Union),
                "sum" => Ok(Rule::Sum),
                "latest" => Ok(Rule::Latest),
                "local" if !nested => Ok(Rule::Local),
                "local" => Err("local is for a whole key, not a field".into()),
                other => Err(format!("{other:?} is not a rule (max, min, union, sum, latest, local, or {{\"fields\": ...}})")),
            },
            Value::Object(o) if o.len() == 1 && o.get("fields").is_some_and(Value::is_object) => {
                let fields = o["fields"].as_object().into_iter().flatten().map(|(k, v)| Rule::parse_in(v, true).map(|r| (k.clone(), r)).map_err(|e| format!("{k}: {e}"))).collect::<std::result::Result<_, _>>()?;
                Ok(Rule::Fields(fields))
            }
            other => Err(format!("{other} is not a rule")),
        }
    }

    /// The server's spelling (`local` never goes out).
    pub fn wire(&self) -> Value {
        match self {
            Rule::Max => json!("max"),
            Rule::Min => json!("min"),
            Rule::Union => json!("union"),
            Rule::Sum => json!("sum"),
            Rule::Latest | Rule::Local => json!("latest"),
            Rule::Fields(f) => json!({ "fields": f.iter().map(|(k, r)| (k.clone(), r.wire())).collect::<serde_json::Map<_, _>>() }),
        }
    }

    /// Whether a merge needs the last synced value (`sum`, anywhere).
    fn counts(&self) -> bool {
        match self {
            Rule::Sum => true,
            Rule::Fields(f) => f.values().any(Rule::counts),
            _ => false,
        }
    }
}

/// An extension's `sync` declaration: present is opted in, a key not
/// listed is `latest`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Decl {
    pub keys: BTreeMap<String, Rule>,
}

impl Decl {
    /// The manifest's `sync`, checked; `None` when the extension did not opt in.
    pub fn from_manifest(manifest: &Value) -> std::result::Result<Option<Decl>, String> {
        match &manifest["sync"] {
            Value::Null => Ok(None),
            Value::Object(o) => {
                let keys = o.iter().map(|(k, v)| Rule::parse(v).map(|r| (k.clone(), r)).map_err(|e| format!("sync.{k}: {e}"))).collect::<std::result::Result<_, _>>()?;
                Ok(Some(Decl { keys }))
            }
            _ => Err("sync: an object of key: rule".into()),
        }
    }

    pub fn rule(&self, key: &str) -> &Rule {
        self.keys.get(key).unwrap_or(&Rule::Latest)
    }
}

// ---- state ---------------------------------------------------------------

/// What a key was the last time it synced.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Base {
    rev: u64,
    value: Value,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct State {
    /// The account's revision this machine last pulled to.
    #[serde(default)]
    rev: u64,
    /// Unix seconds of the last exchange that went through.
    #[serde(default)]
    synced: Option<u64>,
    /// Per space, per key.
    #[serde(default)]
    bases: BTreeMap<String, BTreeMap<String, Base>>,
    /// Storage keys written since they last synced, per extension key.
    #[serde(default)]
    dirty: BTreeMap<String, BTreeSet<String>>,
}

impl State {
    fn base(&self, space: &str, key: &str) -> Option<&Base> {
        self.bases.get(space).and_then(|m| m.get(key))
    }

    fn is_dirty(&self, ext: &str, key: &str) -> bool {
        self.dirty.get(ext).is_some_and(|k| k.contains(key))
    }

    fn clean(&mut self, ext: &str, key: &str) {
        if let Some(keys) = self.dirty.get_mut(ext) {
            keys.remove(key);
            if keys.is_empty() {
                self.dirty.remove(ext);
            }
        }
    }
}

#[derive(Debug, Default)]
struct Timing {
    /// The last change, unix ms.
    changed: Option<u64>,
    /// The config changed: the next push compares it with its bases.
    config: bool,
    pulled: Option<u64>,
    /// Nothing tried before this (after a failure).
    wait: u64,
}

/// A stored value sync changed: the host's `storage/changed`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Changed {
    pub extension: String,
    pub key: String,
    pub value: Value,
}

/// What an exchange did.
#[derive(Debug, Default, PartialEq)]
pub struct Outcome {
    /// Keys sent.
    pub sent: usize,
    /// Storage values that changed here.
    pub storage: Vec<Changed>,
    /// Config keys written here.
    pub config: usize,
    /// Config keys the file could not take, with why.
    pub failed: Vec<(String, String)>,
}

impl Outcome {
    fn add(&mut self, o: Outcome) {
        self.sent += o.sent;
        self.storage.extend(o.storage);
        self.config += o.config;
        self.failed.extend(o.failed);
    }
}

/// What is due at a tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Due {
    /// A push, and the pull after it.
    Push,
    Pull,
}

/// Where synced values live.
pub struct Places<'a> {
    pub storage: &'a Storage,
    pub config: &'a ConfigFile,
}

/// One value in the server's answers.
#[derive(Debug, Clone, Deserialize)]
struct Remote {
    space: String,
    key: String,
    #[serde(default)]
    value: Value,
    rev: u64,
}

#[derive(Debug, Deserialize)]
struct Answer {
    rev: u64,
    #[serde(default)]
    values: Vec<Remote>,
}

pub struct Sync {
    dir: PathBuf,
    state: Mutex<State>,
    timing: Mutex<Timing>,
    /// Per extension name: the loaded manifests' `sync`.
    decls: RwLock<BTreeMap<String, Decl>>,
    local: RwLock<Local>,
    /// Signed in: marks are kept.
    on: AtomicBool,
    /// One exchange at a time.
    busy: Mutex<()>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Sync {
    /// The state in `dir`; the config is compared at the first push.
    pub fn open_in(dir: impl Into<PathBuf>) -> Sync {
        let dir = dir.into();
        let state = std::fs::read(dir.join(STATE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Sync { dir, state: Mutex::new(state), timing: Mutex::new(Timing { config: true, ..Timing::default() }), decls: RwLock::default(), local: RwLock::default(), on: AtomicBool::new(false), busy: Mutex::new(()) }
    }

    pub fn open() -> Sync {
        Sync::open_in(crate::fs::data_dir())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn save(&self, st: &State) {
        if let Err(e) = write_atomic(&self.dir.join(STATE), serde_json::to_vec(st).unwrap_or_default()) {
            eprintln!("sync\tstate not written\t{e}");
        }
    }

    /// Whether writes are tracked (signed in).
    pub fn set_on(&self, on: bool) {
        self.on.store(on, Ordering::SeqCst);
    }

    /// An extension's `sync` (`None`: it did not opt in, or is gone).
    pub fn declare(&self, name: &str, decl: Option<Decl>) {
        let mut d = self.decls.write().unwrap_or_else(|e| e.into_inner());
        match decl {
            Some(decl) => d.insert(name.to_string(), decl),
            None => d.remove(name),
        };
    }

    /// The extensions that opted in, by name.
    pub fn declared(&self) -> Vec<String> {
        self.decls.read().unwrap_or_else(|e| e.into_inner()).keys().cloned().collect()
    }

    fn rule(&self, ext: &str, key: &str) -> Option<Rule> {
        self.decls.read().unwrap_or_else(|e| e.into_inner()).get(name_of(ext)).map(|d| d.rule(key).clone())
    }

    /// The config's machine-local keys in force.
    pub fn set_local(&self, local: Local) {
        *self.local.write().unwrap_or_else(|e| e.into_inner()) = local;
    }

    pub fn local(&self) -> Local {
        self.local.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Unix seconds of the last exchange that went through.
    pub fn last_synced(&self) -> Option<u64> {
        lock(&self.state).synced
    }

    /// A storage write: the key is dirty when its extension opted in and
    /// its rule is not `local`.
    pub fn mark(&self, ext: &str, key: &str, now: u64) {
        if !self.on.load(Ordering::SeqCst) || matches!(self.rule(ext, key), None | Some(Rule::Local)) {
            return;
        }
        let mut st = lock(&self.state);
        if st.dirty.entry(ext.to_string()).or_default().insert(key.to_string()) {
            self.save(&st);
        }
        lock(&self.timing).changed = Some(now);
    }

    /// The config file changed.
    pub fn config_changed(&self, now: u64) {
        let mut t = lock(&self.timing);
        t.config = true;
        t.changed = Some(now);
    }

    /// What a tick at `now` should do.
    pub fn due(&self, now: u64) -> Option<Due> {
        let dirty = !lock(&self.state).dirty.is_empty();
        let t = lock(&self.timing);
        if now < t.wait {
            return None;
        }
        if (dirty || t.config) && t.changed.is_none_or(|c| now >= c + DEBOUNCE_MS) {
            return Some(Due::Push);
        }
        t.pulled.is_none_or(|p| now >= p + PULL_EVERY_MS).then_some(Due::Pull)
    }

    /// The panel showed: whether a pull is due for it.
    pub fn shown(&self, now: u64) -> bool {
        let t = lock(&self.timing);
        now >= t.wait && t.pulled.is_none_or(|p| now >= p + SHOW_GAP_MS)
    }

    /// A tick's work: a push and the pull after it, or a pull. A failure
    /// (offline, a config file that does not parse) waits [`RETRY_MS`]
    /// before the next try.
    pub fn run(&self, due: Due, client: &Client, places: &Places, now: u64) -> Result<Outcome> {
        let r = (|| {
            let mut out = Outcome::default();
            if due == Due::Push {
                out.add(self.push(client, places, now)?);
            }
            out.add(self.pull(client, places, now)?);
            Ok(out)
        })();
        if r.is_err() {
            lock(&self.timing).wait = now + RETRY_MS;
        }
        r
    }

    /// Sign-in on this device: nothing is known of the account, every
    /// local key goes with base 0 at the next push, the config whole.
    pub fn first(&self, storage: &Storage) {
        let mut st = State::default();
        for ext in storage.extensions() {
            for key in storage.keys(&ext).unwrap_or_default() {
                if !matches!(self.rule(&ext, &key), None | Some(Rule::Local)) {
                    st.dirty.entry(ext.clone()).or_default().insert(key);
                }
            }
        }
        self.save(&st);
        *lock(&self.state) = st;
        *lock(&self.timing) = Timing { config: true, ..Timing::default() };
        self.set_on(true);
    }

    /// Signed out: the state goes, local values stay.
    pub fn reset(&self) {
        self.set_on(false);
        *lock(&self.state) = State::default();
        let _ = std::fs::remove_file(self.dir.join(STATE));
    }

    /// The dirty keys and the config's differences, as the server's changes.
    pub fn push(&self, client: &Client, places: &Places, now: u64) -> Result<Outcome> {
        let _busy = lock(&self.busy);
        let config = std::mem::take(&mut lock(&self.timing).config);
        let local = self.local();
        let flat = if config {
            match flatten_file(places.config) {
                Ok(f) => Some(f),
                Err(e) => {
                    eprintln!("sync\tconfig skipped\t{e}");
                    None
                }
            }
        } else {
            None
        };
        // (space, key, extension, value sent, rule)
        let mut changes: Vec<(String, String, Option<String>, Value, Rule)> = Vec::new();
        let body = {
            let mut st = lock(&self.state);
            let mut gone = Vec::new();
            for (ext, keys) in &st.dirty {
                for key in keys {
                    match self.rule(ext, key) {
                        None | Some(Rule::Local) => gone.push((ext.clone(), key.clone())),
                        Some(rule) => changes.push((space_of(ext), key.clone(), Some(ext.clone()), places.storage.get(ext, key).unwrap_or(Value::Null), rule)),
                    }
                }
            }
            for (ext, key) in gone {
                st.clean(&ext, &key);
            }
            if let Some(flat) = &flat {
                let based: BTreeSet<String> = st.bases.get(CONFIG).map(|m| m.keys().cloned().collect()).unwrap_or_default();
                for key in flat.keys().cloned().collect::<BTreeSet<_>>().union(&based) {
                    let now_value = flat.get(key).cloned().unwrap_or(Value::Null);
                    if !local.is_local(key) && Some(&now_value) != st.base(CONFIG, key).map(|b| &b.value).or(Some(&Value::Null)) {
                        changes.push((CONFIG.into(), key.clone(), None, now_value, Rule::Latest));
                    }
                }
            }
            let list: Vec<Value> = changes
                .iter()
                .map(|(space, key, _, value, rule)| {
                    let base = st.base(space, key);
                    let mut c = json!({ "space": space, "key": key, "value": value, "base": base.map_or(0, |b| b.rev), "rule": rule.wire() });
                    if let (true, Some(b)) = (rule.counts(), base) {
                        c["base_value"] = b.value.clone();
                    }
                    c
                })
                .collect();
            json!({ "changes": list })
        };
        if changes.is_empty() {
            return Ok(Outcome::default());
        }
        let answer: Answer = match client.post("/api/sync", &body).and_then(|v| serde_json::from_value(v).map_err(|e| Error::Local(format!("sync: {e}")))) {
            Ok(a) => a,
            Err(e) => {
                // The config is compared again next time; storage keeps its marks.
                lock(&self.timing).config |= config;
                return Err(e);
            }
        };
        let flat_after = if flat.is_some() { flatten_file(places.config).ok() } else { None };
        let mut out = Outcome { sent: changes.len(), ..Outcome::default() };
        let mut config_in = Vec::new();
        let mut st = lock(&self.state);
        for r in answer.values {
            let Some((_, _, ext, sent, _)) = changes.iter().find(|c| c.0 == r.space && c.1 == r.key) else { continue };
            let current = match ext {
                Some(ext) => places.storage.get(ext, &r.key).unwrap_or(Value::Null),
                None => flat_after.as_ref().and_then(|f| f.get(&r.key)).cloned().unwrap_or(Value::Null),
            };
            let bases = st.bases.entry(r.space.clone()).or_default();
            if current != *sent {
                // Written again while this was out: the next push merges it
                // against what the server holds now, counting from what was sent.
                let old = bases.get(&r.key).map_or(0, |b| b.rev);
                bases.insert(r.key.clone(), Base { rev: old, value: sent.clone() });
                continue;
            }
            bases.insert(r.key.clone(), Base { rev: r.rev, value: r.value.clone() });
            if let Some(ext) = ext {
                st.clean(ext, &r.key);
                if r.value != *sent {
                    self.put(places.storage, ext, &r.key, &r.value, &mut out);
                }
            } else if r.value != *sent {
                config_in.push((r.key.clone(), r.value.clone()));
            }
        }
        st.synced = Some(now / 1000);
        self.save(&st);
        drop(st);
        self.write_config(places.config, config_in, &mut out);
        Ok(out)
    }

    fn put(&self, storage: &Storage, ext: &str, key: &str, value: &Value, out: &mut Outcome) {
        match storage.put(ext, key, value.clone()) {
            Ok(true) => out.storage.push(Changed { extension: ext.into(), key: key.into(), value: value.clone() }),
            Ok(false) => {}
            Err(e) => eprintln!("sync\tnot stored\t{ext}/{key}\t{e}"),
        }
    }

    fn write_config(&self, file: &ConfigFile, values: Vec<(String, Value)>, out: &mut Outcome) {
        if values.is_empty() {
            return;
        }
        let failed = crate::config::sync::apply(file, &values);
        for (k, e) in &failed {
            eprintln!("sync\tconfig key not written\t{k}\t{e}");
        }
        out.config += values.len() - failed.len();
        out.failed.extend(failed);
    }

    /// Everything after the last revision seen.
    pub fn pull(&self, client: &Client, places: &Places, now: u64) -> Result<Outcome> {
        let _busy = lock(&self.busy);
        let since = lock(&self.state).rev;
        let answer: Answer = client.get(&format!("/api/sync?since={since}")).and_then(|v| serde_json::from_value(v).map_err(|e| Error::Local(format!("sync: {e}"))))?;
        let out = self.take_in(places, answer, false)?;
        lock(&self.timing).pulled = Some(now);
        let mut st = lock(&self.state);
        st.synced = Some(now / 1000);
        self.save(&st);
        Ok(out)
    }

    /// Values from the server written here and taken as the bases. A key
    /// changed here since it last synced is left for its push to merge,
    /// unless `force` (a restore the user asked for).
    fn take_in(&self, places: &Places, answer: Answer, force: bool) -> Result<Outcome> {
        let local = self.local();
        let flat = flatten_file(places.config).map_err(|e| Error::Local(format!("the config file: {e}")))?;
        let mut out = Outcome::default();
        let mut config_in = Vec::new();
        let mut st = lock(&self.state);
        for r in answer.values {
            if r.space == CONFIG {
                if local.is_local(&r.key) {
                    continue;
                }
                let here = flat.get(&r.key).unwrap_or(&Value::Null);
                if !force && here != st.base(CONFIG, &r.key).map_or(&Value::Null, |b| &b.value) {
                    continue;
                }
                if *here != r.value {
                    config_in.push((r.key.clone(), r.value.clone()));
                }
            } else if let Some(ext) = r.space.strip_prefix("ext:") {
                if matches!(self.rule(ext, &r.key), Some(Rule::Local)) || (!force && st.is_dirty(ext, &r.key)) {
                    continue;
                }
                st.clean(ext, &r.key);
                self.put(places.storage, ext, &r.key, &r.value, &mut out);
            } else {
                continue;
            }
            st.bases.entry(r.space.clone()).or_default().insert(r.key.clone(), Base { rev: r.rev, value: r.value });
        }
        st.rev = st.rev.max(answer.rev);
        self.save(&st);
        drop(st);
        self.write_config(places.config, config_in, &mut out);
        Ok(out)
    }

    /// `GET /api/sync/history` for a space, or one key of it.
    pub fn history(&self, client: &Client, space: &str, key: Option<&str>) -> Result<Value> {
        let mut path = format!("/api/sync/history?space={}", url_encode(space));
        if let Some(k) = key {
            path.push_str(&format!("&key={}", url_encode(k)));
        }
        client.get(&path)
    }

    /// `POST /api/sync/restore`: one key to a revision, or the whole space
    /// to a time; what comes back is written here whatever was pending.
    pub fn restore(&self, client: &Client, places: &Places, space: &str, key: Option<&str>, rev: Option<u64>, at: Option<u64>) -> Result<Outcome> {
        let body = match (key, rev, at) {
            (Some(k), Some(r), _) => json!({ "space": space, "key": k, "rev": r }),
            (None, _, Some(at)) => json!({ "space": space, "at": at }),
            _ => return Err(Error::Local("restore: a key and a revision, or a time".into())),
        };
        let answer: Answer = client.post("/api/sync/restore", &body).and_then(|v| serde_json::from_value(v).map_err(|e| Error::Local(format!("sync: {e}"))))?;
        let _busy = lock(&self.busy);
        self.take_in(places, answer, true)
    }
}

/// Percent-encodes a query value.
fn url_encode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{Request, Server};
    use std::sync::Arc;

    /// A server that keeps values and revisions and merges like the real
    /// one for the rules the tests use (max, sum, union, latest).
    #[derive(Default)]
    struct Fake {
        rev: u64,
        values: BTreeMap<(String, String), (Value, u64)>,
    }

    fn merge(rule: &Value, mine: &Value, theirs: &Value, base_value: &Value) -> Value {
        match rule.as_str() {
            Some("max") => json!(mine.as_f64().unwrap_or(0.0).max(theirs.as_f64().unwrap_or(0.0))),
            Some("sum") => json!(theirs.as_f64().unwrap_or(0.0) + mine.as_f64().unwrap_or(0.0) - base_value.as_f64().unwrap_or(0.0)),
            Some("union") => {
                let mut out = theirs.as_array().cloned().unwrap_or_default();
                for v in mine.as_array().into_iter().flatten() {
                    if !out.contains(v) {
                        out.push(v.clone());
                    }
                }
                json!(out)
            }
            _ => mine.clone(),
        }
    }

    fn serve(server: &Server) -> Arc<Mutex<Fake>> {
        let fake = Arc::new(Mutex::new(Fake::default()));
        let f = fake.clone();
        server.handle(move |r: &Request| {
            let mut f = f.lock().unwrap();
            let row = |(s, k): &(String, String), (v, rev): &(Value, u64)| json!({ "space": s, "key": k, "value": v, "rev": rev, "at": 0, "device": "x" });
            if r.method == "GET" && r.path.starts_with("/api/sync?since=") {
                let since: u64 = r.path.rsplit('=').next().unwrap().parse().unwrap();
                let values: Vec<Value> = f.values.iter().filter(|(_, (_, rev))| *rev > since).map(|(k, v)| row(k, v)).collect();
                return Some((200, serde_json::to_vec(&json!({ "rev": f.rev, "values": values })).unwrap()));
            }
            if r.method == "POST" && r.path == "/api/sync" {
                let body: Value = serde_json::from_slice(&r.body).unwrap();
                let mut values = Vec::new();
                for c in body["changes"].as_array().unwrap() {
                    let k = (c["space"].as_str().unwrap().to_string(), c["key"].as_str().unwrap().to_string());
                    let stored = match f.values.get(&k) {
                        Some((theirs, rev)) if *rev != c["base"].as_u64().unwrap() => merge(&c["rule"], &c["value"], theirs, &c["base_value"]),
                        _ => c["value"].clone(),
                    };
                    f.rev += 1;
                    let rev = f.rev;
                    f.values.insert(k.clone(), (stored, rev));
                    values.push(row(&k, &f.values[&k]));
                }
                return Some((200, serde_json::to_vec(&json!({ "rev": f.rev, "values": values })).unwrap()));
            }
            None
        });
        fake
    }

    struct Machine {
        _dir: tempfile::TempDir,
        storage: Storage,
        config: ConfigFile,
        sync: Sync,
    }

    fn machine(config: &str) -> Machine {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::open_in(dir.path().join("storage"));
        let config_file = ConfigFile::new(dir.path().join("config.toml"));
        std::fs::write(config_file.path(), config).unwrap();
        let sync = Sync::open_in(dir.path());
        let decl = Decl::from_manifest(&json!({ "sync": { "best": "max", "plays": "sum", "unlocks": "union", "hand": "local" } })).unwrap();
        sync.declare("game", decl);
        Machine { _dir: dir, storage, config: config_file, sync }
    }

    impl Machine {
        fn places(&self) -> Places<'_> {
            Places { storage: &self.storage, config: &self.config }
        }

        fn set(&self, key: &str, v: Value, now: u64) {
            self.storage.set("game", key, v).unwrap();
            self.sync.mark("game", key, now);
        }

        fn get(&self, key: &str) -> Value {
            self.storage.get("game", key).unwrap()
        }
    }

    fn sent(server: &Server) -> Vec<Value> {
        server.requests_to("/api/sync").iter().flat_map(|r| serde_json::from_slice::<Value>(&r.body).unwrap()["changes"].as_array().unwrap().clone()).collect()
    }

    #[test]
    fn rules_parse_and_go_out_in_the_servers_spelling() {
        let d = Decl::from_manifest(&json!({ "sync": { "best": "max", "stats": { "fields": { "wins": "sum", "streak": "latest" } }, "hand": "local" } })).unwrap().unwrap();
        assert_eq!(d.rule("best"), &Rule::Max);
        assert_eq!(d.rule("other"), &Rule::Latest, "an unlisted key is latest");
        assert_eq!(d.rule("stats").wire(), json!({ "fields": { "wins": "sum", "streak": "latest" } }));
        assert!(d.rule("stats").counts());
        assert_eq!(Decl::from_manifest(&json!({})).unwrap(), None);
        for bad in [json!("max"), json!({ "a": "most" }), json!({ "a": { "fields": { "b": "local" } } }), json!({ "a": { "fields": 1 } }), json!({ "a": 3 })] {
            assert!(Decl::from_manifest(&json!({ "sync": bad })).is_err(), "{bad}");
        }
    }

    #[test]
    fn marks_only_opted_in_keys_and_pushes_after_the_debounce() {
        let m = machine("");
        m.sync.set_on(true);
        m.sync.declare("other", None);
        m.storage.set("other", "k", json!(1)).unwrap();
        m.sync.mark("other", "k", 0);
        m.sync.mark("game", "hand", 0);
        assert!(lock(&m.sync.state).dirty.is_empty(), "not opted in, and a local key: no marks");
        // The config is compared once at the first push; nothing in it, so a pull is due.
        let server = Server::start();
        serve(&server);
        let client = Client::new(&server.base, Some("t".into()));
        assert_eq!(m.sync.due(0), Some(Due::Push));
        m.sync.run(Due::Push, &client, &m.places(), 0).unwrap();
        assert!(sent(&server).is_empty(), "nothing to send, no request");
        assert_eq!(m.sync.due(1), None);
        m.set("best", json!(10), 10_000);
        m.set("best", json!(12), 11_000);
        assert_eq!(m.sync.due(13_999), None, "the debounce runs from the last change");
        assert_eq!(m.sync.due(14_000), Some(Due::Push));
        let out = m.sync.run(Due::Push, &client, &m.places(), 14_000).unwrap();
        assert_eq!(out.sent, 1);
        assert_eq!(sent(&server), [json!({ "space": "ext:game", "key": "best", "value": 12, "base": 0, "rule": "max" })]);
        assert_eq!(m.sync.due(14_001), None, "clean, pulled");
        assert_eq!(m.sync.due(14_000 + PULL_EVERY_MS), Some(Due::Pull));
        assert!(!m.sync.shown(14_000 + SHOW_GAP_MS - 1));
        assert!(m.sync.shown(14_000 + SHOW_GAP_MS));
        // Signed out, nothing is marked.
        m.sync.reset();
        m.set("best", json!(20), 20_000);
        assert!(lock(&m.sync.state).dirty.is_empty());
    }

    #[test]
    fn first_sign_in_merges_both_sides_from_base_zero() {
        let server = Server::start();
        serve(&server);
        let client = Client::new(&server.base, Some("t".into()));
        // Machine A has been syncing.
        let a = machine("[general]\ntheme = \"dark\"\n");
        a.sync.first(&a.storage);
        a.set("best", json!(50), 0);
        a.set("plays", json!(7), 0);
        a.set("unlocks", json!(["a", "b"]), 0);
        a.sync.run(Due::Push, &client, &a.places(), 5_000).unwrap();
        // Machine B played offline before ever signing in.
        let b = machine("[general]\ncompact = true\nhotkey = \"alt+space\"\n");
        b.storage.set("game", "best", json!(30)).unwrap();
        b.storage.set("game", "plays", json!(3)).unwrap();
        b.storage.set("game", "unlocks", json!(["c", "a"])).unwrap();
        b.storage.set("game", "hand", json!(["4h"])).unwrap();
        b.sync.first(&b.storage);
        let before = sent(&server).len();
        let out = b.sync.run(Due::Push, &client, &b.places(), 10_000).unwrap();
        let mine: Vec<Value> = sent(&server)[before..].to_vec();
        assert!(mine.iter().all(|c| c["base"] == 0), "{mine:?}");
        assert!(mine.iter().all(|c| c["key"] != "hand"), "a local key never leaves");
        assert!(mine.iter().all(|c| c["key"] != "general.hotkey"), "nor a machine-local config key");
        assert!(mine.iter().any(|c| c["key"] == "general.compact" && c["space"] == "config"));
        assert_eq!(b.get("best"), json!(50.0), "max");
        assert_eq!(b.get("plays"), json!(10.0), "sum: both sides' plays");
        assert_eq!(b.get("unlocks"), json!(["a", "b", "c"]));
        assert_eq!(b.get("hand"), json!(["4h"]), "untouched");
        assert_eq!(out.storage.iter().map(|c| c.key.as_str()).collect::<BTreeSet<_>>(), ["best", "plays", "unlocks"].into(), "each a storage/changed");
        let text = std::fs::read_to_string(b.config.path()).unwrap();
        assert!(text.contains("theme = \"dark\"") && text.contains("compact = true") && text.contains("hotkey = \"alt+space\""), "{text}");
        // A pulls B's side; its hotkey stays its own.
        let out = a.sync.run(Due::Pull, &client, &a.places(), 20_000).unwrap();
        assert_eq!(a.get("plays"), json!(10.0));
        assert_eq!(out.config, 1);
        let text = std::fs::read_to_string(a.config.path()).unwrap();
        assert!(text.contains("compact = true") && !text.contains("hotkey"), "{text}");
    }

    #[test]
    fn a_counter_sends_what_it_last_synced() {
        let server = Server::start();
        serve(&server);
        let client = Client::new(&server.base, Some("t".into()));
        let a = machine("");
        let b = machine("");
        a.sync.first(&a.storage);
        b.sync.first(&b.storage);
        a.set("plays", json!(1), 0);
        a.sync.run(Due::Push, &client, &a.places(), 5_000).unwrap();
        b.sync.run(Due::Pull, &client, &b.places(), 5_000).unwrap();
        assert_eq!(b.get("plays"), json!(1));
        // Both play two more before syncing again.
        a.set("plays", json!(3), 6_000);
        b.set("plays", json!(3), 6_000);
        a.sync.run(Due::Push, &client, &a.places(), 10_000).unwrap();
        b.sync.run(Due::Push, &client, &b.places(), 10_000).unwrap();
        let last = sent(&server).last().cloned().unwrap();
        assert_eq!(last["base_value"], json!(1), "{last}");
        assert_eq!(b.get("plays"), json!(5.0), "1 + 2 + 2");
        a.sync.run(Due::Pull, &client, &a.places(), 20_000).unwrap();
        assert_eq!(a.get("plays"), json!(5.0));
    }

    #[test]
    fn a_pull_leaves_dirty_keys_for_their_push() {
        let server = Server::start();
        let fake = serve(&server);
        let client = Client::new(&server.base, Some("t".into()));
        let m = machine("[general]\ntheme = \"light\"\n");
        m.sync.first(&m.storage);
        m.sync.run(Due::Push, &client, &m.places(), 0).unwrap();
        {
            let mut f = fake.lock().unwrap();
            f.rev += 1;
            let rev = f.rev;
            f.values.insert(("ext:game".into(), "best".into()), (json!(90), rev));
            f.rev += 1;
            let rev = f.rev;
            f.values.insert(("config".into(), "general.theme".into()), (json!("dark"), rev));
        }
        m.set("best", json!(40), 1_000);
        std::fs::write(m.config.path(), "[general]\ntheme = \"system\"\n").unwrap();
        m.sync.config_changed(1_000);
        let out = m.sync.pull(&client, &m.places(), 2_000).unwrap();
        assert_eq!(out, Outcome::default(), "both changed here: left alone");
        assert_eq!(m.get("best"), json!(40));
        m.sync.run(Due::Push, &client, &m.places(), 5_000).unwrap();
        assert_eq!(m.get("best"), json!(90.0), "merged by max");
        assert!(std::fs::read_to_string(m.config.path()).unwrap().contains("\"system\""), "latest: this write");
    }

    #[test]
    fn offline_waits_a_minute_and_keeps_what_was_pending() {
        let m = machine("[general]\ntheme = \"dark\"\n");
        m.sync.first(&m.storage);
        m.set("best", json!(5), 0);
        let off = Client::new("http://127.0.0.1:1", Some("t".into()));
        assert!(m.sync.run(Due::Push, &off, &m.places(), 10_000).is_err());
        assert_eq!(m.sync.due(10_001), None, "nothing tried for a minute");
        assert_eq!(m.sync.due(10_000 + RETRY_MS), Some(Due::Push), "the mark and the config are still pending");
        let server = Server::start();
        serve(&server);
        let client = Client::new(&server.base, Some("t".into()));
        m.sync.run(Due::Push, &client, &m.places(), 10_000 + RETRY_MS).unwrap();
        let keys: BTreeSet<String> = sent(&server).iter().map(|c| c["key"].as_str().unwrap().to_string()).collect();
        assert_eq!(keys, ["best".to_string(), "general.theme".to_string()].into());
    }

    #[test]
    fn restore_writes_what_comes_back() {
        let server = Server::start();
        serve(&server);
        server.ok("/api/sync/restore", r#"{"rev":9,"values":[{"space":"config","key":"general.theme","value":"dark","rev":9,"at":0,"device":"x"},{"space":"ext:game","key":"best","value":3,"rev":9,"at":0,"device":"x"}]}"#);
        server.ok("/api/sync/history?space=ext%3Agame&key=best", r#"{"revs":[]}"#);
        let client = Client::new(&server.base, Some("t".into()));
        let m = machine("[general]\ntheme = \"light\"\n");
        m.sync.first(&m.storage);
        m.set("best", json!(8), 0);
        let out = m.sync.restore(&client, &m.places(), "config", None, None, Some(1_790_000_000)).unwrap();
        assert_eq!(out.config, 1);
        assert_eq!(m.get("best"), json!(3), "a restore wins over a pending change");
        assert!(lock(&m.sync.state).dirty.is_empty());
        assert_eq!(m.sync.history(&client, "ext:game", Some("best")).unwrap(), json!({ "revs": [] }));
    }
}
