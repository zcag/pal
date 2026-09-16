//! The extension host: one long-lived Bun process speaking newline-delimited
//! JSON over stdio. Requests carry an id and get a oneshot; notifications
//! (no id) feed the index (`crate::index::on_notification`) and go to the
//! webview as `pal://host` events; an exit restarts it. The host asks back
//! the same way: a line with an id and a `core/...` method is a request for
//! a core capability (`crate::bridge`), answered on its stdin.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, watch, Mutex as AsyncMutex};

use crate::{events, lock};

pub(crate) const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
/// The sidecar's file name next to our executable (`bundle.externalBin`): not
/// `bun`, which the .deb would install as /usr/bin/bun over the user's own.
const SIDECAR: &str = "pal-bun";
/// Between a host exit and the respawn: a crash loop stays readable in
/// the log and never pegs a core.
const RESTART_DELAY: Duration = Duration::from_millis(500);
/// A hung extension must not hang a keystroke or a pick for good; long
/// enough for a `list` that shells out (`scripts` runs `gh`), and the
/// write of the request counts too, since a host that stopped reading
/// fills its pipe.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// How long `stop` waits for the host to exit on EOF before quitting
/// anyway: an extension's own shutdown (a file flush) gets this long.
const STOP_TIMEOUT: Duration = Duration::from_secs(2);

type Reply = oneshot::Sender<Result<Value, String>>;

/// Where the host and its extensions come from, decided once at start.
///
/// The bun binary is the sidecar next to our executable (tauri-build copies
/// `binaries/pal-bun-<triple>` there in dev too), else `bun` on PATH. A debug
/// build prefers PATH: tauri-build recopies the sidecar on every build and
/// macOS spends ~600 ms verifying a fresh binary on its first exec. The host
/// script and the bundled extensions are the repo's own files in a debug
/// build (so edits reload live) and the resource tree staged by
/// `scripts/build-extensions.sh` otherwise; a release binary run from the
/// repo, without that tree, falls back to the repo. Then the user's store
/// (`pal_core::extensions::Store::locate`, `<data dir>/extensions`) and
/// every `general.extension_dirs` entry, in that order, so a later root's
/// extension replaces an earlier one's by name.
#[derive(Debug)]
struct Layout {
    bun: PathBuf,
    host: PathBuf,
    roots: Vec<PathBuf>,
}

/// The bun that runs the host and installs an extension's dependencies
/// (`pal_core::extensions`): needs no app handle, so the CLI resolves it too.
pub(crate) fn bun() -> PathBuf {
    let sidecar = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join(SIDECAR)))
        .filter(|p| p.is_file());
    let on_path = std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join("bun")).find(|b| b.is_file()));
    if cfg!(debug_assertions) { on_path.or(sidecar) } else { sidecar.or(on_path) }.unwrap_or_else(|| PathBuf::from("bun"))
}

impl Layout {
    fn resolve(app: &AppHandle) -> Layout {
        let bun = bun();
        let staged = app.path().resource_dir().ok().filter(|d| d.join("host/src/host.ts").is_file());
        let base = match (cfg!(debug_assertions), staged) {
            (false, Some(dir)) => dir,
            _ => PathBuf::from(REPO),
        };
        let mut roots = vec![base.join("extensions"), pal_core::extensions::Store::locate().dir().to_path_buf()];
        roots.extend(crate::settings::config(app).general.extension_dirs());
        Layout { bun, host: base.join("host/src/host.ts"), roots }
    }
}

pub struct Host {
    app: AppHandle,
    next_id: AtomicU64,
    stdin: AsyncMutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, Reply>>,
    /// Last spawn, the origin of the timing lines.
    started: Mutex<Instant>,
    /// Set by `stop`: the loop in `start` then ends instead of respawning.
    stopping: AtomicBool,
    /// Whether a host process is up; `stop` waits for it to go down.
    alive: watch::Sender<bool>,
}

impl Host {
    pub fn start(app: &AppHandle) {
        let host = Arc::new(Host {
            app: app.clone(),
            next_id: AtomicU64::new(1),
            stdin: AsyncMutex::new(None),
            pending: Mutex::new(HashMap::new()),
            started: Mutex::new(Instant::now()),
            stopping: AtomicBool::new(false),
            alive: watch::Sender::new(false),
        });
        app.manage(host.clone());
        tauri::async_runtime::spawn(async move {
            loop {
                match host.run_once().await {
                    Ok(status) => eprintln!("host\texit\t{status}"),
                    Err(e) => eprintln!("host\tspawn failed\t{e}"),
                }
                host.fail_pending("host exited");
                events::emit(&host.app, events::HOST, json!({ "method": "host/exit" }));
                if host.stopping.load(Ordering::SeqCst) {
                    return;
                }
                tokio::time::sleep(RESTART_DELAY).await;
            }
        });
    }

    pub fn uptime_ms(&self) -> f64 {
        lock(&self.started).elapsed().as_secs_f64() * 1000.0
    }

