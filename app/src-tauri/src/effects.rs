//! The effects a pick envelope asks the shell for (`Effect` in
//! host/protocol.ts): what needs the OS runs here, the rest (hide, toast,
//! keep) is the webview's. Returns the envelope the webview should see:
//! usually the one given, a toast instead when a paste cannot be delivered.

use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;

use crate::{clipboard, panel};

pub async fn apply(app: &AppHandle, envelope: Value) -> Result<Value, String> {
    if let Some(text) = envelope.get("copy").and_then(Value::as_str) {
        arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| format!("copy failed: {e}"))?;
    }
    if let Some(target) = envelope.get("open").and_then(Value::as_str) {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(target).spawn().map_err(|e| format!("open failed: {e}"))?;
    }
    if let Some(what) = envelope.get("paste") {
        let what: clipboard::Paste = serde_json::from_value(what.clone()).map_err(|e| format!("bad paste effect: {e}"))?;
        // Checked before hiding: the toast needs the panel.
        if let Some(toast) = clipboard::paste_blocked() {
            return Ok(toast);
        }
        // The panel's orderOut hands key focus back to the app in front; the
        // keystroke goes there once that has happened.
        let handle = app.clone();
        app.run_on_main_thread(move || panel::hide(&handle)).map_err(|e| e.to_string())?;
        tokio::time::sleep(Duration::from_millis(80)).await;
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || clipboard::paste(&handle, what)).await.map_err(|e| e.to_string())??;
    }
    Ok(envelope)
}
