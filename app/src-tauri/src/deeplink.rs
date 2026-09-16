//! `pal://` links: what the store's "Open in pal" button, a browser
//! bookmark, a Shortcuts action or a script opens. The scheme is
//! `plugins.deep-link.desktop.schemes` in tauri.conf.json (`pal`; a scratch
//! build sets another through `TAURI_CONFIG`). Registration is the
//! bundle's: `CFBundleURLTypes` in the macOS Info.plist and
//! `MimeType=x-scheme-handler/pal` in the Linux desktop entry, both
//! written by the bundler from that key; a debug build on Linux registers
//! itself at startup (`register_all`), macOS has no runtime registration
//! (`lsregister -f <bundle>` after a scratch build, docs/cli.md).
//!
//! How a link arrives: macOS hands it to the running app as an Apple
//! Event (`RunEvent::Opened`, the plugin's `deep-link://new-url`), and
//! starts the app first when none runs; Linux runs `pal pal://...`, which
//! [`argv_link`] keeps out of clap, so the single-instance plugin
//! forwards the argv to the instance (its `deep-link` feature feeds it to
//! the plugin there) or, with none running, this process starts and the
//! plugin reads it from argv (`get_current`). Either way [`handle`] runs
//! it, queued until the panel's page has loaded ([`Links`]).
//!
//! Routes ([`Route`], [`parse`]): `toggle`, `show`, `hide`,
//! `settings[/overview|general|palettes|extensions|bar|about]`, `extensions`,
//! `open/<extension>/<palette>[?q=<query>]`,
//! `run/<extension>/<palette>/<id>[?action=<id>]`, `install/<spec>`,
//! `bar/<extension>/<id>`. Anything else is "pal: unknown link" in the HUD.
//!
//! macOS activates pal as it hands a link over (a browser's click, `open`
//! without `-g`), and a panel made key while that activation is still
//! landing resigns as it completes, which hides it (panel/macos.rs). So
//! every route that shows the panel waits for the activation to land
//! first ([`settled`]: on hornet the app is front 40 ms after the link)
//! and, when the show was still undone, shows once more a beat later,
//! which sticks: by then the activation is over, or bounced back to the
//! app that opened the link, and the panel is key the way the hotkey
//! makes it.
//!
//! Security: a web page can emit any of these, so `run` and `install`
//! show a confirm card in the panel first ([`confirm`]: the page renders
//! [`events::CONFIRM`] with its `Confirm` component and answers on
//! [`events::CONFIRM_REPLY`]; 30 s, then no). `general.deeplink_confirm =
//! false` drops the card for `run` (someone scripting pal); `install`
//! fetches and runs code from the network and always asks. Nothing here is
//! shelled: the spec goes to the store, the rest to the host.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pal_core::index::Source;
use serde::Serialize;
use serde_json::json;
use tauri::plugin::TauriPlugin;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Builder, Listener, Manager, Wry};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::oneshot;

use crate::host::Host;
use crate::{events, hud, index, lock, panel, settings};

/// Longer than this is refused unparsed: a query is a few words, a spec a
/// path.
pub const MAX_LEN: usize = 2048;
/// How long a confirm card waits for an answer before it counts as no.
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(30);

/// One parsed link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Toggle,
    Show,
    Hide,
    /// The settings window, on a page when one is named.
    Settings(Option<String>),
    /// The panel inside a palette, with `query` typed.
    Open { source: Source, query: Option<String> },
    /// A pick with the panel down, after the confirm card.
    Run { source: Source, id: String, action: Option<String> },
    /// `pal install <spec>` after the confirm card.
    Install { spec: String },
    /// A bar item's popover, by its `extension/id` key.
    Bar { key: String },
}

const PAGES: [&str; 6] = ["overview", "general", "palettes", "extensions", "bar", "about"];

fn decode(s: &str) -> Result<String, String> {
    percent_encoding::percent_decode_str(s).decode_utf8().map(|c| c.into_owned()).map_err(|_| "not utf-8".to_string())
}

