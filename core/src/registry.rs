//! Registries: signed static indexes of built extensions (docs/registry.md
//! is the contract, docs/design/distribution.md the reasons).
//!
//! A registry is one `index.json` and its minisign signature at a URL. Ours
//! (`pal`) is always present and first; others come from `[[store.registries]]`
//! in config order. Each index is fetched with `If-None-Match` and cached per
//! registry under `<cache dir>/registries/<name>/` (the index, its signature,
//! and `state.json`: etag, when it was last checked, the last error). A check
//! that fails for any reason (offline, a bad signature, a replayed older
//! index) never touches the cached copy and is recorded as that registry's
//! `last_error`, so a failed check never reads as "up to date".
//!
//! Trust: our index verifies against [`PAL_KEYS`]. A third party's verifies
//! against the key pinned when it was added, or the `next_key` its previous
//! (cached) index announced; the first index signed by that next key moves
//! the pin ([`Refreshed::rotated_to`], which the caller writes back to the
//! config; the cache's state remembers it meanwhile).
//!
//! Also here: the package identity ([`tree_hash`]), the build statement a
//! build's `sig` covers ([`statement`]), build selection ([`best_build`],
//! [`needs_newer`]) and name resolution across registries
//! ([`Registries::resolve`]). Installing lives in `crate::extensions`.

use std::collections::BTreeSet;
use std::io::Read;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::time::Duration;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::fs::write_atomic;

/// The SDK protocol this app speaks: the newest package `protocol` it runs.
/// Equal to `PROTOCOL` in `sdk/src/protocol.ts` (a test reads it).
pub const PROTOCOL: u32 = 4;
/// The oldest package `protocol` this app still runs.
pub const PROTOCOL_MIN: u32 = 1;
/// The index `format` this reader understands; a higher one is refused.
pub const FORMAT: u32 = 1;
/// Our registry's name.
pub const PAL: &str = "pal";
/// The minisign public keys our registry's index and builds may be signed
/// with. A new key is added here in an app release before the registry
/// moves to it (its `next_key` must be one of these).
pub const PAL_KEYS: &[&str] = &["RWTMqEv271ziqOpiNCh1e/5HADuvL1HnoK1EWACI/3dDDXb6AlJpeWcJ"];
/// The first line of the build statement.
pub const STATEMENT: &str = "pal-build-v1";

const INDEX_TIMEOUT: Duration = Duration::from_secs(15);
/// An index larger than this is not one.
const MAX_INDEX: u64 = 16 << 20;
const MAX_SIG: u64 = 64 << 10;

/// The protocols this app runs, `PROTOCOL_MIN..=PROTOCOL`.
pub fn protocols() -> RangeInclusive<u32> {
    PROTOCOL_MIN..=PROTOCOL
}

/// This machine as `listing.platforms` names it: `macos` or `linux`.
pub fn platform() -> &'static str {
    std::env::consts::OS
}

/// Which of a registry's indexes to follow. Ours has both; a third party
/// may publish only one URL, which is then whatever its `url` says.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    #[default]
    Stable,
    Edge,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Stable => "stable",
            Channel::Edge => "edge",
        }
    }
}

impl std::fmt::Display for Channel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Our index for `channel`.
pub fn pal_url(channel: Channel) -> String {
    format!("https://{}/registry/{channel}/index.json", crate::net::SITE)
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}: unreachable ({1})")]
    Network(String, String),
    #[error("{0}: the signature does not verify against its key ({1})")]
    Signature(String, String),
    #[error("{0}: index format {1} is newer than this pal reads ({FORMAT}); update pal")]
    Format(String, u32),
    #[error("{0}: not an index ({1})")]
    Parse(String, String),
    #[error("{0}: the index calls itself {1:?}")]
    Name(String, String),
    #[error("{0}: ignored an index generated at {1}, older than the cached one from {2} (a replay?)")]
    Stale(String, String, String),
    #[error("{0}: no such registry")]
    Unknown(String),
    #[error("{0}: no key to check it with; pass the registry's public key")]
    NoKey(String),
    #[error("{0}: {1}")]
    Tree(PathBuf, String),
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
}

pub type Result<T> = std::result::Result<T, Error>;

fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> Error {
    let path = path.into();
    move |source| Error::Io { path, source }
}

// ---- the index -------------------------------------------------------------

/// `index.json`. Unknown fields are ignored everywhere, so a registry can
/// add some without breaking older apps; `format` is what says otherwise.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub format: u32,
    pub name: String,
    pub generated_at: String,
    #[serde(default)]
    pub next_key: Option<String>,
    /// The registry's own public key, when it announces one: what
    /// `pal registry add` shows and pins when no key is given. Not part of
    /// the contract's required fields; trust comes from the pin, never from
    /// this field after the add.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default)]
    pub extensions: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    #[serde(default)]
    pub listing: Listing,
    /// Newest `seq` first, as published; nothing here relies on the order.
    #[serde(default)]
    pub builds: Vec<Build>,
}

