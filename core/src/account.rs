//! A pal account (docs/design/accounts.md, docs/accounts.md for the calls):
//! signing in with an email and a code, the token, the handle, the
//! devices, and the leaderboards a game posts to.
//!
//! The token lives in the keychain (`keychain:pal/account`, the store the
//! config's secrets use) and goes out as `Authorization: Bearer`; the
//! account's email and handle are cached in `<data dir>/account.json` for
//! display only, and that file existing is what makes the keychain worth
//! asking at start (a signed-out pal never touches it).
//!
//! Scores: signed out, a game's score goes out under the device's own
//! anonymous id (`<data dir>/anon-id`, made on the first score, never the
//! usage id), which signing in claims and deletes. A post that cannot
//! reach the server waits in `score-queue.json` and goes out with the next
//! sync tick ([`Account::flush_scores`]).
//!
//! None of these requests carries the usage id: they are built on a plain
//! agent here, never through `net::get`/`net::post` (docs/usage.md).

use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::secrets::{platform_store, SecretStore};
use crate::fs::write_atomic;

/// The account API; `PAL_ACCOUNT_API` overrides it (a local pal-site).
pub const API: &str = "https://pal.cagdas.io";
/// The token's keychain key: `keychain:pal/account`.
pub const TOKEN_KEY: &str = "pal/account";
const PROFILE: &str = "account.json";
const ANON: &str = "anon-id";
const QUEUE: &str = "score-queue.json";
const TIMEOUT: Duration = Duration::from_secs(15);

/// [`API`], or `PAL_ACCOUNT_API` when set.
pub fn api_base() -> String {
    std::env::var("PAL_ACCOUNT_API").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| API.into()).trim_end_matches('/').to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The server said no: its code (`code`, `taken`, `full`, ...) and its plain words.
    Api { status: u16, code: String, message: String },
    /// No answer: offline, a timeout, a server down.
    Offline(String),
    /// Not signed in, or the token was signed out elsewhere.
    SignedOut,
    /// Signed in without a handle: a score needs one first.
    Handle,
    /// Something on this machine: the keychain, a file.
    Local(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Api { message, code, .. } => write!(f, "{}", if message.is_empty() { code } else { message }),
            Error::Offline(_) => write!(f, "pal.cagdas.io can't be reached"),
            Error::SignedOut => write!(f, "not signed in"),
            Error::Handle => write!(f, "choose a handle"),
            Error::Local(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// One base URL, one token (or none): the calls.
pub struct Client {
    base: String,
    agent: ureq::Agent,
    token: Option<String>,
}

impl Client {
    pub fn new(base: &str, token: Option<String>) -> Client {
        // Statuses come back as answers: the error body says what went wrong.
        let agent = ureq::Agent::config_builder().user_agent(crate::net::user_agent()).timeout_global(Some(TIMEOUT)).http_status_as_error(false).build().new_agent();
        Client { base: base.trim_end_matches('/').to_string(), agent, token }
    }

    pub fn get(&self, path: &str) -> Result<Value> {
        self.call("GET", path, None)
    }

    pub fn post(&self, path: &str, body: &Value) -> Result<Value> {
        self.call("POST", path, Some(body))
    }

    pub fn put(&self, path: &str, body: &Value) -> Result<Value> {
        self.call("PUT", path, Some(body))
    }

    pub fn delete(&self, path: &str) -> Result<Value> {
        self.call("DELETE", path, None)
    }

    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value> {
        let url = format!("{}{path}", self.base);
        let auth = self.token.as_ref().map(|t| format!("Bearer {t}"));
        let r = match (method, body) {
            ("GET", _) | ("DELETE", None) => {
                let req = if method == "GET" { self.agent.get(&url) } else { self.agent.delete(&url) };
                match &auth {
                    Some(a) => req.header("Authorization", a).call(),
                    None => req.call(),
                }
            }
            _ => {
                let req = if method == "PUT" { self.agent.put(&url) } else { self.agent.post(&url) };
                let req = req.header("Content-Type", "application/json");
                let req = match &auth {
                    Some(a) => req.header("Authorization", a),
                    None => req,
                };
                req.send(serde_json::to_vec(body.unwrap_or(&Value::Null)).unwrap_or_default())
            }
        };
        let mut resp = r.map_err(|e| Error::Offline(e.to_string()))?;
        let status = resp.status().as_u16();
        let text = resp.body_mut().read_to_string().map_err(|e| Error::Offline(e.to_string()))?;
        let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        match status {
            200..=299 => Ok(v),
            401 => Err(Error::SignedOut),
            500.. => Err(Error::Offline(format!("{status}"))),
            _ => Err(Error::Api { status, code: v["error"].as_str().unwrap_or_default().into(), message: v["message"].as_str().unwrap_or_default().into() }),
        }
    }
}

/// `account` in the server's answers, cached for display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub email: String,
    pub handle: Option<String>,
}

/// This machine's name as the OS shows it, for the device list.
pub fn device_name() -> String {
    #[cfg(target_os = "macos")]
    let out = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output();
    #[cfg(not(target_os = "macos"))]
    let out = std::process::Command::new("hostname").output();
    out.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "pal".into())
}

