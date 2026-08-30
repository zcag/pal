use std::path::PathBuf;
use std::process::Command;

use serde_json::json;

pub fn run(cmd: &str, input: Option<&str>) -> String {
    match cmd {
        "list" => list(),
        "pick" => pick(input.unwrap_or("")),
        _ => {
            eprintln!("bookmarks: unknown command: {cmd}");
            std::process::exit(1);
        }
    }
}

fn config() -> serde_json::Value {
    let s = std::env::var("_PAL_PLUGIN_CONFIG").unwrap_or_default();
    serde_json::from_str(&s).unwrap_or_default()
}

fn list() -> String {
    let cfg = config();
    match cfg.get("browser").and_then(|v| v.as_str()) {
        Some("firefox") => list_firefox(),
        Some("chrome") | Some("chromium") => list_chrome(),
        Some(other) => {
            eprintln!("bookmarks: unsupported browser: {other}");
            String::new()
        }
        // Unconfigured: take whichever browser is actually installed here, so
        // the palette works on a machine without Firefox and says nothing
        // about the one that isn't there.
        None if firefox_profile().is_some() => list_firefox(),
        None => list_chrome(),
    }
}

fn firefox_profile() -> Option<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    find_firefox_profile(&home.join(".mozilla/firefox"))
}

fn list_firefox() -> String {
    let Some(profile_dir) = firefox_profile() else {
        eprintln!("bookmarks: firefox profile not found");
        return String::new();
    };

    let places_db = profile_dir.join("places.sqlite");
    if !places_db.exists() {
        eprintln!("bookmarks: places.sqlite not found");
        return String::new();
    }

    // Copy database to temp to avoid locking issues
    let temp_db = std::env::temp_dir().join("pal_places.sqlite");
    if std::fs::copy(&places_db, &temp_db).is_err() {
        eprintln!("bookmarks: failed to copy places.sqlite");
        return String::new();
    }

    // Query bookmarks using sqlite3
    let output = Command::new("sqlite3")
        .arg(&temp_db)
        .arg("-json")
        .arg("SELECT b.id, b.title, p.url FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 AND b.title IS NOT NULL AND p.url NOT LIKE 'place:%'")
        .output();

    let _ = std::fs::remove_file(&temp_db);

    let Ok(output) = output else {
        eprintln!("bookmarks: sqlite3 command failed");
        return String::new();
    };

    let json_str = String::from_utf8_lossy(&output.stdout);
    let bookmarks: Vec<serde_json::Value> = serde_json::from_str(&json_str).unwrap_or_default();

    bookmarks.iter()
        .map(|b| {
            json!({
                "id": b.get("id").and_then(|v| v.as_i64()).unwrap_or(0).to_string(),
                "name": b.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "url": b.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                "icon": "bookmark",
            }).to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn find_firefox_profile(profiles_dir: &PathBuf) -> Option<PathBuf> {
    // Try to find default-release profile first, then any profile
    let entries = std::fs::read_dir(profiles_dir).ok()?;

    let mut default_profile = None;
    let mut any_profile = None;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".default-release") {
            default_profile = Some(entry.path());
            break;
        } else if name.ends_with(".default") || name.contains("default") {
            any_profile = Some(entry.path());
        }
    }

    default_profile.or(any_profile)
}

fn list_chrome() -> String {
    let home = dirs::home_dir().unwrap_or_default();

    // Try Chrome, then Chromium, on either platform's profile location.
    let bookmarks_file = [
        home.join(".config/google-chrome/Default/Bookmarks"),
        home.join(".config/chromium/Default/Bookmarks"),
        home.join("Library/Application Support/Google/Chrome/Default/Bookmarks"),
        home.join("Library/Application Support/Chromium/Default/Bookmarks"),
    ]
    .into_iter()
    .find(|p| p.exists());

    let Some(bookmarks_file) = bookmarks_file else {
        eprintln!("bookmarks: chrome bookmarks not found");
        return String::new();
    };

    let content = std::fs::read_to_string(&bookmarks_file).unwrap_or_default();
    let data: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();

    let mut results = Vec::new();
    extract_chrome_bookmarks(&data, &mut results);

    results.iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_chrome_bookmarks(node: &serde_json::Value, results: &mut Vec<serde_json::Value>) {
    if let Some(obj) = node.as_object() {
        // Check if this is a bookmark
        if obj.get("type").and_then(|v| v.as_str()) == Some("url") {
            let url = obj.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let name = obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            // Icon-only bookmarks-bar entries carry no name; a bare host beats
            // a blank row.
            let name = if name.is_empty() { host_of(url) } else { name.to_string() };
            results.push(json!({
                "id": obj.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "name": name,
                "url": url,
                "icon": "bookmark",
            }));
        }

        // Recurse into children
        if let Some(children) = obj.get("children").and_then(|v| v.as_array()) {
            for child in children {
                extract_chrome_bookmarks(child, results);
            }
        }

        // Recurse into roots
        if let Some(roots) = obj.get("roots").and_then(|v| v.as_object()) {
            for (_, v) in roots {
                extract_chrome_bookmarks(v, results);
            }
        }
    }
}

fn pick(input: &str) -> String {
    let item: serde_json::Value = serde_json::from_str(input).unwrap_or_default();
    let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("");

    if url.is_empty() {
        return String::new();
    }

    let _ = Command::new("xdg-open").arg(url).spawn();

    String::new()
}

/// "https://mail.google.com/mail/u/0/#inbox" -> "mail.google.com"
fn host_of(url: &str) -> String {
    url.split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
        .to_string()
}
