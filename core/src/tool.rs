//! Shelling out to the tool a device capability wraps (`wpctl`, `pactl`,
//! `bluetoothctl`, `nmcli`, `networksetup`, `playerctl`, `osascript`):
//! one place for the three outcomes every caller distinguishes, so
//! `audio`, `bluetooth`, `wifi` and `media` share the error type and the
//! bridge shows the tool's own complaint. [`run_timeout`] is for tools
//! that can block for good (`bluetoothctl` with a wedged adapter,
//! `osascript` asking an app that is not answering).

use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

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
    run_with(bin, args, stdin, None)
}

/// [`run_in`] with an optional deadline: a tool still running then is
/// killed and reported as [`Error::Failed`] ("did not answer within N s").
/// The pipes are drained on threads, so a tool that fills its stdout
/// before the deadline never blocks the wait.
fn run_with(bin: &str, args: &[&str], stdin: Option<&str>, deadline: Option<Duration>) -> Result<String> {
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
    let (out, err) = (drain(child.stdout.take()), drain(child.stderr.take()));
    // Past the deadline the reader threads are left to end with the pipes:
    // a grandchild the kill did not reach may hold them open for a while.
    let status = match deadline {
        Some(d) => wait_until(&mut child, Instant::now() + d)?.ok_or_else(|| Error::Failed(format!("{bin} did not answer within {} s", d.as_secs())))?,
        None => child.wait()?,
    };
    let (stdout, stderr) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    if !status.success() {
        let err = String::from_utf8_lossy(&stderr).trim().to_string();
        let err = if err.is_empty() { String::from_utf8_lossy(&stdout).trim().to_string() } else { err };
        return Err(Error::Failed(format!("{bin}: {}", if err.is_empty() { status.to_string() } else { err })));
    }
    Ok(String::from_utf8_lossy(&stdout).into_owned())
}

/// Reads a pipe to its end on a thread; the bytes, or none without a pipe.
fn drain(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut v = Vec::new();
        if let Some(mut p) = pipe {
            let _ = p.read_to_end(&mut v);
        }
        v
    })
}

/// Polls the child until it exits or `deadline` passes; past it the child
/// is killed and reaped and `None` comes back.
fn wait_until(child: &mut Child, deadline: Instant) -> std::io::Result<Option<std::process::ExitStatus>> {
    let mut nap = Duration::from_millis(2);
    loop {
        if let Some(s) = child.try_wait()? {
            return Ok(Some(s));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }
        std::thread::sleep(nap);
        nap = (nap * 2).min(Duration::from_millis(50));
    }
}

/// [`run`] killed after `secs`, for a tool that may never answer
/// (`bluetoothctl` with a wedged adapter, `osascript` waiting on an app
/// that is not taking Apple events: two minutes each, and the children
/// piled up behind a locked screen).
pub fn run_timeout(secs: u32, bin: &str, args: &[&str]) -> Result<String> {
    run_with(bin, args, None, Some(Duration::from_secs(u64::from(secs))))
}

/// How long an AppleScript gets: Spotify and Music answer in tens of ms
/// when they answer at all; behind a locked screen they do not, and
/// `osascript` would otherwise sit on its two-minute Apple event timeout.
pub const OSASCRIPT_SECS: u32 = 5;

/// An AppleScript, run whole through `osascript`'s stdin within
/// [`OSASCRIPT_SECS`]; stdout trimmed.
#[cfg(target_os = "macos")]
pub fn osascript(script: &str) -> Result<String> {
    run_with("osascript", &[], Some(script), Some(Duration::from_secs(u64::from(OSASCRIPT_SECS)))).map(|s| s.trim_end().to_string())
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

    #[test]
    fn run_timeout_kills_a_tool_that_never_answers() {
        let t0 = Instant::now();
        let err = run_timeout(1, "sh", &["-c", "sleep 30"]).unwrap_err();
        assert!(matches!(&err, Error::Failed(m) if m == "sh did not answer within 1 s"), "{err}");
        assert!(t0.elapsed() < Duration::from_secs(5), "killed at the deadline, not waited out: {:?}", t0.elapsed());
        // A tool that fills its stdout before exiting is drained, not deadlocked.
        let big = run_timeout(5, "sh", &["-c", "head -c 200000 /dev/zero | tr '\\0' x"]).unwrap();
        assert_eq!(big.len(), 200_000);
    }
}
