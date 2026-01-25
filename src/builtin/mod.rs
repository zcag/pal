mod combine;
mod pals;

pub fn run(base: &str, cmd: &str, input: Option<&str>) -> String {
    let path = base.strip_prefix("builtin/").unwrap_or(base);
    match path {
        "palettes/pals" => pals::run(cmd, input),
        "palettes/combine" => combine::run(cmd, input),
        _ => {
            eprintln!("unknown builtin: {path}");
            std::process::exit(1);
        }
    }
}
