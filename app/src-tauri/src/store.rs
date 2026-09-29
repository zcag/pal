//! The extension store in the running app (docs/design/distribution.md,
//! "Installing, updating, removing (app side)"): one `pal_core::manage::Manager`
//! behind every UI (Settings, the Store palette and Games through the
//! bridge, root search, links), its state for the pages (`StoreState` on
//! [`events::STORE`]), and the background work of a running app.
//!
//! An operation takes its name's lock (two on one name queue, others run
//! side by side; the core's store lock keeps the CLI out meanwhile), runs
//! off the runtime, then asks the host to `reload` that one name and
//! answers with what the load said. No host restart: the host coalesces
//! its watcher's own reload of the same swap. An update that does not load
//! where the old build did is rolled back (`Manager::rollback`, which marks
//! the build bad here) and loaded again.
//!
//! In the background, from the first `host/ready`: the migration steps of
//! the last full-bundle release (`start`), then every registry fetched 30 s
//! in and every 6 hours (and when the Store or Settings › Extensions opens,
//! at most every 5 minutes), each time followed by the reconcile of
//! `[store] installed` and the updates that apply by themselves, deferred
//! while the extension has a view up (`views::shown`). Usage counts go out
//! a minute in, every 6 hours, and at quit.
//!
//! Also here: the root search's uninstalled extensions (`pal/available`,
//! [`source`]) and what a link or a push into a missing extension shows
//! ([`Missing`]).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use pal_core::config::instance::name_of;
use pal_core::config::secrets::{platform_store, SecretRef};
use pal_core::config::{Config, Plan};
use pal_core::extensions::refs::{self, LeftOver};
use pal_core::extensions::{Error, Kind, Spec};
use pal_core::index::{Item, Source};
use pal_core::manage::{Available, Manager};
use pal_core::registry::{self, Channel, ListingPalette, RegistryStatus, PAL};
use pal_core::updates::{Origin, State, Status};
use pal_core::usage::{ErrorKind, Event, EventKind, From, Usage};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager as _};
use tokio::sync::Mutex as AsyncMutex;

use crate::host::{Host, Reloaded};
use crate::{events, hud, lock, settings};

/// From the first `host/ready` to the first fetch of the registries: the
/// panel has painted and the listings are in by then.
const FIRST_REFRESH: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const FIRST_FLUSH: Duration = Duration::from_secs(60);
/// An open of the Store or Settings › Extensions fetches again only when
/// the last fetch is older than this.
pub const ON_OPEN: Duration = Duration::from_secs(5 * 60);
/// An explicit refresh (`store_refresh`) this soon after another answers
/// from that one: a page asking twice as it opens.
pub const COALESCE: Duration = Duration::from_secs(10);
/// A change (a load, a config write) settles this long before the state is
/// computed again: one computation for a burst.
const SETTLE: Duration = Duration::from_millis(250);
/// How long a quit waits for the usage flush.
const QUIT_FLUSH: Duration = Duration::from_secs(2);
/// Markers in pal's data directory: the legacy store conversion ran, and
/// the app version of the last run (a change is an app update).
const LEGACY_DONE: &str = "store-legacy-converted";
const LAST_VERSION: &str = "last-version";

// ---- the state -------------------------------------------------------------

/// A registry as the pages show it (`RegistryStatus` and whether it is ours).
#[derive(Debug, Clone, Serialize)]
pub struct RegistryView {
    #[serde(flatten)]
    pub status: RegistryStatus,
    pub ours: bool,
}

/// Listed in `[store] installed` and not installed yet; `error` is why the
/// last try failed, `since` (unix seconds) when it was first seen missing.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Pending {
    pub name: String,
    pub registry: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub since: u64,
}

/// An update that did not load and was rolled back, this run.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RolledBack {
    pub name: String,
    pub hash: String,
    pub error: String,
    pub at: u64,
}

/// Everything the Store palette and Settings › Extensions draw.
#[derive(Debug, Clone, Default, Serialize)]
pub struct StoreState {
    pub auto_update: bool,
    pub usage: bool,
    pub registries: Vec<RegistryView>,
    /// Every installed, bundled and local extension (`updates::check`).
    pub statuses: Vec<Status>,
    /// Every listed extension across the registries, installed or not.
    pub available: Vec<Available>,
    pub pending: Vec<Pending>,
    pub rolled_back: Vec<RolledBack>,
    /// Store directories `[store] installed` does not list ("not in config").
    pub unlisted: Vec<String>,
    pub disabled: Vec<String>,
    pub leftovers: Vec<LeftOver>,
    /// Names with an operation in flight.
    pub busy: Vec<String>,
}

/// What one operation did: `ok` for the store change, `loaded` for what the
/// host said after (absent when the host did not answer), `error` for
/// either's failure (a store change that went through but did not load has
/// `ok` and the load's error).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct OpResult {
    pub name: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loaded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl OpResult {
    fn fail(name: &str, error: impl Into<String>) -> Self {
        Self { name: name.into(), ok: false, loaded: None, error: Some(error.into()) }
    }

    /// A store change that went through, with what the host's `reload` said.
    fn after(name: &str, reload: &Result<Reloaded, String>) -> Self {
        match reload {
            Ok(r) => Self { name: name.into(), ok: true, loaded: Some(r.loaded), error: r.error.clone().filter(|_| !r.loaded && !r.disabled) },
            Err(e) => Self { name: name.into(), ok: true, loaded: None, error: Some(e.clone()) },
        }
    }
}

/// A registry seen before it is added (`registry::Preview`).
#[derive(Debug, Clone, Serialize)]
pub struct PreviewView {
    pub name: String,
    pub url: String,
    pub count: usize,
    pub key: String,
    pub key_id: String,
}

pub struct Service {
    /// Rebuilt when `[store]` or `extension_dirs` change (`apply_config`).
    manager: Mutex<Arc<Manager>>,
    state: Mutex<Option<StoreState>>,
    busy: Mutex<BTreeSet<String>>,
    names: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    /// Held while the registries are fetched; when the last fetch ended.
    fetched: AsyncMutex<Option<Instant>>,
    /// Per pending name: the last error, since when.
    pending: Mutex<BTreeMap<String, (Option<String>, u64)>>,
    rolled_back: Mutex<Vec<RolledBack>>,
    /// Updates that apply by themselves, waiting for the extension's view to close.
    deferred: Mutex<BTreeSet<String>>,
    /// Names the migration listed this run: their installs count as `migration`.
    migrated: Mutex<BTreeSet<String>>,
    started: AtomicBool,
    generation: AtomicU64,
}

/// Needs the settings (the config file) installed.
pub fn setup(app: &AppHandle) {
    let usage = settings::config(app).general.usage;
    app.manage(Service {
        manager: Mutex::new(Arc::new(crate::host::manager(app))),
        state: Mutex::new(None),
        busy: Mutex::new(BTreeSet::new()),
        names: Mutex::new(HashMap::new()),
        fetched: AsyncMutex::new(None),
        pending: Mutex::new(BTreeMap::new()),
        rolled_back: Mutex::new(Vec::new()),
        deferred: Mutex::new(BTreeSet::new()),
        migrated: Mutex::new(BTreeSet::new()),
        started: AtomicBool::new(false),
        generation: AtomicU64::new(0),
    });
    set_usage(usage);
}

fn svc(app: &AppHandle) -> tauri::State<'_, Service> {
    app.state::<Service>()
}

fn manager(app: &AppHandle) -> Arc<Manager> {
    lock(&svc(app).manager).clone()
}

fn text(e: Error) -> String {
    e.to_string()
}

