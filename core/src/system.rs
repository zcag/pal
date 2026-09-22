//! System commands: sleep, lock, log out, restart, shut down, empty the
//! trash, dark mode, volume, brightness, do not disturb, eject, show the
//! desktop, keep awake, quit or unhide every app, dismiss notifications.
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
//! no eject-all, show-desktop, quit-all or unhide-all that every desktop
//! understands (dismissing notifications goes through the daemon's CLI).
//!
//! **Quit All Apps** quits every regular (not background-only) app but
//! Finder and pal itself through System Events, each app asked the way
//! its Quit menu asks, so unsaved work still prompts. **Unhide All Apps**
//! sets every hidden process visible. **Dismiss Notifications** performs
//! the Clear All (else Close) action of every notification group in
//! Notification Center's window over Accessibility, the same UI scripting
//! the Lock Screen fallback uses; the window's tree has moved between
//! macOS versions, so the script walks the shapes known (Sonoma through
//! Tahoe) and reports what it found.
//!
//! **Keep awake** is the System extension's (`extensions/system/awake.ts`:
//! `caffeinate` with its own `-t`, a bar item, `pal://system/awake`). The
//! [`SPECS`] entry stays so the extension's row takes its place in the
//! catalogue; [`run`] refuses it and points there.

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
    Spec { id: "quit-all", title: "Quit All Apps", subtitle: "Quit every open app but Finder and pal", icon: "⌧", keywords: &["close all", "quit everything", "apps", "clean"], destructive: true },
    Spec { id: "unhide-all", title: "Unhide All Apps", subtitle: "Show every hidden app again", icon: "◫", keywords: &["show all", "hidden", "unhide", "apps"], destructive: false },
    Spec { id: "dismiss-notifications", title: "Dismiss Notifications", subtitle: "Clear every notification on screen", icon: "⌦", keywords: &["clear all", "notification center", "banners", "alerts"], destructive: false },
];

