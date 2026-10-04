//! User-installed extensions: the store at `<data dir>/extensions/<name>/`,
//! the root the host loads after the bundled one (so a store copy of `calc`,
//! an update from our registry, wins over the bundled one by name;
//! `general.extension_dirs` come after).
//!
//! Two ways in:
//! - **A registry build** ([`Store::install_build`]): the build's statement
//!   signature is checked against the registry's key, the tarball is
//!   downloaded and unpacked under a single `<name>/` top directory (no
//!   links, devices or escapes), its tree hash compared with the listed one
//!   and its `pal.json` name with the entry's. docs/registry.md is the contract.
//! - **A source** ([`Store::install_from`]: a directory, a GitHub repo or
//!   URL): copied or fetched, `bun install --production` when it has a
//!   `package.json`. Marked as a source install everywhere and never
//!   updated by itself.
//!
//! Either way the extension is staged in `.extensions-staging` next to the
//! store, `.pal-install.json` is written beside its manifest, and one rename
//! puts it in place, so the host's watcher and a reader never see a
//! half-installed extension. The copy it replaces becomes the previous
//! generation, `<data dir>/extensions-previous/<name>` (outside every
//! root), which [`Store::rollback`] swaps back.
//!
//! Every change holds the store lock (an `flock` on `.extensions-staging/.lock`):
//! `pal install` runs in the CLI's own process next to the app, and the two
//! must never interleave. Nothing here talks to the host.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::fs::{self, write_atomic};
use crate::registry::{self, Build, Channel, Entry, Registries, Source};

pub mod migrate;
pub mod refs;

/// The install record kept next to the manifest.
pub const RECORD: &str = ".pal-install.json";
/// `Record::source` of a registry install.
pub const FROM_REGISTRY: &str = "registry";
/// Beside the store: the previous generation of each replaced extension.
pub const PREVIOUS: &str = "extensions-previous";
/// Beside the store: local per-extension state (builds that failed to load here).
pub const STATE: &str = "extensions-state.json";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const BUN_TIMEOUT: Duration = Duration::from_secs(120);
/// A tarball larger than this is not an extension.
const MAX_TARBALL: u64 = 64 << 20;
/// Nor is one that unpacks to more than this.
const MAX_UNPACKED: u64 = 256 << 20;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("bad spec {0:?}: expected a path, github:user/repo[/subdir][@ref] or a github.com URL")]
    Spec(String),
    #[error("{0}: no registry lists it (as of their last check; `pal registry list` shows when that was)")]
    Unknown(String),
    #[error("{0}: not in registry {1}")]
    NotIn(String, String),
    #[error("{0}: no such extension")]
    NotFound(String),
    #[error("{0} is already installed; update it instead")]
    Exists(String),
    #[error("{name} is installed from registry {installed}; remove it before installing {name} from {other}")]
    Clash { name: String, installed: String, other: String },
    #[error("{0} is one of pal's core extensions: only pal's own registry provides it")]
    Reserved(String),
    #[error("{0} comes from a local root (general.extension_dirs, or the checkout pal runs from), which wins over any registry")]
    Local(String),
    #[error("{0}: every build needs a newer pal (protocol {1}; this one runs {min}..={max})", min = registry::PROTOCOL_MIN, max = registry::PROTOCOL)]
    NeedsNewer(String, u32),
    #[error("{0}: not available for {1}")]
    Platform(String, String),
    #[error("{0}: no build to install")]
    NoBuild(String),
    #[error("{0}: no previous version to roll back to")]
    NoPrevious(String),
    #[error("{0}: {1}")]
    Verify(String, String),
    #[error("{0}: no pal.json")]
    NoManifest(PathBuf),
    #[error("pal.json: {0}")]
    Manifest(String),
    #[error("{0}: not installed from a source that can be fetched again")]
    NoSource(String),
    #[error("download failed: {0}")]
    Download(String),
    #[error("bun install failed: {0}")]
    Bun(String),
    #[error(transparent)]
    Registry(#[from] registry::Error),
    #[error(transparent)]
    Config(#[from] crate::config::Error),
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
}

pub type Result<T> = std::result::Result<T, Error>;

fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> Error {
    let path = path.into();
    move |source| Error::Io { path, source }
}

/// Where a source install comes from, parsed from the spec string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Spec {
    /// A directory on this machine, copied.
    Local(PathBuf),
    GitHub { owner: String, repo: String, subdir: Option<String>, reference: Option<String> },
}

impl Spec {
    /// `github:user/repo[/sub/dir][@ref]`, `https://github.com/user/repo[/tree/ref[/sub/dir]]`
    /// (`.git` suffix tolerated), else a path that must exist and be a directory.
    pub fn parse(spec: &str) -> Result<Spec> {
        let spec = spec.trim();
        let bad = || Error::Spec(spec.to_string());
        if let Some(rest) = spec.strip_prefix("github:") {
            let (path, reference) = match rest.rsplit_once('@') {
                Some((p, r)) if !r.is_empty() && !r.contains('/') => (p, Some(r.to_string())),
                _ => (rest, None),
            };
            let mut parts = path.split('/').filter(|s| !s.is_empty());
            let owner = parts.next().ok_or_else(bad)?;
            let repo = parts.next().ok_or_else(bad)?.trim_end_matches(".git");
            let subdir = parts.collect::<Vec<_>>().join("/");
            return Self::github(owner, repo, subdir, reference).ok_or_else(bad);
        }
        if let Some(rest) = spec.strip_prefix("https://github.com/").or_else(|| spec.strip_prefix("http://github.com/")) {
            let mut parts = rest.split('/').filter(|s| !s.is_empty());
            let owner = parts.next().ok_or_else(bad)?;
            let repo = parts.next().ok_or_else(bad)?.trim_end_matches(".git");
            let (reference, subdir) = match parts.next() {
                None => (None, String::new()),
                Some("tree") | Some("blob") => {
                    let r = parts.next().ok_or_else(bad)?;
                    (Some(r.to_string()), parts.collect::<Vec<_>>().join("/"))
                }
                Some(_) => return Err(bad()),
            };
            return Self::github(owner, repo, subdir, reference).ok_or_else(bad);
        }
        if spec.contains("://") {
            return Err(bad());
        }
        let path = PathBuf::from(spec);
        let path = std::fs::canonicalize(&path).map_err(|_| bad())?;
        if !path.is_dir() {
            return Err(bad());
        }
        Ok(Spec::Local(path))
    }

    /// A word with no path or scheme shape: an extension name for the
    /// registries, never a source.
    pub fn is_bare_name(spec: &str) -> bool {
        let spec = spec.trim();
        !spec.is_empty() && !spec.starts_with(['.', '~']) && !spec.contains(['/', ':', '\\'])
    }

    fn github(owner: &str, repo: &str, subdir: String, reference: Option<String>) -> Option<Spec> {
        let ok = |s: &str| !s.is_empty() && !s.contains("..") && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
        if !ok(owner) || !ok(repo) || subdir.split('/').any(|s| s == "..") {
            return None;
        }
        Some(Spec::GitHub { owner: owner.into(), repo: repo.into(), subdir: Some(subdir).filter(|s| !s.is_empty()), reference })
    }

