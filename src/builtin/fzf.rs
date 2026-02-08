use std::io::Write;
use std::process::{Command, Stdio};

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "run" => run_fzf(input.unwrap_or("")),
        "prompt" => prompt(input.unwrap_or("Input")),
        "input_run" => input_run(input.unwrap_or("Input")),
        _ => {
            eprintln!("fzf: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

/// Format JSON items into fzf display lines: {json}\t{display}\t{keywords}
pub fn format_items(items: &str) -> String {
    items
        .lines()
        .filter_map(|line| {
            let item: serde_json::Value = serde_json::from_str(line).ok()?;
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let icon = item.get("icon_utf")
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

            let show_icon = !icon.is_empty() && !icon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
            let icon_prefix = if show_icon { format!("{} ", icon) } else { String::new() };

            let display = if desc.is_empty() {
                format!("{}{}", icon_prefix, name)
            } else {
                format!("{}{} \x1b[2m{}\x1b[0m", icon_prefix, name, desc)
            };
            Some(format!("{}\t{}\t{}", line, display, keywords))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn prompt(message: &str) -> String {
    let child = Command::new("fzf")
        .args([
            "--disabled", "--print-query",
            &format!("--prompt={message}> "),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run fzf: {e}");
            std::process::exit(1);
        });

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on fzf: {e}");
        std::process::exit(1);
    });

    if output.status.code() == Some(130) {
        return String::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .to_string()
}

/// Live input mode: fzf reloads items on each keystroke via `pal _input-list`
fn input_run(message: &str) -> String {
    let palette = std::env::var("_PAL_PALETTE").unwrap_or_default();
    let config = std::env::var("_PAL_CONFIG").unwrap_or_default();
    let exe = std::env::current_exe()
        .unwrap_or_else(|_| "pal".into())
        .to_string_lossy()
        .to_string();

    let reload_cmd = format!(
        "printf '%s' {{q}} | \"{}\" --config \"{}\" _input-list {} fzf",
        exe, config, palette
    );

    let mut child = Command::new("fzf")
        .args([
            "--disabled", "--ansi", "--no-sort", "--layout=reverse",
            "--delimiter=\t", "--with-nth=2",
            &format!("--prompt={message}> "),
            "--bind", &format!("change:reload:{reload_cmd} || true"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("failed to run fzf: {e}");
            std::process::exit(1);
        });

    // Start with empty items
    drop(child.stdin.take());

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on fzf: {e}");
        std::process::exit(1);
    });

    if !output.status.success() {
        return String::new();
    }

    let selected = String::from_utf8_lossy(&output.stdout);
    selected
        .lines()
        .next()
        .and_then(|line| line.split('\t').next())
        .unwrap_or("")
        .to_string()
}

fn run_fzf(items: &str) -> String {
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

    let formatted = format_items(items);

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(formatted.as_bytes());
    }

    let output = child.wait_with_output().unwrap_or_else(|e| {
        eprintln!("failed to wait on fzf: {e}");
        std::process::exit(1);
    });

    if !output.status.success() {
        return String::new();
    }

    let selected = String::from_utf8_lossy(&output.stdout);
    selected
        .lines()
        .next()
        .and_then(|line| line.split('\t').next())
        .unwrap_or("")
        .to_string()
}
