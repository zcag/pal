use std::path::{Path, PathBuf};
use std::process;

use serde::Serialize;

use crate::{builtin, util};

pub struct Plugin {
    base: String,
    exec: Option<PathBuf>,
    config: toml::Value,
}

impl Plugin {
    pub fn new(base: &str, user_config: &impl Serialize) -> Self {
        let plugin_toml = load_plugin_toml(base);
        let config = util::merge_configs(&plugin_toml, user_config);

        let exec = if base.starts_with("builtin/") {
            None
        } else {
            let cmd = plugin_toml.get("command")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or_else(|| {
                    eprintln!("plugin.toml missing 'command'");
                    process::exit(1);
                });
            Some(Path::new(base).join(cmd))
        };

        Self { base: base.to_string(), exec, config }
    }

    pub fn run(&self, cmd: &str, input: Option<&str>) -> String {
        if let Some(exec) = &self.exec {
            let config_str = serde_json::to_string(&self.config).unwrap();
            let data = input.unwrap_or(&config_str);
            util::run_command(exec, &[cmd], Some(data))
        } else {
            builtin::run(&self.base, cmd, &self.config, input)
        }
    }
}

fn load_plugin_toml(base: &str) -> toml::Value {
    if let Some(rest) = base.strip_prefix("builtin/") {
        load_builtin_toml(rest)
    } else {
        load_toml_file(&Path::new(base).join("plugin.toml"))
    }
}

fn load_builtin_toml(rest: &str) -> toml::Value {
    // rest is like "palettes/pals" -> extract [palettes.pals] from builtin.toml
    let parts: Vec<&str> = rest.split('/').collect();
    let toml = load_toml_file(Path::new("src/builtin/builtin.toml"));

    parts.iter().fold(toml, |v, key| {
        v.get(key).cloned().unwrap_or(toml::Value::Table(Default::default()))
    })
}

fn load_toml_file(path: &Path) -> toml::Value {
    match std::fs::read_to_string(path) {
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
