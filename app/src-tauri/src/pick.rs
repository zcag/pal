//! `pal pick`: the panel as a picker for a shell script (rofi's `-dmenu`,
//! fzf in pal's clothes). The CLI process reads the rows on stdin (one per
//! line, or one JSON object `{ id, name, subtitle?, icon? }` per line),
//! listens on a unix socket of its own (`/tmp/pal-pick-<pid>.sock`), hands
//! `pick --reply <socket> ...` to the running instance over the
//! single-instance channel like every other subcommand (cli.rs), and waits.
//! The instance connects, reads the rows as one JSON line, shows the panel
//! with a picker level over them (`pal://pick` to the page), and writes the
//! answer as one JSON line: `{ "ids": [...] }` for a pick, `{ "cancel":
//! true }` for Escape or the panel hiding. The CLI prints the ids one per
//! line (the lines themselves, for line input) and exits 0, or 1 on a
//! cancel; a dead CLI (SIGINT: exit 130, its socket unlinked first) is EOF
//! on the socket, and the instance drops the level and hides. This is the
//! one reply channel over the single-instance handover, which itself
//! carries nothing back (docs/design/links.md).
//!
//! `--select <id>` answers with that id from the instance without showing
//! the panel: the plumbing verified from a terminal, no keypress needed.
//! One picker at a time: a new one cancels the pending one.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{events, lock};

/// One row as the CLI sends it and the page draws it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Row {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    /// A glyph, emoji, hex colour or app path, as `Item.icon` takes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Value>,
}

/// What the CLI asked for, carried to the instance as flags.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Options {
    pub title: Option<String>,
    pub multi: bool,
    pub query: Option<String>,
    pub select: Option<String>,
}

/// The rows frame, CLI to instance.
#[derive(Serialize, Deserialize)]
struct Rows {
    rows: Vec<Row>,
}

/// The reply frame, instance to CLI.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Reply {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    cancel: bool,
}

/// `pal pick`'s exit statuses: a pick, Escape, no instance or bad input, SIGINT.
pub const EXIT_PICKED: i32 = 0;
pub const EXIT_CANCELLED: i32 = 1;
pub const EXIT_ERROR: i32 = 2;
pub const EXIT_INTERRUPTED: i32 = 130;

// ---- the rows ------------------------------------------------------------

/// The rows from stdin's text: a line that is a JSON object with `id` (and
/// `name`, else the id) is one row as given; any other non-empty line is a
/// row whose id and name are the line. A repeated id keeps the first.
pub fn parse_rows(text: &str) -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let row = if line.trim_start().starts_with('{') {
            match serde_json::from_str::<Value>(line) {
                Ok(Value::Object(o)) if o.get("id").and_then(Value::as_str).is_some() => {
                    let id = o["id"].as_str().unwrap_or_default().to_string();
                    Row {
                        name: o.get("name").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| id.clone()),
                        id,
                        subtitle: o.get("subtitle").and_then(Value::as_str).map(str::to_string),
                        icon: o.get("icon").cloned().filter(|v| !v.is_null()),
                    }
                }
                _ => Row { id: line.to_string(), name: line.to_string(), subtitle: None, icon: None },
            }
        } else {
            Row { id: line.to_string(), name: line.to_string(), subtitle: None, icon: None }
        };
        if !rows.iter().any(|r| r.id == row.id) {
            rows.push(row);
        }
    }
    rows
}

/// The socket a CLI process listens on for its answer.
pub fn socket_path(pid: u32) -> PathBuf {
    std::env::temp_dir().join(format!("pal-pick-{pid}.sock"))
}

/// The argv handed to the instance: the flags as given plus the socket.
pub fn handover_args(opts: &Options, socket: &Path) -> Vec<String> {
    let mut a = vec!["pick".to_string(), "--reply".to_string(), socket.to_string_lossy().into_owned()];
    if let Some(t) = &opts.title {
        a.extend(["--title".to_string(), t.clone()]);
    }
    if opts.multi {
        a.push("--multi".to_string());
    }
    if let Some(q) = &opts.query {
        a.extend(["--query".to_string(), q.clone()]);
    }
    if let Some(s) = &opts.select {
        a.extend(["--select".to_string(), s.clone()]);
    }
    a
}

/// What the CLI prints and exits with for a reply line.
pub fn outcome(reply: &str) -> (Vec<String>, i32) {
    match serde_json::from_str::<Reply>(reply) {
        Ok(Reply { ids: Some(ids), .. }) if !ids.is_empty() => (ids, EXIT_PICKED),
        Ok(_) => (vec![], EXIT_CANCELLED),
        Err(_) => (vec![], EXIT_ERROR),
    }
}

// ---- the CLI process -----------------------------------------------------

/// The socket to unlink on SIGINT, as C bytes, set before the handler is
/// installed: the handler only reads it (no lock in a signal handler).
static SOCKET: std::sync::OnceLock<std::ffi::CString> = std::sync::OnceLock::new();

