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
    let mut child = Command::new("fzf")
        .args(["--ansi", "--no-sort", "--layout=reverse"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run fzf: {e}");
            std::process::exit(1);
        });

    // Format items for fzf: show name, keep full JSON for output
    let display_items: Vec<String> = items
        .lines()
        .filter_map(|line| {
            let item: serde_json::Value = serde_json::from_str(line).ok()?;
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let icon = item.get("icon").and_then(|v| v.as_str()).unwrap_or("");
            // Format: JSON\ticon name (fzf shows after \t)
            Some(format!("{}\t{} {}", line, icon, name))
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