    /// The canonical spec string, what the record stores.
    pub fn to_spec_string(&self) -> String {
        match self {
            Spec::Local(p) => p.to_string_lossy().into_owned(),
            Spec::GitHub { owner, repo, subdir, reference } => {
                let mut s = format!("github:{owner}/{repo}");
                if let Some(d) = subdir {
                    s.push('/');
                    s.push_str(d);
                }
                if let Some(r) = reference {
                    s.push('@');
                    s.push_str(r);
                }
                s
            }
        }
    }
}

/// `.pal-install.json`. A registry install (v2) says `source: "registry"`
/// and carries the build; a source install (v1, and still what `--from`
/// writes) carries the spec. One struct reads both, so a record written by
/// an older pal keeps working.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Record {
    /// [`FROM_REGISTRY`], or the spec as given, normalised (`github:user/repo/sub@ref`, or an absolute path).
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registry: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<Channel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<String>,
    /// Unix seconds.
    pub installed_at: u64,
    /// A source install's commit sha, when the GitHub API answered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_or_etag: Option<String>,
}

impl Record {
    pub fn from_registry(registry: &str, channel: Channel, hash: &str, seq: u64, protocol: u32, commit: &str) -> Record {
        Record {
            source: FROM_REGISTRY.into(),
            registry: Some(registry.into()),
            channel: Some(channel),
            hash: Some(hash.into()),
            seq: Some(seq),
            protocol: Some(protocol),
            commit: Some(commit.into()).filter(|c: &String| !c.is_empty()),
            r#ref: None,
            installed_at: registry::now(),
            commit_or_etag: None,
        }
    }

    pub fn from_source(spec: &str) -> Record {
        Record { source: spec.into(), registry: None, channel: None, hash: None, seq: None, protocol: None, commit: None, r#ref: None, installed_at: registry::now(), commit_or_etag: None }
    }
}

/// Where an installed extension came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind<'a> {
    Registry { registry: &'a str, channel: Channel, hash: &'a str, seq: u64, protocol: u32 },
    /// A `--from` install (or a v1 record): the spec.
    Source(&'a str),
    /// A directory someone put there by hand.
    Hand,
}

/// One extension in the store.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Installed {
    pub name: String,
    /// `pal.json`'s `version`, empty when it has none (a registry build
    /// needs none: `seq` orders builds).
    pub version: String,
    pub dir: PathBuf,
    /// Absent for a directory someone dropped in by hand.
    pub record: Option<Record>,
}

impl Installed {
    pub fn kind(&self) -> Kind<'_> {
        match &self.record {
            None => Kind::Hand,
            Some(r) => match (r.source == FROM_REGISTRY, &r.registry, &r.hash) {
                (true, Some(registry), Some(hash)) => Kind::Registry { registry, channel: r.channel.unwrap_or_default(), hash, seq: r.seq.unwrap_or(0), protocol: r.protocol.unwrap_or(registry::PROTOCOL) },
                _ => Kind::Source(&r.source),
            },
        }
    }
}

/// The names other roots provide, which the store's rules depend on and
/// the core cannot see: the app knows its roots.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Roots {
    /// The bundled core extensions: reserved for our registry.
    pub bundled: BTreeSet<String>,
    /// Names in a `general.extension_dirs` root (or a dev repo root): they
    /// win over every registry, which is then not offered.
    pub local: BTreeSet<String>,
}

/// What `pal.json` must say before a directory counts as an extension;
/// `sync` and `leaderboards`, when there, must parse
/// (`crate::sync::Decl`, `crate::account::boards`).
#[derive(Debug, Deserialize)]
struct Manifest {
    name: Option<String>,
    version: Option<serde_json::Value>,
    #[serde(default)]
    sync: serde_json::Value,
    #[serde(default)]
    leaderboards: serde_json::Value,
}

/// A manifest name that is safe as a directory name: lowercase ascii,
/// digits, `-`, `_`, `.`; not starting with `.` or `-`; at most 64 chars.
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with(['.', '-'])
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-_.".contains(c))
}

/// Reads and validates `<dir>/pal.json`: `(name, version)`, the version
/// empty when absent.
pub fn validate_manifest(dir: &Path) -> Result<(String, String)> {
    let file = dir.join("pal.json");
    if !file.is_file() {
        return Err(Error::NoManifest(dir.to_path_buf()));
    }
    let text = std::fs::read_to_string(&file).map_err(io(&file))?;
    validate_manifest_text(&text)
}

fn validate_manifest_text(text: &str) -> Result<(String, String)> {
    let m: Manifest = serde_json::from_str(text).map_err(|e| Error::Manifest(e.to_string()))?;
    let name = m.name.filter(|n| !n.is_empty()).ok_or_else(|| Error::Manifest("name is required".into()))?;
    if !safe_name(&name) {
        return Err(Error::Manifest(format!("name {name:?} is not a safe directory name (a-z, 0-9, -, _, .)")));
    }
    let version = match m.version {
        Some(serde_json::Value::String(s)) => s.trim().to_string(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        None => String::new(),
        Some(_) => return Err(Error::Manifest("version must be a string".into())),
    };
    let declared = serde_json::json!({ "sync": m.sync, "leaderboards": m.leaderboards });
    crate::sync::Decl::from_manifest(&declared).map_err(Error::Manifest)?;
    crate::account::boards(&declared).map_err(Error::Manifest)?;
    Ok((name, version))
}

/// The store lock, held while it lives.
#[derive(Debug)]
pub struct Lock {
    _file: std::fs::File,
}

/// Builds that failed to load here, per extension (`extensions-state.json`):
/// never offered again on this machine.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalState {
    #[serde(default)]
    pub bad: BTreeMap<String, BTreeSet<String>>,
}

