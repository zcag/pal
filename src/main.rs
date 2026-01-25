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
    // resolve palette
    let palette_name = palette_arg.unwrap_or(&cfg.general.default_palette);
    let palette_cfg = cfg.palette.get(palette_name).unwrap_or_else(|| {
        eprintln!("palette not found: {palette_name}");
        process::exit(1);
    });
    let palette_base = palette_cfg.base.as_ref().unwrap_or_else(|| {
        eprintln!("palette '{palette_name}' has no base");
        process::exit(1);
    });

    // resolve frontend
    let frontend_name = frontend_arg.unwrap_or(&cfg.general.default_frontend);
    let frontend_cfg = cfg.frontend.get(frontend_name).unwrap_or_else(|| {
        eprintln!("frontend not found: {frontend_name}");
        process::exit(1);
    });
    let frontend_base = frontend_cfg.base.as_ref().unwrap_or_else(|| {
        eprintln!("frontend '{frontend_name}' has no base");
        process::exit(1);
    });

    let palette = Palette::new(palette_base, palette_cfg);
    let frontend = Frontend::new(frontend_base, frontend_cfg);

    let items = palette.list();
    let selected = frontend.run(&items);

    if !selected.trim().is_empty() {
        let output = palette.pick(&selected);
        print!("{output}");
    }
}
