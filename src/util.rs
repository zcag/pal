use std::io::Write;
use std::path::Path;
use std::process::{self, Command, Stdio};

use serde::Serialize;

pub fn run_command(exec: &Path, args: &[&str], stdin_data: Option<&str>) -> String {
    let mut child = Command::new(exec)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run {}: {e}", exec.display());
            process::exit(1);
        });

    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(data.as_bytes());
        }
    }

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on {}: {e}", exec.display());
        process::exit(1);
    });

    String::from_utf8_lossy(&output.stdout).into_owned()
}

pub fn merge_configs(plugin_toml: &toml::Value, user_config: &impl Serialize) -> toml::Value {
    let mut combined = toml::map::Map::new();
    if let toml::Value::Table(t) = plugin_toml {
        for (k, v) in t {
            combined.insert(k.clone(), v.clone());
        }
    }
    // Convert user_config to toml::Value and merge
    let user_toml: toml::Value = toml::Value::try_from(user_config).unwrap_or(toml::Value::Table(Default::default()));
    if let toml::Value::Table(t) = user_toml {
        for (k, v) in t {
            combined.insert(k, v);
        }
    }
    toml::Value::Table(combined)
}
