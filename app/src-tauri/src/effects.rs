//! The effects a pick envelope asks the shell for (`Effect` in
//! host/protocol.ts): what needs the OS runs here, the rest (hide, toast,
//! keep) is the webview's.

use serde_json::Value;

pub fn apply(envelope: &Value) -> Result<(), String> {
    if let Some(text) = envelope.get("copy").and_then(Value::as_str) {
        arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| format!("copy failed: {e}"))?;
    }
    if let Some(target) = envelope.get("open").and_then(Value::as_str) {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(target).spawn().map_err(|e| format!("open failed: {e}"))?;
    }
    Ok(())
}
