//! pal's configuration: one TOML file, `~/.config/pal/config.toml`.
//!
//! The file is the source of truth and the settings UI is a front for it, so
//! everything here is built around the file rather than around the struct:
//!
//! - [`ConfigFile::load`] reads it into [`Config`], layering the file over the
//!   built-in defaults field by field. Keys the schema does not know are kept
//!   (in `extra` maps) and reported as [`Diagnostic`]s, never errors.
//! - [`ConfigFile::set`] / [`ConfigFile::unset`] edit the text surgically with
//!   `toml_edit`, so comments, order and spacing the user wrote survive.
//! - [`ConfigFile::watch`] re-loads on change and keeps the last good config
//!   live when a save does not parse.
//! - [`schema`] emits a JSON Schema for the typed part so editors validate and
//!   complete the file.
//! - [`migrate`] turns a pal v1 config found at the path into this shape
//!   on first run, keeping the v1 file aside for the `scripts` extension.
//! - [`secrets`] resolves `keychain:` / `env:` references lazily, so secrets
//!   never sit in the file as plain text.

mod edit;
pub mod migrate;
pub mod schema;
pub mod secrets;
mod watch;
use crate::fs;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub use edit::json_to_toml;
pub use watch::Watcher;

/// pal's settings: everything the settings view can set, in the file it
/// writes. (The set of keys is small and provisional; the mechanics around
/// them are what is settled.)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(
    title = "pal config",
    extend("additionalProperties" = false),
    extend("x-taplo-info" = { "authors": ["pal"], "patterns": ["**/pal/config.toml"] })
)]
pub struct Config {
    pub general: General,
    /// Per-palette settings, keyed by palette id.
    pub palettes: BTreeMap<String, Palette>,
    /// Extension settings, keyed by extension name. Shape is whatever the
    /// extension declared.
    #[schemars(with = "BTreeMap<String, BTreeMap<String, serde_json::Value>>")]
    pub extensions: BTreeMap<String, toml::Table>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct General {
    /// Global hotkey that shows pal, e.g. `ctrl+space`. Empty turns it off,
    /// for a compositor keybind that runs `pal toggle` instead.
    pub hotkey: String,
    pub theme: Theme,
    /// Start pal when you sign in: a LaunchAgent on macOS, an XDG autostart
    /// entry on Linux (the app registers it when this changes).
    pub launch_at_login: bool,
    /// Show pal's icon in the menu bar (macOS) or system tray (Linux). The
    /// app has no Dock icon, so this is the visible way to reach Settings
    /// and Quit; the hotkey and `pal settings` work without it.
    pub menu_bar_icon: bool,
    /// Where the panel appears on the screen with the pointer.
    pub position: Position,
    /// Look for a newer release 20 s after startup and once a day, in
    /// release builds (the GitHub release manifest; nothing is downloaded).
    /// Today a found update is a log line: download and install are not
    /// wired, and the menu's "Check for updates" is a disabled placeholder
    /// until they are.
    pub check_updates: bool,
    /// Extra directories of extensions (one subdirectory per extension,
    /// like the store), for a dotfiles-managed set. Loaded after the
    /// bundled extensions and the store, so a name in a later directory
    /// replaces an earlier one. `~` is expanded. The host is restarted
    /// (`pal reload`) before a change here is seen.
    pub extension_dirs: Vec<String>,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for General {
    fn default() -> Self {
        Self { hotkey: "ctrl+space".into(), theme: Theme::System, launch_at_login: false, menu_bar_icon: true, position: Position::Top, check_updates: true, extension_dirs: Vec::new(), extra: BTreeMap::new() }
    }
}

impl General {
    /// [`extension_dirs`](Self::extension_dirs) as paths, `~` expanded.
    pub fn extension_dirs(&self) -> Vec<PathBuf> {
        self.extension_dirs.iter().map(|d| fs::expand_home(d)).collect()
    }
}

/// `top`: a fifth of the way down, where Spotlight and Raycast sit.
/// `centre`: centred. `last`: wherever it was last shown.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Position {
    #[default]
    Top,
    Centre,
    Last,
}

/// Follow the OS, or force one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// Per-palette settings pal provides to every palette extension without it
/// declaring them. A palette absent from the file gets the defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(default)]
#[schemars(extend("additionalProperties" = false))]
pub struct Palette {
    pub enabled: bool,
    /// An extra keyword on the palette's row at the root, so typing it finds
    /// the palette; `Enter` then opens it as usual.
    pub alias: Option<String>,
    /// Hotkey that opens pal directly in this palette.
    pub hotkey: Option<String>,
    /// Icon override; the extension's own icon when unset.
    pub icon: Option<String>,
    /// Settings the extension declared for this palette.
    #[schemars(with = "BTreeMap<String, serde_json::Value>")]
    pub settings: toml::Table,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for Palette {
    fn default() -> Self {
        Self { enabled: true, alias: None, hotkey: None, icon: None, settings: toml::Table::new(), extra: BTreeMap::new() }
    }
}

impl Config {
    /// The palette's settings, defaults when the file has no entry for it.
    pub fn palette(&self, id: &str) -> std::borrow::Cow<'_, Palette> {
        self.palettes.get(id).map_or_else(|| std::borrow::Cow::Owned(Palette::default()), std::borrow::Cow::Borrowed)
    }

