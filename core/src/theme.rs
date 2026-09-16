//! A theme file: the `--pal-*` tokens a user may override, as one TOML
//! (`[general] theme_file`, `docs/config.md`). Parsed here into the CSS
//! variables the app sets on `:root` (`app/src/theme.ts`), a section per
//! scheme:
//!
//! ```toml
//! name = "Catppuccin Frappé"
//! radius_row = 6          # shared by both schemes
//! [light]
//! accent = "#8839ef"
//! [dark]
//! accent = "#ca9ee6"
//! ```
//!
//! Every key is checked against [`TOKENS`]: an unknown key is a warning
//! diagnostic (the file's dotted path), a value of the wrong shape (a
//! colour that is not `#hex` or `rgb()`, a radius that is not a number)
//! is dropped with a warning, and the rest applies. Nothing else in pal
//! reads the file: the shell watches it (`app/src-tauri/src/theme.rs`)
//! and the pages apply what comes.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::Diagnostic;

/// What a token's value has to be.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `#rgb`, `#rrggbb`, `#rrggbbaa`, or an `rgb()`, `rgba()`, `hsl()`, `hsla()` call.
    Color,
    /// A number of pixels (`14`, `6.5`, or `"14px"`).
    Length,
    /// A font stack, as CSS writes it.
    Font,
}

/// The keys a theme file may set, each with the CSS variable it drives
/// (`--pal-<name>`, tokens.css) and what it takes. The brief's overridable
/// set: the accent, the backgrounds, the text colours, the lines and the
/// selection, the match highlight, the tag palette, the brand tiles, the
/// radii and the two font stacks. Geometry, motion and spacing stay pal's.
pub const TOKENS: &[(&str, Kind)] = &[
    ("accent", Kind::Color),
    ("accent_fg", Kind::Color),
    ("accent_soft", Kind::Color),
    ("bg", Kind::Color),
    ("bg_glass", Kind::Color),
    ("bg_elevated", Kind::Color),
    ("bg_sunken", Kind::Color),
    ("fg", Kind::Color),
    ("fg_muted", Kind::Color),
    ("fg_faint", Kind::Color),
    ("line", Kind::Color),
    ("line_strong", Kind::Color),
    ("selection", Kind::Color),
    ("scrim", Kind::Color),
    ("match", Kind::Color),
    ("knob", Kind::Color),
    ("destructive", Kind::Color),
    ("destructive_soft", Kind::Color),
    ("success", Kind::Color),
    ("success_soft", Kind::Color),
    ("tag_grey", Kind::Color),
    ("tag_grey_bg", Kind::Color),
    ("tag_blue", Kind::Color),
    ("tag_blue_bg", Kind::Color),
    ("tag_green", Kind::Color),
    ("tag_green_bg", Kind::Color),
    ("tag_amber", Kind::Color),
    ("tag_amber_bg", Kind::Color),
    ("tag_red", Kind::Color),
    ("tag_red_bg", Kind::Color),
    ("tag_violet", Kind::Color),
    ("tag_violet_bg", Kind::Color),
    ("tag_pink", Kind::Color),
    ("tag_pink_bg", Kind::Color),
    ("tag_teal", Kind::Color),
    ("tag_teal_bg", Kind::Color),
    ("brand_red", Kind::Color),
    ("brand_orange", Kind::Color),
    ("brand_amber", Kind::Color),
    ("brand_green", Kind::Color),
    ("brand_teal", Kind::Color),
    ("brand_cyan", Kind::Color),
    ("brand_blue", Kind::Color),
    ("brand_indigo", Kind::Color),
    ("brand_violet", Kind::Color),
    ("brand_pink", Kind::Color),
    ("brand_slate", Kind::Color),
    ("brand_ink", Kind::Color),
    ("tile_fg", Kind::Color),
    ("tile_ring", Kind::Color),
    ("radius_panel", Kind::Length),
    ("radius_popover", Kind::Length),
    ("radius_hud", Kind::Length),
    ("radius_tile", Kind::Length),
    ("radius_row", Kind::Length),
    ("radius_icon", Kind::Length),
    ("radius_control", Kind::Length),
    ("radius_tag", Kind::Length),
    ("radius_kbd", Kind::Length),
    ("font_ui", Kind::Font),
    ("font_mono", Kind::Font),
];

