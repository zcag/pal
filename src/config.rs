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
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Palette {
    pub base: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub cache: bool,
    #[serde(default)]
    pub auto_list: bool,
    #[serde(default)]
    pub auto_pick: bool,
    pub data: Option<String>,
    #[serde(default)]
    pub include: Vec<String>,
    pub default_action: Option<String>,
    pub action_key: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
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
        }
    }
}

mod defaults {
    pub fn palette() -> String { "combine".into() }
    pub fn frontend() -> String { "fzf".into() }
}

impl Config {
    pub fn load(path: &str, cli: &Cli) -> Result<Self, figment::Error> {
        let user_config = dirs::config_dir()
            .map(|p| p.join("pal/config.toml"))
            .unwrap_or_default();

        let mut figment = Figment::new()
            .merge(Toml::file("pal.default.toml"))
            .merge(Toml::file(user_config))
            .merge(Toml::file("pal.toml"))
            .merge(Toml::file(path))
            .merge(Env::prefixed("PAL_").split("_"));

        if let Some(ref level) = cli.log_level {
            figment = figment.merge(("general.log_level", level.as_str()));
        }

        let mut config: Self = figment.extract()?;
        config.resolve_plugin_defaults();
        Ok(config)
    }

    /// Fill in missing palette fields from plugin.toml files
    fn resolve_plugin_defaults(&mut self) {
        for (_name, palette) in self.palette.iter_mut() {
            if let Some(base) = &palette.base {
                if let Some(plugin) = load_plugin_toml(base) {
                    if palette.icon.is_none() {
                        palette.icon = plugin.get("icon").and_then(|v| v.as_str()).map(String::from);
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

