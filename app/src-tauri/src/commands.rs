//! pal's own commands as root rows: one synthetic source, `pal/commands`,
//! whose rows are what Raycast lists as "Raycast Settings", "Quit
//! Raycast", "Reload Extensions", "Check for Updates", "Store",
//! "Documentation": Settings (and its pages), the extension store and an
//! install form, host restart, an index refresh, the update check, the
//! config file, the tips, the docs, a bug report, diagnostics, the theme,
//! quit, restart, and the version.
//!
//! The rows are seeded once at startup (`install`, from
//! `index::restore_cache`) after the cached palettes, so the empty query
//! lists them after the apps; a typed query finds them by name and
//! keywords, every one of which carries `pal`, so `pal set` is Settings.
//! A pick is routed here by `index::pick` (as a welcome row's is) and
//! runs the same handlers the action panel's `pal:settings`,
//! `pal:refresh` and `pal:welcome` call: `settings::open`,
//! `index::index_refresh`, `welcome::welcome_reset`. Picks are remembered
//! by frecency like any other row's (Settings is a daily row), except the
//! inert version row's (`inert`).
//!
//! `plan` is the pure half (a row id and action to what should happen),
//! `pick` the half that touches the app; the tests cover the rows, the
//! plan and the text the diagnostics and the bug report carry.

use std::path::{Path, PathBuf};

use base64::Engine;
use pal_core::config::Theme;
use pal_core::index::{Item, Source};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::{autostart, effects, hotkey, index, permissions, settings, updater, welcome};

pub const STORE: &str = "https://pal.cagdas.io/extensions";
pub const DOCS: &str = "https://pal.cagdas.io/docs";
pub const ISSUES: &str = "https://github.com/zcag/pal/issues/new";

pub const SETTINGS: &str = "settings";
pub const SETTINGS_EXTENSIONS: &str = "settings-extensions";
pub const SETTINGS_PALETTES: &str = "settings-palettes";
pub const SETTINGS_ABOUT: &str = "settings-about";
pub const STORE_ROW: &str = "store";
pub const INSTALL: &str = "install";
pub const RELOAD: &str = "reload";
pub const REFRESH: &str = "refresh";
pub const UPDATES: &str = "updates";
pub const CONFIG_OPEN: &str = "config-open";
pub const CONFIG_REVEAL: &str = "config-reveal";
pub const TIPS: &str = "tips";
pub const DOCS_ROW: &str = "docs";
pub const BUG: &str = "bug";
pub const DIAGNOSTICS: &str = "diagnostics";
pub const THEME: &str = "theme";
pub const QUIT: &str = "quit";
pub const RESTART: &str = "restart";
pub const VERSION: &str = "version";

/// The install form's one field and its submit action.
const SPEC: &str = "spec";

/// The pal mark (`app/design/icon.svg`) as a `data:` URL: the UI's
/// `image` icon kind loads it as is, on both platforms, whatever the
/// bundle is called.
fn mark() -> Value {
    let svg = base64::engine::general_purpose::STANDARD.encode(include_bytes!("../../design/icon.svg"));
    json!({ "image": format!("data:image/svg+xml;base64,{svg}") })
}

pub fn source() -> Source {
    Source::new("pal", "commands")
}

/// Whether a pick on this row is not worth remembering: the version row
/// only copies its subtitle.
pub fn inert(source: &Source, id: &str) -> bool {
    *source == self::source() && id == VERSION
}

fn row(id: &str, name: &str, subtitle: &str, keywords: &[&str], icon: &Value) -> Item {
    let mut keywords: Vec<String> = keywords.iter().map(|k| k.to_string()).collect();
    if !keywords.iter().any(|k| k == "pal") {
        keywords.insert(0, "pal".into());
    }
    Item {
        id: id.into(),
        name: name.into(),
        subtitle: Some(subtitle.into()).filter(|s: &String| !s.is_empty()),
        keywords,
        icon: Some(icon.clone()),
        section: None,
        extra: serde_json::Map::default(),
    }
}