/// `f` with the manager, off the runtime.
async fn blocking<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&Manager) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let m = manager(app);
    tauri::async_runtime::spawn_blocking(move || f(&m)).await.map_err(|e| e.to_string())?
}

fn set_usage(on: bool) {
    if let Err(e) = Usage::locate().set_enabled(on) {
        eprintln!("usage\tswitch failed\t{e}");
    }
}

/// The state as last computed, with the operations in flight now; computed
/// here when it never was.
pub async fn state(app: &AppHandle) -> StoreState {
    let cached = lock(&svc(app).state).clone();
    let mut st = match cached {
        Some(st) => st,
        None => compute(app).await,
    };
    st.busy = lock(&svc(app).busy).iter().cloned().collect();
    st
}

/// Everything the state is made of, read afresh; kept and sent to the pages.
async fn compute(app: &AppHandle) -> StoreState {
    let config = settings::config(app);
    let registered: BTreeSet<String> = settings::extensions(app).into_iter().map(|e| e.name).collect();
    let store = config.store.clone();
    let parts = blocking(app, move |m| {
        let copies = m.store.list().unwrap_or_default();
        let plan = pal_core::config::reconcile(&store, &copies, &m.roots());
        Ok((m.check(), m.available(), m.registries.status(), plan, copies.into_iter().map(|c| c.name).collect::<BTreeSet<String>>(), m.roots()))
    })
    .await;
    let (statuses, available, registries, plan, copies, roots) = match parts {
        Ok(p) => p,
        Err(e) => {
            eprintln!("store\tstate failed\t{e}");
            return StoreState::default();
        }
    };
    let pending = {
        let s = svc(app);
        let mut map = lock(&s.pending);
        pending_of(&plan, &mut map, registry::now())
    };
    // What is there, one way or another: a reference to anything else is left over.
    let mut present: BTreeSet<String> = registered.into_iter().chain(copies).chain(roots.bundled).chain(roots.local).chain(config.store.disabled.iter().cloned()).collect();
    present.extend(config.store.installed().into_iter().map(|(_, n)| n));
    present.insert("pal".into());
    let known: BTreeSet<String> = present.iter().cloned().chain(available.iter().map(|a| a.name.clone())).collect();
    let st = StoreState {
        auto_update: config.store.auto_update,
        usage: config.general.usage,
        registries: registries.into_iter().map(|status| RegistryView { ours: status.name == PAL, status }).collect(),
        statuses,
        available,
        pending,
        rolled_back: lock(&svc(app).rolled_back).clone(),
        unlisted: plan.unlisted,
        disabled: config.store.disabled.clone(),
        leftovers: refs::leftovers(&config, &present, &known),
        busy: lock(&svc(app).busy).iter().cloned().collect(),
    };
    *lock(&svc(app).state) = Some(st.clone());
    sync_rows(app, &st.available);
    events::emit(app, events::STORE, &st);
    st
}

/// The pending list of `plan`, each keeping the error and time it has in
/// `seen` (names no longer pending leave it; new ones start now).
fn pending_of(plan: &Plan, seen: &mut BTreeMap<String, (Option<String>, u64)>, now: u64) -> Vec<Pending> {
    seen.retain(|n, _| plan.install.iter().any(|(_, p)| p == n));
    plan.install
        .iter()
        .map(|(registry, name)| {
            let (error, since) = seen.entry(name.clone()).or_insert((None, now)).clone();
            Pending { name: name.clone(), registry: registry.clone(), error, since }
        })
        .collect()
}

/// [`compute`] once a burst of changes has settled.
fn settle(app: &AppHandle) {
    let Some(s) = app.try_state::<Service>() else { return };
    let generation = s.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        if svc(&app).generation.load(Ordering::SeqCst) == generation {
            compute(&app).await;
        }
    });
}

/// `name` has an operation in flight while this lives.
struct Busy {
    app: AppHandle,
    name: String,
}

fn busy(app: &AppHandle, name: &str) -> Busy {
    lock(&svc(app).busy).insert(name.to_string());
    settle(app);
    Busy { app: app.clone(), name: name.to_string() }
}

impl Drop for Busy {
    fn drop(&mut self) {
        lock(&svc(&self.app).busy).remove(&self.name);
        settle(&self.app);
    }
}

/// The name's own lock: operations on one name queue.
async fn hold(app: &AppHandle, name: &str) -> tokio::sync::OwnedMutexGuard<()> {
    let m = lock(&svc(app).names).entry(name.to_string()).or_default().clone();
    m.lock_owned().await
}

fn is_busy(app: &AppHandle, name: &str) -> bool {
    lock(&svc(app).busy).contains(name)
}

// ---- operations ------------------------------------------------------------

/// The host's `reload` of `name`, with its answer.
async fn reload(app: &AppHandle, name: &str) -> Result<Reloaded, String> {
    let host = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()).ok_or(crate::host::HOST_DOWN)?;
    let r = host.reload(name).await;
    match &r {
        Ok(r) => eprintln!("store\treload\t{name}\tloaded={} disabled={}{}", r.loaded, r.disabled, r.error.as_deref().map(|e| format!("\t{e}")).unwrap_or_default()),
        Err(e) => eprintln!("store\treload\t{name}\tfailed\t{e}"),
    }
    r
}

/// A load that failed (not one that was turned off).
fn failed_load(r: &Result<Reloaded, String>) -> Option<String> {
    r.as_ref().ok().filter(|r| !r.loaded && !r.disabled).and_then(|r| r.error.clone())
}

/// Whether the host has `name` loaded (a `multi` one: any instance).
fn loaded_now(app: &AppHandle, name: &str) -> bool {
    settings::extensions(app).iter().any(|e| e.name == name && e.loaded)
}

/// Whether some root has `name`: the host knows it, or the store, the
/// bundled or a local root has it.
async fn present(app: &AppHandle, name: &str) -> bool {
    if settings::extensions(app).iter().any(|e| e.name == name) {
        return true;
    }
    let n = name.to_string();
    blocking(app, move |m| Ok(m.store.get(&n).is_ok() || m.inputs.bundled.contains_key(&n) || m.inputs.local.contains(&n))).await.unwrap_or(false)
}

/// Installs `name` from `registry` (the first that lists it when `None`),
/// its `requires` first, and waits for the host to load it.
pub async fn install(app: &AppHandle, name: &str, registry: Option<&str>, from: From) -> OpResult {
    install_with(app, name.to_string(), registry.map(str::to_string), from, &mut BTreeSet::new()).await
}

fn install_with<'a>(app: &'a AppHandle, name: String, registry: Option<String>, from: From, seen: &'a mut BTreeSet<String>) -> Pin<Box<dyn Future<Output = OpResult> + Send + 'a>> {
    Box::pin(async move {
        seen.insert(name.clone());
        let (n, r) = (name.clone(), registry.clone());
        let requires = blocking(app, move |m| Ok(m.registries.resolve(&n).into_iter().find(|(s, _)| r.as_deref().is_none_or(|r| s.name == r)).map(|(_, e)| e.listing.requires).unwrap_or_default())).await.unwrap_or_default();
        for req in requires {
            if seen.contains(&req) || present(app, &req).await {
                continue;
            }
            let r = install_with(app, req.clone(), None, from, seen).await;
            if !r.ok {
                return OpResult::fail(&name, format!("needs {req}, which did not install: {}", r.error.unwrap_or_default()));
            }
        }
        let _held = hold(app, &name).await;
        let _busy = busy(app, &name);
        let (n, r) = (name.clone(), registry.clone());
        let done = blocking(app, move |m| {
            let i = m.install(&n, r.as_deref(), from).map_err(text)?;
            Ok(matches!(i.kind(), Kind::Registry { registry: PAL, .. }))
        })
        .await;
        match done {
            Err(e) => {
                eprintln!("store\tinstall\t{name}\tfailed\t{e}");
                if let Some(p) = lock(&svc(app).pending).get_mut(&name) {
                    p.0 = Some(e.clone());
                }
                OpResult::fail(&name, e)
            }
            Ok(ours) => {
                eprintln!("store\tinstalled\t{name}\t{from:?}");
                lock(&svc(app).pending).remove(&name);
                let r = reload(app, &name).await;
                if ours && failed_load(&r).is_some() {
                    manager(app).usage.record(Event::now(EventKind::Fail, &name, from).error(ErrorKind::Load));
                }
                OpResult::after(&name, &r)
            }
        }
    })
}

