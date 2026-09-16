//! Shelling out to the tool a device capability wraps (`wpctl`, `pactl`,
//! `bluetoothctl`, `nmcli`, `networksetup`, `playerctl`, `osascript`):
//! one place for the three outcomes every caller distinguishes, so
//! `audio`, `bluetooth`, `wifi` and `media` share the error type and the
//! bridge shows the tool's own complaint. [`run_timeout`] is for tools
//! that can block for good (`bluetoothctl` with a wedged adapter).

use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Not on this platform, or its tool is not installed.
    #[error("{0}")]
    Unavailable(String),
    /// The tool ran and refused, with what it said.
    #[error("{0}")]
    Failed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Run to completion; stdout on success, [`Error::Failed`] with stderr
/// (else stdout) on a non-zero exit, [`Error::Unavailable`] when `bin` is
/// not installed.
pub fn run(bin: &str, args: &[&str]) -> Result<String> {
    run_in(bin, args, None)
}

/// [`run`] with `stdin` fed to the tool (an `osascript` script, say).
pub fn run_in(bin: &str, args: &[&str], stdin: Option<&str>) -> Result<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args).stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::Unavailable(format!("{bin} is not installed")),
        _ => Error::Io(e),
    })?;
    if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
        // A tool that exits before reading (a syntax error) closes the pipe; that is its exit status's story, not ours.
        let _ = pipe.write_all(text.as_bytes());
    }
    let out = child.wait_with_output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        return Err(Error::Failed(format!("{bin}: {}", if err.is_empty() { out.status.to_string() } else { err })));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// [`run`] killed after `secs` through coreutils' `timeout` (exit 124 is
/// reported as such), for a tool that may never answer. On macOS, where
/// `timeout` is not stock, a plain [`run`].
pub fn run_timeout(secs: u32, bin: &str, args: &[&str]) -> Result<String> {
    if cfg!(target_os = "linux") && crate::fs::on_path("timeout") {
        let secs = secs.to_string();
        let mut all = vec![secs.as_str(), bin];
        all.extend_from_slice(args);
        return run("timeout", &all).map_err(|e| match e {
            Error::Failed(m) if m.contains("exit status: 124") => Error::Failed(format!("{bin} did not answer within {secs} s")),
            e => e,
        });
    }
    run(bin, args)
}

/// An AppleScript, run whole through `osascript`'s stdin; stdout trimmed.
#[cfg(target_os = "macos")]
pub fn osascript(script: &str) -> Result<String> {
    run_in("osascript", &[], Some(script)).map(|s| s.trim_end().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_tool_is_unavailable_and_a_refusal_carries_stderr() {
        assert!(matches!(run("pal-no-such-tool-xyz", &[]), Err(Error::Unavailable(_))));
        let err = run("sh", &["-c", "echo nope >&2; exit 3"]).unwrap_err();
        assert!(matches!(&err, Error::Failed(m) if m == "sh: nope"), "{err}");
        let err = run("sh", &["-c", "echo on-stdout; exit 1"]).unwrap_err();
        assert!(matches!(&err, Error::Failed(m) if m == "sh: on-stdout"), "{err}");
    }

    #[test]
    fn stdin_reaches_the_tool() {
        assert_eq!(run_in("cat", &[], Some("hello")).unwrap(), "hello");
    }

    #[test]
    fn run_timeout_still_runs_a_quick_tool() {
        assert_eq!(run_timeout(5, "sh", &["-c", "printf ok"]).unwrap(), "ok");
    }
}