    /// An extension's settings as it should see them: the defaults its
    /// manifest declares, with every key the file sets under
    /// `[extensions.<name>]` on top. Keys the manifest does not declare pass
    /// through, so a setting written ahead of an upgrade is not lost.
    pub fn extension_settings(&self, name: &str, manifest_defaults: &toml::Table) -> toml::Table {
        overlay(manifest_defaults, self.extensions.get(name))
    }

    /// The same for one palette's declared settings, over `[palettes.<id>].settings`.
    pub fn palette_settings(&self, id: &str, manifest_defaults: &toml::Table) -> toml::Table {
        overlay(manifest_defaults, self.palettes.get(id).map(|p| &p.settings))
    }

    /// [`extension_settings`](Self::extension_settings) from the manifest's
    /// `settings` list itself, with every `kind: "secret"` value that is a
    /// `keychain:` / `env:` reference resolved through `store`. A reference
    /// that does not resolve stays as written and is logged, so a missing
    /// secret never keeps the extension from loading; values of any other
    /// kind are passed through untouched, reference-shaped or not.
    pub fn extension_settings_resolved(&self, name: &str, specs: &serde_json::Value, store: &dyn secrets::SecretStore) -> toml::Table {
        let mut t = self.extension_settings(name, &spec_defaults(specs));
        secrets::resolve_declared(&mut t, specs, store);
        t
    }

    /// The same for one palette's declared settings.
    pub fn palette_settings_resolved(&self, id: &str, specs: &serde_json::Value, store: &dyn secrets::SecretStore) -> toml::Table {
        let mut t = self.palette_settings(id, &spec_defaults(specs));
        secrets::resolve_declared(&mut t, specs, store);
        t
    }

    /// Unknown keys as diagnostics. The keys stay in the `extra` maps and in
    /// the file; this only makes them visible.
    fn unknown_keys(&self) -> Vec<Diagnostic> {
        let unknown = |prefix: &str, extra: &BTreeMap<String, toml::Value>| {
            extra.keys().map(|k| Diagnostic::warn(format!("{prefix}{k}"), "unknown key")).collect::<Vec<_>>()
        };
        let mut out = unknown("", &self.extra);
        out.extend(unknown("general.", &self.general.extra));
        for (id, p) in &self.palettes {
            out.extend(unknown(&format!("palettes.{id}."), &p.extra));
        }
        out
    }
}

/// The defaults a manifest's `settings` list declares (`pal.json`:
/// `[{ "id", "kind", "default", .. }]`, as JSON), as the table
/// [`Config::extension_settings`] overlays. An entry without a default, or
/// whose default is `null`, declares no key.
pub fn spec_defaults(specs: &serde_json::Value) -> toml::Table {
    let mut t = toml::Table::new();
    for spec in specs.as_array().into_iter().flatten() {
        if let (Some(id), Some(d)) = (spec["id"].as_str(), spec.get("default").filter(|d| !d.is_null())) {
            if let Ok(v) = toml::Value::try_from(d) {
                t.insert(id.to_string(), v);
            }
        }
    }
    t
}

/// `defaults` with `set` on top, one level deep: a set key replaces the
/// default whole (a list is not appended to, a table not merged).
fn overlay(defaults: &toml::Table, set: Option<&toml::Table>) -> toml::Table {
    let mut out = defaults.clone();
    if let Some(set) = set {
        out.extend(set.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    out
}

/// How much a [`Diagnostic`] matters: a warning leaves the config usable
/// as loaded, an error means the file did not load and the config shown is
/// the defaults or the last good one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Warning,
    Error,
}

/// Something worth telling the user about the file, tied to where it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub level: Level,
    /// Dotted key path (`palettes.clipboard.enabld`), empty for whole-file problems.
    pub path: String,
    /// 1-based line, when known.
    pub line: Option<usize>,
    pub message: String,
}

impl Diagnostic {
    fn warn(path: String, message: &str) -> Self {
        Self { level: Level::Warning, path, line: None, message: message.into() }
    }

