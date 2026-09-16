//! What the last crash looked like, for the run after it. Three pieces:
//!
//! - A panic hook that writes the message, the location and a backtrace to
//!   `<profile data dir>/last-panic.txt` before the default hook aborts the
//!   process (release builds are `panic = "abort"`), so a Rust panic leaves
//!   something readable where the OS report has only addresses.
//! - The OS's own crash report: on macOS the newest
//!   `~/Library/Logs/DiagnosticReports/pal-*.ips` that is ours (first-line
//!   header `app_name`, and `bundleID` for a bundled build), on Linux the
//!   last `coredumpctl` entry for `pal`. Only the header and the exception
//!   type are read; nothing is uploaded anywhere.
//! - The announcement: `<profile data dir>/crash.json` remembers when this
//!   profile last started and which report it has already shown. A report
//!   newer than the previous start that has not been shown gets one log
//!   line and, once the HUD window is up, "pal restarted after a crash".
//!   About shows the last report either way (`settings_about`).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::hud;

/// The panic file's name under the profile's data dir.
pub const PANIC_FILE: &str = "last-panic.txt";
const STATE_FILE: &str = "crash.json";
/// How long after start the scan runs and the HUD is told: the HUD
/// window's page has loaded by then, the panel's first paint is not
/// competing with it, and a process handing itself over to the agent
/// (autostart.rs) is long gone, so the state file is the agent's run's.
const SCAN_DELAY: Duration = Duration::from_secs(3);

/// An OS crash report of a previous run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Report {
    /// The `.ips` on macOS; none on Linux, where `coredumpctl` owns the dump.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    /// When it was written, unix ms (the file's mtime on macOS).
    pub at: u64,
    /// `EXC_BREAKPOINT (SIGTRAP)` on macOS, `signal 11 (SIGSEGV)` on Linux.
    pub kind: String,
}

/// The panic file of a previous run, its first lines.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Panic {
    pub path: PathBuf,
    pub at: u64,
    pub message: String,
}

/// What the startup scan found; managed state, read by `settings_about`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Found {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<Report>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panic: Option<Panic>,
}

/// `crash.json`: the previous start, and the report already announced.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct State {
    #[serde(skip_serializing_if = "Option::is_none")]
    started: Option<u64>,
    /// The announced report's file name (macOS) or time (Linux).
    #[serde(skip_serializing_if = "Option::is_none")]
    seen: Option<String>,
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The hook now; the scan, the state and the HUD after [`SCAN_DELAY`], off
/// this thread. `data` is the profile's data dir.
pub fn install(app: &AppHandle, data: &Path) {
    hook(data.join(PANIC_FILE));
    app.manage(std::sync::Mutex::new(Found::default()));
    let data = data.to_path_buf();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(SCAN_DELAY);
        let found = scan(&app, &data);
        if let Some(p) = &found.panic {
            eprintln!("crash\tpanic\t{}\t{}", p.path.display(), p.message);
        }
        let state_path = data.join(STATE_FILE);
        let prev: State = std::fs::read(&state_path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        let announce = announce(found.report.as_ref(), &prev);
        if let Some(r) = &found.report {
            eprintln!("crash\treport\t{}\t{}\t{}", r.kind, r.at, r.path.as_deref().map_or_else(|| "coredumpctl".into(), |p| p.display().to_string()));
        }
        let next = State { started: Some(unix_ms(SystemTime::now())), seen: found.report.as_ref().map(key).or(prev.seen) };
        if let Err(e) = pal_core::fs::write_atomic(&state_path, serde_json::to_vec(&next).unwrap_or_default()) {
            eprintln!("crash\tstate write failed\t{e}");
        }
        *lock(&app) = found;
        if announce {
            eprintln!("crash\tannounced\trestarted after a crash");
            hud::show(&app, "pal restarted after a crash");
        }
    });
}

