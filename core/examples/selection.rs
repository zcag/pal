//! Probe what the app in front has selected (Accessibility and Automation are the terminal's):
//! `cargo run -p pal-core --example selection`            the selected text and the Finder selection, with timings
//! `cargo run -p pal-core --example selection -- wait 3`  after 3 s, time to bring Finder (or a text) to the front
fn main() {
    use pal_core::selection;
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("wait") {
        let secs: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(3);
        eprintln!("bring the app to the front, {secs} s...");
        std::thread::sleep(std::time::Duration::from_secs(secs));
    }
    let t = std::time::Instant::now();
    let files = selection::files();
    println!("selection::files() -> {} in {:.1} ms", files.len(), t.elapsed().as_secs_f64() * 1000.0);
    for f in &files {
        println!("  {f}");
    }
    let t = std::time::Instant::now();
    let text = selection::text(false);
    println!("selection::text(false) -> {:?} in {:.1} ms", text.as_ref().map(|s| s.as_ref().map(|t| t.len())), t.elapsed().as_secs_f64() * 1000.0);
}