/// The store: one directory, every extension a subdirectory.
#[derive(Debug, Clone)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn at(dir: impl Into<PathBuf>) -> Store {
        Store { dir: dir.into() }
    }

    /// `<data dir>/extensions` (`~/Library/Application Support/pal/extensions`
    /// on macOS, `~/.local/share/pal/extensions` on Linux): one store for
    /// every config, the directory `app/src-tauri/src/host.rs` passes as
    /// the user root. Not next to the config file: that is a dotfiles
    /// checkout for many, and the store, its staging dir and the host's
    /// `node_modules/@zcag/pal` link are not dotfiles (a dotfiles-managed
    /// extensions dir is `general.extension_dirs`).
    pub fn locate() -> Store {
        Store::at(fs::data_dir().join("extensions"))
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn beside(&self, name: &str) -> PathBuf {
        self.dir.parent().unwrap_or(&self.dir).join(name)
    }

    /// `.extensions-staging` next to the store: where an install is
    /// assembled and a replaced copy steps aside, and where the lock lives.
    /// Out of the host's recursive watch of the store, which would
    /// otherwise load a half-copied stage as an extension. Anything else
    /// in it is a crash's leftover, cleaned on the first lock.
    pub fn staging(&self) -> PathBuf {
        self.beside(".extensions-staging")
    }

    /// Where the previous generation of `name` is kept.
    pub fn previous(&self, name: &str) -> PathBuf {
        self.beside(PREVIOUS).join(name)
    }

    fn path_of(&self, name: &str) -> Result<PathBuf> {
        if !safe_name(name) {
            return Err(Error::NotFound(name.to_string()));
        }
        Ok(self.dir.join(name))
    }

    /// Takes the store lock, waiting for another process or thread that
    /// holds it. The first lock of a process clears the staging dir's
    /// leftovers: whoever made them is not running an operation now.
    pub fn lock(&self) -> Result<Lock> {
        static CLEANED: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
        let staging = self.staging();
        std::fs::create_dir_all(&staging).map_err(io(&staging))?;
        let path = staging.join(".lock");
        let file = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(&path).map_err(io(&path))?;
        file.lock().map_err(io(&path))?;
        if CLEANED.lock().unwrap_or_else(|e| e.into_inner()).insert(staging.clone()) {
            for e in std::fs::read_dir(&staging).into_iter().flatten().flatten() {
                if e.file_name() != ".lock" {
                    let p = e.path();
                    let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
                }
            }
        }
        Ok(Lock { _file: file })
    }

    /// Installs an explicit source (`Spec::parse`): a directory, a GitHub
    /// repo or URL. Refuses a name already in the store, or one a local
    /// root provides.
    pub fn install_from(&self, spec: &str, bun: Option<&Path>, roots: &Roots) -> Result<Installed> {
        self.put_source(&Spec::parse(spec)?, bun, false, roots)
    }

    /// Fetches a source install's recorded source again and replaces it.
    pub fn update_source(&self, name: &str, bun: Option<&Path>) -> Result<Installed> {
        let current = self.get(name)?;
        let Kind::Source(source) = current.kind() else { return Err(Error::NoSource(name.to_string())) };
        let spec = Spec::parse(source).map_err(|_| Error::NoSource(name.to_string()))?;
        let installed = self.put_source(&spec, bun, true, &Roots::default())?;
        if installed.name != name {
            // The source now says it is a different extension; keep both
            // rather than lose the one asked about.
            return Err(Error::Manifest(format!("source now names {:?}, not {name:?}", installed.name)));
        }
        Ok(installed)
    }

    /// Installs `name` from the registries (their cached indexes): from
    /// `registry` when given, else the first that lists it, ours first then
    /// config order. Refused when a local root provides the name, when it
    /// is a core extension and the registry is not ours, and when it is
    /// already installed (from another registry: a clash, named).
    pub fn install(&self, regs: &Registries, name: &str, registry: Option<&str>, roots: &Roots) -> Result<Installed> {
        if roots.local.contains(name) {
            return Err(Error::Local(name.into()));
        }
        let found = regs.resolve(name);
        let (src, entry) = match registry {
            Some(r) => found.into_iter().find(|(s, _)| s.name == r).ok_or_else(|| Error::NotIn(name.into(), r.into()))?,
            None => found.into_iter().next().ok_or_else(|| Error::Unknown(name.into()))?,
        };
        if roots.bundled.contains(name) && !src.is_ours() {
            return Err(Error::Reserved(name.into()));
        }
        if let Ok(i) = self.get(name) {
            return Err(match i.kind() {
                Kind::Registry { registry, .. } if registry != src.name => Error::Clash { name: name.into(), installed: registry.into(), other: src.name.clone() },
                _ => Error::Exists(name.into()),
            });
        }
        let bad = self.bad_builds(name);
        let Some(build) = registry::best_build(&entry, registry::protocols(), registry::platform(), &bad) else {
            return Err(match registry::needs_newer(&entry, registry::protocols(), registry::platform(), &bad) {
                Some(p) => Error::NeedsNewer(name.into(), p),
                None if !entry.runs_on(registry::platform()) => Error::Platform(name.into(), registry::platform().into()),
                None => Error::NoBuild(name.into()),
            });
        };
        self.install_build(src, &regs.build_keys(src), &entry, build)
    }

    /// Installs (or replaces with) one build of `entry` from `src`, whose
    /// statements verify against `keys` (`Registries::build_keys`). The
    /// checks, in order: protocol, statement signature, download, tree
    /// hash, manifest name. Nothing in the store changes unless all pass.
    pub fn install_build(&self, src: &Source, keys: &[String], entry: &Entry, build: &Build) -> Result<Installed> {
        let name = entry.name.as_str();
        let fail = |why: String| Error::Verify(name.into(), why);
        if !safe_name(name) {
            return Err(Error::Manifest(format!("name {name:?} is not a safe directory name")));
        }
        if !registry::protocols().contains(&build.protocol) {
            return Err(Error::NeedsNewer(name.into(), build.protocol));
        }
        let statement = registry::statement(name, &build.hash, build.seq, build.protocol);
        registry::verify(statement.as_bytes(), &build.sig, keys).map_err(|why| fail(format!("the build's signature does not verify against {}'s key ({why})", src.name)))?;
        let bytes = download(&build.url)?;
        let _lock = self.lock()?;
        std::fs::create_dir_all(&self.dir).map_err(io(&self.dir))?;
        let stage = tempfile::Builder::new().prefix("stage-").tempdir_in(self.staging()).map_err(io(self.staging()))?;
        let top = unpack_package(&bytes, name, stage.path())?;
        let hash = registry::tree_hash(&top)?;
        if hash != build.hash {
            return Err(fail(format!("the package's tree hash is {hash}, the index says {}", build.hash)));
        }
        let (manifest_name, version) = validate_manifest(&top)?;
        if manifest_name != name {
            return Err(fail(format!("the package's pal.json says {manifest_name:?}")));
        }
        let record = Record::from_registry(&src.name, src.channel, &build.hash, build.seq, build.protocol, &build.commit);
        write_record(&top, &record)?;
        let dir = self.swap_in(&top, name)?;
        Ok(Installed { name: name.into(), version, dir, record: Some(record) })
    }

    /// Removes `name` from the store. Its data (config tables, storage,
    /// frecency, keychain) stays; see [`data_paths`] for what the core keeps.
    /// The previous generation goes too: a rollback after a remove would
    /// bring back something that was asked to go.
    pub fn remove(&self, name: &str) -> Result<()> {
        let dir = self.path_of(name)?;
        let _lock = self.lock()?;
        if !dir.is_dir() {
            return Err(Error::NotFound(name.to_string()));
        }
        // Stepped aside first, then deleted: the host sees one rename, not
        // a directory emptying file by file.
        let gone = self.staging().join(unique("gone", name));
        std::fs::rename(&dir, &gone).map_err(io(&dir))?;
        let _ = std::fs::remove_dir_all(&gone);
        let _ = std::fs::remove_dir_all(self.previous(name));
        Ok(())
    }

    /// Swaps `name` with its previous generation (so a second rollback
    /// undoes the first) and marks the build rolled away from as bad here,
    /// so it is not offered again.
    pub fn rollback(&self, name: &str) -> Result<Installed> {
        let dir = self.path_of(name)?;
        let _lock = self.lock()?;
        let prev = self.previous(name);
        if !prev.is_dir() {
            return Err(Error::NoPrevious(name.into()));
        }
        if let Ok(current) = self.get(name) {
            if let Kind::Registry { hash, .. } = current.kind() {
                self.mark_bad(name, hash)?;
            }
        }
        let aside = self.staging().join(unique("rollback", name));
        let had = dir.is_dir();
        if had {
            std::fs::rename(&dir, &aside).map_err(io(&dir))?;
        }
        if let Err(e) = std::fs::rename(&prev, &dir) {
            if had {
                let _ = std::fs::rename(&aside, &dir);
            }
            return Err(io(&prev)(e));
        }
        if had {
            let _ = std::fs::rename(&aside, &prev);
        }
        self.get(name)
    }

    /// One installed extension.
    pub fn get(&self, name: &str) -> Result<Installed> {
        let dir = self.path_of(name)?;
        if !dir.is_dir() {
            return Err(Error::NotFound(name.to_string()));
        }
        let (_, version) = validate_manifest(&dir)?;
        Ok(Installed { name: name.to_string(), version, dir: dir.clone(), record: read_record(&dir) })
    }

    /// Every directory with a valid manifest, by name. A directory without
    /// one is skipped, not an error: the host skips it too.
    pub fn list(&self) -> Result<Vec<Installed>> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return Ok(Vec::new()) };
        let mut out = Vec::new();
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !safe_name(&name) || !e.path().is_dir() {
                continue;
            }
            if let Ok(i) = self.get(&name) {
                out.push(i);
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// `extensions-state.json`, empty when missing.
    pub fn local_state(&self) -> LocalState {
        std::fs::read(self.beside(STATE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    /// The builds of `name` that failed to load here.
    pub fn bad_builds(&self, name: &str) -> BTreeSet<String> {
        self.local_state().bad.remove(name).unwrap_or_default()
    }

    /// Remembers that `hash` of `name` failed to load here.
    pub fn mark_bad(&self, name: &str, hash: &str) -> Result<()> {
        let mut st = self.local_state();
        if st.bad.entry(name.into()).or_default().insert(hash.into()) {
            let path = self.beside(STATE);
            write_atomic(&path, serde_json::to_vec_pretty(&st).unwrap_or_default()).map_err(io(&path))?;
        }
        Ok(())
    }

    pub fn is_bad(&self, name: &str, hash: &str) -> bool {
        self.local_state().bad.get(name).is_some_and(|b| b.contains(hash))
    }

    fn put_source(&self, spec: &Spec, bun: Option<&Path>, overwrite: bool, roots: &Roots) -> Result<Installed> {
        std::fs::create_dir_all(&self.dir).map_err(io(&self.dir))?;
        let _lock = self.lock()?;
        // The temp dir goes with its guard on any early return.
        let work = self.staging();
        let stage = tempfile::Builder::new().prefix("stage-").tempdir_in(&work).map_err(io(&work))?;
        let (src, commit) = match spec {
            Spec::Local(from) => {
                let to = stage.path().join("src");
                std::fs::create_dir(&to).map_err(io(&to))?;
                copy_tree(from, &to)?;
                (to, None)
            }
            Spec::GitHub { owner, repo, subdir, reference } => {
                let commit = github_sha(owner, repo, reference.as_deref());
                let root = download_github(owner, repo, reference.as_deref(), stage.path())?;
                let src = match subdir {
                    Some(d) => root.join(d),
                    None => root,
                };
                if !src.is_dir() {
                    return Err(Error::Download(format!("{}/{repo} at {} has no {}", owner, reference.as_deref().unwrap_or("HEAD"), subdir.as_deref().unwrap_or("."))));
                }
                (src, commit)
            }
        };
        let (name, version) = validate_manifest(&src)?;
        if roots.local.contains(&name) {
            return Err(Error::Local(name));
        }
        if self.dir.join(&name).exists() && !overwrite {
            return Err(Error::Exists(name));
        }
        if src.join("package.json").is_file() {
            bun_install(bun, &src)?;
        }
        let mut record = Record::from_source(&spec.to_spec_string());
        record.r#ref = match spec {
            Spec::GitHub { reference, .. } => reference.clone(),
            Spec::Local(_) => None,
        };
        record.commit_or_etag = commit;
        write_record(&src, &record)?;
        let dir = self.swap_in(&src, &name)?;
        Ok(Installed { name, version, dir, record: Some(record) })
    }

    /// `src` into place as `name` under the held lock. The copy it replaces
    /// steps aside first and becomes the previous generation once the new
    /// one is in, so a failure in between leaves the old one restored.
    fn swap_in(&self, src: &Path, name: &str) -> Result<PathBuf> {
        let target = self.dir.join(name);
        let old = self.staging().join(unique("old", name));
        let had_old = target.exists();
        if had_old {
            std::fs::rename(&target, &old).map_err(io(&target))?;
        }
        if let Err(e) = std::fs::rename(src, &target) {
            if had_old {
                let _ = std::fs::rename(&old, &target);
            }
            return Err(io(&target)(e));
        }
        if had_old {
            let prev = self.previous(name);
            let _ = std::fs::remove_dir_all(&prev);
            let parked = prev.parent().is_some_and(|p| std::fs::create_dir_all(p).is_ok()) && std::fs::rename(&old, &prev).is_ok();
            if !parked {
                let _ = std::fs::remove_dir_all(&old);
            }
        }
        Ok(target)
    }
}

/// The paths the core keeps for extension `name` outside its own
/// directory: its storage file (`storage.get/set`, game progress) and its
/// previous generation. "Remove and forget" deletes these; config tables,
/// frecency (`Frecency::forget_extension`), the host's cache and keychain
/// entries are the app's to forget.
pub fn data_paths(store: &Store, name: &str) -> Vec<PathBuf> {
    vec![fs::data_dir().join(crate::storage::DIR_NAME).join(format!("{name}.json")), store.previous(name)]
}

/// A staging name no other operation of this or another process uses.
fn unique(what: &str, name: &str) -> String {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    format!("{what}-{name}-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed))
}

fn read_record(dir: &Path) -> Option<Record> {
    serde_json::from_slice(&std::fs::read(dir.join(RECORD)).ok()?).ok()
}

fn write_record(dir: &Path, record: &Record) -> Result<()> {
    write_atomic(&dir.join(RECORD), serde_json::to_vec_pretty(record).unwrap_or_default()).map_err(io(dir.join(RECORD)))
}

/// `from` into `to` (which exists and is empty), without `node_modules` and
/// `.git`: dependencies are installed fresh, history is not the extension.
fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    for e in std::fs::read_dir(from).map_err(io(from))? {
        let e = e.map_err(io(from))?;
        let name = e.file_name();
        if name == "node_modules" || name == ".git" {
            continue;
        }
        let (src, dst) = (e.path(), to.join(&name));
        let ty = e.file_type().map_err(io(&src))?;
        if ty.is_dir() {
            std::fs::create_dir(&dst).map_err(io(&dst))?;
            copy_tree(&src, &dst)?;
        } else if ty.is_file() {
            std::fs::copy(&src, &dst).map_err(io(&src))?;
        }
        // Symlinks are skipped: an extension that needs one is not portable anyway.
    }
    Ok(())
}

/// A registry package's bytes, capped.
fn download(url: &str) -> Result<Vec<u8>> {
    let agent = crate::net::agent(DOWNLOAD_TIMEOUT);
    let mut resp = crate::net::get(&agent, url).call().map_err(|e| Error::Download(format!("{url}: {e}")))?;
    let mut bytes = Vec::new();
    resp.body_mut().as_reader().take(MAX_TARBALL + 1).read_to_end(&mut bytes).map_err(|e| Error::Download(e.to_string()))?;
    if bytes.len() as u64 > MAX_TARBALL {
        return Err(Error::Download(format!("{url}: larger than {MAX_TARBALL} bytes")));
    }
    Ok(bytes)
}

/// A package tarball (docs/registry.md "Tarball") into `into/<name>`:
/// every entry under the one top directory `<name>/`, only files and
/// directories (no symlinks, hardlinks or devices), nothing escaping, at
/// most [`MAX_UNPACKED`] bytes. Files are written by us with `0644` or
/// `0755` from the owner's executable bit, whatever else the tar says.
fn unpack_package(gz: &[u8], name: &str, into: &Path) -> Result<PathBuf> {
    let bad = |why: String| Error::Verify(name.into(), format!("bad package: {why}"));
    let top = into.join(name);
    std::fs::create_dir(&top).map_err(io(&top))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(gz));
    let mut total = 0u64;
    for entry in archive.entries().map_err(|e| bad(e.to_string()))? {
        let mut e = entry.map_err(|e| bad(e.to_string()))?;
        let ty = e.header().entry_type();
        if ty.is_pax_global_extensions() {
            continue;
        }
        let path = e.path().map_err(|e| bad(e.to_string()))?.into_owned();
        let mut parts = path.components();
        if !matches!(parts.next(), Some(Component::Normal(n)) if n == name) {
            return Err(bad(format!("{} is not under {name}/", path.display())));
        }
        let mut rel = PathBuf::new();
        for c in parts {
            match c {
                Component::Normal(p) => rel.push(p),
                Component::CurDir => {}
                _ => return Err(bad(format!("{} escapes {name}/", path.display()))),
            }
        }
        let dest = top.join(&rel);
        if ty.is_dir() {
            std::fs::create_dir_all(&dest).map_err(io(&dest))?;
        } else if ty.is_file() && !rel.as_os_str().is_empty() {
            total += e.header().size().unwrap_or(0);
            if total > MAX_UNPACKED {
                return Err(bad(format!("unpacks to more than {MAX_UNPACKED} bytes")));
            }
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(io(parent))?;
            }
            let exec = e.header().mode().unwrap_or(0) & 0o100 != 0;
            let mut out = std::fs::File::create(&dest).map_err(io(&dest))?;
            std::io::copy(&mut (&mut e).take(MAX_UNPACKED), &mut out).map_err(io(&dest))?;
            set_mode(&dest, if exec { 0o755 } else { 0o644 })?;
        } else {
            return Err(bad(format!("{} is not a file or a directory", path.display())));
        }
    }
    Ok(top)
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).map_err(io(path))
}

