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
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pal_core::config::secrets::{platform_store, SecretRef};
use pal_core::config::{instance, Config, ConfigFile, Diagnostic, Error, Loaded, Watcher};
use pal_core::extensions::{Installed, Store, Update};
use pal_core::frecency::Frecency;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, LogicalSize, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::host::Host;
use crate::index::{palette_id, PaletteMeta};
use crate::updater::UpdateInfo;
use crate::{autostart, crash, events, hotkey, index, lock, panel, permissions, tray};

pub const WINDOW: &str = "settings";
/// What the window-state plugin keeps for the settings window: where it
/// was and how big, restored on the next launch (lib.rs registers the
/// plugin for this window only).
pub const STATE: StateFlags = StateFlags::SIZE.union(StateFlags::POSITION);
/// The window's default size, logical, and the least the pages lay out
/// at (`tokens.css` says the same).
const SIZE: (f64, f64) = (960.0, 640.0);
const MIN_SIZE: (f64, f64) = (800.0, 560.0);

/// One instance of an extension as the host reported it, loaded or not:
/// the default (`key == name`) or a configured copy of a `multi` one
/// (`gmail@work`, docs/design/instances.md).
#[derive(Debug, Clone, Serialize)]
pub struct Ext {
    /// The instance key: what the host calls `extension`, the identity in
    /// every table, file and link.
    pub key: String,
    /// The manifest name, the directory: `gmail` for `gmail@work`.
    pub name: String,
    /// What the host resolved for the instance (`extension/loaded`).
    pub instance: InstanceInfo,
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

/// `instance` of `extension/loaded` (host/src/instances.ts
/// `loadedInstance`): the key, the title as configured (the default has
/// none until named), the mark of a non-default instance, and which one
/// is the default.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub badge: Option<String>,
    #[serde(default)]
    pub is_default: bool,
}

impl InstanceInfo {
    /// What an announcement without one means: the extension as its own default.
    fn default_for(key: &str) -> Self {
        Self { key: key.to_string(), title: None, tint: None, badge: None, is_default: instance::name_of(key) == key }
    }

    /// The instance's name for a label ("Gmail (Work)", a bar tooltip's
    /// suffix): the title of a non-default instance, or the default's own
    /// once it is named and another instance of the extension is loaded
    /// (`alone` says none is); nothing for a lone or unnamed default, so
    /// the one instance that works keeps reading as it did.
    pub fn label(&self, alone: bool) -> Option<&str> {
        self.title.as_deref().filter(|_| !self.is_default || !alone)
    }
}