/// What an install field takes: a bare name from the registries, anything
/// else a source (a directory, `github:user/repo[/sub][@ref]`, a GitHub URL).
pub async fn install_spec(app: &AppHandle, spec: &str, from: From) -> OpResult {
    let spec = spec.trim();
    if Spec::is_bare_name(spec) { install(app, spec, None, from).await } else { install_source(app, spec).await }
}

/// A source install (`pal install --from`'s spellings), then its load.
pub async fn install_source(app: &AppHandle, spec: &str) -> OpResult {
    let (bun, s) = (crate::host::bun(), spec.to_string());
    match blocking(app, move |m| m.install_source(&s, Some(&bun)).map_err(text)).await {
        Ok(i) => {
            eprintln!("store\tinstalled\t{} from {spec}", i.name);
            let r = reload(app, &i.name).await;
            settle(app);
            OpResult::after(&i.name, &r)
        }
        Err(e) => OpResult::fail(spec, e),
    }
}

/// Updates `names` (every one with an update when empty; the indexes
/// fetched first unless that just happened), each as the one check says: its registry's newer build, a yanked build's replacement, or
/// a source install's source fetched again.
pub async fn update(app: &AppHandle, names: Vec<String>, from: From) -> Vec<OpResult> {
    // Asked for: against indexes no older than a moment ago.
    fetch(app, COALESCE).await;
    let statuses = blocking(app, |m| Ok(m.check())).await.unwrap_or_default();
    let todo: Vec<Result<Status, OpResult>> = if names.is_empty() {
        statuses.into_iter().filter(|s| s.target().is_some()).map(Ok).collect()
    } else {
        names.iter().map(|n| statuses.iter().find(|s| &s.name == n).cloned().ok_or_else(|| OpResult::fail(n, format!("{n} is not installed")))).collect()
    };
    let mut out = Vec::new();
    for t in todo {
        out.push(match t {
            Ok(s) => update_status(app, s, from).await,
            Err(r) => r,
        });
    }
    out
}

async fn update_status(app: &AppHandle, s: Status, from: From) -> OpResult {
    let name = s.name.clone();
    let _held = hold(app, &name).await;
    let _busy = busy(app, &name);
    let was_loaded = loaded_now(app, &name);
    let (bun, st) = (crate::host::bun(), s.clone());
    let done = blocking(app, move |m| match st.state {
        State::Source => m.store.update_source(&st.name, Some(&bun)).map(Some).map_err(text),
        _ => m.apply(&st, from).transpose().map_err(text),
    })
    .await;
    let installed = match done {
        Err(e) => return OpResult::fail(&name, e),
        Ok(None) => return OpResult::fail(&name, format!("{name}: {}", nothing_to_update(&s.state))),
        Ok(Some(i)) => i,
    };
    let hash = installed.record.as_ref().and_then(|r| r.hash.clone()).unwrap_or_default();
    eprintln!("store\tupdated\t{name}\t{hash}\t{from:?}");
    lock(&svc(app).deferred).remove(&name);
    settings::forget_check(app, &name);
    let r = reload(app, &name).await;
    match failed_load(&r) {
        Some(why) if was_loaded => roll_back(app, &name, s.origin, &hash, &why, from).await,
        _ => OpResult::after(&name, &r),
    }
}

fn nothing_to_update(state: &State) -> &'static str {
    match state {
        State::UpToDate => "up to date",
        State::NeedsNewerPal { .. } => "the update needs a newer pal",
        State::Unchecked => "not checked yet",
        State::NoLongerListed { .. } => "no longer listed",
        State::Local => "a local copy, never updated",
        _ => "no update to apply",
    }
}

/// The new build of `name` did not load where the old one did: back to the
/// previous generation (for a bundled extension, whose update was the only
/// store copy, back to the bundled one), the build marked bad here, loaded
/// again, and noted for Settings.
async fn roll_back(app: &AppHandle, name: &str, origin: Origin, hash: &str, why: &str, from: From) -> OpResult {
    let (n, h) = (name.to_string(), hash.to_string());
    let back = blocking(app, move |m| match m.rollback(&n, from) {
        Ok(_) => Ok(()),
        Err(Error::NoPrevious(_)) if origin == Origin::Bundled => {
            m.store.mark_bad(&n, &h).map_err(text)?;
            m.store.remove(&n).map_err(text)?;
            m.usage.record(Event::now(EventKind::Rollback, &n, from));
            Ok(())
        }
        Err(e) => Err(text(e)),
    })
    .await;
    if let Err(e) = back {
        eprintln!("store\trollback\t{name}\tfailed\t{e}");
        return OpResult { name: name.into(), ok: false, loaded: Some(false), error: Some(format!("the new build did not load ({why}), and going back failed: {e}")) };
    }
    eprintln!("store\trolled back\t{name}\t{hash}\t{why}");
    lock(&svc(app).rolled_back).push(RolledBack { name: name.into(), hash: hash.into(), error: why.into(), at: registry::now() });
    let r = reload(app, name).await;
    OpResult { name: name.into(), ok: false, loaded: r.ok().map(|r| r.loaded), error: Some(format!("the new build did not load ({why}); the previous one is back")) }
}

/// Removes `name` from the store (refused while an installed extension
/// requires it, and for a bundled one, which is turned off instead);
/// `forget` also deletes everything pal keeps for it ([`forget_all`]).
pub async fn remove(app: &AppHandle, name: &str, forget: bool, from: From) -> OpResult {
    let needs: BTreeSet<String> = settings::extensions(app).into_iter().filter(|e| e.name != name && e.manifest["requires"].as_array().is_some_and(|r| r.iter().any(|v| v == name))).map(|e| e.name).collect();
    if !needs.is_empty() {
        let list = needs.into_iter().collect::<Vec<_>>();
        return OpResult::fail(name, format!("{} {} {name}; remove {} first", list.join(", "), if list.len() == 1 { "needs" } else { "need" }, if list.len() == 1 { "it" } else { "them" }));
    }
    let _held = hold(app, name).await;
    let _busy = busy(app, name);
    let n = name.to_string();
    let removed = blocking(app, move |m| match m.remove(&n, from) {
        Ok(()) => Ok(true),
        Err(Error::NotFound(_)) if m.inputs.bundled.contains_key(&n) && !forget => Err(format!("{n} comes with pal; turn it off instead")),
        // Nothing in the store: forgetting what is kept for it is still asked for.
        Err(Error::NotFound(_)) if forget => Ok(false),
        Err(e) => Err(text(e)),
    })
    .await;
    let removed = match removed {
        Ok(r) => r,
        Err(e) => return OpResult::fail(name, e),
    };
    eprintln!("store\tremoved\t{name}\tforget={forget}");
    lock(&svc(app).deferred).remove(name);
    settings::forget_check(app, name);
    // The host drops it, or loads the copy an earlier root still has (the bundled one under an update).
    let r = if removed { reload(app, name).await } else { Ok(Reloaded::default()) };
    if forget {
        if let Err(e) = forget_all(app, name, true).await {
            return OpResult::fail(name, format!("removed, but forgetting its data failed: {e}"));
        }
    }
    OpResult { name: name.into(), ok: true, loaded: r.ok().map(|r| r.loaded), error: None }
}