/// The managed `Found`, replaced once the scan is done.
fn lock(app: &AppHandle) -> std::sync::MutexGuard<'_, Found> {
    crate::lock(app.state::<std::sync::Mutex<Found>>().inner())
}

/// What the scan found, for About.
pub fn found(app: &AppHandle) -> Found {
    app.try_state::<std::sync::Mutex<Found>>().map(|s| crate::lock(&s).clone()).unwrap_or_default()
}

/// A report is announced once: it is newer than the previous start (so a
/// report from before this build ran, or one already shown, stays quiet)
/// and not the one `seen` names. No previous start recorded means no
/// announcement: there is no run to have crashed.
fn announce(report: Option<&Report>, prev: &State) -> bool {
    let (Some(r), Some(started)) = (report, prev.started) else { return false };
    r.at > started && prev.seen.as_deref() != Some(key(r).as_str())
}

/// What `seen` remembers a report by.
fn key(r: &Report) -> String {
    r.path.as_ref().and_then(|p| p.file_name()).map_or_else(|| r.at.to_string(), |n| n.to_string_lossy().into_owned())
}

// ---- the panic hook ---------------------------------------------------------

/// Chain a hook before the default one: the file first, then the default
/// hook's message on stderr and, under `panic = "abort"`, the abort.
fn hook(path: PathBuf) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into());
        let location = info.location().map_or_else(String::new, |l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
        let text = format!("{}\n{message}\n{location}\n\n{}", unix_ms(SystemTime::now()), std::backtrace::Backtrace::force_capture());
        // Not `write_atomic`: the less that runs in a hook the better, and
        // a torn file is still a file.
        let _ = path.parent().map(std::fs::create_dir_all);
        let _ = std::fs::write(&path, text);
        prev(info);
    }));
}

/// The panic file as written by [`hook`]: `<unix ms>\n<message>\n<location>`.
pub fn parse_panic(text: &str) -> Option<(u64, String)> {
    let mut lines = text.lines();
    let at = lines.next()?.trim().parse().ok()?;
    let message = lines.next()?.trim().to_string();
    Some((at, message))
}

fn read_panic(path: &Path) -> Option<Panic> {
    let text = std::fs::read_to_string(path).ok()?;
    let (at, message) = parse_panic(&text)?;
    Some(Panic { path: path.to_path_buf(), at, message })
}

// ---- the OS report -----------------------------------------------------------

fn scan(app: &AppHandle, data: &Path) -> Found {
    let panic = read_panic(&data.join(PANIC_FILE));
    let report = platform_report(app);
    Found { report, panic }
}

/// What a macOS `.ips` says in its first line (JSON) and, further down, its
/// `"exception"` object.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Ips {
    pub app_name: String,
    pub bundle_id: Option<String>,
    pub timestamp: String,
    /// `EXC_BREAKPOINT (SIGTRAP)`; the type alone when the signal is missing.
    pub kind: String,
}

/// The header line, and the exception object found by its key (the body is
/// one pretty-printed JSON object of a few hundred KB; the exception sits
/// on one line near the top and has no nested objects, so the first `}`
/// after it closes it). No exception (a hang report, say) is still a
/// report: the kind is then the header's `bug_type`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_ips(text: &str) -> Option<Ips> {
    let (first, body) = text.split_once('\n')?;
    let header: Value = serde_json::from_str(first).ok()?;
    let app_name = header["app_name"].as_str()?.to_string();
    let bundle_id = header["bundleID"].as_str().map(str::to_string);
    let timestamp = header["timestamp"].as_str().unwrap_or_default().to_string();
    let exception = body.find("\"exception\"").and_then(|i| {
        let rest = &body[i..];
        let open = rest.find('{')?;
        let close = rest[open..].find('}')?;
        serde_json::from_str::<Value>(&rest[open..open + close + 1]).ok()
    });
    let kind = match exception {
        Some(e) => match (e["type"].as_str(), e["signal"].as_str()) {
            (Some(t), Some(s)) => format!("{t} ({s})"),
            (Some(t), None) => t.to_string(),
            _ => "unknown exception".into(),
        },
        None => format!("bug_type {}", header["bug_type"].as_str().unwrap_or("?")),
    };
    Some(Ips { app_name, bundle_id, timestamp, kind })
}

