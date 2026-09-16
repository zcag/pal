//! Per-extension key-value storage: what `storage.get/set/remove/keys` in
//! `sdk/src/api.ts` reach over the bridge. One JSON object per extension
//! in `<data dir>/pal/storage/<extension>.json` (the top-level data dir, so
//! every config profile sees the same bankroll, like the clipboard history),
//! written whole and atomically on every change ([`crate::fs::write_atomic`]).
//!
//! Small by design: the file is capped at [`LIMIT`] bytes serialised, and a
//! `set` that would cross it is refused with nothing written, so an
//! extension that mistakes this for a cache finds out at once instead of
//! slowing every pick. Keys are non-empty and at most [`MAX_KEY`] bytes; the
//! extension name is validated like an install name (`[a-z0-9._-]`, no
//! leading dot), or an instance key (`gmail@work`, one `@`), since it
//! becomes a file name.
//!
//! Files are read on first touch and kept in memory after; the bridge runs
//! handlers on blocking threads, so the map is behind one mutex.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use crate::fs::write_atomic;

/// Bytes per extension file, serialised. Mirrored as `storage.LIMIT` in api.ts.
pub const LIMIT: usize = 256 * 1024;
/// Bytes per key.
pub const MAX_KEY: usize = 128;
/// The directory under the data dir.
pub const DIR_NAME: &str = "storage";

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    /// The extension name would not make a safe file name.
    BadName(String),
    /// Empty, or over [`MAX_KEY`].
    BadKey(String),
    /// The write would put the file over [`LIMIT`]; nothing was written.
    Full { bytes: usize, limit: usize },
    Io(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::BadName(n) => write!(f, "storage: bad extension name {n:?}"),
            Error::BadKey(k) => write!(f, "storage: bad key {k:?} (1..={MAX_KEY} bytes)"),
            Error::Full { bytes, limit } => write!(f, "storage: full ({bytes} bytes would exceed the {limit} byte limit)"),
            Error::Io(e) => write!(f, "storage: {e}"),
        }
    }
}

impl std::error::Error for Error {}

/// One extension's keys, in key order so the file is stable to diff.
type Map = BTreeMap<String, Value>;

pub struct Storage {
    dir: PathBuf,
    files: Mutex<HashMap<String, Map>>,
}

/// An install name, or an instance key (`gmail@work`: one `@`, a name on
/// each side, `config::instance`), since an instance has its own file.
fn valid_name(name: &str) -> bool {
    let (name, suffix) = crate::config::instance::split(name);
    crate::config::instance::valid_name(name) && suffix.is_none_or(crate::config::instance::valid_suffix)
}

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY
}

impl Storage {
    /// Nothing is read or created until an extension touches its file.
    pub fn open_in(dir: impl Into<PathBuf>) -> Storage {
        Storage { dir: dir.into(), files: Mutex::new(HashMap::new()) }
    }

    /// `<data dir>/pal/storage`.
    pub fn open() -> Storage {
        Storage::open_in(crate::fs::data_dir().join(DIR_NAME))
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, extension: &str) -> PathBuf {
        self.dir.join(format!("{extension}.json"))
    }

    /// The file as it is on disk; a missing one is empty, a broken one is
    /// set aside as `.bak` and starts empty (a bankroll is not worth
    /// refusing every write for), and the notice is on stderr.
    fn load(&self, extension: &str) -> Map {
        let path = self.path(extension);
        let Ok(bytes) = std::fs::read(&path) else { return Map::new() };
        match serde_json::from_slice::<Map>(&bytes) {
            Ok(m) => m,
            Err(e) => {
                let bak = path.with_extension("json.bak");
                let _ = std::fs::rename(&path, &bak);
                eprintln!("storage\t{extension}\tunreadable ({e}); moved to {}", bak.display());
                Map::new()
            }
        }
    }

    /// Runs `f` on the extension's map, loading it first if this is the
    /// first touch. `f` returns whether it changed anything; a change is
    /// serialised, checked against [`LIMIT`] and written; over the limit the
    /// change is rolled back and nothing is written.
    fn with<T>(&self, extension: &str, f: impl FnOnce(&mut Map) -> (T, bool)) -> Result<T, Error> {
        if !valid_name(extension) {
            return Err(Error::BadName(extension.to_string()));
        }
        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        if !files.contains_key(extension) {
            let m = self.load(extension);
            files.insert(extension.to_string(), m);
        }
        let map = files.get_mut(extension).expect("inserted above");
        let before = map.clone();
        let (out, changed) = f(map);
        if !changed {
            return Ok(out);
        }
        let bytes = serde_json::to_vec_pretty(&*map).map_err(|e| Error::Io(e.to_string()))?;
        if bytes.len() > LIMIT {
            *map = before;
            return Err(Error::Full { bytes: bytes.len(), limit: LIMIT });
        }
        if let Err(e) = write_atomic(&self.path(extension), &bytes) {
            *map = before;
            return Err(Error::Io(e.to_string()));
        }
        Ok(out)
    }

    /// `Value::Null` for a key that is not set.
    pub fn get(&self, extension: &str, key: &str) -> Result<Value, Error> {
        if !valid_key(key) {
            return Err(Error::BadKey(key.to_string()));
        }
        self.with(extension, |m| (m.get(key).cloned().unwrap_or(Value::Null), false))
    }

    /// Setting a key to `Value::Null` removes it: the file holds what is set.
    pub fn set(&self, extension: &str, key: &str, value: Value) -> Result<(), Error> {
        if !valid_key(key) {
            return Err(Error::BadKey(key.to_string()));
        }
        if value.is_null() {
            return self.remove(extension, key);
        }
        self.with(extension, |m| {
            let changed = m.get(key) != Some(&value);
            if changed {
                m.insert(key.to_string(), value);
            }
            ((), changed)
        })
    }