#[cfg(not(unix))]
fn set_mode(_: &Path, _: u32) -> Result<()> {
    Ok(())
}

/// The commit `reference` (default branch when none) points at, or None
/// when the API does not answer (rate limit, private repo, offline).
fn github_sha(owner: &str, repo: &str, reference: Option<&str>) -> Option<String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/commits/{}", reference.unwrap_or("HEAD"));
    let agent = crate::net::agent(Duration::from_secs(10));
    let mut resp = crate::net::get(&agent, &url).header("Accept", "application/vnd.github.sha").call().ok()?;
    let sha = resp.body_mut().read_to_string().ok()?;
    let sha = sha.trim().to_string();
    (sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit())).then_some(sha)
}

/// Downloads the codeload tarball into `into` and returns the directory it
/// unpacked to (`<repo>-<ref>/`, whatever GitHub named it).
fn download_github(owner: &str, repo: &str, reference: Option<&str>, into: &Path) -> Result<PathBuf> {
    let url = format!("https://codeload.github.com/{owner}/{repo}/tar.gz/{}", reference.unwrap_or("HEAD"));
    unpack(&download(&url)?, into)
}

/// A gzipped source tarball into `into`; returns its single top-level
/// directory. `tar` refuses `..` and absolute paths on its own.
fn unpack(gz: &[u8], into: &Path) -> Result<PathBuf> {
    let unpacked = into.join("unpacked");
    std::fs::create_dir_all(&unpacked).map_err(io(&unpacked))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(gz));
    archive.set_preserve_permissions(true);
    archive.unpack(&unpacked).map_err(|e| Error::Download(format!("bad tarball: {e}")))?;
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&unpacked).map_err(io(&unpacked))?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    match (dirs.len(), dirs.pop()) {
        (1, Some(d)) => Ok(d),
        _ => Err(Error::Download("tarball has no single top-level directory".into())),
    }
}

