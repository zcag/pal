//! `pal://` links: what the store's "Open in pal" button, a browser
//! bookmark, a Shortcuts action, a keybind or a script opens, and what
//! the CLI's readable twins (`pal open`, `pal run`, `pal call`, ...) are
//! spelled as before they reach the instance (cli.rs). The grammar and the
//! whole route table: docs/design/links.md; the user's list: docs/links.md.
//!
//! The scheme is `plugins.deep-link.desktop.schemes` in tauri.conf.json
//! (`pal`; a scratch build sets another through `TAURI_CONFIG`).
//! Registration is the bundle's: `CFBundleURLTypes` in the macOS
//! Info.plist and `MimeType=x-scheme-handler/pal` in the Linux desktop
//! entry, both written by the bundler from that key; a debug build on
//! Linux registers itself at startup (`register_all`), macOS has no
//! runtime registration (`lsregister -f <bundle>` after a scratch build,
//! docs/cli.md).
//!
//! How a link arrives: macOS hands it to the running app as an Apple
//! Event (`RunEvent::Opened`, the plugin's `deep-link://new-url`), and
//! starts the app first when none runs; Linux runs `pal pal://...`, which
//! [`argv_link`] keeps out of clap, so the single-instance plugin
//! forwards the argv to the instance (its `deep-link` feature feeds it to
//! the plugin there) or, with none running, this process starts and the
//! plugin reads it from argv (`get_current`). Either way [`enqueue`] runs
//! it, queued until the panel's page has loaded ([`Links`]). A CLI twin
//! arrives as `pal link <url>` over the single-instance channel and runs
//! through [`handle_trusted`]: no confirm card, the shell is the user's
//! hand.
//!
//! Routes: [`ROUTES`] is the table, one [`Spec`] per pattern
//! (`run/{extension}/{palette}/{id}`), matched top to bottom after each
//! path part is percent-decoded; the last pattern, `{extension}/{route}`,
//! is a route the extension declares in its manifest (`links`), answered
//! by its `link(route, params)` through the host. [`parse`] is pure and
//! tested per route; [`run`] is the half that touches the app.
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
//! Security: a web page can emit any of these, so what acts shows a
//! confirm card in the panel first ([`confirm`]: the page renders
//! [`events::CONFIRM`] with its `Confirm` component and answers on
//! [`events::CONFIRM_REPLY`]; 30 s, then no). `general.deeplink_confirm`
//! (`pal_core::config::Confirm`) is `true`, `false`, or the extensions
//! whose `run`/`form`/routes skip the card; `install`, `update` and
//! `remove` fetch or delete code and always ask; a route declared with
//! `confirm: true` always asks; the CLI never does. Nothing here is
//! shelled: the spec goes to the store, the rest to the host.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pal_core::index::Source;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::plugin::TauriPlugin;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Builder, Listener, Manager, Wry};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::oneshot;

use crate::host::Host;
use crate::{commands, effects, events, hud, index, lock, panel, settings};

/// Longer than this is refused unparsed: a query is a few words, a spec a
/// path.
pub const MAX_LEN: usize = 2048;
/// How long a confirm card waits for an answer before it counts as no.
const CONFIRM_TIMEOUT: Duration = Duration::from_secs(30);
/// The scheme the page writes and the docs show; the bundle's may differ.
pub const SCHEME: &str = "pal";

/// One parsed link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Toggle,
    Show,
    Hide,
    /// The settings window, on a page when one is named.
    Settings(Option<String>),
    Reload,
    Quit,
    /// One of pal's own rows (`commands.rs`).
    Command { id: String },
    /// The panel inside a palette, with `query` typed and `filter` chosen.
    Open { source: Source, query: Option<String>, filter: Option<String> },
    /// A pick with the panel down, after the confirm card; `fill` (the
    /// `form` route) prefills the form the pick answers with.
    Run { source: Source, id: String, action: Option<String>, args: Option<Value>, fill: Option<BTreeMap<String, String>> },
    /// `pal install <spec>` after the confirm card.
    Install { spec: String },
    /// `pal update [name]` after the confirm card.
    Update { name: Option<String> },
    /// `pal remove <name>` after the confirm card.
    Remove { name: String },
    /// A bar item's popover, by its `extension/id` key; with `action`, one
    /// of its actions instead.
    Bar { key: String, action: Option<String> },
    Copy { text: String },
    Paste { text: String },
    /// The OS opener on a url, a path or an app.
    OpenUrl { target: String },
    Hud { text: String },
    Toast { title: String, message: Option<String> },
    Confetti { text: Option<String> },
    /// A route the extension declares: `pal://timer/start?duration=25m`.
    Ext { extension: String, route: String, params: Map<String, Value> },
}

impl Route {
    /// The extension a link acts through, for the allowlist; none for an
    /// app-level route.
    fn extension(&self) -> Option<&str> {
        match self {
            Route::Run { source, .. } => Some(&source.extension),
            Route::Ext { extension, .. } => Some(extension),
            Route::Bar { key, .. } => key.split_once('/').map(|(e, _)| e),
            _ => None,
        }
    }
}

pub const PAGES: [&str; 6] = ["overview", "general", "palettes", "extensions", "bar", "about"];

// ---- the table ---------------------------------------------------------------

/// The query string, in order; a key may repeat.
struct Query(Vec<(String, String)>);

impl Query {
    fn parse(q: Option<&str>) -> Result<Self, String> {
        let mut out = Vec::new();
        for kv in q.unwrap_or_default().split('&').filter(|s| !s.is_empty()) {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            out.push((decode(k)?, decode(&v.replace('+', " "))?));
        }
        Ok(Self(out))
    }
    /// The first value of `name`; an empty one is none.
    fn get(&self, name: &str) -> Option<String> {
        self.0.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()).filter(|v| !v.is_empty())
    }
    /// `name`, required: a missing or empty one names itself.
    fn need(&self, name: &str) -> Result<String, String> {
        self.get(name).ok_or_else(|| format!("{name} is required"))
    }
    /// Every parameter as JSON: a string, or an array for a repeated key.
    fn map(&self) -> Map<String, Value> {
        let mut m: Map<String, Value> = Map::new();
        for (k, v) in &self.0 {
            match m.get_mut(k) {
                Some(Value::Array(a)) => a.push(json!(v)),
                Some(one) => *one = json!([one.take(), v]),
                None => {
                    m.insert(k.clone(), json!(v));
                }
            }
        }
        m
    }
    /// Every parameter but `except`, as strings (a `form` link's fields).
    fn except(&self, except: &[&str]) -> BTreeMap<String, String> {
        self.0.iter().filter(|(k, _)| !except.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()
    }
}

