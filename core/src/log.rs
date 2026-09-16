//! Where stderr goes when nobody is watching it. Every line pal and its host
//! print is tab-separated stderr; from a terminal that is the terminal, from
//! the Dock or a LaunchAgent it was `/dev/null`, so a "GitHub does not work"
//! report came with nothing to read. [`capture`] points fd 2 at a log file
//! when stderr is not a terminal; the sidecar inherits the fd, so the host's
//! lines land in the same file in order. One file, rotated to `.1` past
//! 5 MB at start.

use std::fs::{File, OpenOptions};
use std::path::PathBuf;

const MAX: u64 = 5 * 1024 * 1024;

/// `~/Library/Logs/pal/pal.log` on macOS, `$XDG_STATE_HOME/pal/pal.log`
/// (else `~/.local/state/pal/pal.log`) elsewhere.
pub fn path() -> PathBuf {
    // A scratch instance sets XDG_DATA_HOME for its own profile; its log
    // goes there too, so the daily log is the daily app's alone.
    if let Some(d) = std::env::var_os("XDG_DATA_HOME").filter(|p| !p.is_empty()) {
        return PathBuf::from(d).join("pal/pal.log");
    }
    if cfg!(target_os = "macos") {
        if let Some(h) = dirs::home_dir() {
            return h.join("Library/Logs/pal/pal.log");
        }
    }
    let state = std::env::var_os("XDG_STATE_HOME").filter(|p| !p.is_empty()).map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".local/state")));
    state.unwrap_or_else(std::env::temp_dir).join("pal/pal.log")
}

/// Redirects stderr to the log file unless it is a terminal. Returns the
/// path when it did. Errors (a read-only home, say) leave stderr as it was.
pub fn capture() -> Option<PathBuf> {
    // Safety: a query on a valid fd.
    if unsafe { libc::isatty(2) } == 1 {
        return None;
    }
    let path = path();
    std::fs::create_dir_all(path.parent()?).ok()?;
    if std::fs::metadata(&path).map(|m| m.len() > MAX).unwrap_or(false) {
        let _ = std::fs::rename(&path, path.with_extension("log.1"));
    }
    let file: File = OpenOptions::new().create(true).append(true).open(&path).ok()?;
    use std::os::unix::io::AsRawFd;
    // Safety: dup2 onto fd 2 with a fd this process owns; the File is
    // dropped after, the duplicate stays open for the process's life.
    if unsafe { libc::dup2(file.as_raw_fd(), 2) } == -1 {
        return None;
    }
    Some(path)
}