    fn parse(text: &str, e: toml::de::Error) -> Self {
        // Newlines before the span, not `lines().count()`: that drops the
        // empty last piece, so an error at the start of a line came out one
        // line early.
        let line = e.span().map(|s| text.as_bytes()[..s.start.min(text.len())].iter().filter(|&&b| b == b'\n').count() + 1);
        Self { level: Level::Error, path: String::new(), line, message: e.message().to_string() }
    }

    fn io(e: &std::io::Error) -> Self {
        Self { level: Level::Error, path: String::new(), line: None, message: e.to_string() }
    }
}

/// A load's outcome. `config` is always usable: defaults when the file is
/// missing, the last good config when a watched save does not parse.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Loaded {
    pub path: PathBuf,
    pub config: Config,
    pub diagnostics: Vec<Diagnostic>,
}

impl Loaded {
    /// True when the file did not load and `config` is a stand-in.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.level == Level::Error)
    }
}

/// What an edit or a watch can fail with. Loading never fails: see [`Loaded`].
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    /// The file is not TOML, so there is no text to edit in place.
    #[error("{path}: {source}")]
    Parse { path: PathBuf, source: toml_edit::TomlError },
    /// A dotted key that does not parse (`a..b`, an unclosed quote).
    #[error("bad key {0:?}")]
    Key(String),
    #[error("{0}: not a table, cannot set a key under it")]
    NotATable(String),
    /// Setting a plain value over a `[table]` would drop everything in it.
    #[error("{0}: is a table, unset it first")]
    IsATable(String),
    #[error("{0} changed on disk while editing")]
    Contended(PathBuf),
    #[error("watch: {0}")]
    Watch(#[from] notify::Error),
}

/// Parse config text: defaults layered under the file. `Err` only when the
/// text is not TOML; unknown keys come back as warnings alongside the config.
pub fn parse(text: &str) -> Result<(Config, Vec<Diagnostic>), Diagnostic> {
    let config: Config = toml::from_str(text).map_err(|e| Diagnostic::parse(text, e))?;
    let diags = config.unknown_keys();
    Ok((config, diags))
}

/// Where the schema for the `#:schema` directive is published: the
/// committed copy on `main`, so nothing is written next to the file.
pub const SCHEMA_URL: &str = "https://raw.githubusercontent.com/zcag/pal/main/core/schema/config.schema.json";

/// Header written when an edit creates the file. `#:schema` is taplo's
/// directive (a URL is accepted).
pub const TEMPLATE: &str = "#:schema https://raw.githubusercontent.com/zcag/pal/main/core/schema/config.schema.json\n# pal settings. The settings view writes this file; editing by hand is fine too.\n";

/// The config file: where it is, and everything done to it.
#[derive(Debug, Clone)]
pub struct ConfigFile {
    path: PathBuf,
}

impl ConfigFile {
    /// A config file at `path`; it need not exist yet.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// `$PAL_CONFIG`, else `$XDG_CONFIG_HOME/pal/config.toml`, else
    /// `~/.config/pal/config.toml` (on macOS too, see [`fs::config_dir`]).
    pub fn locate() -> Self {
        match std::env::var_os("PAL_CONFIG").filter(|p| !p.is_empty()) {
            Some(p) => Self::new(p),
            None => Self::new(fs::config_dir().join("config.toml")),
        }
    }