/// What the Store, root search and Games show without fetching anything else.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Listing {
    pub title: String,
    pub description: String,
    pub tagline: String,
    /// `store.features`: the "What it does" bullets, so a browse card or
    /// page shows them without fetching the manifest. Absent in an index
    /// from before 0.9.
    pub features: Vec<String>,
    pub category: String,
    pub keywords: Vec<String>,
    pub icon: serde_json::Value,
    pub author: String,
    /// `None` (absent) runs everywhere.
    pub platforms: Option<Vec<String>>,
    pub play: bool,
    pub palettes: Vec<ListingPalette>,
    /// `{url, caption}` objects (or bare URLs), passed through to the UI.
    pub screenshots: Vec<serde_json::Value>,
    pub requires: Vec<String>,
    pub suggests: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ListingPalette {
    pub id: String,
    pub title: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Build {
    pub hash: String,
    pub seq: u64,
    pub protocol: u32,
    #[serde(default)]
    pub commit: String,
    pub url: String,
    #[serde(default)]
    pub manifest: String,
    #[serde(default)]
    pub size: Option<u64>,
    /// The whole `.minisig` over [`statement`].
    pub sig: String,
    #[serde(default)]
    pub yanked: bool,
}

impl Index {
    /// Parse and check `format`. `what` names the registry in errors.
    pub fn parse(what: &str, bytes: &[u8]) -> Result<Index> {
        // `format` first, so a newer index with a shape this reader cannot
        // parse still says "newer" rather than "not an index".
        #[derive(Deserialize)]
        struct Head {
            format: u32,
        }
        let head: Head = serde_json::from_slice(bytes).map_err(|e| Error::Parse(what.into(), e.to_string()))?;
        if head.format > FORMAT {
            return Err(Error::Format(what.into(), head.format));
        }
        serde_json::from_slice(bytes).map_err(|e| Error::Parse(what.into(), e.to_string()))
    }

    pub fn entry(&self, name: &str) -> Option<&Entry> {
        self.extensions.iter().find(|e| e.name == name)
    }
}

impl Entry {
    /// Whether `listing.platforms` includes `platform` (absent is everywhere).
    pub fn runs_on(&self, platform: &str) -> bool {
        self.listing.platforms.as_ref().is_none_or(|p| p.is_empty() || p.iter().any(|x| x == platform))
    }

    pub fn build(&self, hash: &str) -> Option<&Build> {
        self.builds.iter().find(|b| b.hash == hash)
    }
}

/// The build an install or update takes: the newest `seq` that is not
/// yanked, targets a protocol in `protocols`, and is not in `bad` (builds
/// that failed to load here); none when the entry does not run on `platform`.
pub fn best_build<'a>(entry: &'a Entry, protocols: RangeInclusive<u32>, platform: &str, bad: &BTreeSet<String>) -> Option<&'a Build> {
    if !entry.runs_on(platform) {
        return None;
    }
    entry.builds.iter().filter(|b| !b.yanked && protocols.contains(&b.protocol) && !bad.contains(&b.hash)).max_by_key(|b| b.seq)
}

/// When a build newer than [`best_build`]'s (or any build, when there is
/// none) needs a protocol above `protocols`: the lowest such protocol, for
/// "needs a newer pal". None when nothing newer is out of reach.
pub fn needs_newer(entry: &Entry, protocols: RangeInclusive<u32>, platform: &str, bad: &BTreeSet<String>) -> Option<u32> {
    if !entry.runs_on(platform) {
        return None;
    }
    let floor = best_build(entry, protocols.clone(), platform, bad).map(|b| b.seq);
    entry.builds.iter().filter(|b| !b.yanked && b.protocol > *protocols.end() && floor.is_none_or(|s| b.seq > s)).map(|b| b.protocol).min()
}

/// The text a build's `sig` signs: `pal-build-v1\n<name>\n<hash>\n<seq>\n<protocol>\n`.
pub fn statement(name: &str, hash: &str, seq: u64, protocol: u32) -> String {
    format!("{STATEMENT}\n{name}\n{hash}\n{seq}\n{protocol}\n")
}

/// Which of `keys` (minisign public keys, base64) signed `data` with the
/// `.minisig` text `sig`: its position, or why none did. Only prehashed
/// signatures (minisign's default since 0.8) are accepted.
pub fn verify(data: &[u8], sig: &str, keys: &[String]) -> std::result::Result<usize, String> {
    let sig = minisign_verify::Signature::decode(sig).map_err(|e| format!("bad signature: {e}"))?;
    let mut why = "no key".to_string();
    for (i, k) in keys.iter().enumerate() {
        match minisign_verify::PublicKey::from_base64(k.trim()) {
            Ok(pk) => match pk.verify(data, &sig, false) {
                Ok(()) => return Ok(i),
                Err(e) => why = e.to_string(),
            },
            Err(e) => why = format!("bad key {k:?}: {e}"),
        }
    }
    Err(why)
}

/// A minisign public key's id as `minisign -V` prints it (hex of the 8
/// key-id bytes, little-endian), for showing next to a key.
pub fn key_id(key: &str) -> Option<String> {
    use base64::Engine;
    let bin = base64::engine::general_purpose::STANDARD.decode(key.trim()).ok()?;
    (bin.len() == 42 && &bin[..2] == b"Ed").then(|| bin[2..10].iter().rev().map(|b| format!("{b:02X}")).collect())
}