/// Whether an `.ips` header is this build's: the process name, and for a
/// bundled build the bundle id too (a report of a bare `target/release/pal`
/// has none, and a bundled build's report is never a bare build's).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn is_ours(ips: &Ips, name: &str, identifier: &str, bundled: bool) -> bool {
    ips.app_name == name
        && match &ips.bundle_id {
            Some(id) => id == identifier,
            None => !bundled,
        }
}

#[cfg(target_os = "macos")]
fn platform_report(app: &AppHandle) -> Option<Report> {
    let dir = PathBuf::from(std::env::var_os("HOME")?).join("Library/Logs/DiagnosticReports");
    let name = app.package_info().name.clone();
    let identifier = app.config().identifier.clone();
    let bundled = std::env::current_exe().map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/")).unwrap_or(false);
    let prefix = format!("{name}-");
    let mut newest: Option<(u64, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !file.starts_with(&prefix) || !file.ends_with(".ips") {
            continue;
        }
        let at = entry.metadata().and_then(|m| m.modified()).map(unix_ms).unwrap_or(0);
        if newest.as_ref().is_some_and(|(t, _)| *t >= at) {
            continue;
        }
        // The header line decides; the full parse waits for the winner.
        let Some(header) = first_line(&path).and_then(|l| parse_ips(&format!("{l}\n"))) else { continue };
        if is_ours(&header, &name, &identifier, bundled) {
            newest = Some((at, path));
        }
    }
    let (at, path) = newest?;
    let ips = std::fs::read_to_string(&path).ok().and_then(|t| parse_ips(&t))?;
    Some(Report { path: Some(path), at, kind: ips.kind })
}

#[cfg(target_os = "macos")]
fn first_line(path: &Path) -> Option<String> {
    use std::io::BufRead;
    let mut line = String::new();
    std::io::BufReader::new(std::fs::File::open(path).ok()?).read_line(&mut line).ok()?;
    Some(line)
}

