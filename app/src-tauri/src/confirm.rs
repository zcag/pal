//! The core's confirm card: a yes/no question put up in the panel by the
//! shell (the page renders [`events::CONFIRM`] with its `Confirm`
//! component and answers on [`events::CONFIRM_REPLY`]), for what the
//! shell wants a word before doing: a `pal://run` or `pal://install` link
//! (deeplink.rs) and a permission ask (permissions.rs: what pal would do
//! with it, then the system prompt). One card at a time; [`TIMEOUT`],
//! then no. The panel is shown for the card and left up on the answer:
//! the caller hides it or moves on.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Listener, Manager};
use tokio::sync::oneshot;

use crate::{events, lock};

/// How long a card waits for an answer before it counts as no.
const TIMEOUT: Duration = Duration::from_secs(30);

/// The one card that can be up: a new ask drops the previous sender, whose
/// await then reads as no.
#[derive(Default)]
struct Pending(Mutex<Option<(u64, oneshot::Sender<bool>)>>);

static TOKEN: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
struct Ask<'a> {
    title: &'a str,
    message: &'a str,
    ok: &'a str,
    cancel: &'a str,
    token: u64,
}

/// The state and the page's answers, before anything can ask.
pub fn install(app: &AppHandle) {
    app.manage(Pending::default());
    let handle = app.clone();
    app.listen(events::CONFIRM_REPLY, move |e| {
        let v: serde_json::Value = serde_json::from_str(e.payload()).unwrap_or_default();
        if let Some(token) = v["token"].as_u64() {
            reply(&handle, token, v["ok"].as_bool().unwrap_or(false));
        }
    });
}

/// Show the panel with the card and wait: `Some(true)` for Enter,
/// `Some(false)` for Escape, the scrim or a newer card, `None` once
/// [`TIMEOUT`] passes with no answer (the page drops the card; the panel,
/// which the user may be using by then, is left alone). The show waits
/// for an activation in flight to land (`deeplink::settled`: a link
/// brought pal forward; a card from a hotkey has none to wait for).
pub async fn ask(app: &AppHandle, title: &str, message: &str, ok: &str) -> Option<bool> {
    let (tx, rx) = oneshot::channel();
    let token = TOKEN.fetch_add(1, Ordering::Relaxed);
    *lock(&app.state::<Pending>().0) = Some((token, tx));
    let payload = json!(Ask { title, message, ok, cancel: "Cancel", token });
    crate::deeplink::settled(app, move |app| {
        crate::show(app);
        events::emit_to(app, crate::WINDOW, events::CONFIRM, payload.clone());
    });
    let answer = match tokio::time::timeout(TIMEOUT, rx).await {
        Ok(Ok(yes)) => Some(yes),
        // The sender went: a newer card took the slot, and the page shows that one.
        Ok(Err(_)) => Some(false),
        Err(_) => {
            // Nobody answered: the page drops the card (a null ask).
            events::emit_to(app, crate::WINDOW, events::CONFIRM, ());
            None
        }
    };
    let st = app.state::<Pending>();
    let mut p = lock(&st.0);
    if p.as_ref().is_some_and(|(t, _)| *t == token) {
        *p = None;
    }
    answer
}

/// The page's answer for `token`; a stale token (a card already gone) is
/// dropped.
fn reply(app: &AppHandle, token: u64, ok: bool) {
    let st = app.state::<Pending>();
    let mut p = lock(&st.0);
    if p.as_ref().is_some_and(|(t, _)| *t == token) {
        if let Some((_, tx)) = p.take() {
            let _ = tx.send(ok);
        }
    }
}
