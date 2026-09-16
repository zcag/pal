//! `pal action <name>`: what a script palette calls to act on a value, with
//! no instance running (scripts run from the host's `bash -c` or a terminal).
//! The value comes on stdin; `copy` / `paste` / `open` / `type` / `cmd` run
//! in this process, any other name is an action script,
//! `plugins/actions/<name>` next to the config or under the `scripts`
//! extension's plugin repo, run as `<dir>/<command> run` with the value on
//! stdin and its stdout ours. `copy` and `open` print the `{"hud": ...}`
//! envelope the script tier expects, so a `cmd` ending in `| pal action copy`
//! gets its HUD.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use pal_core::clipboard;
use pal_core::config::ConfigFile;
use pal_core::fs::expand_home;

/// The actions v1 shipped as plugins, done in-process here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Builtin {
    Copy,
    Paste,
    Open,
    Type,
    Cmd,
}

impl Builtin {
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "copy" => Self::Copy,
            "paste" => Self::Paste,
            "open" => Self::Open,
            "type" => Self::Type,
            "cmd" => Self::Cmd,
            _ => return None,
        })
    }

    /// Whether the action wants the value at all; `paste` reads nothing,
    /// so a terminal call does not wait for EOF.
    pub fn reads_stdin(self) -> bool {
        self != Self::Paste
    }
}

/// A v1 action plugin: its directory and the command to run there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Script {
    pub dir: PathBuf,
    pub command: Vec<String>,
}

/// The first of `roots` with `plugins/actions/<name>/plugin.toml`, the way
/// v1 and the `scripts` extension look one up. The command is the plugin's
/// `command` (a string or an array), else `run.sh` when there is one.
pub fn find_script(name: &str, roots: &[PathBuf]) -> Option<Script> {
    if name.is_empty() || name.contains('/') || name.starts_with('.') {
        return None;
    }
    roots.iter().map(|r| r.join("plugins/actions").join(name)).find_map(|dir| {
        let text = std::fs::read_to_string(dir.join("plugin.toml")).ok()?;
        let plugin: toml::Table = text.parse().ok()?;
        let command = match plugin.get("command") {
            Some(toml::Value::String(s)) => vec![s.clone()],
            Some(toml::Value::Array(a)) => a.iter().filter_map(toml::Value::as_str).map(str::to_string).collect(),
            _ if dir.join("run.sh").is_file() => vec!["run.sh".into()],
            _ => return None,
        };
        (!command.is_empty()).then_some(Script { dir, command })
    })
}

/// v1's `plugins/actions` roots: the config's directory, then the v1 checkout.
fn script_roots() -> Vec<PathBuf> {
    let config_dir = ConfigFile::locate().path().parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    vec![config_dir, expand_home(&crate::firstrun::v1_repo())]
}

/// v1's `{"hud": "Copied ..."}`: the first 50 characters, as its plugin cut it.
pub fn hud_copied(value: &str) -> String {
    let display: String = value.chars().take(50).collect();
    let display = if value.chars().count() > 50 { format!("{display}...") } else { display };
    serde_json::json!({ "hud": format!("Copied {display}") }).to_string()
}

/// `pal action <name>`: the exit status.
pub fn action(name: &str) -> i32 {
    let builtin = Builtin::parse(name);
    let script = if builtin.is_none() {
        match find_script(name, &script_roots()) {
            Some(s) => Some(s),
            None => {
                eprintln!("pal\tno action `{name}`: not one of copy/paste/open/type/cmd, and no plugins/actions/{name} with a plugin.toml next to the config or under the v1 checkout");
                return 1;
            }
        }
    } else {
        None
    };
    let mut value = String::new();
    if builtin.is_none_or(Builtin::reads_stdin) {
        let _ = std::io::stdin().read_to_string(&mut value);
    }
    let value = value.trim_end();
    let r: Result<(), String> = match builtin {
        Some(Builtin::Copy) => clipboard::write_text(value).map_err(|e| e.to_string()).map(|()| println!("{}", hud_copied(value))),
        Some(Builtin::Paste) => {
            print!("{}", clipboard::read_text().unwrap_or_default());
            Ok(())
        }
        Some(Builtin::Open) => {
            let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
            Command::new(opener).arg(value).status().map_err(|e| format!("{opener}: {e}")).and_then(|s| {
                if s.success() {
                    println!("{}", serde_json::json!({ "hud": format!("Opened {value}"), "close": true }));
                    Ok(())
                } else {
                    Err(format!("{opener} exited {s}"))
                }
            })
        }
        Some(Builtin::Type) => clipboard::paste_text(value).map_err(|e| match e {
            clipboard::Error::NeedsAccessibility => "typing into the app in front sends a synthesised Cmd+V, which needs the Accessibility permission: grant pal in System Settings > Privacy & Security > Accessibility".to_string(),
            e => e.to_string(),
        }),
        // v1 ran the value with `bash -c`, as the `scripts` extension does.
        Some(Builtin::Cmd) => return status(Command::new("bash").arg("-c").arg(value).stdin(Stdio::null())),
        None => {
            let s = script.expect("looked up above");
            let mut cmd = Command::new(s.dir.join(&s.command[0]));
            cmd.args(&s.command[1..]).arg("run").current_dir(&s.dir).stdin(Stdio::piped());
            // v1 handed each plugin its plugin.toml as JSON in this variable.
            if let Some(json) = std::fs::read_to_string(s.dir.join("plugin.toml")).ok().and_then(|t| t.parse::<toml::Table>().ok()).and_then(|t| serde_json::to_string(&t).ok()) {
                cmd.env("_PAL_PLUGIN_CONFIG", json);
            }
            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("pal\taction {name}: {}: {e}", s.dir.join(&s.command[0]).display());
                    return 1;
                }
            };
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write;
                let _ = stdin.write_all(value.as_bytes());
            }
            return child.wait().map_or(1, |s| s.code().unwrap_or(1));
        }
    };
    match r {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("pal\taction {name}: {e}");
            1
        }
    }
}

