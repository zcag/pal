//! Measure the menu bar walk from a terminal (Accessibility is the
//! terminal's when run from one):
//! `cargo run -p pal-core --example menubar`                 the app in front
//! `cargo run -p pal-core --example menubar -- <pid|name>`   one running app, by pid or by name (`Xcode`)
//! `cargo run -p pal-core --example menubar -- <pid|name> press "File > New"`
//! `cargo run -p pal-core --example menubar -- <pid|name> json`   the `Menu` as JSON (a gallery fixture's raw material)
//! Prints the count, elapsed and truncation, then every item with its path,
//! shortcut and check mark.
use pal_core::menubar;

fn pid_of(arg: &str) -> Option<i32> {
    if let Ok(pid) = arg.parse() {
        return Some(pid);
    }
    let out = std::process::Command::new("pgrep").args(["-x", arg]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().next()?.trim().parse().ok()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let menu = match args.first() {
        None => menubar::items(),
        Some(target) => match pid_of(target) {
            Some(pid) => menubar::items_of(pid),
            None => {
                eprintln!("no running app {target:?}");
                std::process::exit(1);
            }
        },
    };
    let menu = menu.unwrap_or_else(|e| {
        eprintln!("failed: {e}");
        std::process::exit(1);
    });
    if args.get(1).map(String::as_str) == Some("json") {
        println!("{}", serde_json::to_string_pretty(&menu).unwrap());
        return;
    }
    println!("{} ({}, pid {}): {} items in {} ms{}", menu.app, menu.bundle, menu.pid, menu.items.len(), menu.elapsed_ms, if menu.truncated { ", truncated" } else { "" });
    if args.get(1).map(String::as_str) == Some("press") {
        let id = args.get(2).expect("an item id");
        match menubar::press(menu.pid, id) {
            Ok(()) => println!("pressed {id}"),
            Err(e) => {
                eprintln!("failed: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    for i in &menu.items {
        println!("{:1} {:<60} {}", if i.checked { "✓" } else { " " }, i.id, i.shortcut.as_deref().unwrap_or(""));
    }
}
