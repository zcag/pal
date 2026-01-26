use std::fs;
use std::process::Command;

use serde_json::json;

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "list" => list(),
        "pick" => pick(input.unwrap_or("")),
        _ => {
            eprintln!("psg: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn list() -> String {
    let mut procs = Vec::new();
    let my_pid = std::process::id();

    let Ok(entries) = fs::read_dir("/proc") else {
        return String::new();
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Only process numeric directories (PIDs)
        let Ok(pid) = name_str.parse::<u32>() else {
            continue;
        };

        // Skip our own process
        if pid == my_pid {
            continue;
        }

        let proc_path = entry.path();

        // Read cmdline
        let cmdline = fs::read_to_string(proc_path.join("cmdline"))
            .unwrap_or_default()
            .replace('\0', " ")
            .trim()
            .to_string();

        if cmdline.is_empty() {
            continue;
        }

        // Read comm (process name)
        let comm = fs::read_to_string(proc_path.join("comm"))
            .unwrap_or_default()
            .trim()
            .to_string();

        // Read status for user info
        let uid = fs::read_to_string(proc_path.join("status"))
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("Uid:"))
                    .and_then(|l| l.split_whitespace().nth(1))
                    .and_then(|u| u.parse::<u32>().ok())
            })
            .unwrap_or(0);

        procs.push(json!({
            "id": pid.to_string(),
            "pid": pid,
            "name": comm,
            "cmdline": cmdline,
            "uid": uid,
            "icon": "process",
        }));
    }

    // Sort by PID descending (newest first)
    procs.sort_by(|a, b| {
        let pid_a = a.get("pid").and_then(|v| v.as_u64()).unwrap_or(0);
        let pid_b = b.get("pid").and_then(|v| v.as_u64()).unwrap_or(0);
        pid_b.cmp(&pid_a)
    });

    procs.iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn pick(input: &str) -> String {
    let item: serde_json::Value = serde_json::from_str(input).unwrap_or_default();
    let pid = item.get("pid").and_then(|v| v.as_u64()).unwrap_or(0);

    if pid == 0 {
        return String::new();
    }

    let _ = Command::new("kill")
        .arg(pid.to_string())
        .status();

    String::new()
}
