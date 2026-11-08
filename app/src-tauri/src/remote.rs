//! pal's UI served to a browser on another device (docs/design/remote.md).
//! With `[remote] enabled` an HTTP server on `[remote] port` serves the
//! frontend from the shell's own assets, `icon://` and `ext://` as the
//! `/__icon/` and `/__ext/` routes through the same handlers, and the IPC
//! socket at `/__pal/ws`. A call on the socket goes to the command handlers
//! through Tauri's own entry point (`Webview::on_message`) on the panel's
//! webview, with the connection's label in a header that [`Caller`] reads;
//! events reach the socket through `events::emit`/`emit_to`. A connection's
//! label is `remote:<id>:<page>`, chosen by the page (app/src/remote.ts).

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, CommandArg, CommandItem, InvokeBody, InvokeError, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::mpsc;

use crate::lock;

/// What every remote label starts with.
pub const PREFIX: &str = "remote:";
/// The header a remote call carries its connection's label in.
const CALLER_HEADER: &str = "x-pal-caller";
/// The cookie a token sign-in is kept in.
const COOKIE: &str = "pal_token";
/// The pages a connection may stand for: the panel, the bar popover, Settings.
const PAGES: [&str; 3] = ["main", "bar", "settings"];

/// The page a remote label stands for (`main`, `bar`, `settings`), or
/// `None` for a local window's label.
pub fn page_of(label: &str) -> Option<&str> {
    let rest = label.strip_prefix(PREFIX)?;
    let (_, page) = rest.split_once(':')?;
    PAGES.contains(&page).then_some(page)
}

pub fn is_remote(label: &str) -> bool {
    page_of(label).is_some()
}

/// Which page called a command: the calling window's label, or a remote
/// connection's (docs/design/remote.md, "Callers"). Commands that care
/// which page called take this instead of `tauri::Window`.
pub struct Caller(pub String);

impl Caller {
    pub fn label(&self) -> &str {
        &self.0
    }
}

impl<'de, R: Runtime> CommandArg<'de, R> for Caller {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let remote = command.message.headers().get(CALLER_HEADER).and_then(|v| v.to_str().ok()).filter(|l| connected(l));
        Ok(Caller(remote.map_or_else(|| command.message.webview_ref().window_ref().label().to_string(), str::to_string)))
    }
}

// ---- connections ---------------------------------------------------------

struct Conn {
    /// Which socket holds the label: a page that reconnects takes it over
    /// while its old socket may still be closing.
    gen: u64,
    tx: mpsc::UnboundedSender<Message>,
    events: HashSet<String>,
}

#[derive(Default)]
struct Conns(Mutex<HashMap<String, Conn>>);

static CONNS: std::sync::OnceLock<Conns> = std::sync::OnceLock::new();

fn conns() -> &'static Conns {
    CONNS.get_or_init(Conns::default)
}

fn connected(label: &str) -> bool {
    lock(&conns().0).contains_key(label)
}

/// An event to every connection listening for it (`target: None`), or to
/// the one connection `target` names. Called by `events::emit`/`emit_to`;
/// the payload is serialised once, and only when someone listens.
pub fn send<S: Serialize>(event: &str, target: Option<&str>, payload: &S) {
    send_where(event, target, payload, |label| target.is_none_or(|t| t == label));
}

/// An event to every connected home page (`main`) listening for it: what
/// no page asked for (a HUD line from a link or a timer) is shown once per
/// device, not again in a bar sheet open over it.
pub fn send_home<S: Serialize>(event: &str, payload: &S) {
    send_where(event, None, payload, |label| page_of(label) == Some("main"));
}

fn send_where<S: Serialize>(event: &str, target: Option<&str>, payload: &S, to: impl Fn(&str) -> bool) {
    let conns = lock(&conns().0);
    let wants = |(label, c): &(&String, &Conn)| c.events.contains(event) && to(label);
    if !conns.iter().any(|e| wants(&e)) {
        return;
    }
    let Ok(payload) = serde_json::to_value(payload) else { return };
    let text = json!({ "event": event, "target": target, "payload": payload }).to_string();
    for (_, c) in conns.iter().filter(wants) {
        let _ = c.tx.send(Message::Text(text.clone().into()));
    }
}

/// Every page's socket closed; each page's own loop then forgets it.
fn close_all() {
    for c in lock(&conns().0).values() {
        let _ = c.tx.send(Message::Close(None));
    }
}

