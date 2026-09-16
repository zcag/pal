//! Settings: the config file as managed state, one watcher that re-applies
//! it everywhere (hotkeys, palette enabling, the host's resolved values,
//! every window), the extension registry the settings window lists, the
//! commands the window calls, and the window itself.
//!
//! The file stays the source of truth: the window writes keys through
//! `ConfigFile::set_json`/`unset` and re-reads on `pal://config`, the event
//! the watcher emits after every reload (hand edits included).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use pal_core::config::secrets::{platform_store, SecretRef};
use pal_core::config::{Config, ConfigFile, Diagnostic, Error, Loaded, Watcher};
use pal_core::extensions::{Installed, Store, Update};
use pal_core::frecency::Frecency;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use crate::host::Host;
use crate::index::{palette_id, PaletteMeta};
use crate::{autostart, hotkey, index, panel, tray};

pub const WINDOW: &str = "settings";

/// One extension as the host reported it, loaded or not.
#[derive(Debug, Clone, Serialize)]
pub struct Ext {
    pub name: String,
    /// `pal.json` as read, untouched (`Manifest` in host/protocol.ts).
    pub manifest: Value,
    pub root: String,
    pub loaded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// From the code, so empty while it fails to load.
    pub palettes: Vec<PaletteMeta>,
    /// The extension directory's creation time, unix ms.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed: Option<u64>,
    /// `.pal-install.json`, for one `pal install` put there.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<pal_core::extensions::Record>,
}

pub struct Settings {
    file: ConfigFile,
    loaded: Mutex<Loaded>,
    /// When the watcher last picked a change up, unix ms.
    changed: Mutex<Option<u64>>,
    extensions: Mutex<Vec<Ext>>,
    _watch: Mutex<Option<Watcher>>,
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// `file` is the located config (`ConfigFile::locate`), passed in so the
/// caller keys the data dir on the same path.
pub fn install(app: &AppHandle, file: ConfigFile) {
    let loaded = file.load();
    for d in &loaded.diagnostics {
        eprintln!("config\t{:?}\t{}\t{}", d.level, d.path, d.message);
    }
    app.manage(Settings { file: file.clone(), loaded: Mutex::new(loaded.clone()), changed: Mutex::new(None), extensions: Mutex::new(Vec::new()), _watch: Mutex::new(None) });
    hotkey::apply(app, &loaded.config);
    tray::apply(app, &loaded.config);
    autostart::apply(app, &loaded.config);
    let handle = app.clone();
    match file.watch(move |l| on_reload(&handle, l)) {
        Ok(w) => *app.state::<Settings>()._watch.lock().unwrap() = Some(w),
        Err(e) => eprintln!("config\twatch failed\t{e}"),
    }
    if let Some(w) = app.get_webview_window(WINDOW) {
        let handle = app.clone();
        // Closing hides: the window is single-instance and comes back as it was.
        w.on_window_event(move |e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                close(&handle);
            }
        });
    }
}

/// The watcher's callback, on its thread: store, re-apply, tell everyone.
fn on_reload(app: &AppHandle, loaded: Loaded) {
    let st = app.state::<Settings>();
    let prev = std::mem::replace(&mut *st.loaded.lock().unwrap(), loaded.clone()).config;
    *st.changed.lock().unwrap() = Some(unix_ms(SystemTime::now()));
    eprintln!("config\treloaded\t{}\t{} diagnostics", loaded.path.display(), loaded.diagnostics.len());
    for d in &loaded.diagnostics {
        eprintln!("config\t{:?}\t{}\t{}", d.level, d.path, d.message);
    }
    hotkey::apply(app, &loaded.config);
    if prev.general.menu_bar_icon != loaded.config.general.menu_bar_icon || prev.general.hotkey != loaded.config.general.hotkey {
        tray::apply(app, &loaded.config);
    }
    if prev.general.launch_at_login != loaded.config.general.launch_at_login {
        autostart::apply(app, &loaded.config);
    }
    let _ = app.emit("pal://config", &loaded);
    if let Some(host) = app.try_state::<Arc<Host>>() {
        tauri::async_runtime::spawn(index::apply_config(app.clone(), host.inner().clone(), prev, loaded.config));
    }
}

/// The current config, a copy.
pub fn config(app: &AppHandle) -> Config {
    app.state::<Settings>().loaded.lock().unwrap().config.clone()
}

// ---- extension registry --------------------------------------------------

