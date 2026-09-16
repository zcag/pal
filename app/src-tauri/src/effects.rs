//! The effects a pick envelope asks the shell for (`Effect` in
//! host/protocol.ts): what needs the OS runs here, the rest (hide, toast,
//! keep) is the webview's. Returns the envelope the webview should see:
//! usually the one given, a toast instead when a paste or a window focus
//! needs the Accessibility permission pal does not have.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{clipboard, panel};

/// The toast to show instead of an effect that reaches into another app
/// (paste, window focus) when pal lacks Accessibility; the system prompt is
/// shown once per run. `None` when the effect can go ahead.
fn accessibility_blocked(what: &str) -> Option<Value> {
    static ASKED: AtomicBool = AtomicBool::new(false);
    if pal_core::ax::trusted() {
        return None;
    }
    if !ASKED.swap(true, Ordering::Relaxed) {
        pal_core::ax::request();
    }
    Some(json!({ "toast": { "title": format!("{what} needs Accessibility"), "message": "Grant pal in System Settings > Privacy & Security > Accessibility", "style": "failure" } }))
}

/// Hide the panel and wait for its orderOut to hand key focus back to the
/// app in front, so what follows (a keystroke, an activate) lands there.
async fn hide_first(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || panel::hide(&handle)).map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(80)).await;
    Ok(())
}

pub async fn apply(app: &AppHandle, envelope: Value) -> Result<Value, String> {
    if let Some(text) = envelope.get("copy").and_then(Value::as_str) {
        clipboard::copy_text(text).map_err(|e| format!("copy failed: {e}"))?;
    }
    if let Some(target) = envelope.get("open").and_then(Value::as_str) {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(target).spawn().map_err(|e| format!("open failed: {e}"))?;
    }
    if let Some(what) = envelope.get("paste") {
        let what: clipboard::Paste = serde_json::from_value(what.clone()).map_err(|e| format!("bad paste effect: {e}"))?;
        // Checked before hiding: the toast needs the panel.
        if let Some(toast) = accessibility_blocked("Paste") {
            return Ok(toast);
        }
        hide_first(app).await?;
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || clipboard::paste(&handle, what)).await.map_err(|e| e.to_string())??;
    }
    if let Some(id) = envelope.get("focus").and_then(Value::as_str) {
        // Without the permission the core could still activate the app,
        // but not the window asked for: ask for it instead of half-doing it.
        if let Some(toast) = accessibility_blocked("Window switching") {
            return Ok(toast);
        }
        hide_first(app).await?;
        let id = id.to_string();
        tauri::async_runtime::spawn_blocking(move || pal_core::windows::focus(&id).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())??;
    }
    Ok(envelope)
}
