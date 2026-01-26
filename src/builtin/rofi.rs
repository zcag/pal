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
        .args(["-dmenu", "-i", "-p", "pal", "-show-icons"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run rofi: {e}");
            std::process::exit(1);
        });

    // Build a map of name -> JSON for lookup after selection
    let mut name_to_json: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // Format items for rofi with icons: "name\0icon\x1ficon-name"
    let display_items: Vec<String> = items
        .lines()
        .filter_map(|line| {
            let item: serde_json::Value = serde_json::from_str(line).ok()?;
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let icon = item.get("icon").and_then(|v| v.as_str()).unwrap_or("");

            name_to_json.insert(name.to_string(), line.to_string());

            // Rofi format: "display\0icon\x1ficon-name"
            Some(format!("{}\0icon\x1f{}", name, icon))
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
    name_to_json.get(&selected_name).cloned().unwrap_or_default()
}
