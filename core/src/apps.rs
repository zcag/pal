//! Which applications open a file, and opening it with one of them: the
//! "Open with…" of the `files` palette (`core/apps.{for_file,open_with}`
//! over the bridge).
//!
//! [`for_file`] asks the OS: on macOS `NSWorkspace`'s
//! `URLsForApplicationsToOpenURL:` (every app Launch Services registers for
//! the file's type, the replacement for `LSCopyApplicationURLsForURL` with
//! `kLSRolesAll`) and `URLForApplicationToOpenURL:` for the default; on
//! Linux the file's MIME type (`xdg-mime query filetype`, else `file`), the
//! default through `xdg-mime query default`, and the candidates from the
//! `mimeapps.list` files (added and removed associations, the default when
//! `xdg-mime` is missing) and every data dir's `mimeinfo.cache`. The
//! default comes first, the rest by name. [`open_with`] is `open -a <app>
//! <file>` and `gio launch <desktop> <file>`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no such file {0}")]
    NotFound(PathBuf),
    /// No way to ask on this system (a tool missing, no MIME type).
    #[error("apps unavailable: {0}")]
    Unavailable(String),
    /// The launcher ran and refused.
    #[error("{0}")]
    Failed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

/// One application that can open the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct App {
    pub name: String,
    /// The `.app` bundle on macOS, the `.desktop` file on Linux: what
    /// [`open_with`] takes and what `icons::app_icon` reads.
    pub path: PathBuf,
    /// `CFBundleIdentifier` on macOS, the desktop entry id
    /// (`org.gnome.TextEditor`) on Linux.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    /// The one a plain open would use; first in the list.
    pub default: bool,
}

/// Every app registered for the file's type, the default first, then by
/// name. Empty when nothing claims the type.
pub fn for_file(path: &Path) -> Result<Vec<App>> {
    if !path.exists() {
        return Err(Error::NotFound(path.to_path_buf()));
    }
    Ok(order(platform::for_file(path)?))
}

/// Open the file with that app (a `path` from [`for_file`]).
pub fn open_with(path: &Path, app: &Path) -> Result<()> {
    if !path.exists() {
        return Err(Error::NotFound(path.to_path_buf()));
    }
    platform::open_with(path, app)
}

/// Default first, then by name (case-insensitive), then path; one row per
/// path.
fn order(mut apps: Vec<App>) -> Vec<App> {
    apps.sort_by(|a, b| b.default.cmp(&a.default).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())).then_with(|| a.path.cmp(&b.path)));
    apps.dedup_by(|a, b| a.path == b.path);
    apps
}

// ---- Linux: mimeapps.list and mimeinfo.cache -----------------------------
// Pure parsers, compiled everywhere so the tests run on macOS too.

/// `mime=id;id;` lines in file order: one group of a `mimeapps.list`, or
/// the `[MIME Cache]` of a `mimeinfo.cache`.
type Assoc = Vec<(String, Vec<String>)>;

/// One `mimeapps.list`: `[Default Applications]`, `[Added Associations]`,
/// `[Removed Associations]`.
#[derive(Debug, Default, PartialEq, Eq)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
struct Mimeapps {
    default: Assoc,
    added: Assoc,
    removed: Assoc,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
impl Mimeapps {
    fn ids<'a>(list: &'a Assoc, mime: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        list.iter().filter(move |(m, _)| m == mime).flat_map(|(_, ids)| ids.iter().map(String::as_str))
    }
}

/// `key=a.desktop;b.desktop;` into its ids; blanks and comments skipped.
fn ids_line(line: &str) -> Option<(String, Vec<String>)> {
    let (k, v) = line.split_once('=')?;
    let ids = v.split(';').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect();
    Some((k.trim().to_string(), ids))
}

/// Lines under each group of the file, by group name.
fn groups(text: &str) -> Vec<(&str, Assoc)> {
    let mut out: Vec<(&str, Assoc)> = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            out.push((name.trim(), Vec::new()));
        } else if let (Some(group), Some(entry)) = (out.last_mut(), ids_line(line)) {
            group.1.push(entry);
        }
    }
    out
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_mimeapps(text: &str) -> Mimeapps {
    let mut m = Mimeapps::default();
    for (name, entries) in groups(text) {
        match name {
            "Default Applications" => m.default.extend(entries),
            "Added Associations" => m.added.extend(entries),
            "Removed Associations" => m.removed.extend(entries),
            _ => {}
        }
    }
    m
}

