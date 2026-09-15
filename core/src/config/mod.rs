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
//! - [`secrets`] resolves `keychain:` / `env:` references lazily, so secrets
//!   never sit in the file as plain text.

mod edit;
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
    /// for a compositor keybind that runs `pal-app toggle` instead.
    pub hotkey: String,
    pub theme: Theme,
    #[serde(flatten, skip_serializing_if = "BTreeMap::is_empty")]
    #[schemars(skip)]
    pub extra: BTreeMap<String, toml::Value>,
}

impl Default for General {
    fn default() -> Self {
        Self { hotkey: "ctrl+space".into(), theme: Theme::System, extra: BTreeMap::new() }
    }
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
    /// Short name that jumps straight into this palette from root search.
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
#[derive(Debug, Clone, PartialEq)]
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

/// Header written when an edit creates the file. `#:schema` is taplo's
/// directive; [`schema::install`] puts the schema next to the file.
pub const TEMPLATE: &str = "#:schema ./config.schema.json\n# pal settings. The settings view writes this file; editing by hand is fine too.\n";

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

    #[test]
    fn locate_honours_env() {
        // Env is process-global; both cases in one test to avoid races.
        std::env::set_var("PAL_CONFIG", "/x/pal.toml");
        assert_eq!(ConfigFile::locate().path(), Path::new("/x/pal.toml"));
        std::env::remove_var("PAL_CONFIG");
        std::env::set_var("XDG_CONFIG_HOME", "/xdg");
        assert_eq!(ConfigFile::locate().path(), Path::new("/xdg/pal/config.toml"));
        std::env::remove_var("XDG_CONFIG_HOME");
        assert!(ConfigFile::locate().path().ends_with(".config/pal/config.toml"), "dotfile location on every platform");
    }
}
