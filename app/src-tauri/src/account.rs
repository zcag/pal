//! The account in the app (docs/design/accounts.md): `pal_core::account`
//! and `pal_core::sync` wired to the storage, the config, the host and
//! Settings › Account.
//!
//! - A ticker thread runs what sync says is due ([`pal_core::sync::Sync::due`])
//!   once a second: a push a few seconds after a change, a pull every 15
//!   minutes; the panel showing pulls too ([`shown`], at most once a minute).
//!   What a pull or a merge changed in storage goes to the host as
//!   `storage/changed {extension, key, value}`; config values go through
//!   the file, and the watcher does the rest.
//! - The bridge: `core/account.{get, signIn}` and
//!   `core/leaderboard.{post, get}` (api.ts and the kit's `pal.score`).
//! - The Tauri commands behind Settings › Account, which hears
//!   [`events::ACCOUNT`] when anything here moves.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pal_core::account::{self, Account, Period};
use pal_core::config::sync::Local;
use pal_core::storage::Storage;
use pal_core::sync::{Decl, Due, Outcome, Places, Sync};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::events;
use crate::host::Host;
use crate::settings;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// After `storage::install` and `settings::install`: the account as this
/// machine has it, sync marking storage writes, the ticker.
pub fn install(app: &AppHandle) {
    let account = Arc::new(Account::open());
    let sync = Arc::new(Sync::open());
    sync.set_on(account.signed_in());
    eprintln!("account\t{}", if account.signed_in() { "signed in" } else { "signed out" });
    let marks = sync.clone();
    app.state::<Storage>().watch(Arc::new(move |ext, key| marks.mark(ext, key, now_ms())));
    app.manage(account);
    app.manage(sync);
    let handle = app.clone();
    std::thread::Builder::new().name("sync".into()).spawn(move || ticker(&handle)).ok();
}

fn account(app: &AppHandle) -> Arc<Account> {
    app.state::<Arc<Account>>().inner().clone()
}

fn sync(app: &AppHandle) -> Arc<Sync> {
    app.state::<Arc<Sync>>().inner().clone()
}

/// Once a second: what sync says is due, and scores that wait, once a minute.
fn ticker(app: &AppHandle) {
    let mut scores_at = 0;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let now = now_ms();
        let (a, s) = (account(app), sync(app));
        if a.signed_in() {
            if let Some(due) = s.due(now) {
                let _ = exchange(app, due);
            }
        }
        if now >= scores_at && a.has_queued() {
            scores_at = now + 60_000;
            let n = a.flush_scores();
            if n > 0 {
                eprintln!("account\tscores sent\t{n}");
            }
        }
    }
}

/// One push and pull (or pull), its changes told to the host and Settings.
fn exchange(app: &AppHandle, due: Due) -> Result<(), String> {
    let (a, s) = (account(app), sync(app));
    let storage = app.state::<Storage>();
    let file = settings::file(app);
    let places = Places { storage: storage.inner(), config: &file };
    let r = a.call(|c| s.run(due, c, &places, now_ms()));
    match &r {
        Ok(out) => announce(app, out),
        Err(e) => eprintln!("sync\t{due:?} failed\t{e}"),
    }
    if !a.signed_in() {
        s.reset();
    }
    events::emit(app, events::ACCOUNT, ());
    r.map(drop).map_err(|e| e.to_string())
}

/// `storage/changed` to the host for every storage value sync wrote.
fn announce(app: &AppHandle, out: &Outcome) {
    if out.sent + out.storage.len() + out.config > 0 {
        eprintln!("sync\tsent {}\tstorage {}\tconfig {}", out.sent, out.storage.len(), out.config);
    }
    let Some(host) = app.try_state::<Arc<Host>>() else { return };
    for c in &out.storage {
        let (host, payload) = (host.inner().clone(), json!(c));
        tauri::async_runtime::spawn(async move {
            if let Err(e) = host.notify("storage/changed", payload).await {
                eprintln!("sync\tstorage/changed failed\t{e}");
            }
        });
    }
}

