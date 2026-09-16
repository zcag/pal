//! The persisted index: every palette's last listing on disk, so the root
//! search answers from the previous run before the host is even spawned.
//!
//! One file per palette, `<data dir>/pal/<profile>/index/<extension>/<palette>.json`
//! (`~/Library/Application Support/pal/<profile>/index/` on macOS,
//! `~/.local/share/pal/<profile>/index/` on Linux; the profile is the
//! config file's, `ConfigFile::profile`): the wire items as the extension
//! sent them (not the index's matcher fields), when they were listed, and the
//! palette's meta plus the extension title, so the palette row and the
//! section label exist before the host says anything. Written through
//! [`pal_core::fs::write_atomic`], debounced per source by [`Saver`]. A
//! palette above [`MAX_ITEMS`] is not persisted (its file, if any, goes).
//!
//! What goes in and out is the caller's business (`crate::index`): this
//! module only knows files.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pal_core::index::{Item, Source};
use serde::{Deserialize, Serialize};

use crate::registry::PaletteMeta;
use crate::lock;

/// Listings larger than this are not written: the file would be tens of
/// MB and its read would cost more at startup than the list it replaces.
pub const MAX_ITEMS: usize = 50_000;
/// Quiet time after the last listing of a source before its file is written.
pub const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
const FILE_VERSION: u32 = 1;

/// One palette's file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub version: u32,
    /// Unix seconds of the listing.
    pub listed_at: u64,
    /// The extension's title (the palette row's subtitle).
    pub ext_title: String,
    pub meta: PaletteMeta,
    pub items: Vec<Item>,
}

impl Entry {
    pub fn new(listed_at: u64, ext_title: String, meta: PaletteMeta, items: Vec<Item>) -> Self {
        Self { version: FILE_VERSION, listed_at, ext_title, meta, items }
    }
}

/// The directory's name under the profile's data dir.
pub const DIR_NAME: &str = "index";

/// `<dir>/<extension>/<palette>.json`; `None` for a name that is no file
/// name (a separator in it, or hidden).
pub fn path(dir: &Path, source: &Source) -> Option<PathBuf> {
    let ok = |s: &str| !s.is_empty() && !s.starts_with('.') && !s.contains(['/', '\\']);
    (ok(&source.extension) && ok(&source.palette)).then(|| dir.join(&source.extension).join(format!("{}.json", source.palette)))
}

/// Write one palette's file, or remove it when the listing is above
/// [`MAX_ITEMS`]. Returns whether a file was written.
pub fn write(dir: &Path, source: &Source, entry: &Entry) -> std::io::Result<bool> {
    let Some(path) = path(dir, source) else { return Ok(false) };
    if entry.items.len() > MAX_ITEMS {
        remove(dir, source);
        return Ok(false);
    }
    pal_core::fs::write_atomic(&path, serde_json::to_vec(entry).expect("plain data"))?;
    Ok(true)
}

pub fn remove(dir: &Path, source: &Source) {
    if let Some(path) = path(dir, source) {
        let _ = std::fs::remove_file(path);
    }
}

