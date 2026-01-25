mod pals;

pub fn run(path: &str, cmd: &str, config: &toml::Value, input: Option<&str>) -> String {
    match path {
        "palettes/pals" => pals::run(cmd, config, input),
        _ => {
            eprintln!("unknown builtin: {path}");
            std::process::exit(1);
        }
    }
}
