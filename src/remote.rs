use std::path::PathBuf;
use std::process::{Command, Stdio};

/// Parsed github:user/repo/path[@ref] URL
struct GithubUrl {
    user: String,
    repo: String,
    path: String,
    git_ref: String,
}

impl GithubUrl {
    /// Parse "github:user/repo/path/to/plugin" or "github:user/repo/path@ref"
    fn parse(base: &str) -> Option<Self> {
        let rest = base.strip_prefix("github:")?;

        // Split off @ref if present
        let (path_part, git_ref) = if let Some(idx) = rest.rfind('@') {
            (&rest[..idx], rest[idx + 1..].to_string())
        } else {
            (rest, "main".to_string())
        };

        let parts: Vec<&str> = path_part.splitn(3, '/').collect();
        if parts.len() < 3 {
            return None;
        }

        Some(Self {
            user: parts[0].to_string(),
            repo: parts[1].to_string(),
            path: parts[2].to_string(),
            git_ref,
        })
    }

    /// Local directory where repo is cloned
    fn repo_dir(&self) -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("~/.local/share"))
            .join("pal/plugins/github.com")
            .join(&self.user)
            .join(&self.repo)
            .join(&self.git_ref)
    }

    /// Full local path to the plugin directory
    fn plugin_dir(&self) -> PathBuf {
        self.repo_dir().join(&self.path)
    }

    /// GitHub clone URL
    fn clone_url(&self) -> String {
        format!("https://github.com/{}/{}.git", self.user, self.repo)
    }
}

/// Check if base is a github: URL and ensure it's cloned locally.
/// Returns the local path to the plugin directory.
pub fn ensure_github(base: &str) -> Option<PathBuf> {
    let url = GithubUrl::parse(base)?;

    let repo_dir = url.repo_dir();
    let plugin_dir = url.plugin_dir();

    // Clone if repo doesn't exist
    if !repo_dir.join(".git").exists() {
        clone_repo(&url, &repo_dir);
    }

    // Add path to sparse checkout if not already present
    if !plugin_dir.exists() {
        sparse_checkout_add(&url, &repo_dir);
    }

    Some(plugin_dir)
}

fn clone_repo(url: &GithubUrl, repo_dir: &PathBuf) {
    // Create parent directories
    if let Some(parent) = repo_dir.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|e| {
            eprintln!("failed to create directory {}: {e}", parent.display());
            std::process::exit(1);
        });
    }

    let status = Command::new("git")
        .args([
            "clone",
            "--sparse",
            "--filter=blob:none",
            "--depth=1",
            "--branch",
            &url.git_ref,
            &url.clone_url(),
            &repo_dir.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => {
            eprintln!("git clone failed with exit code: {}", s.code().unwrap_or(-1));
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("git required for remote plugins: {e}");
            std::process::exit(1);
        }
    }
}

fn sparse_checkout_add(url: &GithubUrl, repo_dir: &PathBuf) {
    let status = Command::new("git")
        .args(["-C", &repo_dir.to_string_lossy(), "sparse-checkout", "add", &url.path])
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => {
            eprintln!("git sparse-checkout failed with exit code: {}", s.code().unwrap_or(-1));
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("git sparse-checkout failed: {e}");
            std::process::exit(1);
        }
    }
}
