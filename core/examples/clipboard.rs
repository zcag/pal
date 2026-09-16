//! Exercise clipboard history from a terminal, against a scratch store so the
//! real history is untouched (`PAL_CLIPBOARD_DIR` to point elsewhere):
//! `cargo run -p pal-core --example clipboard -- watch [secs]`   record for a while, print each entry
//! `cargo run -p pal-core --example clipboard -- list [query]`   newest first
//! `cargo run -p pal-core --example clipboard -- copy <id>`      back onto the clipboard
//! `cargo run -p pal-core --example clipboard -- paste <id>`     copy and Cmd+V into the frontmost app
use pal_core::clipboard::{Clipboard, Entry, Kind, Retention};
use std::path::PathBuf;
use std::time::Duration;

fn show(e: &Entry) {
    let what = match e.kind {
        Kind::Text => e.text.as_deref().unwrap_or("").chars().take(60).collect::<String>().replace('\n', "\\n"),
        Kind::Image => format!("{} ({}x{})", e.image.as_ref().unwrap().display(), e.width.unwrap_or(0), e.height.unwrap_or(0)),
        Kind::Files => e.files.as_ref().unwrap().iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "),
    };
    let pin = if e.pinned { "*" } else { " " };
    println!("{pin}{:>4} {:<5} {:>8}B {:<28} {what}", e.id, format!("{:?}", e.kind).to_lowercase(), e.bytes, e.source_app.as_deref().unwrap_or("-"));
}

/// On X11 and Wayland the copying process serves the data, so pal (long-lived)
/// is fine but this example must stay up for the paste to happen.
fn linger() {
    if cfg!(target_os = "linux") {
        println!("serving the clipboard for 5 s");
        std::thread::sleep(Duration::from_secs(5));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = std::env::var_os("PAL_CLIPBOARD_DIR").map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("pal-clipboard-example"));
    let cb = Clipboard::open_at(&dir, Retention::default()).expect("open store");
    let id = |i: usize| args.get(i).and_then(|s| s.parse::<i64>().ok()).expect("numeric id");
    match args.first().map(String::as_str) {
        Some("watch") => {
            let secs = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(10);
            let handle = cb.start_watching(vec![], show);
            println!("watching {} for {secs}s (accessibility: {})", dir.display(), pal_core::ax::trusted());
            std::thread::sleep(Duration::from_secs(secs));
            drop(handle);
        }
        Some("list") => {
            let kind = args.get(2).and_then(|k| match k.as_str() {
                "text" => Some(Kind::Text),
                "image" => Some(Kind::Image),
                "files" => Some(Kind::Files),
                _ => None,
            });
            for e in cb.list(args.get(1).map_or("", String::as_str), kind, 50, 0).unwrap() {
                show(&e);
            }
        }
        Some("copy") => {
            cb.copy(id(1)).expect("copy");
            linger();
        }
        Some("paste") => match cb.paste(id(1)) {
            Ok(()) => linger(),
            Err(e) => {
                eprintln!("paste failed: {e}");
                std::process::exit(1);
            }
        },
        Some("pin") => cb.pin(id(1), true).expect("pin"),
        Some("delete") => cb.delete(id(1)).expect("delete"),
        _ => {
            eprintln!("usage: clipboard watch [secs] | list [query] [text|image|files] | copy <id> | paste <id> | pin <id> | delete <id>");
            std::process::exit(2);
        }
    }
}