extern "C" fn on_sigint(_: libc::c_int) {
    // SAFETY: async-signal-safe calls only (unlink, _exit) on bytes set before the handler went in.
    unsafe {
        if let Some(c) = SOCKET.get() {
            libc::unlink(c.as_ptr());
        }
        libc::_exit(EXIT_INTERRUPTED);
    }
}

/// `pal pick` in the CLI process: rows from stdin, the socket, the
/// handover, the wait, the print. Returns the exit status.
pub fn client(opts: Options, identifier: &str) -> i32 {
    let mut text = String::new();
    if std::io::stdin().read_to_string(&mut text).is_err() {
        eprintln!("pal\tcould not read stdin");
        return EXIT_ERROR;
    }
    let rows = parse_rows(&text);
    if rows.is_empty() {
        eprintln!("pal\tnothing to pick from: give rows on stdin");
        return EXIT_ERROR;
    }
    let path = socket_path(std::process::id());
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("pal\tcould not listen on {}: {e}", path.display());
            return EXIT_ERROR;
        }
    };
    if let Ok(c) = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()) {
        let _ = SOCKET.set(c);
        // SAFETY: installing a plain C handler for SIGINT; `on_sigint` only unlinks and exits.
        unsafe { libc::signal(libc::SIGINT, on_sigint as *const () as libc::sighandler_t) };
    }
    if !crate::cli::handover_args(identifier, &handover_args(&opts, &path).iter().map(String::as_str).collect::<Vec<_>>()) {
        let _ = std::fs::remove_file(&path);
        eprintln!("pal\tnot running");
        return EXIT_ERROR;
    }
    let r = serve_client(&listener, rows);
    let _ = std::fs::remove_file(&path);
    match r {
        Ok((ids, status)) => {
            for id in ids {
                println!("{id}");
            }
            status
        }
        Err(e) => {
            eprintln!("pal\t{e}");
            EXIT_ERROR
        }
    }
}

/// One connection: the rows out, the reply in.
fn serve_client(listener: &UnixListener, rows: Vec<Row>) -> std::io::Result<(Vec<String>, i32)> {
    let (mut s, _) = listener.accept()?;
    let mut line = serde_json::to_string(&Rows { rows }).unwrap_or_default();
    line.push('\n');
    s.write_all(line.as_bytes())?;
    let mut reply = String::new();
    BufReader::new(s).read_line(&mut reply)?;
    if reply.trim().is_empty() {
        // The instance went away without answering.
        return Ok((vec![], EXIT_CANCELLED));
    }
    Ok(outcome(reply.trim()))
}

// ---- the instance --------------------------------------------------------

/// What the page is told (`pal://pick`).
#[derive(Clone, Serialize)]
struct Payload {
    token: u64,
    title: String,
    multi: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<String>,
    rows: Vec<Row>,
}

/// What ends a pending pick.
enum Answer {
    Ids(Vec<String>),
    Cancel,
    /// The CLI is gone (EOF): nothing to answer, the level goes.
    Gone,
}

struct Pending {
    token: u64,
    tx: mpsc::Sender<Answer>,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static TOKENS: AtomicU64 = AtomicU64::new(1);

/// `pal://pick` (a picker level over these rows) and `pal://pick/cancel` (the level goes).
pub const EVENT: &str = "pal://pick";
pub const CANCEL_EVENT: &str = "pal://pick/cancel";

/// The instance's side of one `pal pick`: connect to the CLI's socket, read
/// the rows, show the picker, answer. Off the main thread from start to end.
pub fn serve(app: &AppHandle, socket: PathBuf, opts: Options) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = serve_one(&app, &socket, opts) {
            eprintln!("pick\t{}\tfailed\t{e}", socket.display());
        }
    });
}

fn serve_one(app: &AppHandle, socket: &Path, opts: Options) -> std::io::Result<()> {
    let stream = UnixStream::connect(socket)?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let rows: Rows = serde_json::from_str(&line).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, format!("bad rows: {e}")))?;
    let mut stream = stream;
    let write = |s: &mut UnixStream, r: &Reply| -> std::io::Result<()> {
        let mut l = serde_json::to_string(r).unwrap_or_default();
        l.push('\n');
        s.write_all(l.as_bytes())
    };
    if let Some(id) = opts.select {
        eprintln!("pick\t{} rows\tselected {id} without the panel", rows.rows.len());
        return write(&mut stream, &Reply { ids: Some(vec![id]), cancel: false });
    }
    let token = TOKENS.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    // A picker already up is cancelled by this one.
    if let Some(prev) = lock(&PENDING).replace(Pending { token, tx: tx.clone() }) {
        let _ = prev.tx.send(Answer::Cancel);
    }
    // The CLI dying (SIGINT) is EOF here; a second line is not part of the protocol and reads as the same.
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = reader.read_line(&mut buf);
        let _ = tx.send(Answer::Gone);
    });
    let n = rows.rows.len();
    let payload = Payload { token, title: opts.title.unwrap_or_else(|| "Pick".to_string()), multi: opts.multi, query: opts.query, rows: rows.rows };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::show_in(&handle, None);
        events::emit(&handle, EVENT, payload);
    });
    eprintln!("pick\t{n} rows\tshown\ttoken {token}");
    let answer = rx.recv().unwrap_or(Answer::Gone);
    {
        let mut p = lock(&PENDING);
        if p.as_ref().is_some_and(|p| p.token == token) {
            p.take();
        }
    }
    match answer {
        Answer::Ids(ids) => {
            eprintln!("pick\ttoken {token}\tpicked {}", ids.len());
            write(&mut stream, &Reply { ids: Some(ids), cancel: false })
        }
        Answer::Cancel => {
            eprintln!("pick\ttoken {token}\tcancelled");
            write(&mut stream, &Reply { ids: None, cancel: true })
        }
        Answer::Gone => {
            eprintln!("pick\ttoken {token}\tthe CLI went away");
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                events::emit(&handle, CANCEL_EVENT, json!({ "token": token }));
                crate::panel::hide(&handle);
            });
            Ok(())
        }
    }
}

