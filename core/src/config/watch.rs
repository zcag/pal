//! Live reload. The directory is watched rather than the file: vim and most
//! editors save by writing a new file and renaming it over the old one, and
//! a watch on the old inode would go quiet after the first save.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use notify::{RecursiveMode, Watcher as _};

use super::{Config, ConfigFile, Error, Loaded};

/// Events within this window of each other collapse into one reload.
const DEBOUNCE: Duration = Duration::from_millis(150);

/// Keeps the watch alive; drop it to stop.
#[must_use = "dropping the watcher stops the watch"]
pub struct Watcher {
    _inner: notify::RecommendedWatcher,
}

impl ConfigFile {
    /// Call `on_change` with a fresh [`Loaded`] whenever the file's content
    /// changes on disk (a deleted file is a change to the defaults). Reloads
    /// are content-keyed: an event that leaves the bytes as they were (our
    /// own write echoing back a state already loaded, a touch, a no-op save)
    /// does not fire. A save that fails to parse, or a file that cannot be
    /// read, fires with the last good `config` and an error diagnostic, so
    /// settings never blank while the user is mid-edit.
    ///
    /// The watch follows a symlink to its target's directory once, at this
    /// call; re-pointing the link later is not seen.
    pub fn watch(&self, mut on_change: impl FnMut(Loaded) + Send + 'static) -> Result<Watcher, Error> {
        let target = self.target();
        let dir = target.parent().map_or_else(|| PathBuf::from("."), PathBuf::from);
        std::fs::create_dir_all(&dir).map_err(|source| Error::Io { path: dir.clone(), source })?;
        let name = target.file_name().map(std::ffi::OsStr::to_owned);
        let (tx, rx) = mpsc::channel();
        let mut inner = notify::recommended_watcher(move |ev: notify::Result<notify::Event>| {
            // An error here (the OS dropped the watch, an overflow) leaves
            // the file unwatched until the next start; there is no channel
            // to report it on.
            if let Ok(ev) = ev {
                if ev.paths.iter().any(|p| p.file_name() == name.as_deref()) {
                    let _ = tx.send(());
                }
            }
        })?;
        inner.watch(&dir, RecursiveMode::NonRecursive)?;

        let file = self.clone();
        // One read serves both the content key and the parse, so the two
        // cannot disagree when a second save lands between them.
        let read = std::fs::read_to_string(&target);
        let mut good: Config = file.loaded(read.as_deref()).config;
        let mut last_text = read.ok();
        std::thread::Builder::new()
            .name("pal-config-watch".into())
            .spawn(move || {
                while rx.recv().is_ok() {
                    while rx.recv_timeout(DEBOUNCE).is_ok() {}
                    let read = std::fs::read_to_string(&target);
                    if read.as_ref().ok() == last_text.as_ref() {
                        continue;
                    }
                    let mut loaded = file.loaded(read.as_deref());
                    last_text = read.ok();
                    if loaded.has_errors() {
                        loaded.config = good.clone();
                    } else {
                        good = loaded.config.clone();
                    }
                    on_change(loaded);
                }
            })
            .map_err(|e| Error::Watch(notify::Error::io(e)))?;
        Ok(Watcher { _inner: inner })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Level, Theme};
    use std::sync::mpsc::RecvTimeoutError;

    const WAIT: Duration = Duration::from_secs(5);

    fn setup() -> (tempfile::TempDir, ConfigFile, Watcher, mpsc::Receiver<Loaded>) {
        let dir = tempfile::tempdir().unwrap();
        let f = ConfigFile::new(dir.path().join("config.toml"));
        std::fs::write(f.path(), "[general]\ntheme = \"dark\"\n").unwrap();
        let (tx, rx) = mpsc::channel();
        let w = f.watch(move |l| tx.send(l).unwrap()).unwrap();
        (dir, f, w, rx)
    }

