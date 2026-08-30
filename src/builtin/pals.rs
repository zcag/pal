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

    let mut palettes: Vec<_> = cfg.palette.iter().filter(|(_, p)| p.available()).collect();
    palettes.sort_by_key(|(name, _)| (*name).clone());
    palettes.iter()
        .map(|(name, p)| {
            // What a palette *is* lives in its desc; showing only the name
            // makes the one palette whose job is choosing a palette the least
            // informative list in the set.
            let mut accessories = Vec::new();
            for (flag, tag) in [
                (p.input, "input"),
                (p.live, "live"),
                (p.view.as_deref() == Some("grid"), "grid"),
            ] {
                if flag {
                    accessories.push(json!({ "tag": tag, "color": "secondary" }));
                }
            }
            // Raycast searches the title and keywords, never the subtitle.
            let keywords: Vec<&str> = p
                .desc
                .as_deref()
                .unwrap_or("")
                .split_whitespace()
                .filter(|w| w.len() > 2)
                .collect();

            json!({
                "id": name,
                "name": name,
                "subtitle": p.desc,
                "keywords": keywords,
                "icon": p.icon.as_deref().unwrap_or("view-list"),
                "icon_xdg": p.icon_xdg,
                "icon_utf": p.icon_utf,
                "accessories": accessories,
            })
            .to_string()
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

    let frontend = std::env::var("_PAL_FRONTEND").unwrap_or_default();

    // Driven headlessly there is no frontend to hand off to, so name the
    // palette back to the caller and let it navigate.
    if frontend.is_empty() {
        return json!({ "palette": palette }).to_string();
    }

    let config_file = std::env::var("_PAL_CONFIG").unwrap_or_else(|_| "pal.default.toml".into());
    let mut args = vec!["-c", &config_file, "run"];
    if !frontend.is_empty() {
        args.push(&frontend);
    }
    args.push(palette);

    let _ = Command::new("pal").args(&args).status();

    String::new()
}