// ---- the tree hash ---------------------------------------------------------

/// `pal-tree-v1` of a package directory (docs/registry.md "Tree hash"):
/// names starting with `.` skipped at any depth, every other entry a regular
/// file or a directory (a symlink is an error), one line per file
/// `<path>\0<x|->\0<sha256>\n` in byte order of the paths, then the sha256
/// of those lines.
pub fn tree_hash(dir: &Path) -> Result<String> {
    let mut files = Vec::new();
    walk(dir, "", &mut files)?;
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut all = Sha256::new();
    for (rel, path) in files {
        let meta = std::fs::metadata(&path).map_err(io(&path))?;
        let mut h = Sha256::new();
        let mut f = std::fs::File::open(&path).map_err(io(&path))?;
        std::io::copy(&mut f, &mut h).map_err(io(&path))?;
        all.update(rel.as_bytes());
        all.update(if executable(&meta) { b"\0x\0" } else { b"\0-\0" });
        all.update(hex(&h.finalize()).as_bytes());
        all.update(b"\n");
    }
    Ok(hex(&all.finalize()))
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<(String, PathBuf)>) -> Result<()> {
    for e in std::fs::read_dir(dir).map_err(io(dir))? {
        let e = e.map_err(io(dir))?;
        let name = e.file_name();
        let Some(name) = name.to_str() else { return Err(Error::Tree(e.path(), "a file name that is not UTF-8".into())) };
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name.to_string() } else { format!("{prefix}/{name}") };
        let ty = e.file_type().map_err(io(e.path()))?;
        if ty.is_dir() {
            walk(&e.path(), &rel, out)?;
        } else if ty.is_file() {
            out.push((rel, e.path()));
        } else {
            return Err(Error::Tree(e.path(), "not a regular file or a directory".into()));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o100 != 0
}

#[cfg(not(unix))]
fn executable(_: &std::fs::Metadata) -> bool {
    false
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---- registries ------------------------------------------------------------

/// One registry as this app follows it: ours or a `[[store.registries]]` entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Source {
    pub name: String,
    pub url: String,
    /// The pinned key; `None` for ours, which uses [`PAL_KEYS`].
    pub key: Option<String>,
    pub channel: Channel,
    /// Whether updates from it apply by themselves (its own `auto_update`,
    /// else `[store] auto_update`).
    pub auto_update: bool,
}

impl Source {
    pub fn is_ours(&self) -> bool {
        self.name == PAL
    }
}

/// The registries `store` follows, ours first, then the rest in config
/// order. An entry named `pal` only sets our channel and `auto_update`
/// (our URL and keys are built in); a later duplicate name is skipped.
pub fn sources(store: &crate::config::StoreConfig) -> Vec<Source> {
    let ours = store.registries.iter().find(|r| r.name == PAL);
    let channel = ours.and_then(|r| r.channel).unwrap_or_default();
    let mut out = vec![Source { name: PAL.into(), url: pal_url(channel), key: None, channel, auto_update: ours.and_then(|r| r.auto_update).unwrap_or(store.auto_update) }];
    for r in &store.registries {
        if out.iter().any(|s| s.name == r.name) || r.url.trim().is_empty() {
            continue;
        }
        out.push(Source {
            name: r.name.clone(),
            url: r.url.trim().to_string(),
            key: Some(r.key.trim().to_string()).filter(|k| !k.is_empty()),
            channel: r.channel.unwrap_or_default(),
            auto_update: r.auto_update.unwrap_or(store.auto_update),
        });
    }
    out
}

/// `state.json` beside a cached index.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct State {
    /// The URL the cached index came from: a channel switch is another index.
    pub url: String,
    pub etag: Option<String>,
    /// Unix seconds of the last check, whatever its outcome.
    pub last_checked: Option<u64>,
    /// Unix seconds of the last check that succeeded (a new index or a 304).
    pub last_ok: Option<u64>,
    /// Why the last check failed; `None` when it succeeded.
    pub last_error: Option<String>,
    /// The cached index's `generated_at`.
    pub generated_at: Option<String>,
    /// The key that verified the cached index (third-party registries):
    /// the pin as far as this cache knows, until the config catches up.
    pub key: Option<String>,
}

/// What a successful check did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Refreshed {
    /// A new index was cached (false on a 304 or the same bytes).
    pub changed: bool,
    /// A third-party registry moved to its announced `next_key`: the caller
    /// writes it to the config (`ConfigFile::store_set_registry_key`).
    pub rotated_to: Option<String>,
}

/// One registry's health, for Settings and `pal registry list`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RegistryStatus {
    pub name: String,
    pub url: String,
    pub channel: Channel,
    pub auto_update: bool,
    /// The pinned key (ours: the first of [`PAL_KEYS`]).
    pub key: String,
    /// Extensions in the cached index.
    pub count: usize,
    pub generated_at: Option<String>,
    pub last_checked: Option<u64>,
    pub last_ok: Option<u64>,
    pub last_error: Option<String>,
}