    #[test]
    fn reloads_on_hand_edit_and_on_own_write() {
        let (_d, f, _w, rx) = setup();
        // Editor-style save: new file, rename over.
        let tmp = f.path().with_extension("swp");
        std::fs::write(&tmp, "[general]\ntheme = \"light\"\n").unwrap();
        std::fs::rename(&tmp, f.path()).unwrap();
        let l = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(l.config.general.theme, Theme::Light);
        assert!(l.diagnostics.is_empty());

        f.set("general.hotkey", "alt+space").unwrap();
        let l = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(l.config.general.hotkey, "alt+space");
        assert_eq!(l.config.general.theme, Theme::Light, "own write reloads the whole file, not a cached struct");
        assert_eq!(rx.recv_timeout(DEBOUNCE * 4), Err(RecvTimeoutError::Timeout), "one reload per change");
    }

    #[test]
    fn broken_save_keeps_last_good() {
        let (_d, f, _w, rx) = setup();
        std::fs::write(f.path(), "[general]\ntheme = \"light\"\nhotkey = \n").unwrap();
        let l = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(l.diagnostics[0].level, Level::Error);
        assert_eq!(l.config.general.theme, Theme::Dark, "last good config, not defaults");

        std::fs::write(f.path(), "[general]\ntheme = \"light\"\n").unwrap();
        let l = rx.recv_timeout(WAIT).unwrap();
        assert!(l.diagnostics.is_empty());
        assert_eq!(l.config.general.theme, Theme::Light);
    }

    #[test]
    fn same_bytes_do_not_fire() {
        let (_d, f, _w, rx) = setup();
        std::fs::write(f.path(), "[general]\ntheme = \"dark\"\n").unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_millis(800)), Err(RecvTimeoutError::Timeout));
    }

    #[test]
    fn deleted_file_is_the_defaults_and_comes_back() {
        let (_d, f, _w, rx) = setup();
        std::fs::remove_file(f.path()).unwrap();
        let l = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(l.config, Config::default());
        assert!(l.diagnostics.is_empty(), "missing is not an error: {:?}", l.diagnostics);
        std::fs::write(f.path(), "[general]\ntheme = \"light\"\n").unwrap();
        assert_eq!(rx.recv_timeout(WAIT).unwrap().config.general.theme, Theme::Light);
    }

    #[test]
    fn a_missing_file_can_be_watched_into_existence() {
        let dir = tempfile::tempdir().unwrap();
        let f = ConfigFile::new(dir.path().join("sub").join("config.toml"));
        let (tx, rx) = mpsc::channel();
        let _w = f.watch(move |l| tx.send(l).unwrap()).unwrap();
        f.set("general.theme", "light").unwrap();
        assert_eq!(rx.recv_timeout(WAIT).unwrap().config.general.theme, Theme::Light);
    }

    #[test]
    fn dropping_the_watcher_stops_it() {
        let (_d, f, w, rx) = setup();
        drop(w);
        // notify's inotify backend stops asynchronously (`Drop` sends
        // Shutdown and wakes the loop, no join), so a write landing in the
        // same poll as the shutdown still gets through; FSEvents stops in
        // `Drop`. Failed 5 of 5 on marko without the pause.
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(f.path(), "[general]\ntheme = \"light\"\n").unwrap();
        // The thread ends with the watch, taking the callback (and its
        // sender) with it.
        assert_eq!(rx.recv_timeout(WAIT), Err(RecvTimeoutError::Disconnected));
    }

    #[test]
    fn watches_through_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real_dir = dir.path().join("dotfiles");
        std::fs::create_dir(&real_dir).unwrap();
        let real = real_dir.join("pal.toml");
        std::fs::write(&real, "").unwrap();
        let link = dir.path().join("config.toml");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let (tx, rx) = mpsc::channel();
        let _w = ConfigFile::new(&link).watch(move |l| tx.send(l).unwrap()).unwrap();
        std::fs::write(&real, "[general]\ntheme = \"light\"\n").unwrap();
        assert_eq!(rx.recv_timeout(WAIT).unwrap().config.general.theme, Theme::Light);
    }
}
