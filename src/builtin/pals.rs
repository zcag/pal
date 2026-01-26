use std::process::Command;
use serde_json::json;

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "list" => list(),
        "pick" => pick(input.unwrap_or("")),
        _ => {
            eprintln!("pals: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn list() -> String {
    let config_file = std::env::var("_PAL_CONFIG").unwrap_or_else(|_| "pal.default.toml".into());

    let content = std::fs::read_to_string(&config_file).unwrap_or_default();
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

    let config_file = std::env::var("_PAL_CONFIG").unwrap_or_else(|_| "pal.default.toml".into());
    let frontend = std::env::var("_PAL_FRONTEND").unwrap_or_default();

    let mut args = vec!["-c", &config_file, "run"];
    if !frontend.is_empty() {
        args.push(&frontend);
    }
    args.push(palette);

    let _ = Command::new("pal").args(&args).status();

    String::new()
}
