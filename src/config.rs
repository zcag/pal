use std::collections::HashMap;

use figment::{Figment, providers::{Format, Toml, Env}};
use serde::{Deserialize, Serialize};

use crate::Cli;

#[derive(Debug, Deserialize, Serialize)]
pub struct Config {
    #[serde(default)]
    pub general: General,
    #[serde(default)]
    pub palette: HashMap<String, Palette>,
    #[serde(default)]
    pub frontend: HashMap<String, Frontend>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct General {
    #[serde(default = "defaults::palette")]
    pub default_palette: String,
    #[serde(default = "defaults::frontend")]
    pub default_frontend: String,
    pub env_file: Option<String>,
}

/// How a rich frontend should present a palette. Every field is a hint: the
/// terminal frontends have no equivalent and ignore the block wholesale.
#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Display {
    /// Open with the detail pane showing, for palettes you read rather than scan.
    #[serde(default)]
    pub detail: bool,
    /// Grid tiles per row.
    pub columns: Option<u32>,
    /// Grid tile shape: "1", "3/2", "2/3", "4/3", "3/4", "16/9", "9/16".
    pub aspect: Option<String>,
    /// "contain" (default) or "fill".
    pub fit: Option<String>,
    /// Padding inside a grid tile: "none", "small", "medium", "large".
    pub inset: Option<String>,
}

