//! Settings: the config file as managed state, one watcher that re-applies
//! it everywhere (hotkeys, palette enabling, the host's resolved values,
//! every window), the extension registry the settings window lists, the
//! commands the window calls, and the window itself.
//!
//! The file stays the source of truth: the window writes keys through
//! `ConfigFile::set_json`/`unset` and re-reads on [`events::CONFIG`], the
//! event the watcher emits after every reload (hand edits included), and on
//! [`events::HOST`] for the extension registry (an extension loaded, failed,
//! or the host came up).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use pal_core::config::secrets::{platform_store, SecretRef};
use pal_core::config::{Config, ConfigFile, Diagnostic, Error, Loaded, Watcher};
use pal_core::extensions::{Installed, Store, Update};
use pal_core::frecency::Frecency;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::host::Host;
use crate::index::{palette_id, PaletteMeta};
use crate::{autostart, crash, events, hotkey, index, lock, panel, permissions, tray};

pub const WINDOW: &str = "settings";
/// What the window-state plugin keeps for the settings window: where it
/// was and how big, restored on the next launch (lib.rs registers the
/// plugin for this window only).
pub const STATE: StateFlags = StateFlags::SIZE.union(StateFlags::POSITION);

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
    /// What the host found wrong with the manifest against the code (a
    /// `kind` that disagrees, a palette declared but not exported).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
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
    // May exit: a release build not started by its agent hands over here.
    autostart::install(app, &loaded.config);
    let handle = app.clone();
    match file.watch(move |l| on_reload(&handle, l)) {
        Ok(w) => *lock(&app.state::<Settings>()._watch) = Some(w),
        Err(e) => eprintln!("config\twatch failed\t{e}"),
    }
    if let Err(e) = create(app) {
        eprintln!("settings\twindow failed\t{e}");
    }
}

/// The settings window, hidden until `open`. Shaped like a macOS
/// preferences window: on macOS the title bar is ours (overlay style, no
/// title, the traffic lights moved down into the page's 52px toolbar band)
/// and the OS's sidebar vibrancy shows through the page's glass background;
/// on Linux a plain decorated window with the same toolbar. 720 by 520 by
/// default, resizable down to 640 by 480; the window-state plugin restores
/// the last size and position on creation, so this only centres a window
/// that has never been placed.
fn create(app: &AppHandle) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html?settings".into()))
        .title("pal Settings")
        .inner_size(720.0, 520.0)
        .min_inner_size(640.0, 480.0)
        .center()
        .visible(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        // The close button's top-left: 13px in, and 20px down so the 12px lights sit mid-band.
        .traffic_light_position(tauri::LogicalPosition::new(13.0, 20.0))
        .transparent(true);
    let w = builder.build()?;
    #[cfg(target_os = "macos")]
    if let Err(e) = window_vibrancy::apply_vibrancy(&w, window_vibrancy::NSVisualEffectMaterial::Sidebar, None, None) {
        eprintln!("settings\tvibrancy failed\t{e}");
    }
    let handle = app.clone();
    // Closing hides: the window is single-instance and comes back as it was.
    w.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            close(&handle);
        }
    });
    Ok(())
}

/// The watcher's callback, on its thread: store, re-apply, tell everyone.
fn on_reload(app: &AppHandle, loaded: Loaded) {
    let st = app.state::<Settings>();
    let prev = std::mem::replace(&mut *lock(&st.loaded), loaded.clone()).config;
    *lock(&st.changed) = Some(unix_ms(SystemTime::now()));
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
    crate::bar::apply_config(app, &prev, &loaded.config);
    events::emit(app, events::CONFIG, &loaded);
    if let Some(host) = app.try_state::<Arc<Host>>() {
        tauri::async_runtime::spawn(index::apply_config(app.clone(), host.inner().clone(), prev, loaded.config));
    }
}

/// The current config, a copy.
pub fn config(app: &AppHandle) -> Config {
    lock(&app.state::<Settings>().loaded).config.clone()
}

/// The root's per-source caps (`[general] root_caps`), without copying the config: read per keystroke.
pub fn root_caps(app: &AppHandle) -> pal_core::index::Caps {
    lock(&app.state::<Settings>().loaded).config.general.root_caps
}

/// The config file itself (its path, profile and data dir).
pub fn file(app: &AppHandle) -> ConfigFile {
    app.state::<Settings>().file.clone()
}

/// Every extension the host reported, loaded or not, a copy.
pub fn extensions(app: &AppHandle) -> Vec<Ext> {
    lock(&app.state::<Settings>().extensions).clone()
}