/// Every name the app knows, for attributing palette ids (`refs`).
fn known(app: &AppHandle) -> BTreeSet<String> {
    let m = manager(app);
    let cached = lock(&svc(app).state).as_ref().map(|s| s.available.iter().map(|a| a.name.clone()).collect::<Vec<_>>()).unwrap_or_default();
    settings::extensions(app).into_iter().map(|e| e.name).chain(m.inputs.bundled.keys().cloned()).chain(m.inputs.local.iter().cloned()).chain(cached).collect()
}

/// Every reference to `name` out of the config (`ConfigFile::forget_extension`)
/// and the keychain secrets its settings held; with `data`, also its
/// storage, index cache and frecency, for it and each of its instances
/// (`settings::forget_data`), as removing an instance does.
async fn forget_all(app: &AppHandle, name: &str, data: bool) -> Result<(), String> {
    let mut keys: Vec<String> = settings::config(app).instances.keys().filter(|k| name_of(k) == name).cloned().collect();
    keys.insert(0, name.to_string());
    keys.dedup();
    let (file, n, known) = (settings::file(app), name.to_string(), known(app));
    let f = tauri::async_runtime::spawn_blocking(move || {
        let f = file.forget_extension(&n, &known).map_err(|e| e.to_string())?;
        let store = platform_store();
        for s in &f.secrets {
            if let Some(SecretRef { store: "keychain", key }) = SecretRef::parse(s) {
                if let Err(e) = store.delete(key) {
                    eprintln!("store\tforget\t{n}\tsecret {key}: {e}");
                }
            }
        }
        Ok::<_, String>(f)
    })
    .await
    .map_err(|e| e.to_string())??;
    eprintln!("store\tforgot\t{name}\t{} keys, {} secrets", f.removed.len(), f.secrets.len());
    settings::reload_now(app);
    if data {
        settings::forget_data(app, &keys).await;
    }
    settle(app);
    Ok(())
}

/// Turns `name` off or on (`[store] disabled`); the host hears it from the
/// config change (`apply_config`).
pub async fn set_disabled(app: &AppHandle, name: &str, disabled: bool, from: From) -> Result<(), String> {
    let n = name.to_string();
    blocking(app, move |m| m.set_disabled(&n, disabled, from).map_err(text)).await?;
    eprintln!("store\t{}\t{name}", if disabled { "disabled" } else { "enabled" });
    settings::reload_now(app);
    Ok(())
}

// ---- the background --------------------------------------------------------

/// A host notification: the state follows the loads; the first `host/ready`
/// starts the background work.
pub fn on_host(app: &AppHandle, method: &str) {
    if app.try_state::<Service>().is_none() {
        return;
    }
    if method == "host/ready" && !svc(app).started.swap(true, Ordering::SeqCst) {
        tauri::async_runtime::spawn(start(app.clone()));
    }
    if method == "host/ready" || method.starts_with("extension/") {
        settle(app);
    }
}

/// The migration steps, then the timers.
async fn start(app: AppHandle) {
    let config = settings::config(&app);
    let version = app.package_info().version.to_string();
    let a = app.clone();
    let listed = blocking(&app, move |m| {
        let frecency = a.state::<Mutex<pal_core::frecency::Frecency>>();
        let listed = prepare(m, &config, &version, &pal_core::fs::data_dir(), &lock(&frecency));
        Ok(listed)
    })
    .await
    .unwrap_or_default();
    lock(&svc(&app).migrated).extend(listed);
    let st = compute(&app).await;
    // Something listed is missing: fetch now rather than in 30 s, so a new machine installs at once.
    let first = if st.pending.is_empty() { FIRST_REFRESH } else { Duration::ZERO };
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(first).await;
        loop {
            refresh(&a, Duration::ZERO).await;
            tokio::time::sleep(EVERY).await;
        }
    });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_FLUSH).await;
        loop {
            flush().await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// The one-time and per-start steps (docs/design/distribution.md
/// "Migration"): store copies installed from our repo's source become
/// registry installs, and one that shadows a bundled extension with the
/// same or an older build goes (once, a marker in the data dir); after an
/// app update the store copies the new bundle catches up with go; and every
/// bundled extension in use is listed in `[store] installed`, so the slim
/// release installs what each user uses. Answers the names it listed.
fn prepare(m: &Manager, config: &Config, version: &str, data: &std::path::Path, frecency: &pal_core::frecency::Frecency) -> Vec<String> {
    let bundled: BTreeSet<String> = m.inputs.bundled.keys().cloned().collect();
    if !data.join(LEGACY_DONE).exists() {
        match pal_core::extensions::migrate::convert_legacy(&m.store, &bundled) {
            Ok(l) => {
                let shadowing = m.inputs.bundled.iter().filter(|(n, _)| l.shadowing.contains(n)).map(|(n, b)| (n.clone(), b.clone())).collect();
                let gone = pal_core::updates::cleanup_after_app_update(&m.store, &shadowing).unwrap_or_default();
                eprintln!("store\tlegacy\tconverted [{}] removed [{}]", l.converted.join(","), gone.join(","));
                let _ = pal_core::fs::write_atomic(&data.join(LEGACY_DONE), "");
            }
            Err(e) => eprintln!("store\tlegacy\tfailed\t{e}"),
        }
    }
    let last = std::fs::read_to_string(data.join(LAST_VERSION)).unwrap_or_default();
    if last.trim() != version {
        match pal_core::updates::cleanup_after_app_update(&m.store, &m.inputs.bundled) {
            Ok(gone) => eprintln!("store\tapp update\t{} -> {version}\tremoved [{}]", if last.is_empty() { "?" } else { last.trim() }, gone.join(",")),
            Err(e) => eprintln!("store\tapp update\tcleanup failed\t{e}"),
        }
        let _ = pal_core::fs::write_atomic(&data.join(LAST_VERSION), version);
    }
    let used = pal_core::extensions::migrate::in_use(config, data, Some(frecency), &bundled);
    let add = to_list(&bundled, &used, &config.store.installed());
    if !add.is_empty() {
        match m.config.store_add_installed_all(PAL, &add) {
            Ok(()) => eprintln!("store\tmigration\tlisted [{}]", add.join(",")),
            Err(e) => eprintln!("store\tmigration\tfailed\t{e}"),
        }
    }
    add
}

/// The migration's list: the bundled extensions in use that `[store]
/// installed` does not name yet. Only bundled names qualify, so a name the
/// user removed (never a bundled one: those cannot be) is never listed again.
fn to_list(bundled: &BTreeSet<String>, used: &BTreeSet<String>, listed: &[(String, String)]) -> Vec<String> {
    bundled.intersection(used).filter(|n| !listed.iter().any(|(_, l)| l == *n)).cloned().collect()
}

/// Fetches every registry (unless the last fetch is younger than
/// `max_age`), then installs what `[store] installed` lists and is missing,
/// applies what updates by itself, and answers the state after.
pub async fn refresh(app: &AppHandle, max_age: Duration) -> StoreState {
    fetch(app, max_age).await;
    reconcile(app).await;
    auto_apply(app).await;
    compute(app).await
}

/// Every registry's index fetched, unless the last fetch is younger than
/// `max_age`; one fetch at a time (a second waits, then finds it fresh).
async fn fetch(app: &AppHandle, max_age: Duration) {
    let s = svc(app);
    let mut last = s.fetched.lock().await;
    if last.is_some_and(|t| t.elapsed() < max_age) {
        return;
    }
    let t0 = Instant::now();
    let out = blocking(app, |m| Ok(m.refresh())).await.unwrap_or_default();
    let failed: Vec<String> = out.iter().filter_map(|(n, r)| r.as_ref().err().map(|e| format!("{n}: {e}"))).collect();
    eprintln!("store\tfetched\t{} registries\t{:.0}ms{}", out.len(), t0.elapsed().as_secs_f64() * 1000.0, if failed.is_empty() { String::new() } else { format!("\t{}", failed.join("; ")) });
    *last = Some(Instant::now());
}

/// A refresh for an open (the Store palette, Settings › Extensions), in the
/// background and at most every [`ON_OPEN`].
pub fn refresh_soon(app: &AppHandle) {
    if app.try_state::<Service>().is_some() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { refresh(&app, ON_OPEN).await });
    }
}