/// The catalogue, with what this machine can do marked `available`.
pub fn commands() -> Vec<SystemCommand> {
    SPECS
        .iter()
        .map(|s| {
            SystemCommand {
                id: s.id.to_string(),
                title: s.title.to_string(),
                subtitle: s.subtitle.to_string(),
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
        "keep-awake" => Err(Error::Unavailable("keep awake is the System extension's: pal://system/awake".into())),
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

    /// The `brightness` CLI that sets the display (`brightness -l` lists
    /// displays): the Homebrew one first, since a script of the same name
    /// earlier on PATH shadows it, then whatever PATH has.
    fn brightness_cli() -> Option<&'static str> {
        static CLI: OnceLock<Option<&'static str>> = OnceLock::new();
        *CLI.get_or_init(|| {
            ["/opt/homebrew/bin/brightness", "/usr/local/bin/brightness", "brightness"]
                .into_iter()
                .find(|b| (b.starts_with('/') || has(b)) && sh(b, &["-l"]).is_ok_and(|o| o.contains("display")))
        })
    }

    /// Whether the user made the Shortcut that toggles Focus.
    fn dnd_shortcut() -> bool {
        static OK: OnceLock<bool> = OnceLock::new();
        *OK.get_or_init(|| sh("shortcuts", &["list"]).is_ok_and(|o| o.lines().any(|l| l.trim() == DND_SHORTCUT)))
    }

    pub fn available(id: &str) -> bool {
        match id {
            "brightness-up" | "brightness-down" => brightness_cli().is_some(),
            "dnd" => dnd_shortcut(),
            _ => true,
        }
    }

    /// pal's own process name as System Events lists it (the bundle's
    /// executable, `pal`; a scratch or dev binary under its own name).
    fn own_name() -> String {
        std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).unwrap_or_else(|| "pal".into())
    }

    /// Every regular app but Finder and pal asked to quit, one `quit`
    /// each inside a `try` so an app that refuses (a save sheet, a hung
    /// one) does not stop the rest; the names skipped are the script's own.
    pub fn quit_all_script(own: &str) -> Vec<String> {
        vec![
            r#"tell application "System Events" to set procs to name of every process whose background only is false"#.into(),
            format!(r#"set keep to {{"Finder", "{}"}}"#, own.replace('"', "")),
            "repeat with p in procs".into(),
            "if (p as text) is not in keep then".into(),
            "try".into(),
            "tell application (p as text) to quit".into(),
            "end try".into(),
            "end if".into(),
            "end repeat".into(),
        ]
    }

    /// The Clear All (else Close) action of every notification group,
    /// performed until none is left. The groups sit under different
    /// paths per macOS version (Sonoma: `group 1 of group 1 of window`;
    /// Sequoia and Tahoe: `group 1 of UI element 1 of scroll area 1 of
    /// group 1 of group 1 of window`), so every group under the window is
    /// walked instead of one path; an action named Clear All in another
    /// language is matched by its `AXClearAll` subrole where it has one.
    pub const DISMISS_SCRIPT: &[&str] = &[
        r#"tell application "System Events" to tell process "NotificationCenter""#,
        "set n to 0",
        "repeat 20 times",
        "set found to false",
        r#"set groups_ to every group of entire contents of window "Notification Center""#,
        "repeat with g in groups_",
        "try",
        "set acts to actions of g",
        "repeat with a in acts",
        r#"if description of a is in {"Clear All", "Clear", "Close"} then"#,
        "perform a",
        "set found to true",
        "set n to n + 1",
        "exit repeat",
        "end if",
        "end repeat",
        "end try",
        "if found then exit repeat",
        "end repeat",
        "if not found then exit repeat",
        "end repeat",
        "end tell",
    ];

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
        let cli = brightness_cli().ok_or_else(|| Error::Unavailable("no brightness CLI".into()))?;
        let out = sh(cli, &["-l"])?;
        // "display 0: ... brightness 0.500000"
        let cur: f32 = out.lines().filter_map(|l| l.trim().strip_prefix("brightness ")).next().and_then(|v| v.trim().parse().ok()).unwrap_or(0.5);
        sh(cli, &[&format!("{:.2}", (cur + delta).clamp(0.0, 1.0))]).map(drop)
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
            "quit-all" => {
                let lines = quit_all_script(&own_name());
                osascript(&lines.iter().map(String::as_str).collect::<Vec<_>>())
            }
            "unhide-all" => osascript(&[r#"tell application "System Events" to set visible of every process whose visible is false and background only is false to true"#]),
            // `whose` on a missing window errors ("Can't get window"): none on screen is nothing to do, not a failure.
            "dismiss-notifications" => match osascript(DISMISS_SCRIPT) {
                Err(Error::Failed(e)) if e.contains("Can’t get window") || e.contains("Can't get window") => Ok(()),
                r => r,
            },
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
            "dnd" | "dismiss-notifications" => dnd_tool().is_some(),
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
            "dismiss-notifications" => match dnd_tool() {
                Some("swaync-client") => sh("swaync-client", &["--close-all"]).map(drop),
                Some("makoctl") => sh("makoctl", &["dismiss", "--all"]).map(drop),
                Some("dunstctl") => sh("dunstctl", &["close-all"]).map(drop),
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
        assert_eq!(destructive, ["logout", "restart", "shutdown", "empty-trash", "quit-all"]);
    }

    #[test]
    fn the_app_commands_are_in_the_catalogue_and_available_on_macos() {
        for id in ["quit-all", "unhide-all", "dismiss-notifications"] {
            assert!(SPECS.iter().any(|s| s.id == id), "{id}");
        }
        assert_eq!(cfg!(target_os = "macos"), platform::available("quit-all"));
        assert_eq!(cfg!(target_os = "macos"), platform::available("unhide-all"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn quit_all_keeps_finder_and_pal_and_asks_each_app_inside_a_try() {
        let lines = platform::quit_all_script("pal");
        assert!(lines[0].contains("background only is false"), "regular apps only");
        assert_eq!(lines[1], r#"set keep to {"Finder", "pal"}"#);
        assert!(lines.contains(&"try".to_string()) && lines.contains(&"tell application (p as text) to quit".to_string()));
        assert_eq!(platform::quit_all_script(r#"x"y"#)[1], r#"set keep to {"Finder", "xy"}"#, "a quote in the name cannot end the string");
        assert!(platform::DISMISS_SCRIPT.iter().any(|l| l.contains("Clear All")) && platform::DISMISS_SCRIPT.iter().any(|l| l.contains("perform a")));
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