    pub fn remove(&self, extension: &str, key: &str) -> Result<(), Error> {
        if !valid_key(key) {
            return Err(Error::BadKey(key.to_string()));
        }
        self.with(extension, |m| ((), m.remove(key).is_some()))
    }

    /// Every key set, sorted.
    pub fn keys(&self, extension: &str) -> Result<Vec<String>, Error> {
        self.with(extension, |m| (m.keys().cloned().collect(), false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("pal-storage-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn rand_suffix() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as u64;
        t ^ N.fetch_add(1, Ordering::Relaxed)
    }

    #[test]
    fn get_set_remove_keys_roundtrip_through_the_file() {
        let dir = temp();
        let s = Storage::open_in(&dir);
        assert_eq!(s.get("bj", "bankroll").unwrap(), Value::Null, "unset is null");
        s.set("bj", "bankroll", json!(1000)).unwrap();
        s.set("bj", "stats", json!({ "hands": 3, "wins": 1 })).unwrap();
        assert_eq!(s.get("bj", "bankroll").unwrap(), json!(1000));
        assert_eq!(s.keys("bj").unwrap(), ["bankroll", "stats"]);
        // A fresh Storage over the same dir reads what was written.
        let again = Storage::open_in(&dir);
        assert_eq!(again.get("bj", "stats").unwrap(), json!({ "hands": 3, "wins": 1 }));
        again.remove("bj", "bankroll").unwrap();
        assert_eq!(again.keys("bj").unwrap(), ["stats"]);
        let on_disk: Map = serde_json::from_slice(&std::fs::read(dir.join("bj.json")).unwrap()).unwrap();
        assert_eq!(on_disk.keys().collect::<Vec<_>>(), ["stats"]);
        assert!(std::fs::read_dir(&dir).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains(".tmp")), "no temp file left");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extensions_are_separate_files() {
        let dir = temp();
        let s = Storage::open_in(&dir);
        s.set("a", "k", json!(1)).unwrap();
        s.set("b", "k", json!(2)).unwrap();
        assert_eq!(s.get("a", "k").unwrap(), json!(1));
        assert_eq!(s.get("b", "k").unwrap(), json!(2));
        assert!(dir.join("a.json").is_file() && dir.join("b.json").is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn storage_accepts_one_at_sign() {
        let dir = temp();
        let s = Storage::open_in(&dir);
        s.set("gmail", "k", json!("personal")).unwrap();
        s.set("gmail@work", "k", json!("work")).unwrap();
        assert_eq!(s.get("gmail", "k").unwrap(), json!("personal"), "an instance's file is its own");
        assert_eq!(s.get("gmail@work", "k").unwrap(), json!("work"));
        assert!(dir.join("gmail.json").is_file() && dir.join("gmail@work.json").is_file());
        for bad in ["@work", "gmail@", "gmail@w@x", "gmail@Work", "gmail@default", "../x@y"] {
            assert_eq!(s.get(bad, "k"), Err(Error::BadName(bad.into())), "{bad}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn null_unsets_and_an_unchanged_set_does_not_write() {
        let dir = temp();
        let s = Storage::open_in(&dir);
        s.set("a", "k", json!("v")).unwrap();
        let mtime = std::fs::metadata(dir.join("a.json")).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        s.set("a", "k", json!("v")).unwrap();
        assert_eq!(std::fs::metadata(dir.join("a.json")).unwrap().modified().unwrap(), mtime, "same value, no write");
        s.set("a", "k", Value::Null).unwrap();
        assert_eq!(s.keys("a").unwrap(), Vec::<String>::new());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn over_the_limit_is_refused_and_rolled_back() {
        let dir = temp();
        let s = Storage::open_in(&dir);
        s.set("a", "small", json!(1)).unwrap();
        let big = "x".repeat(LIMIT);
        let e = s.set("a", "big", json!(big)).unwrap_err();
        assert!(matches!(e, Error::Full { limit: LIMIT, .. }), "{e}");
        assert_eq!(s.keys("a").unwrap(), ["small"], "the map is as before");
        let on_disk: Map = serde_json::from_slice(&std::fs::read(dir.join("a.json")).unwrap()).unwrap();
        assert_eq!(on_disk.len(), 1, "the file is as before");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_and_keys_are_validated() {
        let dir = temp();
        let s = Storage::open_in(&dir);
        for bad in ["", "..", "../x", "A", "a/b", ".hidden"] {
            assert!(matches!(s.get(bad, "k"), Err(Error::BadName(_))), "{bad:?}");
        }
        assert!(matches!(s.get("ok-name_1.2", ""), Err(Error::BadKey(_))));
        assert!(matches!(s.get("ok", &"k".repeat(MAX_KEY + 1)), Err(Error::BadKey(_))));
        assert!(s.get("ok", &"k".repeat(MAX_KEY)).is_ok());
        assert!(!dir.join("...json").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_broken_file_is_set_aside_and_starts_empty() {
        let dir = temp();
        std::fs::write(dir.join("a.json"), b"{ not json").unwrap();
        let s = Storage::open_in(&dir);
        assert_eq!(s.keys("a").unwrap(), Vec::<String>::new());
        assert!(dir.join("a.json.bak").is_file());
        s.set("a", "k", json!(1)).unwrap();
        assert_eq!(Storage::open_in(&dir).get("a", "k").unwrap(), json!(1));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