pub struct Settings {
    file: ConfigFile,
    loaded: Mutex<Loaded>,
    /// When the watcher last picked a change up, unix ms.
    changed: Mutex<Option<u64>>,
    extensions: Mutex<Vec<Ext>>,
    /// The update checks' last results, for the Overview.
    checks: Mutex<Checks>,
    _watch: Mutex<Option<Watcher>>,
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// `file` is the located config (`ConfigFile::locate`), passed in so the
/// caller keys the data dir on the same path. The settings window is not
/// built here: its page (a WebContent process, ~80 MB) is only paid for on
/// the first `open`.
pub fn install(app: &AppHandle, file: ConfigFile) {
    let loaded = file.load();
    for d in &loaded.diagnostics {
        eprintln!("config\t{:?}\t{}\t{}", d.level, d.path, d.message);
    }
    app.manage(Settings { file: file.clone(), loaded: Mutex::new(loaded.clone()), changed: Mutex::new(None), extensions: Mutex::new(Vec::new()), checks: Mutex::new(Checks::default()), _watch: Mutex::new(None) });
    hotkey::apply(app, &loaded.config);
    tray::apply(app, &loaded.config);
    // May exit: a release build not started by its agent hands over here.
    autostart::install(app, &loaded.config);
    let handle = app.clone();
    match file.watch(move |l| on_reload(&handle, l)) {
        Ok(w) => *lock(&app.state::<Settings>()._watch) = Some(w),
        Err(e) => eprintln!("config\twatch failed\t{e}"),
    }
}

/// The settings window, built on the first `open` and hidden after that
/// (`close`), on `page` when one is named (the URL carries it: the page
/// reads `?page=` at load, an event would land before its listener).
/// Shaped like a macOS preferences window: on macOS the title bar is ours
/// (overlay style, no title, the traffic lights moved down into the page's
/// 52px toolbar band) and the OS's sidebar vibrancy shows through the
/// page's glass background; on Linux a plain decorated window with the
/// same toolbar. [`SIZE`] by default, resizable down to [`MIN_SIZE`]; the
/// window-state plugin restores the last size and position while this
/// builds, so `center` only places a window that has never been placed.
/// A restored size under the minimum is the default from before the
/// window grew (720 by 520 until 2026-09-16), not a choice: it gets the
/// new default once, and the next hide saves that.
fn create(app: &AppHandle, page: Option<&str>, anchor: Option<&str>) -> tauri::Result<WebviewWindow> {
    let mut url = "index.html?settings".to_string();
    if let Some(p) = page {
        url.push_str(&format!("&page={p}"));
    }
    if let Some(a) = anchor {
        url.push_str(&format!("&anchor={}", url::form_urlencoded::byte_serialize(a.as_bytes()).collect::<String>()));
    }
    let builder = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App(url.into()))
        .title("pal Settings")
        .inner_size(SIZE.0, SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
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
    if let (Some((pw, ph)), Ok(scale)) = (saved_size(app), w.scale_factor()) {
        let (lw, lh) = (f64::from(pw) / scale, f64::from(ph) / scale);
        if lw < MIN_SIZE.0 || lh < MIN_SIZE.1 {
            eprintln!("settings\twindow\tsaved {lw:.0}x{lh:.0}, under the minimum: the default");
            // Queued behind the plugin's own resize (tao applies both on the next run-loop turn), so this one lands.
            let _ = w.set_size(LogicalSize::new(SIZE.0, SIZE.1));
            let _ = w.center();
        }
    }
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
    Ok(w)
}

/// The size the window-state plugin restores, physical, from its file
/// (`AppHandleExt::filename` under the app config dir). Read rather than
/// asked of the window: the restore's resize is applied by tao on the next
/// run-loop turn, so `inner_size` right after `build` still says the
/// builder's.
fn saved_size(app: &AppHandle) -> Option<(u32, u32)> {
    let path = app.path().app_config_dir().ok()?.join(app.filename());
    let v: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    Some((v[WINDOW]["width"].as_u64()? as u32, v[WINDOW]["height"].as_u64()? as u32))
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
    crate::states::apply_config(app, &prev, &loaded.config);
    crate::bar::apply_config(app, &prev, &loaded.config);
    crate::sidebar::apply_config(app, &prev, &loaded.config);
    crate::expansion::apply_config(app, &prev, &loaded.config);
    crate::keycast::apply_config(app, &prev, &loaded.config);
    crate::reserve::apply_config(app, &prev, &loaded.config);
    crate::mouse::apply_config(app, &prev, &loaded.config);
    crate::theme::apply_config(app, &prev, &loaded.config);
    crate::compact::apply_config(app, &prev, &loaded.config);
    events::emit(app, events::CONFIG, &loaded);
    if let Some(host) = app.try_state::<Arc<Host>>() {
        tauri::async_runtime::spawn(index::apply_config(app.clone(), host.inner().clone(), prev, loaded.config));
    }
}

/// The current config, a copy.
pub fn config(app: &AppHandle) -> Config {
    lock(&app.state::<Settings>().loaded).config.clone()
}

/// `pal.json` of `key` as the host reported it, loaded or not (deeplink.rs
/// reads `links` for the card's text): the instance's, else the manifest
/// of its name (one directory serves every instance).
pub fn manifest_of(app: &AppHandle, key: &str) -> Option<Value> {
    let st = app.state::<Settings>();
    let exts = lock(&st.extensions);
    exts.iter().find(|e| e.key == key).or_else(|| exts.iter().find(|e| e.name == instance::name_of(key))).map(|e| e.manifest.clone())
}

/// The root's per-source caps (`[general] root_caps`), without copying the config: read per keystroke.
pub fn root_caps(app: &AppHandle) -> pal_core::index::Caps {
    lock(&app.state::<Settings>().loaded).config.general.root_caps
}

/// The root's ranking knobs (`[general] root_first`, `root_first_step`, `root_cut`), read per keystroke like the caps.
pub fn root_ranking(app: &AppHandle) -> crate::index::Ranking {
    let st = app.state::<Settings>();
    let loaded = lock(&st.loaded);
    let g = &loaded.config.general;
    crate::index::Ranking { first: g.root_first.iter().filter_map(|k| k.split_once('/').map(|(e, p)| pal_core::index::Source::new(e, p))).collect(), step: g.root_first_step as f32, cut: g.root_cut }
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
pub fn register(app: &AppHandle, key: &str, params: &Value, loaded: bool) {
    let root = params["root"].as_str().unwrap_or_default().to_string();
    // `key` is the instance key (`gmail@work`); the directory is the manifest name's (`params.name`).
    let name = params["name"].as_str().unwrap_or_else(|| instance::name_of(key)).to_string();
    let dir = Path::new(&root).join(&name);
    let installed = std::fs::metadata(&dir).and_then(|m| m.created()).ok().map(unix_ms);
    let record = std::fs::read(dir.join(pal_core::extensions::RECORD)).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let ext = Ext {
        key: key.to_string(),
        instance: serde_json::from_value(params["instance"].clone()).unwrap_or_else(|_| InstanceInfo::default_for(key)),
        manifest: if params["manifest"].is_object() { params["manifest"].clone() } else { json!({ "name": name, "title": name }) },
        name,
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
    match exts.iter_mut().find(|e| e.key == key) {
        Some(e) => *e = ext,
        None => exts.push(ext),
    }
}

/// `host/ready`: instances the host no longer has are gone (`known`
/// lists keys).
pub fn retain(app: &AppHandle, live: &[String]) {
    lock(&app.state::<Settings>().extensions).retain(|e| live.contains(&e.key));
}

/// `extension/removed`: its directory is gone, or the instance was
/// stopped (its `[instances.<key>]` removed or parked).
pub fn forget(app: &AppHandle, key: &str) {
    lock(&app.state::<Settings>().extensions).retain(|e| e.key != key);
}

/// The label of the instance `key` for the bar and the panel (`InstanceInfo::label`), from the registry and the config's count of enabled instances.
pub fn instance_label(app: &AppHandle, key: &str) -> Option<String> {
    let alone = config(app).instance_keys(instance::name_of(key), true).len() < 2;
    lock(&app.state::<Settings>().extensions).iter().find(|e| e.key == key).and_then(|e| e.instance.label(alone).map(str::to_string))
}

/// An extension's resolved values, `ResolvedSettings` in host/protocol.ts:
/// `{ settings, palettes: { <name>: {...} } }`. Settings declared `kind:
/// "secret"` arrive as the secret itself, fetched from the OS store; an
/// unresolvable reference stays as written (and is logged by the core).
/// `key` is the extension's name or an instance key (`gmail@work`), whose
/// tables inherit the default's (`Config::extension_settings`).
fn resolved(config: &Config, key: &str, manifest: &Value) -> Value {
    let store = platform_store();
    let settings = config.extension_settings_resolved(key, &manifest["settings"], &*store);
    let mut palettes = serde_json::Map::new();
    if let Some(declared) = manifest["palettes"].as_object() {
        for (palette, p) in declared {
            let table = config.palette_settings_resolved(key, palette, &p["settings"], &*store);
            palettes.insert(palette.clone(), serde_json::to_value(table).unwrap_or(Value::Null));
        }
    }
    json!({ "settings": serde_json::to_value(settings).unwrap_or(Value::Null), "palettes": palettes })
}

/// `core/instances.get { extension }`: every instance the file describes
/// for the extension, `[{ key, title?, tint?, badge?, enabled }]`, the
/// default first (`Config::instances_of`), disabled ones included so the
/// host can log what it skips. The host resolves the defaults (a title
/// from the suffix, a tint from it, a badge from the title) and announces
/// them in `extension/loaded`.
pub fn instances(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "get" => {
            let name = params["extension"].as_str().ok_or("instances.get: no extension")?;
            let list: Vec<Value> = config(app).instances_of(name).into_iter().map(|(key, i)| json!({ "key": key, "title": i.title, "tint": i.tint, "badge": i.badge, "enabled": i.enabled })).collect();
            Ok(Value::Array(list))
        }
        _ => Err(format!("unknown instances function {func}")),
    }
}

/// `core/settings.get {extension, manifest}`: the host asks before it
/// imports an extension, so `settings.get()` at the module's top level
/// already has the values (the registry only learns of the extension once
/// the import is done). `core/settings.set {extension, palette?, values:
/// {id: value}}`: an extension writes one or more of its declared settings
/// in one file edit (`plan_write` per id, then `write_settings`).
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "get" => {
            let name = params["extension"].as_str().ok_or("settings.get: no extension")?;
            Ok(resolved(&config(app), name, &params["manifest"]))
        }
        "set" => {
            let name = params["extension"].as_str().ok_or("settings.set: no extension")?;
            let values = params["values"].as_object().filter(|v| !v.is_empty()).ok_or("settings.set: no values")?;
            let manifest = manifest_of(app, name).ok_or_else(|| format!("settings.set: no extension {name}"))?;
            let writes = values.iter().map(|(id, v)| plan_write(&manifest, name, params["palette"].as_str(), id, v.clone())).collect::<Result<Vec<_>, _>>().map_err(|e| format!("settings.set: {e}"))?;
            write_settings(app, name, &manifest, writes)
        }
        _ => Err(format!("unknown settings function {func}")),
    }
}