/// What a pattern captured: its named parts, and the query.
struct Captured<'a> {
    parts: BTreeMap<&'static str, String>,
    query: &'a Query,
}

impl Captured<'_> {
    fn part(&self, name: &str) -> &str {
        self.parts.get(name).map_or("", String::as_str)
    }
    fn source(&self) -> Source {
        Source::new(self.part("extension"), self.part("palette"))
    }
}

/// One route: its pattern (literal parts, `{name}` parts, a `{name...}`
/// rest that keeps the raw tail whole), a line for `pal link --list` and
/// the docs, and the builder.
pub struct Spec {
    pub pattern: &'static str,
    pub doc: &'static str,
    build: fn(&Captured) -> Result<Route, String>,
}

fn args_of(q: &Query) -> Result<Option<Value>, String> {
    q.get("args").map(|a| serde_json::from_str(&a).map_err(|e| format!("args is not JSON: {e}"))).transpose()
}

fn name_ok(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-_.".contains(c))
}

/// The routes, matched top to bottom; the aliases sit before the general
/// forms they shadow, the extension catch-all last.
pub const ROUTES: &[Spec] = &[
    Spec { pattern: "", doc: "show the panel", build: |_| Ok(Route::Show) },
    Spec { pattern: "show", doc: "show the panel", build: |_| Ok(Route::Show) },
    Spec { pattern: "hide", doc: "hide the panel", build: |_| Ok(Route::Hide) },
    Spec { pattern: "toggle", doc: "show the panel if hidden, hide it if shown", build: |_| Ok(Route::Toggle) },
    Spec { pattern: "settings", doc: "the settings window", build: |_| Ok(Route::Settings(None)) },
    Spec {
        pattern: "settings/{page}",
        doc: "the settings window on a page: overview, general, palettes, extensions, bar, about",
        build: |c| PAGES.contains(&c.part("page")).then(|| Route::Settings(Some(c.part("page").into()))).ok_or_else(|| format!("no settings page {:?}", c.part("page"))),
    },
    Spec { pattern: "extensions", doc: "settings/extensions (alias)", build: |_| Ok(Route::Settings(Some("extensions".into()))) },
    Spec { pattern: "reload", doc: "restart the extension host", build: |_| Ok(Route::Reload) },
    Spec { pattern: "quit", doc: "quit the running instance", build: |_| Ok(Route::Quit) },
    Spec { pattern: "commands/{id}", doc: "one of pal's own rows (settings, store, refresh, updates, theme, ...)", build: |c| Ok(Route::Command { id: c.part("id").into() }) },
    Spec { pattern: "run/pal/commands/{id}", doc: "commands/<id> (alias)", build: |c| Ok(Route::Command { id: c.part("id").into() }) },
    Spec {
        pattern: "open/{extension}/{palette}",
        doc: "the panel inside a palette; ?q= types a query, ?filter= picks a filter",
        build: |c| Ok(Route::Open { source: c.source(), query: c.query.get("q"), filter: c.query.get("filter") }),
    },
    Spec { pattern: "open", doc: "?url= a url, path or app for the OS opener", build: |c| Ok(Route::OpenUrl { target: c.query.get("url").or_else(|| c.query.get("path")).ok_or("url is required")? }) },
    Spec {
        pattern: "run/{extension}/{palette}/{id}",
        doc: "run an item, the panel down; ?action= one of its actions, ?args= the level's args as JSON",
        build: |c| Ok(Route::Run { source: c.source(), id: c.part("id").into(), action: c.query.get("action"), args: args_of(c.query)?, fill: None }),
    },
    Spec {
        pattern: "form/{extension}/{palette}/{id}",
        doc: "the form an item's pick answers, prefilled: ?action= the action, every other ?field=value fills that field",
        build: |c| Ok(Route::Run { source: c.source(), id: c.part("id").into(), action: c.query.get("action"), args: args_of(c.query)?, fill: Some(c.query.except(&["action", "args"])) }),
    },
    Spec { pattern: "copy", doc: "?text= onto the clipboard", build: |c| Ok(Route::Copy { text: c.query.need("text")? }) },
    Spec { pattern: "paste", doc: "?text= pasted into the app in front", build: |c| Ok(Route::Paste { text: c.query.need("text")? }) },
    Spec { pattern: "hud", doc: "?text= one line in the HUD", build: |c| Ok(Route::Hud { text: c.query.need("text")? }) },
    Spec { pattern: "toast", doc: "?title= (&message=) a toast in the panel, else the HUD", build: |c| Ok(Route::Toast { title: c.query.need("title")?, message: c.query.get("message") }) },
    Spec { pattern: "confetti", doc: "a celebration in the HUD; ?text= the capsule's line", build: |c| Ok(Route::Confetti { text: c.query.get("text") }) },
    Spec {
        pattern: "install/{spec...}",
        doc: "install an extension: a store name, github:user/repo[/dir][@ref], a github.com url, a directory",
        build: |c| {
            let spec = c.part("spec").to_string();
            if spec.trim().is_empty() {
                return Err("install: no spec".into());
            }
            Ok(Route::Install { spec })
        },
    },
    Spec { pattern: "update", doc: "fetch every installed extension with a source again", build: |_| Ok(Route::Update { name: None }) },
    Spec { pattern: "update/{name}", doc: "fetch an installed extension again", build: |c| Ok(Route::Update { name: Some(c.part("name").into()) }) },
    Spec { pattern: "remove/{name}", doc: "remove an installed extension", build: |c| Ok(Route::Remove { name: c.part("name").into() }) },
    Spec {
        pattern: "bar/{extension}/{id}",
        doc: "a bar item's popover; ?action= runs one of its actions instead",
        build: |c| Ok(Route::Bar { key: format!("{}/{}", c.part("extension"), c.part("id")), action: c.query.get("action") }),
    },
    Spec {
        pattern: "{extension}/{route}",
        doc: "a route the extension declares in pal.json (`links`), with its ?params",
        build: |c| {
            let (extension, route) = (c.part("extension"), c.part("route"));
            if !name_ok(extension) || !name_ok(route) {
                return Err(format!("unknown route {extension:?}/{route:?}"));
            }
            Ok(Route::Ext { extension: extension.into(), route: route.into(), params: c.query.map() })
        },
    },
];

