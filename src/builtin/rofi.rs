use std::io::Write;
use std::process::{Command, Stdio};

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "run" => {
            let items = input.unwrap_or("");
            let (display, raw_items) = format_items(items);
            pick_display(&display, &raw_items)
        }
        _ => {
            eprintln!("rofi: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

/// Format JSON items into rofi display lines.
/// Returns (display_string, raw_json_items) with aligned indices.
pub fn format_items(items: &str) -> (String, Vec<String>) {
    let mut display_lines = Vec::new();
    let mut raw_items = Vec::new();

    for line in items.lines() {
        let Ok(item) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let icon = item.get("icon_xdg")
            .or_else(|| item.get("icon"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let desc = item.get("desc").and_then(|v| v.as_str()).unwrap_or("");
        let keywords = item.get("keywords")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(" "))
            .unwrap_or_default();

        let is_char_icon = !icon.is_empty() && !icon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');

        let display = {
            let name_part = if is_char_icon {
                format!("{} {}", icon, name)
            } else {
                name.to_string()
            };
            if desc.is_empty() {
                name_part
            } else {
                let desc_escaped = desc.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
                format!("{} <span size=\"small\" alpha=\"50%\">{}</span>", name_part, desc_escaped)
            }
        };

        let icon_part = if is_char_icon { String::new() } else { format!("\0icon\x1f{}", icon) };
        let meta_part = if keywords.is_empty() { String::new() } else { format!("\x1fmeta\x1f{}", keywords) };
        display_lines.push(format!("{}{}{}", display, icon_part, meta_part));
        raw_items.push(line.to_string());
    }

    (display_lines.join("\n"), raw_items)
}

/// Run rofi picker with pre-formatted display, return selected raw JSON item.
pub fn pick_display(display: &str, raw_items: &[String]) -> String {
    let mut child = Command::new("rofi")
        .args(["-dmenu", "-i", "-p", "pal", "-show-icons", "-markup-rows", "-format", "i"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run rofi: {e}");
            std::process::exit(1);
        });

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(display.as_bytes());
    }

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on rofi: {e}");
        std::process::exit(1);
    });

    if !output.status.success() {
        return String::new();
    }

    let selected_idx = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<usize>()
        .ok();

    selected_idx
        .and_then(|i| raw_items.get(i))
        .cloned()
        .unwrap_or_default()
}
