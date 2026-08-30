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

/// `ps` answers this on every unix, so there is one parser rather than a
/// `/proc` walk beside a macOS `ps` branch. Only the selector flag differs, and
/// `args` comes last because it is the one field that contains spaces.
#[cfg(target_os = "macos")]
const PS_ARGS: [&str; 2] = ["-axo", "pid=,uid=,pcpu=,rss=,args="];
#[cfg(not(target_os = "macos"))]
const PS_ARGS: [&str; 2] = ["-eo", "pid=,uid=,pcpu=,rss=,args="];

fn list() -> String {
    let my_pid = std::process::id();
    let my_uid = current_uid();

    let output = Command::new("ps")
        .args(PS_ARGS)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut procs: Vec<serde_json::Value> = output
        .lines()
        .filter_map(|line| parse(line, my_pid, my_uid))
        .collect();

    // Newest first.
    procs.sort_by_key(|p| std::cmp::Reverse(p.get("pid").and_then(|v| v.as_u64()).unwrap_or(0)));

    procs.iter().map(|p| p.to_string()).collect::<Vec<_>>().join("\n")
}

fn parse(line: &str, my_pid: u32, my_uid: u32) -> Option<serde_json::Value> {
    // ps pads its columns, so take one field at a time and re-trim between.
    let mut rest = line.trim_start();
    let mut field = || -> Option<&str> {
        let (value, tail) = rest.trim_start().split_once(char::is_whitespace)?;
        rest = tail;
        Some(value)
    };

    let pid: u32 = field()?.parse().ok()?;
    let uid: u32 = field()?.parse().unwrap_or(0);
    let cpu: f64 = field()?.parse().unwrap_or(0.0);
    let rss: u64 = field()?.parse().unwrap_or(0);
    let cmdline = rest.trim();

    if pid == my_pid || cmdline.is_empty() {
        return None;
    }

    // The executable's own name, which is what you scan for; the whole command
    // line is the subtitle, so nothing is lost by not putting it in the title.
    let name = cmdline
        .split_whitespace()
        .next()
        .unwrap_or(cmdline)
        .rsplit('/')
        .next()
        .unwrap_or(cmdline);

    let mut accessories = Vec::new();
    // A process using nothing has nothing to say; only the busy ones earn a tag.
    if cpu >= 1.0 {
        let color = if cpu >= 50.0 {
            "red"
        } else if cpu >= 10.0 {
            "orange"
        } else {
            "secondary"
        };
        accessories.push(json!({ "tag": { "value": format!("{cpu:.0}% cpu"), "color": color } }));
    }
    if rss > 0 {
        accessories.push(json!({ "text": { "value": human_mb(rss), "color": "secondary" } }));
    }

    Some(json!({
        "id": pid.to_string(),
        "pid": pid,
        "name": name,
        "subtitle": cmdline,
        "keywords": [pid.to_string(), name.to_string()],
        "cmdline": cmdline,
        "uid": uid,
        "cpu": cpu,
        "section": if uid == my_uid { "Mine" } else if uid == 0 { "System" } else { "Other" },
        "icon_rc": "MemoryChip",
        "icon_xdg": "utilities-system-monitor",
        "accessories": accessories,
    }))
}

/// ps reports rss in kilobytes.
fn human_mb(rss_kb: u64) -> String {
    if rss_kb >= 1024 * 1024 {
        format!("{:.1} GB", rss_kb as f64 / (1024.0 * 1024.0))
    } else {
        format!("{} MB", rss_kb / 1024)
    }
}

fn current_uid() -> u32 {
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0)
}

fn pick(input: &str) -> String {
    let item: serde_json::Value = serde_json::from_str(input).unwrap_or_default();
    let pid = item.get("pid").and_then(|v| v.as_u64()).unwrap_or(0);

    if pid == 0 {
        return String::new();
    }

    let killed = Command::new("kill")
        .arg(pid.to_string())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("process");
    if killed {
        json!({ "hud": format!("Killed {name} ({pid})"), "reload": true }).to_string()
    } else {
        json!({ "toast": { "style": "failure", "title": format!("Could not kill {name}") } }).to_string()
    }
}
