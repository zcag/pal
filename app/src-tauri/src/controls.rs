//! Controls and groups, live (`pal_core::controls`, `docs/design/controls.md`):
//! the published table, `core/controls.{publish, get, all, run}` for the
//! SDK, `controls/run` to the host for a run, and the fan-out of a change:
//! `controls/changed` to the host (its `controls.onChange`), `pal://controls`
//! to the pages. The groups come from the config (`[groups]`); Settings ›
//! Groups writes them with the `groups_*` commands below.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pal_core::config::Config;
use pal_core::controls::{self, Change, Group, Table};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::{events, lock, settings};

/// How long one op may take on its provider (a wake over the network); the SDK waits a little longer.
const RUN_TIMEOUT: Duration = Duration::from_secs(14);

#[derive(Default)]
pub struct Live {
    table: Mutex<Table>,
}

pub fn install(app: &AppHandle) {
    app.manage(Live::default());
}

fn groups(app: &AppHandle) -> BTreeMap<String, Group> {
    settings::config(app).groups
}

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Table) -> T) -> T {
    let live = app.state::<Live>();
    let mut t = lock(&live.table);
    f(&mut t)
}

/// Tell the host and the pages what moved.
fn fan_out(app: &AppHandle, changes: Vec<Change>) {
    if changes.is_empty() {
        return;
    }
    let msg = json!({ "changes": changes });
    events::emit(app, events::CONTROLS, &msg);
    if let Some(host) = app.try_state::<Arc<Host>>() {
        let host = host.inner().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = host.notify("controls/changed", msg).await {
                eprintln!("controls\tpush failed\t{e}");
            }
        });
    }
}

/// The config was reloaded: the members of every group that changed hear it.
pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    if prev.groups != next.groups {
        fan_out(app, controls::regrouped(&prev.groups, &next.groups));
    }
}

/// An extension (instance) went away: what it published goes with it.
pub fn forget(app: &AppHandle, key: &str) {
    if app.try_state::<Live>().is_none() {
        return;
    }
    let g = groups(app);
    let changes = with(app, |t| t.forget(&g, key));
    fan_out(app, changes);
}

/// `core/controls.*` from the host (bridge.rs). `extension` is the caller's instance key.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let ext = params["extension"].as_str().ok_or("controls: no extension")?.to_string();
    let control = params["control"].as_str().ok_or("controls: no control")?.to_string();
    if !controls::NAMES.contains(&control.as_str()) {
        return Err(format!("no control {control}: one of {}", controls::NAMES.join(", ")));
    }
    let g = groups(app);
    match func {
        "publish" => {
            let state = match &params["state"] {
                Value::Null => None,
                Value::Object(m) => Some(m.clone()),
                _ => return Err("controls.publish: the state is an object, or null to withdraw".into()),
            };
            let change = with(app, |t| t.publish(&g, &ext, &control, state))?;
            fan_out(app, change.into_iter().collect());
            Ok(Value::Null)
        }
        "get" => Ok(with(app, |t| t.get(&g, &ext, &control)).unwrap_or(Value::Null)),
        "all" => Ok(Value::Array(with(app, |t| t.all(&control)))),
        "run" => {
            let op = params["op"].as_str().ok_or("controls.run: no op")?.to_string();
            let args = params.get("args").cloned().filter(Value::is_array).unwrap_or_else(|| json!([]));
            let targets = with(app, |t| t.targets(&g, &ext, &control));
            let host = app.try_state::<Arc<Host>>().ok_or("controls.run: the host is not running")?.inner().clone();
            let runs = targets.iter().map(|key| {
                let (host, params) = (host.clone(), json!({ "extension": key, "control": control, "op": op, "args": args }));
                async move { host.request_within("controls/run", params, RUN_TIMEOUT).await }
            });
            // Every member's power at once: a sleeping TV's wake must not wait behind the Apple TV's.
            let handles: Vec<_> = runs.map(tauri::async_runtime::spawn).collect();
            let results: Vec<Result<Value, String>> = tauri::async_runtime::block_on(async move {
                let mut out = Vec::new();
                for h in handles {
                    out.push(h.await.unwrap_or_else(|e| Err(e.to_string())));
                }
                out
            });
            let errors: Vec<String> = results.into_iter().filter_map(Result::err).collect();
            eprintln!("controls\trun\t{ext}\t{control}.{op}\t{}{}", targets.join(","), if errors.is_empty() { String::new() } else { format!("\t{}", errors.join("; ")) });
            if errors.is_empty() { Ok(Value::Null) } else { Err(errors.join("; ")) }
        }
        _ => Err(format!("unknown controls.{func}")),
    }
}