// ---- extension registry --------------------------------------------------

/// `extension/loaded` or `extension/error` from the host. No event of its
/// own: the host loop emits [`events::HOST`] with the notification right
/// after this returns, and the window re-reads on that (one `Loaded`
/// serialisation per extension at startup was the alternative).
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
        warnings: serde_json::from_value(params["warnings"].clone()).unwrap_or_default(),
        installed,
        record,
    };
    let st = app.state::<Settings>();
    let mut exts = lock(&st.extensions);
    match exts.iter_mut().find(|e| e.name == name) {
        Some(e) => *e = ext,
        None => exts.push(ext),
    }
}

/// `host/ready`: extensions the host no longer has are gone.
pub fn retain(app: &AppHandle, live: &[String]) {
    lock(&app.state::<Settings>().extensions).retain(|e| live.contains(&e.name));
}

/// `extension/removed`: its directory is gone.
pub fn forget(app: &AppHandle, name: &str) {
    lock(&app.state::<Settings>().extensions).retain(|e| e.name != name);
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

/// `(name, manifest)` of every registered extension: what `resolved` needs,
/// copied out so the store (a `security` subprocess per secret on macOS) is
/// never consulted under a lock the window's `settings_get` waits on.
fn manifests(app: &AppHandle) -> Vec<(String, Value)> {
    lock(&app.state::<Settings>().extensions).iter().map(|e| (e.name.clone(), e.manifest.clone())).collect()
}

/// Extensions whose resolved values differ between the two configs.
pub fn changed_extensions(app: &AppHandle, prev: &Config, next: &Config) -> Vec<String> {
    manifests(app).into_iter().filter(|(name, m)| resolved(prev, name, m) != resolved(next, name, m)).map(|(name, _)| name).collect()
}

/// `settings/changed` to the host for the named extensions.
pub async fn push(app: &AppHandle, host: &Arc<Host>, names: &[String]) {
    if names.is_empty() {
        return;
    }
    let config = config(app);
    let map: serde_json::Map<String, Value> = manifests(app).into_iter().filter(|(name, _)| names.contains(name)).map(|(name, m)| { let r = resolved(&config, &name, &m); (name, r) }).collect();
    let payload = json!({ "extensions": map });
    if let Err(e) = host.notify("settings/changed", payload).await {
        eprintln!("settings\tpush failed\t{e}");
    }
}

// ---- window --------------------------------------------------------------

pub fn open(app: &AppHandle) {
    open_page(app, None);
}

/// `open`, on `page` (`overview`, `general`, `palettes`, `extensions`,
/// `bar`, `about`) when one is named: the page switches on
/// [`events::SETTINGS`].
pub fn open_page(app: &AppHandle, page: Option<&str>) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    panel::hide(app);
    if let Some(page) = page {
        events::emit_to(app, WINDOW, events::SETTINGS, json!({ "page": page }));
    }
    let _ = w.show();
    let _ = w.set_focus();
    // The Permissions group shows a live dot: a grant made while the window is up is seen.
    permissions::watch(app);
}

/// Hides, and writes the window's size and position down: the plugin only
/// saves on exit by itself, and a hidden window is where pal usually is
/// when it is killed.
pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.hide();
        let _ = app.save_window_state(STATE);
    }
}

// ---- commands ------------------------------------------------------------

/// One bar item as the registry knows it (`bar::Entry`), for the Bar page:
/// the manifest's say and the live state, next to the `[bar.items]` config
/// the page reads from `config`.
#[derive(Serialize)]
pub struct BarItemView {
    /// `extension/id`, the `[bar.items."<key>"]` key.
    key: String,
    extension: String,
    id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    /// The code has a `render` for it; `false` is declared only, never drawn.
    source: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_every: Option<f64>,
    /// Unix seconds of the last successful render; `None` while it never has.
    #[serde(skip_serializing_if = "Option::is_none")]
    rendered_at: Option<u64>,
    /// The last render failed or timed out: drawn muted.
    stale: bool,
    /// The last rendered state, what the strip shows.
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<BarItemState>,
}

#[derive(Serialize)]
pub struct BarItemState {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    badge: Option<u64>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    dot: bool,
    urgent: bool,
}

#[derive(Serialize)]
pub struct BarView {
    /// sketchybar answered its last probe: where `auto` draws.
    sketchybar: bool,
    items: Vec<BarItemView>,
}

