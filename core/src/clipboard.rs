//! Clipboard history: a watcher that records what the user copies and a
//! store the clipboard palette lists, searches, and pastes from.
//!
//! [`Clipboard::open`] owns `$XDG_DATA_HOME/pal/clipboard.db` (`dirs::data_dir()`
//! otherwise, so `~/Library/Application Support/pal/` on macOS); images live
//! as PNG files in `clipboard/` beside it, the database keeps their name.
//! [`Clipboard::start_watching`] runs a background thread until the returned
//! [`WatchHandle`] is dropped, calling back with every entry it records.
//!
//! # Rules
//!
//! - **Dedupe by content.** An entry's `hash` is unique; copying something
//!   already in history bumps it to the top (`at = now`) instead of inserting.
//!   A `copy` back out of history does the same, so used entries float up.
//! - **Retention** runs after every insert: unpinned entries older than
//!   [`Retention::max_age`] go, then the unpinned tail past
//!   [`Retention::max_entries`]. Pinned entries never expire.
//! - **Size cap.** Anything over [`Retention::max_bytes`] is not recorded.
//! - **Privacy.** Items a password manager marks `org.nspasteboard.ConcealedType`
//!   or `TransientType` are skipped (macOS convention, <http://nspasteboard.org>);
//!   so is anything copied while an app in the exclude list is frontmost.
//! - **Priority** when a copy carries several representations: files, then
//!   text, then image. Spreadsheet cells come with a picture of themselves; the
//!   text is what the user meant.
//!
//! # Paste
//!
//! [`Clipboard::paste`] writes the entry to the clipboard and sends the paste
//! shortcut to the frontmost app. On macOS that is a synthesised Cmd+V, which
//! the system only delivers from a process with Accessibility permission:
//! [`accessibility_trusted`] tells, [`request_accessibility`] asks, and `paste`
//! fails with [`Error::NeedsAccessibility`] rather than silently doing nothing.
//! The caller hides pal's window first so the target app is frontmost.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};

/// Change-detection period. macOS has no public change notification for the
/// pasteboard (`changeCount` is the API), and a quarter second is what the
/// well-behaved managers use: a copy lands before the user can switch apps,
/// and the poll is one integer read.
pub const POLL: Duration = Duration::from_millis(250);

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no clipboard entry {0}")]
    NotFound(i64),
    /// macOS: synthesised keystrokes need Accessibility permission for pal.
    #[error("paste needs Accessibility permission")]
    NeedsAccessibility,
    /// No clipboard, or no way to paste, on this system.
    #[error("clipboard unavailable: {0}")]
    Unavailable(String),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Image,
    Files,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Text => "text",
            Kind::Image => "image",
            Kind::Files => "files",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "text" => Some(Kind::Text),
            "image" => Some(Kind::Image),
            "files" => Some(Kind::Files),
            _ => None,
        }
    }
}

/// One history row. Exactly one of `text`, `image`, `files` is set, by `kind`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub kind: Kind,
    pub text: Option<String>,
    /// PNG file under the store's image directory.
    pub image: Option<PathBuf>,
    pub files: Option<Vec<PathBuf>>,
    /// Bundle id of the app that was frontmost at copy time (macOS); `None`
    /// on Linux, where the compositor does not say.
    pub source_app: Option<String>,
    /// Last copied, unix milliseconds on the wire.
    #[serde(with = "millis")]
    pub at: SystemTime,
    /// UTF-8 length, PNG size, or the files' sizes summed.
    pub bytes: u64,
    pub pinned: bool,
    /// Pixel size for images.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// What one copy carried, as the watcher reads it and `copy` writes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    Text(String),
    /// PNG bytes.
    Image(Vec<u8>),
    Files(Vec<PathBuf>),
}

#[derive(Clone, Copy, Debug)]
pub struct Retention {
    pub max_entries: usize,
    pub max_age: Duration,
    /// Larger copies are not recorded at all.
    pub max_bytes: u64,
}

impl Default for Retention {
    fn default() -> Self {
        Self { max_entries: 1000, max_age: Duration::from_secs(30 * 24 * 3600), max_bytes: 10 * 1024 * 1024 }
    }
}

struct Inner {
    db: Mutex<Connection>,
    images: PathBuf,
    retention: Retention,
    fts: bool,
}

/// The store. Cheap to clone; every clone shares one connection.
#[derive(Clone)]
pub struct Clipboard(Arc<Inner>);

/// Stops the watcher thread when dropped.
pub struct WatchHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    text TEXT,
    image TEXT,
    files TEXT,
    source_app TEXT,
    at INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    pinned INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS entries_order ON entries(pinned, at);
";

