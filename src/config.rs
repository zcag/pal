use std::collections::HashMap;

use figment::{Figment, providers::{Format, Toml, Env, Serialized}};
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
            .merge(Serialized::defaults(Config::base()))
            .merge(Toml::file("pal.default.toml"))
            .merge(Toml::file(user_config))
            .merge(Toml::file("pal.toml"))
            .merge(Toml::file(path))
            .merge(Env::prefixed("PAL_").split("_"));

        if let Some(ref level) = cli.log_level {
            figment = figment.merge(("general.log_level", level.as_str()));
        }

        figment.extract()
    }

    fn base() -> Self {
        let mut palette = HashMap::new();
        palette.insert("apps".into(), Palette {
            base: Some("builtin/palettes/apps".into()),
            cache: false,
            auto_list: false,
            auto_pick: false,
            data: None,
            include: vec![],
            default_action: None,
            action_key: None,
            extra: HashMap::new(),
        });
        palette.insert("bookmarks".into(), Palette {
            base: Some("builtin/palettes/bookmarks".into()),
            cache: false,
            auto_list: false,
            auto_pick: false,
            data: None,
            include: vec![],
            default_action: None,
            action_key: None,
            extra: HashMap::new(),
        });
        palette.insert("pals".into(), Palette {
            base: Some("builtin/palettes/pals".into()),
            cache: false,
            auto_list: false,
            auto_pick: false,
            data: None,
            include: vec![],
            default_action: None,
            action_key: None,
            extra: HashMap::new(),
        });
        palette.insert("psg".into(), Palette {
            base: Some("builtin/palettes/psg".into()),
            cache: false,
            auto_list: false,
            auto_pick: false,
            data: None,
            include: vec![],
            default_action: None,
            action_key: None,
            extra: HashMap::new(),
        });
        palette.insert("combine".into(), Palette {
            base: Some("builtin/palettes/combine".into()),
            cache: false,
            auto_list: false,
            auto_pick: false,
            data: None,
            include: vec![],
            default_action: None,
            action_key: None,
            extra: HashMap::new(),
        });

        Self {
            general: General::default(),
            palette,
            frontend: HashMap::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_default_config() {
        let cli = Cli { config: String::new(), log_level: None, command: None };
        let cfg = Config::load("pal.default.toml", &cli).unwrap();
        assert_eq!(cfg.general.default_palette, "mycommands");
        assert_eq!(cfg.general.default_frontend, "fzf");
        assert_eq!(cfg.palette.len(), 7);
        assert_eq!(cfg.palette["combine"].include, vec!["palettes", "commands"]);
        assert!(cfg.palette["psg"].auto_pick);
        assert_eq!(cfg.frontend["rofi"].base.as_deref(), Some("plugins/frontends/rofi"));
    }
}