/// `link` as a [`Route`]. The scheme is not checked (the plugin only
/// delivers the configured ones); the path is split on `/` and each part
/// percent-decoded, the query read as `k=v&k=v` (`+` is a space); a
/// fragment is dropped. `install/` keeps its tail whole, so a local
/// directory spec keeps its leading slash.
pub fn parse(link: &str) -> Result<Route, String> {
    if link.len() > MAX_LEN {
        return Err(format!("longer than {MAX_LEN} bytes"));
    }
    let (_, rest) = link.trim().split_once("://").ok_or("no scheme")?;
    let rest = rest.split_once('#').map_or(rest, |(r, _)| r);
    let (path, query) = rest.split_once('?').map_or((rest, None), |(p, q)| (p, Some(q)));
    let param = |name: &str| -> Result<Option<String>, String> {
        let Some(q) = query else { return Ok(None) };
        for kv in q.split('&').filter(|s| !s.is_empty()) {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            if decode(k)? == name {
                return decode(&v.replace('+', " ")).map(Some);
            }
        }
        Ok(None)
    };
    let parts: Vec<String> = path.split('/').filter(|s| !s.is_empty()).map(decode).collect::<Result<_, _>>()?;
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    let source = |e: &str, p: &str| Source::new(e, p);
    Ok(match parts.as_slice() {
        [] | ["show"] => Route::Show,
        ["toggle"] => Route::Toggle,
        ["hide"] => Route::Hide,
        ["settings"] => Route::Settings(None),
        ["settings", page] if PAGES.contains(page) => Route::Settings(Some(page.to_string())),
        ["extensions"] => Route::Settings(Some("extensions".into())),
        ["open", e, p] => Route::Open { source: source(e, p), query: param("q")?.filter(|q| !q.is_empty()) },
        ["run", e, p, id] => Route::Run { source: source(e, p), id: id.to_string(), action: param("action")?.filter(|a| !a.is_empty()) },
        ["install", ..] => {
            let tail = path.trim_start_matches('/').strip_prefix("install/").unwrap_or_default();
            let spec = decode(tail)?;
            if spec.trim().is_empty() {
                return Err("install: no spec".into());
            }
            Route::Install { spec }
        }
        ["bar", e, id] => Route::Bar { key: format!("{e}/{id}") },
        _ => return Err(format!("unknown route {path:?}")),
    })
}

// ---- arrival ---------------------------------------------------------------

/// Links that arrived before the panel's page loaded, run once it has.
#[derive(Default)]
struct Links {
    ready: bool,
    queued: Vec<String>,
}

/// The link on this process's argv, when that is all there is (Linux:
/// what the desktop entry's `Exec=pal %u` runs). Not a subcommand, so the
/// caller keeps it from clap; the single-instance and deep-link plugins do
/// the rest.
pub fn argv_link() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    link_in(&args).map(str::to_string)
}

/// The link in an argv of the shape [`argv_link`] takes.
fn link_in(args: &[String]) -> Option<&str> {
    match args {
        [_, one] if is_link(one) => Some(one),
        _ => None,
    }
}

/// Whether a second process's argv is a link (the single-instance
/// callback leaves those to the deep-link plugin).
pub fn is_link_argv(args: &[String]) -> bool {
    link_in(args).is_some()
}

fn is_link(s: &str) -> bool {
    s.split_once("://").is_some_and(|(scheme, _)| !scheme.is_empty() && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)))
}

/// The deep-link plugin, and the piece that runs what it delivers: queued
/// until the panel's page has loaded, since every route needs it.
pub fn register(b: Builder<Wry>) -> Builder<Wry> {
    b.plugin(tauri_plugin_deep_link::init()).plugin(plugin())
}

