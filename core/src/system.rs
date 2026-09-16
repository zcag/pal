//! System commands: sleep, lock, log out, restart, shut down, empty the
//! trash, dark mode, volume, brightness, do not disturb, eject, show the
//! desktop, keep awake.
//!
//! One catalogue ([`SPECS`]) on every platform; [`commands`] marks each entry
//! `available` for this machine, so the palette only lists what will work,
//! and `destructive` for the ones that end the session or delete, so it asks
//! first. [`run`] shells out: macOS `osascript` / `pmset` / `caffeinate` /
//! Mission Control, Linux `systemctl` / `loginctl` / `wpctl` (else `pactl`) /
//! `brightnessctl` / `gio` / `gsettings` and the compositor's own tool, each
//! gated on the binary being installed.
//!
//! Some are not feasible everywhere and stay `available: false` rather than
//! guess: brightness on macOS needs the `brightness` CLI, do not disturb on
//! macOS a Shortcut named [`DND_SHORTCUT`] (Focus has no CLI), and Linux has
//! no eject-all or show-desktop that every desktop understands.
//!
//! **Keep awake** is a toggle: it starts `caffeinate -d -i` (Linux:
//! `systemd-inhibit ... sleep infinity`) detached and remembers the pid in
//! `data_dir/keep-awake.pid`; running it again stops that process. The
//! title says which way it will go.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::fs::on_path as has;

/// macOS: the Shortcut "Do Not Disturb" runs (one action: Set Focus, toggle).
pub const DND_SHORTCUT: &str = "Toggle Do Not Disturb";
/// Volume and brightness step per run, percent.
pub const STEP: u32 = 10;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no system command {0}")]
    Unknown(String),
    /// Not on this platform, or its tool is not installed.
    #[error("{0}")]
    Unavailable(String),
    /// The tool ran and refused.
    #[error("{0}")]
    Failed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemCommand {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    /// A glyph from the UI's set.
    pub icon: String,
    pub keywords: Vec<String>,
    /// Ends the session or deletes: the palette asks before running it.
    pub destructive: bool,
    pub available: bool,
}

struct Spec {
    id: &'static str,
    title: &'static str,
    subtitle: &'static str,
    icon: &'static str,
    keywords: &'static [&'static str],
    destructive: bool,
}

const SPECS: &[Spec] = &[
    Spec { id: "sleep", title: "Sleep", subtitle: "Put the machine to sleep", icon: "⏾", keywords: &["suspend", "standby", "nap"], destructive: false },
    Spec { id: "sleep-displays", title: "Sleep Displays", subtitle: "Turn the screens off", icon: "◒", keywords: &["screen", "display", "off", "dim"], destructive: false },
    Spec { id: "lock", title: "Lock Screen", subtitle: "Lock and ask for the password", icon: "⚿", keywords: &["secure", "away", "afk"], destructive: false },
    Spec { id: "logout", title: "Log Out", subtitle: "End the session", icon: "⇤", keywords: &["sign out", "exit", "session"], destructive: true },
    Spec { id: "restart", title: "Restart", subtitle: "Restart the machine", icon: "↻", keywords: &["reboot", "reset"], destructive: true },
    Spec { id: "shutdown", title: "Shut Down", subtitle: "Power the machine off", icon: "⏻", keywords: &["power off", "halt", "off"], destructive: true },
    Spec { id: "empty-trash", title: "Empty Trash", subtitle: "Delete everything in the trash", icon: "⌫", keywords: &["bin", "delete", "recycle"], destructive: true },
    Spec { id: "dark-mode", title: "Toggle Dark Mode", subtitle: "Switch between light and dark appearance", icon: "◐", keywords: &["theme", "light", "appearance", "night"], destructive: false },
    Spec { id: "volume-up", title: "Volume Up", subtitle: "Output volume up 10%", icon: "♫", keywords: &["louder", "sound", "audio"], destructive: false },
    Spec { id: "volume-down", title: "Volume Down", subtitle: "Output volume down 10%", icon: "♪", keywords: &["quieter", "sound", "audio"], destructive: false },
    Spec { id: "volume-mute", title: "Toggle Mute", subtitle: "Mute or unmute the output", icon: "♩", keywords: &["silence", "sound", "audio", "unmute"], destructive: false },
    Spec { id: "brightness-up", title: "Brightness Up", subtitle: "Display brightness up 10%", icon: "☀", keywords: &["brighter", "screen", "display"], destructive: false },
    Spec { id: "brightness-down", title: "Brightness Down", subtitle: "Display brightness down 10%", icon: "☼", keywords: &["dimmer", "screen", "display"], destructive: false },
    Spec { id: "dnd", title: "Toggle Do Not Disturb", subtitle: "Silence notifications, or let them through again", icon: "⊘", keywords: &["focus", "notifications", "quiet", "silent"], destructive: false },
    Spec { id: "eject-all", title: "Eject All Disks", subtitle: "Unmount every external disk and disk image", icon: "⏏", keywords: &["unmount", "usb", "drive", "volume"], destructive: false },
    Spec { id: "show-desktop", title: "Show Desktop", subtitle: "Move every window aside", icon: "▦", keywords: &["hide windows", "expose", "mission control"], destructive: false },
    Spec { id: "keep-awake", title: "Keep Awake", subtitle: "Stop the machine and display from sleeping until turned off", icon: "☕", keywords: &["caffeinate", "insomnia", "no sleep", "inhibit", "allow sleep"], destructive: false },
];

