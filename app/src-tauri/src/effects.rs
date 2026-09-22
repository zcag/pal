//! The effects a pick envelope asks the shell for (`Effect` in
//! sdk/src/protocol.ts): what needs the OS runs here, the rest (hide, toast,
//! keep) is the webview's. Returns the envelope the webview should see:
//! usually the one given, a permission card instead when a paste needs
//! the Accessibility permission pal does not have (the first refusal per
//! run: `permissions::ask`, the card naming the effect, Grant for the
//! system prompt; a toast saying where the switch is after that), or when a `copy_files` has no clipboard
//! to write to (Linux without X11 or wlr data-control). Feedback after the panel
//! hides is the HUD's (hud.rs): "Copied" after a `copy` or `copy_files` that hides
//! ("Copied, clears in N s" for a concealed copy with `clear_after`), an
//! extension's own `hud` text, the once-per-run note when a `focus`
//! could only bring the app forward (`windows::raise`), the layout's name (or why it
//! failed) after a `layout`, why a `space` could not come in front
//! (`windows::go_space`; nothing when it did, the desktop moving is the
//! feedback), and which panel took the path after a
//! `dialog` (the Files row's "Use in dialog": the panel hides, the path is
//! typed into the front app's open or save panel through its Go to Folder
//! sheet, `pal_core::dialog::go`).

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{clipboard, hud, large, panel, permissions, windows};

/// After `panel::hide`, before a keystroke or an activate: the orderOut
/// has to reach the window server and the app in front has to become key
/// again, a few frames; short enough not to read as lag after Enter.
const HIDE_SETTLE: Duration = Duration::from_millis(80);

/// What to show instead of an effect that reaches into another app
/// (paste) when pal lacks Accessibility: the panel kept up for the card
/// (`permissions::ask`, once per run), the toast after that. `None` when
/// the effect can go ahead.
fn accessibility_blocked(app: &AppHandle, what: &str) -> Option<Value> {
    if pal_core::ax::trusted() {
        return None;
    }
    if permissions::ask(app, "accessibility", what) {
        return Some(json!({ "keep": true }));
    }
    Some(accessibility_toast(what))
}

/// Whether the webview keeps the panel up for this envelope (`staysOpen`
/// in app/src/items.ts): the HUD is for what hides.
pub fn stays_open(envelope: &Value) -> bool {
    ["keep", "toast", "push", "show", "view", "form"].iter().any(|k| envelope.get(k).is_some())
}

/// A toast as an effect envelope: the panel stays up and shows it.
pub fn toast(title: &str, message: &str, style: &str) -> Value {
    json!({ "toast": { "title": title, "message": message, "style": style } })
}

/// The toast for a `what` that needs Accessibility, as an envelope.
pub fn accessibility_toast(what: &str) -> Value {
    toast(&format!("{what} needs Accessibility"), &format!("Grant pal under {}", permissions::switch("accessibility")), "failure")
}

/// The toast when the files could not go on the clipboard (no backend on
/// Linux, a refused pasteboard write): the panel is still up, so it can
/// carry the reason.
fn copy_files_toast(err: &str) -> Value {
    toast("Could not copy the files", err, "failure")
}

/// "Copied" in the HUD after a `copy`/`copy_files` that hides the panel: a
/// paste is the target app's feedback, a toast or a kept panel its own,
/// and an extension's `hud` text replaces it.
fn copied_hud(envelope: &Value) -> bool {
    envelope.get("paste").is_none() && envelope.get("hud").is_none() && !stays_open(envelope)
}

/// The default HUD line for a `copy`: "Copied", and for a concealed copy
/// that clears itself, when.
fn copied_text(copy: &clipboard::Copy) -> String {
    match copy.clear_after() {
        Some(d) => format!("Copied, clears in {} s", d.as_secs()),
        None => "Copied".to_string(),
    }
}

/// Hide the window the pick came from (`window`: the panel, the bar
/// popover or the sidebar) and wait for its orderOut to hand key focus
/// back to the app in front, so what follows (a keystroke, an activate)
/// lands there. Harmless on a window that was not up (an item hotkey
/// fired).
async fn hide_first(app: &AppHandle, window: &str) -> Result<(), String> {
    let handle = app.clone();
    let hide: fn(&AppHandle) = match window {
        crate::bar::popover::WINDOW => crate::bar::popover::hide,
        crate::sidebar::WINDOW => crate::sidebar::hide,
        _ => panel::hide,
    };
    app.run_on_main_thread(move || hide(&handle)).map_err(|e| e.to_string())?;
    tokio::time::sleep(HIDE_SETTLE).await;
    Ok(())
}

/// What the HUD says after a `layout`: the layout's name, or the reason it
/// did not happen (the panel is down by then, so a toast cannot carry it).
fn layout_feedback(name: &str, result: &Result<pal_core::windows::Applied, String>) -> String {
    match result {
        Ok(a) => a.layout.title().to_string(),
        Err(e) => format!("{}: {e}", pal_core::windows::layout::Layout::parse(name).map_or(name, |l| l.title())),
    }
}

