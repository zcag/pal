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

/// After `panel::hide`, before a keystroke or an activate: the orderOut
/// has to reach the window server and the app in front has to become key
/// again, a few frames; short enough not to read as lag after Enter.
const HIDE_SETTLE: Duration = Duration::from_millis(80);

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
    Some(accessibility_toast(what))
}

/// The toast for a `what` that needs Accessibility, as an envelope.
pub fn accessibility_toast(what: &str) -> Value {
    json!({ "toast": { "title": format!("{what} needs Accessibility"), "message": "Grant pal in System Settings > Privacy & Security > Accessibility", "style": "failure" } })
}

/// Hide the panel and wait for its orderOut to hand key focus back to the
/// app in front, so what follows (a keystroke, an activate) lands there.
async fn hide_first(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || panel::hide(&handle)).map_err(|e| e.to_string())?;
    tokio::time::sleep(HIDE_SETTLE).await;
    Ok(())
}

/// The OS calls run on blocking threads: a pasteboard write or a paste
/// keystroke must not sit on the async runtime that answers keystrokes.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

pub async fn apply(app: &AppHandle, envelope: Value) -> Result<Value, String> {
    if let Some(text) = envelope.get("copy").and_then(Value::as_str) {
        let text = text.to_string();
        blocking(move || clipboard::copy_text(&text).map_err(|e| format!("copy failed: {e}"))).await?;
    }
    if let Some(target) = envelope.get("open").and_then(Value::as_str) {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        // tokio's Command: the child is reaped when it exits, where a
        // dropped `std` Child stays a zombie until pal does.
        tokio::process::Command::new(opener).arg(target).spawn().map_err(|e| format!("open failed: {e}"))?;
    }
    if let Some(what) = envelope.get("paste") {
        let what: clipboard::Paste = serde_json::from_value(what.clone()).map_err(|e| format!("bad paste effect: {e}"))?;
        // Checked before hiding: the toast needs the panel.
        if let Some(toast) = accessibility_blocked("Paste") {
            return Ok(toast);
        }
        hide_first(app).await?;
        let handle = app.clone();
        blocking(move || clipboard::paste(&handle, what)).await?;
    }
    if let Some(id) = envelope.get("focus").and_then(Value::as_str) {
        // Without the permission the core could still activate the app,
        // but not the window asked for: ask for it instead of half-doing it.
        if let Some(toast) = accessibility_blocked("Window switching") {
            return Ok(toast);
        }
        hide_first(app).await?;
        let id = id.to_string();
        blocking(move || pal_core::windows::focus(&id).map_err(|e| e.to_string())).await?;
    }
    Ok(envelope)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accessibility_toast_is_a_failure_toast_naming_the_effect() {
        let t = accessibility_toast("Paste");
        assert_eq!(t["toast"]["title"], "Paste needs Accessibility");
        assert_eq!(t["toast"]["style"], "failure");
        assert!(t["toast"]["message"].as_str().unwrap().contains("Accessibility"));
        assert_eq!(t.as_object().unwrap().len(), 1, "a toast and nothing else: the pick's own effects are dropped");
    }
}