/// One declared setting's write, as `plan_write` decides it from the
/// manifest: the file key, and the value to set or `None` to unset.
#[derive(Debug, Clone, PartialEq)]
pub struct SettingWrite {
    /// The dotted config key (`extensions.hue.bridge`, `palettes.emoji.settings.columns`).
    pub key: String,
    /// `None`: unset (a `null`, or the manifest's default).
    pub value: Option<Value>,
    /// A `secret` whose plain value goes to the OS store under this key first; the file gets `keychain:<key>`.
    pub secret_key: Option<String>,
}

/// The write for `id` of `extension` (or of its palette `palette`),
/// checked against the manifest: the setting must be declared there and
/// `value` must fit its kind (`pal_core::config::specs::check`). A value
/// equal to the declared default unsets the key, as the settings window
/// does; a `secret` that is not already a `keychain:`/`env:` reference is
/// planned into the store. Pure, so the tests cover it.
pub fn plan_write(manifest: &Value, extension: &str, palette: Option<&str>, id: &str, value: Value) -> Result<SettingWrite, String> {
    let (specs, key, secret_key) = match palette {
        Some(p) => {
            let m = &manifest["palettes"][p];
            if m.is_null() {
                return Err(format!("{extension} declares no palette {p}"));
            }
            let pid = palette_id(&pal_core::index::Source::new(extension, p));
            (&m["settings"], format!("palettes.{}.settings.{}", quote(&pid), quote(id)), format!("pal/{pid}-settings-{id}"))
        }
        None => (&manifest["settings"], format!("extensions.{}.{}", quote(extension), quote(id)), format!("pal/{extension}-{id}")),
    };
    let spec = pal_core::config::specs::find(specs, id).ok_or_else(|| match palette {
        Some(p) => format!("{extension}/{p} declares no setting {id}"),
        None => format!("{extension} declares no setting {id}"),
    })?;
    pal_core::config::specs::check(spec, &value).map_err(|e| format!("{id}: {e}"))?;
    let default = spec.get("default").cloned().unwrap_or(Value::Null);
    let secret = spec["kind"] == "secret" && value.as_str().is_some_and(|v| !v.is_empty() && SecretRef::parse(v).is_none());
    let value = if value.is_null() || (!secret && value == default) { None } else { Some(value) };
    Ok(SettingWrite { key, value, secret_key: secret.then_some(secret_key) })
}

/// A dotted-key segment, quoted when TOML needs it.
fn quote(seg: &str) -> String {
    if !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') { seg.to_string() } else { format!("{seg:?}") }
}

/// Runs the planned writes: each secret to the store, then every key to
/// the file in one edit (`set_many`, one retry on a contended file), then
/// the extension's values as the file now has them, pushed to the host
/// ahead of the watcher's own reload and answered to the caller.
fn write_settings(app: &AppHandle, name: &str, manifest: &Value, writes: Vec<SettingWrite>) -> Result<Value, String> {
    let st = app.state::<Settings>();
    let mut changes = Vec::with_capacity(writes.len());
    let mut said = Vec::with_capacity(writes.len());
    for w in writes {
        let value = match (&w.secret_key, w.value) {
            (Some(k), Some(v)) => {
                platform_store().set(k, v.as_str().unwrap_or_default()).map_err(|e| format!("{k}: could not store in the keychain: {e}"))?;
                Some(json!(format!("keychain:{k}")))
            }
            (_, v) => v,
        };
        said.push(format!("{}={}", w.key, if w.secret_key.is_some() { "<secret>" } else if value.is_some() { "value" } else { "unset" }));
        changes.push((w.key, value));
    }
    retrying(|| st.file.set_many(changes.clone())).map_err(|e| format!("{}: {e}", changes.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(", ")))?;
    eprintln!("settings\tset\t{name}\t{}", said.join(" "));
    let fresh = st.file.load().config;
    let r = resolved(&fresh, name, manifest);
    if let Some(host) = app.try_state::<Arc<Host>>() {
        let (host, payload) = (host.inner().clone(), json!({ "extensions": { name: r.clone() } }));
        tauri::async_runtime::spawn(async move {
            if let Err(e) = host.notify("settings/changed", payload).await {
                eprintln!("settings	push failed	{e}");
            }
        });
    }
    Ok(r)
}

/// `(key, manifest)` of every registered instance: what `resolved` needs,
/// copied out so the store (a `security` subprocess per secret on macOS) is
/// never consulted under a lock the window's `settings_get` waits on.
fn manifests(app: &AppHandle) -> Vec<(String, Value)> {
    lock(&app.state::<Settings>().extensions).iter().map(|e| (e.key.clone(), e.manifest.clone())).collect()
}

/// Instances whose resolved values differ between the two configs. Each
/// is resolved by key with the inheritance (`Config::extension_settings`),
/// so an edit of `[extensions.gmail]` is a change to `gmail@work` too,
/// unless the key is one the instance does not inherit or overrides.
/// An instance whose table `next` no longer has (or parks) is left out:
/// the host is stopping it on `instances/changed`, there is nothing to
/// push to or relist.
pub fn changed_extensions(app: &AppHandle, prev: &Config, next: &Config) -> Vec<String> {
    changed_keys(&manifests(app), prev, next)
}

fn changed_keys(entries: &[(String, Value)], prev: &Config, next: &Config) -> Vec<String> {
    let live = |key: &str| !instance::is_key(key) || next.instances.get(key).is_some_and(|i| i.enabled);
    entries.iter().filter(|(key, m)| live(key) && resolved(prev, key, m) != resolved(next, key, m)).map(|(key, _)| key.clone()).collect()
}

/// The extensions whose `[instances.*]` tables differ between the two
/// configs, by name (`gmail` for a `gmail@work` added, removed, parked or
/// retitled): each gets an `instances/changed`, on which the host
/// reloads every instance of the name (the titles of the others depend
/// on the count).
pub fn changed_instances(prev: &Config, next: &Config) -> Vec<String> {
    let keys: std::collections::BTreeSet<&String> = prev.instances.keys().chain(next.instances.keys()).collect();
    let names: std::collections::BTreeSet<String> = keys.into_iter().filter(|k| prev.instances.get(*k) != next.instances.get(*k)).map(|k| instance::name_of(k).to_string()).collect();
    names.into_iter().collect()
}

