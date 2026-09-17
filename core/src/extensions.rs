//! User-installed extensions: the store at `<data dir>/extensions/<name>/`,
//! the root the host loads after the bundled ones (so a user copy of `calc`
//! wins over the bundled one by name; `general.extension_dirs` come after).
//!
//! An extension is a directory with a `pal.json` (name, version) and an
//! `index.ts`. Installing is: stage it in a temp dir next to the store (a
//! local copy, or a GitHub tarball), validate the manifest, `bun install
//! --production` when it has a `package.json`, write `.pal-install.json`
//! next to the manifest, then one rename into place, so the host's watcher
//! and a reader never see a half-installed extension. Nothing here talks to
//! the host: the caller restarts it after a change.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::fs::{self, write_atomic};

/// The install record kept next to the manifest, so `update` knows where
/// the extension came from and `check_updates` what commit it is at.
pub const RECORD: &str = ".pal-install.json";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20);
const API_TIMEOUT: Duration = Duration::from_secs(10);
const BUN_TIMEOUT: Duration = Duration::from_secs(120);
/// A tarball larger than this is not an extension.
const MAX_TARBALL: u64 = 64 << 20;
const USER_AGENT: &str = "pal/0.1 (+https://github.com/zcag/pal)";
/// The site's store API: `GET <REGISTRY>/<name>` answers `{ "spec": "github:..." }`
/// (200) for a listed extension and 404 for an unknown name. What a bare
/// name in `pal install <name>` is resolved through.
pub const REGISTRY: &str = "https://pal.cagdas.io/api/extensions";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("bad spec {0:?}: expected a store name, a path, github:user/repo[/subdir][@ref] or a github.com URL")]
    Spec(String),
    #[error("{0}: not an extension the store at pal.cagdas.io knows; pass its source with --from (github:user/repo[/subdir][@ref], a github.com URL, or a directory)")]
    Unknown(String),
    #[error("could not look up {0} at pal.cagdas.io: {1}")]
    Registry(String, String),
    #[error("{0}: no such extension")]
    NotFound(String),
    #[error("{0} is already installed; update it instead")]
    Exists(String),
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
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
}

pub type Result<T> = std::result::Result<T, Error>;

fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> Error {
    let path = path.into();
    move |source| Error::Io { path, source }
}

/// Where an extension comes from, parsed from the spec string.
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

    /// `parse`, plus a bare name (`safe_name`, no `/`, `:` or `\\`, not
    /// starting with `.` or `~`) looked up in the site's store
    /// ([`REGISTRY`]) for its spec. An explicit spec never touches the
    /// network; `Store::install_from` skips the lookup for a bare word too.
    pub fn resolve(spec: &str) -> Result<Spec> {
        Self::resolve_with(spec, registry_lookup)
    }

    /// `resolve` with the store lookup injected: `Ok(Some(spec))` for a
    /// listed name, `Ok(None)` for an unknown one, `Err(why)` when the
    /// registry cannot be reached or read.
    pub fn resolve_with(spec: &str, lookup: impl FnOnce(&str) -> std::result::Result<Option<String>, String>) -> Result<Spec> {
        let spec = spec.trim();
        if !Self::is_bare_name(spec) {
            return Self::parse(spec);
        }
        if !safe_name(spec) {
            return Err(Error::Spec(spec.to_string()));
        }
        match lookup(spec) {
            Ok(Some(source)) => Self::parse(&source).map_err(|e| Error::Registry(spec.to_string(), format!("it answered {source:?}: {e}"))),
            Ok(None) => Err(Error::Unknown(spec.to_string())),
            Err(why) => Err(Error::Registry(spec.to_string(), why)),
        }
    }

    /// A word with no path or scheme shape: what the store lookup takes.
    fn is_bare_name(spec: &str) -> bool {
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

/// `.pal-install.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Record {
    /// The spec as given, normalised (`github:user/repo/sub@ref`, or an absolute path).
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<String>,
    /// Unix seconds.
    pub installed_at: u64,
    /// The commit sha the tarball was fetched at, when the GitHub API answered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_or_etag: Option<String>,
}

/// One extension in the store.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Installed {
    pub name: String,
    pub version: String,
    pub dir: PathBuf,
    /// Absent for a directory someone dropped in by hand.
    pub record: Option<Record>,
}

/// An extension whose source moved past the commit it was installed from.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Update {
    pub name: String,
    pub current: String,
    pub latest: String,
}