/// Installs what `[store] installed` lists and no root has; a failure
/// stays pending, with its error, until the next refresh tries again.
async fn reconcile(app: &AppHandle) {
    let plan = blocking(app, |m| Ok(pal_core::config::reconcile(&m.config.load().config.store, &m.store.list().unwrap_or_default(), &m.roots()))).await;
    for (registry, name) in plan.map(|p| p.install).unwrap_or_default() {
        if is_busy(app, &name) {
            continue;
        }
        let from = if lock(&svc(app).migrated).contains(&name) { From::Migration } else { From::Reconcile };
        install(app, &name, Some(&registry), from).await;
    }
}

/// Which updates apply now and which wait for a view to close: the ones
/// with something to install whose registry updates by itself, while
/// `[store] auto_update` is on, and nothing in flight for the name.
fn auto_plan(statuses: Vec<Status>, global: bool, busy: impl Fn(&str) -> bool, shown: impl Fn(&str) -> bool) -> (Vec<Status>, Vec<String>) {
    let mut now = Vec::new();
    let mut later = Vec::new();
    for s in statuses.into_iter().filter(|s| global && s.auto_update && s.target().is_some() && !busy(&s.name)) {
        if shown(&s.name) {
            later.push(s.name);
        } else {
            now.push(s);
        }
    }
    (now, later)
}

async fn auto_apply(app: &AppHandle) {
    let global = settings::config(app).store.auto_update;
    let statuses = blocking(app, |m| Ok(m.check())).await.unwrap_or_default();
    let (now, later) = auto_plan(statuses, global, |n| is_busy(app, n), |n| crate::views::shown(app, n));
    if !later.is_empty() {
        eprintln!("store\tupdate deferred\t{}\ta view is open", later.join(","));
        lock(&svc(app).deferred).extend(later);
    }
    for s in now {
        update_status(app, s, From::Auto).await;
    }
}

/// A view of `extension` closed: an update that waited for it applies now,
/// once no view of it is shown.
pub fn on_view_hidden(app: &AppHandle, extension: &str) {
    let name = name_of(extension).to_string();
    if app.try_state::<Service>().is_none() || crate::views::shown(app, &name) || !lock(&svc(app).deferred).remove(&name) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let s = blocking(&app, move |m| Ok(m.check().into_iter().find(|s| s.name == name))).await.ok().flatten();
        if let Some(s) = s.filter(|s| s.target().is_some()) {
            update_status(&app, s, From::Auto).await;
        }
    });
}

/// The config changed: the usage switch, the host's turned-off set, the
/// registries the manager follows, a new `extension_dirs` (roots are the
/// host's argv: it restarts), a listed extension to install; then the state.
pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    if app.try_state::<Service>().is_none() || prev == next {
        return;
    }
    if prev.general.usage != next.general.usage {
        set_usage(next.general.usage);
    }
    let dirs = prev.general.extension_dirs() != next.general.extension_dirs();
    if prev.store != next.store || dirs {
        *lock(&svc(app).manager) = Arc::new(crate::host::manager(app));
    }
    let host = app.try_state::<Arc<Host>>().map(|h| h.inner().clone());
    if let Some(host) = host {
        if prev.store.disabled != next.store.disabled {
            let names = next.store.disabled.clone();
            let host = host.clone();
            tauri::async_runtime::spawn(async move {
                eprintln!("store\tdisabled/changed\t{}", names.join(","));
                if let Err(e) = host.notify("disabled/changed", json!({ "names": names })).await {
                    eprintln!("store\tdisabled/changed failed\t{e}");
                }
            });
        }
        if dirs {
            eprintln!("store\textension_dirs changed\trestarting the host");
            tauri::async_runtime::spawn(async move { host.restart().await });
        }
    }
    if prev.store.installed != next.store.installed && svc(app).started.load(Ordering::SeqCst) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { reconcile(&app).await });
    }
    settle(app);
}

/// Sends the usage queue; nothing while sharing is off.
async fn flush() {
    let r = tauri::async_runtime::spawn_blocking(|| Usage::locate().flush(&pal_core::extensions::Store::locate())).await;
    match r {
        Ok(Ok(n)) if n > 0 => eprintln!("usage\tsent\t{n} events"),
        Ok(Err(e)) => eprintln!("usage\tsend failed\t{e}"),
        _ => {}
    }
}

/// At quit: the queue once more, waiting at most [`QUIT_FLUSH`].
pub fn flush_at_quit() {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(Usage::locate().flush(&pal_core::extensions::Store::locate()));
    });
    if let Ok(Err(e)) = rx.recv_timeout(QUIT_FLUSH) {
        eprintln!("usage\tsend at quit failed\t{e}");
    }
}

// ---- usage: palette opens --------------------------------------------------

/// Per window, the extensions opened during its current show: each is
/// counted once per show.
static OPENED: Mutex<BTreeSet<(String, String)>> = Mutex::new(BTreeSet::new());

/// A show of `window` (the panel, the sidebar) began.
pub fn new_show(window: &str) {
    lock(&OPENED).retain(|(w, _)| w != window);
}

/// A palette of `key`'s extension (`ext/palette`, `ext`, an instance key)
/// opened in `window`, once per show: noted in the local record of what is
/// used (`migrate::mark_used`, always), and counted for our extensions only
/// while sharing is on (docs/usage.md). The Store's own opening fetches the registries when that is due.
pub fn opened(app: &AppHandle, window: &str, key: &str) {
    let ext = name_of(key.split('/').next().unwrap_or(key)).to_string();
    if ext.is_empty() || ext == "pal" || app.try_state::<Service>().is_none() || !lock(&OPENED).insert((window.to_string(), ext.clone())) {
        return;
    }
    if ext == "store" {
        refresh_soon(app);
    }
    let m = manager(app);
    tauri::async_runtime::spawn_blocking(move || {
        // The local record the migration reads, sharing on or off; never sent.
        if let Err(e) = pal_core::extensions::migrate::mark_used(m.usage.dir(), &ext) {
            eprintln!("usage\tused record\t{e}");
        }
        if m.is_ours(&ext) {
            m.usage.opened(&ext);
        }
    });
}

/// The page entered a palette (`enter()` in Launcher.tsx: a row, a push,
/// an alias, a palette hotkey's open); `palette` is `extension/palette`.
#[tauri::command(async)]
pub fn usage_opened(app: AppHandle, window: tauri::Window, palette: String) {
    opened(&app, window.label(), &palette);
}

// ---- missing targets -------------------------------------------------------

