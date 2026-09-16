//! The PATH a launcher inherits. Started from the Dock, a LaunchAgent or a
//! desktop session, pal gets the system's `/usr/bin:/bin:/usr/sbin:/sbin`,
//! not the user's: `gh`, `op`, `docker`, `timer`, `sketchybar` live under
//! Homebrew, `~/.local/bin`, `~/.cargo/bin`, `~/.bun/bin`. Every CLI-backed
//! extension and capability then fails from the Dock and works from a
//! terminal, which reads as "GitHub does not work although I ran `gh auth
//! login`". [`adopt`] runs once at start: the login shell's PATH (the way
//! Raycast reads it) merged with the inherited one and the usual tool
//! directories, set on the process so the host, the sidecar and every
//! `Command` inherit it.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Directories added after the shell's when they exist and are not there yet.
const USUAL: &[&str] = &["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin", "~/.local/bin", "~/.cargo/bin", "~/.bun/bin", "~/go/bin", "/snap/bin", "/var/lib/flatpak/exports/bin"];

const MARK: &str = "__PAL_PATH__";

/// The user's login shell's PATH, or None when the shell did not answer in
/// time (2 s), printed nothing usable, or `$SHELL` is unset. A login and
/// interactive shell, since PATH is as often set in `.zshrc` as in
/// `.zprofile`; the marker keeps prompt noise out of the answer.
pub fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    let script = format!("printf '\\n{MARK}%s{MARK}\\n' \"$PATH\"");
    let mut child = Command::new(&shell).args(["-l", "-i", "-c", &script]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = std::io::Read::read_to_string(&mut out, &mut buf);
        buf
    });
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let buf = reader.join().ok()?;
    let start = buf.rfind(MARK)?;
    let head = &buf[..start];
    let open = head.rfind(MARK)?;
    let path = head[open + MARK.len()..].trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// `login` (in order) then the entries of `current` not in it, then the
/// usual tool directories that exist; no duplicates.
pub fn merge(login: Option<&str>, current: &str, home: Option<&PathBuf>) -> String {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !seen.contains(&p) {
            seen.push(p);
        }
    };
    for p in login.into_iter().chain(std::iter::once(current)).flat_map(std::env::split_paths) {
        push(p);
    }
    for d in USUAL {
        let p = match d.strip_prefix("~/") {
            Some(rest) => match home {
                Some(h) => h.join(rest),
                None => continue,
            },
            None => PathBuf::from(d),
        };
        if p.is_dir() {
            push(p);
        }
    }
    std::env::join_paths(seen).map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|_| current.to_string())
}

/// Sets the process PATH to the merged one and returns it, with whether the
/// shell answered. Skipped when the inherited PATH already reaches beyond the
/// system directories (started from a terminal): nothing to gain for a
/// shell spawn.
pub fn adopt() -> (String, bool) {
    let current = std::env::var("PATH").unwrap_or_default();
    let system_only = std::env::split_paths(&current).all(|p| p.starts_with("/usr") || p.starts_with("/bin") || p.starts_with("/sbin"));
    let login = if system_only { login_path() } else { None };
    let merged = merge(login.as_deref(), &current, std::env::home_dir().as_ref());
    // Safety: called once at start, before any thread is spawned.
    unsafe { std::env::set_var("PATH", &merged) };
    (merged, login.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_order_drops_duplicates_and_adds_existing_usual_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().to_path_buf();
        std::fs::create_dir_all(home.join(".local/bin")).unwrap();
        let m = merge(Some("/a:/b"), "/usr/bin:/b:/c", Some(&home));
        let parts: Vec<PathBuf> = std::env::split_paths(&m).collect();
        assert_eq!(&parts[..4], &[PathBuf::from("/a"), PathBuf::from("/b"), PathBuf::from("/usr/bin"), PathBuf::from("/c")]);
        assert!(parts.contains(&home.join(".local/bin")));
        assert!(!parts.contains(&home.join(".cargo/bin")), "a usual dir that does not exist is not added");
        assert_eq!(parts.iter().filter(|p| p.as_os_str() == "/b").count(), 1);
    }

    #[test]
    fn login_path_reads_the_shell_when_there_is_one() {
        if std::env::var("SHELL").is_err() {
            return;
        }
        // The answer is whatever the shell says; the contract is a non-empty PATH with no marker noise.
        if let Some(p) = login_path() {
            assert!(!p.contains(MARK));
            assert!(p.contains('/'));
        }
    }
}