/// The page's answer: the picked ids, or `None` for Escape.
#[tauri::command]
pub fn pick_reply(token: u64, ids: Option<Vec<String>>) {
    let mut p = lock(&PENDING);
    if let Some(pending) = p.as_ref().filter(|p| p.token == token) {
        let _ = pending.tx.send(match ids {
            Some(ids) if !ids.is_empty() => Answer::Ids(ids),
            _ => Answer::Cancel,
        });
        p.take();
    }
}

/// The panel hid (a click elsewhere, `pal hide`): a pending pick is
/// cancelled, and the page told to drop the level so the next show does
/// not land on a picker nobody is waiting on.
pub fn on_hidden(app: &AppHandle) {
    if let Some(pending) = lock(&PENDING).take() {
        let _ = pending.tx.send(Answer::Cancel);
        events::emit(app, CANCEL_EVENT, json!({ "token": pending.token }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_and_json_rows_parse_blank_lines_and_repeats_dropped() {
        let rows = parse_rows("main\n\nfeature/x\r\n{\"id\":\"3\",\"name\":\"Three\",\"subtitle\":\"iii\",\"icon\":\"3\"}\n{\"name\":\"no id\"}\nmain\n{not json\n");
        assert_eq!(rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["main", "feature/x", "3", "{\"name\":\"no id\"}", "{not json"]);
        assert_eq!(rows[2], Row { id: "3".into(), name: "Three".into(), subtitle: Some("iii".into()), icon: Some(json!("3")) });
        assert_eq!(rows[0].name, "main", "a line is its own id and name");
        assert_eq!(parse_rows("{\"id\":\"only\"}")[0].name, "only", "a JSON row without a name is named by its id");
        assert!(parse_rows("\n  \n").is_empty());
    }

    #[test]
    fn the_handover_carries_the_flags_and_the_socket() {
        let o = Options { title: Some("Branch".into()), multi: true, query: Some("fe".into()), select: None };
        assert_eq!(handover_args(&o, Path::new("/tmp/pal-pick-1.sock")), vec!["pick", "--reply", "/tmp/pal-pick-1.sock", "--title", "Branch", "--multi", "--query", "fe"]);
        assert_eq!(handover_args(&Options::default(), Path::new("/x.sock")), vec!["pick", "--reply", "/x.sock"]);
        assert!(socket_path(42).ends_with("pal-pick-42.sock"));
    }

    #[test]
    fn a_reply_is_ids_and_exit_0_or_a_cancel_and_exit_1() {
        assert_eq!(outcome("{\"ids\":[\"a\",\"b\"]}"), (vec!["a".to_string(), "b".to_string()], EXIT_PICKED));
        assert_eq!(outcome("{\"cancel\":true}"), (vec![], EXIT_CANCELLED));
        assert_eq!(outcome("{\"ids\":[]}"), (vec![], EXIT_CANCELLED), "nothing picked is a cancel");
        assert_eq!(outcome("garbage"), (vec![], EXIT_ERROR));
        assert_eq!(serde_json::to_string(&Reply { ids: None, cancel: true }).unwrap(), "{\"cancel\":true}");
    }

    /// The whole socket round trip in-process: a client listener, a "CLI" writing rows and reading the reply, this side's frames.
    #[test]
    fn rows_go_out_as_one_line_and_the_reply_comes_back_as_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pick.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let p2 = path.clone();
        let instance = std::thread::spawn(move || {
            let s = UnixStream::connect(&p2).unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            r.read_line(&mut line).unwrap();
            let rows: Rows = serde_json::from_str(&line).unwrap();
            let mut s = s;
            let mut l = serde_json::to_string(&Reply { ids: Some(vec![rows.rows[1].id.clone()]), cancel: false }).unwrap();
            l.push('\n');
            s.write_all(l.as_bytes()).unwrap();
        });
        let (ids, status) = serve_client(&listener, parse_rows("one\ntwo\n")).unwrap();
        instance.join().unwrap();
        assert_eq!((ids, status), (vec!["two".to_string()], EXIT_PICKED));
    }
}