/// A registry seen before it is added: `pal registry add` shows this and
/// asks.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Preview {
    pub name: String,
    pub url: String,
    pub count: usize,
    pub key: String,
    pub key_id: Option<String>,
}

/// The registries this app follows and their cache.
#[derive(Debug, Clone)]
pub struct Registries {
    cache: PathBuf,
    sources: Vec<Source>,
}

impl Registries {
    /// `cache` is the directory holding one subdirectory per registry.
    pub fn new(cache: impl Into<PathBuf>, sources: Vec<Source>) -> Self {
        Self { cache: cache.into(), sources }
    }

    /// The config's registries, cached under `<cache dir>/registries`.
    pub fn from_config(store: &crate::config::StoreConfig) -> Self {
        Self::new(crate::fs::cache_dir().join("registries"), sources(store))
    }

    pub fn sources(&self) -> &[Source] {
        &self.sources
    }

    pub fn source(&self, name: &str) -> Option<&Source> {
        self.sources.iter().find(|s| s.name == name)
    }

    fn dir(&self, name: &str) -> PathBuf {
        self.cache.join(name)
    }

    /// The cached index, when there is one for this source's URL.
    pub fn index(&self, name: &str) -> Option<Index> {
        let src = self.source(name)?;
        let st = self.state(name);
        if !st.url.is_empty() && st.url != src.url {
            return None;
        }
        Index::parse(name, &std::fs::read(self.dir(name).join("index.json")).ok()?).ok()
    }