    /// The path as given (a symlink stays a symlink here).
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Which config this is, as a directory name: `default` for the
    /// default location, else the first 8 hex of the sha256 of the
    /// canonical path (`$PAL_CONFIG=~/.config/pal/pali.toml` in dev). Two
    /// config files must not share an index cache or a frecency file: a
    /// palette enabled in one is not in the other.
    pub fn profile(&self) -> String {
        if self.path == fs::config_dir().join("config.toml") {
            return "default".into();
        }
        use sha2::{Digest, Sha256};
        // A file that does not exist yet keys on its canonical directory, so
        // the key does not move once it is created (`/var` is `/private/var`
        // on macOS).
        let canon = std::fs::canonicalize(&self.path).unwrap_or_else(|_| {
            let dir = self.path.parent().and_then(|d| std::fs::canonicalize(d).ok());
            match (dir, self.path.file_name()) {
                (Some(d), Some(f)) => d.join(f),
                _ => self.path.clone(),
            }
        });
        let hash = Sha256::digest(canon.to_string_lossy().as_bytes());
        hash.iter().take(4).map(|b| format!("{b:02x}")).collect()
    }

    /// `<data dir>/<profile>`: where this config's index cache and frecency
    /// file live (`clipboard.db` stays one level up, it is history, not a
    /// view of one config).
    pub fn data_dir(&self) -> PathBuf {
        fs::data_dir().join(self.profile())
    }

    /// The real file behind any symlink (dotfiles setups), or `path` while
    /// it does not exist yet. Edits and watches work on this one so a write
    /// never replaces a symlink with a plain file.
    pub(crate) fn target(&self) -> PathBuf {
        std::fs::canonicalize(&self.path).unwrap_or_else(|_| self.path.clone())
    }

    /// Read and parse. A missing file is the defaults, not an error; a file
    /// that does not parse is the defaults plus an error diagnostic (the
    /// watcher is what remembers the last good config across that).
    pub fn load(&self) -> Loaded {
        self.loaded(std::fs::read_to_string(self.target()).as_deref())
    }

