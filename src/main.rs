mod config;
mod frontend;
mod palette;
mod plugin;
mod util;

use std::process;

use clap::Parser;
use config::Config;
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
        None => run(&cfg),
    }
}

fn run(cfg: &Config) {
    let name = &cfg.general.default_palette;
    let palette_cfg = cfg.palette.get(name).unwrap_or_else(|| {
        eprintln!("palette not found: {name}");
        process::exit(1);
    });
    let base = palette_cfg.base.as_ref().unwrap_or_else(|| {
        eprintln!("palette '{name}' has no base");
        process::exit(1);
    });

    let palette = Palette::new(base, palette_cfg);
    print!("{}", palette.list());
}