/// What `pal.json` must say before a directory counts as an extension.
#[derive(Debug, Deserialize)]
struct Manifest {
    name: Option<String>,
    version: Option<serde_json::Value>,
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

/// Reads and validates `<dir>/pal.json`: `(name, version)`.
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
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => s,
        Some(serde_json::Value::Number(n)) => n.to_string(),
        _ => return Err(Error::Manifest("version is required".into())),
    };
    Ok((name, version))
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

    /// `.extensions-staging` next to the store: where an install is
    /// assembled and a replaced copy is parked. Its leftovers are only ever
    /// a crash's.
    pub fn staging(&self) -> PathBuf {
        self.dir.parent().unwrap_or(&self.dir).join(".extensions-staging")
    }

    fn path_of(&self, name: &str) -> Result<PathBuf> {
        if !safe_name(name) {
            return Err(Error::NotFound(name.to_string()));
        }
        Ok(self.dir.join(name))
    }

    /// Installs `spec`, a store name resolved through the site
    /// (`Spec::resolve`) or an explicit source; refuses a name already in
    /// the store.
    pub fn install(&self, spec: &str, bun: Option<&Path>) -> Result<Installed> {
        self.put(&Spec::resolve(spec)?, bun, false)
    }

    /// `install` from an explicit source only (`Spec::parse`): a bare word
    /// is a directory here, never a store lookup. `pal install --from`.
    pub fn install_from(&self, spec: &str, bun: Option<&Path>) -> Result<Installed> {
        self.put(&Spec::parse(spec)?, bun, false)
    }

    /// Fetches the extension's recorded source again and replaces it.
    pub fn update(&self, name: &str, bun: Option<&Path>) -> Result<Installed> {
        let current = self.get(name)?;
        let source = current.record.map(|r| r.source).ok_or_else(|| Error::NoSource(name.to_string()))?;
        let spec = Spec::parse(&source).map_err(|_| Error::NoSource(name.to_string()))?;
        let installed = self.put(&spec, bun, true)?;
        if installed.name != name {
            // The source now says it is a different extension; keep both
            // rather than lose the one asked about.
            return Err(Error::Manifest(format!("source now names {:?}, not {name:?}", installed.name)));
        }
        Ok(installed)
    }

    pub fn remove(&self, name: &str) -> Result<()> {
        let dir = self.path_of(name)?;
        if !dir.is_dir() {
            return Err(Error::NotFound(name.to_string()));
        }
        std::fs::remove_dir_all(&dir).map_err(io(&dir))
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

    /// Every GitHub-installed extension whose branch moved since install.
    /// Unauthenticated (60 requests an hour), 10 s each; an extension whose
    /// check fails is left out rather than failing the whole answer.
    pub fn check_updates(&self) -> Result<Vec<Update>> {
        let mut out = Vec::new();
        for i in self.list()? {
            let Some(r) = i.record else { continue };
            let Some(current) = r.commit_or_etag.clone() else { continue };
            let Ok(Spec::GitHub { owner, repo, reference, .. }) = Spec::parse(&r.source) else { continue };
            if let Some(latest) = github_sha(&owner, &repo, reference.as_deref()) {
                if latest != current {
                    out.push(Update { name: i.name, current, latest });
                }
            }
        }
        Ok(out)
    }

    fn put(&self, spec: &Spec, bun: Option<&Path>, overwrite: bool) -> Result<Installed> {
        std::fs::create_dir_all(&self.dir).map_err(io(&self.dir))?;
        // Staged next to the store, not in it: same filesystem, so the final
        // rename is one atomic step, and out of the host's recursive watch
        // of the store, which would otherwise load the half-copied stage as
        // an extension named `.staging-x`. The temp dir goes with its guard
        // on any early return.
        let work = self.staging();
        std::fs::create_dir_all(&work).map_err(io(&work))?;
        let stage = tempfile::Builder::new().prefix("stage-").tempdir_in(&work).map_err(io(&work))?;
        let (src, commit) = match spec {
            Spec::Local(from) => {
                copy_tree(from, stage.path())?;
                (stage.path().to_path_buf(), None)
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
        let target = self.dir.join(&name);
        if target.exists() && !overwrite {
            return Err(Error::Exists(name));
        }
        if src.join("package.json").is_file() {
            bun_install(bun, &src)?;
        }
        let record = Record {
            source: spec.to_spec_string(),
            r#ref: match spec {
                Spec::GitHub { reference, .. } => reference.clone(),
                Spec::Local(_) => None,
            },
            installed_at: SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()),
            commit_or_etag: commit,
        };
        write_atomic(&src.join(RECORD), serde_json::to_vec_pretty(&record).unwrap_or_default()).map_err(io(src.join(RECORD)))?;
        // Into place: the old copy steps aside first and is dropped once the
        // new one is in, so a failure in between leaves the old one restorable.
        let old = work.join(format!("old-{name}-{}", std::process::id()));
        let had_old = target.exists();
        if had_old {
            std::fs::rename(&target, &old).map_err(io(&target))?;
        }
        if let Err(e) = std::fs::rename(&src, &target) {
            if had_old {
                let _ = std::fs::rename(&old, &target);
            }
            return Err(io(&target)(e));
        }
        if had_old {
            let _ = std::fs::remove_dir_all(&old);
        }
        Ok(Installed { name, version, dir: target, record: Some(record) })
    }
}