/// The catalogue, with what this machine can do marked `available`.
pub fn commands() -> Vec<SystemCommand> {
    let awake = keep_awake_pid().is_some();
    SPECS
        .iter()
        .map(|s| {
            let (title, subtitle) = match (s.id, awake) {
                ("keep-awake", true) => ("Allow Sleep".to_string(), "Keeping awake now; let the machine sleep again".to_string()),
                _ => (s.title.to_string(), s.subtitle.to_string()),
            };
            SystemCommand {
                id: s.id.to_string(),
                title,
                subtitle,
                icon: s.icon.to_string(),
                keywords: s.keywords.iter().map(|k| k.to_string()).collect(),
                destructive: s.destructive,
                available: platform::available(s.id),
            }
        })
        .collect()
}

pub fn run(id: &str) -> Result<()> {
    if !SPECS.iter().any(|s| s.id == id) {
        return Err(Error::Unknown(id.into()));
    }
    if !platform::available(id) {
        return Err(Error::Unavailable(format!("{id} is not available on this machine")));
    }
    match id {
        "keep-awake" => toggle_keep_awake(),
        _ => platform::run(id),
    }
}

// ---- shared helpers --------------------------------------------------------

/// Run to completion; non-zero exit is [`Error::Failed`] with what it said.
fn sh(bin: &str, args: &[&str]) -> Result<String> {
    let out = Command::new(bin).args(args).stdin(Stdio::null()).output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::Unavailable(format!("{bin} is not installed")),
        _ => Error::Io(e),
    })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(Error::Failed(format!("{bin}: {}", if err.is_empty() { out.status.to_string() } else { err })));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn keep_awake_file() -> PathBuf {
    crate::fs::data_dir().join("keep-awake.pid")
}

/// The keep-awake process pal started, if it is still the one running.
fn keep_awake_pid() -> Option<i32> {
    let pid: i32 = std::fs::read_to_string(keep_awake_file()).ok()?.trim().parse().ok()?;
    let cmd = sh("ps", &["-o", "command=", "-p", &pid.to_string()]).ok()?;
    (cmd.contains("caffeinate") || cmd.contains("systemd-inhibit")).then_some(pid)
}