/// `[MIME Cache]` of a `mimeinfo.cache` (what `update-desktop-database`
/// writes: every desktop entry listing the type).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_mimeinfo_cache(text: &str) -> Assoc {
    groups(text).into_iter().filter(|(n, _)| *n == "MIME Cache").flat_map(|(_, e)| e).collect()
}

/// Desktop ids for `mime`, in order: `default` (given by `xdg-mime`, else
/// the first `[Default Applications]` entry in precedence order), then
/// the added associations file by file, then the caches dir by dir. An id
/// a file removes is dropped from everything after that file (a
/// higher-precedence file may add it back first). No duplicates.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn candidates(mime: &str, default: Option<&str>, lists: &[Mimeapps], caches: &[Assoc]) -> Vec<String> {
    let default = default.map(str::to_string).or_else(|| lists.iter().find_map(|l| Mimeapps::ids(&l.default, mime).next().map(str::to_string)));
    let mut out: Vec<String> = default.into_iter().collect();
    let mut removed: Vec<&str> = Vec::new();
    let push = |id: &str, out: &mut Vec<String>, removed: &[&str]| {
        if !removed.contains(&id) && !out.iter().any(|o| o == id) {
            out.push(id.to_string());
        }
    };
    for l in lists {
        for id in Mimeapps::ids(&l.added, mime) {
            push(id, &mut out, &removed);
        }
        removed.extend(Mimeapps::ids(&l.removed, mime));
    }
    for c in caches {
        for id in Mimeapps::ids(c, mime) {
            push(id, &mut out, &removed);
        }
    }
    out
}

