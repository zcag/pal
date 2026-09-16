//! Every event the shell emits to the webviews, in one place, with its
//! payload. The pages subscribe by these names (`app/src`).

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// The panel is showing: `Shown { t0, palette? }` (lib.rs). `t0` is the
/// show's wall-clock start, for the paint mark; `palette` is
/// `extension/palette` to open straight into.
pub const SHOWN: &str = "pal://shown";
/// The index changed (a listing landed, a source went, a filter swapped):
/// the page queries again. No payload.
pub const INDEX: &str = "pal://index";
/// The config was reloaded or an extension registered: the `Loaded` config
/// with its diagnostics.
pub const CONFIG: &str = "pal://config";
/// A notification from the extension host, as it sent it
/// (`{ method, params }`), plus `{ method: "host/exit" }` when it went down.
pub const HOST: &str = "pal://host";
/// The clipboard recorded a copy: `{ id, kind }`.
pub const CLIPBOARD: &str = "pal://clipboard";

/// Emit to every window; a failure (the payload does not serialise) is a
/// bug worth a log line, never an error for the caller.
pub fn emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(e) = app.emit(event, payload) {
        eprintln!("event\t{event}\temit failed\t{e}");
    }
}
