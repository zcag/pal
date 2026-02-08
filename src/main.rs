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
    /// List + format items for live input reload (internal)
    #[command(name = "_input-list", hide = true)]
    InputList {
        palette: String,
        frontend: String,
    },
    /// Rofi script mode handler for input palettes (internal)
    #[command(name = "_rofi-input", hide = true)]
    RofiInput {
        palette: String,
        /// Selected text from rofi
        selected: Option<String>,
    },
    /// Prompt user for input via the active frontend
    Prompt {
        /// Prompt spec as JSON object or array (reads stdin if omitted)
        spec: Option<String>,
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
        Some(Command::InputList { palette, frontend }) => {
            input_list(&cfg, &palette, &frontend);
        }
        Some(Command::RofiInput { palette, selected }) => {
            rofi_input(&cfg, &palette, selected.as_deref());
        }
        Some(Command::Prompt { spec }) => {
            prompt_cmd(&cfg, spec.as_deref());
        }
        Some(Command::ShowConfig) => println!("{cfg:#?}"),
        Some(Command::Run { frontend, palette }) => run(&cfg, frontend.as_deref(), palette.as_deref()),
        Some(Command::List { palette }) => {
            let palette_name = palette.as_deref().unwrap_or(&cfg.general.default_palette);
            let palette_cfg = cfg.palette.get(palette_name).expect_exit(&format!("palette not found: {palette_name}"));
            print!("{}", list(palette_cfg, None));
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
        run_cached_rofi(cfg, palette_name, palette_cfg, frontend_name);
        return;
    }

    if palette_cfg.input {
        let base = frontend_cfg.base.as_ref().expect_exit("frontend has no base");
        let msg = palette_cfg.input_prompt.as_deref().unwrap_or(palette_name);
        if base == "builtin/frontends/fzf" {
            let fe = Frontend::new(base, frontend_cfg);
            let sel = fe.input_run(msg);
            if !sel.trim().is_empty() { resolve_and_pick(cfg, palette_cfg, &sel, Some(frontend_name)); }
        } else if base == "builtin/frontends/rofi" {
            // Rofi script mode handles list + pick internally
            Frontend::new(base, frontend_cfg).input_run(msg);
        } else {
            let fe = Frontend::new(base, frontend_cfg);
            let q = fe.prompt(msg);
            if q.is_empty() { return; }
            let items = list(palette_cfg, Some(&q));
            if let Some(selected) = select(frontend_cfg, &items) {
                resolve_and_pick(cfg, palette_cfg, &selected, Some(frontend_name));
            }
        }
        return;
    }

    let items = list(palette_cfg, None);
    let selected = select(frontend_cfg, &items);
    if let Some(selected) = selected {
        resolve_and_pick(cfg, palette_cfg, &selected, Some(frontend_name));
    }
}

fn cache_dir() -> std::path::PathBuf {
    dirs::cache_dir().unwrap_or_default().join("pal")
}

fn run_cached_rofi(cfg: &Config, palette_name: &str, palette_cfg: &config::Palette, frontend_name: &str) {
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
        let items = list(palette_cfg, None);
        let (display, raw_items) = builtin::rofi::format_items(&items);
        std::fs::create_dir_all(&dir).ok();
        std::fs::write(&display_path, &display).ok();
        std::fs::write(&items_path, &items).ok();
        let sel = builtin::rofi::pick_display(&display, &raw_items);
        if sel.trim().is_empty() { None } else { Some(sel) }
    };

    if let Some(selected) = selected {
        resolve_and_pick(cfg, palette_cfg, &selected, Some(frontend_name));
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
    let items = list(palette_cfg, None);
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).ok();

    if frontend_name == "rofi" {
        let (display, _) = builtin::rofi::format_items(&items);
        std::fs::write(dir.join(format!("{palette_name}.rofi.display")), &display).ok();
        std::fs::write(dir.join(format!("{palette_name}.rofi.items")), &items).ok();
    }
}

fn rofi_input(cfg: &Config, palette_name: &str, selected: Option<&str>) {
    let Some(palette_cfg) = cfg.palette.get(palette_name) else { return };
    let retv = std::env::var("ROFI_RETV").unwrap_or_default();
    let info = std::env::var("ROFI_INFO").ok();
    let msg = palette_cfg.input_prompt.as_deref().unwrap_or(palette_name);

    std::env::set_var("_PAL_PALETTE", palette_name);
    std::env::set_var("_PAL_FRONTEND", "rofi");

    match retv.as_str() {
        "" | "0" => {
            // Initial call - show empty list with prompt
            print!("\0prompt\x1f{msg}> \x1fmarkup-rows\x1ftrue");
        }
        "2" => {
            // Custom entry - user typed a query
            let query = selected.unwrap_or("");
            if query.is_empty() { return; }
            let items = list(palette_cfg, Some(query));
            let formatted = builtin::rofi::format_script_items(&items);
            print!("\0prompt\x1f{msg}> \x1fmarkup-rows\x1ftrue\x1fkeep-filter\x1ffalse");
            if !formatted.is_empty() {
                print!("\n{formatted}");
            }
        }
        "1" => {
            // Selected an entry - resolve prompts then pick
            if let Some(json) = info {
                let resolved = resolve_prompts(&json, cfg, Some("rofi"));
                if let Some(resolved) = resolved {
                    let _ = Palette::new(palette_cfg).pick(&resolved);
                }
            }
        }
        _ => {}
    }
}

