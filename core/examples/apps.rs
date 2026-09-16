//! Which apps open a file, from a terminal:
//! `cargo run -p pal-core --example apps -- <file>`             every app for it, the default marked
//! `cargo run -p pal-core --example apps -- <file> <app path>`  open it with that app
use pal_core::apps;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(file) = args.first() else {
        eprintln!("usage: apps <file> [app]");
        std::process::exit(2);
    };
    let r = match args.get(1) {
        Some(app) => apps::open_with(Path::new(file), Path::new(app)).map(|_| println!("opened {file} with {app}")),
        None => {
            let t0 = std::time::Instant::now();
            apps::for_file(Path::new(file)).map(|list| {
                println!("{} apps for {file} ({:.1} ms)", list.len(), t0.elapsed().as_secs_f64() * 1000.0);
                for a in &list {
                    println!("{} {:<24} {:<40} {}", if a.default { "*" } else { " " }, a.name, a.bundle_id.as_deref().unwrap_or("-"), a.path.display());
                }
            })
        }
    };
    if let Err(e) = r {
        eprintln!("failed: {e}");
        std::process::exit(1);
    }
}