/// What the HUD says after a `dialog`: which app's panel took the path,
/// or why it did not happen (no panel in front, the keystrokes refused).
fn dialog_feedback(r: &Result<pal_core::dialog::Dialog, String>) -> String {
    match r {
        Ok(d) => format!("Typed into the {} panel of {}", d.kind.name(), d.app),
        Err(e) => format!("Use in dialog: {e}"),
    }
}

/// The OS calls run on blocking threads: a pasteboard write or a paste
/// keystroke must not sit on the async runtime that answers keystrokes.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// The effects for a pick from the main panel.
pub async fn apply(app: &AppHandle, envelope: Value) -> Result<Value, String> {
    apply_from(app, envelope, crate::WINDOW).await
}

/// The effects for a pick from `window` (the panel, or the bar popover):
/// whatever hides, hides that one.
pub async fn apply_from(app: &AppHandle, envelope: Value, window: &str) -> Result<Value, String> {
    if let Some(what) = envelope.get("copy") {
        let copy: clipboard::Copy = serde_json::from_value(what.clone()).map_err(|e| format!("bad copy effect: {e}"))?;
        let feedback = copied_text(&copy);
        blocking(move || clipboard::copy(copy).map_err(|e| format!("copy failed: {e}"))).await?;
        if copied_hud(&envelope) {
            hud::show(app, &feedback);
        }
    }
    if let Some(paths) = envelope.get("copy_files") {
        let paths: Vec<PathBuf> = serde_json::from_value(paths.clone()).map_err(|e| format!("bad copy_files effect: {e}"))?;
        if let Err(e) = blocking(move || clipboard::copy_files(paths)).await {
            return Ok(copy_files_toast(&e));
        }
        if copied_hud(&envelope) {
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
        hide_first(app, window).await?;
        let handle = app.clone();
        blocking(move || clipboard::paste(&handle, what)).await?;
    }
    if let Some(id) = envelope.get("focus").and_then(Value::as_str) {
        hide_first(app, window).await?;
        let (handle, id) = (app.clone(), id.to_string());
        blocking(move || windows::raise(&handle, &id)).await?;
    }
    if let Some(id) = envelope.get("space").and_then(Value::as_str) {
        hide_first(app, window).await?;
        let (handle, id) = (app.clone(), id.to_string());
        if let Err(e) = blocking(move || windows::go_space(&handle, &id)).await {
            hud::show(app, &e);
        }
    }
    if let Some(what) = envelope.get("layout") {
        let p: windows::LayoutParams = serde_json::from_value(what.clone()).map_err(|e| format!("bad layout effect: {e}"))?;
        if let Some(toast) = accessibility_blocked(app, "Window layout") {
            return Ok(toast);
        }
        // Hidden first so the focused window is the one the user was in.
        hide_first(app, window).await?;
        let (name, handle) = (p.name.clone(), app.clone());
        let r = blocking(move || windows::apply_layout(&handle, &p)).await;
        hud::show(app, &layout_feedback(&name, &r));
    }
    if let Some(path) = envelope.get("dialog").and_then(Value::as_str) {
        if let Some(toast) = accessibility_blocked(app, "Use in dialog") {
            return Ok(toast);
        }
        // Hidden first: the keystrokes go to the panel, which is key again once pal is down.
        hide_first(app, window).await?;
        let path = path.to_string();
        let r = blocking(move || pal_core::dialog::go(&path).map_err(|e| e.to_string())).await;
        hud::show(app, &dialog_feedback(&r));
    }
    if let Some(text) = envelope.get("large_type").and_then(Value::as_str) {
        // The panel goes first: the overlay takes the keyboard for its dismissal.
        hide_first(app, window).await?;
        large::show(app, text);
    }
    if let Some(text) = envelope.get("hud").and_then(Value::as_str) {
        hud::show(app, text);
    }
    Ok(envelope)
}

/// Effects a pick would answer with, but from outside one: `core/effects.run
/// { effect }` (api.ts `effects.run`), for work that finished after the pick
/// returned (a screen pick, a timer). The OS effects run as from the main
/// panel (`apply`); `push` then shows the panel inside that palette
/// (`show_in`, so the page opens it afresh); the webview's own effects
/// (`toast`, `keep`, `view`, `form`, `show`) need the level a pick came
/// from and are refused. A refusal `apply` turns into a toast (a paste
/// without Accessibility) is an error here, since there is no panel to
/// show it on.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    match func {
        "run" => {
            let envelope = params.get("effect").cloned().filter(Value::is_object).ok_or("bad params: `effect` must be an object")?;
            if let Some(k) = ["toast", "keep", "view", "form", "show"].iter().find(|k| envelope.get(**k).is_some()) {
                return Err(format!("effects.run: `{k}` needs the level a pick came from; answer it from pick"));
            }
            let push = envelope.get("push").map(|p| Ok::<_, String>(format!("{}/{}", p.get("extension").and_then(Value::as_str).ok_or("bad params: push.extension")?, p.get("palette").and_then(Value::as_str).ok_or("bad params: push.palette")?))).transpose()?;
            // The effects are async (the pasteboard writes go to blocking threads); this runs on the bridge's blocking thread, so wait for them over a channel.
            let (tx, rx) = std::sync::mpsc::channel();
            let handle = app.clone();
            tauri::async_runtime::spawn(async move { let _ = tx.send(apply(&handle, envelope).await); });
            let r = rx.recv().map_err(|_| "the effect was dropped".to_string())??;
            if let Some(t) = r.get("toast").and_then(|t| t.get("title")).and_then(Value::as_str) {
                return Err(t.to_string());
            }
            if let Some(key) = push {
                let handle = app.clone();
                app.run_on_main_thread(move || crate::show_in(&handle, Some(key))).map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        _ => Err(format!("unknown effects.{func}")),
    }
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
    fn layout_feedback_is_the_title_or_the_reason() {
        use pal_core::windows::{layout::Layout, Applied, Rect};
        let ok = Ok(Applied { id: "1".into(), layout: Layout::LeftHalf, from: Rect::default(), to: Rect::default() });
        assert_eq!(layout_feedback("left_half", &ok), "Left Half");
        assert_eq!(layout_feedback("restore", &Err("nothing to restore".into())), "Restore: nothing to restore");
        assert_eq!(layout_feedback("bogus", &Err("no layout \"bogus\"".into())), "bogus: no layout \"bogus\"", "an unknown name is shown as given");
    }

    #[test]
    fn dialog_feedback_names_the_panel_or_the_reason() {
        use pal_core::dialog::{Dialog, Kind};
        let ok = Ok(Dialog { app: "TextEdit".into(), pid: 1, kind: Kind::Open, title: None });
        assert_eq!(dialog_feedback(&ok), "Typed into the open panel of TextEdit");
        assert_eq!(dialog_feedback(&Err("no open or save panel in front".into())), "Use in dialog: no open or save panel in front");
    }

    #[test]
    fn hud_after_copy_only_when_the_panel_hides() {
        for open in [json!({ "copy": "x", "keep": true }), json!({ "copy": "x", "toast": { "title": "t" } }), json!({ "copy": "x", "push": {} }), json!({ "copy": "x", "show": {} }), json!({ "view": { "tree": {} } })] {
            assert!(stays_open(&open), "{open}");
            assert!(!copied_hud(&open), "{open}");
        }
        assert!(!stays_open(&json!({ "copy": "x" })));
        assert!(copied_hud(&json!({ "copy": "x" })));
        assert!(copied_hud(&json!({ "copy_files": ["/tmp/a"] })));
        assert!(!stays_open(&json!({ "copy": "x", "hud": "Saved" })), "an extension's own text replaces Copied, the panel still hides");
        assert!(!copied_hud(&json!({ "copy": "x", "hud": "Saved" })));
        assert!(!copied_hud(&json!({ "copy": "x", "paste": { "text": "x" } })), "the paste is the feedback");
    }

    #[test]
    fn copied_text_says_when_a_concealed_copy_clears() {
        let plain: clipboard::Copy = serde_json::from_value(json!("x")).unwrap();
        assert_eq!(copied_text(&plain), "Copied");
        let concealed: clipboard::Copy = serde_json::from_value(json!({ "text": "s3cret", "concealed": true })).unwrap();
        assert_eq!(copied_text(&concealed), "Copied", "concealed without a clear is a plain Copied");
        let timed: clipboard::Copy = serde_json::from_value(json!({ "text": "s3cret", "concealed": true, "clear_after": 30 })).unwrap();
        assert_eq!(copied_text(&timed), "Copied, clears in 30 s");
        let unconcealed: clipboard::Copy = serde_json::from_value(json!({ "text": "x", "clear_after": 30 })).unwrap();
        assert_eq!(copied_text(&unconcealed), "Copied", "clear_after only means something on a concealed copy");
    }

    #[test]
    fn copy_files_failure_is_a_toast_with_the_reason() {
        let t = copy_files_toast("clipboard unavailable: no wayland data-control");
        assert_eq!(t["toast"]["title"], "Could not copy the files");
        assert_eq!(t["toast"]["style"], "failure");
        assert_eq!(t["toast"]["message"], "clipboard unavailable: no wayland data-control");
        assert_eq!(t.as_object().unwrap().len(), 1);
        assert!(serde_json::from_value::<Vec<PathBuf>>(json!(["/tmp/a", "/tmp/b"])).is_ok());
        assert!(serde_json::from_value::<Vec<PathBuf>>(json!("/tmp/a")).is_err(), "copy_files is a list, not one path");
    }
}
