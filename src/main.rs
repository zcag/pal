mod config;

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
        None => println!("pal v{}", env!("CARGO_PKG_VERSION")),
    }
}
