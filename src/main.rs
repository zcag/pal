mod config;

use std::io::Write;
use std::path::Path;
use std::process;

use clap::Parser;
use config::Config;

#[derive(Parser)]
#[command(name = "pal", about = "pal - palette tool")]
pub struct Cli {
    /// Path to config file
    #[arg(short, long, default_value = "pal.default.toml")]
    pub config: String,

    /// Override log level
    #[arg(short, long)]
    pub log_level: Option<String>,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(clap::Subcommand)]
pub enum Command {
    /// Show loaded configuration
    ShowConfig,
}

fn main() {
    let cli = Cli::parse();
    let cfg = Config::load(&cli.config, &cli);

    match cfg {
        Ok(cfg) => run(cli, cfg),
        Err(e) => eprintln!("config error: {e}"),
    }
}

fn run(cli: Cli, cfg: Config) {
    match cli.command {
        Some(Command::ShowConfig) => println!("{cfg:#?}"),
        None => run_palette(&cfg),
    }
}

fn run_palette(cfg: &Config) {
    let palette_name = &cfg.general.default_palette;
    let palette = match cfg.palette.get(palette_name) {
        Some(p) => p,
        None => {
            eprintln!("palette not found: {palette_name}");
            process::exit(1);
        }
    };

    let base = match &palette.base {
        Some(b) => b,
        None => {
            eprintln!("palette '{palette_name}' has no base");
            process::exit(1);
        }
    };

    let base_path = Path::new(base);
    let plugin_toml_path = base_path.join("plugin.toml");
    let plugin_toml: toml::Value = match std::fs::read_to_string(&plugin_toml_path) {
        Ok(s) => s.parse().unwrap_or_else(|e| {
            eprintln!("failed to parse {}: {e}", plugin_toml_path.display());
            process::exit(1);
        }),
        Err(e) => {
            eprintln!("failed to read {}: {e}", plugin_toml_path.display());
            process::exit(1);
        }
    };

    // resolve executable from plugin.toml command field
    let command = plugin_toml.get("command")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            eprintln!("plugin.toml missing 'command' field");
            process::exit(1);
        });

    let exec_path = base_path.join(command);

    // build combined config: plugin.toml fields + user palette config
    let mut combined = serde_json::Map::new();
    if let toml::Value::Table(t) = &plugin_toml {
        for (k, v) in t {
            combined.insert(k.clone(), toml_to_json(v));
        }
    }
    // user palette config overrides
    let palette_json = serde_json::to_value(palette).unwrap();
    if let serde_json::Value::Object(obj) = palette_json {
        for (k, v) in obj {
            if !v.is_null() {
                combined.insert(k, v);
            }
        }
    }

    let config_str = serde_json::to_string(&combined).unwrap();

    // run: <exec> list, with combined config as stdin
    let mut child = process::Command::new(&exec_path)
        .arg("list")
        .stdin(process::Stdio::piped())
        .stdout(process::Stdio::piped())
        .stderr(process::Stdio::inherit())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run {}: {e}", exec_path.display());
            process::exit(1);
        });

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(config_str.as_bytes());
    }

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on process: {e}");
        process::exit(1);
    });

    print!("{}", String::from_utf8_lossy(&output.stdout));
}

fn toml_to_json(v: &toml::Value) -> serde_json::Value {
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