/// `[instances."x@y"]` the extensions cannot honour, as config warnings
/// for the diagnostics strip and the Overview: `x` not installed, or
/// installed without `multi` in its manifest.
pub fn instance_warnings(config: &Config, exts: &[Ext]) -> Vec<Diagnostic> {
    config
        .instances
        .keys()
        .filter(|k| instance::is_key(k))
        .filter_map(|k| {
            let name = instance::name_of(k);
            let path = format!("instances.{k}");
            match exts.iter().find(|e| e.name == name) {
                None => Some(Diagnostic::warn(path, format!("{name} is not installed"))),
                Some(e) if e.manifest["multi"] != true => Some(Diagnostic::warn(path, format!("{name} does not support instances"))),
                Some(_) => None,
            }
        })
        .collect()
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
/// `bar`, `about`) when one is named: a window already up switches on
/// [`events::SETTINGS`], a fresh one loads on it (`create`). The window is
/// built on the first open (AppKit wants the main thread: a caller off it
/// is queued and returns at once) and shown before its page has painted,
/// so the glass is up within a frame and the page follows; `settings
/// open` in the log is the clock the page's `settings paint` mark reads
/// against.
pub fn open_page(app: &AppHandle, page: Option<&str>) {
    open_at(app, page, None);
}

/// [`open_page`] landing on `anchor`, a row's `data-anchor` on that page
/// (`extensions:hello`): the page selects what it names and lights the
/// row, as a search hit does.
pub fn open_at(app: &AppHandle, page: Option<&str>, anchor: Option<&str>) {
    let handle = app.clone();
    let page = page.map(str::to_string);
    let anchor = anchor.map(str::to_string);
    let _ = app.run_on_main_thread(move || {
        let t0 = Instant::now();
        let (w, fresh) = match handle.get_webview_window(WINDOW) {
            Some(w) => (w, false),
            None => match create(&handle, page.as_deref(), anchor.as_deref()) {
                Ok(w) => (w, true),
                Err(e) => return eprintln!("settings\twindow failed\t{e}"),
            },
        };
        panel::hide(&handle);
        if let (Some(page), false) = (page.as_deref(), fresh) {
            events::emit_to(&handle, WINDOW, events::SETTINGS, json!({ "page": page, "anchor": anchor }));
        }
        let _ = w.show();
        let _ = w.set_focus();
        eprintln!("settings\topen\t{}\t{:.1}ms\t{:.1}ms since start", if fresh { "built" } else { "shown" }, t0.elapsed().as_secs_f64() * 1000.0, crate::since_start_ms());
        // The Permissions group shows a live dot: a grant made while the window is up is seen.
        permissions::watch(&handle);
    });
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

// ---- update checks ---------------------------------------------------------
// Two network checks, the app's release manifest (updater.rs) and the
// store's GitHub branches (`Store::check_updates`), each remembered here
// with its time so the Overview can say when it last looked and so a
// window opened twice a day asks GitHub once. By themselves they run only
// while `general.check_updates` is on and the last result is older than
// [`CHECK_EVERY`]; "Check now" and the About page's button always run.

/// How old a result is before the Overview runs the check again by itself.
pub const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);

/// One remembered check: when it ran and what it said. A failure is the
/// message, for the page to show as a fact next to the time, never as
/// something to fix.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Checked<T> {
    /// Unix ms.
    pub at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> Checked<T> {
    pub fn at(at: u64, result: Result<T, String>) -> Self {
        let (value, error) = match result {
            Ok(v) => (Some(v), None),
            Err(e) => (None, Some(e)),
        };
        Self { at, value, error }
    }

    pub fn now(result: Result<T, String>) -> Self {
        Self::at(unix_ms(SystemTime::now()), result)
    }
}

/// What is known, `None` while a check never ran this process.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Checks {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<Checked<UpdateInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Checked<Vec<Update>>>,
}

impl Checks {
    /// Whether a check last run at `last` should run at `now`: asked for
    /// (`force`), or by itself while `enabled` and the result is older
    /// than [`CHECK_EVERY`] (or there is none).
    pub fn due(last: Option<u64>, now: u64, enabled: bool, force: bool) -> bool {
        force || (enabled && last.is_none_or(|t| now.abs_diff(t) >= CHECK_EVERY.as_millis() as u64))
    }

    /// `name` was updated or removed: it is no longer behind.
    pub fn forget(&mut self, name: &str) {
        if let Some(v) = self.extensions.as_mut().and_then(|c| c.value.as_mut()) {
            v.retain(|u| u.name != name);
        }
    }
}

/// The app check's result, from wherever it ran (the daily loop, the tray,
/// a page): remembered for the Overview.
pub fn remember_app_check(app: &AppHandle, result: &Result<UpdateInfo, String>) {
    if let Some(st) = app.try_state::<Settings>() {
        lock(&st.checks).app = Some(Checked::now(result.clone()));
    }
}

/// What the last app check found, when one ran and answered.
pub fn last_app_check(app: &AppHandle) -> Option<UpdateInfo> {
    app.try_state::<Settings>().and_then(|st| lock(&st.checks).app.as_ref().and_then(|c| c.value.clone()))
}

/// The store's check, remembered.
async fn check_extensions(app: &AppHandle) -> Result<Vec<Update>, String> {
    let r = in_store(|s| s.check_updates()).await;
    match &r {
        Ok(u) if u.is_empty() => eprintln!("extensions\tup to date"),
        Ok(u) => eprintln!("extensions\tbehind\t{}", u.iter().map(|x| x.name.as_str()).collect::<Vec<_>>().join(", ")),
        Err(e) => eprintln!("extensions\tcheck failed\t{e}"),
    }
    lock(&app.state::<Settings>().checks).extensions = Some(Checked::now(r.clone()));
    r
}

/// Which of the two checks should run now (`Checks::due` on the setting
/// and what is remembered): `(app, extensions)`. The app's never runs by
/// itself in a debug build, which has nothing to update to.
pub fn checks_due(app: &AppHandle, force: bool) -> (bool, bool) {
    let enabled = config(app).general.check_updates;
    let now = unix_ms(SystemTime::now());
    let st = app.state::<Settings>();
    let c = lock(&st.checks);
    (Checks::due(c.app.as_ref().map(|c| c.at), now, enabled, force) && (force || !cfg!(debug_assertions)), Checks::due(c.extensions.as_ref().map(|c| c.at), now, enabled, force))
}

/// The Overview's checks: both when `force` (its "Check now"), else each
/// when due. Returns what is known after.
#[tauri::command]
pub async fn settings_check_updates(app: AppHandle, force: bool) -> Checks {
    let (app_due, ext_due) = checks_due(&app, force);
    let a = async {
        if app_due {
            let _ = crate::updater::check(&app).await;
        }
    };
    let b = async {
        if ext_due {
            let _ = check_extensions(&app).await;
        }
    };
    tokio::join!(a, b);
    lock(&app.state::<Settings>().checks).clone()
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
    /// Off every target by its `show_when`/`hide_when` (states.rs).
    held: bool,
    /// The last rendered state, what the strip shows.
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<BarItemState>,
    /// Named static states an extension declared for this item's Settings-only preview.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    mocks: Vec<BarMockView>,
    /// The item's rules as they apply (the extension's with the file's on
    /// top, then the file's own), in order, each with whether it holds now.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    rules: Vec<BarRuleView>,
    /// The states the item's renders publish (`<extension>/<name>`), with
    /// their live values: what its rules read.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    states: Vec<BarStateView>,
}

