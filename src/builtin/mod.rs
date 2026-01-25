mod palettes;

pub fn run(base: &str, cmd: &str, config: &str) -> String {
    let rest = base.strip_prefix("builtin/").unwrap_or(base);
    let (category, name) = rest.split_once('/').unwrap_or((rest, ""));

    match category {
        "palettes" => palettes::run(name, cmd, config),
        "frontends" => todo!("no builtin frontends yet"),
        "actions" => todo!("no builtin actions yet"),
        _ => {
            eprintln!("unknown builtin category: {category}");
            std::process::exit(1);
        }
    }
}
