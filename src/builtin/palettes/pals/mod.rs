use std::process::Command;
use serde_json::json;

pub fn run(cmd: &str, config: &str) -> String {
    match cmd {
        "list" => list(config),
        "pick" => pick(config),
        _ => {
            eprintln!("palettes: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn list(config: &str) -> String {
    let cfg: serde_json::Value = serde_json::from_str(config).unwrap_or_default();
    let config_file = cfg.get("config_file")
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

fn pick(config: &str) -> String {
    let item: serde_json::Value = serde_json::from_str(config).unwrap_or_default();
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
