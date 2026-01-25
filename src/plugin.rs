use std::path::{Path, PathBuf};
use std::process;

use serde::Serialize;

use crate::util;

pub struct Plugin {
    exec: PathBuf,
    config_str: String,
}

impl Plugin {
    pub fn new(base: &str, user_config: &impl Serialize) -> Self {
        let plugin_toml = load_plugin_toml(base);
        let config = util::merge_configs(&plugin_toml, user_config);

        let cmd = plugin_toml.get("command")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| {
                eprintln!("plugin.toml missing 'command'");
                process::exit(1);
            });

        Self {
            exec: Path::new(base).join(cmd),
            config_str: serde_json::to_string(&config).unwrap(),
        }
    }

    pub fn exec(&self) -> &Path {
        &self.exec
    }

    pub fn config_str(&self) -> &str {
        &self.config_str
    }
}

fn load_plugin_toml(base: &str) -> toml::Value {
    let path = Path::new(base).join("plugin.toml");
    match std::fs::read_to_string(&path) {
        Ok(s) => s.parse().unwrap_or_else(|e| {
            eprintln!("failed to parse {}: {e}", path.display());
            process::exit(1);
        }),
        Err(e) => {
            eprintln!("failed to read {}: {e}", path.display());
            process::exit(1);
        }
    }
}
