//! Core capabilities the extension host calls back into (`core.call` in
//! host/src/bridge.ts): `core/<capability>.<fn>` routes to the capability's
//! `call`. Runs on a blocking thread (`host::serve`), never on the host's
//! reader. The methods, with `api.ts` as the caller:
//!
//! - `core/apps.{for_file, open_with}` (apps.rs)
//! - `core/clipboard.{list, get, pin, delete, clear, copy}` (clipboard.rs)
//! - `core/settings.get {extension, manifest}` (settings.rs)
//! - `core/storage.{get, set, remove, keys}` (storage.rs)
//! - `core/system.{commands, run}` (system.rs)
//! - `core/windows.{list, close, minimize, frame, set_frame, displays, focused, layout}` (windows.rs)

use serde_json::Value;
use tauri::AppHandle;

const PREFIX: &str = "core/";

/// `core/<capability>.<fn>` into its two names.
fn route(method: &str) -> Result<(&str, &str), String> {
    method.strip_prefix(PREFIX).and_then(|m| m.split_once('.')).filter(|(c, f)| !c.is_empty() && !f.is_empty()).ok_or_else(|| format!("not a core method: {method}"))
}

pub fn call(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let (capability, func) = route(method)?;
    match capability {
        "apps" => crate::apps::call(app, func, params),
        "clipboard" => crate::clipboard::call(app, func, params),
        "settings" => crate::settings::call(app, func, params),
        "storage" => crate::storage::call(app, func, params),
        "system" => crate::system::call(app, func, params),
        "windows" => crate::windows::call(app, func, params),
        _ => Err(format!("unknown capability {capability}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_core_methods_only() {
        assert_eq!(route("core/clipboard.list"), Ok(("clipboard", "list")));
        assert_eq!(route("core/apps.for_file"), Ok(("apps", "for_file")));
        assert_eq!(route("core/settings.get"), Ok(("settings", "get")));
        assert!(route("list").is_err());
        assert!(route("core/list").is_err(), "no capability");
        assert!(route("core/.list").is_err());
        assert!(route("core/clipboard.").is_err());
    }
}
