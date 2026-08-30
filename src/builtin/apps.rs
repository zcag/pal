#[cfg(not(target_os = "macos"))]
use std::collections::HashMap;
#[cfg(not(target_os = "macos"))]
use std::fs;
#[cfg(not(target_os = "macos"))]
use std::path::Path;
use std::process::Command;

use serde_json::json;

use super::file_util::{scan_dirs, ScanOptions};

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "list" => list(),
        "pick" => pick(input.unwrap_or("")),
        _ => {
            eprintln!("apps: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

/// macOS keeps applications as `.app` bundles rather than desktop entries, so
/// the listing is a bundle scan and `exec` is an `open -a` line - which keeps
/// `pick` identical on both platforms. Handing the bundle path back as the
/// icon is what lets a frontend render the app's real icon.
#[cfg(target_os = "macos")]
/// The bundle identifier, so "com.apple." or "anthropic" finds an app whose
/// display name says neither.
fn bundle_id(path: &std::path::Path) -> Option<String> {
    let plist = std::fs::read_to_string(path.join("Contents/Info.plist")).ok()?;
    let key = plist.find("<key>CFBundleIdentifier</key>")?;
    let start = plist[key..].find("<string>")? + key + "<string>".len();
    let end = plist[start..].find("</string>")? + start;
    Some(plist[start..end].trim().to_string())
}

fn list() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let user_apps = format!("{home}/Applications");
    let dirs = ["/Applications", "/System/Applications", user_apps.as_str()];

    let opts = ScanOptions {
        extension: Some("app"),
        dirs_only: true,
        // Depth 1 also catches the Utilities folders.
        max_depth: 1,
        ..Default::default()
    };

    let mut seen = std::collections::HashSet::new();
    let mut apps = Vec::new();

    for path in scan_dirs(&dirs, &opts) {
        let display = path.to_string_lossy().to_string();
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        // Where it came from is the one thing that separates Apple's built-ins
        // from what you installed, and they look identical otherwise.
        let source = if display.starts_with("/System/") {
            "macOS"
        } else if display.starts_with(&user_apps) {
            "User"
        } else {
            "Applications"
        };
        apps.push(json!({
            "id": display,
            "name": name,
            "subtitle": source,
            "keywords": [bundle_id(&path).unwrap_or_default()],
            "exec": format!("open -a {}", sh_quote(&display)),
            "icon": display,
        }));
    }

    apps.sort_by_key(|a| {
        a.get("name").and_then(|v| v.as_str()).unwrap_or("").to_lowercase()
    });

    apps.iter()
        .map(|a| a.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(target_os = "macos")]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

#[cfg(not(target_os = "macos"))]
fn list() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = [
        "/usr/share/applications",
        "/usr/local/share/applications",
        &format!("{home}/.local/share/applications"),
    ];

    let opts = ScanOptions {
        extension: Some("desktop"),
        max_depth: 0,
        ..Default::default()
    };

    let files = scan_dirs(&dirs.iter().map(|s| *s).collect::<Vec<_>>(), &opts);

    let mut apps: HashMap<String, serde_json::Value> = HashMap::new();

    for path in files {
        if let Some(app) = parse_desktop_file(&path) {
            let id = path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            apps.entry(id).or_insert(app);
        }
    }

    let mut apps: Vec<_> = apps.into_values().collect();
    apps.sort_by(|a, b| {
        let name_a = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let name_b = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        name_a.to_lowercase().cmp(&name_b.to_lowercase())
    });

    apps.iter()
        .map(|a| a.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(not(target_os = "macos"))]
fn parse_desktop_file(path: &Path) -> Option<serde_json::Value> {
    let content = fs::read_to_string(path).ok()?;
    let mut in_desktop_entry = false;
    let mut name = None;
    let mut exec = None;
    let mut icon = None;
    let mut no_display = false;
    let mut hidden = false;
    let mut is_app = false;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_desktop_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_desktop_entry {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            match key {
                "Name" if name.is_none() => name = Some(value.to_string()),
                "Exec" => exec = Some(value.to_string()),
                "Icon" => icon = Some(value.to_string()),
                "Type" => is_app = value == "Application",
                "NoDisplay" => no_display = value == "true",
                "Hidden" => hidden = value == "true",
                _ => {}
            }
        }
    }

    if !is_app || no_display || hidden || name.is_none() || exec.is_none() {
        return None;
    }

    Some(json!({
        "id": path.to_string_lossy(),
        "name": name.unwrap(),
        "exec": exec.unwrap(),
        "icon": icon.unwrap_or_default(),
    }))
}

fn pick(input: &str) -> String {
    let item: serde_json::Value = serde_json::from_str(input).unwrap_or_default();
    let exec = item.get("exec").and_then(|v| v.as_str()).unwrap_or("");

    if exec.is_empty() {
        return String::new();
    }

    // Remove field codes like %u, %U, %f, %F, etc.
    let exec = exec
        .split_whitespace()
        .filter(|s| !s.starts_with('%'))
        .collect::<Vec<_>>()
        .join(" ");

    let _ = Command::new("sh")
        .arg("-c")
        .arg(&exec)
        .spawn();

    String::new()
}
