//! Exercise the window switcher and the layouts from a terminal:
//! `cargo run -p pal-core --example windows -- list`             every window, front to back
//! `cargo run -p pal-core --example windows -- focus <id>`       raise it (restores a minimised one)
//! `cargo run -p pal-core --example windows -- activate <id>`    its app to the front only (the no-Accessibility fallback)
//! `cargo run -p pal-core --example windows -- minimize <id>`
//! `cargo run -p pal-core --example windows -- close <id>`
//! `cargo run -p pal-core --example windows -- icon <id>`        the .app / .desktop its icon comes from
//! `cargo run -p pal-core --example windows -- displays`         every display: frame and visible frame
//! `cargo run -p pal-core --example windows -- focused`          the window with keyboard focus
//! `cargo run -p pal-core --example windows -- frame <id>`       where it is
//! `cargo run -p pal-core --example windows -- set-frame <id> <x> <y> <w> <h>`
//! `cargo run -p pal-core --example windows -- layout <name>[,<name>..] [id] [gap]`  layouts (`layouts` lists the names) on the window, else the focused one, in turn
use pal_core::windows::{self, layout, Rect};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let id = || args.get(1).map(String::as_str).expect("window id");
    let done = |r: windows::Result<()>| {
        if let Err(e) = r {
            eprintln!("failed: {e}");
            std::process::exit(1);
        }
    };
    let rect = |r: &Rect| format!("{}x{} at {},{}", r.w, r.h, r.x, r.y);
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
        Some("activate") => done(windows::activate(id()).map(|app| println!("{app}"))),
        Some("minimize") => done(windows::minimize(id())),
        Some("close") => done(windows::close(id())),
        Some("icon") => {
            let w = windows::list().expect("list").into_iter().find(|w| w.id == id()).expect("no such window");
            println!("{:?}", windows::app_icon_source(&w));
        }
        Some("displays") => done(windows::displays().map(|ds| {
            for d in ds {
                println!("{:<12} frame {:<26} visible {:<26}{}", d.id, rect(&d.frame), rect(&d.visible_frame), if d.primary { " primary" } else { "" });
            }
        })),
        Some("focused") => done(windows::focused().map(|w| match w {
            Some(w) => println!("{} {} {:?} {}", w.id, w.app, w.title, windows::frame(&w.id).map(|r| rect(&r)).unwrap_or_default()),
            None => println!("none"),
        })),
        Some("frame") => done(windows::frame(id()).map(|r| println!("{}", rect(&r)))),
        Some("set-frame") => {
            let n = |i: usize| args.get(i).and_then(|s| s.parse::<f64>().ok()).expect("x y w h");
            done(windows::set_frame(id(), Rect { x: n(2), y: n(3), w: n(4), h: n(5) }));
        }
        Some("layouts") => {
            for l in layout::ALL {
                println!("{:<22} {}", l.name(), l.title());
            }
        }
        Some("layout") => {
            let opts = layout::Options { gap: args.get(3).and_then(|g| g.parse().ok()).unwrap_or(0.0), ..Default::default() };
            for name in args.get(1).expect("layout name").split(',') {
                let l = layout::Layout::parse(name).unwrap_or_else(|| {
                    eprintln!("no layout {name:?}; `layouts` lists them");
                    std::process::exit(2)
                });
                // `restore` remembers per process: a sequence in one run is how to see it.
                done(windows::apply(args.get(2).map(String::as_str), l, &opts).map(|a| println!("{} {}: {} -> {}", a.id, a.layout.title(), rect(&a.from), rect(&a.to))));
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
        }
        _ => {
            eprintln!("usage: windows list | focus <id> | activate <id> | minimize <id> | close <id> | icon <id> | displays | focused | frame <id> | set-frame <id> x y w h | layouts | layout <name> [id] [gap]");
            std::process::exit(2);
        }
    }
}