/// The panel is showing: a pull when the last is a minute old.
pub fn shown(app: &AppHandle) {
    let (Some(a), Some(s)) = (app.try_state::<Arc<Account>>(), app.try_state::<Arc<Sync>>()) else { return };
    if a.signed_in() && s.shown(now_ms()) {
        let app = app.clone();
        std::thread::spawn(move || drop(exchange(&app, Due::Pull)));
    }
}

/// The config file changed: compared at the next push.
pub fn config_changed(app: &AppHandle) {
    if let Some(s) = app.try_state::<Arc<Sync>>() {
        s.config_changed(now_ms());
    }
}

/// The loaded extensions changed: which opted in to sync, and the config
/// keys their settings make local.
pub fn refresh(app: &AppHandle) {
    let Some(s) = app.try_state::<Arc<Sync>>() else { return };
    let exts = settings::extensions(app);
    for name in s.declared() {
        if !exts.iter().any(|e| e.name == name) {
            s.declare(&name, None);
        }
    }
    for e in &exts {
        match Decl::from_manifest(&e.manifest) {
            Ok(d) => s.declare(&e.name, d),
            Err(err) => eprintln!("sync\t{}\t{err}", e.name),
        }
    }
    s.set_local(Local::with_manifests(&exts.iter().map(|e| (e.key.clone(), e.manifest.clone())).collect::<Vec<_>>()));
}

/// The config keys that stay on this machine, for Settings' notes.
pub fn local_keys(app: &AppHandle) -> Vec<String> {
    app.try_state::<Arc<Sync>>().map_or_else(|| Local::default().patterns(), |s| s.local().patterns())
}

// ---- bridge ----------------------------------------------------------------

#[derive(Deserialize)]
struct BoardParams {
    extension: String,
    board: String,
    #[serde(default)]
    value: Option<f64>,
    #[serde(default)]
    period: Option<Period>,
    #[serde(default)]
    anon: Option<bool>,
}

/// `core/account.{get, signIn}`. Never the email: an extension sees
/// whether there is an account and its handle.
pub fn call_account(app: &AppHandle, func: &str, _params: Value) -> Result<Value, String> {
    let a = account(app);
    match func {
        "get" => Ok(json!({ "signedIn": a.signed_in(), "handle": a.profile().and_then(|p| p.handle) })),
        "signIn" => {
            settings::open_page(app, Some("account"));
            Ok(Value::Null)
        }
        _ => Err(format!("unknown account.{func}")),
    }
}

/// `core/leaderboard.{post, get}`: a board the extension's manifest
/// declares. A signed-in post without a handle opens Settings › Account
/// at the handle and answers "choose a handle".
pub fn call_leaderboard(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    let p: BoardParams = serde_json::from_value(params).map_err(|e| format!("bad params: {e}"))?;
    let manifest = settings::manifest_of(app, &p.extension).ok_or_else(|| format!("{} is not loaded", p.extension))?;
    let boards = account::boards(&manifest)?;
    let board = account::find(&boards, &p.board).ok_or_else(|| format!("{} declares no leaderboard {}", p.extension, p.board))?;
    let name = pal_core::config::instance::name_of(&p.extension);
    let a = account(app);
    let r = match func {
        "post" => a.post_score(name, &p.board, p.value.ok_or("leaderboard.post: no value")?, board),
        "get" => a.board(name, &p.board, p.period, p.anon),
        _ => return Err(format!("unknown leaderboard.{func}")),
    };
    if r == Err(account::Error::Handle) {
        settings::open_at(app, Some("account"), Some("account:handle"));
    }
    r.map_err(|e| e.to_string())
}

// ---- Settings › Account ----------------------------------------------------

/// What the page draws, signed in or out.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    signed_in: bool,
    email: Option<String>,
    handle: Option<String>,
    /// Unix seconds of the last exchange that went through.
    last_synced: Option<u64>,
    /// The loaded extensions that sync their storage: key and title.
    synced: Vec<SyncedExtension>,
}

#[derive(Serialize)]
pub struct SyncedExtension {
    key: String,
    title: String,
}