/// Every palette file under `dir`, in no particular order. A file that does
/// not parse, or was written by another file version, is removed and logged:
/// a fresh listing replaces it the moment the host is up.
pub fn read_all(dir: &Path) -> Vec<(Source, Entry)> {
    let mut out = Vec::new();
    let Ok(exts) = std::fs::read_dir(dir) else { return out };
    for ext in exts.flatten().filter(|e| e.path().is_dir()) {
        let Ok(files) = std::fs::read_dir(ext.path()) else { continue };
        for f in files.flatten() {
            let path = f.path();
            let Some(palette) = path.file_name().and_then(|n| n.to_str()).and_then(|n| n.strip_suffix(".json")) else { continue };
            let source = Source::new(ext.file_name().to_string_lossy(), palette);
            let bytes = match std::fs::read(&path) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("cache\tunreadable\t{}: {e}", path.display());
                    continue;
                }
            };
            match serde_json::from_slice::<Entry>(&bytes) {
                Ok(e) if e.version == FILE_VERSION => out.push((source, e)),
                Ok(e) => {
                    eprintln!("cache\tdropped\t{}: file version {} (this pal writes {FILE_VERSION})", path.display(), e.version);
                    let _ = std::fs::remove_file(&path);
                }
                Err(e) => {
                    eprintln!("cache\tdropped\t{}: {e}", path.display());
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
    out
}

/// Remove the directories of extensions not in `keep`; returns their names.
pub fn prune(dir: &Path, keep: &[String]) -> Vec<String> {
    let mut gone = Vec::new();
    let Ok(exts) = std::fs::read_dir(dir) else { return gone };
    for ext in exts.flatten().filter(|e| e.path().is_dir()) {
        let name = ext.file_name().to_string_lossy().into_owned();
        if !keep.contains(&name) && std::fs::remove_dir_all(ext.path()).is_ok() {
            gone.push(name);
        }
    }
    gone.sort();
    gone
}

/// Per-source debounced writes: a burst of listings of one palette (a live
/// one on every show, a filter swap) lands as one file write, off the
/// caller's thread. Managed by the app; `flush` on exit.
pub struct Saver {
    dir: PathBuf,
    /// The latest entry per source and its generation; a write only lands
    /// when the generation it was queued for is still the latest.
    pending: Mutex<HashMap<Source, (u64, Entry)>>,
}

impl Saver {
    pub fn new(dir: PathBuf) -> Arc<Self> {
        Arc::new(Self { dir, pending: Mutex::new(HashMap::new()) })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn save(self: &Arc<Self>, source: Source, entry: Entry) {
        let generation = {
            let mut p = lock(&self.pending);
            let g = p.get(&source).map_or(1, |(g, _)| g + 1);
            p.insert(source.clone(), (g, entry));
            g
        };
        let saver = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SAVE_DEBOUNCE).await;
            let take = {
                let mut p = lock(&saver.pending);
                match p.get(&source) {
                    Some((g, _)) if *g == generation => p.remove(&source).map(|(_, e)| e),
                    _ => None,
                }
            };
            if let Some(entry) = take {
                let _ = tauri::async_runtime::spawn_blocking(move || saver.write(&source, &entry)).await;
            }
        });
    }

    fn write(&self, source: &Source, entry: &Entry) {
        if let Err(e) = write(&self.dir, source, entry) {
            eprintln!("cache\t{}/{}\twrite failed\t{e}", source.extension, source.palette);
        }
    }

    /// Write everything still pending, now (exit). A write already handed
    /// to a blocking thread is not waited for: it is atomic, so at worst
    /// the previous file stays.
    pub fn flush(&self) {
        let pending: Vec<_> = lock(&self.pending).drain().collect();
        for (source, (_, entry)) in pending {
            self.write(&source, &entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> Item {
        serde_json::from_value(serde_json::json!({ "id": id, "name": id.to_uppercase(), "exec": format!("open {id}") })).unwrap()
    }

    fn entry(n: usize) -> Entry {
        let meta = PaletteMeta { name: "p".into(), title: "P".into(), ttl: Some(60.0), ..Default::default() };
        Entry::new(1_700_000_000, "Ext".into(), meta, (0..n).map(|i| item(&format!("i{i}"))).collect())
    }

    #[test]
    fn round_trip_and_prune() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("index");
        let a = Source::new("alpha", "p");
        let b = Source::new("beta", "q");
        assert!(write(&dir, &a, &entry(3)).unwrap());
        assert!(write(&dir, &b, &entry(1)).unwrap());
        assert_eq!(path(&dir, &a).unwrap(), dir.join("alpha").join("p.json"));
        assert!(path(&dir, &Source::new("../x", "p")).is_none());
        assert!(path(&dir, &Source::new("x", ".p")).is_none());

        let mut all = read_all(&dir);
        all.sort_by(|x, y| x.0.extension.cmp(&y.0.extension));
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].0, a);
        assert_eq!(all[0].1, entry(3), "items with their extra fields, meta and title survive");
        assert_eq!(all[0].1.items[2].extra["exec"], "open i2");
        assert_eq!(all[0].1.meta.ttl, Some(60.0));

        // Oversize: not written, and an older file goes.
        let mut big = entry(0);
        big.items = (0..=MAX_ITEMS).map(|i| item(&i.to_string())).collect();
        assert!(!write(&dir, &a, &big).unwrap());
        assert!(!dir.join("alpha").join("p.json").exists());

        // Junk and other versions are dropped on read.
        std::fs::write(dir.join("beta").join("junk.json"), "{nope").unwrap();
        let mut old = entry(1);
        old.version = 99;
        std::fs::write(dir.join("beta").join("old.json"), serde_json::to_vec(&old).unwrap()).unwrap();
        let all = read_all(&dir);
        assert_eq!(all.iter().map(|(s, _)| s).collect::<Vec<_>>(), [&b]);
        assert!(!dir.join("beta").join("junk.json").exists());
        assert!(!dir.join("beta").join("old.json").exists());

        // Prune keeps the named extensions' directories only.
        write(&dir, &Source::new("gamma", "r"), &entry(1)).unwrap();
        assert_eq!(prune(&dir, &["beta".into()]), ["alpha", "gamma"]);
        assert!(dir.join("beta").join("q.json").exists());
        assert!(!dir.join("gamma").exists());
        remove(&dir, &b);
        assert!(read_all(&dir).is_empty());
        assert!(read_all(&tmp.path().join("missing")).is_empty());
    }
}