/// A score that could not be sent yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Queued {
    ext: String,
    board: String,
    value: f64,
    at: u64,
    /// The board's order, for the local best while it waits.
    #[serde(default)]
    order: Order,
    /// The game's replay of the score (protocol 7), sent with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replay: Option<String>,
}

pub struct Account {
    dir: PathBuf,
    base: String,
    secrets: Box<dyn SecretStore>,
    token: RwLock<Option<String>>,
    profile: RwLock<Option<Profile>>,
    /// One writer of the score queue at a time.
    queue: Mutex<()>,
}

impl Account {
    /// The account as this machine knows it: the cached profile, and the
    /// token from `secrets` when there is a profile.
    pub fn open_in(dir: impl Into<PathBuf>, base: &str, secrets: Box<dyn SecretStore>) -> Account {
        let dir = dir.into();
        let profile: Option<Profile> = std::fs::read(dir.join(PROFILE)).ok().and_then(|b| serde_json::from_slice(&b).ok());
        let token = profile.as_ref().and_then(|_| secrets.get(TOKEN_KEY).ok()).filter(|t| !t.is_empty());
        // A profile without its token (the keychain item removed) is signed out.
        let profile = profile.filter(|_| token.is_some());
        Account { dir, base: base.to_string(), secrets, token: RwLock::new(token), profile: RwLock::new(profile), queue: Mutex::new(()) }
    }