fn plugin() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("pal-deeplink")
        .setup(|app, _| {
            app.manage(Mutex::new(Links::default()));
            app.manage(Pending::default());
            let handle = app.clone();
            app.listen(events::CONFIRM_REPLY, move |e| {
                let v: serde_json::Value = serde_json::from_str(e.payload()).unwrap_or_default();
                if let Some(token) = v["token"].as_u64() {
                    reply(&handle, token, v["ok"].as_bool().unwrap_or(false));
                }
            });
            // A debug build is not installed, so nothing registered its
            // scheme; Linux can do it at runtime, macOS only through a
            // bundle (`lsregister`).
            if cfg!(all(debug_assertions, target_os = "linux")) {
                match app.deep_link().register_all() {
                    Ok(()) => eprintln!("deeplink\tregistered\tdebug build"),
                    Err(e) => eprintln!("deeplink\tregister failed\t{e}"),
                }
            }
            // The link that started this process (Linux argv; on macOS the
            // Apple Event comes through `on_open_url` once the loop runs).
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for u in urls {
                    enqueue(app, u.as_str());
                }
            }
            let handle = app.clone();
            app.deep_link().on_open_url(move |e| {
                for u in e.urls() {
                    enqueue(&handle, u.as_str());
                }
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished && webview.label() == crate::WINDOW {
                let app = webview.app_handle().clone();
                let queued: Vec<String> = {
                    let st = app.state::<Mutex<Links>>();
                    let mut l = lock(&st);
                    l.ready = true;
                    std::mem::take(&mut l.queued)
                };
                for link in queued {
                    handle(&app, &link);
                }
            }
        })
        .build()
}

fn enqueue(app: &AppHandle, link: &str) {
    let ready = {
        let st = app.state::<Mutex<Links>>();
        let mut l = lock(&st);
        if !l.ready {
            l.queued.push(link.to_string());
        }
        l.ready
    };
    if ready {
        handle(app, link);
    } else {
        eprintln!("deeplink\tqueued\t{link}");
    }
}

/// Run one link. Safe from any thread; each route hops where it needs to.
pub fn handle(app: &AppHandle, link: &str) {
    eprintln!("deeplink\t{link}");
    match parse(link) {
        Ok(route) => run(app, route),
        Err(e) => {
            eprintln!("deeplink\trefused\t{e}");
            hud::show(app, "pal: unknown link");
        }
    }
}

fn on_main(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    let handle = app.clone();
    if let Err(e) = app.run_on_main_thread(move || f(&handle)) {
        eprintln!("deeplink\tmain thread\t{e}");
    }
}

/// How long a link's show waits for the activation to land: to the front
/// within this, else it was not being activated (`open -g`, Linux).
#[cfg(target_os = "macos")]
const ACTIVATION_WAIT: Duration = Duration::from_millis(300);
/// After the app is front, the beat AppKit takes to settle its key window.
#[cfg(target_os = "macos")]
const ACTIVATION_SETTLE: Duration = Duration::from_millis(60);
/// After the show: if the panel is down again by then, the activation
/// undid it, and the show runs once more.
#[cfg(target_os = "macos")]
const RESHOW_AFTER: Duration = Duration::from_millis(250);

/// Run `f`, a show of the panel, on the main thread once the activation a
/// link brings has landed (module docs), and again [`RESHOW_AFTER`] later
/// if the panel is not up by then; at once when the app is already front
/// or not being activated at all. Off macOS there is no such dance.
fn settled(app: &AppHandle, f: impl Fn(&AppHandle) + Send + Sync + 'static) {
    #[cfg(not(target_os = "macos"))]
    on_main(app, f);
    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        let f = Arc::new(f);
        tauri::async_runtime::spawn(async move {
            let active = || objc2_app_kit::NSRunningApplication::currentApplication().isActive();
            if !active() {
                let until = std::time::Instant::now() + ACTIVATION_WAIT;
                while !active() && std::time::Instant::now() < until {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                if active() {
                    tokio::time::sleep(ACTIVATION_SETTLE).await;
                }
            }
            let again = f.clone();
            on_main(&app, move |app| again(app));
            tokio::time::sleep(RESHOW_AFTER).await;
            on_main(&app, move |app| {
                if !panel::is_visible(app) {
                    eprintln!("deeplink\tshow undone by the activation; showing again");
                    f(app);
                }
            });
        });
    }
}