/// `extension/loaded` or `extension/error` from the host.
pub fn register(app: &AppHandle, name: &str, params: &Value, loaded: bool) {
    let root = params["root"].as_str().unwrap_or_default().to_string();
    let dir = Path::new(&root).join(name);
    let installed = std::fs::metadata(&dir).and_then(|m| m.created()).ok().map(unix_ms);
    let record = std::fs::read(dir.join(pal_core::extensions::RECORD)).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let ext = Ext {
        name: name.to_string(),
        manifest: if params["manifest"].is_object() { params["manifest"].clone() } else { json!({ "name": name, "title": name }) },
        root,
        loaded,
        error: params["message"].as_str().map(str::to_string),
        palettes: serde_json::from_value(params["palettes"].clone()).unwrap_or_default(),
        installed,
        record,
    };
    let st = app.state::<Settings>();
    let mut exts = st.extensions.lock().unwrap();
    match exts.iter_mut().find(|e| e.name == name) {
        Some(e) => *e = ext,
        None => exts.push(ext),
    }
    drop(exts);
    let _ = app.emit("pal://config", &*st.loaded.lock().unwrap());
}

/// `host/ready`: extensions the host no longer has are gone.
pub fn retain(app: &AppHandle, live: &[String]) {
    app.state::<Settings>().extensions.lock().unwrap().retain(|e| live.contains(&e.name));
}

/// An extension's resolved values, `ResolvedSettings` in host/protocol.ts:
/// `{ settings, palettes: { <name>: {...} } }`. Settings declared `kind:
/// "secret"` arrive as the secret itself, fetched from the OS store; an
/// unresolvable reference stays as written (and is logged by the core).
fn resolved(config: &Config, name: &str, manifest: &Value) -> Value {
    let store = platform_store();
    let settings = config.extension_settings_resolved(name, &manifest["settings"], &*store);
    let mut palettes = serde_json::Map::new();
    if let Some(declared) = manifest["palettes"].as_object() {
        for (palette, p) in declared {
            let id = palette_id(&pal_core::index::Source::new(name, palette));
            let table = config.palette_settings_resolved(&id, &p["settings"], &*store);
            palettes.insert(palette.clone(), serde_json::to_value(table).unwrap_or(Value::Null));
        }
    }
    json!({ "settings": serde_json::to_value(settings).unwrap_or(Value::Null), "palettes": palettes })
}

/// `core/settings.get {extension, manifest}`: the host asks before it
/// imports an extension, so `settings.get()` at the module's top level
/// already has the values (the registry only learns of the extension once
/// the import is done).
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "get" => {
            let name = params["extension"].as_str().ok_or("settings.get: no extension")?;
            Ok(resolved(&config(app), name, &params["manifest"]))
        }
        _ => Err(format!("unknown settings function {func}")),
    }
}

/// Extensions whose resolved values differ between the two configs.
pub fn changed_extensions(app: &AppHandle, prev: &Config, next: &Config) -> Vec<String> {
    let st = app.state::<Settings>();
    let exts = st.extensions.lock().unwrap();
    exts.iter().filter(|e| resolved(prev, &e.name, &e.manifest) != resolved(next, &e.name, &e.manifest)).map(|e| e.name.clone()).collect()
}

/// `settings/changed` to the host for the named extensions.
pub async fn push(app: &AppHandle, host: &Arc<Host>, names: &[String]) {
    if names.is_empty() {
        return;
    }
    let payload = {
        let st = app.state::<Settings>();
        let config = &st.loaded.lock().unwrap().config;
        let exts = st.extensions.lock().unwrap();
        let map: serde_json::Map<String, Value> = exts.iter().filter(|e| names.contains(&e.name)).map(|e| (e.name.clone(), resolved(config, &e.name, &e.manifest))).collect();
        json!({ "extensions": map })
    };
    if let Err(e) = host.notify("settings/changed", payload).await {
        eprintln!("settings\tpush failed\t{e}");
    }
}

// ---- window --------------------------------------------------------------

pub fn open(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    panel::hide(app);
    if !w.is_visible().unwrap_or(false) {
        let _ = w.center();
    }
    let _ = w.show();
    let _ = w.set_focus();
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.hide();
    }
}

// ---- commands ------------------------------------------------------------

#[derive(Serialize)]
pub struct View {
    config: Config,
    diagnostics: Vec<Diagnostic>,
    path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    changed: Option<u64>,
    version: String,
    extensions: Vec<Ext>,
}

#[tauri::command]
pub fn settings_get(app: AppHandle, st: State<'_, Settings>) -> View {
    let l = st.loaded.lock().unwrap();
    View {
        config: l.config.clone(),
        diagnostics: l.diagnostics.clone(),
        path: l.path.clone(),
        changed: *st.changed.lock().unwrap(),
        version: app.package_info().version.to_string(),
        extensions: st.extensions.lock().unwrap().clone(),
    }
}

