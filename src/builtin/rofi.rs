use std::io::Write;
use std::process::{Command, Stdio};

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "run" => run_rofi(input.unwrap_or("")),
        _ => {
            eprintln!("rofi: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn run_rofi(items: &str) -> String {
    let lines: Vec<&str> = items.lines().collect();

    let mut child = Command::new("rofi")
        .args(["-dmenu", "-i", "-p", "pal", "-show-icons", "-markup-rows", "-format", "i"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run rofi: {e}");
            std::process::exit(1);
        });

    // Format items for rofi with icons, description, and meta (searchable keywords)
    // Format: "display\0icon\x1ficon-name\x1fmeta\x1fkeywords"
    let display_items: Vec<String> = lines
        .iter()
        .filter_map(|line| {
            let item: serde_json::Value = serde_json::from_str(line).ok()?;
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let icon = item.get("icon").and_then(|v| v.as_str()).unwrap_or("");
            let desc = item.get("desc").and_then(|v| v.as_str()).unwrap_or("");
            let keywords = item.get("keywords")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(" "))
                .unwrap_or_default();

            // Check if icon is a displayable character (emoji/unicode) vs freedesktop icon name
            let is_char_icon = !icon.is_empty() && !icon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');

            // Display with Pango markup for description (smaller, dimmed)
            // For char icons, prepend to display instead of using rofi's icon feature
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

            // Rofi format: "display\0icon\x1ficon-name\x1fmeta\x1fkeywords"
            // Only use rofi icon for freedesktop icon names, not char icons
            let icon_part = if is_char_icon { String::new() } else { format!("\0icon\x1f{}", icon) };
            let meta_part = if keywords.is_empty() { String::new() } else { format!("\x1fmeta\x1f{}", keywords) };
            Some(format!("{}{}{}", display, icon_part, meta_part))
        })
        .collect();

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(display_items.join("\n").as_bytes());
    }

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on rofi: {e}");
        std::process::exit(1);
    });

    if !output.status.success() {
        return String::new();
    }

    // rofi returns the index with -format i
    let selected_idx = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<usize>()
        .ok();

    selected_idx
        .and_then(|i| lines.get(i))
        .map(|s| s.to_string())
        .unwrap_or_default()
}
