mod pals;

pub fn run(name: &str, cmd: &str, config: &str) -> String {
    match name {
        "pals" => pals::run(cmd, config),
        _ => {
            eprintln!("unknown builtin palette: {name}");
            std::process::exit(1);
        }
    }
}
