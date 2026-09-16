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
//!   [`Retention::max_age`] go (none when it is `None`), then the unpinned
//!   tail past [`Retention::max_entries`]. Pinned entries never expire.
//! - **Size cap.** Anything over [`Retention::max_bytes`] is not recorded.
//! - **Privacy.** Items a password manager marks `org.nspasteboard.ConcealedType`
//!   or `TransientType` are skipped (macOS convention, <http://nspasteboard.org>),
//!   as is the `x-kde-passwordManagerHint` type on Linux; so is anything
//!   copied while an app in the exclude list is frontmost, and every change
//!   inside a [`suppress_watch`] window, which is how pal's own concealed
//!   writes ([`write_text_concealed`]), their clear-after restore and the
//!   selection snapshot ([`selection_snapshot`]) stay out of history.
//! - **Priority** when a copy carries several representations: files, then
//!   text, then image. Spreadsheet cells come with a picture of themselves; the
//!   text is what the user meant.
//!
//! # Paste
//!
//! [`Clipboard::paste`] writes the entry to the clipboard and sends the paste
//! shortcut to the frontmost app. On macOS that is a synthesised Cmd+V, which
//! the system only delivers from a process with Accessibility permission
//! ([`crate::ax`]): `paste` fails with [`Error::NeedsAccessibility`] rather
//! than silently doing nothing.
//! The caller hides pal's window first so the target app is frontmost.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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

/// What the recorder keeps. The defaults match the clipboard extension's
/// manifest (`extensions/clipboard/pal.json`), which is where the user sets
/// them.
#[derive(Clone, Copy, Debug)]
pub struct Retention {
    pub max_entries: usize,
    /// `None`: no age limit, only the count applies.
    pub max_age: Option<Duration>,
    /// Larger copies are not recorded at all.
    pub max_bytes: u64,
}

impl Default for Retention {
    fn default() -> Self {
        Self { max_entries: 1000, max_age: Some(Duration::from_secs(30 * 24 * 3600)), max_bytes: 10 * 1024 * 1024 }
    }
}