/// Whether any page is connected: the bar's `web` target draws while one is.
pub fn any_connected() -> bool {
    !lock(&conns().0).is_empty()
}

// ---- the server ----------------------------------------------------------

/// The running server: its port and the task serving it.
#[derive(Default)]
pub struct Server(Mutex<Option<(u16, tauri::async_runtime::JoinHandle<()>)>>);

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
}

pub fn install(app: &AppHandle) {
    app.manage(Server::default());
    apply(app, &crate::settings::config(app).remote);
}

pub fn apply_config(app: &AppHandle, prev: &pal_core::config::Config, next: &pal_core::config::Config) {
    if prev.remote.enabled != next.remote.enabled || prev.remote.port != next.remote.port {
        apply(app, &next.remote);
    }
}

fn apply(app: &AppHandle, remote: &pal_core::config::Remote) {
    let server = app.state::<Server>();
    let mut running = lock(&server.0);
    if let Some((port, task)) = running.take() {
        task.abort();
        close_all();
        eprintln!("remote\tstopped\t:{port}");
    }
    if !remote.enabled {
        return;
    }
    let port = remote.port;
    let ctx = Ctx { app: app.clone() };
    let router = Router::new()
        .route("/__pal/ws", get(socket))
        .route("/__icon/{*rest}", get(icon))
        .route("/__ext/{*rest}", get(ext))
        .fallback(get(asset))
        .with_state(ctx);
    let task = tauri::async_runtime::spawn(async move {
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                eprintln!("remote\tserving\t:{port}");
                if let Err(e) = axum::serve(l, router.into_make_service_with_connect_info::<SocketAddr>()).await {
                    eprintln!("remote\tstopped\t:{port}\t{e}");
                }
            }
            Err(e) => eprintln!("remote\tcannot listen\t:{port}\t{e}"),
        }
    });
    *running = Some((port, task));
}

// ---- auth ----------------------------------------------------------------

#[derive(Deserialize)]
struct Auth {
    token: Option<String>,
}

/// Whether the request may in: with the token (the query's, else the
/// cookie's), or from one of the user's own tailnet devices when the page
/// is named for this machine. This machine is no exception: a reverse proxy
/// on it would let anyone in as loopback. Behind a proxy in
/// `[remote] trusted_proxies` the device is the last `X-Forwarded-For` hop.
async fn allowed(app: &AppHandle, peer: IpAddr, headers: &HeaderMap, query: Option<&str>) -> bool {
    let token = token(app);
    let given = query.map(str::to_string).or_else(|| cookie(headers));
    if !token.is_empty() && given.as_deref().is_some_and(|g| eq(g.as_bytes(), token.as_bytes())) {
        return true;
    }
    let proxies = crate::settings::config(app).remote.trusted_proxies;
    named_for_us(headers) && tailnet::own(proxy::client(&proxies, peer, headers).await).await
}

/// Whether the page's host could be this machine's own name: an address, a
/// bare hostname, a tailnet or a `.lan` name. A page on another site that
/// rebinds its own name to this machine sends that name, and trust by
/// address must not let it in.
fn named_for_us(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get(header::HOST).and_then(|h| h.to_str().ok()) else { return false };
    let host = host.rsplit_once(':').filter(|(_, p)| p.bytes().all(|b| b.is_ascii_digit())).map_or(host, |(h, _)| h).trim_matches(['[', ']']).to_ascii_lowercase();
    host.parse::<IpAddr>().is_ok() || !host.contains('.') || host.ends_with(".ts.net") || host.ends_with(".lan")
}

/// Whether a browser says another site's page opened this (`Origin` not the
/// page's own host): a socket a foreign page opens carries the device's
/// address, which proves the device, not the page.
fn from_another_site(headers: &HeaderMap) -> bool {
    let (Some(origin), Some(host)) = (headers.get(header::ORIGIN).and_then(|h| h.to_str().ok()), headers.get(header::HOST).and_then(|h| h.to_str().ok())) else { return false };
    url::Url::parse(origin).ok().is_none_or(|u| u.host_str().map(|h| u.port().map_or(h.to_string(), |p| format!("{h}:{p}"))).as_deref() != Some(host))
}

mod proxy {
    use std::net::IpAddr;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use axum::http::HeaderMap;

    static CONTAINERS: Mutex<Option<(Instant, Vec<IpAddr>)>> = Mutex::new(None);

