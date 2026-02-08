mod action;
mod builtin;
mod config;
mod frontend;
mod palette;
mod plugin;
mod remote;
mod util;

use std::process;

use clap::Parser;
use config::Config;
use frontend::Frontend;
use palette::Palette;

#[derive(Parser, Default)]
#[command(name = "pal", about = "pal - palette tool", version)]
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
    /// Initialize config at ~/.config/pal/config.toml
    Init {
        /// Overwrite existing config
        #[arg(short, long)]
        force: bool,
    },
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
    /// Run an action (reads value from stdin)
    Action {
        /// Action name (e.g. copy, open, cmd)
        name: String,
    },
    /// List installed remote plugins
    Plugins,
    /// Update all remote plugins
    Update,
    /// Regenerate cache for a palette+frontend (internal)
    #[command(hide = true)]
    CacheRegen {
        palette: String,
        frontend: String,
    },
}

fn main() {
    let cli = Cli::parse();

    // Handle commands that don't need config
    match &cli.command {
        Some(Command::Init { force }) => { init_config(*force); return; }
        Some(Command::Plugins) => { remote::list_plugins(); return; }
        Some(Command::Update) => { remote::update_plugins(); return; }
        _ => {}
    }

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

fn init_config(force: bool) {
    let config_dir = dirs::config_dir()
        .map(|p| p.join("pal"))
        .unwrap_or_else(|| {
            eprintln!("could not determine config directory");
            process::exit(1);
        });

    let config_path = config_dir.join("config.toml");

    if config_path.exists() && !force {
        eprintln!("config already exists: {}", config_path.display());
        eprintln!("use --force to overwrite");
        process::exit(1);
    }

    if let Err(e) = std::fs::create_dir_all(&config_dir) {
        eprintln!("failed to create {}: {e}", config_dir.display());
        process::exit(1);
    }

    let example_config = include_str!("../examples/config.toml");
    if let Err(e) = std::fs::write(&config_path, example_config) {
        eprintln!("failed to write {}: {e}", config_path.display());
        process::exit(1);
    }

    println!("created {}", config_path.display());
}

fn dispatch(config_path: &str, command: Option<Command>, cfg: Config) {
    std::env::set_var("_PAL_CONFIG", config_path);
    if let Some(parent) = std::path::Path::new(config_path).parent() {
        std::env::set_var("_PAL_CONFIG_DIR", parent);
    }

    match command {
        Some(Command::Init { .. } | Command::Plugins | Command::Update) => unreachable!(),
        Some(Command::CacheRegen { palette, frontend }) => {
            regen_cache(&cfg, &palette, &frontend);
        }
        Some(Command::ShowConfig) => println!("{cfg:#?}"),
        Some(Command::Run { frontend, palette }) => run(&cfg, frontend.as_deref(), palette.as_deref()),
        Some(Command::List { palette }) => {
            let palette_name = palette.as_deref().unwrap_or(&cfg.general.default_palette);
            let palette_cfg = cfg.palette.get(palette_name).expect_exit(&format!("palette not found: {palette_name}"));
            print!("{}", list(palette_cfg));
        }
        Some(Command::Action { name }) => {
            use std::io::Read;
            let mut value = String::new();
            std::io::stdin().read_to_string(&mut value).ok();
            print!("{}", action::Action::new(&name).run(value.trim_end()));
        }
        None => run(&cfg, None, None),
    }
}

fn run(cfg: &Config, frontend_arg: Option<&str>, palette_arg: Option<&str>) {
    let palette_name = palette_arg.unwrap_or(&cfg.general.default_palette);
    let palette_cfg = cfg.palette.get(palette_name).expect_exit(&format!("palette not found: {palette_name}"));

    let frontend_name = frontend_arg.unwrap_or(&cfg.general.default_frontend);
    let frontend_cfg = cfg.frontend.get(frontend_name).expect_exit(&format!("frontend not found: {frontend_name}"));

    std::env::set_var("_PAL_PALETTE", palette_name);
    std::env::set_var("_PAL_FRONTEND", frontend_name);

    if palette_cfg.cache && frontend_cfg.base.as_deref() == Some("builtin/frontends/rofi") {
        run_cached_rofi(palette_name, palette_cfg);
        return;
    }

    let items = list(palette_cfg);
    let selected = select(frontend_cfg, &items);
    if let Some(selected) = selected {
        pick(palette_cfg, &selected);
    }
}

fn cache_dir() -> std::path::PathBuf {
    dirs::cache_dir().unwrap_or_default().join("pal")
}

fn run_cached_rofi(palette_name: &str, palette_cfg: &config::Palette) {
    let dir = cache_dir();
    let display_path = dir.join(format!("{palette_name}.rofi.display"));
    let items_path = dir.join(format!("{palette_name}.rofi.items"));

    let selected = if display_path.exists() && items_path.exists() {
        let display = std::fs::read_to_string(&display_path).unwrap_or_default();
        let items_str = std::fs::read_to_string(&items_path).unwrap_or_default();
        let raw_items: Vec<String> = items_str.lines().map(String::from).collect();
        let sel = builtin::rofi::pick_display(&display, &raw_items);
        spawn_cache_regen(palette_name);
        if sel.trim().is_empty() { None } else { Some(sel) }
    } else {
        // No cache yet - generate, cache, then display
        let items = list(palette_cfg);
        let (display, raw_items) = builtin::rofi::format_items(&items);
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(&display_path, &display).ok();
        std::fs::write(&items_path, &items).ok();
        let sel = builtin::rofi::pick_display(&display, &raw_items);
        if sel.trim().is_empty() { None } else { Some(sel) }
    };

    if let Some(selected) = selected {
        pick(palette_cfg, &selected);
    }
}

fn spawn_cache_regen(palette_name: &str) {
    let config_path = std::env::var("_PAL_CONFIG").unwrap_or_else(|_| "pal.default.toml".into());
    let exe = std::env::current_exe().unwrap_or_else(|_| "pal".into());
    std::process::Command::new(exe)
        .args(["--config", &config_path, "cache-regen", palette_name, "rofi"])
        .stdin(process::Stdio::null())
        .stdout(process::Stdio::null())
        .stderr(process::Stdio::null())
        .spawn()
        .ok();
}

fn regen_cache(cfg: &Config, palette_name: &str, frontend_name: &str) {
    let Some(palette_cfg) = cfg.palette.get(palette_name) else { return };
    let items = list(palette_cfg);
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).ok();

    if frontend_name == "rofi" {
        let (display, _) = builtin::rofi::format_items(&items);
        std::fs::write(dir.join(format!("{palette_name}.rofi.display")), &display).ok();
        std::fs::write(dir.join(format!("{palette_name}.rofi.items")), &items).ok();
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