impl Retention {
    /// From the manifest's units: `max_age_days = 0` is no age limit, never
    /// "older than now", which would empty the history on the next copy.
    pub fn days(max_entries: usize, max_age_days: u64) -> Self {
        Self { max_entries, max_age: (max_age_days > 0).then(|| Duration::from_secs(max_age_days * 24 * 3600)), ..Self::default() }
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
                    if suppressed() || platform::concealed() {
                        continue;
                    }
                    let app = platform::source_app();
                    if let Some(content) = platform::read() {
                        if let Ok(Some(entry)) = store.observe(content, app, &exclude_apps) {
                            on_record(&entry);
                        }
                    }
                }
            })
            .expect("spawn clipboard watcher");
        WatchHandle { stop, thread: Some(thread) }
    }

    /// What the watcher does with a change: nothing inside a
    /// [`suppress_watch`] window or from an excluded app, else [`record`](Self::record).
    pub fn observe(&self, content: Content, source_app: Option<String>, exclude_apps: &[String]) -> Result<Option<Entry>> {
        if suppressed() || source_app.as_deref().is_some_and(|a| exclude_apps.iter().any(|x| x == a)) {
            return Ok(None);
        }
        self.record(content, source_app)
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
        let mut stale: Vec<Option<String>> = Vec::new();
        if let Some(max_age) = r.max_age {
            let cutoff = now_ms - max_age.as_millis() as i64;
            stale = collect_col(db, "DELETE FROM entries WHERE pinned = 0 AND at < ?1 RETURNING image", params![cutoff])?;
        }
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

    /// The history entry for what is on the clipboard right now, if history
    /// recorded it: the pasteboard is read (concealed content skipped, as
    /// the watcher skips it) and looked up by content hash. `None` when
    /// the clipboard is empty, holds something history never took (a copy
    /// from an excluded app, one over the size cap, a type pal does not
    /// read) or it was deleted from history since: what the root's
    /// Clipboard section may show is exactly what history shows.
    pub fn current(&self) -> Result<Option<Entry>> {
        let Some(content) = platform::read() else { return Ok(None) };
        self.find_by_hash(&content_hash(&content))
    }

    fn find_by_hash(&self, hash: &str) -> Result<Option<Entry>> {
        let db = self.0.db.lock().unwrap();
        let e = db.query_row(&format!("SELECT {COLS} FROM entries e WHERE hash = ?1"), params![hash], row_entry).optional()?;
        Ok(e.map(|e| self.resolve(e)))
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
        if !crate::ax::trusted() {
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

/// Text that is not in history yet, onto the clipboard: the one writer pal
/// uses, so a running watcher records it like any copy (the `copy` effect).
pub fn write_text(text: &str) -> Result<()> {
    platform::write(&Content::Text(text.into()))
}

/// Text onto the clipboard marked for clipboard managers to skip
/// (`org.nspasteboard.ConcealedType` on macOS, `x-kde-passwordManagerHint`
/// on Linux), and kept out of pal's own history too (a [`suppress_watch`]
/// window covers the poll after the write). For a password or a one-time
/// code: the `copy` effect with `concealed`.
pub fn write_text_concealed(text: &str) -> Result<()> {
    suppress_watch(SUPPRESS);
    platform::write_concealed(text)
}

/// [`write_text_concealed`], then after `delay` the previous clipboard put
/// back (or the clipboard emptied when there was none) if the secret is
/// still what is on it; a copy the user made meanwhile is left alone.
/// Returns at once; the wait runs on its own thread.
pub fn write_text_concealed_for(text: &str, delay: Duration) -> Result<()> {
    let previous = platform::read_any();
    write_text_concealed(text)?;
    let secret = text.to_string();
    std::thread::Builder::new()
        .name("clipboard-clear".into())
        .spawn(move || {
            std::thread::sleep(delay);
            restore(previous, &secret);
        })
        .map(|_| ())
        .map_err(Error::Io)
}

/// What the clear-after does once the delay is up.
#[derive(Debug, PartialEq, Eq)]
pub enum Restore {
    /// The user copied something else meanwhile: nothing.
    Leave,
    /// The secret is still there and nothing preceded it: empty the clipboard.
    Clear,
    /// The secret is still there: put back what preceded it.
    Write(Content),
}

/// The decision behind [`write_text_concealed_for`]: `now` is what the
/// clipboard holds when the delay is up, `previous` what it held before
/// the secret went on.
pub fn restore_plan(now: Option<&Content>, secret: &str, previous: Option<Content>) -> Restore {
    match now {
        Some(Content::Text(t)) if t == secret => previous.map_or(Restore::Clear, Restore::Write),
        _ => Restore::Leave,
    }
}

/// How long the watcher ignores changes after one of pal's own writes it
/// should not record: two polls, so the poll that sees the change and the
/// one after (the restore) both skip.
const SUPPRESS: Duration = Duration::from_millis(600);

/// Unix milliseconds until which the watcher records nothing.
static SUPPRESS_UNTIL: AtomicU64 = AtomicU64::new(0);

/// Ignore clipboard changes for `d` from now: for a write pal makes that
/// is not a copy (a concealed secret, a restore, the selection snapshot).
pub fn suppress_watch(d: Duration) {
    let until = to_millis(SystemTime::now() + d) as u64;
    SUPPRESS_UNTIL.fetch_max(until, Ordering::Relaxed);
}

fn suppressed() -> bool {
    (to_millis(SystemTime::now()) as u64) < SUPPRESS_UNTIL.load(Ordering::Relaxed)
}

/// The text the frontmost app has selected, read by copying it: the
/// clipboard is saved, the copy shortcut sent (Cmd+C, which needs
/// Accessibility on macOS like paste), the new text read once the
/// clipboard changes (up to `wait`), and the saved contents put back. The
/// watcher records none of it. `None` when nothing was selected (the
/// clipboard did not change). The caller has hidden pal's window first.
/// [`crate::selection`] tries the accessibility API before this.
pub fn selection_snapshot(wait: Duration) -> Result<Option<String>> {
    if !crate::ax::trusted() {
        return Err(Error::NeedsAccessibility);
    }
    suppress_watch(SUPPRESS + wait);
    let previous = platform::read_any();
    let mut watcher = platform::Watcher::new();
    platform::copy_key()?;
    let deadline = Instant::now() + wait;
    let mut changed = false;
    while Instant::now() < deadline {
        if watcher.changed(Duration::from_millis(20)) {
            changed = true;
            break;
        }
    }
    let text = if changed { read_text() } else { None };
    if changed {
        suppress_watch(SUPPRESS);
        match previous {
            Some(c) => platform::write(&c)?,
            None => platform::clear(),
        }
    }
    Ok(text.filter(|t| !t.is_empty()))
}

/// Files onto the clipboard (file URLs on macOS, `text/uri-list` on Linux
/// through arboard, which needs X11 or the wlr data-control protocol:
/// [`Error::Unavailable`] otherwise), as [`write_text`] for text: the
/// `copy_files` effect, recorded by a running watcher like any copy.
pub fn write_files(paths: Vec<PathBuf>) -> Result<()> {
    if paths.is_empty() {
        return Err(Error::Unavailable("no files to copy".into()));
    }
    platform::write(&Content::Files(paths))
}

/// The text on the clipboard now, if that is what is there (a file list or
/// an image is `None`): the other half of [`write_text`], for
/// `pal action paste`.
pub fn read_text() -> Option<String> {
    match platform::read()? {
        Content::Text(s) => Some(s),
        _ => None,
    }
}

/// [`write_text`], then the paste shortcut, as [`Clipboard::paste`].
pub fn paste_text(text: &str) -> Result<()> {
    if !crate::ax::trusted() {
        return Err(Error::NeedsAccessibility);
    }
    write_text(text)?;
    send_paste()
}

/// Let the new pasteboard contents settle before the app reads them.
pub(crate) fn send_paste() -> Result<()> {
    std::thread::sleep(Duration::from_millis(50));
    platform::paste_key()
}

/// What the clipboard holds now, concealed or not: what [`restore`] puts
/// back after a write pal made for its own paste (snippet expansion).
pub(crate) fn snapshot() -> Option<Content> {
    platform::read_any()
}

/// Put `previous` back (or empty the clipboard when there was nothing) if
/// `secret` is still what is on it; the watcher records none of it. The
/// second half of [`snapshot`], the same decision as the clear-after.
pub(crate) fn restore(previous: Option<Content>, secret: &str) {
    match restore_plan(platform::read_any().as_ref(), secret, previous) {
        Restore::Leave => {}
        Restore::Clear => {
            suppress_watch(SUPPRESS);
            platform::clear();
        }
        Restore::Write(c) => {
            suppress_watch(SUPPRESS);
            let _ = platform::write(&c);
        }
    }
}

/// A keystroke in the `Action.shortcut` spelling (`cmd+shift+g`, `ctrl+l`,
/// `enter`), sent to the app in front as if typed: what the dialog jump
/// uses for the Go to Folder sheet. Needs Accessibility on macOS like
/// paste; `wtype` or `ydotool` on Linux.
pub fn send_key(shortcut: &str) -> Result<()> {
    let k = Keystroke::parse(shortcut).ok_or_else(|| Error::Unavailable(format!("no key {shortcut:?}")))?;
    send_keystroke(&k)
}

/// [`send_key`] for a parsed key: what a run of them (the backspaces of an
/// expansion) calls without parsing each time.
pub fn send_keystroke(k: &Keystroke) -> Result<()> {
    if !crate::ax::trusted() {
        return Err(Error::NeedsAccessibility);
    }
    platform::send_key(k)
}

/// A key with modifiers, parsed from the shortcut spelling. The keys pal
/// sends: letters, `enter`, `escape`, `tab`, `space`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Keystroke {
    pub key: String,
    pub cmd: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

impl Keystroke {
    pub fn parse(s: &str) -> Option<Self> {
        let mut k = Keystroke { key: String::new(), cmd: false, ctrl: false, alt: false, shift: false };
        for part in s.split('+') {
            match part.trim().to_ascii_lowercase().as_str() {
                "cmd" | "meta" | "super" => k.cmd = true,
                "ctrl" | "control" => k.ctrl = true,
                "alt" | "option" => k.alt = true,
                "shift" => k.shift = true,
                key if !key.is_empty() && k.key.is_empty() => k.key = key.to_string(),
                _ => return None,
            }
        }
        (!k.key.is_empty()).then_some(k)
    }

    /// The macOS virtual key code (`kVK_*`, US layout for letters).
    pub fn mac_code(&self) -> Option<u16> {
        Some(match self.key.as_str() {
            "a" => 0, "s" => 1, "d" => 2, "f" => 3, "h" => 4, "g" => 5, "z" => 6, "x" => 7, "c" => 8, "v" => 9, "b" => 11, "q" => 12, "w" => 13, "e" => 14, "r" => 15, "y" => 16, "t" => 17,
            "o" => 31, "u" => 32, "i" => 34, "p" => 35, "l" => 37, "j" => 38, "k" => 40, "n" => 45, "m" => 46,
            "enter" | "return" => 36, "tab" => 48, "space" => 49, "escape" | "esc" => 53, "backspace" => 51,
            "left" => 123, "right" => 124, "down" => 125, "up" => 126,
            _ => return None,
        })
    }

    /// The evdev key code, for ydotool.
    pub fn evdev_code(&self) -> Option<u16> {
        Some(match self.key.as_str() {
            "q" => 16, "w" => 17, "e" => 18, "r" => 19, "t" => 20, "y" => 21, "u" => 22, "i" => 23, "o" => 24, "p" => 25,
            "a" => 30, "s" => 31, "d" => 32, "f" => 33, "g" => 34, "h" => 35, "j" => 36, "k" => 37, "l" => 38,
            "z" => 44, "x" => 45, "c" => 46, "v" => 47, "b" => 48, "n" => 49, "m" => 50,
            "enter" | "return" => 28, "tab" => 15, "space" => 57, "escape" | "esc" => 1, "backspace" => 14,
            "up" => 103, "left" => 105, "right" => 106, "down" => 108,
            _ => return None,
        })
    }
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
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSString, NSURL};

    /// Password managers mark their copies with these; the second is also
    /// what pal-like tools set on programmatic writes they want ignored.
    const SKIP_TYPES: [&str; 2] = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType"];
    const KEY_V: u16 = 9;
    const KEY_C: u16 = 8;

    /// The general pasteboard is one object and not thread-safe: the
    /// watcher thread and the bridge's blocking threads (`current`, a
    /// `copy` effect) both reach it, and two `types` calls at once crashed
    /// in `-[NSPasteboard _updateTypeCacheIfNeeded]` (hornet, 2026-09-16).
    /// Every access here holds this; the poll's sleep is outside it.
    static PASTEBOARD: Mutex<()> = Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        PASTEBOARD.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub struct Watcher {
        count: isize,
    }

    impl Watcher {
        pub fn new() -> Self {
            let _g = lock();
            Self { count: NSPasteboard::generalPasteboard().changeCount() }
        }

        /// Sleep `poll`, then report whether the pasteboard moved on.
        pub fn changed(&mut self, poll: Duration) -> bool {
            std::thread::sleep(poll);
            let _g = lock();
            let now = NSPasteboard::generalPasteboard().changeCount();
            std::mem::replace(&mut self.count, now) != now
        }
    }

    pub fn source_app() -> Option<String> {
        Some(NSWorkspace::sharedWorkspace().frontmostApplication()?.bundleIdentifier()?.to_string())
    }

    /// Whether what is on the pasteboard carries a type history should skip.
    pub fn concealed() -> bool {
        let _g = lock();
        NSPasteboard::generalPasteboard().types().is_some_and(|ts| ts.iter().any(|t| SKIP_TYPES.contains(&t.to_string().as_str())))
    }

    /// [`read`] minus the concealed check: for pal's own bookkeeping (what
    /// to restore, whether a secret is still there), never for history.
    pub fn read_any() -> Option<Content> {
        read_with(false)
    }

    pub fn read() -> Option<Content> {
        read_with(true)
    }

    fn read_with(skip_concealed: bool) -> Option<Content> {
        let _g = lock();
        let pb = NSPasteboard::generalPasteboard();
        let types: Vec<String> = pb.types()?.iter().map(|t| t.to_string()).collect();
        if skip_concealed && types.iter().any(|t| SKIP_TYPES.contains(&t.as_str())) {
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
        let _g = lock();
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

    /// The text plus the nspasteboard.org concealed marker on the same
    /// item; the marker's value is not read by anyone, the type is.
    pub fn write_concealed(text: &str) -> Result<()> {
        let _g = lock();
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        // SAFETY: reading AppKit's exported type constant.
        let t_string = unsafe { NSPasteboardTypeString };
        let ok = pb.setString_forType(&NSString::from_str(text), t_string)
            && pb.setString_forType(&NSString::from_str(""), &NSString::from_str(SKIP_TYPES[0]));
        ok.then_some(()).ok_or_else(|| Error::Unavailable("pasteboard refused the write".into()))
    }

    pub fn clear() {
        let _g = lock();
        NSPasteboard::generalPasteboard().clearContents();
    }

    /// Cmd+V down and up on the HID tap, as if typed.
    pub fn paste_key() -> Result<()> {
        command_key(KEY_V)
    }

    /// Cmd+C, the same way: the selection snapshot.
    pub fn copy_key() -> Result<()> {
        command_key(KEY_C)
    }

    fn command_key(key: u16) -> Result<()> {
        post_key(key, CGEventFlags::MaskCommand)
    }

    /// Any key with its modifiers, the same way (`Keystroke::parse`).
    pub fn send_key(k: &Keystroke) -> Result<()> {
        let code = k.mac_code().ok_or_else(|| Error::Unavailable(format!("no key code for {:?}", k.key)))?;
        let mut flags = CGEventFlags::empty();
        if k.cmd { flags |= CGEventFlags::MaskCommand; }
        if k.ctrl { flags |= CGEventFlags::MaskControl; }
        if k.alt { flags |= CGEventFlags::MaskAlternate; }
        if k.shift { flags |= CGEventFlags::MaskShift; }
        post_key(code, flags)
    }

    fn post_key(key: u16, flags: CGEventFlags) -> Result<()> {
        let src = CGEventSource::new(CGEventSourceStateID::CombinedSessionState);
        for down in [true, false] {
            let ev = CGEvent::new_keyboard_event(src.as_deref(), key, down)
                .ok_or_else(|| Error::Unavailable("CGEvent creation failed".into()))?;
            CGEvent::set_flags(Some(&ev), flags);
            CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&ev));
        }
        Ok(())
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

    /// The KDE password-manager hint (what KeePassXC and arboard's
    /// `exclude_from_history` set) among the offered types, listed by
    /// `wl-paste` or `xclip` since arboard does not expose the types; no
    /// tool, no way to tell.
    pub fn concealed() -> bool {
        let out = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            Command::new("wl-paste").args(["--list-types"]).stdin(Stdio::null()).stderr(Stdio::null()).output()
        } else {
            Command::new("xclip").args(["-selection", "clipboard", "-o", "-t", "TARGETS"]).stdin(Stdio::null()).stderr(Stdio::null()).output()
        };
        out.is_ok_and(|o| String::from_utf8_lossy(&o.stdout).lines().any(|l| l.trim() == KDE_HINT))
    }

    const KDE_HINT: &str = "x-kde-passwordManagerHint";

    /// No type check on the read here (the watcher asks [`concealed`] once per change).
    pub fn read_any() -> Option<Content> {
        read()
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

    /// arboard's `exclude_from_history`: the text plus the KDE hint.
    pub fn write_concealed(text: &str) -> Result<()> {
        use arboard::SetExtLinux;
        let mut cb = arboard::Clipboard::new().map_err(|e| Error::Unavailable(e.to_string()))?;
        cb.set().exclude_from_history().text(text).map_err(|e| Error::Unavailable(e.to_string()))
    }

    pub fn clear() {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.clear();
        }
    }

    /// Ctrl+V via `wtype` (wlroots virtual keyboard), else `ydotool` (uinput,
    /// needs ydotoold running).
    pub fn paste_key() -> Result<()> {
        control_key("v", "47")
    }

    /// Ctrl+C, the same way: the selection snapshot.
    pub fn copy_key() -> Result<()> {
        control_key("c", "46")
    }

    /// Any key with its modifiers, the same way.
    pub fn send_key(k: &Keystroke) -> Result<()> {
        let code = k.evdev_code().ok_or_else(|| Error::Unavailable(format!("no key code for {:?}", k.key)))?;
        // wtype names: (modifier, evdev code) pairs held around the key.
        let mods: Vec<(&str, u16)> = [(k.ctrl, ("ctrl", 29)), (k.alt, ("alt", 56)), (k.shift, ("shift", 42)), (k.cmd, ("logo", 125))].into_iter().filter(|(on, _)| *on).map(|(_, m)| m).collect();
        let wkey = match k.key.as_str() { "enter" | "return" => "Return", "tab" => "Tab", "space" => "space", "escape" | "esc" => "Escape", "backspace" => "BackSpace", key => key };
        let mut wtype: Vec<String> = mods.iter().flat_map(|(m, _)| ["-M".to_string(), m.to_string()]).collect();
        wtype.extend(["-k".to_string(), wkey.to_string()]);
        wtype.extend(mods.iter().flat_map(|(m, _)| ["-m".to_string(), m.to_string()]));
        let mut ydo: Vec<String> = vec!["key".into()];
        ydo.extend(mods.iter().map(|(_, c)| format!("{c}:1")));
        ydo.extend([format!("{code}:1"), format!("{code}:0")]);
        ydo.extend(mods.iter().rev().map(|(_, c)| format!("{c}:0")));
        for (bin, args) in [("wtype", wtype), ("ydotool", ydo)] {
            if let Ok(s) = Command::new(bin).args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status() {
                if s.success() {
                    return Ok(());
                }
            }
        }
        Err(Error::Unavailable(format!("no wtype or ydotool to send {}", k.key)))
    }

    /// `key` is the letter for wtype, `code` its evdev keycode for ydotool.
    fn control_key(key: &str, code: &str) -> Result<()> {
        let down = format!("{code}:1");
        let up = format!("{code}:0");
        let attempts: [(&str, Vec<&str>); 2] =
            [("wtype", vec!["-M", "ctrl", "-k", key, "-m", "ctrl"]), ("ydotool", vec!["key", "29:1", &down, &up, "29:0"])];
        for (bin, args) in attempts {
            if let Ok(s) = Command::new(bin).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status() {
                if s.success() {
                    return Ok(());
                }
            }
        }
        Err(Error::Unavailable(format!("no wtype or ydotool to send Ctrl+{}", key.to_uppercase())))
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
    pub fn concealed() -> bool {
        false
    }
    pub fn read() -> Option<Content> {
        None
    }
    pub fn read_any() -> Option<Content> {
        None
    }
    pub fn write(_: &Content) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn write_concealed(_: &str) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn clear() {}
    pub fn paste_key() -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn copy_key() -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn send_key(_: &Keystroke) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
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
    fn find_by_hash_is_what_current_looks_up() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let a = text(&cb, "on the board", 100);
        let p = png(2, 2, [9, 9, 9, 255]);
        let i = cb.record_at(Content::Image(p.clone()), None, t(200)).unwrap().unwrap();
        assert_eq!(cb.find_by_hash(&content_hash(&Content::Text("on the board".into()))).unwrap(), Some(a.clone()));
        let found = cb.find_by_hash(&content_hash(&Content::Image(p))).unwrap().unwrap();
        assert_eq!(found.id, i.id);
        assert!(found.image.as_ref().is_some_and(|f| f.is_absolute() && f.is_file()), "the image path is resolved: {:?}", found.image);
        assert_eq!(cb.find_by_hash(&content_hash(&Content::Text("never copied".into()))).unwrap(), None);
        cb.delete(a.id).unwrap();
        assert_eq!(cb.find_by_hash(&content_hash(&Content::Text("on the board".into()))).unwrap(), None, "deleted from history: not current either");
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
        let r = Retention { max_entries: 3, max_age: Some(10 * DAY), ..Default::default() };
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
    fn no_age_limit_keeps_old_entries() {
        let dir = tempfile::tempdir().unwrap();
        let r = Retention::days(2, 0);
        assert_eq!(r.max_age, None, "0 days is no limit");
        assert_eq!(Retention::days(2, 7).max_age, Some(7 * DAY));
        let cb = open(dir.path(), r);
        let now = 3000 * DAY.as_secs();
        let ancient = text(&cb, "ancient", now - 2000 * DAY.as_secs());
        let fresh = text(&cb, "fresh", now);
        assert_eq!(ids(&cb.list("", None, 10, 0).unwrap()), [fresh.id, ancient.id], "age never prunes");
        text(&cb, "newer", now + 1);
        assert!(matches!(cb.get(ancient.id), Err(Error::NotFound(_))), "the count cap still does");
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

    #[test]
    fn observe_skips_a_suppressed_window_and_excluded_apps() {
        let dir = tempfile::tempdir().unwrap();
        let cb = open(dir.path(), Retention::default());
        let excluded = vec!["com.agilebits.onepassword".to_string()];
        assert!(cb.observe(Content::Text("from 1password".into()), Some("com.agilebits.onepassword".into()), &excluded).unwrap().is_none());
        suppress_watch(Duration::from_millis(80));
        assert!(suppressed());
        assert!(cb.observe(Content::Text("s3cret".into()), None, &excluded).unwrap().is_none(), "a concealed write's change is not recorded");
        std::thread::sleep(Duration::from_millis(100));
        assert!(!suppressed());
        let e = cb.observe(Content::Text("plain".into()), Some("com.apple.Safari".into()), &excluded).unwrap().unwrap();
        assert_eq!(e.text.as_deref(), Some("plain"));
        assert_eq!(cb.list("", None, 10, 0).unwrap().len(), 1, "only the plain copy is in history");
        // A longer window is never shortened by a later, shorter one.
        suppress_watch(Duration::from_millis(200));
        suppress_watch(Duration::from_millis(10));
        std::thread::sleep(Duration::from_millis(30));
        assert!(suppressed());
    }

    #[test]
    fn restore_plan_after_the_clear_delay() {
        let secret = "hunter2";
        let prev = Content::Text("before".into());
        assert_eq!(restore_plan(Some(&Content::Text(secret.into())), secret, Some(prev.clone())), Restore::Write(prev.clone()), "still the secret: the previous text comes back");
        assert_eq!(restore_plan(Some(&Content::Text(secret.into())), secret, None), Restore::Clear, "nothing preceded it: the clipboard is emptied");
        assert_eq!(restore_plan(Some(&Content::Text("something else".into())), secret, Some(prev.clone())), Restore::Leave, "the user copied meanwhile");
        assert_eq!(restore_plan(Some(&Content::Files(vec!["/tmp/a".into()])), secret, Some(prev.clone())), Restore::Leave);
        assert_eq!(restore_plan(None, secret, Some(prev)), Restore::Leave, "an empty clipboard is not the secret either");
    }

    /// Needs a real pasteboard, and leaves it as it found it:
    /// `cargo test -p pal-core -- --ignored concealed_write_live`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn concealed_write_live() {
        let previous = platform::read_any();
        let marker = format!("pal-concealed-test-{}", std::process::id());
        write_text_concealed(&marker).unwrap();
        assert!(platform::concealed(), "the ConcealedType is on the item");
        assert_eq!(platform::read(), None, "history's read skips it");
        assert_eq!(platform::read_any(), Some(Content::Text(marker.clone())), "the text is there for a paste");
        assert!(suppressed());
        // The clear-after: the previous contents come back once the delay is up.
        match &previous {
            Some(c) => platform::write(c).unwrap(),
            None => platform::clear(),
        }
        write_text_concealed_for(&marker, Duration::from_millis(300)).unwrap();
        assert_eq!(platform::read_any(), Some(Content::Text(marker.clone())));
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(platform::read_any(), previous, "restored");
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