/// What a link, a hotkey or a push into an extension that is not there
/// shows: the HUD's line, and the panel on the card that fixes it. Sent to
/// the panel's page as `pal://deeplink` `{ reset: true, missing: Missing }`:
///
/// - `state: "not_installed"`: a registry lists it and it can be installed
///   here; the card reads "<title> isn't installed" with Install, which is
///   `store_install(name, registry, "deeplink")`, then opens `palette` when
///   one was asked for.
/// - `state: "disabled"`: it is turned off (`[store] disabled`); the card
///   reads "<title> is turned off" with Turn on, `store_set_disabled(name,
///   false)`, then opens `palette`.
///
/// The page's own `enter()` into a palette of an extension the host does not
/// have builds the same card from `store_state()` (`available`, `disabled`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Missing {
    pub name: String,
    /// `extension/palette`, when a palette was asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub palette: Option<String>,
    pub state: &'static str,
    /// The registry an install takes it from (`not_installed` only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<String>,
    pub title: String,
    pub tagline: String,
    pub icon: Value,
}

/// Why `key` (`ext/palette` or a name) cannot open: its extension is
/// turned off, or not installed and installable from a registry. `None`
/// when the extension is there (a palette it lacks is another matter) or
/// nothing offers it.
pub fn missing(app: &AppHandle, key: &str) -> Option<Missing> {
    let name = name_of(key.split('/').next().unwrap_or(key)).to_string();
    let palette = key.contains('/').then(|| key.to_string());
    let listing = lock(&svc(app).state).as_ref().and_then(|s| {
        let mut offers: Vec<&Available> = s.available.iter().filter(|a| a.name == name).collect();
        offers.sort_by_key(|a| a.registry != PAL);
        offers.first().map(|a| (*a).clone())
    });
    let (title, tagline, icon) = match &listing {
        Some(a) => (Some(a.listing.title.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| name.clone()), a.listing.tagline.clone(), a.listing.icon.clone()),
        None => {
            let m = settings::manifest_of(app, &name).unwrap_or_default();
            (m["title"].as_str().unwrap_or(&name).to_string(), m["description"].as_str().unwrap_or_default().to_string(), m["icon"].clone())
        }
    };
    let out = |state, registry| Some(Missing { name: name.clone(), palette: palette.clone(), state, registry, title: title.clone(), tagline: tagline.clone(), icon: icon.clone() });
    if settings::config(app).store.is_disabled(&name) {
        return out("disabled", None);
    }
    if settings::extensions(app).iter().any(|e| e.name == name) {
        return None;
    }
    listing.filter(|a| !a.installed && a.installable).and_then(|a| out("not_installed", Some(a.registry)))
}

/// The HUD says what is missing and the panel opens on its card.
pub fn show_missing(app: &AppHandle, m: Missing) {
    hud::show(app, &format!("{} {}", m.title, if m.state == "disabled" { "is turned off" } else { "isn't installed" }));
    eprintln!("store\tmissing\t{}\t{}", m.name, m.state);
    crate::deeplink::settled(app, move |app| {
        crate::show(app);
        events::emit_to(app, crate::WINDOW, events::DEEPLINK, json!({ "reset": true, "missing": m }));
    });
}

// ---- root search: extensions not installed --------------------------------

/// The synthetic source of our registry's extensions not installed here,
/// and the "Browse extensions" row: typed queries only, after every
/// installed match (`index::query`), never by frecency.
pub fn source() -> Source {
    Source::new("pal", "available")
}

/// The row that opens the Store palette.
pub const BROWSE: &str = "pal:browse";

/// One row per extension of ours this platform can install and does not
/// have, then "Browse extensions".
fn rows(available: &[Available]) -> Vec<Item> {
    let mut rows: Vec<Item> = available.iter().filter(|a| a.registry == PAL && !a.installed && a.installable).map(row).collect();
    rows.push(Item {
        id: BROWSE.into(),
        name: "Browse extensions".into(),
        subtitle: Some("Find and install more in the Store".into()),
        keywords: ["extensions", "store", "install", "browse", "add", "more"].map(String::from).to_vec(),
        icon: Some(json!("\u{f0431}")),
        section: None,
        extra: serde_json::Map::from_iter([("detail".to_string(), json!({ "markdown": "# Browse extensions\n\nThe Store lists every extension pal's registry and the ones you added offer, by category, with Install." }))]),
    });
    rows
}

fn row(a: &Available) -> Item {
    let l = &a.listing;
    let title = if l.title.is_empty() { a.name.clone() } else { l.title.clone() };
    let mut keywords = vec![a.name.clone()];
    keywords.extend(l.keywords.iter().cloned());
    keywords.extend(l.palettes.iter().map(|p| p.title.clone()).filter(|t| !t.is_empty()));
    let mut md = format!("# {title}\n\n");
    if !l.description.is_empty() {
        md.push_str(&format!("{}\n\n", l.description));
    }
    let palettes: Vec<&str> = l.palettes.iter().map(|p| if p.title.is_empty() { p.id.as_str() } else { p.title.as_str() }).collect();
    if !palettes.is_empty() {
        md.push_str(&format!("**Palettes:** {}\n\n", palettes.join(", ")));
    }
    for s in &l.screenshots {
        let (url, caption) = match s {
            Value::String(u) => (u.as_str(), ""),
            v => (v["url"].as_str().unwrap_or_default(), v["caption"].as_str().unwrap_or_default()),
        };
        if !url.is_empty() {
            md.push_str(&format!("![{caption}]({url})\n\n"));
        }
    }
    md.push_str("Not installed. Enter installs it from pal's registry and opens it.");
    let subtitle = if l.tagline.is_empty() { "Not installed".to_string() } else { format!("Not installed \u{b7} {}", l.tagline) };
    Item {
        id: a.name.clone(),
        name: title,
        subtitle: Some(subtitle),
        keywords,
        icon: Some(l.icon.clone()).filter(|i| !i.is_null()).or(Some(json!("\u{f01da}"))),
        section: None,
        extra: serde_json::Map::from_iter([
            ("detail".to_string(), json!({ "markdown": md.trim_end() })),
            ("actions".to_string(), json!([{ "id": "install", "title": "Install" }, { "id": "page", "title": "Open store page" }])),
        ]),
    }
}

/// The rows into the index when they changed.
fn sync_rows(app: &AppHandle, available: &[Available]) {
    let rows = rows(available);
    let source = source();
    let changed = crate::index::with_index(app, |ix| {
        if ix.snapshot(&source) == rows {
            return false;
        }
        ix.replace(source, rows.clone());
        true
    });
    if changed {
        let (n, blocked) = (available.len(), available.iter().filter(|a| a.blocked.is_some()).count());
        eprintln!("store\troot rows\t{} of {n} listed ({blocked} blocked, the rest installed or another registry's)", rows.len() - 1);
        events::emit(app, events::INDEX, ());
    }
}

/// The palette of `palettes` a query was after: the one whose title (or id)
/// has the query in it, else the first.
fn best_palette<'a>(query: &str, palettes: &'a [ListingPalette]) -> Option<&'a ListingPalette> {
    let q = query.trim().to_lowercase();
    let hit = |p: &&ListingPalette| !q.is_empty() && (p.title.to_lowercase().contains(&q) || p.id.to_lowercase().contains(&q) || q.split_whitespace().all(|w| p.title.to_lowercase().split_whitespace().any(|t| t.starts_with(w))));
    palettes.iter().find(hit).or(palettes.first())
}

/// Where "Browse extensions", a welcome row or `settings_open_store` goes:
/// the Store palette as a level, or the website while it is not loaded.
pub fn store_envelope(app: &AppHandle) -> Value {
    if settings::extensions(app).iter().any(|e| e.name == "store" && e.loaded) {
        json!({ "push": { "extension": "store", "palette": "store" } })
    } else {
        json!({ "open": crate::commands::STORE })
    }
}

