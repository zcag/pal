//! The effects a pick envelope asks the shell for (`Effect` in
//! host/protocol.ts): what needs the OS runs here, the rest (hide, toast,
//! keep) is the webview's. Returns the envelope the webview should see:
//! usually the one given, a toast instead when a paste needs the
//! Accessibility permission pal does not have (the first refusal per run
//! also asks: the system prompt and the System Settings pane,
//! `permissions::request_once`). Feedback after the panel
//! hides is the HUD's (hud.rs): "Copied" after a `copy` that hides, an
//! extension's own `hud` text, and the once-per-run note when a `focus`
//! could only bring the app forward.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{clipboard, hud, panel, permissions};

/// After `panel::hide`, before a keystroke or an activate: the orderOut
/// has to reach the window server and the app in front has to become key
/// again, a few frames; short enough not to read as lag after Enter.
const HIDE_SETTLE: Duration = Duration::from_millis(80);

/// The toast to show instead of an effect that reaches into another app
/// (paste) when pal lacks Accessibility; the ask (prompt and pane) happens
/// once per run. `None` when the effect can go ahead.
fn accessibility_blocked(app: &AppHandle, what: &str) -> Option<Value> {
    if pal_core::ax::trusted() {
        return None;
    }
    permissions::request_once(app, "accessibility");
    Some(accessibility_toast(what))
}

/// What the HUD says after a `focus`: nothing with Accessibility (the
/// window coming up is the feedback), and without it, once per run, which
/// app came forward and why only the app. A toast cannot carry this: the
/// activation makes the panel resign key, which hides it (panel/macos.rs).
fn focus_feedback(trusted: bool, first: bool, app: &str) -> Option<String> {
    (!trusted && first).then(|| format!("Switched to {app}; per-window switching needs Accessibility"))
}

/// Whether the webview keeps the panel up for this envelope (`staysOpen`
/// in app/src/items.ts): the HUD is for what hides.
fn stays_open(envelope: &Value) -> bool {
    ["keep", "toast", "push", "show", "view"].iter().any(|k| envelope.get(k).is_some())
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
        // A paste is the target app's feedback; a toast or a kept panel is its own.
        if envelope.get("paste").is_none() && envelope.get("hud").is_none() && !stays_open(&envelope) {
            hud::show(app, "Copied");
        }
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
        if let Some(toast) = accessibility_blocked(app, "Paste") {
            return Ok(toast);
        }
        hide_first(app).await?;
        let handle = app.clone();
        blocking(move || clipboard::paste(&handle, what)).await?;
    }
    if let Some(id) = envelope.get("focus").and_then(Value::as_str) {
        static HINTED: AtomicBool = AtomicBool::new(false);
        let trusted = pal_core::ax::trusted();
        hide_first(app).await?;
        let id = id.to_string();
        if trusted {
            blocking(move || pal_core::windows::focus(&id).map_err(|e| e.to_string())).await?;
        } else {
            // Without the permission the core can still bring the app
            // forward, just not the window asked for: do that, say so once,
            // and ask once.
            let name = blocking(move || pal_core::windows::activate(&id).map_err(|e| e.to_string())).await?;
            if let Some(text) = focus_feedback(trusted, !HINTED.swap(true, Ordering::Relaxed), &name) {
                hud::show(app, &text);
            }
            permissions::request_once(app, "accessibility");
        }
    }
    if let Some(text) = envelope.get("hud").and_then(Value::as_str) {
        hud::show(app, text);
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

    #[test]
    fn focus_feedback_names_the_app_once_and_only_without_accessibility() {
        assert_eq!(focus_feedback(true, true, "Safari"), None, "with the permission the window itself is the feedback");
        assert_eq!(focus_feedback(true, false, "Safari"), None);
        assert_eq!(focus_feedback(false, true, "Safari").as_deref(), Some("Switched to Safari; per-window switching needs Accessibility"));
        assert_eq!(focus_feedback(false, false, "Safari"), None, "the reason is said once per run");
    }

    #[test]
    fn hud_after_copy_only_when_the_panel_hides() {
        for open in [json!({ "copy": "x", "keep": true }), json!({ "copy": "x", "toast": { "title": "t" } }), json!({ "copy": "x", "push": {} }), json!({ "copy": "x", "show": {} }), json!({ "view": { "tree": {} } })] {
            assert!(stays_open(&open), "{open}");
        }
        assert!(!stays_open(&json!({ "copy": "x" })));
        assert!(!stays_open(&json!({ "copy": "x", "hud": "Saved" })), "an extension's own text replaces Copied, the panel still hides");
    }
}
