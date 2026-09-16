//! First-run migration of a pal v1 config.
//!
//! v1 kept its config at the same path with another shape: `[palette.<name>]`
//! tables and `general.default_frontend`. The `scripts` extension runs those
//! tables as palettes from whatever file its `config` setting names, so the
//! v1 file is kept whole: it moves aside to [`V1_FILE`] next to the config,
//! and the new `config.toml` points the extension at it. Nothing in the v1
//! file is lost, and v1 itself still reads it with `-c`.
//!
//! The copy gets one edit: a `base` that no longer exists but does under the
//! v1 checkout (`v1_repo`, the `scripts` setting of that name) is pointed
//! there, since v1 lived at the path this repo took over.

use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, Item, Value};

use super::{edit, ConfigFile, Error, TEMPLATE};
use crate::fs;

/// Where the v1 file goes, next to the config.
pub const V1_FILE: &str = "config.v1.toml";

/// What [`migrate`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Migrated {
    /// Where the v1 file went.
    pub v1: PathBuf,
    /// The new config, as written.
    pub config: String,
    /// One line per thing done (`what\tdetail`), for the log.
    pub notes: Vec<String>,
}

/// The texts a migration writes, before anything is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// The v1 file with its dead `base`s re-pointed.
    pub v1: String,
    /// The new config.
    pub config: String,
    pub notes: Vec<String>,
}

/// Whether `text` is a v1 config: a `[palette.*]` table or v1's
/// `general.default_frontend` / `default_palette`, and none of this shape's
/// `[palettes]` / `[extensions]`. Text that is not TOML is not one either
/// (the loader reports that).
pub fn is_v1(text: &str) -> bool {
    let Ok(t) = text.parse::<toml::Table>() else { return false };
    let general = t.get("general").and_then(toml::Value::as_table);
    let v1 = t.get("palette").is_some_and(toml::Value::is_table)
        || general.is_some_and(|g| g.contains_key("default_frontend") || g.contains_key("default_palette"));
    v1 && !t.contains_key("palettes") && !t.contains_key("extensions")
}

/// Migrate the config at `file` when it is a v1 one: `Ok(None)` when it is
/// missing or not v1. The v1 copy is written and read back before the
/// config is replaced, so a failure anywhere leaves the original in place.
/// A [`V1_FILE`] already there from an earlier attempt is accepted when it
/// holds the same text (before or after the re-pointing), refused
/// otherwise.
pub fn migrate(file: &ConfigFile, v1_repo: &str) -> Result<Option<Migrated>, Error> {
    let target = file.target();
    let io = |path: &Path| {
        let path = path.to_path_buf();
        move |source| Error::Io { path, source }
    };
    let text = match std::fs::read_to_string(&target) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io(&target)(e)),
    };
    if !is_v1(&text) {
        return Ok(None);
    }
    let dir = std::path::absolute(file.path()).map_err(io(file.path()))?.parent().map_or_else(|| PathBuf::from("/"), Path::to_path_buf);
    let v1 = dir.join(V1_FILE);
    let plan = plan(&text, &dir, &v1, v1_repo)?;
    match std::fs::read_to_string(&v1) {
        Ok(existing) if existing != text && existing != plan.v1 => {
            return Err(io(&v1)(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "exists with other content; move it away to migrate")));
        }
        Ok(_) | Err(_) => {}
    }
    fs::write_atomic(&v1, &plan.v1).map_err(io(&v1))?;
    if std::fs::read_to_string(&v1).map_err(io(&v1))? != plan.v1 {
        return Err(io(&v1)(std::io::Error::other("read back differs from what was written")));
    }
    fs::write_atomic(&target, &plan.config).map_err(io(&target))?;
    let shown = file.path().display();
    let mut notes = vec![format!("v1 config\t{shown}"), format!("kept as\t{}", v1.display())];
    notes.extend(plan.notes);
    notes.push(format!("wrote\t{shown}"));
    Ok(Some(Migrated { v1, config: plan.config, notes }))
}