fn decode(s: &str) -> Result<String, String> {
    percent_encoding::percent_decode_str(s).decode_utf8().map(|c| c.into_owned()).map_err(|_| "not utf-8".to_string())
}

/// Match one pattern against the raw path parts (each decoded as it is
/// bound; a `{name...}` rest takes the raw tail, decoded whole, so a
/// local directory spec keeps its leading slash).
fn matches(pattern: &'static str, raw: &[&str]) -> Result<Option<BTreeMap<&'static str, String>>, String> {
    let segs: Vec<&'static str> = if pattern.is_empty() { Vec::new() } else { pattern.split('/').collect() };
    let mut parts = BTreeMap::new();
    for (i, seg) in segs.iter().enumerate() {
        if let Some(name) = seg.strip_prefix('{').and_then(|s| s.strip_suffix("...}")) {
            let tail = raw.get(i..).unwrap_or_default().join("/");
            if tail.is_empty() {
                return Ok(None);
            }
            parts.insert(name, decode(&tail)?);
            return Ok(Some(parts));
        }
        let Some(r) = raw.get(i) else { return Ok(None) };
        if r.is_empty() {
            return Ok(None);
        }
        match seg.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            Some(name) => {
                parts.insert(name, decode(r)?);
            }
            None if decode(r)? == *seg => {}
            None => return Ok(None),
        }
    }
    Ok((raw.len() == segs.len()).then_some(parts))
}

/// `link` as a [`Route`]. The scheme is not checked (the plugin only
/// delivers the configured ones); the path is split on `/` and matched
/// against [`ROUTES`], the query read as `k=v&k=v` (`+` is a space); a
/// fragment is dropped; a trailing slash is nothing.
pub fn parse(link: &str) -> Result<Route, String> {
    if link.len() > MAX_LEN {
        return Err(format!("longer than {MAX_LEN} bytes"));
    }
    let (_, rest) = link.trim().split_once("://").ok_or("no scheme")?;
    let rest = rest.split_once('#').map_or(rest, |(r, _)| r);
    let (path, query) = rest.split_once('?').map_or((rest, None), |(p, q)| (p, Some(q)));
    let query = Query::parse(query)?;
    let mut raw: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    while raw.last() == Some(&"") {
        raw.pop();
    }
    for spec in ROUTES {
        if let Some(parts) = matches(spec.pattern, &raw)? {
            return (spec.build)(&Captured { parts, query: &query });
        }
    }
    Err(format!("unknown route {path:?}"))
}

/// A link with `scheme` in place of whatever it had (the page writes
/// `pal://`; a scratch bundle registers another).
pub fn with_scheme(link: &str, scheme: &str) -> String {
    match link.split_once("://") {
        Some((_, rest)) => format!("{scheme}://{rest}"),
        None => link.to_string(),
    }
}

/// The bundle's scheme: `plugins.deep-link.desktop.schemes[0]` in the
/// tauri config, else [`SCHEME`].
pub fn scheme(app: &AppHandle) -> String {
    app.config().plugins.0.get("deep-link").and_then(|v| v["desktop"]["schemes"][0].as_str()).unwrap_or(SCHEME).to_string()
}

// ---- arrival ---------------------------------------------------------------

/// Links that arrived before the panel's page loaded, run once it has.
#[derive(Default)]
struct Links {
    ready: bool,
    queued: Vec<(String, bool)>,
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

pub fn is_link(s: &str) -> bool {
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
                    enqueue(app, u.as_str(), false);
                }
            }
            let handle = app.clone();
            app.deep_link().on_open_url(move |e| {
                for u in e.urls() {
                    enqueue(&handle, u.as_str(), false);
                }
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished && webview.label() == crate::WINDOW {
                let app = webview.app_handle().clone();
                let queued: Vec<(String, bool)> = {
                    let st = app.state::<Mutex<Links>>();
                    let mut l = lock(&st);
                    l.ready = true;
                    std::mem::take(&mut l.queued)
                };
                tauri::async_runtime::spawn(async move {
                    for (link, trusted) in queued {
                        handle_from(&app, &link, trusted);
                    }
                });
            }
        })
        .build()
}

/// Queue or run, never inline: the plugin delivers a link inside a tauri
/// event listener (`deep-link://new-url`, under the listeners' lock) on
/// the main thread, and a route that builds a window there (settings)
/// emits its own events and deadlocks on that lock; the single-instance
/// callback (a CLI twin) arrives on the main thread too. So every link
/// hops to the async runtime first, and each route posts back to the
/// main thread from there (seen on hornet 2026-09-16: `pal://settings/bar`
/// from `open` hung the instance in `_pthread_mutex_firstfit_lock_slow`).
fn enqueue(app: &AppHandle, link: &str, trusted: bool) {
    let ready = {
        let st = app.state::<Mutex<Links>>();
        let mut l = lock(&st);
        if !l.ready {
            l.queued.push((link.to_string(), trusted));
        }
        l.ready
    };
    if ready {
        let (app, link) = (app.clone(), link.to_string());
        tauri::async_runtime::spawn(async move { handle_from(&app, &link, trusted) });
    } else {
        eprintln!("deeplink\tqueued\t{link}");
    }
}

/// Run one link the CLI sent (`pal link`, `pal run`, ...): no card, the
/// shell is the user's hand. Queued like the plugin's (a browser's, a
/// Shortcut's, which carry the cards) until the page is up.
pub fn handle_trusted(app: &AppHandle, link: &str) {
    enqueue(app, link, true);
}

/// Safe from any thread; each route hops where it needs to.
fn handle_from(app: &AppHandle, link: &str, trusted: bool) {
    eprintln!("deeplink\t{}\t{link}", if trusted { "cli" } else { "link" });
    match parse(link) {
        Ok(route) => run(app, route, trusted),
        Err(e) => {
            eprintln!("deeplink\trefused\t{e}");
            hud::show(app, &refusal(&e));
        }
    }
}

