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

/// macOS has no `/proc`, so the listing comes from `ps`. Two calls rather than
/// one: `comm` and `args` can both contain spaces, so each is asked for last
/// on its own line and the two are joined on pid.
#[cfg(target_os = "macos")]
fn list() -> String {
    use std::collections::HashMap;

    let my_pid = std::process::id();

    let out = |args: &[&str]| -> String {
        Command::new("ps")
            .args(args)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default()
    };

    let mut cmdlines: HashMap<u32, String> = HashMap::new();
    for line in out(&["-axo", "pid=,args="]).lines() {
        let line = line.trim_start();
        let Some((pid, args)) = line.split_once(char::is_whitespace) else { continue };
        let Ok(pid) = pid.parse::<u32>() else { continue };
        cmdlines.insert(pid, args.trim().to_string());
    }

    let mut procs = Vec::new();
    for line in out(&["-axo", "pid=,uid=,comm="]).lines() {
        // ps pads its columns, so split a field at a time and re-trim between.
        let Some((pid, rest)) = line.trim_start().split_once(char::is_whitespace) else { continue };
        let Ok(pid) = pid.parse::<u32>() else { continue };
        if pid == my_pid {
            continue;
        }
        let Some((uid, comm)) = rest.trim_start().split_once(char::is_whitespace) else { continue };
        let uid = uid.parse::<u32>().unwrap_or(0);
        // `comm` is a full executable path here; the last component is the name.
        let comm = comm.trim().rsplit('/').next().unwrap_or("").to_string();

        let cmdline = cmdlines.remove(&pid).unwrap_or_else(|| comm.clone());
        if cmdline.is_empty() {
            continue;
        }

        procs.push(json!({
            "id": pid.to_string(),
            "pid": pid,
            "name": display_name(&cmdline),
            "comm": comm,
            "cmdline": cmdline,
            "uid": uid,
            "icon": "utilities-system-monitor",
        }));
    }

    sort_by_pid_desc(&mut procs);

    procs.iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Keep the full command line in `cmdline`; the display copy is truncated.
fn display_name(cmdline: &str) -> String {
    if cmdline.chars().count() > 80 {
        let head: String = cmdline.chars().take(77).collect();
        format!("{head}...")
    } else {
        cmdline.to_string()
    }
}

fn sort_by_pid_desc(procs: &mut [serde_json::Value]) {
    // Newest first.
    procs.sort_by(|a, b| {
        let pid_a = a.get("pid").and_then(|v| v.as_u64()).unwrap_or(0);
        let pid_b = b.get("pid").and_then(|v| v.as_u64()).unwrap_or(0);
        pid_b.cmp(&pid_a)
    });
}

#[cfg(not(target_os = "macos"))]
fn list() -> String {
    use std::fs;
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
            "name": display_name(&cmdline),
            "comm": comm,
            "cmdline": cmdline,
            "uid": uid,
            "icon": "utilities-system-monitor",
        }));
    }

    sort_by_pid_desc(&mut procs);

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