/// External-content FTS over `text` and the `files` JSON; the triggers keep it
/// in step. Rows never change content, only `at` and `pinned`, so no update
/// trigger.
const SCHEMA_FTS: &str = "
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(text, files, content='entries', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, text, files) VALUES (new.id, new.text, new.files);
END;
CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, text, files) VALUES ('delete', old.id, old.text, old.files);
END;
";

const COLS: &str = "e.id, e.kind, e.text, e.image, e.files, e.source_app, e.at, e.bytes, e.width, e.height, e.pinned";

impl Clipboard {
    /// The default location, see the module docs.
    pub fn open() -> Result<Self> {
        Self::open_at(&default_dir(), Retention::default())
    }

    /// `dir/clipboard.db` and `dir/clipboard/*.png`.
    pub fn open_at(dir: &Path, retention: Retention) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let db = Connection::open(dir.join("clipboard.db"))?;
        db.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
        db.execute_batch(SCHEMA)?;
        // The bundled SQLite has FTS5; a system one might not, and LIKE still works.
        let fts = db.execute_batch(SCHEMA_FTS).is_ok();
        Ok(Self(Arc::new(Inner { db: Mutex::new(db), images: dir.join("clipboard"), retention, fts })))
    }

    pub fn retention(&self) -> Retention {
        self.0.retention
    }

    /// Record what the user copies until the handle is dropped. Copies made
    /// while an app in `exclude_apps` (bundle ids) is frontmost are ignored.
    /// `on_record` runs on the watcher thread for every entry stored or
    /// bumped, so a UI can re-list.
    pub fn start_watching(&self, exclude_apps: Vec<String>, on_record: impl Fn(&Entry) + Send + 'static) -> WatchHandle {
        let stop = Arc::new(AtomicBool::new(false));
        let (store, flag) = (self.clone(), stop.clone());
        // Baseline before the thread exists, so a copy made right after this
        // call is a change rather than the starting point.
        let mut watcher = platform::Watcher::new();
        let thread = std::thread::Builder::new()
            .name("clipboard-watch".into())
            .spawn(move || {
                while !flag.load(Ordering::Relaxed) {
                    if !watcher.changed(POLL) {
                        continue;
                    }
                    let app = platform::source_app();
                    if app.as_deref().is_some_and(|a| exclude_apps.iter().any(|x| x == a)) {
                        continue;
                    }
                    if let Some(content) = platform::read() {
                        if let Ok(Some(entry)) = store.record(content, app) {
                            on_record(&entry);
                        }
                    }
                }
            })
            .expect("spawn clipboard watcher");
        WatchHandle { stop, thread: Some(thread) }
    }

    /// Store one copy. `None` when it was empty or over the size cap.
    pub fn record(&self, content: Content, source_app: Option<String>) -> Result<Option<Entry>> {
        self.record_at(content, source_app, SystemTime::now())
    }

    fn record_at(&self, content: Content, source_app: Option<String>, at: SystemTime) -> Result<Option<Entry>> {
        let (kind, bytes) = match &content {
            Content::Text(t) => (Kind::Text, t.len() as u64),
            Content::Image(png) => (Kind::Image, png.len() as u64),
            Content::Files(f) => (Kind::Files, f.iter().filter_map(|p| fs::metadata(p).ok()).map(|m| m.len()).sum()),
        };
        let empty = match &content {
            Content::Text(t) => t.is_empty(),
            Content::Image(png) => png.is_empty(),
            Content::Files(f) => f.is_empty(),
        };
        if empty || bytes > self.0.retention.max_bytes {
            return Ok(None);
        }
        let hash = content_hash(&content);
        let at_ms = to_millis(at);
        let db = self.0.db.lock().unwrap();
        // Same content again: to the top, keep who copied it first.
        let bumped: Option<i64> = db
            .query_row(
                "UPDATE entries SET at = ?1, source_app = COALESCE(source_app, ?2) WHERE hash = ?3 RETURNING id",
                params![at_ms, source_app, hash],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = bumped {
            return Ok(Some(self.resolve(get(&db, id)?)));
        }
        let (text, image, files, dims) = match &content {
            Content::Text(t) => (Some(t.as_str()), None, None, None),
            Content::Image(png) => {
                let name = format!("{}.png", &hash[..16]);
                write_atomic(&self.0.images.join(&name), png)?;
                (None, Some(name), None, png_dims(png))
            }
            Content::Files(f) => (None, None, Some(serde_json::to_string(f).expect("paths")), None),
        };
        db.execute(
            "INSERT INTO entries (kind, text, image, files, source_app, at, bytes, width, height, hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![kind.as_str(), text, image, files, source_app, at_ms, bytes as i64, dims.map(|d| d.0), dims.map(|d| d.1), hash],
        )?;
        let id = db.last_insert_rowid();
        self.prune(&db, at_ms)?;
        Ok(Some(self.resolve(get(&db, id)?)))
    }

    /// Age first, then count; pinned rows are exempt from both.
    fn prune(&self, db: &Connection, now_ms: i64) -> Result<()> {
        let r = self.0.retention;
        let cutoff = now_ms - r.max_age.as_millis() as i64;
        let mut stale: Vec<Option<String>> = collect_col(db, "DELETE FROM entries WHERE pinned = 0 AND at < ?1 RETURNING image", params![cutoff])?;
        stale.extend(collect_col(
            db,
            "DELETE FROM entries WHERE pinned = 0 AND id NOT IN (SELECT id FROM entries WHERE pinned = 0 ORDER BY at DESC LIMIT ?1) RETURNING image",
            params![r.max_entries as i64],
        )?);
        self.remove_images(stale);
        Ok(())
    }

    fn remove_images(&self, names: Vec<Option<String>>) {
        for name in names.into_iter().flatten() {
            let _ = fs::remove_file(self.0.images.join(name));
        }
    }

    /// Pinned first, then newest first. `query` matches text content and file
    /// paths, every word as a prefix; empty lists everything.
    pub fn list(&self, query: &str, kind: Option<Kind>, limit: usize, offset: usize) -> Result<Vec<Entry>> {
        let db = self.0.db.lock().unwrap();
        let kind = kind.map(Kind::as_str);
        let order = "ORDER BY e.pinned DESC, e.at DESC LIMIT ?2 OFFSET ?3";
        let q = query.trim();
        let (sql, needle) = if q.is_empty() {
            (format!("SELECT {COLS} FROM entries e WHERE (?1 IS NULL OR e.kind = ?1) {order}"), None)
        } else if self.0.fts {
            (
                format!("SELECT {COLS} FROM entries e JOIN entries_fts f ON f.rowid = e.id WHERE entries_fts MATCH ?4 AND (?1 IS NULL OR e.kind = ?1) {order}"),
                Some(fts_query(q)),
            )
        } else {
            (
                format!("SELECT {COLS} FROM entries e WHERE (e.text LIKE ?4 ESCAPE '\\' OR e.files LIKE ?4 ESCAPE '\\') AND (?1 IS NULL OR e.kind = ?1) {order}"),
                Some(format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"))),
            )
        };
        let mut stmt = db.prepare_cached(&sql)?;
        let rows = match needle {
            None => stmt.query_map(params![kind, limit as i64, offset as i64], row_entry)?,
            Some(n) => stmt.query_map(params![kind, limit as i64, offset as i64, n], row_entry)?,
        };
        let entries: std::result::Result<Vec<_>, _> = rows.collect();
        Ok(entries?.into_iter().map(|e| self.resolve(e)).collect())
    }

    pub fn get(&self, id: i64) -> Result<Entry> {
        let db = self.0.db.lock().unwrap();
        get(&db, id).map(|e| self.resolve(e))
    }

    pub fn pin(&self, id: i64, pinned: bool) -> Result<()> {
        let db = self.0.db.lock().unwrap();
        let n = db.execute("UPDATE entries SET pinned = ?1 WHERE id = ?2", params![pinned as i64, id])?;
        if n == 0 {
            return Err(Error::NotFound(id));
        }
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        let db = self.0.db.lock().unwrap();
        let image: Option<Option<String>> =
            db.query_row("DELETE FROM entries WHERE id = ?1 RETURNING image", params![id], |r| r.get(0)).optional()?;
        let image = image.ok_or(Error::NotFound(id))?;
        self.remove_images(vec![image]);
        Ok(())
    }

    /// Everything, pinned included.
    pub fn clear(&self) -> Result<()> {
        let db = self.0.db.lock().unwrap();
        db.execute("DELETE FROM entries", [])?;
        if self.0.images.is_dir() {
            fs::remove_dir_all(&self.0.images)?;
        }
        Ok(())
    }

    /// Put the entry back on the clipboard and bump it to the top.
    pub fn copy(&self, id: i64) -> Result<()> {
        let content = self.content(id)?;
        platform::write(&content)?;
        let db = self.0.db.lock().unwrap();
        db.execute("UPDATE entries SET at = ?1 WHERE id = ?2", params![to_millis(SystemTime::now()), id])?;
        Ok(())
    }

    /// [`copy`](Self::copy), then the paste shortcut into the frontmost app.
    /// The caller has already hidden pal's window. See the module docs.
    pub fn paste(&self, id: i64) -> Result<()> {
        if !accessibility_trusted() {
            return Err(Error::NeedsAccessibility);
        }
        self.copy(id)?;
        send_paste()
    }

    pub fn content(&self, id: i64) -> Result<Content> {
        let e = self.get(id)?;
        Ok(match e.kind {
            Kind::Text => Content::Text(e.text.unwrap_or_default()),
            Kind::Image => Content::Image(fs::read(e.image.expect("image row has a file"))?),
            Kind::Files => Content::Files(e.files.unwrap_or_default()),
        })
    }

    /// Rows keep the image's file name; callers get the full path.
    fn resolve(&self, mut e: Entry) -> Entry {
        e.image = e.image.map(|n| self.0.images.join(n));
        e
    }
}

fn get(db: &Connection, id: i64) -> Result<Entry> {
    db.query_row(&format!("SELECT {COLS} FROM entries e WHERE id = ?1"), params![id], row_entry)
        .optional()?
        .ok_or(Error::NotFound(id))
}

fn row_entry(r: &rusqlite::Row) -> rusqlite::Result<Entry> {
    let kind: String = r.get(1)?;
    let files: Option<String> = r.get(4)?;
    Ok(Entry {
        id: r.get(0)?,
        kind: Kind::parse(&kind).unwrap_or(Kind::Text),
        text: r.get(2)?,
        image: r.get::<_, Option<String>>(3)?.map(PathBuf::from),
        files: files.and_then(|f| serde_json::from_str(&f).ok()),
        source_app: r.get(5)?,
        at: from_millis(r.get(6)?),
        bytes: r.get::<_, i64>(7)? as u64,
        width: r.get(8)?,
        height: r.get(9)?,
        pinned: r.get::<_, i64>(10)? != 0,
    })
}

fn collect_col<T: rusqlite::types::FromSql>(db: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<Vec<T>> {
    let mut stmt = db.prepare_cached(sql)?;
    let rows = stmt.query_map(p, |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Every word a quoted prefix term: `foo b"ar` becomes `"foo"* "b""ar"*`.
fn fts_query(q: &str) -> String {
    q.split_whitespace().map(|w| format!("\"{}\"*", w.replace('"', "\"\""))).collect::<Vec<_>>().join(" ")
}

fn content_hash(c: &Content) -> String {
    let mut h = Sha256::new();
    match c {
        Content::Text(t) => h.update(t.as_bytes()),
        Content::Image(png) => h.update(png),
        Content::Files(f) => {
            for p in f {
                h.update(p.as_os_str().as_encoded_bytes());
                h.update([0]);
            }
        }
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Header only; a bad PNG still records, without a size.
fn png_dims(png: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(Cursor::new(png)).with_guessed_format().ok()?.into_dimensions().ok()
}

fn to_millis(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn from_millis(ms: i64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(ms.max(0) as u64)
}

mod millis {
    use super::*;
    pub fn serialize<S: serde::Serializer>(t: &SystemTime, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_i64(to_millis(*t))
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<SystemTime, D::Error> {
        i64::deserialize(d).map(from_millis)
    }
}

/// Where [`Clipboard::open`] keeps the store, for an `open_at` with other retention.
pub fn default_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::data_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("pal")
}

/// Temp file then rename, so a reader never sees a partial PNG.
fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = target.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, target).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Text that is not in history yet: to the clipboard, then the paste
/// shortcut, as [`Clipboard::paste`]. A running watcher records it like any
/// copy.
pub fn paste_text(text: &str) -> Result<()> {
    if !accessibility_trusted() {
        return Err(Error::NeedsAccessibility);
    }
    platform::write(&Content::Text(text.into()))?;
    send_paste()
}

/// Let the new pasteboard contents settle before the app reads them.
fn send_paste() -> Result<()> {
    std::thread::sleep(Duration::from_millis(50));
    platform::paste_key()
}

/// Whether synthesised keystrokes will be delivered. Always true off macOS.
pub fn accessibility_trusted() -> bool {
    platform::accessibility_trusted()
}

/// macOS: show the system prompt that adds pal to the Accessibility list.
/// Returns the current state; the user grants in System Settings, and a
/// later [`accessibility_trusted`] sees it without a restart.
pub fn request_accessibility() -> bool {
    platform::request_accessibility()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSPasteboard, NSPasteboardTypeFileURL, NSPasteboardTypePNG,
        NSPasteboardTypeString, NSPasteboardTypeTIFF, NSPasteboardWriting, NSWorkspace,
    };
    use objc2_core_graphics::{CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation};
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSNumber, NSString, NSURL};

    /// Password managers mark their copies with these; the second is also
    /// what pal-like tools set on programmatic writes they want ignored.
    const SKIP_TYPES: [&str; 2] = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType"];
    const KEY_V: u16 = 9;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const NSDictionary<NSString, NSNumber>) -> bool;
        static kAXTrustedCheckOptionPrompt: &'static NSString;
    }

    pub struct Watcher {
        count: isize,
    }

    impl Watcher {
        pub fn new() -> Self {
            Self { count: NSPasteboard::generalPasteboard().changeCount() }
        }

        /// Sleep `poll`, then report whether the pasteboard moved on.
        pub fn changed(&mut self, poll: Duration) -> bool {
            std::thread::sleep(poll);
            let now = NSPasteboard::generalPasteboard().changeCount();
            std::mem::replace(&mut self.count, now) != now
        }
    }

    pub fn source_app() -> Option<String> {
        Some(NSWorkspace::sharedWorkspace().frontmostApplication()?.bundleIdentifier()?.to_string())
    }

    pub fn read() -> Option<Content> {
        let pb = NSPasteboard::generalPasteboard();
        let types: Vec<String> = pb.types()?.iter().map(|t| t.to_string()).collect();
        if types.iter().any(|t| SKIP_TYPES.contains(&t.as_str())) {
            return None;
        }
        // SAFETY: reading AppKit's exported type constants.
        let (t_file, t_string, t_png, t_tiff) =
            unsafe { (NSPasteboardTypeFileURL, NSPasteboardTypeString, NSPasteboardTypePNG, NSPasteboardTypeTIFF) };
        let has = |t: &NSString| types.iter().any(|x| x == &t.to_string());
        if has(t_file) {
            let files: Vec<PathBuf> = pb
                .pasteboardItems()?
                .iter()
                .filter_map(|item| {
                    let url = NSURL::URLWithString(&*item.stringForType(t_file)?)?;
                    // A copy from Finder can be a `file:///.file/id=` reference URL.
                    let path = url.filePathURL().and_then(|u| u.path()).or_else(|| url.path())?;
                    Some(PathBuf::from(path.to_string()))
                })
                .collect();
            if !files.is_empty() {
                return Some(Content::Files(files));
            }
        }
        if has(t_string) {
            if let Some(s) = pb.stringForType(t_string) {
                return Some(Content::Text(s.to_string()));
            }
        }
        if has(t_png) {
            return pb.dataForType(t_png).map(|d| Content::Image(d.to_vec()));
        }
        if has(t_tiff) {
            let tiff = pb.dataForType(t_tiff)?;
            return Some(Content::Image(to_png(&tiff)?));
        }
        None
    }

    /// AppKit re-encodes whatever it can decode (TIFF here), so no TIFF
    /// decoder ships in pal for this one conversion.
    fn to_png(data: &NSData) -> Option<Vec<u8>> {
        let rep = NSBitmapImageRep::imageRepWithData(data)?;
        // SAFETY: an empty properties dictionary is valid for PNG.
        let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        Some(png.to_vec())
    }

    pub fn write(c: &Content) -> Result<()> {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        // SAFETY: reading AppKit's exported type constants.
        let (t_string, t_png, t_tiff) = unsafe { (NSPasteboardTypeString, NSPasteboardTypePNG, NSPasteboardTypeTIFF) };
        let ok = match c {
            Content::Text(s) => pb.setString_forType(&NSString::from_str(s), t_string),
            Content::Image(png) => {
                let data = NSData::with_bytes(png);
                let ok = pb.setData_forType(Some(&data), t_png);
                // Older apps only take TIFF.
                if let Some(tiff) = NSBitmapImageRep::imageRepWithData(&data).and_then(|r| r.TIFFRepresentation()) {
                    pb.setData_forType(Some(&tiff), t_tiff);
                }
                ok
            }
            Content::Files(paths) => {
                let urls: Vec<Retained<NSURL>> =
                    paths.iter().map(|p| NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()))).collect();
                let objs: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = urls.iter().map(|u| ProtocolObject::from_ref(&**u)).collect();
                pb.writeObjects(&NSArray::from_slice(&objs))
            }
        };
        ok.then_some(()).ok_or_else(|| Error::Unavailable("pasteboard refused the write".into()))
    }

    /// Cmd+V down and up on the HID tap, as if typed.
    pub fn paste_key() -> Result<()> {
        let src = CGEventSource::new(CGEventSourceStateID::CombinedSessionState);
        for down in [true, false] {
            let ev = CGEvent::new_keyboard_event(src.as_deref(), KEY_V, down)
                .ok_or_else(|| Error::Unavailable("CGEvent creation failed".into()))?;
            CGEvent::set_flags(Some(&ev), CGEventFlags::MaskCommand);
            CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&ev));
        }
        Ok(())
    }

    pub fn accessibility_trusted() -> bool {
        // SAFETY: plain C call with no arguments.
        unsafe { AXIsProcessTrusted() }
    }

    pub fn request_accessibility() -> bool {
        // SAFETY: the dictionary outlives the call; the key is the framework's own constant.
        unsafe {
            let opts = NSDictionary::from_slices(&[kAXTrustedCheckOptionPrompt], &[&*NSNumber::numberWithBool(true)]);
            AXIsProcessTrustedWithOptions(&*opts)
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::process::{Child, Command, Stdio};
    use std::sync::mpsc;

    pub enum Watcher {
        /// `wl-paste --watch` runs a command per clipboard change; the
        /// command's stdout is the signal, so nothing is read until asked.
        Wayland { child: Child, rx: mpsc::Receiver<()> },
        /// X11 (or no wl-paste): compare a hash of the text each poll.
        Poll { last: Option<String> },
    }

    impl Watcher {
        pub fn new() -> Self {
            if std::env::var_os("WAYLAND_DISPLAY").is_some() {
                if let Some(w) = Self::wayland() {
                    return w;
                }
            }
            Self::Poll { last: read().as_ref().map(content_hash) }
        }

        fn wayland() -> Option<Self> {
            let mut child = Command::new("wl-paste")
                .args(["--watch", "sh", "-c", "cat >/dev/null; echo"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .ok()?;
            let out = child.stdout.take()?;
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                use std::io::BufRead;
                for line in std::io::BufReader::new(out).lines() {
                    if line.is_err() || tx.send(()).is_err() {
                        break;
                    }
                }
            });
            Some(Self::Wayland { child, rx })
        }

        pub fn changed(&mut self, poll: Duration) -> bool {
            match self {
                Self::Wayland { rx, .. } => rx.recv_timeout(poll).is_ok(),
                Self::Poll { last } => {
                    std::thread::sleep(poll);
                    let now = read().as_ref().map(content_hash);
                    now.is_some() && std::mem::replace(last, now.clone()) != now
                }
            }
        }
    }

    impl Drop for Watcher {
        fn drop(&mut self) {
            if let Self::Wayland { child, .. } = self {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// Neither X11 nor the Wayland data-control protocol say who owns the selection.
    pub fn source_app() -> Option<String> {
        None
    }

    pub fn read() -> Option<Content> {
        let mut cb = arboard::Clipboard::new().ok()?;
        if let Ok(files) = cb.get().file_list() {
            if !files.is_empty() {
                return Some(Content::Files(files));
            }
        }
        if let Ok(text) = cb.get_text() {
            return Some(Content::Text(text));
        }
        let img = cb.get_image().ok()?;
        let rgba = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())?;
        let mut png = Cursor::new(Vec::new());
        rgba.write_to(&mut png, image::ImageFormat::Png).ok()?;
        Some(Content::Image(png.into_inner()))
    }

    pub fn write(c: &Content) -> Result<()> {
        let err = |e: arboard::Error| Error::Unavailable(e.to_string());
        let mut cb = arboard::Clipboard::new().map_err(err)?;
        match c {
            Content::Text(s) => cb.set_text(s.as_str()).map_err(err),
            Content::Files(paths) => cb.set().file_list(paths).map_err(err),
            Content::Image(png) => {
                let img = image::load_from_memory(png).map_err(|e| Error::Unavailable(e.to_string()))?.into_rgba8();
                let (w, h) = img.dimensions();
                let data = arboard::ImageData { width: w as usize, height: h as usize, bytes: img.into_raw().into() };
                cb.set_image(data).map_err(err)
            }
        }
    }

    /// Ctrl+V via `wtype` (wlroots virtual keyboard), else `ydotool` (uinput,
    /// needs ydotoold running).
    pub fn paste_key() -> Result<()> {
        let attempts: [(&str, &[&str]); 2] =
            [("wtype", &["-M", "ctrl", "-k", "v", "-m", "ctrl"]), ("ydotool", &["key", "29:1", "47:1", "47:0", "29:0"])];
        for (bin, args) in attempts {
            if let Ok(s) = Command::new(bin).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status() {
                if s.success() {
                    return Ok(());
                }
            }
        }
        Err(Error::Unavailable("no wtype or ydotool to send Ctrl+V".into()))
    }

    pub fn accessibility_trusted() -> bool {
        true
    }

    pub fn request_accessibility() -> bool {
        true
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;

    pub struct Watcher;

    impl Watcher {
        pub fn new() -> Self {
            Self
        }
        pub fn changed(&mut self, poll: Duration) -> bool {
            std::thread::sleep(poll);
            false
        }
    }

    pub fn source_app() -> Option<String> {
        None
    }
    pub fn read() -> Option<Content> {
        None
    }
    pub fn write(_: &Content) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn paste_key() -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn accessibility_trusted() -> bool {
        true
    }
    pub fn request_accessibility() -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: Duration = Duration::from_secs(24 * 3600);

    fn t(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn open(dir: &Path, r: Retention) -> Clipboard {
        Clipboard::open_at(dir, r).unwrap()
    }

    fn png(w: u32, h: u32, px: [u8; 4]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(w, h, image::Rgba(px)).write_to(&mut buf, image::ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    fn text(cb: &Clipboard, s: &str, at: u64) -> Entry {
        cb.record_at(Content::Text(s.into()), Some("com.example.app".into()), t(at)).unwrap().unwrap()
    }

    fn ids(v: &[Entry]) -> Vec<i64> {
        v.iter().map(|e| e.id).collect()
    }

    #[test]
    fn insert_get_and_order() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let a = text(&cb, "alpha", 100);
        let b = text(&cb, "beta", 200);
        assert_eq!(cb.get(a.id).unwrap(), a);
        assert_eq!(a.kind, Kind::Text);
        assert_eq!((a.text.as_deref(), a.bytes, a.source_app.as_deref()), (Some("alpha"), 5, Some("com.example.app")));
        assert_eq!(a.at, t(100));
        assert_eq!(ids(&cb.list("", None, 10, 0).unwrap()), [b.id, a.id]);
        assert_eq!(ids(&cb.list("", None, 1, 1).unwrap()), [a.id]);
        assert!(matches!(cb.get(999), Err(Error::NotFound(999))));
        assert!(cb.record(Content::Text(String::new()), None).unwrap().is_none(), "empty is skipped");
        assert!(dir.path().join("clipboard.db").is_file());
    }

    #[test]
    fn dedupe_bumps_to_top_and_keeps_first_source() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let a = text(&cb, "same", 100);
        let b = text(&cb, "other", 200);
        let again = cb.record_at(Content::Text("same".into()), Some("com.other".into()), t(300)).unwrap().unwrap();
        assert_eq!(again.id, a.id);
        assert_eq!((again.at, again.source_app.as_deref()), (t(300), Some("com.example.app")));
        assert_eq!(ids(&cb.list("", None, 10, 0).unwrap()), [a.id, b.id]);
        assert_eq!(cb.list("", None, 10, 0).unwrap().len(), 2);
        // Image dedupe goes by bytes too.
        let p = png(4, 4, [1, 2, 3, 255]);
        let i1 = cb.record_at(Content::Image(p.clone()), None, t(400)).unwrap().unwrap();
        let i2 = cb.record_at(Content::Image(p), None, t(500)).unwrap().unwrap();
        assert_eq!((i1.id, i1.width, i1.height), (i2.id, Some(4), Some(4)));
        assert_eq!(fs::read_dir(dir.path().join("clipboard")).unwrap().count(), 1);
    }

    #[test]
    fn retention_by_count_and_age_spares_pinned() {
        let dir = tempfile::tempdir().unwrap();
        let r = Retention { max_entries: 3, max_age: 10 * DAY, ..Default::default() };
        let cb = open(dir.path(), r);
        let now = 100 * DAY.as_secs();
        let old = text(&cb, "old", now - 20 * DAY.as_secs());
        cb.pin(old.id, true).unwrap();
        let stale = text(&cb, "stale", now - 11 * DAY.as_secs());
        let one = text(&cb, "one", now - 3);
        let two = text(&cb, "two", now - 2);
        let three = text(&cb, "three", now - 1);
        // "stale" is past max_age, gone; "old" is older but pinned.
        assert_eq!(ids(&cb.list("", None, 10, 0).unwrap()), [old.id, three.id, two.id, one.id]);
        assert!(matches!(cb.get(stale.id), Err(Error::NotFound(_))));
        let four = text(&cb, "four", now);
        // Count cap of 3 unpinned: "one" is the tail.
        assert_eq!(ids(&cb.list("", None, 10, 0).unwrap()), [old.id, four.id, three.id, two.id]);
        cb.pin(old.id, false).unwrap();
        text(&cb, "five", now + 1);
        assert!(matches!(cb.get(old.id), Err(Error::NotFound(_))), "unpinned, it expires on the next insert");
        assert!(matches!(cb.pin(old.id, true), Err(Error::NotFound(_))));
    }

    #[test]
    fn size_cap_skips_big_copies() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention { max_bytes: 100, ..Default::default() });
        assert!(cb.record(Content::Text("x".repeat(101)), None).unwrap().is_none());
        assert!(cb.record(Content::Text("x".repeat(100)), None).unwrap().is_some());
        assert!(cb.record(Content::Image(png(64, 64, [7, 7, 7, 255])), None).unwrap().is_none());
        assert!(!dir.path().join("clipboard").exists(), "nothing written for a skipped image");
    }

    #[test]
    fn search_prefix_words_and_kind_filter() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let url = text(&cb, "https://github.com/zcag/pal", 100);
        let note = text(&cb, "Buy milk and eggs", 200);
        let img = cb.record_at(Content::Image(png(2, 2, [0, 0, 0, 255])), None, t(300)).unwrap().unwrap();
        let files = cb.record_at(Content::Files(vec!["/tmp/report-final.pdf".into()]), None, t(400)).unwrap().unwrap();
        let find = |q: &str, k| ids(&cb.list(q, k, 10, 0).unwrap());
        assert_eq!(find("", None), [files.id, img.id, note.id, url.id]);
        assert_eq!(find("", Some(Kind::Image)), [img.id]);
        assert_eq!(find("", Some(Kind::Text)), [note.id, url.id]);
        assert_eq!(find("mil", None), [note.id]);
        assert_eq!(find("eggs milk", None), [note.id], "words are ANDed, any order");
        assert_eq!(find("github zcag", None), [url.id]);
        assert_eq!(find("report", None), [files.id], "file names are searchable");
        assert_eq!(find("report", Some(Kind::Text)), Vec::<i64>::new());
        assert_eq!(find("nothing-here", None), Vec::<i64>::new());
        assert_eq!(find("\"quoted", None), Vec::<i64>::new(), "punctuation does not break the query");
        assert_eq!(fts_query("a b\"c"), "\"a\"* \"b\"\"c\"*");
    }

    #[test]
    fn like_fallback_matches_the_same() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let note = text(&cb, "100% sure_thing", 100);
        text(&cb, "unrelated", 200);
        let mut inner = Arc::try_unwrap(cb.0).ok().expect("sole owner");
        inner.fts = false;
        let cb = Clipboard(Arc::new(inner));
        assert_eq!(ids(&cb.list("% sure_", None, 10, 0).unwrap()), [note.id]);
        assert_eq!(ids(&cb.list("sure", Some(Kind::Image), 10, 0).unwrap()), Vec::<i64>::new());
    }

    #[test]
    fn pinned_list_first_and_survive_clear_only_by_choice() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let a = text(&cb, "a", 100);
        let b = text(&cb, "b", 200);
        cb.pin(a.id, true).unwrap();
        assert_eq!(ids(&cb.list("", None, 10, 0).unwrap()), [a.id, b.id]);
        assert!(cb.get(a.id).unwrap().pinned);
        cb.clear().unwrap();
        assert!(cb.list("", None, 10, 0).unwrap().is_empty());
    }

    #[test]
    fn delete_removes_image_file() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let e = cb.record(Content::Image(png(3, 3, [9, 9, 9, 255])), None).unwrap().unwrap();
        let path = e.image.clone().unwrap();
        assert!(path.is_file());
        assert_eq!(path.parent().unwrap(), dir.path().join("clipboard"));
        assert_eq!(cb.get(e.id).unwrap().image.as_deref(), Some(path.as_path()));
        assert_eq!(cb.content(e.id).unwrap(), Content::Image(fs::read(&path).unwrap()));
        cb.delete(e.id).unwrap();
        assert!(!path.exists());
        assert!(matches!(cb.delete(e.id), Err(Error::NotFound(_))));
        // Retention deletes files too.
        let cb = open(dir.path(), Retention { max_entries: 1, ..Default::default() });
        let e1 = cb.record_at(Content::Image(png(1, 1, [1, 1, 1, 255])), None, t(10)).unwrap().unwrap();
        cb.record_at(Content::Image(png(1, 1, [2, 2, 2, 255])), None, t(20)).unwrap().unwrap();
        assert!(!e1.image.unwrap().exists());
        cb.clear().unwrap();
        assert!(!dir.path().join("clipboard").exists());
    }

    #[test]
    fn files_entry_round_trip_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<PathBuf> = vec!["/tmp/a.txt".into(), "/tmp/b c.txt".into()];
        let id = {
            let cb = open(dir.path(), Retention::default());
            let e = cb.record(Content::Files(paths.clone()), None).unwrap().unwrap();
            assert_eq!((e.kind, e.files.as_deref()), (Kind::Files, Some(paths.as_slice())));
            e.id
        };
        let cb = open(dir.path(), Retention::default());
        assert_eq!(cb.content(id).unwrap(), Content::Files(paths));
        let json = serde_json::to_value(cb.get(id).unwrap()).unwrap();
        assert_eq!(json["kind"], "files");
        assert!(json["at"].is_i64());
    }

    /// Needs a real pasteboard: `cargo test -p pal-core -- --ignored watcher_records_pbcopy`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn watcher_records_pbcopy() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = cb.start_watching(vec![], move |e| { let _ = tx.send(e.id); });
        let marker = format!("pal-clipboard-test-{}", std::process::id());
        let mut child = std::process::Command::new("pbcopy").stdin(std::process::Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(marker.as_bytes()).unwrap();
        child.wait().unwrap();
        let deadline = std::time::Instant::now() + POLL * 8;
        while cb.list(&marker, None, 1, 0).unwrap().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        drop(handle);
        let got = cb.list("", Some(Kind::Text), 1, 0).unwrap();
        assert_eq!(got[0].text.as_deref(), Some(marker.as_str()));
        assert!(got[0].source_app.is_some());
        assert_eq!(rx.try_recv(), Ok(got[0].id), "the callback saw the entry");
    }
}
