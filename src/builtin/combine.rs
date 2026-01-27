use crate::config::Config;
use crate::palette::Palette;

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "list" => list(),
        "pick" => pick(input.unwrap_or("")),
        _ => {
            eprintln!("combine: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn config() -> serde_json::Value {
    let s = std::env::var("_PAL_PLUGIN_CONFIG").unwrap_or_default();
    serde_json::from_str(&s).unwrap_or_default()
}

fn pal_config() -> Config {
    let path = std::env::var("_PAL_CONFIG").unwrap_or_else(|_| "pal.default.toml".into());
    Config::load(&path, &crate::Cli::default()).unwrap()
}

fn list() -> String {
    let cfg = config();
    let include = cfg.get("include")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
        .unwrap_or_default();

    let pal_cfg = pal_config();

    include.iter()
        .flat_map(|palette_name| {
            let Some(palette_cfg) = pal_cfg.palette.get(palette_name) else {
                return vec![];
            };

            Palette::new(palette_cfg).list()
                .lines()
                .filter_map(|line| {
                    let mut item: serde_json::Value = serde_json::from_str(line).ok()?;
                    item.as_object_mut()?.insert("_source".into(), serde_json::json!(palette_name));
                    Some(item.to_string())
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn pick(input: &str) -> String {
    let item: serde_json::Value = serde_json::from_str(input).unwrap_or_default();
    let source = item.get("_source").and_then(|v| v.as_str()).unwrap_or("");

    if source.is_empty() {
        return String::new();
    }

    let cfg = pal_config();
    let Some(palette_cfg) = cfg.palette.get(source) else {
        return String::new();
    };

    Palette::new(palette_cfg).pick(input)
}
