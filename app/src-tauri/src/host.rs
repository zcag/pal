//! The extension host: one long-lived Bun process speaking newline-delimited
//! JSON over stdio. Requests carry an id and get a oneshot; notifications
//! (no id) feed the index (`crate::index::on_notification`) and go to the
//! webview as `pal://host` events; an exit restarts it. The host asks back
//! the same way: a line with an id and a `core/...` method is a request for
//! a core capability (`crate::bridge`), answered on its stdin.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
const RESTART_DELAY: Duration = Duration::from_millis(500);
/// A hung extension must not hang a keystroke or a pick for good.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

type Reply = oneshot::Sender<Result<Value, String>>;

pub struct Host {
    app: AppHandle,
    next_id: AtomicU64,
    stdin: AsyncMutex<Option<ChildStdin>>,
    pending: Mutex<HashMap<u64, Reply>>,
    /// Last spawn, the origin of the timing lines.
    started: Mutex<Instant>,
}

impl Host {
    pub fn start(app: &AppHandle) {
        let host = Arc::new(Host {
            app: app.clone(),
            next_id: AtomicU64::new(1),
            stdin: AsyncMutex::new(None),
            pending: Mutex::new(HashMap::new()),
            started: Mutex::new(Instant::now()),
        });
        app.manage(host.clone());
        tauri::async_runtime::spawn(async move {
            loop {
                match host.run_once().await {
                    Ok(status) => eprintln!("host\texit\t{status}"),
                    Err(e) => eprintln!("host\tspawn failed\t{e}"),
                }
                host.fail_pending("host exited");
                let _ = host.app.emit("pal://host", json!({ "method": "host/exit" }));
                tokio::time::sleep(RESTART_DELAY).await;
            }
        });
    }

    pub fn uptime_ms(&self) -> f64 {
        self.started.lock().unwrap().elapsed().as_secs_f64() * 1000.0
    }

    /// Spawns the host and pumps its stdout until it exits.
    async fn run_once(self: &Arc<Self>) -> std::io::Result<std::process::ExitStatus> {
        let t0 = Instant::now();
        *self.started.lock().unwrap() = t0;
        let mut child = Command::new("bun")
            .args(["run", "host/src/host.ts"])
            .current_dir(REPO)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;
        *self.stdin.lock().await = child.stdin.take();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut hello_timed = false;
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            // With a method it is the host speaking (a request when it has an
            // id, a notification otherwise); without one, a reply to ours.
            match (msg.get("id").and_then(Value::as_u64), msg.get("method").and_then(Value::as_str)) {
                (Some(id), Some(method)) => self.serve(id, method.to_string(), msg["params"].clone()),
                (Some(id), None) => {
                    let reply = self.pending.lock().unwrap().remove(&id);
                    if let Some(tx) = reply {
                        let _ = tx.send(match msg.get("error") {
                            Some(e) => Err(e.as_str().unwrap_or("error").to_string()),
                            None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                        });
                    }
                }
                (None, Some(method)) => {
                    if !hello_timed && method == "host/ready" {
                        hello_timed = true;
                        eprintln!("host\tready\t{:.1}ms", t0.elapsed().as_secs_f64() * 1000.0);
                    }
                    crate::index::on_notification(&self.app, self, method, &msg["params"]);
                    let _ = self.app.emit("pal://host", msg);
                }
                (None, None) => {}
            }
        }
        *self.stdin.lock().await = None;
        child.wait().await
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
            let _ = host.write_line(&reply).await;
        });
    }

    async fn write_line(&self, msg: &Value) -> Result<(), String> {
        let line = format!("{msg}\n");
        let mut stdin = self.stdin.lock().await;
        let stdin = stdin.as_mut().ok_or("host not running")?;
        stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())
    }

    fn fail_pending(&self, why: &str) {
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(Err(why.to_string()));
        }
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(e) = self.write_line(&json!({ "id": id, "method": method, "params": params })).await {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(r) => r.unwrap_or_else(|_| Err("host dropped request".into())),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("host timed out on {method}"))
            }
        }
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
    eprintln!("host\t{method}\t{:.2}ms", t0.elapsed().as_secs_f64() * 1000.0);
    r
}