fn read_record(dir: &Path) -> Option<Record> {
    serde_json::from_slice(&std::fs::read(dir.join(RECORD)).ok()?).ok()
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

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder().user_agent(USER_AGENT).timeout_global(Some(timeout)).build().new_agent()
}

/// `GET REGISTRY/<name>`: the listed extension's spec, None on 404, the
/// reason on anything else (offline, a 5xx, a body without `spec`).
fn registry_lookup(name: &str) -> std::result::Result<Option<String>, String> {
    let url = format!("{REGISTRY}/{name}");
    let mut resp = match agent(API_TIMEOUT).get(&url).call() {
        Ok(r) => r,
        Err(ureq::Error::StatusCode(404)) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let text = resp.body_mut().read_to_string().map_err(|e| e.to_string())?;
    let body: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    match body.get("spec").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => Ok(Some(s.to_string())),
        _ => Err("the answer has no spec".into()),
    }
}

/// The commit `reference` (default branch when none) points at, or None
/// when the API does not answer (rate limit, private repo, offline).
fn github_sha(owner: &str, repo: &str, reference: Option<&str>) -> Option<String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/commits/{}", reference.unwrap_or("HEAD"));
    let mut resp = agent(API_TIMEOUT).get(&url).header("Accept", "application/vnd.github.sha").call().ok()?;
    let sha = resp.body_mut().read_to_string().ok()?;
    let sha = sha.trim().to_string();
    (sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit())).then_some(sha)
}

/// Downloads the codeload tarball into `into` and returns the directory it
/// unpacked to (`<repo>-<ref>/`, whatever GitHub named it).
fn download_github(owner: &str, repo: &str, reference: Option<&str>, into: &Path) -> Result<PathBuf> {
    let url = format!("https://codeload.github.com/{owner}/{repo}/tar.gz/{}", reference.unwrap_or("HEAD"));
    let mut resp = agent(DOWNLOAD_TIMEOUT).get(&url).call().map_err(|e| Error::Download(format!("{url}: {e}")))?;
    let mut bytes = Vec::new();
    resp.body_mut().as_reader().take(MAX_TARBALL).read_to_end(&mut bytes).map_err(|e| Error::Download(e.to_string()))?;
    unpack(&bytes, into)
}

/// A gzipped tar into `into`; returns its single top-level directory.
/// `tar` refuses `..` and absolute paths on its own.
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
mod tests {
    use super::*;