    /// Spawns the host and pumps its stdout until it exits.
    async fn run_once(self: &Arc<Self>) -> std::io::Result<std::process::ExitStatus> {
        let t0 = Instant::now();
        *lock(&self.started) = t0;
        let layout = Layout::resolve(&self.app);
        eprintln!("host\tspawn\t{} {} {}\t{:.1}ms since start", layout.bun.display(), layout.host.display(), layout.roots.iter().map(|r| r.display().to_string()).collect::<Vec<_>>().join(" "), crate::since_start_ms());
        // Without --no-install Bun fetches any unresolved bare import from npm
        // at load time; an extension's typo would pull arbitrary code.
        let mut child = Command::new(&layout.bun)
            .arg("run")
            .arg("--no-install")
            .arg(&layout.host)
            .args(&layout.roots)
            .current_dir(layout.host.parent().unwrap_or(Path::new("/")))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        // A `stop` that landed while spawning: drop the stdin now (EOF at
        // once) instead of installing it after `stop` cleared the slot, or
        // `stop` waits its whole timeout for an EOF that never comes.
        let stdin = child.stdin.take().filter(|_| !self.stopping.load(Ordering::SeqCst));
        *self.stdin.lock().await = stdin;
        self.alive.send_replace(true);
        let mut lines = BufReader::new(child.stdout.take().expect("stdout is piped")).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(mut msg) = serde_json::from_str::<Value>(&line) else { continue };
            // With a method it is the host speaking (a request when it has an
            // id, a notification otherwise); without one, a reply to ours.
            // The payload is moved out, not cloned: a listing is megabytes.
            let (id, method) = (msg.get("id").and_then(Value::as_u64), msg.get("method").and_then(Value::as_str).map(str::to_string));
            match (id, method) {
                (Some(id), Some(method)) => self.serve(id, method, msg["params"].take()),
                (Some(id), None) => {
                    let reply = lock(&self.pending).remove(&id);
                    if let Some(tx) = reply {
                        let _ = tx.send(match msg.get("error") {
                            Some(e) => Err(e.as_str().unwrap_or("error").to_string()),
                            None => Ok(msg["result"].take()),
                        });
                    }
                }
                (None, Some(method)) => {
                    if method == "host/ready" {
                        eprintln!("host\tready\t{:.1}ms\t{:.1}ms since start", t0.elapsed().as_secs_f64() * 1000.0, crate::since_start_ms());
                    }
                    crate::index::on_notification(&self.app, self, &method, &msg["params"]);
                    events::emit(&self.app, events::HOST, msg);
                }
                (None, None) => {}
            }
        }
        *self.stdin.lock().await = None;
        let status = child.wait().await;
        self.alive.send_replace(false);
        status
    }

    /// A host request for a core capability: runs off this task (the reader
    /// must keep draining stdout) and writes the reply back.
    fn serve(self: &Arc<Self>, id: u64, method: String, params: Value) {
        let host = self.clone();
        tauri::async_runtime::spawn(async move {
            let t0 = Instant::now();
            let app = host.app.clone();
            let m = method.clone();
            let r = tauri::async_runtime::spawn_blocking(move || crate::bridge::call(&app, &m, params))
                .await
                .unwrap_or_else(|e| Err(format!("core handler panicked: {e}")));
            eprintln!("core\t{method}\t{:.2}ms{}", t0.elapsed().as_secs_f64() * 1000.0, r.as_ref().err().map(|e| format!("\t{e}")).unwrap_or_default());
            let reply = match r {
                Ok(result) => json!({ "id": id, "result": result }),
                Err(error) => json!({ "id": id, "error": error }),
            };
            if let Err(e) = host.write_line(&reply).await {
                eprintln!("core\t{method}\treply failed\t{e}");
            }
        });
    }

    async fn write_line(&self, msg: &Value) -> Result<(), String> {
        let line = format!("{msg}\n");
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or("host not running")?;
        stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())
    }

    fn fail_pending(&self, why: &str) {
        for (_, tx) in lock(&self.pending).drain() {
            let _ = tx.send(Err(why.to_string()));
        }
    }

    /// A notification to the host: no id, no reply (`settings/changed`).
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write_line(&json!({ "method": method, "params": params })).await
    }

    /// Ends the running host: closing its stdin is its exit signal, and the
    /// loop in `start` spawns a fresh one after `RESTART_DELAY`.
    pub async fn restart(&self) {
        *self.stdin.lock().await = None;
    }

    /// Ends the host for good (quit): EOF on its stdin, no respawn, and
    /// waits up to [`STOP_TIMEOUT`] for it to exit so its own shutdown (an
    /// extension flushing a file) is not cut short by ours.
    pub async fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        *self.stdin.lock().await = None;
        let mut alive = self.alive.subscribe();
        let t0 = Instant::now();
        let down = tokio::time::timeout(STOP_TIMEOUT, alive.wait_for(|up| !up)).await.is_ok();
        if down {
            eprintln!("host\tstopped\t{:.1}ms", t0.elapsed().as_secs_f64() * 1000.0);
        } else {
            eprintln!("host\tstop timed out\tafter {STOP_TIMEOUT:?}; exiting anyway");
        }
    }

    /// One request, its reply or the first of: a write that fails (host
    /// down), the host exiting (`fail_pending`), [`REQUEST_TIMEOUT`].
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        lock(&self.pending).insert(id, tx);
        let exchange = async {
            self.write_line(&json!({ "id": id, "method": method, "params": params })).await?;
            rx.await.unwrap_or_else(|_| Err("host dropped request".into()))
        };
        let r = tokio::time::timeout(REQUEST_TIMEOUT, exchange).await.unwrap_or_else(|_| Err(format!("host timed out on {method}")));
        if r.is_err() {
            lock(&self.pending).remove(&id);
        }
        r
    }
}

#[tauri::command]
pub async fn host_request(
    host: tauri::State<'_, Arc<Host>>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let t0 = Instant::now();
    let r = host.request(&method, params.unwrap_or(Value::Null)).await;
    eprintln!("host\t{method}\t{:.2}ms{}", t0.elapsed().as_secs_f64() * 1000.0, r.as_ref().err().map(|e| format!("\t{e}")).unwrap_or_default());
    r
}

