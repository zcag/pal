//! Exercise the icon cache from a terminal:
//! `cargo run -p pal-core --example icons -- /Applications/kitty.app 24`
//! `cargo run -p pal-core --example icons -- https://github.com 16`
//! Prints the cached PNG path and the time taken; run twice to see the hit.
use std::path::Path;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(src), size) = (args.first(), args.get(1).and_then(|s| s.parse().ok()).unwrap_or(24)) else {
        eprintln!("usage: icons <path-or-url> [size]");
        std::process::exit(2);
    };
    let t = Instant::now();
    let out = if src.contains("://") { pal_core::icons::favicon(src, size) } else { pal_core::icons::app_icon(Path::new(src), size) };
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    match out {
        Ok(p) => println!("{} ({ms:.1} ms)", p.display()),
        Err(e) => {
            println!("error: {e} ({ms:.1} ms)");
            std::process::exit(1);
        }
    }
}
