mod apps;
mod bookmarks;
mod combine;
mod file_util;
mod fzf;
mod pals;
mod psg;
mod rofi;
mod ssh;
mod stdin;

pub fn run(base: &str, cmd: &str, input: Option<&str>) -> String {
    let path = base.strip_prefix("builtin/").unwrap_or(base);
    match path {
        // Palettes
        "palettes/apps" => apps::run(cmd, input),
        "palettes/bookmarks" => bookmarks::run(cmd, input),
        "palettes/pals" => pals::run(cmd, input),
        "palettes/psg" => psg::run(cmd, input),
        "palettes/ssh" => ssh::run(cmd, input),
        "palettes/combine" => combine::run(cmd, input),
        // Frontends
        "frontends/fzf" => fzf::run(cmd, input),
        "frontends/rofi" => rofi::run(cmd, input),
        "frontends/stdin" => stdin::run(cmd, input),
        _ => {
            eprintln!("unknown builtin: {path}");
            std::process::exit(1);
        }
    }
}