/// The rows, top to bottom. Quit asks first (`confirm` on its one action);
/// the version row's one action is a copy, and it is the only row the
/// frecency store skips.
pub fn rows(version: &str) -> Vec<Item> {
    let icon = mark();
    let reveal = if cfg!(target_os = "macos") { "Show config.toml in Finder" } else { "Show config.toml in the file manager" };
    let mut rows = vec![
        row(SETTINGS, "Settings", "Hotkey, theme, palettes, extensions", &["preferences", "options", "config"], &icon),
        row(SETTINGS_EXTENSIONS, "Settings › Extensions", "Installed extensions, updates, the store", &["settings", "preferences", "extensions"], &icon),
        row(SETTINGS_PALETTES, "Settings › Palettes", "Enable, alias and hotkey per palette", &["settings", "preferences", "palettes"], &icon),
        row(SETTINGS_ABOUT, "Settings › About", "Version, links, the last crash", &["settings", "preferences", "about", "version"], &icon),
        row(STORE_ROW, "Extension Store", "pal.cagdas.io/extensions", &["extensions", "store", "browse", "marketplace"], &icon),
        row(INSTALL, "Install Extension", "From GitHub, a URL or a local directory", &["extension", "add", "github"], &icon),
        row(RELOAD, "Reload Extensions", "Restart the extension host; every extension loads again from disk", &["restart", "host", "extensions"], &icon),
        row(REFRESH, "Refresh Index", "List every palette again, past any cache", &["reindex", "rebuild", "cache", "index"], &icon),
        row(UPDATES, "Check for Updates", "Against the latest release", &["update", "upgrade", "release", "version"], &icon),
        row(CONFIG_OPEN, "Open Config File", "config.toml in your editor", &["config", "edit", "toml", "settings"], &icon),
        row(CONFIG_REVEAL, "Reveal Config File", reveal, &["config", "toml", "finder", "show", "folder"], &icon),
        row(TIPS, "Show Tips Again", "The Welcome section returns to the empty query", &["welcome", "help", "onboarding", "tour"], &icon),
        row(DOCS_ROW, "Documentation", "pal.cagdas.io/docs", &["help", "manual", "guide", "docs"], &icon),
        row(BUG, "Report a Bug", "A GitHub issue with your version and OS filled in", &["issue", "feedback", "github", "problem"], &icon),
        row(DIAGNOSTICS, "Copy Diagnostics", "Version, OS, config, extensions, hotkey, permissions", &["debug", "support", "info", "troubleshoot"], &icon),
        row(THEME, "Toggle Theme", "Light, dark, or the system's", &["dark", "light", "appearance", "mode"], &icon),
        row(QUIT, "Quit pal", "Stops the extension host and exits", &["exit", "close"], &icon),
        row(RESTART, "Restart pal", "Quit and launch again", &["relaunch", "reboot", "reopen"], &icon),
        row(VERSION, "pal Version", version, &["version", "about", "build"], &icon),
    ];
    let actions = |rows: &mut [Item], id: &str, a: Value| rows.iter_mut().find(|r| r.id == id).expect("a listed row").extra.insert("actions".into(), a);
    actions(&mut rows, QUIT, json!([{ "id": QUIT, "title": "Quit pal", "style": "destructive", "confirm": "Quit pal? The extension host stops with it." }]));
    actions(&mut rows, VERSION, json!([{ "id": "copy", "title": "Copy Version" }]));
    rows
}

/// Put the rows in the index; once, at startup, after the cached palettes.
pub fn install(app: &AppHandle) {
    let rows = rows(&app.package_info().version.to_string());
    let n = rows.len();
    index::with_index(app, |ix| ix.replace(source(), rows));
    eprintln!("commands\t{n} rows");
}

// ---- the plan ----------------------------------------------------------------

