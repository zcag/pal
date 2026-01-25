mod pals;

pub fn run(base: &str, cmd: &str, config: &str) -> String {
    let name = base.strip_prefix("src/builtin/").unwrap_or(base);
    match name {
        "pals" => pals::run(cmd, config),
        _ => {
            eprintln!("unknown builtin: {name}");
            std::process::exit(1);
        }
    }
}