/// The HUD's line for a refused link: the grammar's refusals are all
/// "unknown link"; a missing parameter names itself.
pub fn refusal(e: &str) -> String {
    if e.ends_with(" is required") || e.starts_with("args is not JSON") {
        format!("pal: {e}")
    } else {
        "pal: unknown link".into()
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

/// Whether this route shows the card: never from the CLI; `install`,
/// `update`, `remove` always; the rest per `general.deeplink_confirm`
/// and the extension in the path (`always` for a manifest route that
/// says `confirm: true`).
fn asks(app: &AppHandle, route: &Route, trusted: bool, always: bool) -> bool {
    if trusted {
        return false;
    }
    if always || matches!(route, Route::Install { .. } | Route::Update { .. } | Route::Remove { .. }) {
        return true;
    }
    settings::config(app).general.deeplink_confirm.asks(route.extension())
}

fn run(app: &AppHandle, route: Route, trusted: bool) {
    match route {
        Route::Toggle => on_main(app, |app| if panel::is_visible(app) { panel::hide(app) } else { settled(app, crate::show) }),
        Route::Show => settled(app, crate::show),
        Route::Hide => on_main(app, panel::hide),
        Route::Settings(page) => on_main(app, move |app| settings::open_page(app, page.as_deref())),
        Route::Reload => {
            if let Some(host) = app.try_state::<Arc<Host>>() {
                let host = host.inner().clone();
                tauri::async_runtime::spawn(async move { host.restart().await });
            }
        }
        Route::Quit => on_main(app, crate::quit),
        Route::Command { id } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let item = json!({ "id": id, "name": id, "palette": "pal/commands", "source": commands::source() });
                match commands::pick(&app, &id, None, None).await {
                    Ok(r) => deliver(&app, item, r),
                    Err(e) => hud::show(&app, &format!("pal: {e}")),
                }
            });
        }
        Route::Open { source, query, filter } => {
            if !known_palette(app, &source) {
                return hud::show(app, &format!("pal: no palette {}/{}", source.extension, source.palette));
            }
            settled(app, move |app| {
                crate::show_in(app, Some(format!("{}/{}", source.extension, source.palette)));
                if query.is_some() || filter.is_some() {
                    events::emit_to(app, crate::WINDOW, events::DEEPLINK, json!({ "query": query, "filter": filter }));
                }
            });
        }
        Route::Run { .. } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { run_item(&app, route, trusted).await });
        }
        Route::Install { spec } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { install(&app, &spec, trusted).await });
        }
        Route::Update { .. } | Route::Remove { .. } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { store(&app, route, trusted).await });
        }
        // Off the main thread: the anchor is a `sketchybar --query`.
        Route::Bar { key, action: None } => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || crate::bar::popover::on_hotkey(&app, &key));
        }
        Route::Bar { key, action: Some(action) } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let route = Route::Bar { key: key.clone(), action: Some(action.clone()) };
                if asks(&app, &route, trusted, false) {
                    let (title, message) = bar_question(&key, &action);
                    if !matches!(confirm(&app, &title, &message, "Run").await, Some(true)) {
                        on_main(&app, panel::hide);
                        return eprintln!("deeplink\tbar\tdeclined");
                    }
                    on_main(&app, panel::hide);
                }
                match crate::bar::action(&app, &key, &action, "link", crate::bar::popover::WINDOW, None).await {
                    Ok(r) => {
                        if let Some(t) = r["toast"]["title"].as_str() {
                            hud::show(&app, t);
                        }
                    }
                    Err(e) => hud::show(&app, &format!("pal: {e}")),
                }
            });
        }
        Route::Copy { text } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { effect(&app, json!({ "copy": text })).await });
        }
        Route::Paste { text } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let route = Route::Paste { text: text.clone() };
                if asks(&app, &route, trusted, false) {
                    let (title, message) = paste_question(&text);
                    if !matches!(confirm(&app, &title, &message, "Paste").await, Some(true)) {
                        on_main(&app, panel::hide);
                        return eprintln!("deeplink\tpaste\tdeclined");
                    }
                }
                effect(&app, json!({ "paste": { "text": text } })).await;
            });
        }
        Route::OpenUrl { target } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let route = Route::OpenUrl { target: target.clone() };
                if asks(&app, &route, trusted, false) {
                    if !matches!(confirm(&app, &format!("Open \u{201c}{}\u{201d} from a link?", short(&target, 80)), &target, "Open").await, Some(true)) {
                        on_main(&app, panel::hide);
                        return eprintln!("deeplink\topen\tdeclined");
                    }
                    on_main(&app, panel::hide);
                }
                effect(&app, json!({ "open": target })).await;
            });
        }
        Route::Hud { text } => hud::show(app, &text),
        Route::Confetti { text } => hud::celebrate(app, text.as_deref().unwrap_or("\u{1F389}")),
        Route::Toast { title, message } => {
            let app = app.clone();
            on_main(&app, move |app| {
                if panel::is_visible(app) {
                    events::emit_to(app, crate::WINDOW, events::DEEPLINK, json!({ "toast": { "title": title, "message": message } }));
                } else {
                    hud::show(app, &message.map_or(title.clone(), |m| format!("{title}: {m}")));
                }
            });
        }
        Route::Ext { .. } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { run_ext(&app, route, trusted).await });
        }
    }
}

/// An app-level effect (`copy`, `paste`, `open`) run as a pick's would be;
/// a refusal that came back as a toast (a paste without Accessibility) is
/// the HUD's line, since no panel is up to carry it.
async fn effect(app: &AppHandle, envelope: Value) {
    match effects::apply(app, envelope).await {
        Ok(r) => {
            if let Some(t) = r["toast"]["title"].as_str() {
                hud::show(app, t);
            }
        }
        Err(e) => hud::show(app, &format!("pal: {e}")),
    }
}

/// What a link's pick answered, to where it belongs: a `toast` is the
/// HUD's line (the panel is down); anything that needs a level (`push`,
/// `show`, `view`, `form`) shows the panel and hands the page the
/// envelope with the item it came from, which applies it as a pick's
/// answer (Launcher `apply`).
fn deliver(app: &AppHandle, item: Value, r: Value) {
    if ["push", "show", "view", "form"].iter().any(|k| r.get(*k).is_some()) {
        settled(app, move |app| {
            crate::show(app);
            events::emit_to(app, crate::WINDOW, events::DEEPLINK, json!({ "effect": r, "item": item }));
        });
    } else if let Some(t) = r["toast"]["title"].as_str() {
        hud::show(app, t);
    }
}