/// One retry on `Contended`: a hand save that landed while we held the
/// text is re-read and the key applied over it.
fn retrying(f: impl Fn() -> Result<(), Error>) -> Result<(), String> {
    match f() {
        Err(Error::Contended(_)) => f(),
        r => r,
    }
    .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn settings_set(st: State<'_, Settings>, key: String, value: Value) -> Result<(), String> {
    retrying(|| st.file.set_json(&key, value.clone()))
}

#[tauri::command(async)]
pub fn settings_unset(st: State<'_, Settings>, key: String) -> Result<(), String> {
    retrying(|| st.file.unset(&key))
}

/// Puts `value` in the OS store under `key` and returns the reference the
/// file should hold (`keychain:<key>`). The value never reaches the file.
#[tauri::command(async)]
pub fn settings_set_secret(key: String, value: String) -> Result<String, String> {
    let key = SecretRef::parse(&key).map_or(key.as_str(), |r| r.key).to_string();
    platform_store().set(&key, &value).map_err(|e| e.to_string())?;
    Ok(format!("keychain:{key}"))
}

fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    std::process::Command::new(cmd).args(args).spawn().map(drop).map_err(|e| format!("{cmd} failed: {e}"))
}

/// The file in the default text editor. Created from the template first
/// when it does not exist yet, so the editor opens a file, not a prompt.
#[tauri::command(async)]
pub fn settings_open_file(st: State<'_, Settings>) -> Result<(), String> {
    if !st.file.path().exists() {
        st.file.edit(|_| Ok(())).map_err(|e| e.to_string())?;
    }
    let path = st.file.path().to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        run("open", &["-t", &path])
    } else {
        run("xdg-open", &[&path])
    }
}

#[tauri::command(async)]
pub fn settings_reveal_file(st: State<'_, Settings>) -> Result<(), String> {
    let path = st.file.path().to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        run("open", &["-R", &path])
    } else {
        let dir = st.file.path().parent().unwrap_or(Path::new(".")).to_string_lossy().into_owned();
        run("xdg-open", &[&dir])
    }
}

#[tauri::command(async)]
pub fn settings_reset_frecency(app: AppHandle, frecency: State<'_, Mutex<Frecency>>) -> Result<(), String> {
    let mut f = frecency.lock().unwrap();
    f.clear();
    f.flush().map_err(|e| e.to_string())?;
    let _ = app.emit("pal://index", ());
    Ok(())
}

#[tauri::command]
pub async fn settings_restart_host(host: State<'_, Arc<Host>>) -> Result<(), String> {
    host.restart().await;
    Ok(())
}

// ---- the extension store ---------------------------------------------------
// `pal_core::extensions` does the work off the runtime; the host is restarted
// after every change to the store, since its watcher only covers a root that
// existed when it started and never unloads a removed extension.

/// The store next to the config file the window is a front for.
fn store(st: &Settings) -> Store {
    Store::at(st.file.path().parent().unwrap_or(Path::new(".")).join("extensions"))
}

async fn in_store<T: Send + 'static>(st: &Settings, f: impl FnOnce(Store) -> pal_core::extensions::Result<T> + Send + 'static) -> Result<T, String> {
    let store = store(st);
    tauri::async_runtime::spawn_blocking(move || f(store)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn extensions_install(st: State<'_, Settings>, host: State<'_, Arc<Host>>, spec: String) -> Result<Installed, String> {
    let bun = crate::host::bun();
    let r = in_store(&st, move |s| s.install(&spec, Some(&bun))).await?;
    eprintln!("extensions	installed	{} {}", r.name, r.version);
    host.restart().await;
    Ok(r)
}

#[tauri::command]
pub async fn extensions_update(st: State<'_, Settings>, host: State<'_, Arc<Host>>, name: String) -> Result<Installed, String> {
    let bun = crate::host::bun();
    let r = in_store(&st, move |s| s.update(&name, Some(&bun))).await?;
    eprintln!("extensions	updated	{} {}", r.name, r.version);
    host.restart().await;
    Ok(r)
}

#[tauri::command]
pub async fn extensions_remove(st: State<'_, Settings>, host: State<'_, Arc<Host>>, name: String) -> Result<(), String> {
    in_store(&st, move |s| s.remove(&name)).await?;
    eprintln!("extensions	removed");
    host.restart().await;
    Ok(())
}

/// GitHub-installed extensions whose branch moved; network, so up to 10 s
/// per extension, and an extension whose check fails is simply not listed.
#[tauri::command]
pub async fn extensions_check_updates(st: State<'_, Settings>) -> Result<Vec<Update>, String> {
    in_store(&st, |s| s.check_updates()).await
}

#[tauri::command]
pub fn settings_open(app: AppHandle) {
    open(&app);
}

#[tauri::command]
pub fn settings_close(app: AppHandle) {
    close(&app);
}
