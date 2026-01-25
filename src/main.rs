mod action;
mod builtin;
mod config;
mod frontend;
mod palette;
mod plugin;
mod util;

use std::process;

use action::Action;
use clap::Parser;
use config::Config;
use frontend::Frontend;
use palette::Palette;

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
    /// Run with optional frontend and palette
    Run {
        /// Frontend to use (default from config)
        frontend: Option<String>,
        /// Palette to use (default from config)
        palette: Option<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    let cfg = Config::load(&cli.config, &cli);

    match cfg {
        Ok(cfg) => dispatch(cli, cfg),
        Err(e) => eprintln!("config error: {e}"),
    }
}

fn dispatch(cli: Cli, cfg: Config) {
    match cli.command {
        Some(Command::ShowConfig) => println!("{cfg:#?}"),
        Some(Command::Run { frontend, palette }) => run(&cfg, frontend.as_deref(), palette.as_deref()),
        None => run(&cfg, None, None),
    }
}

fn run(cfg: &Config, frontend_arg: Option<&str>, palette_arg: Option<&str>) {
    let palette_name = palette_arg.unwrap_or(&cfg.general.default_palette);
    let palette_cfg = cfg.palette.get(palette_name).expect_exit(&format!("palette not found: {palette_name}"));

    let frontend_name = frontend_arg.unwrap_or(&cfg.general.default_frontend);
    let frontend_cfg = cfg.frontend.get(frontend_name).expect_exit(&format!("frontend not found: {frontend_name}"));

    let items = list(palette_cfg);
    let selected = select(frontend_cfg, &items);
    if let Some(selected) = selected {
        pick(palette_cfg, &selected);
    }
}

fn list(cfg: &config::Palette) -> String {
    if cfg.auto_list {
        let path = cfg.data.as_ref().expect_exit("auto_list requires 'data' path");
        std::fs::read_to_string(path).expect_exit(&format!("failed to read {path}"))
    } else {
        let base = cfg.base.as_ref().expect_exit("palette has no base");
        Palette::new(base, cfg).list()
    }
}

fn select(cfg: &config::Frontend, items: &str) -> Option<String> {
    let base = cfg.base.as_ref().expect_exit("frontend has no base");
    let selected = Frontend::new(base, cfg).run(items);
    if selected.trim().is_empty() { None } else { Some(selected) }
}

fn pick(cfg: &config::Palette, selected: &str) {
    let output = if cfg.auto_pick {
        let action_name = cfg.default_action.as_ref().expect_exit("auto_pick requires 'default_action'");
        let action_key = cfg.action_key.as_ref().expect_exit("auto_pick requires 'action_key'");
        let json: serde_json::Value = serde_json::from_str(selected).expect_exit("failed to parse selected");
        let value = json.get(action_key).and_then(|v| v.as_str()).expect_exit(&format!("missing '{action_key}'"));
        Action::new(action_name).run(value)
    } else {
        let base = cfg.base.as_ref().expect_exit("palette has no base");
        Palette::new(base, cfg).pick(selected)
    };
    print!("{output}");
}

trait ExpectExit<T> {
    fn expect_exit(self, msg: &str) -> T;
}

impl<T> ExpectExit<T> for Option<T> {
    fn expect_exit(self, msg: &str) -> T {
        self.unwrap_or_else(|| { eprintln!("{msg}"); process::exit(1); })
    }
}

impl<T, E: std::fmt::Display> ExpectExit<T> for Result<T, E> {
    fn expect_exit(self, msg: &str) -> T {
        self.unwrap_or_else(|e| { eprintln!("{msg}: {e}"); process::exit(1); })
    }
}
