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
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Frontend {
    pub bin: String,
    #[serde(default)]
    pub args: Vec<String>,
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
        let mut figment = Figment::new()
            .merge(Serialized::defaults(Config::base()))
            .merge(Toml::file(path))
            .merge(Env::prefixed("PAL_").split("_"));

        if let Some(ref level) = cli.log_level {
            figment = figment.merge(("general.log_level", level.as_str()));
        }

        figment.extract()
    }

    fn base() -> Self {
        Self {
            general: General::default(),
            palette: HashMap::new(),
            frontend: HashMap::from([(
                "fzf".into(),
                Frontend { bin: "fzf".into(), args: vec![] },
            )]),
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
        assert_eq!(cfg.general.default_palette, "combine");
        assert_eq!(cfg.general.default_frontend, "fzf");
        assert_eq!(cfg.palette.len(), 6);
        assert_eq!(cfg.palette["combine"].include, vec!["palettes", "commands"]);
        assert!(cfg.palette["psg"].auto_pick);
        assert_eq!(cfg.frontend["rofi"].args, vec!["-normal-window"]);
    }
}