/// `bun install --production` in `dir`, 120 s, stderr into the error.
fn bun_install(bun: Option<&Path>, dir: &Path) -> Result<()> {
    let bun = bun.unwrap_or(Path::new("bun"));
    let mut child = Command::new(bun)
        .args(["install", "--production", "--no-progress"])
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::Bun(format!("{}: {e}", bun.display())))?;
    let mut stderr = child.stderr.take().expect("piped");
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let t0 = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| Error::Bun(e.to_string()))? {
            break s;
        }
        if t0.elapsed() > BUN_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::Bun(format!("bun did not answer within {} s", BUN_TIMEOUT.as_secs())));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let err = reader.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(Error::Bun(format!("exit {status}: {}", err.trim())))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::registry::tests::index_json;
    use crate::testutil::{Server, Signer};

    fn ext(dir: &Path, name: &str, version: &str) -> PathBuf {
        let d = dir.join(name);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("pal.json"), format!(r#"{{"name":"{name}","title":"T","version":"{version}"}}"#)).unwrap();
        std::fs::write(d.join("index.ts"), "export default { palettes: {} }").unwrap();
        d
    }

    /// A package tarball the way pal-pack writes one: `<top>/` entries,
    /// normalised modes, uid 0, mtime 0.
    pub(crate) fn pack(top: &str, files: &[(&str, &str, bool)]) -> Vec<u8> {
        let mut b = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()));
        let mut dir = tar::Header::new_ustar();
        dir.set_entry_type(tar::EntryType::Directory);
        dir.set_mode(0o755);
        dir.set_size(0);
        b.append_data(&mut dir, format!("{top}/"), std::io::empty()).unwrap();
        for (path, body, exec) in files {
            let mut h = tar::Header::new_ustar();
            h.set_mode(if *exec { 0o755 } else { 0o644 });
            h.set_size(body.len() as u64);
            b.append_data(&mut h, format!("{top}/{path}"), body.as_bytes()).unwrap();
        }
        b.into_inner().unwrap().finish().unwrap()
    }

    /// The tree hash `files` unpack to.
    pub(crate) fn hash_of(files: &[(&str, &str, bool)]) -> String {
        let tmp = tempfile::tempdir().unwrap();
        let top = unpack_package(&pack("x", files), "x", tmp.path()).unwrap();
        registry::tree_hash(&top).unwrap()
    }

    /// A fixture registry `acme` (or `pal`-named, for ours) on a local
    /// server: publish packages, sign statements and the index.
    pub(crate) struct Fixture {
        pub server: Server,
        pub key: Signer,
        pub name: String,
        pub entries: Vec<serde_json::Value>,
        pub at: u32,
    }

    impl Fixture {
        pub fn new(name: &str) -> Fixture {
            Fixture { server: Server::start(), key: Signer::new(), name: name.into(), entries: Vec::new(), at: 0 }
        }

        pub fn source(&self) -> Source {
            Source { name: self.name.clone(), url: self.server.url(&format!("/{}/index.json", self.name)), key: Some(self.key.public.clone()), channel: Channel::Stable, auto_update: true }
        }

        /// A package for `ext` with `body` in its index.js, as a build
        /// with `seq`; the statement signed by `signer` (the registry's key
        /// when `None`). Returns the build JSON, not yet listed.
        pub fn build(&self, ext: &str, body: &str, seq: u64, protocol: u32, signer: Option<&Signer>) -> serde_json::Value {
            let manifest = format!(r#"{{"name":"{ext}","title":"T","protocol":{protocol}}}"#);
            let files = [("pal.json", manifest.as_str(), false), ("index.js", body, false)];
            let hash = hash_of(&files);
            let path = format!("/pkg/{ext}/{hash}.tar.gz");
            self.server.ok(&path, pack(ext, &files));
            let sig = signer.unwrap_or(&self.key).sign(registry::statement(ext, &hash, seq, protocol).as_bytes());
            serde_json::json!({ "hash": hash, "seq": seq, "protocol": protocol, "commit": "c0ffee", "url": self.server.url(&path), "sig": sig, "yanked": false })
        }

        /// Lists `builds` for `ext` (replacing its entry) and publishes a
        /// newer signed index.
        pub fn list(&mut self, ext: &str, builds: Vec<serde_json::Value>, platforms: Option<&[&str]>) {
            self.entries.retain(|e| e["name"] != ext);
            let mut listing = serde_json::json!({ "title": ext });
            if let Some(p) = platforms {
                listing["platforms"] = serde_json::json!(p);
            }
            self.entries.push(serde_json::json!({ "name": ext, "listing": listing, "builds": builds }));
            self.publish();
        }

        pub fn publish(&mut self) {
            self.at += 1;
            let text = index_json(&self.name, &format!("2026-09-30T12:{:02}:00Z", self.at), None, serde_json::Value::Array(self.entries.clone()));
            self.server.ok(&format!("/{}/index.json", self.name), text.clone());
            self.server.ok(&format!("/{}/index.json.minisig", self.name), self.key.sign(text.as_bytes()));
        }
    }

    fn store_in(tmp: &Path) -> Store {
        Store::at(tmp.join("data/extensions"))
    }

    #[test]
    fn registry_install_verifies_and_records() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut fx = Fixture::new("acme");
        let b1 = fx.build("todo", "one", 100, 1, None);
        fx.list("todo", vec![b1.clone()], None);
        let regs = Registries::new(tmp.path().join("cache"), vec![fx.source()]);
        assert!(matches!(store.install(&regs, "todo", None, &Roots::default()), Err(Error::Unknown(_))), "nothing cached yet");
        regs.refresh("acme").unwrap();

        let i = store.install(&regs, "todo", None, &Roots::default()).unwrap();
        assert_eq!(std::fs::read_to_string(i.dir.join("index.js")).unwrap(), "one");
        assert_eq!(i.kind(), Kind::Registry { registry: "acme", channel: Channel::Stable, hash: b1["hash"].as_str().unwrap(), seq: 100, protocol: 1 });
        let rec = read_record(&i.dir).unwrap();
        assert_eq!((rec.source.as_str(), rec.commit.as_deref()), ("registry", Some("c0ffee")));
        assert!(matches!(store.install(&regs, "todo", None, &Roots::default()), Err(Error::Exists(_))));
        let left: Vec<_> = std::fs::read_dir(store.staging()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, [".lock"], "nothing left in staging");

        // A newer build replaces it; the old one is the previous generation.
        let b2 = fx.build("todo", "two", 200, 1, None);
        let src = fx.source();
        let entry: Entry = serde_json::from_value(serde_json::json!({ "name": "todo", "builds": [b2.clone()] })).unwrap();
        let build: Build = serde_json::from_value(b2).unwrap();
        store.install_build(&src, &regs.build_keys(&src), &entry, &build).unwrap();
        assert_eq!(std::fs::read_to_string(store.dir().join("todo/index.js")).unwrap(), "two");
        assert_eq!(std::fs::read_to_string(store.previous("todo").join("index.js")).unwrap(), "one");

        // Rollback swaps them and marks the build rolled away from as bad.
        let back = store.rollback("todo").unwrap();
        assert_eq!(std::fs::read_to_string(back.dir.join("index.js")).unwrap(), "one");
        assert!(store.is_bad("todo", &build.hash));
        assert_eq!(std::fs::read_to_string(store.previous("todo").join("index.js")).unwrap(), "two", "a second rollback undoes the first");

        store.remove("todo").unwrap();
        assert!(!store.previous("todo").exists());
        assert!(matches!(store.rollback("todo"), Err(Error::NoPrevious(_))));
    }

    #[test]
    fn registry_install_refuses_what_does_not_verify() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let fx = Fixture::new("acme");
        let src = fx.source();
        let keys = vec![fx.key.public.clone()];
        let entry = |name: &str| Entry { name: name.into(), listing: Default::default(), builds: vec![] };
        let as_build = |v: serde_json::Value| -> Build { serde_json::from_value(v).unwrap() };
        let refused = |r: Result<Installed>, what: &str| {
            assert!(matches!(r, Err(Error::Verify(..)) | Err(Error::NeedsNewer(..))), "{what}: {r:?}");
            assert!(!store.dir().join("todo").exists() && !store.dir().join("evil").exists(), "{what}: nothing installed");
        };

        // Signed by someone else.
        let b = as_build(fx.build("todo", "x", 1, 1, Some(&Signer::new())));
        refused(store.install_build(&src, &keys, &entry("todo"), &b), "a stranger's signature");
        // A good statement over a different hash than the package has.
        let mut b = as_build(fx.build("todo", "x", 1, 1, None));
        let other = as_build(fx.build("todo", "y", 1, 1, None));
        b.url = other.url.clone();
        refused(store.install_build(&src, &keys, &entry("todo"), &b), "hash mismatch");
        // Relisted under another name: the statement names the original.
        let b = as_build(fx.build("todo", "x", 1, 1, None));
        refused(store.install_build(&src, &keys, &entry("evil"), &b), "renamed entry");
        // Signed for its name, but the package's pal.json says otherwise.
        let manifest = r#"{"name":"other"}"#;
        let files = [("pal.json", manifest, false)];
        let hash = hash_of(&files);
        fx.server.ok("/pkg/bad.tar.gz", pack("todo", &files));
        let sig = fx.key.sign(registry::statement("todo", &hash, 1, 1).as_bytes());
        let b = Build { hash, seq: 1, protocol: 1, commit: String::new(), url: fx.server.url("/pkg/bad.tar.gz"), manifest: String::new(), size: None, sig, yanked: false };
        refused(store.install_build(&src, &keys, &entry("todo"), &b), "manifest name mismatch");
        // A protocol this app does not run.
        let b = as_build(fx.build("todo", "x", 1, registry::PROTOCOL + 1, None));
        refused(store.install_build(&src, &keys, &entry("todo"), &b), "too new");
    }

    #[test]
    fn unpack_refuses_links_escapes_and_strangers() {
        let tmp = tempfile::tempdir().unwrap();
        type Tar = tar::Builder<flate2::write::GzEncoder<Vec<u8>>>;
        let raw = |f: &dyn Fn(&mut Tar)| {
            let mut b = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()));
            f(&mut b);
            b.into_inner().unwrap().finish().unwrap()
        };
        let file = |b: &mut tar::Builder<_>, path: &str| {
            let mut h = tar::Header::new_gnu();
            h.set_size(1);
            h.set_mode(0o644);
            b.append_data(&mut h, path, &b"x"[..]).unwrap();
        };
        let link = |ty: tar::EntryType| {
            move |b: &mut tar::Builder<_>| {
                let mut h = tar::Header::new_gnu();
                h.set_entry_type(ty);
                h.set_size(0);
                b.append_link(&mut h, "w/l", "/etc/passwd").unwrap();
            }
        };
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("symlink", raw(&link(tar::EntryType::Symlink))),
            ("hardlink", raw(&link(tar::EntryType::Link))),
            ("another top dir", raw(&|b| file(b, "other/x"))),
            ("a file at the top", raw(&|b| file(b, "x"))),
            ("fifo", raw(&|b| {
                let mut h = tar::Header::new_gnu();
                h.set_entry_type(tar::EntryType::Fifo);
                h.set_size(0);
                b.append_data(&mut h, "w/f", std::io::empty()).unwrap();
            })),
            ("not gzip", b"nope".to_vec()),
        ];
        for (i, (what, gz)) in cases.iter().enumerate() {
            let into = tmp.path().join(i.to_string());
            std::fs::create_dir(&into).unwrap();
            assert!(matches!(unpack_package(gz, "w", &into), Err(Error::Verify(..))), "{what}");
        }
        // `..` never gets past the tar writer, so write the raw name.
        let mut h = tar::Header::new_gnu();
        h.as_gnu_mut().unwrap().name[..8].copy_from_slice(b"w/../x\0\0");
        h.set_size(1);
        h.set_mode(0o644);
        h.set_cksum();
        let mut b = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()));
        b.append(&h, &b"x"[..]).unwrap();
        let gz = b.into_inner().unwrap().finish().unwrap();
        let into = tmp.path().join("dotdot");
        std::fs::create_dir(&into).unwrap();
        assert!(matches!(unpack_package(&gz, "w", &into), Err(Error::Verify(..))));
        assert!(!tmp.path().join("x").exists() && !into.join("x").exists());
        // The good shape, modes normalised.
        let into = tmp.path().join("good");
        std::fs::create_dir(&into).unwrap();
        let top = unpack_package(&pack("w", &[("a/b.js", "1", false), ("run.sh", "2", true)]), "w", &into).unwrap();
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(top.join("run.sh")).unwrap().permissions().mode() & 0o777, 0o755);
        assert_eq!(std::fs::metadata(top.join("a/b.js")).unwrap().permissions().mode() & 0o777, 0o644);
    }

    #[test]
    fn name_clash_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let (mut a, mut b) = (Fixture::new("acme"), Fixture::new("beta"));
        for fx in [&mut a, &mut b] {
            let build = fx.build("todo", "x", 1, 1, None);
            fx.list("todo", vec![build], None);
            let build = fx.build("calc", "x", 1, 1, None);
            fx.list("calc", vec![build], None);
        }
        let regs = Registries::new(tmp.path().join("cache"), vec![a.source(), b.source()]);
        regs.refresh_all();
        let roots = Roots { bundled: BTreeSet::from(["calc".into()]), local: BTreeSet::from(["mine".into()]) };
        assert!(matches!(store.install(&regs, "calc", None, &roots), Err(Error::Reserved(_))), "a core name from another registry");
        assert!(matches!(store.install(&regs, "mine", None, &roots), Err(Error::Local(_))));
        assert!(matches!(store.install(&regs, "todo", Some("gamma"), &roots), Err(Error::NotIn(..))));
        assert_eq!(store.install(&regs, "todo", Some("beta"), &roots).unwrap().kind(), Kind::Registry { registry: "beta", channel: Channel::Stable, hash: store.get("todo").unwrap().record.unwrap().hash.as_deref().unwrap(), seq: 1, protocol: 1 });
        match store.install(&regs, "todo", None, &roots) {
            Err(Error::Clash { name, installed, other }) => assert_eq!((name.as_str(), installed.as_str(), other.as_str()), ("todo", "beta", "acme")),
            r => panic!("{r:?}"),
        }
        // A source whose manifest is a local root's name is refused too.
        let src = ext(&tmp.path().join("src"), "mine", "1");
        assert!(matches!(store.install_from(src.to_str().unwrap(), None, &roots), Err(Error::Local(_))));
    }

    #[test]
    fn install_picks_what_runs_here() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut fx = Fixture::new("acme");
        let too_new = fx.build("new", "x", 1, registry::PROTOCOL + 1, None);
        fx.list("new", vec![too_new], None);
        let elsewhere = fx.build("far", "x", 1, 1, None);
        let other = if registry::platform() == "macos" { "linux" } else { "macos" };
        fx.list("far", vec![elsewhere], Some(&[other]));
        let mut yanked = fx.build("gone", "x", 1, 1, None);
        yanked["yanked"] = true.into();
        fx.list("gone", vec![yanked], None);
        let regs = Registries::new(tmp.path().join("cache"), vec![fx.source()]);
        regs.refresh("acme").unwrap();
        let r = Roots::default();
        assert!(matches!(store.install(&regs, "new", None, &r), Err(Error::NeedsNewer(_, p)) if p == registry::PROTOCOL + 1));
        assert!(matches!(store.install(&regs, "far", None, &r), Err(Error::Platform(..))));
        assert!(matches!(store.install(&regs, "gone", None, &r), Err(Error::NoBuild(_))));
    }

    #[test]
    fn the_lock_serialises_processes_and_threads() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let held = store.lock().unwrap();
        // Another open file description (what another process has) cannot take it.
        let other = std::fs::OpenOptions::new().write(true).open(store.staging().join(".lock")).unwrap();
        assert!(matches!(other.try_lock(), Err(std::fs::TryLockError::WouldBlock)));
        drop(held);
        // Blocking, not `try_lock`: a test elsewhere forking a process can
        // hold a copy of the descriptor until its exec closes it.
        other.lock().unwrap();
        drop(other);

        // Two installs at once, each its own lock: both land whole.
        let mut fx = Fixture::new("acme");
        for n in ["one", "two"] {
            let b = fx.build(n, n, 1, 1, None);
            fx.list(n, vec![b], None);
        }
        let regs = Registries::new(tmp.path().join("cache"), vec![fx.source()]);
        regs.refresh("acme").unwrap();
        std::thread::scope(|s| {
            for n in ["one", "two"] {
                let (store, regs) = (&store, &regs);
                s.spawn(move || store.install(regs, n, None, &Roots::default()).unwrap());
            }
        });
        assert_eq!(store.list().unwrap().iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["one", "two"]);
    }

    #[test]
    fn the_first_lock_clears_staging_leftovers() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        std::fs::create_dir_all(store.staging().join("stage-crashed/x")).unwrap();
        std::fs::write(store.staging().join("old-x-1"), "").unwrap();
        drop(store.lock().unwrap());
        let left: Vec<_> = std::fs::read_dir(store.staging()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, [".lock"]);
    }

    #[test]
    fn local_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let src = ext(&tmp.path().join("src"), "hello", "1.0.0");
        std::fs::create_dir_all(src.join("node_modules/x")).unwrap();
        std::fs::write(src.join("node_modules/x/a.js"), "").unwrap();
        let store = Store::at(tmp.path().join("store"));
        assert!(store.list().unwrap().is_empty(), "no dir yet is an empty list");
        let none = Roots::default();

        let i = store.install_from(src.to_str().unwrap(), None, &none).unwrap();
        assert_eq!((i.name.as_str(), i.version.as_str()), ("hello", "1.0.0"));
        assert_eq!(i.dir, store.dir().join("hello"));
        assert!(i.dir.join("index.ts").is_file());
        assert!(!i.dir.join("node_modules").exists(), "node_modules is not copied");
        let rec = read_record(&i.dir).unwrap();
        assert_eq!(rec.source, src.canonicalize().unwrap().to_string_lossy());
        assert!(matches!(i.kind(), Kind::Source(_)));
        assert!(rec.installed_at > 0);
        assert!(matches!(store.install_from(src.to_str().unwrap(), None, &none), Err(Error::Exists(n)) if n == "hello"));
        assert_eq!(store.list().unwrap().len(), 1);
        let names: Vec<_> = std::fs::read_dir(store.dir()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, ["hello"], "no staging dir left behind");

        // Update re-copies the source; the old copy is the previous generation.
        std::fs::write(src.join("pal.json"), r#"{"name":"hello","version":"1.1.0"}"#).unwrap();
        let u = store.update_source("hello", None).unwrap();
        assert_eq!(u.version, "1.1.0");
        assert_eq!(store.get("hello").unwrap().version, "1.1.0");
        assert_eq!(validate_manifest(&store.previous("hello")).unwrap().1, "1.0.0");
        let leftovers: Vec<_> = std::fs::read_dir(store.staging()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(leftovers, [".lock"]);

        store.remove("hello").unwrap();
        assert!(matches!(store.remove("hello"), Err(Error::NotFound(_))));
        assert!(matches!(store.update_source("hello", None), Err(Error::NotFound(_))));
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn v1_records_read_as_source_installs() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("store"));
        let d = ext(store.dir(), "old", "1");
        std::fs::write(d.join(RECORD), r#"{"source":"github:zcag/pal/extensions/old@v0.7.2","ref":"v0.7.2","installed_at":5,"commit_or_etag":"abc"}"#).unwrap();
        let i = store.get("old").unwrap();
        assert_eq!(i.kind(), Kind::Source("github:zcag/pal/extensions/old@v0.7.2"));
        ext(store.dir(), "hand", "1");
        assert_eq!(store.get("hand").unwrap().kind(), Kind::Hand);
    }

    #[test]
    fn install_rejects_bad_manifest_and_leaves_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bad");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("pal.json"), r#"{"name":"../x","version":"1"}"#).unwrap();
        let store = Store::at(tmp.path().join("store"));
        assert!(matches!(store.install_from(src.to_str().unwrap(), None, &Roots::default()), Err(Error::Manifest(_))));
        let names: Vec<_> = std::fs::read_dir(store.dir()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert!(names.is_empty(), "{names:?}");
        let none = tmp.path().join("none");
        std::fs::create_dir_all(&none).unwrap();
        assert!(matches!(store.install_from(none.to_str().unwrap(), None, &Roots::default()), Err(Error::NoManifest(_))));
    }

    #[test]
    fn manifest_validation() {
        let cases: &[(&str, Option<(&str, &str)>)] = &[
            (r#"{"name":"hello","version":"1.0.0"}"#, Some(("hello", "1.0.0"))),
            (r#"{"name":"my-ext_2.0","version":3}"#, Some(("my-ext_2.0", "3"))),
            (r#"{"name":"hello"}"#, Some(("hello", ""))),
            (r#"{"version":"1"}"#, None),
            (r#"{"name":"","version":"1"}"#, None),
            (r#"{"name":"hello","version":[]}"#, None),
            (r#"{"name":"Hello","version":"1"}"#, None),
            (r#"{"name":"a/b","version":"1"}"#, None),
            (r#"{"name":"..","version":"1"}"#, None),
            (r#"{"name":".hidden","version":"1"}"#, None),
            (r#"{"name":"-x","version":"1"}"#, None),
            (r#"{"name":"a b","version":"1"}"#, None),
            ("not json", None),
            ("[]", None),
            (r#"{"name":"g","sync":{"best":"max","hand":"local"},"leaderboards":[{"id":"stage/*","title":"Stage {1}","order":"asc","format":"time"}]}"#, Some(("g", ""))),
            (r#"{"name":"g","sync":{"best":"most"}}"#, None),
            (r#"{"name":"g","leaderboards":[{"id":"Stage","title":"x","order":"asc","format":"time"}]}"#, None),
        ];
        for (text, want) in cases {
            let got = validate_manifest_text(text).ok();
            assert_eq!(got.as_ref().map(|(n, v)| (n.as_str(), v.as_str())), *want, "{text}");
        }
    }

    #[test]
    fn spec_parsing() {
        let gh = |owner: &str, repo: &str, subdir: Option<&str>, reference: Option<&str>| Spec::GitHub { owner: owner.into(), repo: repo.into(), subdir: subdir.map(String::from), reference: reference.map(String::from) };
        assert_eq!(Spec::parse("github:zcag/pal").unwrap(), gh("zcag", "pal", None, None));
        assert_eq!(Spec::parse("github:zcag/pal/examples/hello-extension@pali").unwrap(), gh("zcag", "pal", Some("examples/hello-extension"), Some("pali")));
        assert_eq!(Spec::parse("github:zcag/pal@v1.2").unwrap(), gh("zcag", "pal", None, Some("v1.2")));
        assert_eq!(Spec::parse("https://github.com/zcag/pal").unwrap(), gh("zcag", "pal", None, None));
        assert_eq!(Spec::parse("https://github.com/zcag/pal.git").unwrap(), gh("zcag", "pal", None, None));
        assert_eq!(Spec::parse("https://github.com/zcag/pal/tree/pali/examples/hello-extension").unwrap(), gh("zcag", "pal", Some("examples/hello-extension"), Some("pali")));
        assert_eq!(Spec::parse("github:zcag/pal/a/b@x").unwrap().to_spec_string(), "github:zcag/pal/a/b@x");
        for bad in ["github:zcag", "github:", "github:a/../b", "github:a/b/..@x", "https://github.com/zcag/pal/commits/x", "https://gitlab.com/a/b", "/nonexistent/dir/xyz"] {
            assert!(matches!(Spec::parse(bad), Err(Error::Spec(_))), "{bad}");
        }
        let tmp = tempfile::tempdir().unwrap();
        assert!(matches!(Spec::parse(tmp.path().to_str().unwrap()), Ok(Spec::Local(_))));
        assert!(Spec::is_bare_name("wordle") && Spec::is_bare_name(" wordle "));
        for spec in ["./x", "~/x", "github:a/b", "/abs", "a/b", ""] {
            assert!(!Spec::is_bare_name(spec), "{spec}");
        }
    }

    #[test]
    fn tarball_unpacks_to_its_top_dir() {
        let tmp = tempfile::tempdir().unwrap();
        // The shape codeload produces: one `<repo>-<ref>/` directory at the top.
        let top = tmp.path().join("pal-pali");
        ext(&top.join("examples"), "hello", "0.1.0");
        std::fs::write(top.join("README.md"), "x").unwrap();
        let tgz = tmp.path().join("x.tgz");
        let status = Command::new("tar").args(["-czf", tgz.to_str().unwrap(), "-C", tmp.path().to_str().unwrap(), "pal-pali"]).status().unwrap();
        assert!(status.success());
        let into = tmp.path().join("stage");
        std::fs::create_dir_all(&into).unwrap();
        let root = unpack(&std::fs::read(&tgz).unwrap(), &into).unwrap();
        assert_eq!(root.file_name().unwrap(), "pal-pali");
        assert!(root.join("examples/hello/pal.json").is_file());
        assert_eq!(validate_manifest(&root.join("examples/hello")).unwrap(), ("hello".to_string(), "0.1.0".to_string()));
        assert!(matches!(unpack(b"not a tarball", &tmp.path().join("bad")), Err(Error::Download(_))));
    }
}
