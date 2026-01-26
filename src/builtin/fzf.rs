use std::io::Write;
use std::process::{Command, Stdio};

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "run" => run_fzf(input.unwrap_or("")),
        _ => {
            eprintln!("fzf: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn run_fzf(items: &str) -> String {
    // Use --with-nth=2 to display only the second field (icon + name)
    // but search includes field 3 (keywords) too
    let mut child = Command::new("fzf")
        .args([
            "--ansi", "--no-sort", "--layout=reverse",
            "--delimiter=\t", "--with-nth=2"
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run fzf: {e}");
            std::process::exit(1);
        });

    // Format items for fzf: JSON\tdisplay\tkeywords
    // --with-nth=2 shows only display, but fzf searches all fields
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

            // Only show icon if it's a displayable character (emoji/unicode)
            // Skip freedesktop icon names (ascii-only like "firefox", "audio-card")
            let show_icon = !icon.is_empty() && !icon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
            let icon_prefix = if show_icon { format!("{} ", icon) } else { String::new() };

            let display = if desc.is_empty() {
                format!("{}{}", icon_prefix, name)
            } else {
                format!("{}{} \x1b[2m{}\x1b[0m", icon_prefix, name, desc)
            };
            Some(format!("{}\t{}\t{}", line, display, keywords))
        })
        .collect();

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(display_items.join("\n").as_bytes());
    }

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on fzf: {e}");
        std::process::exit(1);
    });

    if !output.status.success() {
        return String::new();
    }

    // Extract JSON from selected line (before \t)
    let selected = String::from_utf8_lossy(&output.stdout);
    selected
        .lines()
        .next()
        .and_then(|line| line.split('\t').next())
        .unwrap_or("")
        .to_string()
}