    /// The device behind `peer`: the last `X-Forwarded-For` hop when `peer`
    /// is a trusted proxy (an address, a CIDR, or `docker:<container>`),
    /// else `peer`.
    pub async fn client(trusted: &[String], peer: IpAddr, headers: &HeaderMap) -> IpAddr {
        if !trusts(trusted, peer).await {
            return peer;
        }
        headers.get("x-forwarded-for").and_then(|h| h.to_str().ok()).and_then(|v| v.rsplit(',').next()).and_then(|ip| ip.trim().parse().ok()).unwrap_or(peer)
    }

    async fn trusts(trusted: &[String], ip: IpAddr) -> bool {
        if trusted.iter().any(|t| t.parse::<IpAddr>().is_ok_and(|a| a == ip) || cidr(t, ip)) {
            return true;
        }
        let names: Vec<&str> = trusted.iter().filter_map(|t| t.strip_prefix("docker:")).collect();
        !names.is_empty() && containers(&names).await.contains(&ip)
    }

    fn cidr(spec: &str, ip: IpAddr) -> bool {
        let Some((net, bits)) = spec.split_once('/') else { return false };
        let (Ok(net), Ok(bits)) = (net.parse::<IpAddr>(), bits.parse::<u32>()) else { return false };
        match (net, ip) {
            (IpAddr::V4(n), IpAddr::V4(i)) if bits <= 32 => bits == 0 || (u32::from(n) ^ u32::from(i)) >> (32 - bits) == 0,
            (IpAddr::V6(n), IpAddr::V6(i)) if bits <= 128 => bits == 0 || (u128::from(n) ^ u128::from(i)) >> (128 - bits) == 0,
            _ => false,
        }
    }

    /// The containers' addresses (`docker inspect`), looked up again after a minute.
    async fn containers(names: &[&str]) -> Vec<IpAddr> {
        if let Some((_, ips)) = crate::lock(&CONTAINERS).as_ref().filter(|(at, _)| at.elapsed() < Duration::from_secs(60)) {
            return ips.clone();
        }
        let out = tokio::process::Command::new("docker").args(["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}"]).args(names).output().await;
        let ips: Vec<IpAddr> = out.ok().map(|o| String::from_utf8_lossy(&o.stdout).split_whitespace().filter_map(|s| s.parse().ok()).collect()).unwrap_or_default();
        *crate::lock(&CONTAINERS) = Some((Instant::now(), ips.clone()));
        ips
    }

    #[cfg(test)]
    #[test]
    fn a_cidr_holds_its_addresses() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        assert!(cidr("172.18.0.0/16", ip("172.18.4.2")));
        assert!(!cidr("172.18.0.0/16", ip("172.19.0.2")));
        assert!(cidr("10.0.0.5/32", ip("10.0.0.5")));
        assert!(!cidr("10.0.0.0/8", ip("::1")));
    }
}

fn cookie(headers: &HeaderMap) -> Option<String> {
    headers.get_all(header::COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|c| c.trim().strip_prefix(&format!("{COOKIE}=")).map(str::to_string))
}

/// Constant-time equality, so the token is not read off the answer's timing.
fn eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// Where the token is kept: pal's data folder, readable by the user alone.
fn token_file(app: &AppHandle) -> std::path::PathBuf {
    crate::welcome::data_dir(app).join("remote-token")
}