    /// `<data dir>/pal`, [`api_base`], the OS keychain.
    pub fn open() -> Account {
        Account::open_in(crate::fs::data_dir(), &api_base(), platform_store())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn profile(&self) -> Option<Profile> {
        self.profile.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn signed_in(&self) -> bool {
        self.token.read().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    /// A client with the token, when signed in.
    pub fn client(&self) -> Client {
        Client::new(&self.base, self.token.read().unwrap_or_else(|e| e.into_inner()).clone())
    }

    /// A signed-in call: [`Error::SignedOut`] without a token, and a token
    /// the server no longer knows (signed out from another device) is
    /// forgotten here too.
    pub fn call<T>(&self, f: impl FnOnce(&Client) -> Result<T>) -> Result<T> {
        if !self.signed_in() {
            return Err(Error::SignedOut);
        }
        let r = f(&self.client());
        if matches!(r, Err(Error::SignedOut)) {
            eprintln!("account\ttoken refused\tsigned out here");
            self.forget();
        }
        r
    }

    fn set_profile(&self, p: Option<Profile>) {
        let path = self.dir.join(PROFILE);
        match &p {
            Some(p) => {
                if let Err(e) = write_atomic(&path, serde_json::to_vec_pretty(p).unwrap_or_default()) {
                    eprintln!("account\tprofile not written\t{e}");
                }
            }
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
        *self.profile.write().unwrap_or_else(|e| e.into_inner()) = p;
    }

    /// Mails a code to `email`. The server answers the same whether or not
    /// the address has an account.
    pub fn start(&self, email: &str) -> Result<()> {
        Client::new(&self.base, None).post("/api/auth/start", &json!({ "email": email.trim() })).map(drop)
    }

    /// The code from the mail: the token goes to the keychain, the profile
    /// to the data dir, and this device's anonymous scores to the account.
    pub fn verify(&self, email: &str, code: &str, device: &str) -> Result<Profile> {
        let r = Client::new(&self.base, None).post("/api/auth/verify", &json!({ "email": email.trim(), "code": code.trim(), "device": device }))?;
        let token = r["token"].as_str().filter(|t| !t.is_empty()).ok_or_else(|| Error::Local("the server sent no token".into()))?.to_string();
        let profile: Profile = serde_json::from_value(r["account"].clone()).map_err(|e| Error::Local(format!("account: {e}")))?;
        self.secrets.set(TOKEN_KEY, &token).map_err(|e| Error::Local(format!("keychain: {e}")))?;
        *self.token.write().unwrap_or_else(|e| e.into_inner()) = Some(token);
        self.set_profile(Some(profile.clone()));
        self.claim();
        Ok(profile)
    }

    /// The anonymous scores of this device moved to the account, the id
    /// dropped; kept to try at the next sign-in when the call fails.
    fn claim(&self) {
        let Some(anon) = self.anon_id(false) else { return };
        match self.call(|c| c.post("/api/scores/claim", &json!({ "anon": anon }))) {
            Ok(_) => {
                let _ = std::fs::remove_file(self.dir.join(ANON));
            }
            Err(e) => eprintln!("account\tclaim failed\t{e}"),
        }
    }

    /// `GET /api/account`: email, handle and devices. Refreshes the cache.
    pub fn details(&self) -> Result<Value> {
        let v = self.call(|c| c.get("/api/account"))?;
        if let Some(email) = v["email"].as_str() {
            self.set_profile(Some(Profile { email: email.into(), handle: v["handle"].as_str().map(String::from) }));
        }
        Ok(v)
    }

    pub fn set_handle(&self, handle: &str) -> Result<String> {
        let v = self.call(|c| c.put("/api/account/handle", &json!({ "handle": handle.trim() })))?;
        let handle = v["handle"].as_str().unwrap_or(handle.trim()).to_string();
        if let Some(mut p) = self.profile() {
            p.handle = Some(handle.clone());
            self.set_profile(Some(p));
        }
        Ok(handle)
    }

    /// Signs one device out (this one included: then signed out here).
    pub fn drop_device(&self, id: &str) -> Result<()> {
        self.call(|c| c.delete(&format!("/api/account/devices/{id}"))).map(drop)
    }

    /// Signs this device out. Local data stays; an unreachable server does
    /// not keep anyone signed in.
    pub fn sign_out(&self) {
        if let Err(e) = self.call(|c| c.post("/api/auth/signout", &json!({}))) {
            eprintln!("account\tsign out\tserver: {e}");
        }
        self.forget();
    }

    /// Everything the server holds for the account; signed out after.
    pub fn delete(&self) -> Result<()> {
        self.call(|c| c.delete("/api/account"))?;
        self.forget();
        Ok(())
    }

    /// The token and the profile gone from this machine.
    pub fn forget(&self) {
        if let Err(e) = self.secrets.delete(TOKEN_KEY) {
            eprintln!("account\tkeychain\t{e}");
        }
        *self.token.write().unwrap_or_else(|e| e.into_inner()) = None;
        self.set_profile(None);
    }

    // ---- scores ---------------------------------------------------------

    /// The device's anonymous id, made when `make` and missing.
    pub fn anon_id(&self, make: bool) -> Option<String> {
        let path = self.dir.join(ANON);
        if let Some(id) = std::fs::read_to_string(&path).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
            return Some(id);
        }
        if !make {
            return None;
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        write_atomic(&path, &id).ok()?;
        Some(id)
    }

    fn send_score(&self, q: &Queued) -> Result<Value> {
        let mut body = json!({ "ext": q.ext, "board": q.board, "value": q.value });
        if let Some(r) = &q.replay {
            body["replay"] = json!(r);
        }
        if self.signed_in() {
            let r = self.call(|c| c.post("/api/scores", &body));
            if let Err(Error::Api { status: 409, code, .. }) = &r {
                if code == "handle" {
                    return Err(Error::Handle);
                }
            }
            return r;
        }
        body["anon"] = json!(self.anon_id(true).ok_or_else(|| Error::Local("could not write the anonymous id".into()))?);
        Client::new(&self.base, None).post("/api/scores", &body)
    }

    /// `leaderboard.post`: `{best, rank, total}`, or `{queued: true, best}`
    /// when the server cannot be reached (the best of what waits). `board`
    /// is the declaration the posted id matched.
    /// A `replay` (the game's own record of the score) goes with it, queued too.
    pub fn post_score(&self, ext: &str, posted: &str, value: f64, board: &Board, replay: Option<&str>) -> Result<Value> {
        if self.profile().is_some_and(|p| p.handle.is_none()) {
            return Err(Error::Handle);
        }
        let replay = replay.filter(|r| !r.is_empty()).map(str::to_string);
        let q = Queued { ext: ext.into(), board: posted.into(), value, at: crate::registry::now(), order: board.order, replay };
        match self.send_score(&q) {
            Err(Error::Offline(e)) => {
                eprintln!("account\tscore queued\t{ext}/{posted}\t{e}");
                let _g = self.queue.lock().unwrap_or_else(|e| e.into_inner());
                let mut all = self.queued();
                all.push(q);
                self.write_queue(&all);
                let best = all.iter().filter(|x| x.ext == ext && x.board == posted).map(|x| x.value).reduce(|a, b| board.order.better(a, b)).unwrap_or(value);
                Ok(json!({ "queued": true, "best": best }))
            }
            r => r,
        }
    }

    fn queued(&self) -> Vec<Queued> {
        std::fs::read(self.dir.join(QUEUE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write_queue(&self, q: &[Queued]) {
        let path = self.dir.join(QUEUE);
        let r = if q.is_empty() { std::fs::remove_file(&path).or(Ok(())) } else { write_atomic(&path, serde_json::to_vec(q).unwrap_or_default()) };
        if let Err(e) = r {
            eprintln!("account\tscore queue not written\t{e}");
        }
    }

    /// Whether scores wait to be sent.
    pub fn has_queued(&self) -> bool {
        self.dir.join(QUEUE).is_file()
    }

    /// Sends what waits, in order: stops at the first that still cannot
    /// reach the server (or needs a handle), drops one the server refuses
    /// for good. How many went out.
    pub fn flush_scores(&self) -> usize {
        let _g = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        let mut left = self.queued();
        let mut sent = 0;
        while let Some(q) = left.first().cloned() {
            match self.send_score(&q) {
                Ok(_) => sent += 1,
                Err(Error::Offline(_) | Error::Handle | Error::SignedOut) => break,
                Err(e) => eprintln!("account\tscore dropped\t{}/{}\t{e}", q.ext, q.board),
            }
            left.remove(0);
        }
        self.write_queue(&left);
        sent
    }

    /// `leaderboard.replay`: the replay a board row's `replay` key names,
    /// `{board, value, name, anon, at, data}`.
    pub fn replay(&self, ext: &str, key: &str) -> Result<Value> {
        if !key.chars().all(|c| c.is_ascii_alphanumeric()) || key.is_empty() || key.len() > 64 {
            return Err(Error::Local(format!("not a replay key: {key}")));
        }
        // public, as a board is: no account needed to watch one
        Client::new(&self.base, None).get(&format!("/api/replays/{ext}/{key}"))
    }

    /// `leaderboard.get`: the server's board, with this device's own row
    /// marked when signed out.
    pub fn board(&self, ext: &str, board: &str, period: Option<Period>, anon: Option<bool>) -> Result<Value> {
        let mut query = Vec::new();
        if let Some(p) = period {
            query.push(format!("period={}", p.as_str()));
        }
        if let Some(a) = anon {
            query.push(format!("anon={}", a as u8));
        }
        let path = format!("/api/boards/{ext}/{board}");
        if self.signed_in() {
            let path = if query.is_empty() { path } else { format!("{path}?{}", query.join("&")) };
            return self.call(|c| c.get(&path));
        }
        if let Some(me) = self.anon_id(false) {
            query.push(format!("me={me}"));
        }
        let path = if query.is_empty() { path } else { format!("{path}?{}", query.join("&")) };
        Client::new(&self.base, None).get(&path)
    }
}

// ---- the manifest's `leaderboards` -------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Order {
    Asc,
    #[default]
    Desc,
}

impl Order {
    /// The better of two scores.
    pub fn better(self, a: f64, b: f64) -> f64 {
        match self {
            Order::Asc => a.min(b),
            Order::Desc => a.max(b),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Points,
    Time,
    Moves,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    #[default]
    All,
    Day,
    Week,
}

impl Period {
    pub fn as_str(self) -> &'static str {
        match self {
            Period::All => "all",
            Period::Day => "day",
            Period::Week => "week",
        }
    }
}

/// One `leaderboards` entry of `pal.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Board {
    /// `[a-z0-9_-]` segments joined by `/`; a `*` segment matches one segment of a posted board.
    pub id: String,
    /// `{1}` is the segment the first `*` matched.
    pub title: String,
    pub order: Order,
    pub format: Format,
    #[serde(default)]
    pub period: Period,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

fn valid_segment(s: &str, star: bool) -> bool {
    (star && s == "*") || (!s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-'))
}

/// Whether `id` is a board id (`star`: a declaration, which may have `*`).
pub fn valid_board(id: &str, star: bool) -> bool {
    id.split('/').count() <= 8 && id.split('/').all(|s| valid_segment(s, star))
}

impl Board {
    /// Whether a posted board id is this declaration's.
    pub fn matches(&self, posted: &str) -> bool {
        let (a, b): (Vec<_>, Vec<_>) = (self.id.split('/').collect(), posted.split('/').collect());
        valid_board(posted, false) && a.len() == b.len() && a.iter().zip(&b).all(|(d, p)| *d == "*" || d == p)
    }
}

/// The manifest's `leaderboards`, checked: ids well formed and distinct,
/// `min` under `max`. None declared is an empty list.
pub fn boards(manifest: &Value) -> std::result::Result<Vec<Board>, String> {
    let v = &manifest["leaderboards"];
    if v.is_null() {
        return Ok(Vec::new());
    }
    let list: Vec<Board> = serde_json::from_value(v.clone()).map_err(|e| format!("leaderboards: {e}"))?;
    for (i, b) in list.iter().enumerate() {
        if !valid_board(&b.id, true) {
            return Err(format!("leaderboards: {:?} is not a board id ([a-z0-9_-] segments joined by /, * for one segment)", b.id));
        }
        if list[..i].iter().any(|o| o.id == b.id) {
            return Err(format!("leaderboards: {:?} is declared twice", b.id));
        }
        if let (Some(lo), Some(hi)) = (b.min, b.max) {
            if lo > hi {
                return Err(format!("leaderboards: {:?} has min over max", b.id));
            }
        }
    }
    Ok(list)
}

/// The declaration a posted board id falls under, the first that matches.
pub fn find<'a>(boards: &'a [Board], posted: &str) -> Option<&'a Board> {
    boards.iter().find(|b| b.matches(posted))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::secrets::MemStore;
    use crate::testutil::Server;

    fn account(server: &Server) -> (tempfile::TempDir, Account) {
        let dir = tempfile::tempdir().unwrap();
        let a = Account::open_in(dir.path(), &server.base, Box::new(MemStore::default()));
        (dir, a)
    }

    fn board() -> Board {
        serde_json::from_value(json!({ "id": "stage/*", "title": "Stage {1}", "order": "desc", "format": "points" })).unwrap()
    }

    #[test]
    fn sign_in_keeps_the_token_in_the_keychain_and_claims_anonymous_scores() {
        let server = Server::start();
        server.ok("/api/auth/start", "{}");
        server.ok("/api/auth/verify", r#"{"token":"t0k","account":{"email":"a@b.c","handle":null}}"#);
        server.ok("/api/scores/claim", "{}");
        let (dir, a) = account(&server);
        assert!(!a.signed_in());
        let anon = a.anon_id(true).unwrap();
        a.start(" a@b.c ").unwrap();
        let p = a.verify("a@b.c", "123456", "hornet").unwrap();
        assert_eq!(p, Profile { email: "a@b.c".into(), handle: None });
        assert!(a.signed_in());
        assert_eq!(a.secrets.get(TOKEN_KEY).unwrap(), "t0k");
        let verify = &server.requests_to("/api/auth/verify")[0];
        assert_eq!(serde_json::from_slice::<Value>(&verify.body).unwrap(), json!({ "email": "a@b.c", "code": "123456", "device": "hornet" }));
        let claim = &server.requests_to("/api/scores/claim")[0];
        assert_eq!(claim.headers["authorization"], "Bearer t0k");
        assert_eq!(serde_json::from_slice::<Value>(&claim.body).unwrap(), json!({ "anon": anon }));
        assert!(!dir.path().join(ANON).exists(), "the claimed id is dropped");
        assert!(server.requests.lock().unwrap().iter().all(|r| !r.headers.contains_key("x-pal-install")), "never the usage id");
        // A second Account over the same files is signed in from the cache and the keychain.
        let again = Account::open_in(dir.path(), &server.base, Box::new(MemStore::from([(TOKEN_KEY.to_string(), "t0k".to_string())].into())));
        assert_eq!(again.profile(), Some(p));
        assert!(again.signed_in());
    }

    #[test]
    fn a_wrong_code_is_the_servers_words() {
        let server = Server::start();
        server.put("/api/auth/verify", 400, r#"{"error":"code","message":"That code is wrong or expired."}"#, None);
        let (_d, a) = account(&server);
        let e = a.verify("a@b.c", "1", "x").unwrap_err();
        assert_eq!(e.to_string(), "That code is wrong or expired.");
        assert!(!a.signed_in());
    }

    #[test]
    fn a_refused_token_signs_out_here() {
        let server = Server::start();
        server.ok("/api/auth/verify", r#"{"token":"t","account":{"email":"a@b.c","handle":"ann"}}"#);
        server.put("/api/account", 401, r#"{"error":"auth"}"#, None);
        let (_d, a) = account(&server);
        a.verify("a@b.c", "1", "x").unwrap();
        assert_eq!(a.details(), Err(Error::SignedOut));
        assert!(!a.signed_in() && a.profile().is_none());
        assert_eq!(a.secrets.get(TOKEN_KEY).ok(), None);
    }

    #[test]
    fn scores_go_out_anonymously_and_wait_while_offline() {
        let server = Server::start();
        server.ok("/api/scores", r#"{"best":30,"rank":2,"total":9}"#);
        let (dir, a) = account(&server);
        let r = a.post_score("vortex", "stage/3", 30.0, &board(), None).unwrap();
        assert_eq!(r, json!({ "best": 30, "rank": 2, "total": 9 }));
        let body: Value = serde_json::from_slice(&server.requests_to("/api/scores")[0].body).unwrap();
        assert_eq!(body["anon"], json!(a.anon_id(false).unwrap()), "signed out: the device's anonymous id");
        assert!(dir.path().join(ANON).is_file());

        // Offline: queued, the local best answered.
        let off = Account::open_in(dir.path(), "http://127.0.0.1:1", Box::new(MemStore::default()));
        assert_eq!(off.post_score("vortex", "stage/3", 50.0, &board(), None).unwrap(), json!({ "queued": true, "best": 50.0 }));
        assert_eq!(off.post_score("vortex", "stage/3", 40.0, &board(), Some("1a,2b")).unwrap(), json!({ "queued": true, "best": 50.0 }));
        assert_eq!(off.flush_scores(), 0, "still offline");
        assert!(off.has_queued());
        // Back online, they go out in order.
        assert_eq!(a.flush_scores(), 2);
        assert!(!a.has_queued());
        let sent: Vec<f64> = server.requests_to("/api/scores").iter().skip(1).map(|r| serde_json::from_slice::<Value>(&r.body).unwrap()["value"].as_f64().unwrap()).collect();
        assert_eq!(sent, [50.0, 40.0]);
        let bodies: Vec<Value> = server.requests_to("/api/scores").iter().skip(1).map(|r| serde_json::from_slice(&r.body).unwrap()).collect();
        assert_eq!((bodies[0].get("replay"), &bodies[1]["replay"]), (None, &json!("1a,2b")), "a queued score keeps its replay");
    }

    #[test]
    fn signed_in_without_a_handle_asks_for_one() {
        let server = Server::start();
        server.ok("/api/auth/verify", r#"{"token":"t","account":{"email":"a@b.c","handle":null}}"#);
        server.ok("/api/account/handle", r#"{"handle":"ann"}"#);
        server.ok("/api/scores", r#"{"best":1,"rank":1,"total":1}"#);
        let (_d, a) = account(&server);
        a.verify("a@b.c", "1", "x").unwrap();
        assert_eq!(a.post_score("g", "stage/1", 1.0, &board(), None), Err(Error::Handle));
        assert_eq!(Error::Handle.to_string(), "choose a handle");
        assert!(server.requests_to("/api/scores").is_empty(), "nothing posted");
        assert_eq!(a.set_handle(" ann ").unwrap(), "ann");
        assert_eq!(a.profile().unwrap().handle.as_deref(), Some("ann"));
        a.post_score("g", "stage/1", 1.0, &board(), None).unwrap();
        assert_eq!(server.requests_to("/api/scores")[0].headers["authorization"], "Bearer t");
    }

    #[test]
    fn boards_read_with_the_device_marked() {
        let server = Server::start();
        let (_d, a) = account(&server);
        let me = a.anon_id(true).unwrap();
        let path = format!("/api/boards/vortex/stage/3?period=day&anon=0&me={me}");
        server.ok(&path, r#"{"rows":[]}"#);
        assert_eq!(a.board("vortex", "stage/3", Some(Period::Day), Some(false)).unwrap(), json!({ "rows": [] }));
    }

    #[test]
    fn leaderboards_declarations_are_checked() {
        let m = json!({ "leaderboards": [
            { "id": "daily", "title": "Daily", "order": "desc", "format": "points", "period": "day" },
            { "id": "stage/*", "title": "Stage {1}", "order": "asc", "format": "time", "min": 0, "max": 3600 },
        ] });
        let list = boards(&m).unwrap();
        assert_eq!(list[0].period, Period::Day);
        assert_eq!(list[1].period, Period::All, "the default");
        assert_eq!(find(&list, "stage/hyper-3").map(|b| b.id.as_str()), Some("stage/*"));
        assert_eq!(find(&list, "stage/a/b"), None);
        assert_eq!(find(&list, "stage/*"), None, "a posted id has no star");
        assert_eq!(find(&list, "Daily"), None);
        assert_eq!(boards(&json!({})).unwrap(), vec![]);
        for bad in [
            json!([{ "id": "Daily", "title": "x", "order": "desc", "format": "points" }]),
            json!([{ "id": "a//b", "title": "x", "order": "desc", "format": "points" }]),
            json!([{ "id": "a", "title": "x", "order": "up", "format": "points" }]),
            json!([{ "id": "a", "title": "x", "order": "desc", "format": "points", "min": 5, "max": 1 }]),
            json!([{ "id": "a", "title": "x", "order": "desc", "format": "points" }, { "id": "a", "title": "y", "order": "asc", "format": "time" }]),
            json!([{ "id": "a", "title": "x", "order": "desc", "format": "points", "extra": 1 }]),
        ] {
            assert!(boards(&json!({ "leaderboards": bad })).is_err(), "{bad}");
        }
        assert_eq!(Order::Asc.better(3.0, 2.0), 2.0);
    }
}
