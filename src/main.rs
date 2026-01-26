mod action;
mod builtin;
mod config;
mod frontend;
mod palette;
mod plugin;
mod util;

use std::process;

use clap::Parser;
use config::Config;
use frontend::Frontend;
use palette::Palette;

#[derive(Parser, Default)]
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

impl Cli {
    pub fn default() -> Self {
        Self {
            config: "pal.default.toml".into(),
            log_level: None,
            command: None,
        }
    }
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
    /// List items from a palette (without frontend)
    List {
        /// Palette to list from
        palette: Option<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    let config_path = util::expand_path(&cli.config);
    // Canonicalize to absolute path for nested pal invocations
    let config_path = std::fs::canonicalize(&config_path).unwrap_or(config_path);
    let config_str = config_path.to_string_lossy();
    let cfg = Config::load(&config_str, &cli);

    match cfg {
        Ok(cfg) => dispatch(&config_str, cli.command, cfg),
        Err(e) => eprintln!("config error: {e}"),
    }
}

fn dispatch(config_path: &str, command: Option<Command>, cfg: Config) {
    std::env::set_var("_PAL_CONFIG", config_path);
    if let Some(parent) = std::path::Path::new(config_path).parent() {
        std::env::set_var("_PAL_CONFIG_DIR", parent);
    }

    match command {
        Some(Command::ShowConfig) => println!("{cfg:#?}"),
        Some(Command::Run { frontend, palette }) => run(&cfg, frontend.as_deref(), palette.as_deref()),
        Some(Command::List { palette }) => {
            let palette_name = palette.as_deref().unwrap_or(&cfg.general.default_palette);
            let palette_cfg = cfg.palette.get(palette_name).expect_exit(&format!("palette not found: {palette_name}"));
            print!("{}", list(palette_cfg));
        }
        None => run(&cfg, None, None),
    }
}

fn run(cfg: &Config, frontend_arg: Option<&str>, palette_arg: Option<&str>) {
    let palette_name = palette_arg.unwrap_or(&cfg.general.default_palette);
    let palette_cfg = cfg.palette.get(palette_name).expect_exit(&format!("palette not found: {palette_name}"));

    let frontend_name = frontend_arg.unwrap_or(&cfg.general.default_frontend);
    let frontend_cfg = cfg.frontend.get(frontend_name).expect_exit(&format!("frontend not found: {frontend_name}"));

    std::env::set_var("_PAL_FRONTEND", frontend_name);

    let items = list(palette_cfg);
    let selected = select(frontend_cfg, &items);
    if let Some(selected) = selected {
        pick(palette_cfg, &selected);
    }
}

fn list(cfg: &config::Palette) -> String {
    Palette::new(cfg).list()
}

fn select(cfg: &config::Frontend, items: &str) -> Option<String> {
    let base = cfg.base.as_ref().expect_exit("frontend has no base");
    let selected = Frontend::new(base, cfg).run(items);
    if selected.trim().is_empty() { None } else { Some(selected) }
}

fn pick(cfg: &config::Palette, selected: &str) {
    print!("{}", Palette::new(cfg).pick(selected));
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