/// What a pick on a row does; `pick` runs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Plan {
    /// Settings, on `page` when one is named.
    Settings(Option<&'static str>),
    /// A URL in the browser.
    Open(&'static str),
    /// The install form.
    InstallForm,
    /// The form's submit: install `spec`.
    Install(String),
    RestartHost,
    RefreshIndex,
    CheckUpdates,
    OpenConfig,
    RevealConfig,
    ShowTips,
    /// The bug report URL, built from the diagnostics.
    ReportBug,
    CopyDiagnostics,
    ToggleTheme,
    Quit,
    Restart,
    CopyVersion,
    /// A stale id: nothing.
    Nothing,
}

/// The row and action (and a form's values) to a plan.
pub fn plan(id: &str, action: Option<&str>, values: Option<&Value>) -> Plan {
    match id {
        SETTINGS => Plan::Settings(None),
        SETTINGS_EXTENSIONS => Plan::Settings(Some("extensions")),
        SETTINGS_PALETTES => Plan::Settings(Some("palettes")),
        SETTINGS_ABOUT => Plan::Settings(Some("about")),
        STORE_ROW => Plan::Open(STORE),
        INSTALL if action == Some(SPEC) => Plan::Install(values.and_then(|v| v[SPEC].as_str()).unwrap_or_default().trim().to_string()),
        INSTALL => Plan::InstallForm,
        RELOAD => Plan::RestartHost,
        REFRESH => Plan::RefreshIndex,
        UPDATES => Plan::CheckUpdates,
        CONFIG_OPEN => Plan::OpenConfig,
        CONFIG_REVEAL => Plan::RevealConfig,
        TIPS => Plan::ShowTips,
        DOCS_ROW => Plan::Open(DOCS),
        BUG => Plan::ReportBug,
        DIAGNOSTICS => Plan::CopyDiagnostics,
        THEME => Plan::ToggleTheme,
        QUIT => Plan::Quit,
        RESTART => Plan::Restart,
        VERSION => Plan::CopyVersion,
        _ => Plan::Nothing,
    }
}

/// The install form, with the store's error under the field on a retry.
pub fn install_form(error: Option<&str>) -> Value {
    let mut form = json!({
        "title": "Install Extension",
        "fields": [{ "id": SPEC, "kind": "text", "label": "Source", "placeholder": "github:user/repo, a GitHub URL, or a local directory", "required": true, "description": "github:user/repo/sub/dir@tag for a subdirectory at a tag or branch" }],
        "submit": { "id": SPEC, "title": "Install" },
    });
    if let Some(e) = error {
        form["errors"] = json!({ SPEC: e });
    }
    json!({ "form": form })
}

fn toast(title: &str, message: &str, style: &str) -> Value {
    json!({ "toast": { "title": title, "message": message, "style": style } })
}

/// System, then light, then dark, then the system again.
pub fn next_theme(t: Theme) -> Theme {
    match t {
        Theme::System => Theme::Light,
        Theme::Light => Theme::Dark,
        Theme::Dark => Theme::System,
    }
}

fn theme_name(t: Theme) -> &'static str {
    match t {
        Theme::System => "system",
        Theme::Light => "light",
        Theme::Dark => "dark",
    }
}

/// What the update check says, as a toast.
pub fn updates_toast(r: &Result<updater::UpdateInfo, String>) -> Value {
    match r {
        Ok(updater::UpdateInfo { available: true, version, .. }) => toast(&format!("pal {} is available", version.as_deref().unwrap_or("?")), "Download it from the Releases page on GitHub", "success"),
        Ok(updater::UpdateInfo { status: Some(s), .. }) => toast("Nothing to update to", s, "success"),
        Ok(_) => toast("pal is up to date", "", "success"),
        Err(e) => toast("Could not check for updates", e, "failure"),
    }
}

// ---- diagnostics -------------------------------------------------------------

