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

/// `p` with a leading `~` (alone, or before a `/`) replaced by the home
/// directory, the one spelling a config value may use; anything else is
/// returned as it is.
pub fn expand_home(p: &str) -> PathBuf {
    match p.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => match dirs::home_dir() {
            Some(home) => home.join(rest.trim_start_matches('/')),
            None => PathBuf::from(p),
        },
        _ => PathBuf::from(p),
    }
}

/// Whether `bin` is on `$PATH`: the gate for every capability that shells
/// out to a tool the user may not have.
pub(crate) fn on_path(bin: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join(bin).is_file()))
}

/// `applications/` under every XDG data dir, in precedence order (the
/// spec: the first dir that has a desktop id wins), then the flatpak
/// exports. Where a `.desktop` file, a `mimeinfo.cache` or a
/// `mimeapps.list` is looked for on Linux.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn desktop_dirs() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    let data_home = std::env::var_os("XDG_DATA_HOME").filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".local/share"));
    let sys = std::env::var_os("XDG_DATA_DIRS").filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    let mut dirs = vec![data_home];
    dirs.extend(std::env::split_paths(&sys));
    dirs.push("/var/lib/flatpak/exports/share".into());
    dirs.push(home.join(".local/share/flatpak/exports/share"));
    dirs.into_iter().map(|d| d.join("applications")).collect()
}

/// The `[Desktop Entry]` group of a `.desktop` file as key/value pairs,
/// values trimmed. Other groups (`[Desktop Action new]`) are skipped;
/// localised keys (`Name[tr]`) come through under their full key.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn desktop_entry(text: &str) -> std::collections::HashMap<&str, &str> {
    let mut out = std::collections::HashMap::new();
    let mut in_entry = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
        } else if in_entry && !line.starts_with('#') {
            if let Some((k, v)) = line.split_once('=') {
                out.entry(k.trim()).or_insert(v.trim());
            }
        }
    }
    out
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
    fn expand_home_takes_a_leading_tilde_only() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_home("~"), home);
        assert_eq!(expand_home("~/x/y"), home.join("x/y"));
        assert_eq!(expand_home("~x/y"), PathBuf::from("~x/y"), "another user's home is not ours to expand");
        assert_eq!(expand_home("/a/~/b"), PathBuf::from("/a/~/b"));
        assert_eq!(expand_home(""), PathBuf::from(""));
    }

    #[test]
    fn desktop_entry_reads_the_entry_group_only() {
        let text = "[Desktop Action new]\nIcon=wrong\n[Desktop Entry]\n# comment\nName=Kitty\nName[tr]=Kedi\nIcon=kitty \nExec=kitty %U\nIcon=second\n";
        let e = desktop_entry(text);
        assert_eq!(e.get("Icon"), Some(&"kitty"), "the first value of a repeated key, trimmed");
        assert_eq!(e.get("Name"), Some(&"Kitty"));
        assert_eq!(e.get("Name[tr]"), Some(&"Kedi"));
        assert_eq!(e.get("Exec"), Some(&"kitty %U"));
        assert!(!desktop_entry("[Desktop Entry]\nName=x\n").contains_key("Icon"));
    }

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
