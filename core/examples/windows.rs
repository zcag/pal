//! Exercise the window switcher from a terminal:
//! `cargo run -p pal-core --example windows -- list`             every window, front to back
//! `cargo run -p pal-core --example windows -- focus <id>`       raise it (restores a minimised one)
//! `cargo run -p pal-core --example windows -- minimize <id>`
//! `cargo run -p pal-core --example windows -- close <id>`
//! `cargo run -p pal-core --example windows -- icon <id>`        the .app / .desktop its icon comes from
use pal_core::windows;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let id = || args.get(1).map(String::as_str).expect("window id");
    let done = |r: windows::Result<()>| {
        if let Err(e) = r {
            eprintln!("failed: {e}");
            std::process::exit(1);
        }
    };
    match args.first().map(String::as_str) {
        Some("list") => {
            let t0 = std::time::Instant::now();
            let ws = windows::list().unwrap_or_else(|e| {
                eprintln!("list failed: {e}");
                std::process::exit(1)
            });
            println!("backend {} accessibility {} ({} windows, {:.1} ms)", windows::backend(), pal_core::ax::trusted(), ws.len(), t0.elapsed().as_secs_f64() * 1000.0);
            for w in &ws {
                let state = if w.minimized { "min" } else if w.on_screen { "on " } else { "off" };
                let place = [w.monitor.as_deref(), w.workspace.as_deref()].into_iter().flatten().collect::<Vec<_>>().join(" ");
                println!("{:>14} {state} {:>7} {:<22} {:<40} {:<8} {}", w.id, w.pid, w.app.chars().take(22).collect::<String>(), w.title.chars().take(40).collect::<String>(), place, w.bundle_or_class);
            }
        }
        Some("focus") => done(windows::focus(id())),
        Some("minimize") => done(windows::minimize(id())),
        Some("close") => done(windows::close(id())),
        Some("icon") => {
            let w = windows::list().expect("list").into_iter().find(|w| w.id == id()).expect("no such window");
            println!("{:?}", windows::app_icon_source(&w));
        }
        _ => {
            eprintln!("usage: windows list | focus <id> | minimize <id> | close <id> | icon <id>");
            std::process::exit(2);
        }
    }
}