/// One rule on the Settings Bar pane.
#[derive(Serialize)]
pub struct BarRuleView {
    id: String,
    /// As it applies: the file's `when` over the extension's.
    when: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    /// The effect as it applies (the merged `BarRule`).
    rule: pal_core::config::BarRule,
    /// The extension's own rule, absent for one of the file's.
    #[serde(skip_serializing_if = "Option::is_none")]
    default: Option<pal_core::config::BarRule>,
    /// The file has a table for this id.
    overridden: bool,
    /// The `when` holds now.
    active: bool,
}

/// One state an item publishes, on the pane.
#[derive(Serialize)]
pub struct BarStateView {
    name: String,
    value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

/// The last render's strip: what the page's state line reads and what its
/// preview strip draws (the gallery's `BarItem` shape; `menu` stays out).
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
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    segments: Vec<crate::bar::Segment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tooltip: Option<String>,
    /// `BarItem.empty`, what `show = "always"` keeps of a hidden item: the
    /// page previews it under that setting and offers the setting on it.
    #[serde(skip_serializing_if = "Option::is_none")]
    empty: Option<BarEmptyState>,
}

/// The strip's part of `BarItem.empty` (the menu stays out, as above).
#[derive(Serialize)]
pub struct BarEmptyState {
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tooltip: Option<String>,
}

/// One `bar.<id>.mocks.<id>` entry, reduced to exactly what the Settings
/// strip can draw. It never affects the bar registry's live state.
#[derive(Serialize)]
pub struct BarMockView {
    id: String,
    title: String,
    item: BarItemState,
}

fn bar_item_state(item: &crate::bar::BarItem) -> BarItemState {
    BarItemState {
        title: item.title.clone(),
        hidden: item.hidden,
        empty: item.empty.as_ref().map(|e| BarEmptyState { icon: e.icon.clone(), title: e.title.clone(), tooltip: e.tooltip.clone() }),
        badge: item.count(),
        dot: item.dot(),
        urgent: item.urgent,
        icon: item.icon.clone(),
        segments: item.segments.clone(),
        color: item.color.clone(),
        progress: item.progress,
        tooltip: item.tooltip.clone(),
    }
}

#[derive(Serialize)]
pub struct BarView {
    /// This platform draws bar items (`bar::SUPPORTED`); the page says "not on Linux yet" otherwise.
    supported: bool,
    /// sketchybar answered its last probe: where `auto` draws.
    sketchybar: bool,
    items: Vec<BarItemView>,
}

/// The `states` an extension's `pal.json` declares, name to description.
fn manifest_states(app: &AppHandle, key: &str) -> std::collections::BTreeMap<String, String> {
    manifest_of(app, key).and_then(|m| m.get("states").cloned()).and_then(|v| v.as_object().cloned()).map(|o| o.into_iter().filter_map(|(k, v)| v.get("description").and_then(|d| d.as_str()).map(|d| (k, d.to_string()))).collect()).unwrap_or_default()
}