/// The kind of a key, when it is a token.
pub fn kind_of(key: &str) -> Option<Kind> {
    TOKENS.iter().find(|(k, _)| *k == key).map(|(_, kind)| *kind)
}

/// `accent_fg` to `--pal-accent-fg`.
pub fn css_var(key: &str) -> String {
    format!("--pal-{}", key.replace('_', "-"))
}

/// A theme as the pages apply it: the CSS variables per scheme (a key set
/// at the top level lands in both), with the file's name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Theme {
    pub name: Option<String>,
    pub light: BTreeMap<String, String>,
    pub dark: BTreeMap<String, String>,
}

impl Theme {
    pub fn is_empty(&self) -> bool {
        self.light.is_empty() && self.dark.is_empty()
    }
}

/// What a parse answers: the theme (what was valid) and what was not.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Parsed {
    pub theme: Theme,
    pub diagnostics: Vec<Diagnostic>,
}

fn hex_ok(s: &str) -> bool {
    matches!(s.len(), 3 | 4 | 6 | 8) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// A colour as the file may write it; the value to set, lower-cased hex.
fn color(v: &toml::Value) -> Option<String> {
    let s = v.as_str()?.trim();
    if let Some(h) = s.strip_prefix('#') {
        return hex_ok(h).then(|| format!("#{}", h.to_ascii_lowercase()));
    }
    let lower = s.to_ascii_lowercase();
    let call = ["rgb(", "rgba(", "hsl(", "hsla("].iter().any(|p| lower.starts_with(p));
    let inner_ok = lower.ends_with(')') && lower[lower.find('(')? + 1..lower.len() - 1].chars().all(|c| c.is_ascii_digit() || " ,./%-".contains(c));
    (call && inner_ok).then_some(lower)
}

/// A length as the file may write it: a number of pixels, or `"14px"`.
fn length(v: &toml::Value) -> Option<String> {
    let px = match v {
        toml::Value::Integer(n) if *n >= 0 => *n as f64,
        toml::Value::Float(f) if *f >= 0.0 && f.is_finite() => *f,
        toml::Value::String(s) => s.trim().strip_suffix("px")?.trim().parse::<f64>().ok().filter(|f| *f >= 0.0)?,
        _ => return None,
    };
    Some(if px.fract() == 0.0 { format!("{}px", px as i64) } else { format!("{px}px") })
}

/// A font stack: any non-empty string that cannot end the declaration.
fn font(v: &toml::Value) -> Option<String> {
    let s = v.as_str()?.trim();
    (!s.is_empty() && !s.contains([';', '{', '}'])).then(|| s.to_string())
}

/// One key into its variable and value, or a diagnostic.
fn token(path: &str, key: &str, v: &toml::Value) -> Result<(String, String), Diagnostic> {
    let at = if path.is_empty() { key.to_string() } else { format!("{path}.{key}") };
    let Some(kind) = kind_of(key) else {
        return Err(Diagnostic::warn(at, "not a theme token; docs/config.md lists them"));
    };
    let value = match kind {
        Kind::Color => color(v).ok_or("a colour: #rrggbb, #rrggbbaa, or rgb()/hsl()"),
        Kind::Length => length(v).ok_or("a number of pixels"),
        Kind::Font => font(v).ok_or("a font stack, as CSS writes it"),
    };
    value.map(|val| (css_var(key), val)).map_err(|want| Diagnostic::warn(at, format!("ignored: expected {want}")))
}

/// Parse a theme file's text. A file that does not parse as TOML is one
/// error diagnostic and an empty theme.
pub fn parse(text: &str) -> Parsed {
    let table: toml::Table = match text.parse() {
        Ok(t) => t,
        Err(e) => {
            let line = e.span().map(|s| text[..s.start.min(text.len())].lines().count().max(1));
            return Parsed { theme: Theme::default(), diagnostics: vec![Diagnostic { level: crate::config::Level::Error, path: String::new(), line, message: e.message().to_string() }] };
        }
    };
    let mut out = Parsed::default();
    for (key, v) in &table {
        match key.as_str() {
            "name" => match v.as_str() {
                Some(n) if !n.trim().is_empty() => out.theme.name = Some(n.trim().to_string()),
                _ => out.diagnostics.push(Diagnostic::warn("name".into(), "ignored: expected a string")),
            },
            "light" | "dark" => {
                let Some(section) = v.as_table() else {
                    out.diagnostics.push(Diagnostic::warn(key.clone(), "expected a table of tokens"));
                    continue;
                };
                for (k, sv) in section {
                    match token(key, k, sv) {
                        Ok((var, val)) => {
                            let into = if key == "light" { &mut out.theme.light } else { &mut out.theme.dark };
                            into.insert(var, val);
                        }
                        Err(d) => out.diagnostics.push(d),
                    }
                }
            }
            _ => match token("", key, v) {
                Ok((var, val)) => {
                    // A top-level token is both schemes', under what the sections say.
                    out.theme.light.entry(var.clone()).or_insert_with(|| val.clone());
                    out.theme.dark.entry(var).or_insert(val);
                }
                Err(d) => out.diagnostics.push(d),
            },
        }
    }
    // The sections win over the top level whatever the file's order: re-apply them.
    for (key, into) in [("light", &mut out.theme.light), ("dark", &mut out.theme.dark)] {
        if let Some(section) = table.get(key).and_then(toml::Value::as_table) {
            for (k, sv) in section {
                if let Ok((var, val)) = token(key, k, sv) {
                    into.insert(var, val);
                }
            }
        }
    }
    out
}

/// Where the themes a picker lists live: `<config dir>/themes/`, next to
/// `config.toml`.
pub fn themes_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("themes")
}

