//! System commands from a terminal:
//! `cargo run -p pal-core --example system -- commands`      the catalogue, with availability
//! `cargo run -p pal-core --example system -- run <id>`      run one (destructive ones ask first)
use pal_core::system;
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("commands") => {
            for c in system::commands() {
                let flags = format!("{}{}", if c.available { "" } else { " (unavailable)" }, if c.destructive { " [confirm]" } else { "" });
                println!("{} {:<16} {:<24} {}{flags}", c.icon, c.id, c.title, c.subtitle);
            }
        }
        Some("run") => {
            let id = args.get(1).expect("command id");
            if system::commands().iter().any(|c| c.id == *id && c.destructive) {
                print!("{id} is destructive; type yes to continue: ");
                std::io::stdout().flush().unwrap();
                let mut line = String::new();
                std::io::stdin().read_line(&mut line).unwrap();
                if line.trim() != "yes" {
                    return;
                }
            }
            if let Err(e) = system::run(id) {
                eprintln!("failed: {e}");
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!("usage: system commands | run <id>");
            std::process::exit(2);
        }
    }
}
