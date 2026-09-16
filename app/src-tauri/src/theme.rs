//! The theme file (`[general] theme_file`, `pal_core::theme`): loaded at
//! startup and on every config reload that changes the key, watched for
//! saves (an mtime poll every [`POLL`] while a file is set: one `stat` a
//! second, no second notify watcher), and handed to every window as
//! [`events::THEME`] (`{ name, light, dark, diagnostics }`), which
//! `theme.ts` applies as CSS variables on `:root` for the scheme in force.
//! The window asks for the current one at load (`theme_current`), and
//! Settings > General for the picker's state (`theme_status`: the file,
//! its name, the diagnostics, every theme in `<config dir>/themes/`).
//! The two bundled examples (`examples/themes/`) are seeded into that
//! directory when Settings opens it and it is empty, so a first look has
//! something to pick.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use pal_core::config::Diagnostic;
use pal_core::theme::{self, Entry, Parsed};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{events, lock, settings};

const POLL: Duration = Duration::from_secs(1);

/// The bundled examples, seeded into an empty themes dir on request.
const EXAMPLES: [(&str, &str); 2] = [
    ("catppuccin-frappe", include_str!("../../../examples/themes/catppuccin-frappe.toml")),
    ("rose-pine-dawn", include_str!("../../../examples/themes/rose-pine-dawn.toml")),
];

/// What the pages get: the parsed theme with its diagnostics, and the
/// file it came from (absent: no theme file set).
#[derive(Debug, Clone, Default, Serialize)]
pub struct Current {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<PathBuf>,
    #[serde(flatten)]
    pub parsed: Parsed,
}

pub struct State {
    current: Mutex<Current>,
    /// The file's mtime as last seen by the poll.
    seen: Mutex<Option<SystemTime>>,
}

fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// The config directory the themes dir sits in: the config file's parent.
fn config_dir(app: &AppHandle) -> PathBuf {
    settings::file(app).path().parent().map_or_else(|| pal_core::fs::config_dir().join("pal"), Path::to_path_buf)
}

/// The path `general.theme_file` names right now, if any.
fn wanted(app: &AppHandle) -> Option<PathBuf> {
    theme::resolve(&settings::config(app).general.theme_file, &config_dir(app))
}

/// Read the file (or none), remember it, tell every window.
fn load(app: &AppHandle, file: Option<PathBuf>) {
    let current = match &file {
        Some(p) => Current { file: Some(p.clone()), parsed: theme::load(p) },
        None => Current::default(),
    };
    for d in &current.parsed.diagnostics {
        eprintln!("theme\t{:?}\t{}\t{}", d.level, d.path, d.message);
    }
    match &file {
        Some(p) => eprintln!("theme\t{}\t{}\t{} light, {} dark", p.display(), current.parsed.theme.name.as_deref().unwrap_or("unnamed"), current.parsed.theme.light.len(), current.parsed.theme.dark.len()),
        None => eprintln!("theme\tnone"),
    }
    let st = app.state::<State>();
    *lock(&st.seen) = file.as_deref().and_then(mtime);
    *lock(&st.current) = current.clone();
    events::emit(app, events::THEME, current);
}

/// Startup: the file the config names, and the poll.
pub fn install(app: &AppHandle) {
    app.manage(State { current: Mutex::new(Current::default()), seen: Mutex::new(None) });
    load(app, wanted(app));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            let Some(file) = wanted(&app) else { continue };
            let now = mtime(&file);
            let seen = *lock(&app.state::<State>().seen);
            if now != seen {
                load(&app, Some(file));
            }
        }
    });
}

/// A config reload: a changed `theme_file` loads the new one (or none).
pub fn apply_config(app: &AppHandle, prev: &pal_core::config::Config, next: &pal_core::config::Config) {
    if prev.general.theme_file != next.general.theme_file {
        load(app, wanted(app));
    }
}

/// The theme as loaded, for a page at load.
#[tauri::command]
pub fn theme_current(st: tauri::State<'_, State>) -> Current {
    lock(&st.current).clone()
}

/// What Settings > General shows: the setting, the file it resolves to,
/// its name and diagnostics, the themes dir and what is in it.
#[derive(Serialize)]
pub struct Status {
    /// `general.theme_file` as written.
    pub setting: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
    pub dir: PathBuf,
    pub themes: Vec<Entry>,
}

