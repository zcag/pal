//! Probe the front app's focused window for an open/save panel (Accessibility is the terminal's):
//! `cargo run -p pal-core --example dialog`            what `pal_core::dialog::detect` sees, plus the raw tree (depth 3)
//! `cargo run -p pal-core --example dialog -- go PATH` type PATH into the panel the way the "Use in dialog" action does
#[cfg(target_os = "macos")]
fn main() {
    use pal_core::ax::element::Element;
    use pal_core::dialog;
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("go") {
        let path = args.get(1).expect("a path");
        match dialog::go(path) {
            Ok(d) => println!("typed {path} into the {} panel of {}", d.kind.name(), d.app),
            Err(e) => {
                eprintln!("failed: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    let t = std::time::Instant::now();
    let d = dialog::detect();
    println!("detect -> {d:?} in {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);
    let Some(app) = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication() else { return };
    let pid = app.processIdentifier();
    println!("front: {:?} pid {pid}", app.localizedName().map(|s| s.to_string()));
    let Some(el) = Element::app(pid) else { return };
    fn dump(e: &Element, depth: usize) {
        if depth > 3 { return; }
        let v = e.attrs(&["AXRole", "AXSubrole", "AXTitle", "AXIdentifier", "AXDescription", "AXChildren", "AXValue"]);
        println!("{}{} {} {:?} id={:?} desc={:?} value={:?}", "  ".repeat(depth), Element::as_text(&v[0]).unwrap_or_default(), Element::as_text(&v[1]).unwrap_or_default(), Element::as_text(&v[2]), Element::as_text(&v[3]), Element::as_text(&v[4]), Element::as_text(&v[6]));
        for c in Element::as_elements(&v[5]) { dump(&c, depth + 1); }
    }
    match el.focused_window() {
        Some(w) => { println!("focused window:"); dump(&w, 0); }
        None => println!("no focused window"),
    }
    println!("windows:");
    for w in el.windows() { let v = w.attrs(&["AXRole", "AXSubrole", "AXTitle"]); println!("  {} {} {:?}", Element::as_text(&v[0]).unwrap_or_default(), Element::as_text(&v[1]).unwrap_or_default(), Element::as_text(&v[2])); }
}
#[cfg(not(target_os = "macos"))]
fn main() {}
