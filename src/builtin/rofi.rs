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
    let mut child = Command::new("rofi")
        .args(["-dmenu", "-i", "-p", "pal", "-show-icons", "-markup-rows"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run rofi: {e}");
            std::process::exit(1);
        });

    // Build a map of display -> JSON for lookup after selection
    let mut display_to_json: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // Format items for rofi with icons, description, and meta (searchable keywords)
    // Format: "display\0icon\x1ficon-name\x1fmeta\x1fkeywords"
    let display_items: Vec<String> = items
        .lines()
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

            // Display with Pango markup for description (smaller, dimmed)
            let display = if desc.is_empty() {
                name.to_string()
            } else {
                // Escape special chars for Pango
                let desc_escaped = desc.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
                format!("{} <span size=\"small\" alpha=\"50%\">{}</span>", name, desc_escaped)
            };

            // Store plain name for lookup (rofi strips markup in output)
            display_to_json.insert(name.to_string(), line.to_string());

            // Rofi format: "display\0icon\x1ficon-name\x1fmeta\x1fkeywords"
            // meta field is searchable but not displayed
            if keywords.is_empty() {
                Some(format!("{}\0icon\x1f{}", display, icon))
            } else {
                Some(format!("{}\0icon\x1f{}\x1fmeta\x1f{}", display, icon, keywords))
            }
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

    let selected_name = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Look up the original JSON
    display_to_json.get(&selected_name).cloned().unwrap_or_default()
}