    pub fn state(&self, name: &str) -> State {
        std::fs::read(self.dir(name).join("state.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn save_state(&self, name: &str, st: &State) {
        let _ = write_atomic(&self.dir(name).join("state.json"), serde_json::to_vec_pretty(st).unwrap_or_default());
    }

    /// The keys an index of `src` may be signed with. Ours: [`PAL_KEYS`]
    /// (a `next_key` it announces is trusted only when it is one of them),
    /// or the source's own `key` when one is set, which only tests do.
    /// Another: the pin, the pin the cache moved to, and the cached index's
    /// `next_key`.
    pub fn index_keys(&self, src: &Source) -> Vec<String> {
        if src.is_ours() {
            return src.key.clone().map_or_else(|| PAL_KEYS.iter().map(|k| k.to_string()).collect(), |k| vec![k]);
        }
        let mut keys: Vec<String> = src.key.iter().cloned().collect();
        keys.extend(self.state(&src.name).key);
        keys.extend(self.index(&src.name).and_then(|i| i.next_key));
        keys.dedup();
        keys
    }

    /// The keys a build statement of `src` may be signed with: the same
    /// set as its index.
    pub fn build_keys(&self, src: &Source) -> Vec<String> {
        self.index_keys(src)
    }

    /// Fetch `name`'s index, verify it and cache it. Any failure is
    /// recorded as its `last_error` and leaves the cache as it was.
    pub fn refresh(&self, name: &str) -> Result<Refreshed> {
        let src = self.source(name).ok_or_else(|| Error::Unknown(name.into()))?.clone();
        let mut st = self.state(name);
        let r = self.fetch(&src, &st);
        let now = now();
        st.last_checked = Some(now);
        match r {
            Ok(None) => {
                st.last_ok = Some(now);
                st.last_error = None;
                self.save_state(name, &st);
                Ok(Refreshed::default())
            }
            Ok(Some(f)) => {
                let dir = self.dir(name);
                let changed = std::fs::read(dir.join("index.json")).ok().as_deref() != Some(&f.bytes[..]) || st.url != src.url;
                write_atomic(&dir.join("index.json.minisig"), &f.sig).map_err(io(dir.join("index.json.minisig")))?;
                write_atomic(&dir.join("index.json"), &f.bytes).map_err(io(dir.join("index.json")))?;
                let rotated_to = (!src.is_ours() && src.key.as_deref() != Some(f.key.as_str())).then(|| f.key.clone());
                st = State { url: src.url.clone(), etag: f.etag, last_checked: Some(now), last_ok: Some(now), last_error: None, generated_at: Some(f.index.generated_at), key: (!src.is_ours()).then_some(f.key) };
                self.save_state(name, &st);
                Ok(Refreshed { changed, rotated_to })
            }
            Err(e) => {
                st.last_error = Some(e.to_string());
                self.save_state(name, &st);
                Err(e)
            }
        }
    }

    /// [`refresh`](Self::refresh) every registry, in order; each result on its own.
    pub fn refresh_all(&self) -> Vec<(String, Result<Refreshed>)> {
        self.sources.iter().map(|s| (s.name.clone(), self.refresh(&s.name))).collect()
    }

    /// `None` for a 304 on the cached URL.
    fn fetch(&self, src: &Source, st: &State) -> Result<Option<Fetched>> {
        let same_url = st.url == src.url && self.dir(&src.name).join("index.json").is_file();
        let etag = st.etag.as_deref().filter(|_| same_url);
        let Some((bytes, etag)) = get(&src.name, &src.url, etag, MAX_INDEX)? else { return Ok(None) };
        let (sig, _) = get(&src.name, &format!("{}.minisig", src.url), None, MAX_SIG)?.ok_or_else(|| Error::Network(src.name.clone(), "no signature".into()))?;
        let sig = String::from_utf8_lossy(&sig).into_owned();
        let keys = self.index_keys(src);
        if keys.is_empty() {
            return Err(Error::NoKey(src.name.clone()));
        }
        let which = verify(&bytes, &sig, &keys).map_err(|why| Error::Signature(src.name.clone(), why))?;
        let index = Index::parse(&src.name, &bytes)?;
        if index.name != src.name {
            return Err(Error::Name(src.name.clone(), index.name));
        }
        if same_url {
            if let Some(cached) = &st.generated_at {
                if time_of(&index.generated_at) < time_of(cached) {
                    return Err(Error::Stale(src.name.clone(), index.generated_at, cached.clone()));
                }
            }
        }
        Ok(Some(Fetched { bytes, sig: sig.into_bytes(), etag, index, key: keys[which].clone() }))
    }

    /// Every registry's health, in order.
    pub fn status(&self) -> Vec<RegistryStatus> {
        self.sources
            .iter()
            .map(|s| {
                let st = self.state(&s.name);
                let index = self.index(&s.name);
                RegistryStatus {
                    name: s.name.clone(),
                    url: s.url.clone(),
                    channel: s.channel,
                    auto_update: s.auto_update,
                    key: s.key.clone().or(st.key.clone()).unwrap_or_else(|| PAL_KEYS[0].to_string()),
                    count: index.as_ref().map_or(0, |i| i.extensions.len()),
                    generated_at: index.map(|i| i.generated_at),
                    last_checked: st.last_checked,
                    last_ok: st.last_ok,
                    last_error: st.last_error,
                }
            })
            .collect()
    }

    /// Every cached registry that lists `name`, ours first then config
    /// order, so a caller can show a clash or take the first.
    pub fn resolve(&self, name: &str) -> Vec<(&Source, Entry)> {
        self.sources.iter().filter_map(|s| Some((s, self.index(&s.name)?.entry(name)?.clone()))).collect()
    }

    /// Drop a registry's cache (after it is removed from the config).
    pub fn forget(&self, name: &str) {
        let _ = std::fs::remove_dir_all(self.dir(name));
    }
}

struct Fetched {
    bytes: Vec<u8>,
    sig: Vec<u8>,
    etag: Option<String>,
    index: Index,
    key: String,
}

/// Fetch a registry that is not followed yet and check it: its index, its
/// signature against `key` (or the key the index announces), its format.
pub fn preview(url: &str, key: Option<&str>) -> Result<Preview> {
    let what = url;
    let (bytes, _) = get(what, url, None, MAX_INDEX)?.ok_or_else(|| Error::Network(what.into(), "no index".into()))?;
    let (sig, _) = get(what, &format!("{url}.minisig"), None, MAX_SIG)?.ok_or_else(|| Error::Network(what.into(), "no signature".into()))?;
    let index = Index::parse(what, &bytes)?;
    let key = key.map(str::to_string).or(index.key.clone()).filter(|k| !k.trim().is_empty()).ok_or_else(|| Error::NoKey(what.into()))?;
    verify(&bytes, &String::from_utf8_lossy(&sig), std::slice::from_ref(&key)).map_err(|why| Error::Signature(what.into(), why))?;
    Ok(Preview { name: index.name.clone(), url: url.into(), count: index.extensions.len(), key_id: key_id(&key), key })
}

/// `GET url` through [`crate::net`], at most `max` bytes: `(body, etag)`,
/// `None` on a 304.
fn get(what: &str, url: &str, etag: Option<&str>, max: u64) -> Result<Option<(Vec<u8>, Option<String>)>> {
    let net = |e: String| Error::Network(what.into(), e);
    let agent = crate::net::agent(INDEX_TIMEOUT);
    let mut req = crate::net::get(&agent, url);
    if let Some(e) = etag {
        req = req.header("If-None-Match", e);
    }
    let mut resp = req.call().map_err(|e| net(format!("{url}: {e}")))?;
    if resp.status() == 304 {
        return Ok(None);
    }
    let etag = resp.headers().get("etag").and_then(|v| v.to_str().ok()).map(str::to_string);
    let mut bytes = Vec::new();
    resp.body_mut().as_reader().take(max + 1).read_to_end(&mut bytes).map_err(|e| net(e.to_string()))?;
    if bytes.len() as u64 > max {
        return Err(net(format!("{url}: larger than {max} bytes")));
    }
    Ok(Some((bytes, etag)))
}

/// Unix seconds now.
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// `2026-09-30T12:00:00Z` (fraction and offset allowed) as `(unix seconds,
/// nanoseconds)`; an unreadable stamp sorts first, so it never beats a
/// readable cached one.
fn time_of(s: &str) -> (i64, u32) {
    parse_time(s).unwrap_or((i64::MIN, 0))
}

fn parse_time(s: &str) -> Option<(i64, u32)> {
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, sec) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    let mut rest = s.get(19..)?;
    let mut nanos = 0u32;
    if let Some(frac) = rest.strip_prefix('.') {
        let digits: String = frac.chars().take_while(char::is_ascii_digit).collect();
        rest = &frac[digits.len()..];
        nanos = format!("{digits:0<9}").get(..9)?.parse().ok()?;
    }
    let off = match rest {
        "Z" | "z" => 0,
        _ => {
            let sign = if rest.starts_with('-') { -1 } else { 1 };
            sign * (rest.get(1..3)?.parse::<i64>().ok()? * 3600 + rest.get(4..6)?.parse::<i64>().ok()? * 60)
        }
    };
    Some((crate::calendar::days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + sec - off, nanos))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::testutil::{Server, Signer};

    #[test]
    fn protocol_matches_the_sdk() {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../sdk/src/protocol.ts")).unwrap();
        let read = |name: &str| -> u32 {
            // `export const PROTOCOL: number = 2;` (typed wide, so the host can compare the two).
            let line = text.lines().find(|l| l.starts_with(&format!("export const {name}: number = "))).unwrap_or_else(|| panic!("no {name} in protocol.ts"));
            line.split('=').nth(1).unwrap().trim().trim_end_matches(';').parse().unwrap()
        };
        assert_eq!(read("PROTOCOL"), PROTOCOL);
        assert_eq!(read("PROTOCOL_MIN"), PROTOCOL_MIN);
    }

    #[test]
    fn tree_hash_matches_the_fixture() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tree-hash");
        let want = std::fs::read_to_string(base.join("expected.txt")).unwrap();
        assert_eq!(tree_hash(&base.join("tree")).unwrap(), want.trim());
    }