/// The pure part: from the v1 text, the re-pointed copy and the new config.
/// `dir` resolves v1's relative paths (its config directory), `v1_path` is
/// what the new config points the `scripts` extension at.
pub fn plan(text: &str, dir: &Path, v1_path: &Path, v1_repo: &str) -> Result<Plan, Error> {
    let mut doc: DocumentMut = text.parse().map_err(|source| Error::Parse { path: v1_path.to_path_buf(), source })?;
    let mut notes = Vec::new();
    let repo = fs::expand_home(v1_repo);
    let palettes: Vec<String> = doc.get("palette").and_then(Item::as_table_like).map(|t| t.iter().map(|(k, _)| k.to_string()).collect()).unwrap_or_default();
    for name in &palettes {
        let base = doc["palette"][name.as_str()].get("base").and_then(Item::as_str).map(str::to_string);
        let Some(base) = base else { continue };
        if let Some(moved) = repoint(&base, dir, &repo) {
            let moved = format!("{}/{moved}", v1_repo.trim_end_matches('/'));
            notes.push(format!("base\t{name}\t{base} -> {moved}"));
            edit::set(&mut doc, &format!("palette.{name}.base"), Value::from(moved))?;
        }
    }

    let mut out = DocumentMut::new();
    edit::set(&mut out, "extensions.scripts.config", Value::from(v1_path.to_string_lossy().as_ref()))?;
    let bookmarks = doc["palette"].get("bookmarks").and_then(|b| b.get("data")).and_then(Item::as_str);
    if let Some(data) = bookmarks.filter(|d| !d.starts_with("github:")) {
        let file = resolve(data, dir);
        notes.push(format!("bookmarks\t{}", file.display()));
        edit::set(&mut out, "extensions.bookmarks.file", Value::from(file.to_string_lossy().as_ref()))?;
    }
    let config = format!(
        "{TEMPLATE}#\n\
         # Migrated from a pal v1 config, which is kept whole at\n\
         #   {v1}\n\
         # and runs through the `scripts` extension ([extensions.scripts] below,\n\
         # or Settings > Extensions > Scripts). Everything else is the defaults.\n\
         \n{out}",
        v1 = v1_path.display()
    );
    Ok(Plan { v1: doc.to_string(), config, notes })
}

/// v1's path rule for `base` and `data`: `~` expanded, else relative to the
/// config directory.
fn resolve(p: &str, dir: &Path) -> PathBuf {
    let p = fs::expand_home(p);
    if p.is_absolute() { p } else { dir.join(p) }
}