fn view(app: &AppHandle) -> AccountView {
    let (a, s) = (account(app), sync(app));
    let profile = a.profile();
    let mut synced: Vec<SyncedExtension> = settings::extensions(app).into_iter().filter(|e| e.manifest["sync"].is_object()).map(|e| SyncedExtension { title: e.manifest["title"].as_str().unwrap_or(&e.key).to_string(), key: e.key }).collect();
    synced.sort_by(|x, y| x.title.cmp(&y.title));
    AccountView { signed_in: a.signed_in(), email: profile.as_ref().map(|p| p.email.clone()), handle: profile.and_then(|p| p.handle), last_synced: s.last_synced(), synced }
}

#[tauri::command(async)]
pub fn account_state(app: AppHandle) -> AccountView {
    view(&app)
}

#[tauri::command(async)]
pub fn account_start(app: AppHandle, email: String) -> Result<(), String> {
    account(&app).start(&email).map_err(|e| e.to_string())
}

/// The code: signed in, this device's storage and config sent from base
/// 0 and the account's pulled, before the answer.
#[tauri::command(async)]
pub fn account_verify(app: AppHandle, email: String, code: String) -> Result<AccountView, String> {
    let a = account(&app);
    a.verify(&email, &code, &account::device_name()).map_err(|e| e.to_string())?;
    sync(&app).first(app.state::<Storage>().inner());
    eprintln!("account\tsigned in");
    if let Err(e) = exchange(&app, Due::Push) {
        eprintln!("sync\tfirst exchange\t{e}");
    }
    Ok(view(&app))
}

/// `GET /api/account`: the devices, and the email and handle refreshed.
#[tauri::command(async)]
pub fn account_details(app: AppHandle) -> Result<Value, String> {
    let r = account(&app).details().map_err(|e| e.to_string());
    if !account(&app).signed_in() {
        sync(&app).reset();
        events::emit(&app, events::ACCOUNT, ());
    }
    r
}

#[tauri::command(async)]
pub fn account_set_handle(app: AppHandle, handle: String) -> Result<String, String> {
    let r = account(&app).set_handle(&handle).map_err(|e| e.to_string());
    events::emit(&app, events::ACCOUNT, ());
    r
}

/// Signs a device out; this one (`current`) signs out here as well.
#[tauri::command(async)]
pub fn account_drop_device(app: AppHandle, id: String, current: bool) -> Result<(), String> {
    let a = account(&app);
    a.drop_device(&id).map_err(|e| e.to_string())?;
    if current {
        a.forget();
        sync(&app).reset();
    }
    events::emit(&app, events::ACCOUNT, ());
    Ok(())
}

/// Signed out; local data stays.
#[tauri::command(async)]
pub fn account_sign_out(app: AppHandle) {
    account(&app).sign_out();
    sync(&app).reset();
    eprintln!("account\tsigned out");
    events::emit(&app, events::ACCOUNT, ());
}

/// Everything the server holds, gone; signed out.
#[tauri::command(async)]
pub fn account_delete(app: AppHandle) -> Result<(), String> {
    account(&app).delete().map_err(|e| e.to_string())?;
    sync(&app).reset();
    eprintln!("account\tdeleted");
    events::emit(&app, events::ACCOUNT, ());
    Ok(())
}

/// Sync now: a push of anything pending and a pull.
#[tauri::command(async)]
pub fn sync_now(app: AppHandle) -> Result<AccountView, String> {
    exchange(&app, Due::Push)?;
    Ok(view(&app))
}

/// A space's history (`config`, `ext:<key>`), or one key's.
#[tauri::command(async)]
pub fn sync_history(app: AppHandle, space: String, key: Option<String>) -> Result<Value, String> {
    let s = sync(&app);
    account(&app).call(|c| s.history(c, &space, key.as_deref())).map_err(|e| e.to_string())
}

/// One key back to a revision, or the whole space to a time (unix seconds).
#[tauri::command(async)]
pub fn sync_restore(app: AppHandle, space: String, key: Option<String>, rev: Option<u64>, at: Option<u64>) -> Result<(), String> {
    let s = sync(&app);
    let storage = app.state::<Storage>();
    let file = settings::file(&app);
    let places = Places { storage: storage.inner(), config: &file };
    let out = account(&app).call(|c| s.restore(c, &places, &space, key.as_deref(), rev, at)).map_err(|e| e.to_string())?;
    announce(&app, &out);
    events::emit(&app, events::ACCOUNT, ());
    Ok(())
}