/// `general.theme_file` to a path: a bare name (`catppuccin-frappe`, with
/// or without `.toml`) is `<config dir>/themes/<name>.toml`, anything else
/// a path with `~` expanded. Empty is no theme.
pub fn resolve(setting: &str, config_dir: &Path) -> Option<PathBuf> {
    let s = setting.trim();
    if s.is_empty() {
        return None;
    }
    if !s.contains(['/', '\\']) && !s.starts_with(['~', '.']) {
        let name = s.strip_suffix(".toml").unwrap_or(s);
        return Some(themes_dir(config_dir).join(format!("{name}.toml")));
    }
    Some(crate::fs::expand_home(s))
}

/// One file of the themes dir, for the picker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Entry {
    /// The file name without `.toml`: what `theme_file` takes.
    pub name: String,
    pub path: PathBuf,
    /// The file's `name`, when it parses and has one; the file name otherwise.
    pub title: String,
}

/// Every `*.toml` in the themes dir, by name; none when the dir is missing.
pub fn list(config_dir: &Path) -> Vec<Entry> {
    let dir = themes_dir(config_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<Entry> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_str()?.strip_suffix(".toml")?.to_string();
            if name.starts_with('.') || !path.is_file() {
                return None;
            }
            let title = std::fs::read_to_string(&path).ok().and_then(|t| parse(&t).theme.name).unwrap_or_else(|| name.clone());
            Some(Entry { name, path, title })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Read and parse the file at `path`: a missing or unreadable file is one
/// error diagnostic and an empty theme.
pub fn load(path: &Path) -> Parsed {
    match std::fs::read_to_string(path) {
        Ok(t) => parse(&t),
        Err(e) => Parsed { theme: Theme::default(), diagnostics: vec![Diagnostic { level: crate::config::Level::Error, path: String::new(), line: None, message: format!("{}: {e}", path.display()) }] },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_map_to_variables_and_values_are_checked() {
        let p = parse(
            r##"
name = "Test"
radius_row = 6
font_ui = "Inter, sans-serif"
[light]
accent = "#4F46D6"
bg = "rgba(244, 244, 246, 0.84)"
[dark]
accent = "#9f97ff"
radius_row = "8px"
"##,
        );
        assert!(p.diagnostics.is_empty(), "{:?}", p.diagnostics);
        assert_eq!(p.theme.name.as_deref(), Some("Test"));
        assert_eq!(p.theme.light["--pal-accent"], "#4f46d6");
        assert_eq!(p.theme.light["--pal-bg"], "rgba(244, 244, 246, 0.84)");
        assert_eq!(p.theme.light["--pal-radius-row"], "6px", "a top-level key lands in both");
        assert_eq!(p.theme.dark["--pal-radius-row"], "8px", "the section wins");
        assert_eq!(p.theme.light["--pal-font-ui"], "Inter, sans-serif");
        assert_eq!(p.theme.dark["--pal-font-ui"], "Inter, sans-serif");
        assert_eq!(p.theme.dark["--pal-accent"], "#9f97ff");
        assert!(!p.theme.dark.contains_key("--pal-bg"));
    }

    #[test]
    fn unknown_keys_and_bad_values_are_warnings_and_the_rest_applies() {
        let p = parse(
            r##"
accnet = "#fff"
radius_row = -2
[light]
accent = "red"
fg = "#12"
bg = "#fff"
bg_glass = "rgb(1, 2, 3; )"
font_mono = "Menlo; color: red"
[dark]
accent = 7
"##,
        );
        let mut paths: Vec<&str> = p.diagnostics.iter().map(|d| d.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, ["accnet", "dark.accent", "light.accent", "light.bg_glass", "light.fg", "light.font_mono", "radius_row"]);
        assert!(p.diagnostics.iter().all(|d| d.level == crate::config::Level::Warning));
        assert!(p.diagnostics[0].message.contains("not a theme token"));
        assert_eq!(p.theme.light.len(), 1);
        assert_eq!(p.theme.light["--pal-bg"], "#fff");
        assert!(p.theme.dark.is_empty());
    }

    #[test]
    fn a_broken_file_is_one_error_with_its_line() {
        let p = parse("name = \"x\"\n[light\naccent = 1\n");
        assert!(p.theme.is_empty());
        assert_eq!(p.diagnostics.len(), 1);
        assert_eq!(p.diagnostics[0].level, crate::config::Level::Error);
        assert_eq!(p.diagnostics[0].line, Some(2));
    }

    #[test]
    fn the_setting_resolves_to_the_themes_dir_or_a_path() {
        let dir = Path::new("/cfg/pal");
        assert_eq!(resolve("", dir), None);
        assert_eq!(resolve("  ", dir), None);
        assert_eq!(resolve("catppuccin-frappe", dir), Some(PathBuf::from("/cfg/pal/themes/catppuccin-frappe.toml")));
        assert_eq!(resolve("catppuccin-frappe.toml", dir), Some(PathBuf::from("/cfg/pal/themes/catppuccin-frappe.toml")));
        assert_eq!(resolve("/tmp/t.toml", dir), Some(PathBuf::from("/tmp/t.toml")));
        assert_eq!(resolve("./t.toml", dir), Some(PathBuf::from("./t.toml")));
        let home = resolve("~/x.toml", dir).unwrap();
        assert!(home.is_absolute() && home.ends_with("x.toml") && !home.starts_with("~"));
    }

    #[test]
    fn the_themes_dir_lists_toml_files_by_name_with_their_titles() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = themes_dir(tmp.path());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("b.toml"), "name = \"Bee\"\n").unwrap();
        std::fs::write(dir.join("a.toml"), "[light]\naccent = \"#000\"\n").unwrap();
        std::fs::write(dir.join(".hidden.toml"), "").unwrap();
        std::fs::write(dir.join("notes.txt"), "").unwrap();
        let l = list(tmp.path());
        assert_eq!(l.iter().map(|e| (e.name.as_str(), e.title.as_str())).collect::<Vec<_>>(), [("a", "a"), ("b", "Bee")]);
        assert_eq!(l[1].path, dir.join("b.toml"));
        assert!(list(Path::new("/nonexistent/x")).is_empty());
        let missing = load(&dir.join("gone.toml"));
        assert_eq!(missing.diagnostics.len(), 1);
        assert!(missing.theme.is_empty());
    }

    #[test]
    fn the_bundled_examples_parse_clean() {
        for text in [include_str!("../../examples/themes/catppuccin-frappe.toml"), include_str!("../../examples/themes/rose-pine-dawn.toml")] {
            let p = parse(text);
            assert!(p.diagnostics.is_empty(), "{:?}", p.diagnostics);
            assert!(p.theme.name.is_some());
            assert!(p.theme.light.contains_key("--pal-accent") && p.theme.dark.contains_key("--pal-accent"));
            assert!(p.theme.light.contains_key("--pal-bg") && p.theme.dark.contains_key("--pal-bg"));
        }
    }
}
