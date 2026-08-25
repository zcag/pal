//! Pick results.
//!
//! A `pick` may print a JSON envelope on stdout describing what the frontend
//! should do about it — show a toast, copy something, refresh the list. Rich
//! frontends (Raycast) consume the envelope directly; terminal frontends have
//! no such vocabulary, so pal renders it for them.
//!
//! ```json
//! {"toast": {"style": "success", "title": "Restarted", "message": "nginx"}}
//! {"hud": "Copied 483920"}
//! {"clipboard": "483920"}
//! {"open": "https://example.com"}
//! {"show": {"markdown": "...", "metadata": [...]}}
//! {"reload": true}
//! {"close": true}
//! {"palette": "audio"}   // resolved to another palette; show it
//! ```
//!
//! Anything that isn't a JSON object with at least one known key is passed
//! through untouched, so plugins that just print text keep working.

use serde_json::Value;

const KEYS: [&str; 8] =
    ["toast", "hud", "clipboard", "open", "show", "reload", "close", "palette"];

/// Is this a result envelope rather than plain plugin output?
pub fn is_envelope(out: &str) -> bool {
    parse(out).is_some()
}

fn parse(out: &str) -> Option<Value> {
    let trimmed = out.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let value: Value = serde_json::from_str(trimmed).ok()?;
    let obj = value.as_object()?;
    KEYS.iter().any(|k| obj.contains_key(*k)).then_some(value)
}

/// Render an envelope for a frontend that can't consume one itself.
/// Returns true if the output was an envelope (and has been handled).
pub fn render(out: &str) -> bool {
    let Some(value) = parse(out) else { return false };

    if let Some(text) = value.get("clipboard").and_then(|v| v.as_str()) {
        crate::action::Action::new("copy").run(text);
    }
    if let Some(url) = value.get("open").and_then(|v| v.as_str()) {
        crate::action::Action::new("open").run(url);
    }
    if let Some(hud) = value.get("hud").and_then(|v| v.as_str()) {
        notify("", hud);
    }
    if let Some(toast) = value.get("toast") {
        let title = toast.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let message = toast.get("message").and_then(|v| v.as_str()).unwrap_or("");
        notify(title, message);
    }
    if let Some(show) = value.get("show") {
        if let Some(md) = show.get("markdown").and_then(|v| v.as_str()) {
            println!("{md}");
        }
        for entry in show.get("metadata").and_then(|v| v.as_array()).unwrap_or(&vec![]) {
            let label = entry.get("label").and_then(|v| v.as_str()).unwrap_or("");
            let text = entry.get("text").and_then(|v| v.as_str()).unwrap_or("");
            if !label.is_empty() {
                println!("{label}: {text}");
            }
        }
    }
    true
}

/// Desktop notification, on whichever of the three platforms we're on.
fn notify(title: &str, body: &str) {
    use std::process::{Command, Stdio};

    let quiet = |mut c: Command| {
        c.stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok()
    };

    if which("notify-send") {
        let mut c = Command::new("notify-send");
        c.args(["-t", "2000", if title.is_empty() { body } else { title }]);
        if !title.is_empty() && !body.is_empty() {
            c.arg(body);
        }
        if quiet(c) {
            return;
        }
    }
    if which("terminal-notifier") {
        let mut c = Command::new("terminal-notifier");
        c.args(["-message", body]);
        if !title.is_empty() {
            c.args(["-title", title]);
        }
        if quiet(c) {
            return;
        }
    }
    if which("osascript") {
        let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = if title.is_empty() {
            format!("display notification \"{}\"", esc(body))
        } else {
            format!("display notification \"{}\" with title \"{}\"", esc(body), esc(title))
        };
        let mut c = Command::new("osascript");
        c.args(["-e", &script]);
        if quiet(c) {
            return;
        }
    }

    // No notifier available - say it on stderr so it isn't simply lost.
    if title.is_empty() {
        eprintln!("{body}");
    } else {
        eprintln!("{title}: {body}");
    }
}

fn which(bin: &str) -> bool {
    std::process::Command::new("sh")
        .args(["-c", &format!("command -v {bin}")])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