/// A pick on a `pal/available` row: Install (Enter) installs it with the
/// HUD saying so and answers a push into the palette the query was after;
/// "Open store page" opens its page in the Store palette.
pub async fn pick(app: &AppHandle, id: &str, action: Option<&str>, query: &str) -> Result<Value, String> {
    if id == BROWSE {
        return crate::effects::apply(app, store_envelope(app)).await;
    }
    let st = state(app).await;
    let Some(a) = st.available.iter().find(|a| a.registry == PAL && a.name == id).cloned() else { return Ok(crate::effects::toast("No longer available", id, "failure")) };
    let title = if a.listing.title.is_empty() { a.name.clone() } else { a.listing.title.clone() };
    if action == Some("page") {
        let env = store_envelope(app);
        return Ok(if env.get("push").is_some() { json!({ "push": { "extension": "store", "palette": "store", "query": a.name } }) } else { json!({ "open": format!("{}/{}", crate::commands::STORE, a.name) }) });
    }
    hud::show(app, &format!("Installing {title}\u{2026}"));
    let r = install(app, &a.name, Some(PAL), From::Search).await;
    match (r.ok, r.loaded) {
        (true, Some(true)) => {
            hud::show(app, &format!("Installed {title}"));
            let Some(p) = best_palette(query, &a.listing.palettes) else { return Ok(json!({ "keep": true })) };
            let target = Source::new(&a.name, &p.id);
            // The host's `extension/loaded` registers the palettes a beat after the reload answered.
            let t0 = Instant::now();
            while t0.elapsed() < Duration::from_secs(3) && !crate::registry::registered_palettes(app).iter().any(|(_, s)| *s == target) {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Ok(json!({ "push": { "extension": a.name, "palette": p.id } }))
        }
        _ => {
            let why = r.error.unwrap_or_else(|| "did not load".into());
            hud::show(app, &format!("{title}: {why}"));
            Ok(crate::effects::toast(&format!("Could not install {title}"), &why, "failure"))
        }
    }
}

// ---- commands --------------------------------------------------------------

#[tauri::command]
pub async fn store_state(app: AppHandle) -> StoreState {
    state(&app).await
}

/// Fetches every registry now (a second call within [`COALESCE`] answers
/// from the first), then reconciles and applies what updates by itself.
#[tauri::command]
pub async fn store_refresh(app: AppHandle) -> StoreState {
    let mut st = refresh(&app, COALESCE).await;
    st.busy = lock(&svc(&app).busy).iter().cloned().collect();
    st
}

#[tauri::command]
pub async fn store_install(app: AppHandle, name: String, registry: Option<String>, from: From) -> OpResult {
    install(&app, &name, registry.as_deref(), from).await
}

/// Settings' install field: a name or a source (`install_spec`).
#[tauri::command]
pub async fn store_install_source(app: AppHandle, spec: String) -> OpResult {
    install_spec(&app, &spec, From::Settings).await
}

#[tauri::command]
pub async fn store_update(app: AppHandle, names: Vec<String>, from: From) -> Vec<OpResult> {
    update(&app, names, from).await
}

#[tauri::command]
pub async fn store_remove(app: AppHandle, name: String, forget: bool) -> OpResult {
    remove(&app, &name, forget, From::Settings).await
}

#[tauri::command]
pub async fn store_set_disabled(app: AppHandle, name: String, disabled: bool) -> Result<(), String> {
    set_disabled(&app, &name, disabled, From::Settings).await
}

/// A registry fetched and checked before it is added: `key` pins it, else
/// the key its index announces.
#[tauri::command]
pub async fn store_registry_preview(app: AppHandle, url: String, key: Option<String>) -> Result<PreviewView, String> {
    preview(&app, url, key).await
}

pub async fn preview(app: &AppHandle, url: String, key: Option<String>) -> Result<PreviewView, String> {
    let p = blocking(app, move |_| registry::preview(url.trim(), key.as_deref().map(str::trim).filter(|k| !k.is_empty())).map_err(|e| e.to_string())).await?;
    Ok(PreviewView { name: p.name, url: p.url, count: p.count, key_id: p.key_id.unwrap_or_default(), key: p.key })
}

#[tauri::command]
pub async fn store_registry_add(app: AppHandle, url: String, key: String) -> Result<(), String> {
    registry_add(&app, url, Some(key)).await.map(|_| ())
}

/// Follows the registry at `url`, its key pinned (`key`, else its index's),
/// and fetches it.
pub async fn registry_add(app: &AppHandle, url: String, key: Option<String>) -> Result<PreviewView, String> {
    let (u, k) = (url.clone(), key.clone());
    let p = blocking(app, move |m| {
        let p = registry::preview(u.trim(), k.as_deref().map(str::trim).filter(|k| !k.is_empty())).map_err(|e| e.to_string())?;
        m.add_registry(&p).map_err(text)?;
        Ok(p)
    })
    .await?;
    eprintln!("store\tregistry added\t{}\t{}", p.name, p.url);
    // The manager follows it from here (`apply_config`).
    settings::reload_now(app);
    let n = p.name.clone();
    if let Err(e) = blocking(app, move |m| m.registries.refresh(&n).map_err(|e| e.to_string())).await {
        eprintln!("store\tregistry {}\tfirst fetch failed\t{e}", p.name);
    }
    compute(app).await;
    Ok(PreviewView { name: p.name, url: p.url, count: p.count, key_id: p.key_id.unwrap_or_default(), key: p.key })
}

#[tauri::command]
pub async fn store_registry_remove(app: AppHandle, name: String) -> Result<(), String> {
    let n = name.clone();
    blocking(&app, move |m| m.remove_registry(&n).map_err(text)).await?;
    eprintln!("store\tregistry removed\t{name}");
    settings::reload_now(&app);
    Ok(())
}

/// A registry's own `auto_update` and `channel`; `null` leaves either as it
/// is. A new channel is another index: fetched at once.
#[tauri::command]
pub async fn store_registry_set(app: AppHandle, name: String, auto_update: Option<bool>, channel: Option<Channel>) -> Result<(), String> {
    let current = settings::config(&app).store.registries.into_iter().find(|r| r.name == name);
    let (a, c) = (auto_update.or(current.as_ref().and_then(|r| r.auto_update)), channel.or(current.as_ref().and_then(|r| r.channel)));
    let (file, n) = (settings::file(&app), name.clone());
    tauri::async_runtime::spawn_blocking(move || file.store_set_registry(&n, a, c)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    settings::reload_now(&app);
    if channel.is_some() {
        refresh(&app, Duration::ZERO).await;
    }
    Ok(())
}

/// Drops the references and config tables (and the keychain secrets they
/// held) of an extension that is not there.
#[tauri::command]
pub async fn store_forget_leftover(app: AppHandle, name: String) -> Result<(), String> {
    forget_all(&app, &name, false).await
}

/// The Store palette in the panel ("Get more extensions" in Settings).
#[tauri::command]
pub async fn settings_open_store(app: AppHandle) -> Result<(), String> {
    match store_envelope(&app).get("push") {
        Some(_) => {
            let handle = app.clone();
            app.run_on_main_thread(move || crate::show_in(&handle, Some("store/store".into()))).map_err(|e| e.to_string())
        }
        None => crate::effects::apply(&app, store_envelope(&app)).await.map(|_| ()),
    }
}

/// `core/store.<fn>` from the host (bridge.rs), for the SDK's `extensions`
/// API: `disabled` (what the host must not load), `state`, `refresh`,
/// `install {name, registry?, from?}`, `update {names?, from?}`, `remove
/// {name, forget?}`. On the bridge's blocking thread, so the async work is
/// waited for here; the SDK passes a long timeout for the last four.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let from = || serde_json::from_value::<From>(params["from"].clone()).unwrap_or(From::Store);
    let name = || params["name"].as_str().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).ok_or_else(|| format!("store.{func}: `name` is required"));
    let json = |v: Result<Value, serde_json::Error>| v.map_err(|e| e.to_string());
    match func {
        "disabled" => Ok(json!(settings::config(app).store.disabled)),
        "state" => json(serde_json::to_value(tauri::async_runtime::block_on(state(app)))),
        "refresh" => json(serde_json::to_value(tauri::async_runtime::block_on(refresh(app, COALESCE)))),
        "install" => {
            let (name, registry) = (name()?, params["registry"].as_str().map(str::to_string));
            json(serde_json::to_value(tauri::async_runtime::block_on(install(app, &name, registry.as_deref(), from()))))
        }
        "update" => {
            let names: Vec<String> = serde_json::from_value(params["names"].clone()).unwrap_or_default();
            json(serde_json::to_value(tauri::async_runtime::block_on(update(app, names, from()))))
        }
        "remove" => {
            let name = name()?;
            json(serde_json::to_value(tauri::async_runtime::block_on(remove(app, &name, params["forget"] == true, from()))))
        }
        _ => Err(format!("unknown store.{func}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pal_core::registry::Listing;

    fn set(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    fn available(name: &str, registry: &str, installed: bool, installable: bool) -> Available {
        let listing = Listing {
            title: name.to_uppercase(),
            tagline: "the sky".into(),
            keywords: vec!["forecast".into()],
            palettes: vec![ListingPalette { id: "now".into(), title: "Right now".into(), kind: "list".into() }, ListingPalette { id: "week".into(), title: "This week".into(), kind: "list".into() }],
            screenshots: vec![json!({ "url": "https://x/1.png", "caption": "one" }), json!("https://x/2.png")],
            ..Default::default()
        };
        Available { name: name.into(), registry: registry.into(), listing, installed, bundled: false, installable, blocked: None, build: None }
    }

    #[test]
    fn the_migration_lists_bundled_names_in_use_once() {
        let listed = vec![("pal".to_string(), "calc".to_string()), ("acme".into(), "todo".into())];
        assert_eq!(to_list(&set(&["calc", "clipboard", "emoji", "timer"]), &set(&["calc", "clipboard", "timer", "weather", "todo"]), &listed), ["clipboard", "timer"], "in use and bundled, not yet listed");
        assert!(to_list(&set(&[]), &set(&["weather"]), &[]).is_empty(), "a registry-only name is never listed by it (the user may have removed it)");
    }

    #[test]
    fn pending_keeps_its_error_and_time_while_listed() {
        let plan = |names: &[&str]| Plan { install: names.iter().map(|n| ("pal".to_string(), n.to_string())).collect(), unlisted: vec![] };
        let mut seen = BTreeMap::new();
        let p = pending_of(&plan(&["weather", "hue"]), &mut seen, 10);
        assert_eq!((p.len(), p[0].since), (2, 10));
        seen.get_mut("weather").unwrap().0 = Some("offline".into());
        let p = pending_of(&plan(&["weather"]), &mut seen, 20);
        assert_eq!(p, [Pending { name: "weather".into(), registry: "pal".into(), error: Some("offline".into()), since: 10 }]);
        assert!(!seen.contains_key("hue"), "installed meanwhile: gone");
    }

    #[test]
    fn reconcile_counts_bundled_and_local_names_as_installed() {
        let (config, _) = pal_core::config::parse("[store]\ninstalled = [\"calc\", \"weather\", \"mine\", \"acme:todo\"]\n").unwrap();
        let roots = pal_core::extensions::Roots { bundled: set(&["calc"]), local: set(&["mine"]) };
        let plan = pal_core::config::reconcile(&config.store, &[], &roots);
        assert_eq!(plan.install, [("pal".to_string(), "weather".to_string()), ("acme".into(), "todo".into())]);
        assert_eq!(pending_of(&plan, &mut BTreeMap::new(), 1).iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["weather", "todo"]);
    }

    fn status(name: &str, auto: bool, update: bool) -> Status {
        let to: registry::Build = serde_json::from_value(json!({ "hash": "h2", "seq": 2, "protocol": 1, "url": "u", "sig": "s" })).unwrap();
        Status { name: name.into(), origin: Origin::Store, registry: Some(PAL.into()), installed: None, state: if update { State::Update { to } } else { State::UpToDate }, auto_update: auto }
    }

    #[test]
    fn auto_updates_apply_now_or_wait_for_the_view_to_close() {
        let all = vec![status("weather", true, true), status("solitaire", true, true), status("hue", false, true), status("calc", true, false), status("busy", true, true)];
        let (now, later) = auto_plan(all.clone(), true, |n| n == "busy", |n| n == "solitaire");
        assert_eq!(now.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["weather"]);
        assert_eq!(later, ["solitaire"], "a game on screen is never swapped under itself");
        let (now, later) = auto_plan(all, false, |_| false, |_| false);
        assert!(now.is_empty() && later.is_empty(), "[store] auto_update off: nothing by itself");
    }

    #[test]
    fn available_rows_are_ours_uninstalled_and_installable_then_browse() {
        let rows = rows(&[available("weather", PAL, false, true), available("calc", PAL, true, true), available("far", PAL, false, false), available("todo", "acme", false, true)]);
        assert_eq!(rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["weather", BROWSE]);
        let w = &rows[0];
        assert_eq!((w.name.as_str(), w.subtitle.as_deref()), ("WEATHER", Some("Not installed \u{b7} the sky")));
        assert!(["weather", "forecast", "Right now", "This week"].iter().all(|k| w.keywords.contains(&k.to_string())), "{:?}", w.keywords);
        let md = w.extra["detail"]["markdown"].as_str().unwrap();
        assert!(md.contains("Right now, This week") && md.contains("![one](https://x/1.png)") && md.contains("(https://x/2.png)"), "{md}");
        assert_eq!(w.extra["actions"][0]["id"], "install", "Enter installs");
        assert!(["extensions", "store", "install", "browse"].iter().all(|k| rows[1].keywords.contains(&k.to_string())));
    }

    #[test]
    fn the_install_opens_the_palette_the_query_was_after() {
        let a = available("weather", PAL, false, true);
        let p = &a.listing.palettes;
        assert_eq!(best_palette("week", p).unwrap().id, "week");
        assert_eq!(best_palette("this w", p).unwrap().id, "week");
        assert_eq!(best_palette("weather", p).unwrap().id, "now", "the extension's name: its first palette");
        assert_eq!(best_palette("", p).unwrap().id, "now");
        assert!(best_palette("x", &[]).is_none());
    }

    #[test]
    fn an_op_result_says_what_the_load_did() {
        let ok = OpResult::after("w", &Ok(Reloaded { loaded: true, ..Default::default() }));
        assert_eq!(serde_json::to_value(&ok).unwrap(), json!({ "name": "w", "ok": true, "loaded": true }));
        let bad = OpResult::after("w", &Ok(Reloaded { loaded: false, error: Some("boom".into()), ..Default::default() }));
        assert_eq!((bad.ok, bad.loaded, bad.error.as_deref()), (true, Some(false), Some("boom")));
        let off = OpResult::after("w", &Ok(Reloaded { loaded: false, disabled: true, error: None, root: None }));
        assert_eq!(off.error, None, "turned off is not a failure");
        assert_eq!(failed_load(&Ok(Reloaded { loaded: false, error: Some("x".into()), ..Default::default() })).as_deref(), Some("x"));
        assert_eq!(failed_load(&Err("host down".into())), None, "no answer is not a failed load");
    }
}
