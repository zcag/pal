mod pals;

pub fn run(base: &str, cmd: &str, config: &toml::Value, input: Option<&str>) -> String {
    let path = base.strip_prefix("builtin/").unwrap_or(base);
    match path {
        "palettes/pals" => pals::run(cmd, config, input),
        _ => {
            eprintln!("unknown builtin: {path}");
            std::process::exit(1);
        }
    }
}
