use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use serde_json::json;

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "list" => list(),
        "pick" => pick(input.unwrap_or("")),
        _ => {
            eprintln!("ssh: unknown command: {cmd}");
            String::new()
        }
    }
}

fn list() -> String {
    let mut hosts: HashSet<String> = HashSet::new();

    // Parse ~/.ssh/config
    if let Some(home) = dirs::home_dir() {
        let config_path = home.join(".ssh/config");
        if let Ok(content) = fs::read_to_string(&config_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.to_lowercase().starts_with("host ") {
                    for host in line[5..].split_whitespace() {
                        // Skip wildcards and patterns
                        if !host.contains('*') && !host.contains('?') && !host.contains('!') {
                            hosts.insert(host.to_string());
                        }
                    }
                }
            }
        }

        // Parse ~/.ssh/known_hosts for additional hosts
        let known_hosts = home.join(".ssh/known_hosts");
        if let Ok(content) = fs::read_to_string(&known_hosts) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
                    continue;
                }
                // Format: hostname[,hostname...] keytype key [comment]
                // Or hashed: |1|base64|base64 keytype key
                if let Some(host_part) = line.split_whitespace().next() {
                    // Skip hashed entries
                    if host_part.starts_with('|') {
                        continue;
                    }
                    // Handle multiple hosts separated by comma
                    for host in host_part.split(',') {
                        // Remove port if present [host]:port
                        let host = if host.starts_with('[') {
                            host.trim_start_matches('[').split(']').next().unwrap_or(host)
                        } else {
                            host
                        };
                        // Skip IP addresses (keep hostnames)
                        if !host.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                            hosts.insert(host.to_string());
                        }
                    }
                }
            }
        }

        // Also check for Include directives and parse those configs
        let config_path = home.join(".ssh/config");
        if let Ok(content) = fs::read_to_string(&config_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.to_lowercase().starts_with("include ") {
                    let pattern = line[8..].trim();
                    let expanded = if pattern.starts_with("~/") {
                        home.join(&pattern[2..])
                    } else if pattern.starts_with('/') {
                        PathBuf::from(pattern)
                    } else {
                        home.join(".ssh").join(pattern)
                    };

                    // Simple glob: if contains *, try to expand
                    if pattern.contains('*') {
                        if let Some(parent) = expanded.parent() {
                            if let Ok(entries) = fs::read_dir(parent) {
                                for entry in entries.flatten() {
                                    if let Ok(content) = fs::read_to_string(entry.path()) {
                                        parse_config_hosts(&content, &mut hosts);
                                    }
                                }
                            }
                        }
                    } else if let Ok(content) = fs::read_to_string(&expanded) {
                        parse_config_hosts(&content, &mut hosts);
                    }
                }
            }
        }
    }

    let mut hosts: Vec<_> = hosts.into_iter().collect();
    hosts.sort();

    hosts.iter()
        .map(|h| json!({"id": h, "name": h, "icon": "network-server"}).to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_config_hosts(content: &str, hosts: &mut HashSet<String>) {
    for line in content.lines() {
        let line = line.trim();
        if line.to_lowercase().starts_with("host ") {
            for host in line[5..].split_whitespace() {
                if !host.contains('*') && !host.contains('?') && !host.contains('!') {
                    hosts.insert(host.to_string());
                }
            }
        }
    }
}

fn pick(input: &str) -> String {
    let item: serde_json::Value = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(_) => return String::new(),
    };

    let host = item["id"].as_str().unwrap_or("");
    if host.is_empty() {
        return String::new();
    }

    let frontend = std::env::var("_PAL_FRONTEND").unwrap_or_default();
    let is_stdio = matches!(frontend.as_str(), "fzf" | "stdin" | "");

    if is_stdio {
        // Run ssh directly - we're in a terminal
        let _ = std::process::Command::new("ssh")
            .arg(host)
            .status();
    } else {
        // Non-stdio frontend (rofi, etc.) - copy to clipboard and notify
        let cmd = format!("ssh {}", host);
        copy_and_notify(&cmd);
    }

    String::new()
}

fn copy_and_notify(text: &str) {
    use std::process::{Command, Stdio};
    use std::io::Write;

    // Copy to clipboard
    let copied = if Command::new("which").arg("wl-copy").output()
        .map(|o| o.status.success()).unwrap_or(false) {
        Command::new("wl-copy")
            .stdin(Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                c.stdin.as_mut().unwrap().write_all(text.as_bytes())?;
                c.wait()
            }).is_ok()
    } else if Command::new("which").arg("xclip").output()
        .map(|o| o.status.success()).unwrap_or(false) {
        Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                c.stdin.as_mut().unwrap().write_all(text.as_bytes())?;
                c.wait()
            }).is_ok()
    } else {
        false
    };

    // Show notification
    if copied {
        let _ = Command::new("notify-send")
            .args(["-t", "2000", "Copied", text])
            .spawn();
    }
}