/// `config` is the caller's: `settings_get` holds the `loaded` lock, so this must not take it again.
fn bar_view(app: &AppHandle, config: &Config) -> BarView {
    let items = if app.try_state::<crate::bar::Bar>().is_some() { crate::bar::snapshot(app) } else { Vec::new() };
    BarView {
        supported: crate::bar::SUPPORTED,
        sketchybar: app.try_state::<crate::bar::Bar>().is_some_and(|_| crate::bar::sketchybar_alive(app)),
        items: items
            .into_iter()
            .map(|(key, e)| {
                let (extension, id) = crate::bar::split_key(&key).map(|(a, b)| (a.to_string(), b.to_string())).unwrap_or_default();
                let active = crate::states::active_rules(app, &key);
                let item_cfg = config.bar.item(&key);
                let rules = crate::bar::rules_of(config, &key, &e.manifest)
                    .into_iter()
                    .map(|(id, rule)| {
                        let default = e.manifest.rules.iter().find(|r| r.id == id).map(|r| r.rule.clone());
                        BarRuleView { when: rule.when.clone().unwrap_or_default(), description: rule.description.clone(), overridden: item_cfg.rules.contains_key(&id), active: active.contains(&id), default, rule, id }
                    })
                    .collect();
                let declared = manifest_states(app, &extension);
                let prefix = format!("{extension}/");
                let states = crate::states::list(app).into_iter().filter(|s| s.name.starts_with(&prefix)).map(|s| { let name = s.name[prefix.len()..].to_string(); BarStateView { description: declared.get(&name).cloned(), name, value: s.value } }).collect();
                BarItemView {
                    rules,
                    states,
                    state: e.last.as_ref().map(bar_item_state),
                    mocks: e.manifest.mocks.iter().map(|(id, mock)| BarMockView { id: id.clone(), title: mock.title.clone(), item: bar_item_state(&mock.item) }).collect(),
                    key,
                    extension,
                    id,
                    title: e.manifest.title.clone(),
                    description: e.manifest.description.clone(),
                    source: e.manifest.source,
                    refresh_every: e.manifest.refresh.as_ref().and_then(|r| r.every),
                    rendered_at: e.rendered_unix,
                    stale: e.stale,
                    held: e.held,
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
    /// The update checks as last run (`settings_check_updates`).
    checks: Checks,
    /// Every display's name as the OS reports it, the primary first
    /// (`popover::displays`): what `[sidebar] display` may name.
    displays: Vec<String>,
    /// The keycast overlay is on (keycast.rs): its Input Monitoring row on the Overview.
    keycast: bool,
}

/// Off the main thread: `permissions::status` probes the OS (~85 ms on
/// hornet), and the page re-reads every 5 s while the Overview is up.
#[tauri::command(async)]
pub fn settings_get(app: AppHandle, st: State<'_, Settings>) -> View {
    let l = lock(&st.loaded);
    let exts = lock(&st.extensions).clone();
    let mut diagnostics = l.diagnostics.clone();
    diagnostics.extend(instance_warnings(&l.config, &exts));
    View {
        config: l.config.clone(),
        diagnostics,
        path: l.path.clone(),
        changed: *lock(&st.changed),
        version: app.package_info().version.to_string(),
        extensions: exts,
        store: Store::locate().dir().to_path_buf(),
        hotkey: hotkey::outcome(&app),
        permissions: permissions::status(),
        bar: bar_view(&app, &l.config),
        checks: lock(&st.checks).clone(),
        displays: crate::bar::popover::displays(&app).0.into_iter().map(|d| d.name).collect(),
        keycast: crate::keycast::active(&app),
    }
}

/// `general.theme` alone, for `theme.ts` in every window at load: the
/// full `View` (120 KB and an OS permissions probe) was what each of
/// the four pages fetched for this one key.
#[tauri::command]
pub fn settings_theme(st: State<'_, Settings>) -> pal_core::config::Theme {
    lock(&st.loaded).config.general.theme
}

/// `[general]` as loaded, for the panel's page (what it reads of it:
/// `alias_space`, `backspace_back`, `fallbacks_always`, `now`, `search_history`); the page
/// follows `pal://config` for changes.
#[tauri::command]
pub fn settings_general(st: State<'_, Settings>) -> pal_core::config::General {
    lock(&st.loaded).config.general.clone()
}

/// One retry on `Contended`: a hand save that landed while we held the
/// text is re-read and the key applied over it.
fn retrying<T>(f: impl Fn() -> Result<T, Error>) -> Result<T, String> {
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
pub async fn extensions_update(app: AppHandle, host: State<'_, Arc<Host>>, name: String) -> Result<Installed, String> {
    let bun = crate::host::bun();
    let n = name.clone();
    let r = in_store(move |s| s.update(&n, Some(&bun))).await?;
    eprintln!("extensions	updated	{} {}", r.name, r.version);
    lock(&app.state::<Settings>().checks).forget(&name);
    host.restart().await;
    Ok(r)
}

#[tauri::command]
pub async fn extensions_remove(app: AppHandle, host: State<'_, Arc<Host>>, name: String) -> Result<(), String> {
    let n = name.clone();
    in_store(move |s| s.remove(&n)).await?;
    eprintln!("extensions	removed");
    lock(&app.state::<Settings>().checks).forget(&name);
    host.restart().await;
    Ok(())
}

/// GitHub-installed extensions whose branch moved, on demand; network, so
/// up to 10 s per extension, and an extension whose check fails is simply
/// not listed. The result is remembered (`Checks`).
#[tauri::command]
pub async fn extensions_check_updates(app: AppHandle) -> Result<Vec<Update>, String> {
    check_extensions(&app).await
}

// ---- instances -------------------------------------------------------------
// One extension, several configured copies (docs/design/instances.md): the
// file edits live in `pal_core::config::instance` (`ConfigFile::instance_add`
// / `instance_remove`); here the edit is applied to the running config at
// once (`on_reload`, whose instances diff sends `instances/changed` to the
// host) and, for a removal, the instance's files go once the host has
// stopped it.

/// How long `instances_remove` waits for the host to stop the instance
/// before it deletes the instance's files anyway.
const STOP_WAIT: Duration = Duration::from_secs(3);

/// The file as it is now, applied as the watcher would (the watcher's own
/// reload of the same bytes follows and finds nothing changed).
fn reload_now(app: &AppHandle) {
    let loaded = app.state::<Settings>().file.load();
    on_reload(app, loaded);
}

/// `[instances."<name>@<suffix>"]` written: the instance exists from here
/// (`instances/changed` to the host through the reload). `title` and
/// `tint` are optional; the host fills the defaults. Answers the key.
#[tauri::command(async)]
pub fn instances_add(app: AppHandle, st: State<'_, Settings>, name: String, suffix: String, title: Option<String>, tint: Option<String>) -> Result<String, String> {
    if !instance::valid_suffix(&suffix) {
        return Err(format!("{suffix:?} is not an instance suffix: lowercase letters, digits, - and _, up to {} characters, not \"default\"", instance::MAX_SUFFIX));
    }
    let key = format!("{name}@{suffix}");
    match lock(&st.extensions).iter().find(|e| e.name == name) {
        None => return Err(format!("{name} is not installed")),
        Some(e) if e.manifest["multi"] != true => return Err(format!("{name} does not support instances")),
        Some(_) => {}
    }
    if let Some(t) = tint.as_deref().filter(|t| !t.is_empty()) {
        if !TINTS.contains(&t) {
            return Err(format!("{t:?} is not a tile colour: one of {}", TINTS.join(", ")));
        }
    }
    retrying(|| st.file.instance_add(&key, title.as_deref(), tint.as_deref())).map_err(|e| format!("{key}: {e}"))?;
    eprintln!("instances\tadded\t{key}");
    reload_now(&app);
    Ok(key)
}

/// The twelve brand colours a tile takes (`TILE_COLORS`, sdk/src/icon.ts).
pub const TINTS: [&str; 12] = ["red", "orange", "amber", "green", "teal", "cyan", "blue", "indigo", "violet", "pink", "slate", "ink"];

/// `[instances.<key>] title`: the display name (the default instance's
/// too, `key == name`); empty unsets it, back to the suffix capitalised.
#[tauri::command(async)]
pub fn instances_rename(app: AppHandle, st: State<'_, Settings>, key: String, title: String) -> Result<(), String> {
    if !instance::is_key(&key) && !instance::valid_name(&key) {
        return Err(format!("{key:?} is not an instance key"));
    }
    let path = instance::table_key("instances", &key);
    let title = title.trim().to_string();
    retrying(|| if title.is_empty() { st.file.unset(&format!("{path}.title")) } else { st.file.set(&format!("{path}.title"), title.as_str()) }).map_err(|e| format!("{key}: {e}"))?;
    reload_now(&app);
    Ok(())
}

/// The instance gone: every table of its own out of the file
/// (`ConfigFile::instance_remove`), the host told through the reload and
/// waited for (its worker disposed, `extension/removed` seen), then its
/// storage file, its index cache directory and its frecency entries. The
/// keychain items stay, as they do for a removed extension. The default
/// instance is refused: that is the extension itself.
#[tauri::command]
pub async fn instances_remove(app: AppHandle, key: String) -> Result<(), String> {
    if !instance::is_key(&key) {
        return Err(format!("{key:?} is not an instance key; the default instance is the extension itself"));
    }
    let st = app.state::<Settings>();
    let removed = retrying(|| st.file.instance_remove(&key)).map_err(|e| format!("{key}: {e}"))?;
    eprintln!("instances\tremoved\t{key}\t{}", removed.join(" "));
    reload_now(&app);
    // The host stops the worker on `instances/changed`; its `extension/removed` drops the instance from the registry.
    if app.try_state::<Arc<Host>>().is_some() {
        let t0 = Instant::now();
        while t0.elapsed() < STOP_WAIT && lock(&st.extensions).iter().any(|e| e.key == key) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if lock(&st.extensions).iter().any(|e| e.key == key) {
            eprintln!("instances\tremove\t{key}\tstill registered after {STOP_WAIT:?}; deleting its files anyway");
        }
    }
    let index = st.file.data_dir().join(crate::cache::DIR_NAME).join(&key);
    let (a, k) = (app.clone(), key.clone());
    let gone = tauri::async_runtime::spawn_blocking(move || {
        let mut gone = Vec::new();
        // `<data dir>/pal/storage/<key>.json`, through the store so nothing of it stays loaded.
        match a.state::<pal_core::storage::Storage>().forget(&k) {
            Ok(true) => gone.push("storage"),
            Ok(false) => {}
            Err(e) => eprintln!("instances\tremove\t{k}\tstorage: {e}"),
        }
        if std::fs::remove_dir_all(&index).is_ok() {
            gone.push("index");
        }
        gone
    })
    .await
    .unwrap_or_default();
    let forgotten = {
        let st = app.state::<Mutex<Frecency>>();
        let mut f = lock(&st);
        let n = f.forget_extension(&key);
        if n > 0 {
            if let Err(e) = f.flush() {
                eprintln!("frecency\tflush failed\t{e}");
            }
        }
        n
    };
    eprintln!("instances\tcleaned\t{key}\tfiles=[{}] frecency={forgotten}", gone.join(","));
    events::emit(&app, events::INDEX, ());
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 24 * 60 * 60 * 1000;

    /// `core/settings.set` from an extension: the key it lands on, what a
    /// secret does, what a default or null does, and what is refused.
    #[test]
    fn plan_write_checks_the_manifest_and_names_the_key() {
        let manifest = json!({
            "name": "hue",
            "settings": [
                { "id": "bridge", "kind": "text" },
                { "id": "application_key", "kind": "secret" },
                { "id": "insecure", "kind": "boolean", "default": false },
                { "id": "timeout", "kind": "number", "min": 1, "max": 60, "default": 5 },
                { "id": "bar_scenes", "kind": "list", "default": [] },
            ],
            "palettes": { "rooms": { "settings": [{ "id": "columns", "kind": "number", "default": 4 }] }, "hue": { "settings": [{ "id": "x", "kind": "text" }] } },
        });
        let plan = |palette: Option<&str>, id: &str, v: Value| plan_write(&manifest, "hue", palette, id, v);
        assert_eq!(plan(None, "bridge", json!("192.168.1.25")).unwrap(), SettingWrite { key: "extensions.hue.bridge".into(), value: Some(json!("192.168.1.25")), secret_key: None });
        // A secret: the store first, the file gets the reference (write_setting); a reference as given is written as is.
        assert_eq!(plan(None, "application_key", json!("abc")).unwrap(), SettingWrite { key: "extensions.hue.application_key".into(), value: Some(json!("abc")), secret_key: Some("pal/hue-application_key".into()) });
        assert_eq!(plan(None, "application_key", json!("env:HUE_KEY")).unwrap().secret_key, None);
        assert_eq!(plan(None, "application_key", json!("")).unwrap(), SettingWrite { key: "extensions.hue.application_key".into(), value: Some(json!("")), secret_key: None }, "an empty secret is a plain (empty) value");
        // The default and null unset the key, as the settings window does.
        assert_eq!(plan(None, "insecure", json!(false)).unwrap().value, None);
        assert_eq!(plan(None, "insecure", json!(true)).unwrap().value, Some(json!(true)));
        assert_eq!(plan(None, "timeout", Value::Null).unwrap().value, None);
        assert_eq!(plan(None, "bar_scenes", json!([])).unwrap().value, None);
        assert_eq!(plan(None, "bar_scenes", json!(["relax"])).unwrap().value, Some(json!(["relax"])));
        // A palette's setting: under `[palettes.<id>.settings]`, the id as `palette_id` spells it.
        assert_eq!(plan(Some("rooms"), "columns", json!(6)).unwrap(), SettingWrite { key: "palettes.hue-rooms.settings.columns".into(), value: Some(json!(6)), secret_key: None });
        assert_eq!(plan(Some("hue"), "x", json!("y")).unwrap().key, "palettes.hue.settings.x", "the palette named like its extension");
        // Refused: undeclared, the wrong kind, out of range, no such palette.
        assert_eq!(plan(None, "colour", json!("red")).unwrap_err(), "hue declares no setting colour");
        assert_eq!(plan(Some("rooms"), "bridge", json!("x")).unwrap_err(), "hue/rooms declares no setting bridge");
        assert_eq!(plan(Some("nope"), "x", json!("x")).unwrap_err(), "hue declares no palette nope");
        assert!(plan(None, "timeout", json!("5")).unwrap_err().starts_with("timeout: a number setting takes a number"));
        assert!(plan(None, "timeout", json!(90)).unwrap_err().contains("over the setting's maximum 60"));
        assert!(plan(None, "insecure", json!("yes")).unwrap_err().contains("true or false"));
        // Odd names are quoted for the dotted key.
        assert_eq!(plan_write(&json!({ "settings": [{ "id": "a.b", "kind": "text" }] }), "my.ext", None, "a.b", json!("v")).unwrap().key, "extensions.\"my.ext\".\"a.b\"");
    }

    fn cfg(text: &str) -> Config {
        pal_core::config::parse(text).unwrap().0
    }

    /// The manifest of a `multi` extension with a plain setting, a secret
    /// and an instance-scoped one (no `keychain:` values anywhere, so the
    /// OS store is never asked).
    fn multi_manifest() -> Value {
        json!({ "name": "gmail", "multi": true, "settings": [
            { "id": "signature", "kind": "text", "default": "" },
            { "id": "token", "kind": "secret" },
            { "id": "send", "kind": "boolean", "default": false, "scope": "instance" },
        ], "palettes": { "inbox": { "settings": [{ "id": "columns", "kind": "number", "default": 1 }] } } })
    }

    #[test]
    fn changed_extensions_follow_inheritance() {
        let m = multi_manifest();
        let entries = vec![("gmail".to_string(), m.clone()), ("gmail@work".to_string(), m.clone()), ("other".to_string(), json!({ "name": "other", "settings": [{ "id": "x", "kind": "text" }] }))];
        let base = "[instances.\"gmail@work\"]\n";
        // An edit of the default's table reaches the instance through the inheritance.
        assert_eq!(changed_keys(&entries, &cfg(base), &cfg("[extensions.gmail]\nsignature = \"C\"\n[instances.\"gmail@work\"]\n")), ["gmail", "gmail@work"]);
        // Unless the instance overrides the key: then only the default changes.
        let over = "[extensions.gmail]\nsignature = \"C\"\n[extensions.\"gmail@work\"]\nsignature = \"W\"\n[instances.\"gmail@work\"]\n";
        assert_eq!(changed_keys(&entries, &cfg("[extensions.\"gmail@work\"]\nsignature = \"W\"\n[instances.\"gmail@work\"]\n"), &cfg(over)), ["gmail"]);
        // A secret or an instance-scoped key on the default never reaches the instance.
        assert_eq!(changed_keys(&entries, &cfg(base), &cfg("[extensions.gmail]\ntoken = \"t\"\nsend = true\n[instances.\"gmail@work\"]\n")), ["gmail"]);
        // The instance's own table changes the instance alone.
        assert_eq!(changed_keys(&entries, &cfg(base), &cfg("[extensions.\"gmail@work\"]\nsend = true\n[instances.\"gmail@work\"]\n")), ["gmail@work"]);
        // A palette's settings inherit the same way.
        assert_eq!(changed_keys(&entries, &cfg(base), &cfg("[palettes.gmail-inbox.settings]\ncolumns = 2\n[instances.\"gmail@work\"]\n")), ["gmail", "gmail@work"]);
        assert!(changed_keys(&entries, &cfg(base), &cfg("[instances.\"gmail@work\"]\ntitle = \"W\"\n")).is_empty(), "the instance table itself is not a settings change");
        // An instance removed or parked along with its settings is the host's to stop, not a settings change to push.
        assert_eq!(changed_keys(&entries, &cfg("[extensions.\"gmail@work\"]\nsend = true\n[instances.\"gmail@work\"]\n"), &cfg("")), Vec::<String>::new());
        assert_eq!(changed_keys(&entries, &cfg("[extensions.\"gmail@work\"]\nsend = true\n[instances.\"gmail@work\"]\n"), &cfg("[instances.\"gmail@work\"]\nenabled = false\n")), Vec::<String>::new());
    }

    #[test]
    fn changed_instances_names_the_extensions_whose_tables_moved() {
        let a = cfg("[instances.\"gmail@work\"]\ntitle = \"Work\"\n[instances.\"github@work\"]\n");
        let b = cfg("[instances.\"gmail@work\"]\ntitle = \"Job\"\n[instances.\"github@work\"]\n[instances.slack]\ntitle = \"Personal\"\n");
        assert_eq!(changed_instances(&a, &b), ["gmail", "slack"], "a retitled instance and a named default; github untouched");
        assert_eq!(changed_instances(&b, &cfg("")), ["github", "gmail", "slack"], "removed tables count");
        assert!(changed_instances(&a, &a).is_empty());
        let parked = cfg("[instances.\"gmail@work\"]\ntitle = \"Work\"\nenabled = false\n[instances.\"github@work\"]\n");
        assert_eq!(changed_instances(&a, &parked), ["gmail"]);
    }

    #[test]
    fn instance_warnings_name_the_missing_and_the_single() {
        let ext = |name: &str, multi: bool| Ext { key: name.into(), name: name.into(), instance: InstanceInfo::default_for(name), manifest: json!({ "name": name, "multi": multi }), root: String::new(), loaded: true, error: None, palettes: vec![], warnings: vec![], installed: None, record: None };
        let exts = vec![ext("gmail", true), ext("timer", false)];
        let c = cfg("[instances.\"gmail@work\"]\n[instances.\"timer@two\"]\n[instances.\"nope@x\"]\n[instances.gmail]\ntitle = \"P\"\n[instances.\"bad@@k\"]\n");
        let w: Vec<(String, String)> = instance_warnings(&c, &exts).into_iter().map(|d| (d.path, d.message)).collect();
        assert_eq!(w, [("instances.nope@x".to_string(), "nope is not installed".to_string()), ("instances.timer@two".to_string(), "timer does not support instances".to_string())], "the default's own table and a malformed key (the core's warning) are not these");
    }

    #[test]
    fn instance_label_reads_the_title_of_a_non_default_or_a_named_default_with_company() {
        let work = InstanceInfo { key: "gmail@work".into(), title: Some("Work".into()), tint: Some("amber".into()), badge: Some("W".into()), is_default: false };
        assert_eq!(work.label(true), Some("Work"), "a non-default instance is always marked");
        assert_eq!(work.label(false), Some("Work"));
        let named = InstanceInfo { key: "gmail".into(), title: Some("Personal".into()), tint: None, badge: None, is_default: true };
        assert_eq!(named.label(true), None, "a lone default reads as it did");
        assert_eq!(named.label(false), Some("Personal"));
        assert_eq!(InstanceInfo::default_for("gmail").label(false), None, "an unnamed default stays plain next to another instance");
        assert!(InstanceInfo::default_for("gmail").is_default && !InstanceInfo::default_for("gmail@work").is_default);
        let parsed: InstanceInfo = serde_json::from_value(json!({ "key": "gmail@work", "title": "Work", "tint": "amber", "badge": "W", "isDefault": false })).unwrap();
        assert_eq!(parsed, work, "the host's `instance` as it announces it");
    }

    #[test]
    fn a_check_is_due_once_a_day_while_on_and_always_on_demand() {
        assert!(Checks::due(None, DAY, true, false), "never ran");
        assert!(!Checks::due(Some(DAY), DAY + 1000, true, false), "an hour-old result is kept");
        assert!(Checks::due(Some(DAY), 2 * DAY, true, false), "a day-old one runs again");
        assert!(!Checks::due(None, DAY, false, false), "off: never by itself");
        assert!(Checks::due(None, DAY, false, true), "off: Check now still runs");
        assert!(Checks::due(Some(DAY), DAY, true, true), "on: Check now runs a fresh one again");
        assert!(Checks::due(Some(2 * DAY), DAY, true, false), "a clock that went back is not a reason to wait");
    }

    #[test]
    fn a_result_keeps_its_time_and_either_the_value_or_the_message() {
        let ok: Checked<Vec<Update>> = Checked::at(7, Ok(vec![]));
        assert_eq!((ok.at, ok.value.as_deref(), ok.error.as_deref()), (7, Some(&[][..]), None));
        let err: Checked<Vec<Update>> = Checked::at(8, Err("offline".into()));
        assert_eq!((err.at, err.value.is_none(), err.error.as_deref()), (8, true, Some("offline")));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json, json!({ "at": 8, "error": "offline" }), "the page reads `at`, `value?`, `error?`");
        assert_eq!(serde_json::to_value(Checks::default()).unwrap(), json!({}), "nothing ran: nothing to say");
    }

    #[test]
    fn an_updated_or_removed_extension_is_no_longer_behind() {
        let up = |name: &str| Update { name: name.into(), current: "a".into(), latest: "b".into() };
        let mut c = Checks { app: None, extensions: Some(Checked::at(1, Ok(vec![up("one"), up("two")]))) };
        c.forget("one");
        assert_eq!(c.extensions.as_ref().unwrap().value.as_ref().unwrap(), &[up("two")]);
        c.forget("nothing");
        assert_eq!(c.extensions.as_ref().unwrap().at, 1, "the time stays: the check did run");
        let mut none = Checks::default();
        none.forget("one");
        assert_eq!(none, Checks::default());
    }
}
