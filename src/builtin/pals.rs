use std::process::Command;
use serde_json::json;

use crate::config::Config;
use crate::Cli;

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
    let cli = Cli { config: config_file.clone(), ..Default::default() };
    let cfg = Config::load(&config_file, &cli).unwrap_or_else(|_| {
        return Config { general: Default::default(), palette: Default::default(), frontend: Default::default() };
    });

    // If inside a combine, only show palettes in its scope
    let scope: Option<Vec<&str>> = std::env::var("_PAL_COMBINE_SCOPE").ok()
        .map(|s| s.leak().split(',').collect());

    cfg.palette.iter()
        .filter(|(name, _)| scope.as_ref().map_or(true, |s| s.contains(&name.as_str())))
        .map(|(name, p)| {
            let icon = p.icon.as_deref().unwrap_or("view-list");
            json!({"id": name, "name": name, "icon": icon}).to_string()
        })
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
