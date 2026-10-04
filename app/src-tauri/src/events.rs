//! Every event the shell emits to the webviews, in one place, with its
//! payload. The pages subscribe by these names (`app/src`).

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// The panel is showing: `Shown { t0, palette?, keep, hold? }` (lib.rs).
/// `t0` is the show's wall-clock start, for the paint mark; `palette` is
/// `extension/palette` to open straight into; `hold` that the switcher
/// opened it (the page lists flat, cursor on row 2).
pub const SHOWN: &str = "pal://shown";
/// To the panel's page while the switcher holds a palette: `{ step: 1 |
/// -1 }` moves the cursor with wrap (a press of the chord, its shift
/// variant), `{ commit: true }` runs the row under it (the modifier let
/// go, or `pal switch commit`; switcher.rs).
pub const SWITCH: &str = "pal://switch";
/// The index changed (a listing landed, a source went, a filter swapped):
/// the page queries again. No payload.
pub const INDEX: &str = "pal://index";
/// The config was reloaded or an extension registered: the `Loaded` config
/// with its diagnostics.
pub const CONFIG: &str = "pal://config";
/// A notification from the extension host, as it sent it
/// (`{ method, params }`), plus `{ method: "host/exit" }` when it went down.
pub const HOST: &str = "pal://host";
/// The HUD window's text: `{ text }`; the page shows it with the brief's
/// motion (hud.rs).
pub const HUD: &str = "pal://hud";
/// The Large Type window's text: `{ text }` (large.rs).
pub const LARGE: &str = "pal://large";
/// To the keycast overlay's page, tagged by `kind` (keycast.rs): `state`
/// (`{ active, mode, settings }`), `keys` (`{ entries }`, the strip's feed
/// after a key), `cursor` (`{ x, y }`, window CSS pixels) and `click`
/// (`{ button, x, y, down }`).
pub const KEYCAST: &str = "pal://keycast";
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
/// To the page that asked: rows a streaming `list` showed early
/// (`ctx.partial`), `{ n, items }` with `n` the page's own request number
/// (host.rs `partial`); the page drops them once that request answered.
pub const PARTIAL: &str = "pal://partial";
/// To every page: a trigger fired (`{ name }`: `media`, `wake`, `network`,
/// `show`, `focus`, `minute`); a view level whose palette lists it under
/// `on` asks for its tree again (bar/mod.rs `trigger`).
pub const TRIGGER: &str = "pal://trigger";
/// To every page: states changed, `{ states: { <name>: value } }` (states.rs);
/// a view level whose palette lists `state:<name>` under `on` asks again.
pub const STATES: &str = "pal://states";
/// To every page: controls were published or regrouped, `{ changes: [{ control,
/// provider, keys }] }` (controls.rs); Settings › Groups reads the devices again.
pub const CONTROLS: &str = "pal://controls";
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
/// (deeplink.rs); `{ reset: true, missing }` when what it pointed at is an
/// extension that is not installed or is turned off (`store::Missing`): the
/// page shows the card that offers the fix.
pub const DEEPLINK: &str = "pal://deeplink";
/// To every page: the extension store's state (`store::StoreState`),
/// whenever it changes: a refresh, an operation, a load, a config change.
pub const STORE: &str = "pal://store";
/// To every page: the account or its sync moved (signed in or out, a
/// sync ran); Settings › Account re-reads (`account::account_state`).
pub const ACCOUNT: &str = "pal://account";
/// To every page: a secret went into the keychain behind a reference the
/// file already held; Settings re-reads (the "Add your key" field is filled).
pub const CONFIG_SECRETS: &str = "pal://secrets";

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