fn known_palette(app: &AppHandle, source: &Source) -> bool {
    crate::registry::registered_palettes(app).iter().any(|(_, s)| s == source)
}

/// The name the card shows for `id`: the row's, when the index has it.
fn item_name(app: &AppHandle, source: &Source, id: &str) -> Option<String> {
    index::with_index(app, |ix| ix.get(source, id).map(|i| i.name.clone()))
}

fn short(s: &str, n: usize) -> String {
    if s.chars().count() > n { format!("{}\u{2026}", s.chars().take(n - 1).collect::<String>()) } else { s.to_string() }
}

/// What the confirm card asks for a `run`: the row by name when the index
/// has it, else by id, and the action when one is named; a `form` link
/// says so.
fn run_question(source: &Source, id: &str, name: Option<&str>, action: Option<&str>, form: bool) -> (String, String) {
    let what = name.map_or_else(|| id.to_string(), str::to_string);
    let title = match (form, action) {
        (true, _) => format!("Open the form of \u{201c}{what}\u{201d} from a link?"),
        (false, Some(a)) => format!("Run {a} on \u{201c}{what}\u{201d} from a link?"),
        (false, None) => format!("Run \u{201c}{what}\u{201d} from a link?"),
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

fn paste_question(text: &str) -> (String, String) {
    (format!("Paste \u{201c}{}\u{201d} from a link?", short(&text.replace('\n', " "), 60)), "Into the app in front".into())
}

fn bar_question(key: &str, action: &str) -> (String, String) {
    (format!("Run {action} on the bar item {key} from a link?"), format!("bar/{key}"))
}

/// What the card asks for an extension route: the manifest's description
/// of it when the host reported one, else the route; the params as the
/// message.
fn ext_question(extension: &str, route: &str, description: Option<&str>, params: &Map<String, Value>) -> (String, String) {
    let what = description.filter(|d| !d.trim().is_empty()).map_or_else(|| format!("{extension}/{route}"), |d| d.trim_end_matches('.').to_string());
    let shown: Vec<String> = params.iter().map(|(k, v)| format!("{k}={}", v.as_str().map_or_else(|| v.to_string(), |s| s.to_string()))).collect();
    let message = if shown.is_empty() { format!("{extension}/{route}") } else { format!("{extension}/{route} {}", shown.join(" ")) };
    (format!("\u{201c}{}\u{201d} from a link?", short(&what, 70)), message)
}

/// The form's fields prefilled from a `form` link's parameters: a matching
/// id gets its `default` (a checkbox reads `1 true yes on`); unknown ids
/// are ignored. Anything but a form comes back untouched.
pub fn prefill(mut envelope: Value, fill: &BTreeMap<String, String>) -> Value {
    if let Some(fields) = envelope.get_mut("form").and_then(|f| f.get_mut("fields")).and_then(Value::as_array_mut) {
        for f in fields {
            let Some(v) = f["id"].as_str().and_then(|id| fill.get(id)) else { continue };
            let value = if f["kind"] == "checkbox" { json!(matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on")) } else { json!(v) };
            f["default"] = value;
        }
    }
    envelope
}

async fn run_item(app: &AppHandle, route: Route, trusted: bool) {
    let Route::Run { source, id, action, args, fill } = &route else { return };
    let Some(host) = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()) else { return };
    if !known_palette(app, source) {
        return hud::show(app, &format!("pal: no palette {}/{}", source.extension, source.palette));
    }
    if asks(app, &route, trusted, false) {
        let (title, message) = run_question(source, id, item_name(app, source, id).as_deref(), action.as_deref(), fill.is_some());
        match confirm(app, &title, &message, if fill.is_some() { "Open" } else { "Run" }).await {
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
    match index::run_pick(app, &host, source, id, action.as_deref(), args.as_ref(), None).await {
        Ok(r) => {
            let r = fill.as_ref().map_or(r.clone(), |f| prefill(r, f));
            let name = item_name(app, source, id).unwrap_or_else(|| id.clone());
            let item = json!({ "id": id, "name": name, "palette": format!("{}/{}", source.extension, source.palette), "source": source, "args": args });
            deliver(app, item, r);
        }
        Err(e) => {
            eprintln!("deeplink\trun failed\t{}/{}\t{id}\t{e}", source.extension, source.palette);
            hud::show(app, &format!("pal: {e}"));
        }
    }
}

/// An extension's own route: the manifest's `links.<route>` says whether
/// it always asks and what to call it; the host checks the params and
/// runs `link(route, params)`; the answer is delivered like a pick's.
async fn run_ext(app: &AppHandle, route: Route, trusted: bool) {
    let Route::Ext { extension, route: name, params } = &route else { return };
    let Some(host) = app.try_state::<Arc<Host>>().map(|h| h.inner().clone()) else { return };
    let declared = settings::manifest_of(app, extension).map(|m| m["links"][name].clone()).filter(Value::is_object);
    let Some(declared) = declared else {
        return hud::show(app, &format!("pal: no route {extension}/{name}"));
    };
    if asks(app, &route, trusted, declared["confirm"] == true) {
        let (title, message) = ext_question(extension, name, declared["description"].as_str(), params);
        match confirm(app, &title, &message, "Run").await {
            Some(true) => {
                on_main(app, panel::hide);
                tokio::time::sleep(Duration::from_millis(80)).await;
            }
            Some(false) => {
                on_main(app, panel::hide);
                return eprintln!("deeplink\tlink\tdeclined");
            }
            None => return eprintln!("deeplink\tlink\tunanswered"),
        }
    }
    let r = host.request("link", json!({ "extension": extension, "route": name, "params": params })).await;
    match r {
        Ok(r) => match effects::apply(app, r).await {
            Ok(r) => {
                let item = json!({ "id": name, "name": name, "palette": format!("{extension}/{name}"), "source": { "extension": extension, "palette": name } });
                deliver(app, item, r);
            }
            Err(e) => hud::show(app, &format!("pal: {e}")),
        },
        Err(e) => {
            eprintln!("deeplink\tlink failed\t{extension}/{name}\t{e}");
            hud::show(app, &format!("pal: {e}"));
        }
    }
}

async fn install(app: &AppHandle, spec: &str, trusted: bool) {
    if !trusted {
        let (title, message) = install_question(spec);
        match confirm(app, &title, &message, "Install").await {
            Some(true) => {}
            Some(false) => {
                on_main(app, panel::hide);
                return eprintln!("deeplink\tinstall\tdeclined");
            }
            None => return eprintln!("deeplink\tinstall\tunanswered"),
        }
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

/// `update` and `remove` from a link: always the card, then the store,
/// then the HUD's word on it.
async fn store(app: &AppHandle, route: Route, trusted: bool) {
    let (title, message, ok) = match &route {
        Route::Update { name: Some(n) } => (format!("Update {n} from a link?"), "Its source is fetched again".to_string(), "Update"),
        Route::Update { name: None } => ("Update every extension from a link?".to_string(), "Each one with a source is fetched again".to_string(), "Update"),
        Route::Remove { name } => (format!("Remove {name} from a link?"), "Its directory is deleted; its settings stay in the config file".to_string(), "Remove"),
        _ => return,
    };
    if !trusted {
        match confirm(app, &title, &message, ok).await {
            Some(true) => on_main(app, panel::hide),
            Some(false) => {
                on_main(app, panel::hide);
                return eprintln!("deeplink\tstore\tdeclined");
            }
            None => return eprintln!("deeplink\tstore\tunanswered"),
        }
    }
    let r: Result<String, String> = match route {
        Route::Update { name: Some(n) } => settings::extensions_update(app.clone(), app.state(), n).await.map(|i| format!("Updated {} {}", i.name, i.version)),
        Route::Update { name: None } => {
            let all = tauri::async_runtime::spawn_blocking(|| pal_core::extensions::Store::locate().list()).await.map_err(|e| e.to_string()).and_then(|r| r.map_err(|e| e.to_string()));
            match all {
                Ok(all) => {
                    let mut n = 0;
                    for i in all.iter().filter(|i| i.record.is_some()) {
                        match settings::extensions_update(app.clone(), app.state(), i.name.clone()).await {
                            Ok(_) => n += 1,
                            Err(e) => eprintln!("deeplink\tupdate\t{}\t{e}", i.name),
                        }
                    }
                    Ok(format!("Updated {n} {}", if n == 1 { "extension" } else { "extensions" }))
                }
                Err(e) => Err(e),
            }
        }
        Route::Remove { name } => settings::extensions_remove(app.clone(), app.state(), name.clone()).await.map(|()| format!("Removed {name}")),
        _ => return,
    };
    match r {
        Ok(t) => hud::show(app, &t),
        Err(e) => hud::show(app, &format!("pal: {e}")),
    }
}

// ---- copy deep link ------------------------------------------------------------

/// "Copy deep link" (the Launcher's shell action): the panel hides, the
/// link goes on the clipboard with the bundle's scheme, the HUD says so.
#[tauri::command]
pub async fn link_copy(app: AppHandle, link: String) -> Result<(), String> {
    let link = with_scheme(&link, &scheme(&app));
    on_main(&app, panel::hide);
    effects::apply(&app, json!({ "copy": link, "hud": format!("Copied {link}") })).await.map(|_| ())
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

    fn run(e: &str, p: &str, id: &str) -> Route {
        run_with(e, p, id, None, None, None)
    }

    fn run_with(e: &str, p: &str, id: &str, action: Option<&str>, args: Option<Value>, fill: Option<BTreeMap<String, String>>) -> Route {
        Route::Run { source: src(e, p), id: id.into(), action: action.map(String::from), args, fill }
    }

    #[test]
    fn window_routes() {
        assert_eq!(parse("pal://toggle"), Ok(Route::Toggle));
        assert_eq!(parse("pal://show"), Ok(Route::Show));
        assert_eq!(parse("pal://"), Ok(Route::Show), "an empty link shows, as raycast:// does");
        assert_eq!(parse("pal://hide/"), Ok(Route::Hide), "a trailing slash is nothing");
        assert_eq!(parse("palscratch://toggle"), Ok(Route::Toggle), "the scheme is the plugin's business");
        assert_eq!(parse("pal://reload"), Ok(Route::Reload));
        assert_eq!(parse("pal://quit"), Ok(Route::Quit));
    }

    #[test]
    fn settings_routes() {
        assert_eq!(parse("pal://settings"), Ok(Route::Settings(None)));
        assert_eq!(parse("pal://settings/about"), Ok(Route::Settings(Some("about".into()))));
        assert_eq!(parse("pal://settings/bar"), Ok(Route::Settings(Some("bar".into()))));
        assert_eq!(parse("pal://extensions"), Ok(Route::Settings(Some("extensions".into()))), "the old spelling stays an alias");
        assert!(parse("pal://settings/nope").is_err());
    }

    #[test]
    fn commands_are_pals_own_rows() {
        assert_eq!(parse("pal://commands/refresh"), Ok(Route::Command { id: "refresh".into() }));
        assert_eq!(parse("pal://run/pal/commands/theme"), Ok(Route::Command { id: "theme".into() }), "the run spelling of a pal row is the same route");
        assert!(parse("pal://commands").is_err());
    }

    #[test]
    fn open_carries_the_query_and_filter_decoded() {
        let open = |q: Option<&str>, f: Option<&str>| Route::Open { source: src("emoji", "emoji"), query: q.map(String::from), filter: f.map(String::from) };
        assert_eq!(parse("pal://open/emoji/emoji?q=smile"), Ok(open(Some("smile"), None)));
        assert_eq!(parse("pal://open/emoji/emoji?q=two+words%21&x=1"), Ok(open(Some("two words!"), None)));
        assert_eq!(parse("pal://open/emoji/emoji?q="), Ok(open(None, None)));
        assert_eq!(parse("pal://open/emoji/emoji?filter=links"), Ok(open(None, Some("links"))));
        assert_eq!(parse("pal://open/emoji/emoji#frag"), Ok(open(None, None)));
        assert!(parse("pal://open/emoji/emoji/more").is_err());
        assert!(matches!(parse("pal://open/emoji"), Ok(Route::Ext { .. })), "two parts with no reserved word is an extension route, not a palette");
    }

    #[test]
    fn open_with_a_url_is_the_os_opener() {
        assert_eq!(parse("pal://open?url=https%3A%2F%2Fa.b%2Fc"), Ok(Route::OpenUrl { target: "https://a.b/c".into() }));
        assert_eq!(parse("pal://open?path=/tmp/x"), Ok(Route::OpenUrl { target: "/tmp/x".into() }));
        assert_eq!(parse("pal://open"), Err("url is required".into()));
    }

    #[test]
    fn run_names_the_item_action_and_args() {
        assert_eq!(parse("pal://run/apps/apps/x"), Ok(run("apps", "apps", "x")));
        assert_eq!(parse("pal://run/apps/apps/com.apple.Safari?action=quit"), Ok(run_with("apps", "apps", "com.apple.Safari", Some("quit"), None, None)));
        assert_eq!(parse("pal://run/a/b/with%2Fslash"), Ok(run("a", "b", "with/slash")), "an encoded slash stays inside the id");
        assert_eq!(parse("pal://run/files/files/x?args=%7B%22open_with%22%3A%22%2Ftmp%22%7D"), Ok(run_with("files", "files", "x", None, Some(json!({ "open_with": "/tmp" })), None)));
        assert!(parse("pal://run/a/b/c?args=nope").unwrap_err().starts_with("args is not JSON: "));
        assert!(parse("pal://run/a/b").is_err());
    }

    #[test]
    fn form_is_a_run_with_the_fields_to_fill() {
        let r = parse("pal://form/quicklinks/quicklinks/create?action=create&name=GitHub&url=https%3A%2F%2Fgithub.com").unwrap();
        let Route::Run { fill: Some(fill), action, .. } = r else { panic!("{r:?}") };
        assert_eq!(action.as_deref(), Some("create"));
        assert_eq!(fill, BTreeMap::from([("name".to_string(), "GitHub".to_string()), ("url".to_string(), "https://github.com".to_string())]), "action and args are not fields");
        assert_eq!(parse("pal://form/a/b/c"), Ok(run_with("a", "b", "c", None, None, Some(BTreeMap::new()))));
    }

    #[test]
    fn prefill_sets_defaults_by_id_and_reads_checkboxes() {
        let form = json!({ "form": { "title": "T", "fields": [{ "id": "name", "kind": "text" }, { "id": "pin", "kind": "checkbox", "default": false }, { "id": "other", "kind": "text", "default": "keep" }], "submit": { "id": "save", "title": "Save" } } });
        let fill = BTreeMap::from([("name".to_string(), "GitHub".to_string()), ("pin".to_string(), "yes".to_string()), ("ghost".to_string(), "x".to_string())]);
        let out = prefill(form, &fill);
        assert_eq!(out["form"]["fields"][0]["default"], "GitHub");
        assert_eq!(out["form"]["fields"][1]["default"], true);
        assert_eq!(out["form"]["fields"][2]["default"], "keep", "a field the link does not name keeps its default");
        assert_eq!(out["form"]["fields"].as_array().unwrap().len(), 3, "an unknown id adds no field");
        assert_eq!(prefill(json!({ "toast": { "title": "t" } }), &fill), json!({ "toast": { "title": "t" } }), "anything but a form is untouched");
    }

    #[test]
    fn effects_take_their_text() {
        assert_eq!(parse("pal://copy?text=hi+there"), Ok(Route::Copy { text: "hi there".into() }));
        assert_eq!(parse("pal://copy"), Err("text is required".into()));
        assert_eq!(parse("pal://paste?text=x"), Ok(Route::Paste { text: "x".into() }));
        assert_eq!(parse("pal://hud?text=Done"), Ok(Route::Hud { text: "Done".into() }));
        assert_eq!(parse("pal://toast?title=Deployed&message=v1.2"), Ok(Route::Toast { title: "Deployed".into(), message: Some("v1.2".into()) }));
        assert_eq!(parse("pal://toast?message=x"), Err("title is required".into()));
        assert_eq!(parse("pal://confetti"), Ok(Route::Confetti { text: None }));
        assert_eq!(parse("pal://confetti?text=Shipped"), Ok(Route::Confetti { text: Some("Shipped".into()) }));
    }

    #[test]
    fn install_keeps_the_spec_whole() {
        assert_eq!(parse("pal://install/github:zcag/pal/examples/hello-extension@pali"), Ok(Route::Install { spec: "github:zcag/pal/examples/hello-extension@pali".into() }));
        assert_eq!(parse("pal://install//Users/me/ext"), Ok(Route::Install { spec: "/Users/me/ext".into() }), "a local directory keeps its leading slash");
        assert_eq!(parse("pal://install/https%3A%2F%2Fgithub.com%2Fu%2Fr"), Ok(Route::Install { spec: "https://github.com/u/r".into() }));
        assert_eq!(parse("pal://install/wordle"), Ok(Route::Install { spec: "wordle".into() }), "a store name");
        assert!(parse("pal://install").is_err());
        assert!(parse("pal://install/").is_err());
        assert!(pal_core::extensions::Spec::parse("github:zcag/pal/examples/hello-extension@pali").is_ok(), "the site's button emits what the store parses");
    }

    #[test]
    fn update_and_remove() {
        assert_eq!(parse("pal://update"), Ok(Route::Update { name: None }));
        assert_eq!(parse("pal://update/wordle"), Ok(Route::Update { name: Some("wordle".into()) }));
        assert_eq!(parse("pal://remove/wordle"), Ok(Route::Remove { name: "wordle".into() }));
        assert!(parse("pal://remove").is_err(), "remove needs a name");
    }

    #[test]
    fn bar_is_the_item_key_with_an_optional_action() {
        assert_eq!(parse("pal://bar/battery/main"), Ok(Route::Bar { key: "battery/main".into(), action: None }));
        assert_eq!(parse("pal://bar/timer/timer?action=stop"), Ok(Route::Bar { key: "timer/timer".into(), action: Some("stop".into()) }));
    }

    #[test]
    fn extension_routes_carry_every_param_and_repeat_into_arrays() {
        let r = parse("pal://timer/start?duration=25m&name=tea&tag=a&tag=b").unwrap();
        assert_eq!(r, Route::Ext { extension: "timer".into(), route: "start".into(), params: json!({ "duration": "25m", "name": "tea", "tag": ["a", "b"] }).as_object().unwrap().clone() });
        assert_eq!(parse("pal://calendar/join-next"), Ok(Route::Ext { extension: "calendar".into(), route: "join-next".into(), params: Map::new() }));
        assert!(parse("pal://Timer/start").is_err(), "names are lowercase");
        assert!(parse("pal://timer/start/more").is_err(), "a route is two parts");
        assert_eq!(parse("pal://window-management/layout?name=left_half").unwrap().extension(), Some("window-management"));
    }

    #[test]
    fn reserved_words_shadow_an_extension_of_that_name() {
        // `open/x` would be an extension `open` with route `x`; the table's `open` forms win.
        assert!(parse("pal://open/x").map(|r| matches!(r, Route::Ext { .. })).unwrap_or(false), "one extra part after a reserved word falls through to the catch-all");
        assert!(matches!(parse("pal://settings/general"), Ok(Route::Settings(_))));
        assert!(matches!(parse("pal://commands/quit"), Ok(Route::Command { .. })), "not the extension `commands`");
        for spec in ROUTES {
            let first = spec.pattern.split('/').next().unwrap_or_default();
            if !first.is_empty() && !first.starts_with('{') {
                assert!(name_ok(first), "{first}: a reserved word looks like an extension name, so the table order settles it");
            }
        }
    }

    #[test]
    fn every_route_in_the_table_parses_to_its_route() {
        // One example per pattern, in table order: a table entry without a test here is a mistake.
        let examples = [
            ("pal://", "Show"), ("pal://show", "Show"), ("pal://hide", "Hide"), ("pal://toggle", "Toggle"), ("pal://settings", "Settings"), ("pal://settings/bar", "Settings"),
            ("pal://extensions", "Settings"), ("pal://reload", "Reload"), ("pal://quit", "Quit"), ("pal://commands/theme", "Command"), ("pal://run/pal/commands/theme", "Command"),
            ("pal://open/a/b", "Open"), ("pal://open?url=x", "OpenUrl"), ("pal://run/a/b/c", "Run"), ("pal://form/a/b/c", "Run"), ("pal://copy?text=x", "Copy"), ("pal://paste?text=x", "Paste"),
            ("pal://hud?text=x", "Hud"), ("pal://toast?title=x", "Toast"), ("pal://confetti", "Confetti"), ("pal://install/x", "Install"), ("pal://update", "Update"), ("pal://update/x", "Update"),
            ("pal://remove/x", "Remove"), ("pal://bar/a/b", "Bar"), ("pal://timer/start", "Ext"),
        ];
        assert_eq!(examples.len(), ROUTES.len(), "one example per table row");
        for (link, variant) in examples {
            let r = parse(link).unwrap_or_else(|e| panic!("{link}: {e}"));
            let name = format!("{r:?}");
            let name = name.split(|c: char| !c.is_alphanumeric()).next().unwrap_or_default();
            assert_eq!(name, variant, "{link}");
        }
        for spec in ROUTES {
            assert!(!spec.doc.is_empty(), "{}: a doc line for `pal link --list`", spec.pattern);
        }
    }

    #[test]
    fn refusals() {
        assert!(parse("toggle").is_err(), "no scheme");
        assert!(parse("pal://nope").is_err(), "one part that is no route");
        assert!(parse("pal://open/a/%FF").is_err(), "bad utf-8");
        assert!(parse(&format!("pal://open/a/b?q={}", "x".repeat(MAX_LEN))).is_err());
        assert_eq!(refusal("unknown route \"nope\""), "pal: unknown link");
        assert_eq!(refusal("text is required"), "pal: text is required");
        assert_eq!(refusal("args is not JSON: x"), "pal: args is not JSON: x");
    }

    #[test]
    fn schemes() {
        assert_eq!(with_scheme("pal://run/a/b/c", "palscratch"), "palscratch://run/a/b/c");
        assert_eq!(with_scheme("run/a/b/c", "palscratch"), "run/a/b/c");
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
        let (t, m) = run_question(&src("apps", "apps"), "com.apple.Safari", Some("Safari"), None, false);
        assert_eq!(t, "Run \u{201c}Safari\u{201d} from a link?");
        assert_eq!(m, "apps/apps \u{203a} com.apple.Safari");
        let (t, _) = run_question(&src("apps", "apps"), "x", None, Some("quit"), false);
        assert_eq!(t, "Run quit on \u{201c}x\u{201d} from a link?", "no row in the index: the id stands in");
        let (t, _) = run_question(&src("quicklinks", "quicklinks"), "create", Some("Create Quicklink"), Some("create"), true);
        assert_eq!(t, "Open the form of \u{201c}Create Quicklink\u{201d} from a link?");
        let (t, m) = install_question("github:zcag/pal/examples/hello-extension@pali");
        assert_eq!(t, "Install hello-extension from a link?");
        assert_eq!(m, "github:zcag/pal/examples/hello-extension@pali");
        assert_eq!(install_question("github:u/repo").0, "Install repo from a link?");
        assert_eq!(install_question("/tmp/ext/").0, "Install ext from a link?");
        assert_eq!(install_question("github:").0, "Install an extension from a link?");
        assert_eq!(paste_question("a\nb").0, "Paste \u{201c}a b\u{201d} from a link?");
        assert_eq!(bar_question("timer/timer", "stop"), ("Run stop on the bar item timer/timer from a link?".into(), "bar/timer/timer".into()));
        let params = json!({ "duration": "25m", "tag": ["a", "b"] }).as_object().unwrap().clone();
        let (t, m) = ext_question("timer", "start", Some("Start a timer."), &params);
        assert_eq!(t, "\u{201c}Start a timer\u{201d} from a link?");
        assert_eq!(m, "timer/start duration=25m tag=[\"a\",\"b\"]");
        assert_eq!(ext_question("timer", "start", None, &Map::new()), ("\u{201c}timer/start\u{201d} from a link?".into(), "timer/start".into()));
    }

    #[test]
    fn the_allowlist_is_by_the_extension_in_the_path() {
        use pal_core::config::Confirm;
        let list = Confirm::Except(vec!["timer".into()]);
        assert!(!list.asks(parse("pal://timer/start").unwrap().extension()));
        assert!(list.asks(parse("pal://run/apps/apps/x").unwrap().extension()));
        assert!(!list.asks(parse("pal://run/timer/timers/x").unwrap().extension()));
        assert!(list.asks(parse("pal://paste?text=x").unwrap().extension()), "an app-level route has no extension to allow");
        assert!(!list.asks(parse("pal://bar/timer/timer?action=stop").unwrap().extension()), "a bar item's extension is the key's first part");
        assert!(!Confirm::All(false).asks(None));
        assert!(Confirm::All(true).asks(Some("timer")));
    }
}
