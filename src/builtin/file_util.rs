use std::path::{Path, PathBuf};

pub struct ScanOptions<'a> {
    pub pattern: Option<&'a str>,
    pub extension: Option<&'a str>,
    pub max_depth: usize,
    pub hidden: bool,
    pub dirs_only: bool,
    pub files_only: bool,
}

impl Default for ScanOptions<'_> {
    fn default() -> Self {
        Self {
            pattern: None,
            extension: None,
            max_depth: 3,
            hidden: false,
            dirs_only: false,
            files_only: false,
        }
    }
}

pub fn scan_dirs(dirs: &[&str], opts: &ScanOptions) -> Vec<PathBuf> {
    let mut results = Vec::new();
    for dir in dirs {
        let path = expand_home(dir);
        collect_files(&path, opts, 0, &mut results);
    }
    results.sort_by(|a, b| {
        a.to_string_lossy().to_lowercase().cmp(&b.to_string_lossy().to_lowercase())
    });
    results
}

fn collect_files(dir: &Path, opts: &ScanOptions, depth: usize, results: &mut Vec<PathBuf>) {
    if depth > opts.max_depth {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else { return };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        if !opts.hidden && name.starts_with('.') {
            continue;
        }

        let is_dir = path.is_dir();

        let matches_ext = opts.extension
            .map(|ext| path.extension().map(|e| e == ext).unwrap_or(false))
            .unwrap_or(true);

        let matches_pattern = opts.pattern
            .map(|p| glob_match(name, p))
            .unwrap_or(true);

        let matches_type = match (opts.dirs_only, opts.files_only) {
            (true, _) => is_dir,
            (_, true) => !is_dir,
            _ => true,
        };

        if matches_ext && matches_pattern && matches_type {
            results.push(path.clone());
        }

        if is_dir {
            collect_files(&path, opts, depth + 1, results);
        }
    }
}

pub fn glob_match(name: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }

    let pattern_chars: Vec<char> = pattern.chars().collect();
    let name_chars: Vec<char> = name.chars().collect();

    glob_match_impl(&pattern_chars, &name_chars, 0, 0)
}

fn glob_match_impl(pattern: &[char], name: &[char], pi: usize, ni: usize) -> bool {
    if pi == pattern.len() {
        return ni == name.len();
    }

    match pattern[pi] {
        '*' => {
            for i in ni..=name.len() {
                if glob_match_impl(pattern, name, pi + 1, i) {
                    return true;
                }
            }
            false
        }
        '?' => {
            ni < name.len() && glob_match_impl(pattern, name, pi + 1, ni + 1)
        }
        c => {
            ni < name.len()
                && name[ni].to_lowercase().next() == c.to_lowercase().next()
                && glob_match_impl(pattern, name, pi + 1, ni + 1)
        }
    }
}

pub fn expand_home(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]);
        }
    } else if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(path)
}