fn input_list(cfg: &Config, palette_name: &str, frontend_name: &str) {
    use std::io::Read;
    let mut query = String::new();
    std::io::stdin().read_to_string(&mut query).ok();
    let query = query.trim_end();

    let Some(palette_cfg) = cfg.palette.get(palette_name) else { return };
    let items = list(palette_cfg, if query.is_empty() { None } else { Some(query) });

    match frontend_name {
        "fzf" => print!("{}", builtin::fzf::format_items(&items)),
        "rofi" => { let (d, _) = builtin::rofi::format_items(&items); print!("{d}"); }
        _ => print!("{items}"),
    }
}

fn list(cfg: &config::Palette, query: Option<&str>) -> String {
    Palette::new(cfg).list(query)
}

fn select(cfg: &config::Frontend, items: &str) -> Option<String> {
    let base = cfg.base.as_ref().expect_exit("frontend has no base");
    let selected = Frontend::new(base, cfg).run(items);
    if selected.trim().is_empty() { None } else { Some(selected) }
}

/// Resolve item-level prompts then pick. If item has no prompts, picks directly.
fn resolve_and_pick(full_cfg: &Config, palette_cfg: &config::Palette, selected: &str, frontend_name: Option<&str>) {
    let resolved = match resolve_prompts(selected, full_cfg, frontend_name) {
        Some(r) => r,
        None => return, // user cancelled a prompt
    };
    let result = Palette::new(palette_cfg).pick(&resolved);
    if !result.is_empty() {
        print!("{result}");
    }
}

/// If the item has a `prompts` array, run each prompt and substitute `{{key}}` in fields.
fn resolve_prompts(selected: &str, cfg: &Config, frontend_name: Option<&str>) -> Option<String> {
    let mut item: serde_json::Value = serde_json::from_str(selected).ok()?;

    let prompts = match item.get("prompts") {
        Some(p) => p.as_array()?.clone(),
        None => return Some(selected.to_string()),
    };
    if prompts.is_empty() {
        return Some(selected.to_string());
    }

    let values = run_prompts(&prompts, cfg, frontend_name)?;

    // Remove prompts field
    if let Some(obj) = item.as_object_mut() {
        obj.remove("prompts");
    }

    // Substitute {{key}} in the serialized JSON string
    let mut json_str = item.to_string();
    for (key, value) in &values {
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        json_str = json_str.replace(&format!("{{{{{key}}}}}"), &escaped);
    }

    // Re-parse and inject prompt values as fields (become PAL_<KEY> env vars)
    let mut item: serde_json::Value = serde_json::from_str(&json_str).ok()?;
    if let Some(obj) = item.as_object_mut() {
        for (key, value) in &values {
            if !obj.contains_key(key) {
                obj.insert(key.clone(), serde_json::Value::String(value.clone()));
            }
        }
    }

    Some(item.to_string())
}

/// Core prompt runner - shared by resolve_prompts and `pal prompt`.
/// Returns collected (key, value) pairs, or None if user cancelled.
fn run_prompts(prompts: &[serde_json::Value], cfg: &Config, frontend_name: Option<&str>) -> Option<Vec<(String, String)>> {
    // Determine frontend: explicit arg > _PAL_FRONTEND env > config default
    let fe_name_env = std::env::var("_PAL_FRONTEND").ok();
    let fe_name = frontend_name
        .or(fe_name_env.as_deref())
        .unwrap_or(&cfg.general.default_frontend);
    let frontend_cfg = cfg.frontend.get(fe_name)?;
    let base = frontend_cfg.base.as_ref()?;
    let fe = Frontend::new(base, frontend_cfg);

    let mut values: Vec<(String, String)> = Vec::new();

    for prompt in prompts {
        let key = prompt.get("key").and_then(|v| v.as_str()).unwrap_or("");
        let message = prompt.get("message").and_then(|v| v.as_str()).unwrap_or(key);
        let prompt_type = prompt.get("type").and_then(|v| v.as_str()).unwrap_or("text");

        let value = match prompt_type {
            "choice" => {
                let options = prompt.get("options").and_then(|v| v.as_array())?;
                let items_str = options.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| serde_json::json!({"id": s, "name": s}).to_string())
                    .collect::<Vec<_>>()
                    .join("\n");
                let sel = fe.run(&items_str);
                if sel.trim().is_empty() { return None; }
                serde_json::from_str::<serde_json::Value>(&sel).ok()
                    .and_then(|v| v.get("id").and_then(|v| v.as_str()).map(String::from))
                    .unwrap_or_else(|| sel.trim().to_string())
            }
            _ => {
                let result = fe.prompt(message);
                if result.is_empty() { return None; }
                result
            }
        };
        values.push((key.to_string(), value));
    }

    Some(values)
}

/// `pal prompt` command - prompt user via the frontend, print collected values.
fn prompt_cmd(cfg: &Config, spec: Option<&str>) {
    let input = match spec {
        Some(s) => s.to_string(),
        None => {
            use std::io::Read;
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf).ok();
            buf
        }
    };
    let input = input.trim();
    if input.is_empty() { return; }

    let prompts: Vec<serde_json::Value> = if input.starts_with('[') {
        serde_json::from_str(input).unwrap_or_default()
    } else {
        serde_json::from_str::<serde_json::Value>(input).ok()
            .map(|v| vec![v])
            .unwrap_or_default()
    };
    if prompts.is_empty() { return; }

    if let Some(values) = run_prompts(&prompts, cfg, None) {
        if values.len() == 1 {
            print!("{}", values[0].1);
        } else {
            let obj: serde_json::Map<String, serde_json::Value> = values.into_iter()
                .map(|(k, v)| (k, serde_json::Value::String(v)))
                .collect();
            print!("{}", serde_json::Value::Object(obj));
        }
    }
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
