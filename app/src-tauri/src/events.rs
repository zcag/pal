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
/// The HUD window's text: `{ text }`; the page shows it with the brief's
/// motion (hud.rs).
pub const HUD: &str = "pal://hud";
/// The Large Type window's text: `{ text }` (large.rs).
pub const LARGE: &str = "pal://large";
/// A permission changed hands: `permissions::Status` (today: Accessibility
/// was granted, seen by the poll in permissions.rs).
pub const PERMISSIONS: &str = "pal://permissions";
/// The root hotkey's registration outcome changed: `hotkey::Outcome`
/// (registered, failed and why, Spotlight holding it).
pub const HOTKEY: &str = "pal://hotkey";
/// An update install moved a step: `updater::Progress` (`{ phase, version,
/// downloaded?, total?, error? }`); the About row and the Overview draw it.
pub const UPDATE: &str = "pal://update";
/// To the settings window: `{ page }` to show (`settings::open_page`).
pub const SETTINGS: &str = "pal://settings";
/// The bar popover's page: the item to show on one level (`{ key, title,
/// engaged, urgent, menu, item, effect? }`), `{ engage: true }` once a
/// peek is made key, `{ hide: true }` when it goes (bar/popover.rs). The
/// sidebar's window gets the same, `sidebar: true` and its palette as
/// the menu (sidebar.rs).
pub const BAR: &str = "pal://bar";
/// To one window's page: a push for the view level it has on top
/// (`ViewUpdate` in sdk/src/protocol.ts: `{ extension, palette | bar, id?,
/// spec }`), applied in place (views.rs).
pub const VIEW: &str = "pal://view";
/// To every page: a trigger fired (`{ name }`: `media`, `wake`, `network`,
/// `show`, `focus`, `minute`); a view level whose palette lists it under
/// `on` asks for its tree again (bar/mod.rs `trigger`).
pub const TRIGGER: &str = "pal://trigger";
/// To the panel's page: a confirm card to render with its `Confirm`
/// component, `{ title, message, ok, cancel, token }`, or `null` to drop
/// the one up (deeplink.rs); the page answers on [`CONFIRM_REPLY`].
pub const CONFIRM: &str = "pal://confirm";
/// From the panel's page: `{ token, ok }`, the answer to a [`CONFIRM`].
pub const CONFIRM_REPLY: &str = "pal://confirm/reply";
/// To every page: the theme file as loaded (theme.rs `Current`: `{ file?,
/// theme: { name?, light, dark }, diagnostics }`); `theme.ts` sets the
/// variables on `:root`.
pub const THEME: &str = "pal://theme";
/// To the panel's page, after a `pal://` link showed it: `{ query?, reset? }`,
/// the text to type into the search box, at the root when `reset` is set
/// (deeplink.rs).
pub const DEEPLINK: &str = "pal://deeplink";

/// Emit to every window; a failure (the payload does not serialise) is a
/// bug worth a log line, never an error for the caller.
pub fn emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(e) = app.emit(event, payload) {
        eprintln!("event\t{event}\temit failed\t{e}");
    }
}

/// Emit to one window by label; same failure handling as `emit`.
pub fn emit_to<S: Serialize + Clone>(app: &AppHandle, window: &str, event: &str, payload: S) {
    if let Err(e) = app.emit_to(window, event, payload) {
        eprintln!("event\t{event}\temit to {window} failed\t{e}");
    }
}