fn toggle_keep_awake() -> Result<()> {
    if let Some(pid) = keep_awake_pid() {
        sh("kill", &[&pid.to_string()])?;
        let _ = std::fs::remove_file(keep_awake_file());
        return Ok(());
    }
    let (bin, args): (&str, &[&str]) = if cfg!(target_os = "macos") {
        ("caffeinate", &["-d", "-i"])
    } else {
        ("systemd-inhibit", &["--what=idle:sleep", "--who=pal", "--why=Keep awake", "sleep", "infinity"])
    };
    let mut child = Command::new(bin).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn()?;
    // One that dies at once (polkit refused the inhibit, say) is a failure
    // with its reason, not a pid file pointing at nothing.
    std::thread::sleep(std::time::Duration::from_millis(150));
    if child.try_wait()?.is_some() {
        let mut err = String::new();
        if let Some(mut e) = child.stderr.take() {
            let _ = std::io::Read::read_to_string(&mut e, &mut err);
        }
        return Err(Error::Failed(format!("{bin}: {}", err.trim())));
    }
    drop(child.stderr.take());
    crate::fs::write_atomic(&keep_awake_file(), child.id().to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::sync::OnceLock;

    fn osascript(lines: &[&str]) -> Result<()> {
        let mut args = vec![];
        for l in lines {
            args.extend(["-e", l]);
        }
        sh("osascript", &args).map(drop)
    }

    /// Whether the `brightness` on PATH is the CLI that sets the display
    /// (`brightness -l` lists displays), not something else by that name.
    fn brightness_cli() -> bool {
        static OK: OnceLock<bool> = OnceLock::new();
        *OK.get_or_init(|| has("brightness") && sh("brightness", &["-l"]).is_ok_and(|o| o.contains("display")))
    }

    /// Whether the user made the Shortcut that toggles Focus.
    fn dnd_shortcut() -> bool {
        static OK: OnceLock<bool> = OnceLock::new();
        *OK.get_or_init(|| sh("shortcuts", &["list"]).is_ok_and(|o| o.lines().any(|l| l.trim() == DND_SHORTCUT)))
    }

    pub fn available(id: &str) -> bool {
        match id {
            "brightness-up" | "brightness-down" => brightness_cli(),
            "dnd" => dnd_shortcut(),
            _ => true,
        }
    }

    /// `SACLockScreenImmediate` from the private login framework is what
    /// the menu bar's Lock Screen calls: immediate, and no permission
    /// needed. Falls back to the Cmd+Ctrl+Q keystroke, which needs
    /// Accessibility.
    fn lock() -> Result<()> {
        // SAFETY: dlopen/dlsym of a system framework; the symbol takes no arguments.
        unsafe {
            let path = c"/System/Library/PrivateFrameworks/login.framework/login";
            let lib = libc::dlopen(path.as_ptr(), libc::RTLD_LAZY);
            if !lib.is_null() {
                let sym = libc::dlsym(lib, c"SACLockScreenImmediate".as_ptr());
                if !sym.is_null() {
                    let f: extern "C" fn() -> i32 = std::mem::transmute(sym);
                    f();
                    return Ok(());
                }
            }
        }
        osascript(&[r#"tell application "System Events" to keystroke "q" using {command down, control down}"#])
    }

    fn brightness(delta: f32) -> Result<()> {
        let out = sh("brightness", &["-l"])?;
        // "display 0: ... brightness 0.500000"
        let cur: f32 = out.lines().filter_map(|l| l.trim().strip_prefix("brightness ")).next().and_then(|v| v.trim().parse().ok()).unwrap_or(0.5);
        sh("brightness", &[&format!("{:.2}", (cur + delta).clamp(0.0, 1.0))]).map(drop)
    }

    pub fn run(id: &str) -> Result<()> {
        let step = STEP.to_string();
        match id {
            "sleep" => sh("pmset", &["sleepnow"]).map(drop),
            "sleep-displays" => sh("pmset", &["displaysleepnow"]).map(drop),
            "lock" => lock(),
            "logout" => osascript(&[r#"tell application "System Events" to log out"#]),
            "restart" => osascript(&[r#"tell application "System Events" to restart"#]),
            "shutdown" => osascript(&[r#"tell application "System Events" to shut down"#]),
            "empty-trash" => osascript(&[r#"tell application "Finder" to empty trash"#]),
            "dark-mode" => osascript(&[r#"tell application "System Events" to tell appearance preferences to set dark mode to not dark mode"#]),
            "volume-up" => osascript(&["set v to output volume of (get volume settings)", &format!("set volume output volume (v + {step})")]),
            "volume-down" => osascript(&["set v to output volume of (get volume settings)", &format!("set volume output volume (v - {step})")]),
            "volume-mute" => osascript(&["set volume output muted not (output muted of (get volume settings))"]),
            "brightness-up" => brightness(STEP as f32 / 100.0),
            "brightness-down" => brightness(-(STEP as f32) / 100.0),
            "dnd" => sh("shortcuts", &["run", DND_SHORTCUT]).map(drop),
            "eject-all" => osascript(&[r#"tell application "Finder" to eject (every disk whose ejectable is true)"#]),
            // Mission Control's binary takes the mode: 1 shows the desktop, 2 the app's windows.
            "show-desktop" => sh("/System/Applications/Mission Control.app/Contents/MacOS/Mission Control", &["1"]).map(drop),
            _ => Err(Error::Unknown(id.into())),
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    /// Compositor from the window backend: the one place that detects it.
    fn compositor() -> &'static str {
        crate::windows::backend()
    }

    fn dnd_tool() -> Option<&'static str> {
        ["swaync-client", "makoctl", "dunstctl"].into_iter().find(|b| has(b))
    }

    pub fn available(id: &str) -> bool {
        match id {
            "sleep" | "restart" | "shutdown" => has("systemctl"),
            "sleep-displays" => compositor() == "hyprland" || (compositor() == "sway" && has("swaymsg")),
            "lock" => has("loginctl"),
            "logout" => has("loginctl") || matches!(compositor(), "hyprland" | "sway"),
            "empty-trash" => has("gio"),
            "dark-mode" => has("gsettings"),
            "volume-up" | "volume-down" | "volume-mute" => has("wpctl") || has("pactl"),
            "brightness-up" | "brightness-down" => has("brightnessctl"),
            "dnd" => dnd_tool().is_some(),
            "keep-awake" => has("systemd-inhibit"),
            _ => false,
        }
    }

    fn volume(arg_wpctl: &str, arg_pactl: (&str, &str)) -> Result<()> {
        if has("wpctl") {
            let args: Vec<&str> = if arg_wpctl == "toggle" { vec!["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"] } else { vec!["set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", arg_wpctl] };
            return sh("wpctl", &args).map(drop);
        }
        sh("pactl", &[arg_pactl.0, "@DEFAULT_SINK@", arg_pactl.1]).map(drop)
    }

    fn logout() -> Result<()> {
        match compositor() {
            "hyprland" => sh("hyprctl", &["dispatch", "exit"]).map(drop),
            "sway" => sh("swaymsg", &["exit"]).map(drop),
            _ => match std::env::var("XDG_SESSION_ID") {
                Ok(id) => sh("loginctl", &["terminate-session", &id]).map(drop),
                Err(_) => sh("loginctl", &["terminate-user", &std::env::var("USER").unwrap_or_default()]).map(drop),
            },
        }
    }

    fn dark_mode() -> Result<()> {
        let cur = sh("gsettings", &["get", "org.gnome.desktop.interface", "color-scheme"])?;
        let next = if cur.contains("prefer-dark") { "'default'" } else { "'prefer-dark'" };
        sh("gsettings", &["set", "org.gnome.desktop.interface", "color-scheme", next]).map(drop)
    }

    pub fn run(id: &str) -> Result<()> {
        let up = format!("{STEP}%+");
        let down = format!("{STEP}%-");
        match id {
            "sleep" => sh("systemctl", &["suspend"]).map(drop),
            "sleep-displays" => match compositor() {
                "hyprland" => sh("hyprctl", &["dispatch", "dpms", "off"]).map(drop),
                _ => sh("swaymsg", &["output", "*", "dpms", "off"]).map(drop),
            },
            "lock" => sh("loginctl", &["lock-session"]).map(drop),
            "logout" => logout(),
            "restart" => sh("systemctl", &["reboot"]).map(drop),
            "shutdown" => sh("systemctl", &["poweroff"]).map(drop),
            "empty-trash" => sh("gio", &["trash", "--empty"]).map(drop),
            "dark-mode" => dark_mode(),
            "volume-up" => volume(&up, ("set-sink-volume", &format!("+{STEP}%"))),
            "volume-down" => volume(&down, ("set-sink-volume", &format!("-{STEP}%"))),
            "volume-mute" => volume("toggle", ("set-sink-mute", "toggle")),
            "brightness-up" => sh("brightnessctl", &["set", &up]).map(drop),
            "brightness-down" => sh("brightnessctl", &["set", &down]).map(drop),
            "dnd" => match dnd_tool() {
                Some("swaync-client") => sh("swaync-client", &["-d"]).map(drop),
                Some("makoctl") => sh("makoctl", &["mode", "-t", "do-not-disturb"]).map(drop),
                Some("dunstctl") => sh("dunstctl", &["set-paused", "toggle"]).map(drop),
                _ => Err(Error::Unavailable("no notification daemon CLI".into())),
            },
            _ => Err(Error::Unavailable(format!("{id} is not available on Linux"))),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;

    pub fn available(_: &str) -> bool {
        false
    }
    pub fn run(id: &str) -> Result<()> {
        Err(Error::Unavailable(format!("{id} is not available on this platform")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_ids_are_unique_and_destructive_ones_are_the_session_enders() {
        let mut ids: Vec<_> = SPECS.iter().map(|s| s.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), SPECS.len());
        let destructive: Vec<_> = SPECS.iter().filter(|s| s.destructive).map(|s| s.id).collect();
        assert_eq!(destructive, ["logout", "restart", "shutdown", "empty-trash"]);
    }

    #[test]
    fn unknown_id_is_rejected_before_anything_runs() {
        assert!(matches!(run("format-disk"), Err(Error::Unknown(_))));
    }

    #[test]
    fn commands_carry_every_spec() {
        let cmds = commands();
        assert_eq!(cmds.len(), SPECS.len());
        assert!(cmds.iter().all(|c| !c.icon.is_empty() && !c.title.is_empty()));
    }
}
