//! Where pal's own extensions are in development (docs/design/repo-split.md):
//! the checkouts of `zcag/pal-extensions` and `zcag/pal-games` beside the
//! pal checkout, or the ones `PAL_EXTENSION_REPOS` lists (a path list),
//! falling back to the checkout's own `extensions/` while it still exists.
//! A debug app loads them as its bundled root; the parity snapshot reads
//! their bar fixtures. `app/scripts/extension-repos.mjs` is the same rule
//! for the scripts, the host tests and the gallery.

use std::path::{Path, PathBuf};

/// The repos looked for beside the pal checkout.
pub const SIBLINGS: &[&str] = &["pal-extensions", "pal-games"];

/// One extension repo: `dir` holds the `<name>/` directories, `shots` the
/// gallery's screenshot fixtures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repo {
    pub dir: PathBuf,
    pub shots: PathBuf,
}

/// The extension repos for the pal checkout at `pal`, in order (a name in
/// an earlier one wins), from `PAL_EXTENSION_REPOS` when it is set.
pub fn repos(pal: &Path) -> Vec<Repo> {
    repos_from(pal, std::env::var_os("PAL_EXTENSION_REPOS"))
}

fn repos_from(pal: &Path, listed: Option<std::ffi::OsString>) -> Vec<Repo> {
    let listed: Vec<PathBuf> = listed.iter().flat_map(std::env::split_paths).filter(|p| !p.as_os_str().is_empty()).collect();
    let wanted = if listed.is_empty() { SIBLINGS.iter().map(|n| pal.join("..").join(n)).collect() } else { listed.clone() };
    let found: Vec<Repo> = wanted.into_iter().filter(|d| d.is_dir()).map(|dir| Repo { shots: dir.join("test/shots"), dir }).collect();
    let own = pal.join("extensions");
    if !found.is_empty() || !listed.is_empty() || !own.is_dir() {
        return found;
    }
    vec![Repo { dir: own, shots: pal.join("app/src/gallery/shots") }]
}

/// Every extension in `repos`: `(name, directory)`, sorted by name, the
/// first repo's when two have one.
pub fn extensions(repos: &[Repo]) -> Vec<(String, PathBuf)> {
    let mut out = std::collections::BTreeMap::new();
    for r in repos {
        for e in std::fs::read_dir(&r.dir).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && e.path().join("pal.json").is_file() {
                out.entry(name).or_insert_with(|| e.path());
            }
        }
    }
    out.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn siblings_then_the_list_then_the_own_folder() {
        let t = tempfile::tempdir().unwrap();
        let pal = t.path().join("pal");
        std::fs::create_dir_all(pal.join("extensions/calc")).unwrap();
        std::fs::write(pal.join("extensions/calc/pal.json"), "{}").unwrap();
        // No sibling: pal's own folder, with the app's shots.
        assert_eq!(repos_from(&pal, None), [Repo { dir: pal.join("extensions"), shots: pal.join("app/src/gallery/shots") }]);
        // A sibling wins over the own folder; only those that exist.
        std::fs::create_dir_all(t.path().join("pal-games/snake")).unwrap();
        std::fs::write(t.path().join("pal-games/snake/pal.json"), "{}").unwrap();
        let games = Repo { dir: pal.join("../pal-games"), shots: pal.join("../pal-games/test/shots") };
        assert_eq!(repos_from(&pal, None), [games.clone()]);
        assert_eq!(extensions(&repos_from(&pal, None)), [("snake".to_string(), pal.join("../pal-games/snake"))]);
        // The list is taken as given, and never falls back.
        let other = t.path().join("elsewhere");
        std::fs::create_dir_all(&other).unwrap();
        let list = std::env::join_paths([other.clone(), t.path().join("missing")]).unwrap();
        assert_eq!(repos_from(&pal, Some(list)), [Repo { shots: other.join("test/shots"), dir: other }]);
        assert_eq!(repos_from(&pal, Some(t.path().join("missing").into())), []);
    }
}