    #[test]
    fn tree_hash_refuses_a_symlink_and_sees_the_exec_bit() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a"), "x").unwrap();
        let h1 = tree_hash(tmp.path()).unwrap();
        std::fs::set_permissions(tmp.path().join("a"), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_ne!(tree_hash(tmp.path()).unwrap(), h1);
        std::fs::write(tmp.path().join(".pal-install.json"), "{}").unwrap();
        std::os::unix::fs::symlink("a", tmp.path().join(".link")).unwrap();
        assert!(tree_hash(tmp.path()).is_ok(), "dot entries are skipped, even a symlink");
        std::os::unix::fs::symlink("a", tmp.path().join("link")).unwrap();
        assert!(matches!(tree_hash(tmp.path()), Err(Error::Tree(..))));
    }

    #[test]
    fn statement_and_key_id() {
        assert_eq!(statement("weather", "ab", 17, 1), "pal-build-v1\nweather\nab\n17\n1\n");
        assert_eq!(key_id(PAL_KEYS[0]).as_deref(), Some("A8E25CEFF64BA8CC"));
        assert_eq!(key_id("nope"), None);
    }

    #[test]
    fn times_compare_as_instants() {
        assert!(time_of("2026-09-30T12:00:00.5Z") > time_of("2026-09-30T12:00:00Z"), "a fraction is later, not earlier as the bytes say");
        assert_eq!(time_of("2026-09-30T14:00:00+02:00"), time_of("2026-09-30T12:00:00Z"));
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some((0, 0)));
        assert!(time_of("garbage") < time_of("1970-01-01T00:00:00Z"));
    }

    fn build(hash: &str, seq: u64, protocol: u32) -> Build {
        Build { hash: hash.into(), seq, protocol, commit: String::new(), url: String::new(), manifest: String::new(), size: None, sig: String::new(), yanked: false }
    }

    #[test]
    fn best_build_and_needs_newer() {
        let none = BTreeSet::new();
        let mut e = Entry { name: "w".into(), listing: Listing::default(), builds: vec![build("c", 30, 2), build("b", 20, 1), build("a", 10, 1)] };
        assert_eq!(best_build(&e, 1..=1, "macos", &none).unwrap().hash, "b");
        assert_eq!(needs_newer(&e, 1..=1, "macos", &none), Some(2), "a newer build is out of reach");
        assert_eq!(best_build(&e, 1..=2, "macos", &none).unwrap().hash, "c");
        assert_eq!(needs_newer(&e, 1..=2, "macos", &none), None);
        e.builds[1].yanked = true;
        assert_eq!(best_build(&e, 1..=1, "macos", &none).unwrap().hash, "a", "yanked is never offered");
        assert_eq!(best_build(&e, 1..=1, "macos", &BTreeSet::from(["a".to_string()])), None, "a bad build neither");
        assert_eq!(needs_newer(&e, 1..=1, "macos", &BTreeSet::from(["a".to_string()])), Some(2), "only too-new builds left");
        e.listing.platforms = Some(vec!["linux".into()]);
        assert_eq!(best_build(&e, 1..=2, "macos", &none), None, "wrong platform");
        assert_eq!(needs_newer(&e, 1..=1, "macos", &none), None);
        assert!(best_build(&e, 1..=2, "linux", &none).is_some());
    }

    #[test]
    fn index_parsing_ignores_unknown_fields_and_refuses_newer_formats() {
        let i = Index::parse("x", br#"{"format":1,"name":"x","generated_at":"t","extra":1,"extensions":[{"name":"a","new":true,"builds":[{"hash":"h","seq":1,"protocol":1,"url":"u","sig":"s","z":0}]}]}"#).unwrap();
        assert_eq!(i.extensions[0].builds[0].hash, "h");
        assert!(i.extensions[0].runs_on("macos"));
        assert!(i.extensions[0].listing.features.is_empty(), "an index from before 0.9 has no features");
        let f = Index::parse("x", br#"{"format":1,"name":"x","generated_at":"t","extensions":[{"name":"a","listing":{"tagline":"t","features":["One","Two"]}}]}"#).unwrap();
        assert_eq!(f.extensions[0].listing.features, ["One", "Two"]);
        assert!(matches!(Index::parse("x", br#"{"format":2,"whatever":[]}"#), Err(Error::Format(_, 2))));
        assert!(matches!(Index::parse("x", b"[]"), Err(Error::Parse(..))));
    }

    #[test]
    fn verify_names_the_key_that_signed() {
        let (a, b) = (Signer::new(), Signer::new());
        let sig = b.sign(b"data");
        assert_eq!(verify(b"data", &sig, &[a.public.clone(), b.public.clone()]), Ok(1));
        assert!(verify(b"data", &sig, std::slice::from_ref(&a.public)).is_err());
        assert!(verify(b"other", &sig, std::slice::from_ref(&b.public)).is_err());
        assert!(verify(b"data", "garbage", std::slice::from_ref(&b.public)).is_err());
    }

    /// An index text for `name` generated at `at`, announcing `next`.
    pub(crate) fn index_json(name: &str, at: &str, next: Option<&str>, entries: serde_json::Value) -> String {
        serde_json::json!({ "format": 1, "name": name, "generated_at": at, "next_key": next, "extensions": entries }).to_string()
    }

    fn third(server: &Server, key: &str) -> Source {
        Source { name: "acme".into(), url: server.url("/acme/index.json"), key: Some(key.into()), channel: Channel::Stable, auto_update: true }
    }

    fn publish(server: &Server, signer: &Signer, text: &str, etag: Option<&str>) {
        server.put("/acme/index.json", 200, text, etag);
        server.ok("/acme/index.json.minisig", signer.sign(text.as_bytes()));
    }

    #[test]
    fn refresh_caches_and_checks() {
        let server = Server::start();
        let tmp = tempfile::tempdir().unwrap();
        let key = Signer::new();
        let regs = Registries::new(tmp.path(), vec![third(&server, &key.public)]);
        let st = || regs.state("acme");

        // Unreachable: recorded, nothing cached.
        assert!(matches!(regs.refresh("acme"), Err(Error::Network(..))));
        assert!(st().last_error.is_some() && st().last_ok.is_none() && regs.index("acme").is_none());

        let v1 = index_json("acme", "2026-09-30T12:00:00Z", None, serde_json::json!([{ "name": "todo" }]));
        publish(&server, &key, &v1, Some("\"v1\""));
        assert_eq!(regs.refresh("acme").unwrap(), Refreshed { changed: true, rotated_to: None });
        assert_eq!(regs.index("acme").unwrap().extensions[0].name, "todo");
        assert_eq!((st().etag.as_deref(), st().last_error.as_deref()), (Some("\"v1\""), None));

        // Not modified: If-None-Match sent, a 304 is a good check.
        assert_eq!(regs.refresh("acme").unwrap(), Refreshed::default());
        assert_eq!(server.requests_to("/acme/index.json").last().unwrap().headers.get("if-none-match").map(String::as_str), Some("\"v1\""));
        assert!(server.requests_to("/acme/index.json").iter().all(|r| !r.headers.contains_key("x-pal-install")), "never the install id to another registry");

        // A replayed older index: refused, recorded, cache kept.
        let old = index_json("acme", "2026-09-29T12:00:00Z", None, serde_json::json!([]));
        publish(&server, &key, &old, None);
        assert!(matches!(regs.refresh("acme"), Err(Error::Stale(..))));
        assert!(st().last_error.unwrap().contains("older"));
        assert_eq!(regs.index("acme").unwrap().extensions.len(), 1);

        // Signed by a stranger: refused, cache kept.
        let v2 = index_json("acme", "2026-10-01T12:00:00Z", None, serde_json::json!([]));
        publish(&server, &Signer::new(), &v2, None);
        assert!(matches!(regs.refresh("acme"), Err(Error::Signature(..))));
        assert_eq!(regs.index("acme").unwrap().extensions.len(), 1);

        // A newer format: refused.
        let v3 = r#"{"format":2,"name":"acme"}"#;
        publish(&server, &key, v3, None);
        assert!(matches!(regs.refresh("acme"), Err(Error::Format(_, 2))));

        // Another registry's index at this URL: refused.
        publish(&server, &key, &index_json("evil", "2026-10-01T12:00:00Z", None, serde_json::json!([])), None);
        assert!(matches!(regs.refresh("acme"), Err(Error::Name(..))));

        // Back to good: the error clears.
        publish(&server, &key, &v2, None);
        assert!(regs.refresh("acme").unwrap().changed);
        assert_eq!(st().last_error, None);
        let status = &regs.status()[0];
        assert_eq!((status.count, status.generated_at.as_deref()), (0, Some("2026-10-01T12:00:00Z")));
    }

    #[test]
    fn key_rotation_moves_the_pin() {
        let server = Server::start();
        let tmp = tempfile::tempdir().unwrap();
        let (old, new) = (Signer::new(), Signer::new());
        let regs = Registries::new(tmp.path(), vec![third(&server, &old.public)]);

        // Signed by the next key before it was announced: refused.
        publish(&server, &new, &index_json("acme", "2026-09-30T10:00:00Z", None, serde_json::json!([])), None);
        assert!(matches!(regs.refresh("acme"), Err(Error::Signature(..))));

        // The old key announces the new one; the pin stays.
        publish(&server, &old, &index_json("acme", "2026-09-30T12:00:00Z", Some(&new.public), serde_json::json!([])), None);
        assert_eq!(regs.refresh("acme").unwrap().rotated_to, None);
        // The first index signed by the new key moves it.
        publish(&server, &new, &index_json("acme", "2026-09-30T13:00:00Z", None, serde_json::json!([])), None);
        assert_eq!(regs.refresh("acme").unwrap().rotated_to.as_deref(), Some(new.public.as_str()));
        assert_eq!(regs.state("acme").key.as_deref(), Some(new.public.as_str()));
        // The config not written back yet: the cache's pin carries the next check.
        publish(&server, &new, &index_json("acme", "2026-09-30T14:00:00Z", None, serde_json::json!([])), None);
        assert!(regs.refresh("acme").is_ok());
        // With the config rewritten, the old key is no longer accepted.
        let regs = Registries::new(tmp.path(), vec![third(&server, &new.public)]);
        publish(&server, &old, &index_json("acme", "2026-09-30T15:00:00Z", None, serde_json::json!([])), None);
        assert!(matches!(regs.refresh("acme"), Err(Error::Signature(..))));
    }

    #[test]
    fn ours_only_trusts_the_built_in_keys() {
        let tmp = tempfile::tempdir().unwrap();
        let regs = Registries::new(tmp.path(), sources(&crate::config::StoreConfig::default()));
        let ours = &regs.sources()[0];
        assert!(ours.is_ours());
        assert_eq!(ours.url, "https://pal.cagdas.io/registry/stable/index.json");
        assert_eq!(regs.index_keys(ours), PAL_KEYS);
    }

    #[test]
    fn sources_follow_the_config() {
        let (c, _) = crate::config::parse(
            "[store]\nauto_update = false\n[[store.registries]]\nname = \"acme\"\nurl = \"https://a/index.json\"\nkey = \"K\"\nauto_update = true\n[[store.registries]]\nname = \"pal\"\nchannel = \"edge\"\nurl = \"https://ignored\"\n[[store.registries]]\nname = \"acme\"\nurl = \"https://dup\"\n",
        )
        .unwrap();
        let s = sources(&c.store);
        assert_eq!(s.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["pal", "acme"], "ours first, a duplicate skipped");
        assert_eq!((s[0].url.as_str(), s[0].channel, s[0].auto_update), ("https://pal.cagdas.io/registry/edge/index.json", Channel::Edge, false));
        assert_eq!((s[1].key.as_deref(), s[1].auto_update), (Some("K"), true));
    }

    #[test]
    fn resolve_lists_every_registry_with_the_name() {
        let server = Server::start();
        let tmp = tempfile::tempdir().unwrap();
        let key = Signer::new();
        let mut b = third(&server, &key.public);
        b.name = "beta".into();
        b.url = server.url("/beta/index.json");
        let regs = Registries::new(tmp.path(), vec![third(&server, &key.public), b]);
        publish(&server, &key, &index_json("acme", "2026-09-30T12:00:00Z", None, serde_json::json!([{ "name": "todo" }])), None);
        let beta = index_json("beta", "2026-09-30T12:00:00Z", None, serde_json::json!([{ "name": "todo" }, { "name": "only" }]));
        server.ok("/beta/index.json", beta.clone());
        server.ok("/beta/index.json.minisig", key.sign(beta.as_bytes()));
        assert!(regs.refresh_all().iter().all(|(_, r)| r.is_ok()));
        let names = |n: &str| regs.resolve(n).iter().map(|(s, _)| s.name.clone()).collect::<Vec<_>>();
        assert_eq!(names("todo"), ["acme", "beta"]);
        assert_eq!(names("only"), ["beta"]);
        assert!(names("nope").is_empty());
    }

    #[test]
    fn preview_checks_the_announced_key() {
        let server = Server::start();
        let key = Signer::new();
        let mut v: serde_json::Value = serde_json::from_str(&index_json("acme", "2026-09-30T12:00:00Z", None, serde_json::json!([{ "name": "a" }]))).unwrap();
        v["key"] = key.public.clone().into();
        publish(&server, &key, &v.to_string(), None);
        let p = preview(&server.url("/acme/index.json"), None).unwrap();
        assert_eq!((p.name.as_str(), p.count, p.key.as_str()), ("acme", 1, key.public.as_str()));
        assert!(matches!(preview(&server.url("/acme/index.json"), Some(&Signer::new().public)), Err(Error::Signature(..))), "a key given is the one checked");
    }
}
