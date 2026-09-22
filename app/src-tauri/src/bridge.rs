//! Core capabilities the extension host calls back into (`core.call` in
//! host/src/bridge.ts): `core/<capability>.<fn>` routes to the capability's
//! `call`. Runs on a blocking thread (`host::serve`), never on the host's
//! reader. The methods, with `api.ts` as the caller:
//!
//! - `core/apps.{for_file, open_with}` (apps.rs)
//! - `core/audio.{devices, set_default, set_volume, set_mute}` (audio.rs)
//! - `core/bar.{update, refresh}` (bar/mod.rs)
//! - `core/bluetooth.{devices, connect, disconnect}` (bluetooth.rs)
//! - `core/clipboard.{list, get, pin, rename, delete, clear, copy, current}` (clipboard.rs)
//! - `core/color.sample` (color.rs)
//! - `core/effects.run` (effects.rs)
//! - `core/extensions.{list, install, update, remove}` (extensions.rs: the store palette)
//! - `core/media.{now_playing, control, artwork}` (media.rs)
//! - `core/ocr.{image {path | data}, available}` (ocr.rs)
//! - `core/keycast.{status, start {mode?}, stop, toggle {mode?}}` (keycast.rs)
//! - `core/selection.{text,files}` (selection.rs)
//! - `core/menubar.{items, press {pid, id}}` (menubar.rs)
//! - `core/permissions.{status, request {which}}` (permissions.rs)
//! - `core/settings.{get {extension, manifest}, set {extension, palette?, values}}` (settings.rs)
//! - `core/instances.get {extension}` (settings.rs: the configured instances of a `multi` extension)
//! - `core/states.{get, set, list, eval, manual, reset, declare, undeclare}` (states.rs)
//! - `core/storage.{get, set, remove, keys}` (storage.rs)
//! - `core/system.{commands, run}` (system.rs)
//! - `core/wifi.{status, known, scan, join, forget, password, set_power}` (wifi.rs)
//! - `core/windows.{list, close, minimize, unminimize, fullscreen, frame, set_frame, displays, focused, layout}` (windows.rs)
//! - `core/calendar.{permission, request, open_settings, calendars, events, create, delete, open}` (calendar.rs)
//! - `core/view.update {extension, palette | bar, id?, spec}` (views.rs)

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
        "audio" => crate::audio::call(app, func, params),
        "bar" => crate::bar::call(app, func, params),
        "bluetooth" => crate::bluetooth::call(app, func, params),
        "clipboard" => crate::clipboard::call(app, func, params),
        "color" => crate::color::call(app, func, params),
        "dialog" => crate::dialog::call(app, func, params),
        "effects" => crate::effects::call(app, func, params),
        "extensions" => extensions::call(app, func, params),
        "media" => crate::media::call(app, func, params),
        "menubar" => menubar::call(app, func, params),
        "permissions" => crate::permissions::call(app, func, params),
        "settings" => crate::settings::call(app, func, params),
        "instances" => crate::settings::instances(app, func, params),
        "states" => crate::states::call(app, func, params),
        "storage" => crate::storage::call(app, func, params),
        "system" => crate::system::call(app, func, params),
        "wifi" => crate::wifi::call(app, func, params),
        "ocr" => crate::ocr::call(app, func, params),
        "keycast" => crate::keycast::call(app, func, params),
        "selection" => crate::selection::call(app, func, params),
        "windows" => crate::windows::call(app, func, params),
        "calendar" => calendar::call(app, func, params),
        "view" => crate::views::call(app, func, params),
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
        assert_eq!(route("core/settings.set"), Ok(("settings", "set")));
        assert_eq!(route("core/instances.get"), Ok(("instances", "get")));
        assert_eq!(route("core/bar.update"), Ok(("bar", "update")));
        assert_eq!(route("core/view.update"), Ok(("view", "update")));
        assert_eq!(route("core/wifi.set_power"), Ok(("wifi", "set_power")));
        assert_eq!(route("core/calendar.events"), Ok(("calendar", "events")));
        assert_eq!(route("core/ocr.image"), Ok(("ocr", "image")));
        assert_eq!(route("core/keycast.toggle"), Ok(("keycast", "toggle")));
        assert_eq!(route("core/dialog.current"), Ok(("dialog", "current")));
        assert_eq!(route("core/selection.text"), Ok(("selection", "text")));
        assert_eq!(route("core/menubar.press"), Ok(("menubar", "press")));
        assert_eq!(route("core/color.sample"), Ok(("color", "sample")));
        assert_eq!(route("core/effects.run"), Ok(("effects", "run")));
        assert_eq!(route("core/extensions.list"), Ok(("extensions", "list")));
        assert_eq!(route("core/permissions.request"), Ok(("permissions", "request")));
        assert!(route("list").is_err());
        assert!(route("core/list").is_err(), "no capability");
        assert!(route("core/.list").is_err());
        assert!(route("core/clipboard.").is_err());
    }
}

// Declared here rather than in lib.rs's module list (another agent's file
// this round): the calendar capability is reached through this router only.
#[path = "calendar.rs"]
mod calendar;
#[path = "menubar.rs"]
mod menubar;
#[path = "extensions.rs"]
mod extensions;