// ---- Settings › Groups ------------------------------------------------------

/// What every extension published, by instance key then control: the page names devices by their `device`.
#[tauri::command]
pub fn controls_published(app: AppHandle) -> BTreeMap<String, BTreeMap<String, Value>> {
    with(&app, |t| t.snapshot())
}

fn path(id: &str, key: &str) -> String {
    format!("{}.{key}", pal_core::config::instance::table_key("groups", id))
}

fn known(app: &AppHandle, id: &str) -> Result<(), String> {
    if groups(app).contains_key(id) { Ok(()) } else { Err(format!("no group {id}")) }
}

fn write(app: &AppHandle, changes: Vec<(String, Option<Value>)>) -> Result<(), String> {
    let file = settings::file(app);
    settings::retrying(|| file.set_many(changes.clone()))?;
    settings::reload_now(app);
    Ok(())
}

/// `[groups.<id>]` written with `title` and the `members` given; answers the id (the title slugged).
#[tauri::command(async)]
pub fn groups_create(app: AppHandle, title: String, members: Option<Vec<String>>) -> Result<String, String> {
    let title = title.trim().to_string();
    let id = controls::new_id(&groups(&app), &title);
    let title = if title.is_empty() { "Group".to_string() } else { title };
    let members = members.unwrap_or_default();
    write(&app, vec![(path(&id, "title"), Some(json!(title))), (path(&id, "members"), Some(json!(members)))])?;
    eprintln!("groups\tcreated\t{id}");
    Ok(id)
}

/// The group's `title`; empty unsets it (the id shows).
#[tauri::command(async)]
pub fn groups_rename(app: AppHandle, id: String, title: String) -> Result<(), String> {
    known(&app, &id)?;
    let t = title.trim();
    write(&app, vec![(path(&id, "title"), (!t.is_empty()).then(|| json!(t)))])
}

/// `[groups.<id>]` gone.
#[tauri::command(async)]
pub fn groups_delete(app: AppHandle, id: String) -> Result<(), String> {
    known(&app, &id)?;
    write(&app, vec![(pal_core::config::instance::table_key("groups", &id), None)])
}

/// The group's members, in order; a binding to a member that left is unset with it.
#[tauri::command(async)]
pub fn groups_set_members(app: AppHandle, id: String, members: Vec<String>) -> Result<(), String> {
    let g = groups(&app).remove(&id).ok_or_else(|| format!("no group {id}"))?;
    let mut members: Vec<String> = members.into_iter().filter(|m| !m.trim().is_empty()).collect();
    members.dedup();
    let mut changes = vec![(path(&id, "members"), Some(json!(members)))];
    for c in controls::BOUND {
        if g.binding(c).is_some_and(|b| !members.iter().any(|m| m == b)) {
            changes.push((path(&id, c), None));
        }
    }
    write(&app, changes)
}

/// Which member serves `control` (`volume`, `inputs`) to the group; `None`: each its own.
#[tauri::command(async)]
pub fn groups_bind(app: AppHandle, id: String, control: String, member: Option<String>) -> Result<(), String> {
    let g = groups(&app).remove(&id).ok_or_else(|| format!("no group {id}"))?;
    if !controls::BOUND.contains(&control.as_str()) {
        return Err(format!("a group binds {} only; power is every member's", controls::BOUND.join(" and ")));
    }
    if let Some(m) = member.as_deref().filter(|m| !g.members.iter().any(|x| x == m)) {
        return Err(format!("{m} is not a member of {id}"));
    }
    write(&app, vec![(path(&id, &control), member.map(|m| json!(m)))])
}