    /// [`load`](Self::load) over a read already done, so the watcher parses
    /// the same bytes it compared.
    pub(crate) fn loaded(&self, read: Result<&str, &std::io::Error>) -> Loaded {
        let path = self.path.clone();
        let text = match read {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => "",
            Err(e) => return Loaded { path, config: Config::default(), diagnostics: vec![Diagnostic::io(e)] },
        };
        match parse(text) {
            Ok((config, diagnostics)) => Loaded { path, config, diagnostics },
            Err(d) => Loaded { path, config: Config::default(), diagnostics: vec![d] },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_empty() {
        let (c, d) = parse("").unwrap();
        assert_eq!(c, Config::default());
        assert_eq!(c.general.hotkey, "ctrl+space");
        assert_eq!(c.general.theme, Theme::System);
        assert!(d.is_empty());
    }

    #[test]
    fn file_layers_over_defaults_per_field() {
        let (c, d) = parse(
            r#"
[general]
theme = "dark"

[palettes.clipboard]
alias = "cb"
settings.history = 200

[extensions.github]
token = "keychain:pal/github-token"
"#,
        )
        .unwrap();
        assert!(d.is_empty());
        assert_eq!(c.general.hotkey, "ctrl+space", "untouched field keeps its default");
        assert_eq!(c.general.theme, Theme::Dark);
        let cb = &c.palettes["clipboard"];
        assert!(cb.enabled, "default survives next to a set sibling");
        assert_eq!(cb.alias.as_deref(), Some("cb"));
        assert_eq!(cb.settings["history"].as_integer(), Some(200));
        assert_eq!(c.extensions["github"]["token"].as_str(), Some("keychain:pal/github-token"));
        assert!(c.palette("nope").enabled);
    }

    #[test]
    fn general_additions_have_defaults() {
        let (c, _) = parse("").unwrap();
        assert!(!c.general.launch_at_login);
        assert!(c.general.menu_bar_icon, "the icon is on until turned off");
        assert!(c.general.check_updates, "the daily check is on until turned off");
        assert_eq!(c.general.position, Position::Top);
        assert!(c.general.extension_dirs.is_empty());
        let (c, d) = parse("[general]\nlaunch_at_login = true\nmenu_bar_icon = false\nposition = \"centre\"\ncheck_updates = false\nextension_dirs = [\"~/dotfiles/pal\", \"/opt/pal-ext\"]\n").unwrap();
        assert!(d.is_empty());
        assert!(c.general.launch_at_login);
        assert!(!c.general.menu_bar_icon);
        assert!(!c.general.check_updates);
        assert_eq!(c.general.position, Position::Centre);
        assert_eq!(c.general.extension_dirs(), [dirs::home_dir().unwrap().join("dotfiles/pal"), PathBuf::from("/opt/pal-ext")], "tilde expanded, order kept");
        assert!(parse("[general]\nposition = \"middle\"\n").is_err(), "an unknown position is a parse error, not a warning");
    }

    #[test]
    fn extension_settings_overlay_manifest_defaults() {
        let defaults: toml::Table = toml::from_str("max_entries = 200\nexclude_apps = [\"1Password\"]\nprimary_action = \"paste\"\n").unwrap();
        let (c, _) = parse("[extensions.clipboard]\nmax_entries = 500\nexclude_apps = []\nundeclared = 1\n\n[palettes.emoji.settings]\nskin = \"medium\"\n").unwrap();
        let s = c.extension_settings("clipboard", &defaults);
        assert_eq!(s["max_entries"].as_integer(), Some(500));
        assert_eq!(s["exclude_apps"].as_array().map(Vec::len), Some(0), "a set list replaces the default, no append");
        assert_eq!(s["primary_action"].as_str(), Some("paste"), "untouched key keeps its default");
        assert_eq!(s["undeclared"].as_integer(), Some(1), "undeclared keys pass through");
        assert_eq!(c.extension_settings("nope", &defaults), defaults, "no file entry: the defaults as given");
        let pd: toml::Table = toml::from_str("skin = \"none\"\ncolumns = 8\n").unwrap();
        let p = c.palette_settings("emoji", &pd);
        assert_eq!(p["skin"].as_str(), Some("medium"));
        assert_eq!(p["columns"].as_integer(), Some(8));
        assert_eq!(c.palette_settings("apps", &pd), pd);
    }

    #[test]
    fn spec_defaults_take_id_and_default() {
        let specs = serde_json::json!([
            { "kind": "number", "id": "n", "default": 3, "min": 1 },
            { "kind": "list", "id": "l", "default": ["a"] },
            { "kind": "secret", "id": "token" },
            { "kind": "text", "id": "t", "default": null },
        ]);
        let d = spec_defaults(&specs);
        assert_eq!(d["n"].as_integer(), Some(3));
        assert_eq!(d["l"].as_array().map(Vec::len), Some(1));
        assert!(!d.contains_key("token") && !d.contains_key("t"), "no default, no key");
        assert!(spec_defaults(&serde_json::Value::Null).is_empty());
    }

    #[test]
    fn resolved_settings_fetch_declared_secrets_only() {
        use secrets::MemStore;
        let store = MemStore::from(std::collections::HashMap::from([("pal/github-token".to_string(), "ghp_x".to_string())]));
        let specs = serde_json::json!([
            { "kind": "secret", "id": "token" },
            { "kind": "secret", "id": "other" },
            { "kind": "text", "id": "note", "default": "keychain:pal/github-token" },
            { "kind": "text", "id": "url", "default": "https://x" },
        ]);
        let (c, _) = parse("[extensions.github]\ntoken = \"keychain:pal/github-token\"\nother = \"keychain:pal/missing\"\nundeclared = \"keychain:pal/github-token\"\n\n[palettes.github.settings]\ntoken = \"keychain:pal/github-token\"\n").unwrap();
        let s = c.extension_settings_resolved("github", &specs, &store);
        assert_eq!(s["token"].as_str(), Some("ghp_x"), "a declared secret is fetched");
        assert_eq!(s["other"].as_str(), Some("keychain:pal/missing"), "a miss keeps the reference");
        assert_eq!(s["note"].as_str(), Some("keychain:pal/github-token"), "only kind: secret is resolved");
        assert_eq!(s["undeclared"].as_str(), Some("keychain:pal/github-token"), "an undeclared key is never resolved");
        assert_eq!(s["url"].as_str(), Some("https://x"));
        assert_eq!(c.extension_settings_resolved("github", &serde_json::Value::Null, &store)["token"].as_str(), Some("keychain:pal/github-token"), "no specs, no resolution");
        assert_eq!(c.palette_settings_resolved("github", &specs, &store)["token"].as_str(), Some("ghp_x"));
        std::env::set_var("PAL_TEST_RESOLVED", "from-env");
        let (c, _) = parse("[extensions.github]\ntoken = \"env:PAL_TEST_RESOLVED\"\n").unwrap();
        assert_eq!(c.extension_settings_resolved("github", &specs, &store)["token"].as_str(), Some("from-env"));
    }

    #[test]
    fn unknown_keys_are_kept_and_reported() {
        let (c, d) = parse(
            r#"
[general]
hotkey = "alt+space"
hotkeys = "typo"

[palette]
old = true

[palettes.x]
enabld = false
"#,
        )
        .unwrap();
        let paths: Vec<_> = d.iter().map(|d| d.path.as_str()).collect();
        assert_eq!(paths, ["palette", "general.hotkeys", "palettes.x.enabld"]);
        assert!(d.iter().all(|d| d.level == Level::Warning && d.message == "unknown key"));
        assert_eq!(c.general.hotkey, "alt+space");
        assert_eq!(c.general.extra["hotkeys"].as_str(), Some("typo"));
        assert!(c.palettes["x"].enabled, "typo'd key does not reach the real one");
        assert_eq!(c.extra["palette"]["old"].as_bool(), Some(true));
    }

    #[test]
    fn parse_error_has_line() {
        let d = parse("[general]\ntheme = \"dark\"\nhotkey = \n").unwrap_err();
        assert_eq!(d.level, Level::Error);
        assert_eq!(d.line, Some(3));
        assert!(d.path.is_empty());
    }

    #[test]
    fn bad_enum_is_an_error() {
        let d = parse("[general]\ntheme = \"blue\"\n").unwrap_err();
        assert_eq!(d.line, Some(2));
        assert!(d.message.contains("blue"), "{}", d.message);
    }

    #[test]
    fn error_at_line_start_gets_its_own_line() {
        assert_eq!(parse("x = 1\n]\n").unwrap_err().line, Some(2));
        assert_eq!(parse("x = 1\n\n\n= 2\n").unwrap_err().line, Some(4));
        assert_eq!(parse("= 2").unwrap_err().line, Some(1));
    }

    #[test]
    fn unreadable_file_is_an_error_diagnostic() {
        let dir = tempfile::tempdir().unwrap();
        let l = ConfigFile::new(dir.path()).load();
        assert!(l.has_errors(), "a directory does not read as a file");
        assert_eq!(l.config, Config::default());
    }

    #[test]
    fn load_missing_is_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let l = ConfigFile::new(dir.path().join("config.toml")).load();
        assert_eq!(l.config, Config::default());
        assert!(l.diagnostics.is_empty());
    }

    /// Env is process-global: the test that flips it and the one that
    /// reads `config_dir` twice in one call take turns.
    static ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn template_points_at_the_published_schema() {
        assert_eq!(TEMPLATE.lines().next(), Some(format!("#:schema {SCHEMA_URL}").as_str()));
    }

    #[test]
    fn locate_honours_env() {
        let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("PAL_CONFIG", "/x/pal.toml");
        assert_eq!(ConfigFile::locate().path(), Path::new("/x/pal.toml"));
        std::env::remove_var("PAL_CONFIG");
        std::env::set_var("XDG_CONFIG_HOME", "/xdg");
        assert_eq!(ConfigFile::locate().path(), Path::new("/xdg/pal/config.toml"));
        std::env::remove_var("XDG_CONFIG_HOME");
        assert!(ConfigFile::locate().path().ends_with(".config/pal/config.toml"), "dotfile location on every platform");
    }

    #[test]
    fn profile_keys_on_the_path() {
        let _env = ENV.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(ConfigFile::new(fs::config_dir().join("config.toml")).profile(), "default");
        let dir = tempfile::tempdir().unwrap();
        let a = ConfigFile::new(dir.path().join("pali.toml"));
        let b = ConfigFile::new(dir.path().join("other.toml"));
        let pa = a.profile();
        assert_eq!(pa.len(), 8);
        assert!(pa.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(pa, b.profile());
        assert_eq!(a.data_dir(), fs::data_dir().join(&pa));
        std::fs::write(a.path(), "").unwrap();
        assert_eq!(pa, a.profile(), "the same key once the file exists");
        // A symlink to the file keys as the file it points at.
        let link = dir.path().join("link.toml");
        std::os::unix::fs::symlink(a.path(), &link).unwrap();
        assert_eq!(ConfigFile::new(&link).profile(), pa);
    }
}