/// `coredumpctl list --json=short pal`, when there is a `coredumpctl`: the
/// last entry whose `exe` is this binary.
#[cfg(target_os = "linux")]
fn platform_report(_app: &AppHandle) -> Option<Report> {
    let exe = std::env::current_exe().ok()?;
    let out = std::process::Command::new("coredumpctl").args(["list", "--json=short", "--no-legend", "pal"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let rows: Vec<Value> = serde_json::from_slice(&out.stdout).ok()?;
    let row = rows.iter().rev().find(|r| r["exe"].as_str().is_some_and(|e| Path::new(e) == exe))?;
    let at = row["time"].as_u64()? / 1000;
    let sig = row["sig"].as_u64().unwrap_or(0);
    Some(Report { path: None, at, kind: format!("signal {sig}") })
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = r#"{"app_name":"pal","timestamp":"2026-09-16 14:40:17.00 +0300","app_version":"0.1.0","bundleID":"io.cagdas.pal","bug_type":"309","incident_id":"F6EB6FE3"}"#;
    const BODY: &str = r#"{
  "uptime" : 1100000,
  "procName" : "pal",
  "bundleInfo" : {"CFBundleIdentifier":"io.cagdas.pal"},
  "exception" : {"codes":"0x0000000000000001, 0x000000018a5aa478","rawCodes":[1,6616163448],"type":"EXC_BREAKPOINT","signal":"SIGTRAP"},
  "termination" : {"flags":0,"code":5,"namespace":"SIGNAL","indicator":"Trace\/BPT trap: 5"},
  "faultingThread" : 9
}
"#;

    #[test]
    fn ips_header_and_exception() {
        let ips = parse_ips(&format!("{HEADER}\n{BODY}")).unwrap();
        assert_eq!(ips.app_name, "pal");
        assert_eq!(ips.bundle_id.as_deref(), Some("io.cagdas.pal"));
        assert_eq!(ips.timestamp, "2026-09-16 14:40:17.00 +0300");
        assert_eq!(ips.kind, "EXC_BREAKPOINT (SIGTRAP)");
    }

    #[test]
    fn ips_without_bundle_or_exception() {
        let header = r#"{"app_name":"pal-app","timestamp":"2026-09-16 01:03:35.00 +0300","bug_type":"309","name":"pal-app"}"#;
        let ips = parse_ips(&format!("{header}\n{{\n  \"procName\" : \"pal-app\"\n}}\n")).unwrap();
        assert_eq!(ips.app_name, "pal-app");
        assert_eq!(ips.bundle_id, None);
        assert_eq!(ips.kind, "bug_type 309");
        assert!(parse_ips("not json\n{}").is_none());
        assert!(parse_ips(HEADER).is_none(), "a header with no newline is not a report");
    }

    #[test]
    fn ours_by_name_and_bundle() {
        let bundled = parse_ips(&format!("{HEADER}\n{BODY}")).unwrap();
        assert!(is_ours(&bundled, "pal", "io.cagdas.pal", true));
        assert!(!is_ours(&bundled, "pal", "io.cagdas.pal.scratch", true), "another build's bundle id");
        assert!(!is_ours(&bundled, "pal-app", "io.cagdas.pal", true));
        let bare = Ips { bundle_id: None, ..bundled.clone() };
        assert!(is_ours(&bare, "pal", "io.cagdas.pal", false), "a bare binary's report has no bundle id");
        assert!(!is_ours(&bare, "pal", "io.cagdas.pal", true), "and is never a bundled build's");
    }

    fn report(at: u64) -> Report {
        Report { path: Some(PathBuf::from(format!("/r/pal-{at}.ips"))), at, kind: "EXC_CRASH (SIGABRT)".into() }
    }

    #[test]
    fn announce_once_and_only_after_a_recorded_start() {
        let r = report(2000);
        assert!(!announce(None, &State { started: Some(1000), seen: None }));
        assert!(!announce(Some(&r), &State::default()), "no previous start: nothing to have crashed");
        assert!(announce(Some(&r), &State { started: Some(1000), seen: None }));
        assert!(!announce(Some(&r), &State { started: Some(3000), seen: None }), "older than the last start");
        assert!(!announce(Some(&r), &State { started: Some(1000), seen: Some("pal-2000.ips".into()) }), "already shown");
        assert!(announce(Some(&r), &State { started: Some(1000), seen: Some("pal-1500.ips".into()) }), "a newer report than the one shown");
    }

    #[test]
    fn panic_file_first_lines() {
        assert_eq!(parse_panic("1758000000000\nindex out of bounds\napp/src/x.rs:1:2\n\nbacktrace"), Some((1758000000000, "index out of bounds".into())));
        assert_eq!(parse_panic("junk\nmessage"), None);
        assert_eq!(parse_panic(""), None);
    }

    #[test]
    fn hook_writes_the_panic_file_then_defers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join(PANIC_FILE);
        hook(path.clone());
        let r = std::thread::spawn(|| panic!("boom {}", 42)).join();
        assert!(r.is_err(), "the default hook still ran and the thread still unwound");
        let text = std::fs::read_to_string(&path).unwrap();
        let (at, message) = parse_panic(&text).unwrap();
        assert!(at > 0);
        assert_eq!(message, "boom 42");
        assert!(text.lines().nth(2).unwrap().contains("crash.rs:"), "the location line");
    }

    #[test]
    fn state_round_trips() {
        let s = State { started: Some(1), seen: Some("pal-x.ips".into()) };
        let back: State = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        assert_eq!(back, s);
        assert_eq!(serde_json::from_str::<State>("{}").unwrap(), State::default());
    }
}