/// Settings' picker asks; a themes dir that does not exist yet is made
/// with the two examples in it, so the select has something to offer (an
/// existing dir, empty or not, is left alone: the examples are then a
/// button away, `theme_open_dir`).
#[tauri::command(async)]
pub fn theme_status(app: AppHandle, st: tauri::State<'_, State>) -> Status {
    let dir = config_dir(&app);
    if !theme::themes_dir(&dir).exists() {
        match seed(&theme::themes_dir(&dir)) {
            Ok(n) => eprintln!("theme	seeded	{n} examples into {}", theme::themes_dir(&dir).display()),
            Err(e) => eprintln!("theme	seed failed	{e}"),
        }
    }
    let c = lock(&st.current).clone();
    Status { setting: settings::config(&app).general.theme_file, file: c.file, name: c.parsed.theme.name, diagnostics: c.parsed.diagnostics, dir: theme::themes_dir(&dir), themes: theme::list(&dir) }
}

fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    let mut child = std::process::Command::new(cmd).args(args).spawn().map_err(|e| format!("{cmd} failed: {e}"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

/// Seed the bundled examples into an empty (or missing) themes dir.
pub fn seed(dir: &Path) -> std::io::Result<usize> {
    std::fs::create_dir_all(dir)?;
    let has_any = std::fs::read_dir(dir)?.flatten().any(|e| e.path().extension().is_some_and(|x| x == "toml"));
    if has_any {
        return Ok(0);
    }
    for (name, text) in EXAMPLES {
        std::fs::write(dir.join(format!("{name}.toml")), text)?;
    }
    Ok(EXAMPLES.len())
}

/// "Edit theme file": the file `theme_file` names in the text editor; with
/// no file set, the themes dir (seeded with the examples when empty) in
/// the file manager, so there is something to copy from.
#[tauri::command(async)]
pub fn theme_open(app: AppHandle) -> Result<(), String> {
    let dir = theme::themes_dir(&config_dir(&app));
    match wanted(&app) {
        Some(file) if file.exists() => {
            let p = file.to_string_lossy().into_owned();
            if cfg!(target_os = "macos") { run("open", &["-t", &p]) } else { run("xdg-open", &[&p]) }
        }
        Some(file) => Err(format!("{} does not exist", file.display())),
        None => {
            seed(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
            let p = dir.to_string_lossy().into_owned();
            if cfg!(target_os = "macos") { run("open", &[&p]) } else { run("xdg-open", &[&p]) }
        }
    }
}

/// "Open themes folder": the dir, seeded when empty; answers what is in it now.
#[tauri::command(async)]
pub fn theme_open_dir(app: AppHandle) -> Result<Vec<Entry>, String> {
    let cfg = config_dir(&app);
    let dir = theme::themes_dir(&cfg);
    seed(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let p = dir.to_string_lossy().into_owned();
    if cfg!(target_os = "macos") { run("open", &[&p])? } else { run("xdg-open", &[&p])? }
    Ok(theme::list(&cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeding_fills_an_empty_dir_once_and_leaves_a_used_one_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("themes");
        assert_eq!(seed(&dir).unwrap(), 2);
        assert!(dir.join("catppuccin-frappe.toml").is_file() && dir.join("rose-pine-dawn.toml").is_file());
        assert_eq!(seed(&dir).unwrap(), 0, "already seeded");
        let own = tmp.path().join("own");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::write(own.join("mine.toml"), "name = \"Mine\"").unwrap();
        assert_eq!(seed(&own).unwrap(), 0, "a dir with a theme is the user's");
        assert_eq!(theme::list(tmp.path()).len(), 2);
    }

    #[test]
    fn the_current_theme_serialises_flat_for_the_page() {
        let c = Current { file: Some(PathBuf::from("/t.toml")), parsed: theme::parse("name = \"T\"\n[light]\naccent = \"#fff\"") };
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["file"], "/t.toml");
        assert_eq!(v["theme"]["name"], "T");
        assert_eq!(v["theme"]["light"]["--pal-accent"], "#fff");
        assert_eq!(v["diagnostics"].as_array().unwrap().len(), 0);
        let none = serde_json::to_value(Current::default()).unwrap();
        assert!(none.get("file").is_none());
        assert!(none["theme"]["light"].as_object().unwrap().is_empty());
    }
}