/// One entry in a palette's scope dropdown. The chosen id reaches the plugin
/// as `PAL_FILTER`; the first entry is the default, so it should be the
/// unfiltered one.
#[derive(Debug, Deserialize, Serialize)]
pub struct Filter {
    pub id: String,
    pub name: Option<String>,
    pub icon: Option<String>,
    pub icon_xdg: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Palette {
    pub base: Option<String>,
    pub icon: Option<String>,
    pub icon_xdg: Option<String>,
    pub icon_utf: Option<String>,
    #[serde(default)]
    pub cache: bool,
    #[serde(default)]
    pub input: bool,
    pub input_prompt: Option<String>,
    #[serde(default)]
    pub live: bool,
    #[serde(default)]
    pub auto_list: bool,
    #[serde(default)]
    pub auto_pick: bool,
    pub data: Option<String>,
    #[serde(default)]
    pub include: Vec<String>,
    pub default_action: Option<String>,
    pub action_key: Option<String>,
    /// Default actions for items that don't declare their own.
    #[serde(default)]
    pub actions: Vec<serde_json::Value>,
    /// Rendering hint for rich frontends: "list" (default) or "grid".
    pub view: Option<String>,
    /// Binaries this palette's backend needs, `|` between alternatives
    /// ("pactl|wpctl"). Unmet requirements hide the palette from listings.
    #[serde(default)]
    pub requires: Vec<String>,
    /// Restrict to one platform, when no binary describes the difference:
    /// "linux" or "macos".
    pub os: Option<String>,
    /// Presentation hints for rich frontends.
    #[serde(default)]
    pub display: Display,
    /// Scope dropdown entries, empty for palettes that don't want one.
    #[serde(default)]
    pub filter: Vec<Filter>,
    /// How long a driver may reuse cached items, in seconds.
    pub ttl: Option<u64>,
    /// Human description, surfaced by `pal meta`.
    pub desc: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Palette {
    /// Can this palette do anything on this machine? An unavailable palette is
    /// hidden from listings but still addressable by name, so `pal list wifi`
    /// on a mac still tells you why rather than "palette not found".
    pub fn available(&self) -> bool {
        if self.os.as_deref().is_some_and(|os| !os.eq_ignore_ascii_case(std::env::consts::OS)) {
            return false;
        }
        self.requires
            .iter()
            .all(|req| req.split('|').any(|bin| crate::util::has_binary(bin.trim())))
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Frontend {
    pub base: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for General {
    fn default() -> Self {
        Self {
            default_palette: defaults::palette(),
            default_frontend: defaults::frontend(),
            env_file: None,
        }
    }
}

mod defaults {
    pub fn palette() -> String { "combine".into() }
    pub fn frontend() -> String { "fzf".into() }
}

impl Config {
    pub fn load(path: &str, cli: &Cli) -> Result<Self, figment::Error> {
        let user_config = crate::util::config_dir().join("config.toml");

        let mut figment = Figment::new()
            .merge(Toml::file("pal.default.toml"))
            .merge(Toml::file(&user_config))
            .merge(Toml::file("pal.toml"));

        // Only merge explicit --config if it's not the default
        let is_default = path.ends_with("pal.default.toml") || path == "pal.default.toml";
        if !is_default {
            figment = figment.merge(Toml::file(path));
        }

        let mut figment = figment.merge(Env::prefixed("PAL_").split("_"));

        if let Some(ref level) = cli.log_level {
            figment = figment.merge(("general.log_level", level.as_str()));
        }

        let mut config: Self = figment.extract()?;
        config.resolve_plugin_defaults();
        config.expand_data_paths(&user_config);
        Ok(config)
    }

    /// Expand relative data paths to absolute paths (relative to user config dir)
    fn expand_data_paths(&mut self, user_config: &std::path::Path) {
        let config_dir = user_config.parent().unwrap_or(std::path::Path::new(""));
        for palette in self.palette.values_mut() {
            if let Some(data) = palette.data.take() {
                // Skip if already absolute, home-relative, or remote
                if data.starts_with('/') || data.starts_with("~/") || data.starts_with("github:") {
                    palette.data = Some(data);
                    continue;
                }
                // Expand relative to user config dir
                let expanded = config_dir.join(&data);
                palette.data = Some(expanded.to_string_lossy().into_owned());
            }
        }
    }

    /// Fill in missing palette fields from plugin.toml files
    fn resolve_plugin_defaults(&mut self) {
        for (_name, palette) in self.palette.iter_mut() {
            if let Some(base) = &palette.base {
                if let Some(plugin) = load_plugin_toml(base) {
                    if palette.icon.is_none() {
                        palette.icon = plugin.get("icon").and_then(|v| v.as_str()).map(String::from);
                    }
                    if palette.icon_xdg.is_none() {
                        palette.icon_xdg = plugin.get("icon_xdg").and_then(|v| v.as_str()).map(String::from);
                    }
                    if palette.icon_utf.is_none() {
                        palette.icon_utf = plugin.get("icon_utf").and_then(|v| v.as_str()).map(String::from);
                    }
                    if !palette.auto_list {
                        palette.auto_list = plugin.get("auto_list").and_then(|v| v.as_bool()).unwrap_or(false);
                    }
                    if !palette.auto_pick {
                        palette.auto_pick = plugin.get("auto_pick").and_then(|v| v.as_bool()).unwrap_or(false);
                    }
                    if palette.default_action.is_none() {
                        palette.default_action = plugin.get("default_action").and_then(|v| v.as_str()).map(String::from);
                    }
                    if palette.action_key.is_none() {
                        palette.action_key = plugin.get("action_key").and_then(|v| v.as_str()).map(String::from);
                    }
                    if !palette.input {
                        palette.input = plugin.get("input").and_then(|v| v.as_bool()).unwrap_or(false);
                    }
                    if palette.input_prompt.is_none() {
                        palette.input_prompt = plugin.get("input_prompt").and_then(|v| v.as_str()).map(String::from);
                    }
                    if !palette.live {
                        palette.live = plugin.get("live").and_then(|v| v.as_bool()).unwrap_or(false);
                    }
                    if palette.desc.is_none() {
                        palette.desc = plugin.get("desc").and_then(|v| v.as_str()).map(String::from);
                    }
                    if palette.view.is_none() {
                        palette.view = plugin.get("view").and_then(|v| v.as_str()).map(String::from);
                    }
                    // A plugin knows its own dependencies; config.toml may still
                    // override, which is how you force a palette back on.
                    if palette.requires.is_empty() {
                        palette.requires = plugin.get("requires").cloned()
                            .and_then(|v| v.try_into().ok())
                            .unwrap_or_default();
                    }
                    if palette.os.is_none() {
                        palette.os = plugin.get("os").and_then(|v| v.as_str()).map(String::from);
                    }
                    // Whole blocks rather than field-by-field: a palette that
                    // overrides presentation at all means to own it.
                    if let Some(display) = plugin.get("display").cloned().and_then(|v| v.try_into().ok()) {
                        palette.display = display;
                    }
                    if palette.filter.is_empty() {
                        palette.filter = plugin.get("filter").cloned()
                            .and_then(|v| v.try_into().ok())
                            .unwrap_or_default();
                    }
                    if palette.ttl.is_none() {
                        palette.ttl = plugin.get("ttl").and_then(|v| v.as_integer()).map(|v| v as u64);
                    }
                    if palette.actions.is_empty() {
                        if let Some(actions) = plugin.get("actions").and_then(|v| v.as_array()) {
                            palette.actions = actions
                                .iter()
                                .filter_map(|a| serde_json::to_value(a).ok())
                                .collect();
                        }
                    }
                }
            }
        }
    }
}

/// Load plugin.toml or builtin.toml section
fn load_plugin_toml(base: &str) -> Option<toml::Value> {
    use crate::util;

    if let Some(rest) = base.strip_prefix("builtin/") {
        // Load from builtin.toml
        let parts: Vec<&str> = rest.split('/').collect();
        let toml: toml::Value = include_str!("builtin/builtin.toml").parse().ok()?;
        let section = parts.iter().fold(toml, |v, key| {
            v.get(key).cloned().unwrap_or(toml::Value::Table(Default::default()))
        });
        Some(section)
    } else if base.starts_with("github:") {
        // Load from remote plugin - ensure it's cloned first
        let local_path = crate::remote::ensure_github(base)?;
        let plugin_toml = local_path.join("plugin.toml");
        let content = std::fs::read_to_string(plugin_toml).ok()?;
        content.parse().ok()
    } else {
        // Load from plugin.toml
        let expanded = util::expand_path(base);
        let plugin_toml = expanded.join("plugin.toml");
        let content = std::fs::read_to_string(plugin_toml).ok()?;
        content.parse().ok()
    }
}