fn status(cmd: &mut Command) -> i32 {
    match cmd.status() {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln!("pal\t{}: {e}", cmd.get_program().to_string_lossy());
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_by_name() {
        assert_eq!(Builtin::parse("copy"), Some(Builtin::Copy));
        assert_eq!(Builtin::parse("paste"), Some(Builtin::Paste));
        assert_eq!(Builtin::parse("open"), Some(Builtin::Open));
        assert_eq!(Builtin::parse("type"), Some(Builtin::Type));
        assert_eq!(Builtin::parse("cmd"), Some(Builtin::Cmd));
        assert_eq!(Builtin::parse("bt-focus"), None);
        assert!(!Builtin::Paste.reads_stdin(), "paste prints the clipboard, the value is unused");
        assert!(Builtin::Copy.reads_stdin());
    }

    #[test]
    fn hud_cuts_like_v1() {
        assert_eq!(hud_copied("abc"), r#"{"hud":"Copied abc"}"#);
        let long = "x".repeat(60);
        assert_eq!(hud_copied(&long), format!(r#"{{"hud":"Copied {}..."}}"#, "x".repeat(50)));
        assert_eq!(hud_copied(&"y".repeat(50)), format!(r#"{{"hud":"Copied {}"}}"#, "y".repeat(50)), "exactly 50 is not cut");
    }

    #[test]
    fn scripts_come_from_the_first_root_with_a_plugin_toml() {
        let tmp = tempfile::tempdir().unwrap();
        let (config, repo) = (tmp.path().join("config"), tmp.path().join("repo"));
        for (root, name, toml) in [
            (&config, "bt-focus", "name = \"bt-focus\"\ncommand = [\"run.sh\"]\n"),
            (&repo, "bt-focus", "name = \"other\"\ncommand = [\"go.sh\", \"-x\"]\n"),
            (&repo, "cmd", "name = \"cmd\"\ncommand = \"run.sh\"\n"),
            (&repo, "bare", "name = \"bare\"\n"),
            (&repo, "nocmd", "name = \"nocmd\"\n"),
        ] {
            let dir = root.join("plugins/actions").join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("plugin.toml"), toml).unwrap();
        }
        std::fs::write(repo.join("plugins/actions/bare/run.sh"), "").unwrap();
        let roots = [config.clone(), repo.clone()];
        let s = find_script("bt-focus", &roots).unwrap();
        assert_eq!(s, Script { dir: config.join("plugins/actions/bt-focus"), command: vec!["run.sh".into()] }, "the config dir wins");
        assert_eq!(find_script("bt-focus", std::slice::from_ref(&repo)).unwrap().command, ["go.sh", "-x"], "an array command keeps its arguments");
        assert_eq!(find_script("cmd", &roots).unwrap().command, ["run.sh"], "a string command");
        assert_eq!(find_script("bare", &roots).unwrap().command, ["run.sh"], "no command: run.sh when it exists");
        assert_eq!(find_script("nocmd", &roots), None, "no command, no run.sh");
        assert_eq!(find_script("missing", &roots), None);
        assert_eq!(find_script("../etc", &roots), None, "a name is a directory name");
        assert_eq!(find_script("", &roots), None);
    }


}