/// What the diagnostics and the bug report say; read once per pick.
#[derive(Debug, Clone, PartialEq)]
pub struct Diag {
    pub version: String,
    pub debug: bool,
    pub os: String,
    pub arch: String,
    pub config: PathBuf,
    pub profile: String,
    pub data: PathBuf,
    /// `(name, loaded)` of every extension the host reported.
    pub extensions: Vec<(String, bool)>,
    pub hotkey: hotkey::Outcome,
    pub accessibility: bool,
    pub theme: Theme,
}

impl Diag {
    fn read(app: &AppHandle) -> Self {
        let file = settings::file(app);
        Self {
            version: app.package_info().version.to_string(),
            debug: cfg!(debug_assertions),
            os: os_version(),
            arch: std::env::consts::ARCH.into(),
            config: file.path().to_path_buf(),
            profile: file.profile(),
            data: file.data_dir(),
            extensions: settings::extensions(app).iter().map(|e| (e.name.clone(), e.loaded)).collect(),
            hotkey: hotkey::outcome(app),
            accessibility: permissions::status().accessibility,
            theme: settings::config(app).general.theme,
        }
    }

    /// One line per fact, the block the clipboard and the report get.
    pub fn text(&self) -> String {
        let (loaded, failed): (Vec<_>, Vec<_>) = self.extensions.iter().partition(|(_, ok)| *ok);
        let names = |v: &[&(String, bool)]| v.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", ");
        let mut exts = format!("{} loaded", loaded.len());
        if !loaded.is_empty() {
            exts.push_str(&format!(": {}", names(&loaded)));
        }
        if !failed.is_empty() {
            exts.push_str(&format!("; {} failed: {}", failed.len(), names(&failed)));
        }
        let hotkey = self.hotkey.summary();
        [
            format!("pal {}{}", self.version, if self.debug { " (debug)" } else { "" }),
            format!("os: {} {}", self.os, self.arch),
            format!("config: {} (profile {})", self.config.display(), self.profile),
            format!("data: {}", self.data.display()),
            format!("extensions: {exts}"),
            format!("hotkey: {hotkey}"),
            format!("accessibility: {}", if self.accessibility { "granted" } else { "not granted" }),
            format!("theme: {}", theme_name(self.theme)),
        ]
        .join("\n")
    }

    /// The new-issue URL with the report's body: what happened, what was
    /// expected, then the diagnostics.
    pub fn bug_url(&self) -> String {
        let body = format!("**What happened**\n\n\n\n**What you expected**\n\n\n\n---\n```\n{}\n```\n", self.text());
        url::Url::parse_with_params(ISSUES, &[("body", body.as_str())]).map(String::from).unwrap_or_else(|_| ISSUES.to_string())
    }
}

/// `macos 26.4`, `Ubuntu 24.04 LTS`, or the bare platform name.
fn os_version() -> String {
    let os = std::env::consts::OS;
    if cfg!(target_os = "macos") {
        let v = std::process::Command::new("sw_vers").arg("-productVersion").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        return if v.is_empty() { os.into() } else { format!("{os} {v}") };
    }
    std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("PRETTY_NAME=").map(|v| v.trim_matches('"').to_string())))
        .unwrap_or_else(|| os.into())
}

// ---- restart -----------------------------------------------------------------

/// The `.app` bundle `exe` runs from on macOS, when it does.
fn bundle_of(exe: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    exe.ancestors().nth(3).filter(|p| p.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf)
}

/// The shell the relaunch runs in: wait for this process to be gone, then
/// launch the bundle again through LaunchServices (`open -n`, with the
/// profile's environment carried along: `open` passes none of ours) or,
/// with no bundle (Linux, a dev build), exec the binary in this same
/// environment.
fn relaunch_script(pid: u32, exe: &Path, bundle: Option<&Path>, env: &[(String, String)]) -> String {
    let q = autostart::sh_quote;
    let launch = match bundle {
        Some(b) => {
            let env: Vec<String> = env.iter().map(|(k, v)| format!(" --env {}", q(&format!("{k}={v}")))).collect();
            format!("exec open -n{} {}", env.concat(), q(&b.to_string_lossy()))
        }
        None => format!("exec {}", q(&exe.to_string_lossy())),
    };
    format!("{}{launch}\n", autostart::wait_for_exit(pid))
}