/// The token, made on first use.
fn token(app: &AppHandle) -> String {
    match std::fs::read_to_string(token_file(app)) {
        Ok(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => replace_token(app).unwrap_or_default(),
    }
}

/// A fresh token (two v4 uuids, 244 random bits), written with mode 0600.
fn replace_token(app: &AppHandle) -> Result<String, String> {
    let t = uuid::Uuid::new_v4().simple().to_string() + &uuid::Uuid::new_v4().simple().to_string();
    let path = token_file(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    std::io::Write::write_all(&mut o.open(&path).map_err(|e| e.to_string())?, t.as_bytes()).map_err(|e| e.to_string())?;
    Ok(t)
}

const SIGN_IN: &str = "<!doctype html><meta name=viewport content=\"width=device-width\"><title>pal</title><body style=\"font:16px system-ui;padding:2rem;max-width:30rem;margin:auto\"><h1>pal</h1><p>This page needs the token from Settings › General › Remote on the machine pal runs on.</p><form><input name=token placeholder=Token autofocus style=\"font:inherit;width:100%;padding:.5rem\"></form>";

mod tailnet {
    use std::collections::HashMap;
    use std::net::IpAddr;
    use std::sync::Mutex;

    use serde_json::Value;

    static SEEN: Mutex<Option<HashMap<IpAddr, bool>>> = Mutex::new(None);

    /// Whether `peer` is a device of the tailnet user this machine belongs
    /// to (`tailscale whois`), remembered per address for the run.
    pub async fn own(peer: IpAddr) -> bool {
        if let Some(&known) = crate::lock(&SEEN).get_or_insert_with(HashMap::new).get(&peer) {
            return known;
        }
        let ok = check(peer).await.unwrap_or(false);
        crate::lock(&SEEN).get_or_insert_with(HashMap::new).insert(peer, ok);
        ok
    }

    async fn json(args: &[&str]) -> Option<Value> {
        let out = tokio::process::Command::new("tailscale").args(args).output().await.ok()?;
        out.status.success().then(|| serde_json::from_slice(&out.stdout).ok()).flatten()
    }

    async fn check(peer: IpAddr) -> Option<bool> {
        let me = json(&["status", "--json"]).await?;
        let my_user = me["Self"]["UserID"].as_u64()?;
        let who = json(&["whois", "--json", &peer.to_string()]).await?;
        Some(who["UserProfile"]["ID"].as_u64() == Some(my_user) || who["Node"]["User"].as_u64() == Some(my_user))
    }
}

// ---- routes --------------------------------------------------------------

/// The answer to a request that may not in.
type Refusal = Box<Response>;

async fn gate(ctx: &Ctx, peer: SocketAddr, headers: &HeaderMap, token: Option<&str>) -> Result<(), Refusal> {
    if from_another_site(headers) {
        return Err(Box::new((StatusCode::FORBIDDEN, "another site's page").into_response()));
    }
    if allowed(&ctx.app, peer.ip(), headers, token).await {
        return Ok(());
    }
    Err(Box::new((StatusCode::UNAUTHORIZED, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], SIGN_IN).into_response()))
}

/// A response that sets the cookie when the request signed in with `?token=`.
fn remember(mut r: Response, token: Option<&str>) -> Response {
    if let Some(t) = token {
        if let Ok(v) = HeaderValue::from_str(&format!("{COOKIE}={t}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict")) {
            r.headers_mut().append(header::SET_COOKIE, v);
        }
    }
    r
}

async fn asset(State(ctx): State<Ctx>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Query(auth): Query<Auth>, uri: Uri) -> Response {
    if let Err(r) = gate(&ctx, peer, &headers, auth.token.as_deref()).await {
        return *r;
    }
    let path = match uri.path() {
        "/" => "/index.html",
        p => p,
    };
    let r = match frontend(&ctx.app, path) {
        Some((mime, bytes)) => ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, if path == "/index.html" { "no-cache".into() } else { "max-age=3600".to_string() })], bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    };
    remember(r, auth.token.as_deref())
}

/// A file of the frontend: the shell's embedded assets in a release build,
/// `app/dist` on disk in a dev one (which loads its pages from Vite).
fn frontend(app: &AppHandle, path: &str) -> Option<(String, Vec<u8>)> {
    if let Some(a) = app.asset_resolver().get(path.to_string()) {
        return Some((a.mime_type, a.bytes));
    }
    let rel = path.trim_start_matches('/');
    if rel.split('/').any(|s| s == "..") {
        return None;
    }
    let file = std::path::Path::new(crate::host::REPO).join("app/dist").join(rel);
    let bytes = std::fs::read(&file).ok()?;
    let mime = match file.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "html" => "text/html",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "json" | "webmanifest" => "application/json",
        _ => "application/octet-stream",
    };
    Some((mime.to_string(), bytes))
}

/// `/__icon/<rest>` and `/__ext/<rest>` as the scheme `icon://localhost/<rest>`
/// or `ext://localhost/<rest>` answers them.
async fn scheme(ctx: &Ctx, peer: SocketAddr, headers: &HeaderMap, uri: &Uri, name: &str) -> Result<tauri::http::Request<Vec<u8>>, Refusal> {
    gate(ctx, peer, headers, None).await?;
    let rest = uri.path_and_query().map_or("", |p| p.as_str()).trim_start_matches(&format!("/__{name}/"));
    tauri::http::Request::builder().uri(format!("{name}://localhost/{rest}")).body(Vec::new()).map_err(|_| Box::new(StatusCode::BAD_REQUEST.into_response()))
}