fn run(app: &AppHandle, route: Route) {
    match route {
        Route::Toggle => on_main(app, |app| if panel::is_visible(app) { panel::hide(app) } else { settled(app, crate::show) }),
        Route::Show => settled(app, crate::show),
        Route::Hide => on_main(app, panel::hide),
        Route::Settings(page) => on_main(app, move |app| settings::open_page(app, page.as_deref())),
        Route::Open { source, query } => {
            if !known_palette(app, &source) {
                return hud::show(app, &format!("pal: no palette {}/{}", source.extension, source.palette));
            }
            settled(app, move |app| {
                crate::show_in(app, Some(format!("{}/{}", source.extension, source.palette)));
                if let Some(q) = &query {
                    events::emit_to(app, crate::WINDOW, events::DEEPLINK, json!({ "query": q }));
                }
            });
        }
        Route::Run { source, id, action } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { run_item(&app, &source, &id, action.as_deref()).await });
        }
        Route::Install { spec } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { install(&app, &spec).await });
        }
        // Off the main thread: the anchor is a `sketchybar --query`.
        Route::Bar { key } => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || crate::bar::popover::on_hotkey(&app, &key));
        }
    }
}

fn known_palette(app: &AppHandle, source: &Source) -> bool {
    crate::registry::registered_palettes(app).iter().any(|(_, s)| s == source)
}

/// The name the card shows for `id`: the row's, when the index has it.
fn item_name(app: &AppHandle, source: &Source, id: &str) -> Option<String> {
    index::with_index(app, |ix| ix.get(source, id).map(|i| i.name.clone()))
}

/// What the confirm card asks for a `run`: the row by name when the index
/// has it, else by id, and the action when one is named.
fn run_question(source: &Source, id: &str, name: Option<&str>, action: Option<&str>) -> (String, String) {
    let what = name.map_or_else(|| id.to_string(), str::to_string);
    let title = match action {
        Some(a) => format!("Run {a} on \u{201c}{what}\u{201d} from a link?"),
        None => format!("Run \u{201c}{what}\u{201d} from a link?"),
    };
    (title, format!("{}/{} \u{203a} {id}", source.extension, source.palette))
}

/// What the confirm card asks for an `install`: the spec's last path
/// part is the best guess at a name before it is fetched.
fn install_question(spec: &str) -> (String, String) {
    let name = spec.trim_end_matches('/').rsplit('/').next().unwrap_or(spec).split('@').next().unwrap_or(spec);
    let name = if name.is_empty() || name.contains(':') { "an extension" } else { name };
    (format!("Install {name} from a link?"), spec.to_string())
}

async fn run_item(app: &AppHandle, source: &Source, id: &str, action: Option<&str>) {
    let Some(host) = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()) else { return };
    if !known_palette(app, source) {
        return hud::show(app, &format!("pal: no palette {}/{}", source.extension, source.palette));
    }
    if settings::config(app).general.deeplink_confirm {
        let (title, message) = run_question(source, id, item_name(app, source, id).as_deref(), action);
        match confirm(app, &title, &message, "Run").await {
            Some(true) => {
                on_main(app, panel::hide);
                // The orderOut has to land before an effect types into the app in front.
                tokio::time::sleep(Duration::from_millis(80)).await;
            }
            Some(false) => {
                on_main(app, panel::hide);
                return eprintln!("deeplink\trun\tdeclined");
            }
            None => return eprintln!("deeplink\trun\tunanswered"),
        }
    }
    match index::run_pick(app, &host, source, id, action, None, None).await {
        Ok(r) => {
            if let Some(t) = r["toast"]["title"].as_str() {
                hud::show(app, t);
            }
        }
        Err(e) => {
            eprintln!("deeplink\trun failed\t{}/{}\t{id}\t{e}", source.extension, source.palette);
            hud::show(app, &format!("pal: {e}"));
        }
    }
}