/// Quit as the tray's Quit does, with a shell waiting to launch pal again
/// once this process is gone (a new instance started before that would
/// only hand over to this one and exit). The shell keeps our stdout and
/// stderr, so an `exec`ed pal logs where this one did.
fn restart(app: &AppHandle) -> Result<(), String> {
    let exe = autostart::program().ok_or("no path to this binary")?;
    let script = relaunch_script(std::process::id(), &exe, bundle_of(&exe).as_deref(), &autostart::carried_env());
    eprintln!("restart\t{}", script.lines().last().unwrap_or_default());
    std::process::Command::new("sh")
        .arg("-c")
        .arg(&script)
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start the relaunch helper: {e}"))?;
    crate::quit(app);
    Ok(())
}

// ---- pick --------------------------------------------------------------------

/// A pick on a command row: the envelope the page should see, as
/// `index::pick` returns for a host row.
pub async fn pick(app: &AppHandle, id: &str, action: Option<&str>, values: Option<&Value>) -> Result<Value, String> {
    let hide = || Ok(json!({ "hide": true }));
    match plan(id, action, values) {
        Plan::Settings(page) => {
            settings::open_page(app, page);
            hide()
        }
        Plan::Open(url) => effects::apply(app, json!({ "open": url })).await,
        Plan::InstallForm => Ok(install_form(None)),
        Plan::Install(spec) => {
            if spec.is_empty() {
                return Ok(install_form(Some("a source is needed")));
            }
            match settings::extensions_install(app.state(), spec).await {
                Ok(r) => Ok(toast(&format!("Installed {} {}", r.name, r.version), "The extension host is restarting with it", "success")),
                Err(e) => Ok(install_form(Some(&e))),
            }
        }
        Plan::RestartHost => {
            settings::settings_restart_host(app.state()).await?;
            Ok(toast("Reloading extensions", "Every extension loads again from disk", "success"))
        }
        Plan::RefreshIndex => {
            // Lists one palette after the other; the footer says "updating" meanwhile.
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = index::index_refresh(handle.clone(), None, handle.state()).await {
                    eprintln!("commands\trefresh failed\t{e}");
                }
            });
            Ok(toast("Refreshing", "Every palette lists again", "success"))
        }
        Plan::CheckUpdates => Ok(updates_toast(&updater::check_updates(app.clone()).await)),
        Plan::OpenConfig => {
            settings::settings_open_file(app.clone(), app.state(), Some(settings::Which::Config))?;
            hide()
        }
        Plan::RevealConfig => {
            settings::settings_reveal_file(app.clone(), app.state(), Some(settings::Which::Config))?;
            hide()
        }
        Plan::ShowTips => {
            welcome::welcome_reset(app.clone())?;
            Ok(toast("Tips are back", "They lead the empty query", "success"))
        }
        Plan::ReportBug => effects::apply(app, json!({ "open": Diag::read(app).bug_url() })).await,
        Plan::CopyDiagnostics => effects::apply(app, json!({ "copy": Diag::read(app).text() })).await,
        Plan::ToggleTheme => {
            let next = next_theme(settings::config(app).general.theme);
            settings::settings_set(app.state(), "general.theme".into(), json!(theme_name(next)))?;
            Ok(toast(&format!("Theme: {}", theme_name(next)), "general.theme in the config file", "success"))
        }
        Plan::Quit => {
            crate::quit(app);
            hide()
        }
        Plan::Restart => {
            restart(app)?;
            hide()
        }
        Plan::CopyVersion => effects::apply(app, json!({ "copy": app.package_info().version.to_string() })).await,
        Plan::Nothing => Ok(json!({ "keep": true })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn rows_are_unique_named_and_all_find_pal() {
        let rows = rows("1.2.3");
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids.len(), ids.iter().collect::<HashSet<_>>().len(), "no duplicate ids: {ids:?}");
        assert_eq!(ids[0], SETTINGS, "Settings leads");
        assert_eq!(ids[ids.len() - 1], VERSION, "the version row is last");
        assert_eq!(ids.len(), 19);
        for r in &rows {
            assert!(r.keywords.iter().any(|k| k == "pal"), "{}: `pal` is a keyword", r.id);
            assert!(r.subtitle.as_deref().is_some_and(|s| !s.is_empty()), "{}: a subtitle", r.id);
            assert!(r.icon.as_ref().and_then(|i| i["image"].as_str()).is_some_and(|s| s.starts_with("data:image/svg+xml;base64,")), "{}: the mark", r.id);
            assert_eq!(r.keywords.iter().collect::<HashSet<_>>().len(), r.keywords.len(), "{}: no duplicate keywords", r.id);
            assert!(!r.name.contains('\u{2014}') && !r.subtitle.as_deref().unwrap_or_default().contains('\u{2014}'), "{}: no em dash", r.id);
        }
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names.len(), names.iter().collect::<HashSet<_>>().len(), "no duplicate names");
        let settings = &rows[0];
        assert!(settings.keywords.contains(&"preferences".to_string()), "Raycast's keyword too");
        let version = rows.iter().find(|r| r.id == VERSION).unwrap();
        assert_eq!(version.subtitle.as_deref(), Some("1.2.3"));
        assert_eq!(version.extra["actions"][0]["id"], "copy", "Enter copies");
        let quit = rows.iter().find(|r| r.id == QUIT).unwrap();
        assert_eq!(quit.extra["actions"][0]["style"], "destructive");
        assert!(quit.extra["actions"][0]["confirm"].as_str().is_some_and(|c| c.starts_with("Quit pal?")), "quit asks first");
        assert!(rows.iter().filter(|r| r.id != QUIT && r.id != VERSION).all(|r| r.extra.get("actions").is_none()), "the rest take Enter as is");
    }

    #[test]
    fn only_the_version_row_is_inert() {
        assert!(inert(&source(), VERSION));
        assert!(!inert(&source(), SETTINGS));
        assert!(!inert(&welcome::source(), VERSION), "another source's `version` is its own");
        assert_eq!(source(), Source::new("pal", "commands"));
    }

    #[test]
    fn every_row_has_a_plan_and_a_stale_id_none() {
        for r in rows("0") {
            assert_ne!(plan(&r.id, None, None), Plan::Nothing, "{}", r.id);
        }
        assert_eq!(plan("gone", None, None), Plan::Nothing);
        assert_eq!(plan(SETTINGS, None, None), Plan::Settings(None));
        assert_eq!(plan(SETTINGS_EXTENSIONS, None, None), Plan::Settings(Some("extensions")));
        assert_eq!(plan(SETTINGS_PALETTES, None, None), Plan::Settings(Some("palettes")));
        assert_eq!(plan(SETTINGS_ABOUT, None, None), Plan::Settings(Some("about")));
        assert_eq!(plan(STORE_ROW, None, None), Plan::Open(STORE));
        assert_eq!(plan(DOCS_ROW, None, None), Plan::Open(DOCS));
        assert_eq!(plan(QUIT, Some(QUIT), None), Plan::Quit, "the confirmed action");
        assert_eq!(plan(VERSION, Some("copy"), None), Plan::CopyVersion);
        assert_eq!(plan(RESTART, None, None), Plan::Restart);
        assert_eq!(plan(THEME, None, None), Plan::ToggleTheme);
        assert_eq!(plan(TIPS, None, None), Plan::ShowTips);
        assert_eq!(plan(REFRESH, None, None), Plan::RefreshIndex);
        assert_eq!(plan(RELOAD, None, None), Plan::RestartHost);
        assert_eq!(plan(UPDATES, None, None), Plan::CheckUpdates);
        assert_eq!(plan(CONFIG_OPEN, None, None), Plan::OpenConfig);
        assert_eq!(plan(CONFIG_REVEAL, None, None), Plan::RevealConfig);
        assert_eq!(plan(BUG, None, None), Plan::ReportBug);
        assert_eq!(plan(DIAGNOSTICS, None, None), Plan::CopyDiagnostics);
    }

    #[test]
    fn install_is_a_form_whose_submit_installs_the_spec() {
        assert_eq!(plan(INSTALL, None, None), Plan::InstallForm);
        let form = install_form(None);
        assert_eq!(form["form"]["fields"][0]["id"], SPEC);
        assert_eq!(form["form"]["fields"][0]["required"], true);
        assert_eq!(form["form"]["submit"]["id"], SPEC, "the submit is the action the plan keys on");
        assert!(form["form"].get("errors").is_none());
        assert_eq!(install_form(Some("no such repo"))["form"]["errors"][SPEC], "no such repo");
        let values = json!({ SPEC: "  github:zcag/pal-things  " });
        assert_eq!(plan(INSTALL, Some(SPEC), Some(&values)), Plan::Install("github:zcag/pal-things".into()), "trimmed");
        assert_eq!(plan(INSTALL, Some(SPEC), None), Plan::Install(String::new()), "no values: an empty spec, which asks again");
        assert!(effects::stays_open(&form), "a form keeps the panel");
    }

    #[test]
    fn theme_cycles_and_updates_toast_reads_the_result() {
        assert_eq!(next_theme(Theme::System), Theme::Light);
        assert_eq!(next_theme(Theme::Light), Theme::Dark);
        assert_eq!(next_theme(Theme::Dark), Theme::System);
        assert_eq!(theme_name(Theme::System), "system", "the config's spelling (serde lowercase)");
        assert_eq!(serde_json::to_value(Theme::Dark).unwrap(), json!(theme_name(Theme::Dark)));
        let up = updates_toast(&Ok(updater::UpdateInfo { available: true, version: Some("0.2.0".into()), notes: None, status: None }));
        assert_eq!(up["toast"]["title"], "pal 0.2.0 is available");
        assert_eq!(up["toast"]["style"], "success");
        let same = updates_toast(&Ok(updater::UpdateInfo { available: false, version: None, notes: None, status: None }));
        assert_eq!(same["toast"]["title"], "pal is up to date");
        let none = updates_toast(&Ok(updater::UpdateInfo { available: false, version: None, notes: None, status: Some("no release published yet".into()) }));
        assert_eq!(none["toast"]["message"], "no release published yet", "a missing manifest is a fact, not a failure");
        assert_eq!(none["toast"]["style"], "success");
        let err = updates_toast(&Err("no network".into()));
        assert_eq!(err["toast"]["style"], "failure");
        assert_eq!(err["toast"]["message"], "no network");
        for t in [&up, &same, &err] {
            assert!(effects::stays_open(t), "a toast keeps the panel");
        }
    }

    fn diag() -> Diag {
        Diag {
            version: "0.1.0".into(),
            debug: false,
            os: "macos 26.4".into(),
            arch: "aarch64".into(),
            config: PathBuf::from("/Users/u/.config/pal/config.toml"),
            profile: "default".into(),
            data: PathBuf::from("/Users/u/Library/Application Support/pal/default"),
            extensions: vec![("apps".into(), true), ("clipboard".into(), true), ("broken".into(), false)],
            hotkey: hotkey::Outcome { hotkeys: vec![hotkey::RootOutcome { wanted: "ctrl+space".into(), registered: true, error: None, spotlight: None }], registered: true },
            accessibility: false,
            theme: Theme::System,
        }
    }

    #[test]
    fn diagnostics_text_is_one_fact_per_line() {
        let d = diag();
        let text = d.text();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(
            lines,
            [
                "pal 0.1.0",
                "os: macos 26.4 aarch64",
                "config: /Users/u/.config/pal/config.toml (profile default)",
                "data: /Users/u/Library/Application Support/pal/default",
                "extensions: 2 loaded: apps, clipboard; 1 failed: broken",
                "hotkey: ctrl+space registered",
                "accessibility: not granted",
                "theme: system",
            ]
        );
        let mut d = diag();
        d.debug = true;
        d.extensions.clear();
        d.hotkey = hotkey::Outcome {
            hotkeys: vec![
                hotkey::RootOutcome { wanted: "cmd+space".into(), registered: false, error: Some("Spotlight has it".into()), spotlight: Some("cmd+space".into()) },
                hotkey::RootOutcome { wanted: "ctrl+space".into(), registered: true, error: None, spotlight: None },
            ],
            registered: true,
        };
        d.accessibility = true;
        d.theme = Theme::Dark;
        let text = d.text();
        assert!(text.starts_with("pal 0.1.0 (debug)\n"), "{text}");
        assert!(text.contains("\nextensions: 0 loaded\n"), "{text}");
        assert!(text.contains("\nhotkey: cmd+space failed: Spotlight has it, ctrl+space registered\n"), "every entry, in order: {text}");
        assert!(text.contains("\naccessibility: granted\n"), "{text}");
        assert!(text.ends_with("theme: dark"), "{text}");
        d.hotkey = hotkey::Outcome::default();
        assert!(d.text().contains("\nhotkey: off\n"));
        assert!(!text.contains('\u{2014}'));
    }

    #[test]
    fn bug_url_prefills_the_body_with_the_diagnostics() {
        let url = diag().bug_url();
        assert!(url.starts_with(&format!("{ISSUES}?body=")), "{url}");
        let parsed = url::Url::parse(&url).unwrap();
        let body = parsed.query_pairs().find(|(k, _)| k == "body").map(|(_, v)| v.into_owned()).unwrap();
        assert!(body.starts_with("**What happened**\n\n\n\n**What you expected**\n\n\n\n---\n```\npal 0.1.0\n"), "{body}");
        assert!(body.contains("os: macos 26.4 aarch64\n"));
        assert!(body.ends_with("theme: system\n```\n"), "{body}");
    }

    #[test]
    fn relaunch_waits_for_this_process_then_opens_the_bundle_or_execs() {
        let exe = Path::new("/Applications/pal.app/Contents/MacOS/pal");
        let bundle = Path::new("/Applications/pal.app");
        let env = vec![("PAL_CONFIG".to_string(), "/tmp/it's.toml".to_string())];
        let s = relaunch_script(4242, exe, Some(bundle), &env);
        assert!(s.starts_with("while kill -0 4242 2>/dev/null; do sleep 0.1; done\n"), "{s}");
        assert!(s.ends_with("exec open -n --env 'PAL_CONFIG=/tmp/it'\\''s.toml' '/Applications/pal.app'\n"), "{s}");
        let s = relaunch_script(1, exe, Some(bundle), &[]);
        assert!(s.ends_with("exec open -n '/Applications/pal.app'\n"), "{s}");
        let s = relaunch_script(7, Path::new("/usr/bin/pal"), None, &env);
        assert!(s.ends_with("exec '/usr/bin/pal'\n"), "no bundle: the binary itself, in this environment: {s}");
        if cfg!(target_os = "macos") {
            assert_eq!(bundle_of(exe).as_deref(), Some(bundle));
            assert_eq!(bundle_of(Path::new("/Users/u/proj/pal/target/debug/pal")), None, "a dev build has no bundle");
        } else {
            assert_eq!(bundle_of(exe), None);
        }
    }
}