fn bar_view(app: &AppHandle) -> BarView {
    let items = if app.try_state::<crate::bar::Bar>().is_some() { crate::bar::snapshot(app) } else { Vec::new() };
    BarView {
        sketchybar: app.try_state::<crate::bar::Bar>().is_some_and(|_| crate::bar::sketchybar_alive(app)),
        items: items
            .into_iter()
            .map(|(key, e)| {
                let (extension, id) = crate::bar::split_key(&key).map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or_default();
                BarItemView {
                    state: e.last.as_ref().map(|i| BarItemState { title: i.title.clone(), hidden: i.hidden, badge: i.count(), dot: i.dot(), urgent: i.urgent }),
                    key,
                    extension,
                    id,
                    title: e.manifest.title.clone(),
                    description: e.manifest.description.clone(),
                    source: e.manifest.source,
                    refresh_every: e.manifest.refresh.as_ref().and_then(|r| r.every),
                    rendered_at: e.rendered_unix,
                    stale: e.stale,
                }
            })
            .collect(),
    }
}

#[derive(Serialize)]
pub struct View {
    config: Config,
    diagnostics: Vec<Diagnostic>,
    path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    changed: Option<u64>,
    version: String,
    extensions: Vec<Ext>,
    /// The user store's directory (`Store::locate`): an extension whose
    /// `root` is this one can be updated and removed from the window.
    store: PathBuf,
    /// How the root hotkey's last registration went (hotkey.rs).
    hotkey: hotkey::Outcome,
    /// What the OS lets pal do (permissions.rs).
    permissions: permissions::Status,
    /// The bar registry: every declared item and its live state (bar/mod.rs).
    bar: BarView,
}

#[tauri::command]
pub fn settings_get(app: AppHandle, st: State<'_, Settings>) -> View {
    let l = lock(&st.loaded);
    View {
        config: l.config.clone(),
        diagnostics: l.diagnostics.clone(),
        path: l.path.clone(),
        changed: *lock(&st.changed),
        version: app.package_info().version.to_string(),
        extensions: lock(&st.extensions).clone(),
        store: Store::locate().dir().to_path_buf(),
        hotkey: hotkey::outcome(&app),
        permissions: permissions::status(),
        bar: bar_view(&app),
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
    retrying(|| st.file.set_json(&key, value.clone())).map_err(|e| format!("{key}: {e}"))
}

#[tauri::command(async)]
pub fn settings_unset(st: State<'_, Settings>, key: String) -> Result<(), String> {
    retrying(|| st.file.unset(&key)).map_err(|e| format!("{key}: {e}"))
}

/// Puts `value` in the OS store under `key` and returns the reference the
/// file should hold (`keychain:<key>`). The value never reaches the file.
#[tauri::command(async)]
pub fn settings_set_secret(key: String, value: String) -> Result<String, String> {
    let key = SecretRef::parse(&key).map_or(key.as_str(), |r| r.key).to_string();
    platform_store().set(&key, &value).map_err(|e| format!("{key}: could not store in the keychain: {e}"))?;
    Ok(format!("keychain:{key}"))
}

/// Spawns `cmd` and reaps it off this thread: `open` returns at once,
/// `xdg-open` can linger as long as the editor, and a child nobody waits on
/// is a zombie until we exit. The exit status is not ours to judge (`open`
/// reports a missing editor as 1 after the fact).
fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    let mut child = std::process::Command::new(cmd).args(args).spawn().map_err(|e| format!("{cmd} failed: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Which file a command means: the config, or one the crash scan found
/// (`crash.rs`); the page names them, the paths stay here.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Which {
    #[default]
    Config,
    Crash,
    Panic,
}

/// The path `which` stands for, when there is one this run.
fn path_of(app: &AppHandle, st: &Settings, which: Which) -> Result<PathBuf, String> {
    match which {
        Which::Config => {
            // Created from the template first when it does not exist yet,
            // so the editor opens a file, not a prompt.
            if !st.file.path().exists() {
                st.file.edit(|_| Ok(())).map_err(|e| e.to_string())?;
            }
            Ok(st.file.path().to_path_buf())
        }
        Which::Crash => crash::found(app).report.and_then(|r| r.path).ok_or_else(|| "no crash report".to_string()),
        Which::Panic => crash::found(app).panic.map(|p| p.path).ok_or_else(|| "no panic file".to_string()),
    }
}

/// The file in its default app: the config in the text editor, a crash
/// report in Console, the panic file in the editor.
#[tauri::command(async)]
pub fn settings_open_file(app: AppHandle, st: State<'_, Settings>, file: Option<Which>) -> Result<(), String> {
    let which = file.unwrap_or_default();
    let path = path_of(&app, &st, which)?.to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        if which == Which::Crash { run("open", &[&path]) } else { run("open", &["-t", &path]) }
    } else {
        run("xdg-open", &[&path])
    }
}

#[tauri::command(async)]
pub fn settings_reveal_file(app: AppHandle, st: State<'_, Settings>, file: Option<Which>) -> Result<(), String> {
    let path = path_of(&app, &st, file.unwrap_or_default())?;
    let path_s = path.to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        run("open", &["-R", &path_s])
    } else {
        let dir = path.parent().unwrap_or(Path::new(".")).to_string_lossy().into_owned();
        run("xdg-open", &[&dir])
    }
}

