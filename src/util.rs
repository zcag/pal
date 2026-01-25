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

pub fn merge_configs(plugin_toml: &toml::Value, user_config: &impl Serialize) -> serde_json::Value {
    let mut combined = serde_json::Map::new();
    if let toml::Value::Table(t) = plugin_toml {
        for (k, v) in t {
            combined.insert(k.clone(), toml_to_json(v));
        }
    }
    if let serde_json::Value::Object(obj) = serde_json::to_value(user_config).unwrap() {
        for (k, v) in obj {
            if !v.is_null() {
                combined.insert(k, v);
            }
        }
    }
    serde_json::Value::Object(combined)
}

pub fn toml_to_json(v: &toml::Value) -> serde_json::Value {
    match v {
        toml::Value::String(s) => serde_json::Value::String(s.clone()),
        toml::Value::Integer(i) => serde_json::json!(*i),
        toml::Value::Float(f) => serde_json::json!(*f),
        toml::Value::Boolean(b) => serde_json::Value::Bool(*b),
        toml::Value::Array(a) => serde_json::Value::Array(a.iter().map(toml_to_json).collect()),
        toml::Value::Table(t) => {
            let mut map = serde_json::Map::new();
            for (k, val) in t {
                map.insert(k.clone(), toml_to_json(val));
            }
            serde_json::Value::Object(map)
        }
        toml::Value::Datetime(d) => serde_json::Value::String(d.to_string()),
    }
}