async fn install(app: &AppHandle, spec: &str) {
    let (title, message) = install_question(spec);
    match confirm(app, &title, &message, "Install").await {
        Some(true) => {}
        Some(false) => {
            on_main(app, panel::hide);
            return eprintln!("deeplink\tinstall\tdeclined");
        }
        None => return eprintln!("deeplink\tinstall\tunanswered"),
    }
    hud::show(app, "Installing\u{2026}");
    match settings::extensions_install(app.state(), spec.to_string()).await {
        Ok(i) => {
            hud::show(app, &format!("Installed {} {}", i.name, i.version));
            // The root, with the name typed: its palette rows land as the host loads it.
            let name = i.name.clone();
            on_main(app, move |app| {
                crate::show(app);
                events::emit_to(app, crate::WINDOW, events::DEEPLINK, json!({ "reset": true, "query": name }));
            });
        }
        Err(e) => {
            eprintln!("deeplink\tinstall failed\t{spec}\t{e}");
            on_main(app, panel::hide);
            hud::show(app, &format!("Install failed: {e}"));
        }
    }
}

// ---- confirm card ------------------------------------------------------------

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

/// Show the panel with the card and wait: `Some(true)` for Enter,
/// `Some(false)` for Escape, the scrim or a newer card, `None` once
/// [`CONFIRM_TIMEOUT`] passes with no answer (the page drops the card;
/// the panel, which the user may be using by then, is left alone). On an
/// answer the panel is still up: the caller hides it or moves on.
async fn confirm(app: &AppHandle, title: &str, message: &str, ok: &str) -> Option<bool> {
    let (tx, rx) = oneshot::channel();
    let token = TOKEN.fetch_add(1, Ordering::Relaxed);
    *lock(&app.state::<Pending>().0) = Some((token, tx));
    let payload = json!(Ask { title, message, ok, cancel: "Cancel", token });
    settled(app, move |app| {
        crate::show(app);
        events::emit_to(app, crate::WINDOW, events::CONFIRM, payload.clone());
    });
    let answer = match tokio::time::timeout(CONFIRM_TIMEOUT, rx).await {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn src(e: &str, p: &str) -> Source {
        Source::new(e, p)
    }

    #[test]
    fn window_routes() {
        assert_eq!(parse("pal://toggle"), Ok(Route::Toggle));
        assert_eq!(parse("pal://show"), Ok(Route::Show));
        assert_eq!(parse("pal://"), Ok(Route::Show), "an empty link shows, as raycast:// does");
        assert_eq!(parse("pal://hide/"), Ok(Route::Hide), "a trailing slash is nothing");
        assert_eq!(parse("palscratch://toggle"), Ok(Route::Toggle), "the scheme is the plugin's business");
    }

    #[test]
    fn settings_routes() {
        assert_eq!(parse("pal://settings"), Ok(Route::Settings(None)));
        assert_eq!(parse("pal://settings/about"), Ok(Route::Settings(Some("about".into()))));
        assert_eq!(parse("pal://settings/bar"), Ok(Route::Settings(Some("bar".into()))));
        assert_eq!(parse("pal://extensions"), Ok(Route::Settings(Some("extensions".into()))));
        assert!(parse("pal://settings/nope").is_err());
    }

    #[test]
    fn open_carries_the_query_decoded() {
        assert_eq!(parse("pal://open/emoji/emoji?q=smile"), Ok(Route::Open { source: src("emoji", "emoji"), query: Some("smile".into()) }));
        assert_eq!(parse("pal://open/emoji/emoji?q=two+words%21&x=1"), Ok(Route::Open { source: src("emoji", "emoji"), query: Some("two words!".into()) }));
        assert_eq!(parse("pal://open/emoji/emoji?q="), Ok(Route::Open { source: src("emoji", "emoji"), query: None }));
        assert_eq!(parse("pal://open/emoji/emoji#frag"), Ok(Route::Open { source: src("emoji", "emoji"), query: None }));
        assert!(parse("pal://open/emoji").is_err(), "a palette needs both parts");
        assert!(parse("pal://open/emoji/emoji/more").is_err());
    }

    #[test]
    fn run_names_the_item_and_action() {
        assert_eq!(parse("pal://run/apps/apps/x"), Ok(Route::Run { source: src("apps", "apps"), id: "x".into(), action: None }));
        assert_eq!(parse("pal://run/apps/apps/com.apple.Safari?action=quit"), Ok(Route::Run { source: src("apps", "apps"), id: "com.apple.Safari".into(), action: Some("quit".into()) }));
        assert_eq!(parse("pal://run/a/b/with%2Fslash"), Ok(Route::Run { source: src("a", "b"), id: "with/slash".into(), action: None }), "an encoded slash stays inside the id");
    }

    #[test]
    fn install_keeps_the_spec_whole() {
        assert_eq!(parse("pal://install/github:zcag/pal/examples/hello-extension@pali"), Ok(Route::Install { spec: "github:zcag/pal/examples/hello-extension@pali".into() }));
        assert_eq!(parse("pal://install//Users/me/ext"), Ok(Route::Install { spec: "/Users/me/ext".into() }), "a local directory keeps its leading slash");
        assert_eq!(parse("pal://install/https%3A%2F%2Fgithub.com%2Fu%2Fr"), Ok(Route::Install { spec: "https://github.com/u/r".into() }));
        assert!(parse("pal://install").is_err());
        assert!(parse("pal://install/").is_err());
        assert!(pal_core::extensions::Spec::parse("github:zcag/pal/examples/hello-extension@pali").is_ok(), "the site's button emits what the store parses");
    }

    #[test]
    fn bar_is_the_item_key() {
        assert_eq!(parse("pal://bar/battery/main"), Ok(Route::Bar { key: "battery/main".into() }));
    }

    #[test]
    fn refusals() {
        assert!(parse("toggle").is_err(), "no scheme");
        assert!(parse("pal://nope").is_err());
        assert!(parse("pal://run/a/b").is_err());
        assert!(parse("pal://open/a/%FF").is_err(), "bad utf-8");
        assert!(parse(&format!("pal://open/a/b?q={}", "x".repeat(MAX_LEN))).is_err());
    }

    #[test]
    fn argv_links_are_a_sole_url_argument() {
        assert!(is_link("pal://toggle"));
        assert!(is_link("palscratch://show"));
        assert!(!is_link("toggle"));
        assert!(!is_link("://x"));
        assert!(!is_link("a b://x"));
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(is_link_argv(&a(&["pal", "pal://toggle"])));
        assert!(!is_link_argv(&a(&["pal", "toggle"])));
        assert!(!is_link_argv(&a(&["pal", "pal://toggle", "x"])), "a link is the sole argument");
    }

    #[test]
    fn questions() {
        let (t, m) = run_question(&src("apps", "apps"), "com.apple.Safari", Some("Safari"), None);
        assert_eq!(t, "Run \u{201c}Safari\u{201d} from a link?");
        assert_eq!(m, "apps/apps \u{203a} com.apple.Safari");
        let (t, _) = run_question(&src("apps", "apps"), "x", None, Some("quit"));
        assert_eq!(t, "Run quit on \u{201c}x\u{201d} from a link?", "no row in the index: the id stands in");
        let (t, m) = install_question("github:zcag/pal/examples/hello-extension@pali");
        assert_eq!(t, "Install hello-extension from a link?");
        assert_eq!(m, "github:zcag/pal/examples/hello-extension@pali");
        assert_eq!(install_question("github:u/repo").0, "Install repo from a link?");
        assert_eq!(install_question("/tmp/ext/").0, "Install ext from a link?");
        assert_eq!(install_question("github:").0, "Install an extension from a link?");
    }
}