    fn ext(dir: &Path, name: &str, version: &str) -> PathBuf {
        let d = dir.join(name);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("pal.json"), format!(r#"{{"name":"{name}","title":"T","version":"{version}"}}"#)).unwrap();
        std::fs::write(d.join("index.ts"), "export default { palettes: {} }").unwrap();
        d
    }

    #[test]
    fn local_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let src = ext(&tmp.path().join("src"), "hello", "1.0.0");
        std::fs::create_dir_all(src.join("node_modules/x")).unwrap();
        std::fs::write(src.join("node_modules/x/a.js"), "").unwrap();
        let store = Store::at(tmp.path().join("store"));
        assert!(store.list().unwrap().is_empty(), "no dir yet is an empty list");

        let i = store.install(src.to_str().unwrap(), None).unwrap();
        assert_eq!((i.name.as_str(), i.version.as_str()), ("hello", "1.0.0"));
        assert_eq!(i.dir, store.dir().join("hello"));
        assert!(i.dir.join("index.ts").is_file());
        assert!(!i.dir.join("node_modules").exists(), "node_modules is not copied");
        let rec = read_record(&i.dir).unwrap();
        assert_eq!(rec.source, src.canonicalize().unwrap().to_string_lossy());
        assert!(rec.installed_at > 0);
        assert!(matches!(store.install(src.to_str().unwrap(), None), Err(Error::Exists(n)) if n == "hello"));
        assert_eq!(store.list().unwrap().len(), 1);
        let names: Vec<_> = std::fs::read_dir(store.dir()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, ["hello"], "no staging dir left behind");

        // Update re-copies the source.
        std::fs::write(src.join("pal.json"), r#"{"name":"hello","version":"1.1.0"}"#).unwrap();
        let u = store.update("hello", None).unwrap();
        assert_eq!(u.version, "1.1.0");
        assert_eq!(store.get("hello").unwrap().version, "1.1.0");
        let names: Vec<_> = std::fs::read_dir(store.dir()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, ["hello"], "old copy dropped");
        let leftovers: Vec<_> = std::fs::read_dir(store.staging()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");

        store.remove("hello").unwrap();
        assert!(matches!(store.remove("hello"), Err(Error::NotFound(_))));
        assert!(matches!(store.update("hello", None), Err(Error::NotFound(_))));
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn install_rejects_bad_manifest_and_leaves_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("bad");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("pal.json"), r#"{"name":"../x","version":"1"}"#).unwrap();
        let store = Store::at(tmp.path().join("store"));
        assert!(matches!(store.install(src.to_str().unwrap(), None), Err(Error::Manifest(_))));
        let names: Vec<_> = std::fs::read_dir(store.dir()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert!(names.is_empty(), "{names:?}");
        let none = tmp.path().join("none");
        std::fs::create_dir_all(&none).unwrap();
        assert!(matches!(store.install(none.to_str().unwrap(), None), Err(Error::NoManifest(_))));
    }

    #[test]
    fn manifest_validation() {
        let cases: &[(&str, Option<(&str, &str)>)] = &[
            (r#"{"name":"hello","version":"1.0.0"}"#, Some(("hello", "1.0.0"))),
            (r#"{"name":"my-ext_2.0","version":3}"#, Some(("my-ext_2.0", "3"))),
            (r#"{"version":"1"}"#, None),
            (r#"{"name":"","version":"1"}"#, None),
            (r#"{"name":"hello"}"#, None),
            (r#"{"name":"hello","version":""}"#, None),
            (r#"{"name":"Hello","version":"1"}"#, None),
            (r#"{"name":"a/b","version":"1"}"#, None),
            (r#"{"name":"..","version":"1"}"#, None),
            (r#"{"name":".hidden","version":"1"}"#, None),
            (r#"{"name":"-x","version":"1"}"#, None),
            (r#"{"name":"a b","version":"1"}"#, None),
            ("not json", None),
            ("[]", None),
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
    }

    #[test]
    fn bare_names_resolve_through_the_store() {
        let gh = "github:zcag/pal/extensions/2048@pali";
        let listed = |n: &str| if n == "2048" { Ok(Some(gh.to_string())) } else { Ok(None) };
        assert_eq!(Spec::resolve_with("2048", listed).unwrap().to_spec_string(), gh);
        assert_eq!(Spec::resolve_with("  2048 ", listed).unwrap().to_spec_string(), gh, "trimmed like parse");
        assert!(matches!(Spec::resolve_with("nope", listed), Err(Error::Unknown(n)) if n == "nope"));
        assert!(matches!(Spec::resolve_with("2048", |_| Err("offline".to_string())), Err(Error::Registry(n, why)) if n == "2048" && why == "offline"));
        assert!(matches!(Spec::resolve_with("2048", |_| Ok(Some("https://gitlab.com/a/b".to_string()))), Err(Error::Registry(_, why)) if why.contains("gitlab")));
        // Not a safe name and not a path: refused before any lookup.
        for bad in ["Hello", "a b", "-x", ""] {
            assert!(matches!(Spec::resolve_with(bad, |_| panic!("looked up {bad:?}")), Err(Error::Spec(_))), "{bad}");
        }
        // Explicit specs never reach the store.
        let never = |n: &str| -> std::result::Result<Option<String>, String> { panic!("looked up {n:?}") };
        assert_eq!(Spec::resolve_with("github:zcag/pal", never).unwrap().to_spec_string(), "github:zcag/pal");
        assert_eq!(Spec::resolve_with("https://github.com/zcag/pal", never).unwrap().to_spec_string(), "github:zcag/pal");
        assert!(matches!(Spec::resolve_with("https://gitlab.com/a/b", never), Err(Error::Spec(_))));
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("hello");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(matches!(Spec::resolve_with(dir.to_str().unwrap(), never), Ok(Spec::Local(_))), "an absolute dir");
        assert!(matches!(Spec::resolve_with("./nonexistent-xyz", never), Err(Error::Spec(_))), "a ./relative word is a path, not a name");
        assert!(matches!(Spec::resolve_with("~/nonexistent/xyz", never), Err(Error::Spec(_))), "a tilde path is a path, not a name");
        // A bare word is a store name even when a directory of that name
        // exists; `install_from` is the way to mean the directory.
        assert!(matches!(Spec::resolve_with("hello", |_| Ok(None)), Err(Error::Unknown(_))));
        std::fs::write(dir.join("pal.json"), r#"{"name":"hello","version":"1"}"#).unwrap();
        let store = Store::at(tmp.path().join("store"));
        assert_eq!(store.install_from(dir.to_str().unwrap(), None).unwrap().name, "hello");
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
