//! The extension host: one long-lived Bun process speaking newline-delimited
//! JSON over stdio. Requests carry an id and get a oneshot; notifications
//! (no id) feed the index (`crate::index::on_notification`) and go to the
//! webview as `pal://host` events; an exit restarts it.

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
            match msg.get("id").and_then(Value::as_u64) {
                Some(id) => {
                    let reply = self.pending.lock().unwrap().remove(&id);
                    if let Some(tx) = reply {
                        let _ = tx.send(match msg.get("error") {
                            Some(e) => Err(e.as_str().unwrap_or("error").to_string()),
                            None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                        });
                    }
                }
                None => {
                    let method = msg["method"].as_str().unwrap_or_default();
                    if !hello_timed && method == "host/ready" {
                        hello_timed = true;
                        eprintln!("host\tready\t{:.1}ms", t0.elapsed().as_secs_f64() * 1000.0);
                    }
                    crate::index::on_notification(&self.app, self, method, &msg["params"]);
                    let _ = self.app.emit("pal://host", msg);
                }
            }
        }
        *self.stdin.lock().await = None;
        child.wait().await
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
        let line = format!("{}\n", json!({ "id": id, "method": method, "params": params }));
        {
            let mut stdin = self.stdin.lock().await;
            let Some(stdin) = stdin.as_mut() else {
                self.pending.lock().unwrap().remove(&id);
                return Err("host not running".into());
            };
            if let Err(e) = stdin.write_all(line.as_bytes()).await {
                self.pending.lock().unwrap().remove(&id);
                return Err(e.to_string());
            }
        }
        rx.await.unwrap_or_else(|_| Err("host dropped request".into()))
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

