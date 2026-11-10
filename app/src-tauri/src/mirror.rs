//! A file that mirrors in-memory state for other processes (`bar.json`
//! for `pal bar list`, `states.json` for `pal state` and its `watch`):
//! changes inside [`Mirror`]'s delay land as one write of the latest
//! state, and a write that would not change the file is skipped.

use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

pub struct Mirror {
    name: &'static str,
    path: fn() -> PathBuf,
    build: fn(&AppHandle) -> Vec<u8>,
    delay: Duration,
    queued: AtomicBool,
    written: Mutex<Option<u64>>,
}

impl Mirror {
    pub const fn new(name: &'static str, path: fn() -> PathBuf, build: fn(&AppHandle) -> Vec<u8>, delay: Duration) -> Self {
        Self { name, path, build, delay, queued: AtomicBool::new(false), written: Mutex::new(None) }
    }

    /// Write the state as it is after the delay, once however many changes came in it.
    pub fn queue(&'static self, app: &AppHandle) {
        if self.queued.swap(true, Ordering::AcqRel) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(self.delay).await;
            self.queued.store(false, Ordering::Release);
            let bytes = (self.build)(&app);
            let _ = tauri::async_runtime::spawn_blocking(move || self.write(&bytes)).await;
        });
    }

    /// Write now (start, quit), skipping only an unchanged file.
    pub fn flush(&'static self, app: &AppHandle) {
        self.write(&(self.build)(app));
    }

    fn write(&self, bytes: &[u8]) {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        bytes.hash(&mut h);
        let hash = h.finish();
        let mut written = self.written.lock().unwrap_or_else(|e| e.into_inner());
        if *written == Some(hash) {
            return;
        }
        match pal_core::fs::write_atomic(&(self.path)(), bytes) {
            Ok(()) => *written = Some(hash),
            Err(e) => eprintln!("{}\tfeed write failed\t{e}", self.name),
        }
    }
}