/// The row for a desktop entry, `None` for one that hides itself
/// (`NoDisplay`, `Hidden`) or has no name.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn desktop_app(text: &str, path: PathBuf, id: &str, default: bool) -> Option<App> {
    let e = crate::fs::desktop_entry(text);
    if ["NoDisplay", "Hidden"].iter().any(|k| e.get(k).is_some_and(|v| v.eq_ignore_ascii_case("true"))) {
        return None;
    }
    let name = e.get("Name").copied().filter(|n| !n.is_empty())?;
    Some(App { name: name.to_string(), path, bundle_id: Some(id.strip_suffix(".desktop").unwrap_or(id).to_string()), default })
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};
    use std::process::{Command, Stdio};

    pub fn for_file(path: &Path) -> Result<Vec<App>> {
        let ws = NSWorkspace::sharedWorkspace();
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let default = ws.URLForApplicationToOpenURL(&url).and_then(|u| Some(PathBuf::from(u.path()?.to_string())));
        let mut apps: Vec<App> = ws.URLsForApplicationsToOpenURL(&url).iter().filter_map(|u| Some(PathBuf::from(u.path()?.to_string()))).map(|p| app(&p, default.as_deref() == Some(&p))).collect();
        if let Some(d) = default.filter(|d| !apps.iter().any(|a| &a.path == d)) {
            apps.push(app(&d, true));
        }
        Ok(apps)
    }

    /// Named like the `apps` palette names it (the bundle's file stem);
    /// the bundle id from Info.plist.
    fn app(path: &Path, default: bool) -> App {
        let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let info: Option<plist::Dictionary> = plist::from_file(path.join("Contents/Info.plist")).ok();
        let bundle_id = info.as_ref().and_then(|d| d.get("CFBundleIdentifier")?.as_string()).map(str::to_string);
        App { name, path: path.to_path_buf(), bundle_id, default }
    }

    pub fn open_with(path: &Path, app: &Path) -> Result<()> {
        let out = Command::new("open").arg("-a").arg(app).arg(path).stdin(Stdio::null()).output()?;
        if out.status.success() {
            return Ok(());
        }
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(Error::Failed(if err.is_empty() { format!("open: {}", out.status) } else { err }))
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::process::{Command, Stdio};

    fn sh(bin: &str, args: &[&str]) -> Result<String> {
        let out = Command::new(bin).args(args).stdin(Stdio::null()).output().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::Unavailable(format!("{bin} is not installed")),
            _ => Error::Io(e),
        })?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(Error::Failed(format!("{bin}: {}", if err.is_empty() { out.status.to_string() } else { err })));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// `xdg-mime query filetype`, else `file --mime-type`.
    fn mime_of(path: &Path) -> Result<String> {
        let p = path.to_string_lossy();
        let mime = sh("xdg-mime", &["query", "filetype", &p]).or_else(|_| sh("file", &["-b", "--mime-type", "--", &p]))?;
        let mime = mime.lines().next().unwrap_or_default().trim().to_string();
        if mime.is_empty() {
            return Err(Error::Unavailable(format!("no MIME type for {p}")));
        }
        Ok(mime)
    }

    /// `mimeapps.list` in precedence order: the config dirs (a
    /// `<desktop>-mimeapps.list` before the plain one), then the data dirs'
    /// `applications/`.
    fn mimeapps_files() -> Vec<PathBuf> {
        let home = dirs::home_dir().unwrap_or_default();
        let config_home = std::env::var_os("XDG_CONFIG_HOME").filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
        let config_sys = std::env::var_os("XDG_CONFIG_DIRS").filter(|s| !s.is_empty()).unwrap_or_else(|| "/etc/xdg".into());
        let desktops: Vec<String> = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().split(':').filter(|d| !d.is_empty()).map(|d| d.to_lowercase()).collect();
        let mut dirs = vec![config_home];
        dirs.extend(std::env::split_paths(&config_sys));
        dirs.extend(crate::fs::desktop_dirs());
        dirs.into_iter().flat_map(|d| desktops.iter().map(|x| d.join(format!("{x}-mimeapps.list"))).chain([d.join("mimeapps.list")]).collect::<Vec<_>>()).collect()
    }

    pub fn for_file(path: &Path) -> Result<Vec<App>> {
        let mime = mime_of(path)?;
        let default = sh("xdg-mime", &["query", "default", &mime]).ok().filter(|s| !s.is_empty());
        let lists: Vec<Mimeapps> = mimeapps_files().iter().filter_map(|f| std::fs::read_to_string(f).ok()).map(|t| parse_mimeapps(&t)).collect();
        let dirs = crate::fs::desktop_dirs();
        let caches: Vec<_> = dirs.iter().filter_map(|d| std::fs::read_to_string(d.join("mimeinfo.cache")).ok()).map(|t| parse_mimeinfo_cache(&t)).collect();
        let mut ids = candidates(&mime, default.as_deref(), &lists, &caches);
        // An editor registered for text/plain opens any text/* the desktop knows no better app for.
        if mime.starts_with("text/") && mime != "text/plain" {
            ids.extend(candidates("text/plain", None, &lists, &caches).into_iter().filter(|i| !ids.contains(i)));
        }
        let is_default = |id: &str| default.as_deref() == Some(id);
        Ok(ids
            .iter()
            .filter_map(|id| {
                // `org-gnome-Foo.desktop` may live at `org/gnome/Foo.desktop`.
                let rel = [PathBuf::from(id), PathBuf::from(id.replacen('-', "/", 1))];
                let file = dirs.iter().flat_map(|d| rel.iter().map(move |r| d.join(r))).find(|p| p.is_file())?;
                desktop_app(&std::fs::read_to_string(&file).ok()?, file, id, is_default(id))
            })
            .collect())
    }

    pub fn open_with(path: &Path, app: &Path) -> Result<()> {
        sh("gio", &["launch", &app.to_string_lossy(), &path.to_string_lossy()]).map(drop)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;
    pub fn for_file(_: &Path) -> Result<Vec<App>> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn open_with(_: &Path, _: &Path) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, path: &str, default: bool) -> App {
        App { name: name.into(), path: path.into(), bundle_id: None, default }
    }

    #[test]
    fn order_puts_the_default_first_then_names_and_drops_a_repeated_path() {
        let got = order(vec![app("TextEdit", "/System/Applications/TextEdit.app", false), app("kitty", "/Applications/kitty.app", false), app("Preview", "/System/Applications/Preview.app", true), app("Code", "/Applications/Code.app", false), app("Code", "/Applications/Code.app", false)]);
        assert_eq!(got.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Preview", "Code", "kitty", "TextEdit"]);
    }

    const MIMEAPPS: &str = "[Default Applications]\ntext/plain=org.gnome.TextEditor.desktop\nimage/png=org.gnome.Loupe.desktop;gimp.desktop\n\n[Added Associations]\ntext/plain=nvim.desktop;code.desktop;\n# a comment\nimage/png=gimp.desktop\n\n[Removed Associations]\ntext/plain=gedit.desktop\n";
    const CACHE: &str = "[MIME Cache]\ntext/plain=gedit.desktop;org.gnome.TextEditor.desktop;nvim.desktop;kate.desktop;\nimage/png=org.gnome.Loupe.desktop;gimp.desktop;\ntext/markdown=org.gnome.TextEditor.desktop;\n";

    #[test]
    fn mimeapps_groups_parse_into_ids() {
        let m = parse_mimeapps(MIMEAPPS);
        assert_eq!(m.default, [("text/plain".to_string(), vec!["org.gnome.TextEditor.desktop".to_string()]), ("image/png".to_string(), vec!["org.gnome.Loupe.desktop".to_string(), "gimp.desktop".to_string()])]);
        assert_eq!(m.added[0], ("text/plain".to_string(), vec!["nvim.desktop".to_string(), "code.desktop".to_string()]), "trailing ; is not an id");
        assert_eq!(m.removed, [("text/plain".to_string(), vec!["gedit.desktop".to_string()])]);
        assert_eq!(parse_mimeapps("[Other]\ntext/plain=x.desktop\n"), Mimeapps::default(), "unknown groups are ignored");
    }

    #[test]
    fn mimeinfo_cache_parses_the_cache_group() {
        let c = parse_mimeinfo_cache(CACHE);
        assert_eq!(c.len(), 3);
        assert_eq!(Mimeapps::ids(&c, "text/markdown").collect::<Vec<_>>(), ["org.gnome.TextEditor.desktop"]);
        assert!(parse_mimeinfo_cache("[Desktop Entry]\ntext/plain=x\n").is_empty());
    }

    #[test]
    fn candidates_default_first_added_then_cache_minus_removed() {
        let lists = [parse_mimeapps(MIMEAPPS)];
        let caches = [parse_mimeinfo_cache(CACHE)];
        // xdg-mime's answer leads; the file's default is the fallback.
        assert_eq!(candidates("text/plain", Some("kate.desktop"), &lists, &caches), ["kate.desktop", "nvim.desktop", "code.desktop", "org.gnome.TextEditor.desktop"], "gedit removed, kate not repeated");
        assert_eq!(candidates("text/plain", None, &lists, &caches), ["org.gnome.TextEditor.desktop", "nvim.desktop", "code.desktop", "kate.desktop"]);
        assert_eq!(candidates("image/png", None, &lists, &caches), ["org.gnome.Loupe.desktop", "gimp.desktop"]);
        assert!(candidates("application/pdf", None, &lists, &caches).is_empty());
        // A higher-precedence file adds back what a lower one removes; the reverse drops it.
        let user = parse_mimeapps("[Added Associations]\ntext/plain=gedit.desktop\n");
        let sys = parse_mimeapps("[Removed Associations]\ntext/plain=gedit.desktop;nvim.desktop\n");
        assert_eq!(candidates("text/plain", None, &[user, sys], &caches), ["gedit.desktop", "org.gnome.TextEditor.desktop", "kate.desktop"]);
    }

    #[test]
    fn desktop_app_reads_the_name_and_skips_hidden_entries() {
        let a = desktop_app("[Desktop Entry]\nName=Text Editor\nExec=gnome-text-editor %U\n", "/usr/share/applications/org.gnome.TextEditor.desktop".into(), "org.gnome.TextEditor.desktop", true).unwrap();
        assert_eq!(a, App { name: "Text Editor".into(), path: "/usr/share/applications/org.gnome.TextEditor.desktop".into(), bundle_id: Some("org.gnome.TextEditor".into()), default: true });
        assert!(desktop_app("[Desktop Entry]\nName=x\nNoDisplay=true\n", "/x.desktop".into(), "x.desktop", false).is_none());
        assert!(desktop_app("[Desktop Entry]\nName=x\nHidden=True\n", "/x.desktop".into(), "x.desktop", false).is_none());
        assert!(desktop_app("[Desktop Entry]\nExec=x\n", "/x.desktop".into(), "x.desktop", false).is_none(), "no name, no row");
    }

    #[test]
    fn for_file_refuses_a_missing_path() {
        assert!(matches!(for_file(Path::new("/no/such/file.txt")), Err(Error::NotFound(_))));
        assert!(matches!(open_with(Path::new("/no/such/file.txt"), Path::new("/Applications/TextEdit.app")), Err(Error::NotFound(_))));
    }
}
