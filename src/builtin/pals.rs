use std::process::Command;
use serde_json::json;

pub fn run(cmd: &str, config: &toml::Value, input: Option<&str>) -> String {
    match cmd {
        "list" => list(config),
        "pick" => pick(input.unwrap_or("")),
        _ => {
            eprintln!("pals: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn list(config: &toml::Value) -> String {
    let config_file = config.get("config_file")
        .and_then(|v| v.as_str())
        .unwrap_or("pal.default.toml");

    let content = std::fs::read_to_string(config_file).unwrap_or_default();
    content.lines()
        .filter_map(|line| {
            let t = line.trim();
            t.strip_prefix("[palette.")?.strip_suffix("]")
        })
        .map(|name| json!({"id": name, "name": name, "icon": ""}).to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn pick(input: &str) -> String {
    let item: serde_json::Value = serde_json::from_str(input).unwrap_or_default();
    let palette = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

    if palette.is_empty() {
        return String::new();
    }

    Command::new("pal")
        .args(["run", "--", palette])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}