/// The suffix of `base` under `repo` when `base` is gone and that exists:
/// `~/proj/pal/plugins/palettes/x` with no such dir, but
/// `<repo>/plugins/palettes/x`. Longest suffix first, at least two
/// components, so a bare name does not land on a namesake. `github:` and
/// `builtin/` bases are not paths.
fn repoint(base: &str, dir: &Path, repo: &Path) -> Option<String> {
    if base.starts_with("github:") || base.starts_with("builtin/") {
        return None;
    }
    let path = resolve(base, dir);
    if path.exists() {
        return None;
    }
    let parts: Vec<&str> = path.components().filter_map(|c| if let std::path::Component::Normal(s) = c { s.to_str() } else { None }).collect();
    (0..parts.len().saturating_sub(1)).map(|i| parts[i..].join("/")).find(|suffix| repo.join(suffix).is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape of a real v1 file: a builtin, a data palette with actions
    /// before its table, a plugin under the config dir, one under the old
    /// repo path, a github one.
    const V1: &str = r#"# Adding a palette here? Run `make raycast`.

[general]
default_palette = "combine"
default_frontend = "fzf"
env_file = "~/.env"

[palette]
  [palette.combine]
  base = "builtin/palettes/combine"
  include = ["pals", "bookmarks"]

  [[palette.bookmarks.actions]]
  id = "open"
  action = "open"
  key = "url"

  [palette.bookmarks]
  desc = "hand-picked links"
  auto_list = true
  data = "data/bookmarks.json"

  [palette.mk]
  base = "PLUGINS/mk"

  [palette.ha]
  base = "OLD/plugins/palettes/ha"
  # base = "github:zcag/pal/plugins/palettes/ha"

  [palette.gone]
  base = "OLD/plugins/palettes/nowhere"

  [palette.gh]
  base = "github:zcag/pal/plugins/palettes/gh"

[frontend]
  [frontend.fzf]
  base = "builtin/frontends/fzf"
"#;

    /// A config dir, a v1 checkout with `plugins/palettes/ha`, a plugin dir
    /// that exists, and the fixture with those paths spliced in.
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf, String) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("pal");
        let repo = tmp.path().join("pal-v1");
        std::fs::create_dir_all(dir.join("plugins/mk")).unwrap();
        std::fs::create_dir_all(repo.join("plugins/palettes/ha")).unwrap();
        let text = V1.replace("PLUGINS", &dir.join("plugins").to_string_lossy()).replace("OLD", &tmp.path().join("pal").to_string_lossy());
        (tmp, dir, repo, text)
    }

    #[test]
    fn detects_the_v1_shape() {
        assert!(is_v1(V1));
        assert!(is_v1("[general]\ndefault_frontend = \"fzf\"\n"));
        assert!(is_v1("[palette.x]\nbase = \"y\"\n"));
        assert!(!is_v1(""));
        assert!(!is_v1("[general]\nhotkey = \"alt+space\"\n"));
        assert!(!is_v1("[palettes.x]\nenabled = false\n"));
        assert!(!is_v1("[palette.x]\nbase = \"y\"\n[extensions.scripts]\nconfig = \"z\"\n"), "a file that already points at v1 is this shape");
        assert!(!is_v1("[palette.x\n"), "not TOML, not v1");
    }

    #[test]
    fn plan_repoints_dead_bases_and_carries_bookmarks() {
        let (_tmp, dir, repo, text) = fixture();
        let v1_path = dir.join(V1_FILE);
        let p = plan(&text, &dir, &v1_path, &repo.to_string_lossy()).unwrap();
        let ha = format!("base = \"{}/plugins/palettes/ha\"", repo.display());
        assert!(p.v1.contains(&ha), "the dead base under the old repo path moves to the checkout:\n{}", p.v1);
        assert!(p.v1.contains("# base = \"github:zcag/pal/plugins/palettes/ha\""), "comments survive");
        assert!(p.v1.contains(&format!("base = \"{}/plugins/palettes/nowhere\"", dir.display())), "a base that exists nowhere stays as written");
        assert!(p.v1.contains(&format!("base = \"{}/mk\"", dir.join("plugins").display())), "an existing base is untouched");
        assert!(p.v1.contains("base = \"github:zcag/pal/plugins/palettes/gh\""));
        assert!(p.v1.contains("[frontend.fzf]"), "the rest of the file is kept whole");
        assert!(p.v1.starts_with("# Adding a palette here?"));
        assert_eq!(p.notes, [format!("base\tha\t{}/plugins/palettes/ha -> {}/plugins/palettes/ha", dir.display(), repo.display()), format!("bookmarks\t{}", dir.join("data/bookmarks.json").display())]);

        assert!(p.config.starts_with(TEMPLATE), "the new file opens like any other");
        assert!(p.config.contains(&format!("#   {}\n", v1_path.display())));
        let (c, diags) = super::super::parse(&p.config).unwrap();
        assert!(diags.is_empty(), "{diags:?}");
        assert_eq!(c.extensions["scripts"]["config"].as_str(), Some(v1_path.to_str().unwrap()));
        assert_eq!(c.extensions["bookmarks"]["file"].as_str(), Some(dir.join("data/bookmarks.json").to_str().unwrap()), "v1's relative data path, from its config dir");
        assert_eq!(c.general, super::super::General::default());
        assert!(!p.config.contains("[extensions]\n"), "no empty parent header");
    }

    #[test]
    fn plan_without_bookmarks_or_tilde_repo() {
        let (_tmp, dir, _repo, _) = fixture();
        let p = plan("[palette.x]\nbase = \"github:a/b/c\"\n[palette.bookmarks]\ndata = \"github:zcag/pal/x.json\"\n", &dir, &dir.join(V1_FILE), "~/proj/pal-v1").unwrap();
        assert!(!p.config.contains("bookmarks"), "a github data file is not a local file");
        assert!(p.notes.is_empty());
        assert_eq!(p.v1, "[palette.x]\nbase = \"github:a/b/c\"\n[palette.bookmarks]\ndata = \"github:zcag/pal/x.json\"\n");
    }

    #[test]
    fn repointed_base_keeps_the_repo_spelling() {
        let (_tmp, dir, repo, _) = fixture();
        // The setting is written with `~` or an absolute path; the rewrite uses it as given.
        let text = format!("[palette.ha]\nbase = \"{}/plugins/palettes/ha\"\n", dir.display());
        let p = plan(&text, &dir, &dir.join(V1_FILE), &format!("{}/", repo.display())).unwrap();
        assert_eq!(p.v1, format!("[palette.ha]\nbase = \"{}/plugins/palettes/ha\"\n", repo.display()), "no double slash");
        let p = plan("[palette.ha]\nbase = \"~/nope/plugins/palettes/ha\"\n", &dir, &dir.join(V1_FILE), "~/nope-v1").unwrap();
        assert!(p.v1.contains("~/nope/plugins/palettes/ha"), "nothing under a checkout that does not exist");
    }

    #[test]
    fn migrate_moves_v1_aside_and_writes_the_new_config() {
        let (_tmp, dir, repo, text) = fixture();
        let path = dir.join("config.toml");
        std::fs::write(&path, &text).unwrap();
        let file = ConfigFile::new(&path);
        let m = migrate(&file, &repo.to_string_lossy()).unwrap().expect("a v1 file migrates");
        assert_eq!(m.v1, dir.join(V1_FILE));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), m.config);
        let kept = std::fs::read_to_string(&m.v1).unwrap();
        assert!(kept.contains("[frontend.fzf]") && kept.contains("plugins/palettes/ha\""));
        assert_eq!(m.notes[0], format!("v1 config\t{}", path.display()));
        assert_eq!(m.notes[1], format!("kept as\t{}", m.v1.display()));
        assert_eq!(m.notes.last().unwrap(), &format!("wrote\t{}", path.display()));
        assert!(m.notes.iter().any(|n| n.starts_with("base\tha\t")));
        let l = file.load();
        assert!(l.diagnostics.is_empty(), "{:?}", l.diagnostics);
        assert_eq!(l.config.extensions["scripts"]["config"].as_str(), Some(m.v1.to_str().unwrap()));
        // Second run: the file is this shape now, nothing happens.
        assert_eq!(migrate(&file, &repo.to_string_lossy()).unwrap(), None);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), m.config);
    }

    #[test]
    fn migrate_leaves_other_files_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let file = ConfigFile::new(&path);
        assert_eq!(migrate(&file, "~/proj/pal-v1").unwrap(), None, "missing file");
        let text = "[general]\ntheme = \"dark\"\n";
        std::fs::write(&path, text).unwrap();
        assert_eq!(migrate(&file, "~/proj/pal-v1").unwrap(), None, "this shape");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        assert!(!dir.path().join(V1_FILE).exists());
        std::fs::write(&path, "[palette.x\n").unwrap();
        assert_eq!(migrate(&file, "~/proj/pal-v1").unwrap(), None, "not TOML: the loader's problem, not ours");
    }

    #[test]
    fn migrate_refuses_to_clobber_a_foreign_v1_file() {
        let (_tmp, dir, repo, text) = fixture();
        let path = dir.join("config.toml");
        std::fs::write(&path, &text).unwrap();
        std::fs::write(dir.join(V1_FILE), "something else\n").unwrap();
        let file = ConfigFile::new(&path);
        assert!(matches!(migrate(&file, &repo.to_string_lossy()), Err(Error::Io { .. })));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text, "original untouched");
        assert_eq!(std::fs::read_to_string(dir.join(V1_FILE)).unwrap(), "something else\n");
        // A leftover from an interrupted run (the copy landed, the config did not) is fine.
        std::fs::write(dir.join(V1_FILE), &text).unwrap();
        assert!(migrate(&file, &repo.to_string_lossy()).unwrap().is_some());
    }

    #[test]
    fn migrate_follows_a_symlinked_config() {
        let (_tmp, dir, repo, text) = fixture();
        let real = dir.join("real.toml");
        std::fs::write(&real, &text).unwrap();
        let link = dir.join("config.toml");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let m = migrate(&ConfigFile::new(&link), &repo.to_string_lossy()).unwrap().unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().is_symlink(), "the link stays a link");
        assert_eq!(std::fs::read_to_string(&real).unwrap(), m.config);
        assert_eq!(m.v1, dir.join(V1_FILE), "the copy goes next to the path as given");
    }
}
