//! Where pal's files live, and the one way they are written.
//!
//! Every module that owns a file resolves its directory here, so `$XDG_*`
//! overrides work the same for config, data and cache on both platforms, and
//! writes it through [`write_atomic`], so nothing that reads a file of ours
//! (an editor, the config watcher, the `icon://` handler) ever sees a partial.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// `$XDG_CONFIG_HOME/pal`, else `~/.config/pal` on every platform: the config
/// is a dotfile people version-control, and `~/Library/Application Support`
/// is not where those live.
pub fn config_dir() -> PathBuf {
    base("XDG_CONFIG_HOME", dirs::home_dir().map(|h| h.join(".config")))
}

/// `$XDG_DATA_HOME/pal`, else the platform's data dir: `~/.local/share/pal`
/// on Linux, `~/Library/Application Support/pal` on macOS.
pub fn data_dir() -> PathBuf {
    base("XDG_DATA_HOME", dirs::data_dir())
}

/// `$XDG_CACHE_HOME/pal`, else the platform's cache dir: `~/.cache/pal` on
/// Linux, `~/Library/Caches/pal` on macOS.
pub fn cache_dir() -> PathBuf {
    base("XDG_CACHE_HOME", dirs::cache_dir())
}

fn base(xdg: &str, platform: Option<PathBuf>) -> PathBuf {
    std::env::var_os(xdg)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .or(platform)
        // No home at all: somewhere writable beats the cwd, which is `/` for
        // an app launched from the desktop.
        .unwrap_or_else(std::env::temp_dir)
        .join("pal")
}

/// Write `bytes` to `target` via a temp file in the same directory and a
/// rename, creating the directory. A reader sees the old file or the new one,
/// never a partial. The temp name carries the pid and a counter, so two
/// threads writing the same target do not share it.
pub fn write_atomic(target: &Path, bytes: impl AsRef<[u8]>) -> std::io::Result<()> {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut tmp = target.as_os_str().to_owned();
    tmp.push(format!(".tmp{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, target).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_creates_dir_and_leaves_no_temp() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a").join("b.json");
        write_atomic(&target, "one").unwrap();
        write_atomic(&target, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "two");
        let names: Vec<_> = std::fs::read_dir(target.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, ["b.json"], "temp file renamed away");
    }

    #[test]
    fn write_atomic_keeps_the_symlink_target() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.toml");
        std::fs::write(&real, "x").unwrap();
        let link = dir.path().join("link.toml");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        // A rename over the link replaces the link itself; callers that
        // care resolve it first (`ConfigFile::target`). This pins that.
        write_atomic(&link, "y").unwrap();
        assert!(!std::fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "x");
    }

    #[test]
    fn write_atomic_failure_removes_temp() {
        let dir = tempfile::tempdir().unwrap();
        // Renaming a file over a non-empty directory fails.
        let target = dir.path().join("dir");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("child"), "").unwrap();
        assert!(write_atomic(&target, "x").is_err());
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, ["dir"]);
    }
}