fn convert(r: tauri::http::Response<Vec<u8>>) -> Response {
    let (parts, body) = r.into_parts();
    Response::from_parts(parts, axum::body::Body::from(body))
}

async fn icon(State(ctx): State<Ctx>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, uri: Uri) -> Response {
    match scheme(&ctx, peer, &headers, &uri, "icon").await {
        Ok(req) => {
            let app = ctx.app.clone();
            tauri::async_runtime::spawn_blocking(move || convert(crate::icon::respond(&app, &req))).await.unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(r) => *r,
    }
}

async fn ext(State(ctx): State<Ctx>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, uri: Uri) -> Response {
    match scheme(&ctx, peer, &headers, &uri, "ext").await {
        Ok(req) => convert(crate::surface::respond(&ctx.app, &req).await),
        Err(r) => *r,
    }
}

// ---- the socket ----------------------------------------------------------

#[derive(Deserialize)]
struct Join {
    label: String,
    token: Option<String>,
}

/// A label a page may take: `remote:<id>:<page>`, the id a short run of
/// letters and digits.
fn valid_label(label: &str) -> bool {
    let Some(rest) = label.strip_prefix(PREFIX) else { return false };
    let Some((id, _)) = rest.split_once(':') else { return false };
    page_of(label).is_some() && (1..=32).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

async fn socket(State(ctx): State<Ctx>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, Query(join): Query<Join>, ws: WebSocketUpgrade) -> Response {
    if let Err(r) = gate(&ctx, peer, &headers, join.token.as_deref()).await {
        return *r;
    }
    if !valid_label(&join.label) {
        return (StatusCode::BAD_REQUEST, "bad label").into_response();
    }
    ws.on_upgrade(move |s| serve(ctx.app, join.label, s))
}

/// What a page sends: a call, an event it now listens to or no longer
/// does, or an event it emits (the confirm card's reply).
#[derive(Deserialize)]
#[serde(untagged)]
enum Incoming {
    Call { id: u64, cmd: String, #[serde(default)] args: Value },
    Listen { listen: String },
    Unlisten { unlisten: String },
    Visible { visible: bool },
    Emit { emit: String, #[serde(default)] payload: Value },
}

async fn serve(app: AppHandle, label: String, socket: WebSocket) {
    use futures_util::{SinkExt, StreamExt};
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let gen = GEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let first = {
        let mut conns = lock(&conns().0);
        conns.insert(label.clone(), Conn { gen, tx: tx.clone(), events: HashSet::new() });
        conns.len() == 1
    };
    eprintln!("remote\tconnected\t{label}");
    if first {
        crate::bar::on_pages(&app, true);
    }
    crate::views::set_visible(&app, &label, true, false);
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(m).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(msg)) = stream.next().await {
        let Message::Text(text) = msg else { continue };
        match serde_json::from_str::<Incoming>(&text) {
            Ok(Incoming::Call { id, cmd, args }) => {
                let (app, label, tx) = (app.clone(), label.clone(), tx.clone());
                tauri::async_runtime::spawn(async move {
                    let reply = match call(&app, &label, cmd, args).await {
                        Ok(v) => json!({ "id": id, "ok": v }),
                        Err(e) => json!({ "id": id, "err": e }),
                    };
                    let _ = tx.send(Message::Text(reply.to_string().into()));
                });
            }
            Ok(Incoming::Listen { listen }) => {
                if let Some(c) = lock(&conns().0).get_mut(&label) {
                    c.events.insert(listen);
                }
            }
            Ok(Incoming::Unlisten { unlisten }) => {
                if let Some(c) = lock(&conns().0).get_mut(&label) {
                    c.events.remove(&unlisten);
                }
            }
            Ok(Incoming::Visible { visible }) => crate::views::set_visible(&app, &label, visible, false),
            Ok(Incoming::Emit { emit, payload }) if emit.starts_with("pal://") => {
                let _ = app.emit(&emit, payload);
            }
            Ok(Incoming::Emit { emit, .. }) => eprintln!("remote\trefused emit\t{label}\t{emit}"),
            Err(e) => eprintln!("remote\tbad message\t{label}\t{e}"),
        }
    }
    let (ours, last) = {
        let mut conns = lock(&conns().0);
        let ours = conns.get(&label).is_some_and(|c| c.gen == gen);
        if ours {
            conns.remove(&label);
        }
        (ours, conns.is_empty())
    };
    writer.abort();
    if !ours {
        return eprintln!("remote\treconnected\t{label}");
    }
    crate::views::report_gone(&app, &label);
    crate::bar::popover::on_page_gone(&app, &label);
    if last {
        crate::bar::on_pages(&app, false);
    }
    eprintln!("remote\tdisconnected\t{label}");
}

/// One call, through the command handlers the pages' `invoke` reaches:
/// `Webview::on_message` on the panel's webview, the request's url the
/// webview's own (a local origin, so the same access as the panel), the
/// caller's label in its headers. Plugin commands are the page's own
/// business (app/src/remote.ts answers them) and are refused here.
async fn call(app: &AppHandle, label: &str, cmd: String, args: Value) -> Result<Value, Value> {
    if cmd.starts_with("plugin:") {
        return Err(Value::String(format!("{cmd} is not served to a remote page")));
    }
    let webview = app.get_webview_window(crate::WINDOW).ok_or_else(|| Value::String("the panel's webview is not there".into()))?;
    let url = webview.url().map_err(|e| Value::String(e.to_string()))?;
    let mut headers = tauri::http::HeaderMap::new();
    headers.insert(CALLER_HEADER, tauri::http::HeaderValue::from_str(label).map_err(|e| Value::String(e.to_string()))?);
    let request = InvokeRequest { cmd, callback: CallbackFn(0), error: CallbackFn(1), url, body: InvokeBody::Json(args), headers, invoke_key: app.invoke_key().to_string() };
    let (tx, rx) = tokio::sync::oneshot::channel();
    let responder = Box::new(move |_: tauri::Webview, _: String, response: InvokeResponse, _: CallbackFn, _: CallbackFn| {
        let _ = tx.send(response);
    });
    app.run_on_main_thread(move || webview.on_message(request, responder)).map_err(|e| Value::String(e.to_string()))?;
    match rx.await.map_err(|_| Value::String("the command did not answer".into()))? {
        InvokeResponse::Ok(InvokeResponseBody::Json(s)) => Ok(serde_json::from_str(&s).unwrap_or(Value::Null)),
        InvokeResponse::Ok(InvokeResponseBody::Raw(b)) => Ok(Value::Array(b.into_iter().map(Value::from).collect())),
        InvokeResponse::Err(InvokeError(e)) => Err(e),
    }
}

// ---- Settings --------------------------------------------------------------

/// What Settings › General › Remote shows: whether it serves, where to open
/// it (this machine's hostname, never localhost), the token.
#[derive(Serialize)]
pub struct Status {
    enabled: bool,
    serving: bool,
    port: u16,
    url: String,
    address: String,
    trusted_proxies: Vec<String>,
    token: String,
    connected: usize,
}

#[tauri::command]
pub fn remote_status(app: AppHandle) -> Status {
    let remote = crate::settings::config(&app).remote;
    let serving = lock(&app.state::<Server>().0).as_ref().is_some_and(|(_, t)| !t.inner().is_finished());
    let url = if remote.address.is_empty() { format!("http://{}:{}", hostname(), remote.port) } else { remote.address.trim_end_matches('/').to_string() };
    Status { enabled: remote.enabled, serving, port: remote.port, url, address: remote.address, trusted_proxies: remote.trusted_proxies, token: token(&app), connected: lock(&conns().0).len() }
}

/// Settings' Replace: a new token; every page signed in with the old one
/// is signed out (its socket closes, its next request asks again).
#[tauri::command(async)]
pub fn remote_replace_token(app: AppHandle) -> Result<Status, String> {
    replace_token(&app)?;
    close_all();
    Ok(remote_status(app))
}

fn hostname() -> String {
    std::process::Command::new("hostname").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "this-machine".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_remote_label_names_its_page() {
        assert_eq!(page_of("remote:a1:main"), Some("main"));
        assert_eq!(page_of("remote:a1:bar"), Some("bar"));
        assert_eq!(page_of("main"), None);
        assert_eq!(page_of("remote:a1:hud"), None, "only the pages a browser shows");
        assert!(valid_label("remote:Zx9:settings"));
        assert!(!valid_label("remote::main"));
        assert!(!valid_label("remote:a-b:main"));
        assert!(!valid_label("main"));
    }

    #[test]
    fn the_token_cookie_is_read_among_others() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_static("a=1; pal_token=abc; b=2"));
        assert_eq!(cookie(&h).as_deref(), Some("abc"));
        assert!(eq(b"abc", b"abc"));
        assert!(!eq(b"abc", b"abd"));
        assert!(!eq(b"abc", b"ab"));
    }
}