#[tauri::command(async)]
pub fn settings_reset_frecency(app: AppHandle, frecency: State<'_, Mutex<Frecency>>) -> Result<(), String> {
    let mut f = lock(&frecency);
    f.clear();
    f.flush().map_err(|e| format!("frecency: {e}"))?;
    events::emit(&app, events::INDEX, ());
    Ok(())
}

#[tauri::command]
pub async fn settings_restart_host(host: State<'_, Arc<Host>>) -> Result<(), String> {
    host.restart().await;
    Ok(())
}

// ---- the extension store ---------------------------------------------------
// `pal_core::extensions` does the work off the runtime, in the one store
// (`Store::locate`, under the data dir: not tied to the config file); the host is restarted
// after every change to the store. Its watcher does see the change (a new
// root, a removed extension), but the index only drops a gone extension's
// sources and cache on `host/ready`, and `bun install` under a watched root
// would trigger a reload per file.

async fn in_store<T: Send + 'static>(f: impl FnOnce(Store) -> pal_core::extensions::Result<T> + Send + 'static) -> Result<T, String> {
    let store = Store::locate();
    tauri::async_runtime::spawn_blocking(move || f(store)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn extensions_install(host: State<'_, Arc<Host>>, spec: String) -> Result<Installed, String> {
    let bun = crate::host::bun();
    let r = in_store(move |s| s.install(&spec, Some(&bun))).await?;
    eprintln!("extensions	installed	{} {}", r.name, r.version);
    host.restart().await;
    Ok(r)
}

#[tauri::command]
pub async fn extensions_update(host: State<'_, Arc<Host>>, name: String) -> Result<Installed, String> {
    let bun = crate::host::bun();
    let r = in_store(move |s| s.update(&name, Some(&bun))).await?;
    eprintln!("extensions	updated	{} {}", r.name, r.version);
    host.restart().await;
    Ok(r)
}

#[tauri::command]
pub async fn extensions_remove(host: State<'_, Arc<Host>>, name: String) -> Result<(), String> {
    in_store(move |s| s.remove(&name)).await?;
    eprintln!("extensions	removed");
    host.restart().await;
    Ok(())
}

/// GitHub-installed extensions whose branch moved; network, so up to 10 s
/// per extension, and an extension whose check fails is simply not listed.
#[tauri::command]
pub async fn extensions_check_updates() -> Result<Vec<Update>, String> {
    in_store(|s| s.check_updates()).await
}

// ---- about -----------------------------------------------------------------

/// Where the About page sends people, and what the last run left behind
/// (`crash.rs`: the OS report and the panic file, when there are any). The
/// version and the config path are in `View` already.
#[derive(Serialize)]
pub struct About {
    docs: &'static str,
    repo: &'static str,
    #[serde(flatten)]
    found: crash::Found,
}

#[tauri::command]
pub fn settings_about(app: AppHandle) -> About {
    About { docs: crate::welcome::EXTENSIONS_GUIDE, repo: crate::welcome::REPO, found: crash::found(&app) }
}

/// A link on the page, in the browser. The webview has no handler for
/// `target="_blank"` (nothing happens), so the page asks. Web URLs only:
/// `open` would happily run a `file:` too.
#[tauri::command(async)]
pub fn settings_open_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(format!("not a web link: {url}"));
    }
    if cfg!(target_os = "macos") {
        run("open", &[&url])
    } else {
        run("xdg-open", &[&url])
    }
}

#[tauri::command]
pub fn settings_open(app: AppHandle) {
    open(&app);
}

#[tauri::command]
pub fn settings_close(app: AppHandle) {
    close(&app);
}
