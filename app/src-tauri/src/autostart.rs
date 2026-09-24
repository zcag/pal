//! `general.launch_at_login`, and the crash relaunch that rides on the same
//! agent. The OS's service manager both starts pal at login and restarts
//! it after a crash, so pal keeps one agent definition per platform and
//! makes sure the running process is the one that agent supervises.
//!
//! macOS: a LaunchAgent, label = the bundle identifier (`io.cagdas.pal`),
//! `RunAtLoad`, `KeepAlive { SuccessfulExit = false }` (relaunch after a
//! non-zero exit or a signal, not after `pal quit`'s exit 0), `ProcessType
//! Interactive`, `ThrottleInterval 5`. The setting decides where the plist
//! lives: on, `~/Library/LaunchAgents/<label>.plist`, which launchd loads at
//! login; off, `<data dir>/launchd/<label>.plist`, which nothing loads at
//! login and pal bootstraps itself for the session. Either way a crash
//! brings pal back and a quit does not. The former tauri-plugin-autostart
//! plist (`RunAtLoad` only, never loaded until the next login) is replaced
//! by the on variant; the plugin stays registered for Linux.
//!
//! Linux: an XDG autostart entry through tauri-plugin-autostart
//! (`~/.config/autostart/pal.desktop`) where there is no user systemd;
//! with one, a `pal.service` user unit (`Restart=on-failure`, enabled on
//! `graphical-session.target`) when the setting is on, and a transient unit
//! of the same name (`systemd-run`) for the session when it is off.
//!
//! The process launchd or systemd started is the one it restarts, so a pal
//! started by hand (`open -a pal`, `make app`, a terminal) hands itself
//! over at startup: it writes the definition, leaves a helper that waits
//! for its exit and starts the agent, and exits 0. That costs one extra
//! startup (nothing is visible yet) and happens at most once a minute
//! (`<data dir>/launchd/handover`), so a manager that will not start the
//! job cannot loop. A debug build does none of this: the definition would
//! point at `target/debug/pal` and outlive the checkout.

use std::path::{Path, PathBuf};

use pal_core::config::Config;
use tauri::plugin::TauriPlugin;
use tauri::AppHandle;

/// Hand-overs closer together than this run unsupervised instead.
const HANDOVER_GAP_SECS: u64 = 60;

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    let b = tauri_plugin_autostart::Builder::new();
    // Registered on macOS too (the builder is one line in lib.rs) but never
    // asked anything there; the LaunchAgent is written below.
    #[cfg(target_os = "macos")]
    let b = b.app_name("io.cagdas.pal").macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
    b.build()
}

/// At startup: the definition as the config says, then supervision. May
/// exit the process (the hand-over above); the caller's next step then
/// never runs, which is why this comes before the host is spawned.
pub fn install(app: &AppHandle, config: &Config) {
    let want = config.general.launch_at_login;
    if cfg!(debug_assertions) {
        eprintln!("autostart\tskipped\tlaunch_at_login = {want}; a debug build would register target/debug/pal");
        return;
    }
    platform::install(app, want);
}

/// On a change of the key: the definition moves between the login and the
/// session location. The loaded job is this process's own and stays as it
/// is (unloading it would end the process), so the new location counts
/// from the next login.
pub fn apply(app: &AppHandle, config: &Config) {
    let want = config.general.launch_at_login;
    if cfg!(debug_assertions) {
        eprintln!("autostart\tskipped\tlaunch_at_login = {want}; a debug build would register target/debug/pal");
        return;
    }
    platform::apply(app, want);
}

/// Whether launchd or systemd runs this very process: it then relaunches
/// pal after a non-zero exit, and kills whatever pal leaves behind in its
/// job, so a restart is an exit rather than a helper (`commands::restart`).
pub fn supervised(app: &AppHandle) -> bool {
    !cfg!(debug_assertions) && platform::supervised(app)
}

/// The environment the agent must carry so a relaunch lands on the same
/// profile and directories as the process that wrote it.
pub(crate) fn carried_env() -> Vec<(String, String)> {
    ["PAL_CONFIG", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"].iter().filter_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty()).map(|v| (k.to_string(), v))).collect()
}

/// This binary, symlinks resolved: what the agent runs.
pub(crate) fn program() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(std::fs::canonicalize(&exe).unwrap_or(exe))
}

/// `<data dir>/launchd`: the session definition, the hand-over marker and
/// the helper's log. Under the shared data dir, not the profile's: the
/// label is the identifier's, one per binary.
fn state_dir() -> PathBuf {
    pal_core::fs::data_dir().join("launchd")
}

/// Whether a hand-over happened within [`HANDOVER_GAP_SECS`]; records this
/// one when not. One file, unix seconds.
fn handover_allowed(dir: &Path) -> bool {
    let marker = dir.join("handover");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let last: u64 = std::fs::read_to_string(&marker).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    if now.saturating_sub(last) < HANDOVER_GAP_SECS {
        return false;
    }
    if let Err(e) = pal_core::fs::write_atomic(&marker, now.to_string()) {
        eprintln!("autostart\tmarker write failed\t{e}");
        return false;
    }
    true
}

/// Write `text` to `path` when it differs; true when written.
fn write_if_changed(path: &Path, text: &str) -> std::io::Result<bool> {
    if std::fs::read_to_string(path).is_ok_and(|have| have == text) {
        return Ok(false);
    }
    pal_core::fs::write_atomic(path, text)?;
    Ok(true)
}

fn remove_if_present(path: &Path) -> bool {
    match std::fs::remove_file(path) {
        Ok(()) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => {
            eprintln!("autostart\tremove failed\t{}\t{e}", path.display());
            false
        }
    }
}

/// Leave `script` running in its own process group with its output
/// appended to `log`, then exit 0: the helper starts the agent once this
/// pid is gone. The exit is `std::process::exit`, not `crate::quit`: at
/// this point in setup nothing has been written that needs a flush, and
/// the sooner the agent's instance starts the better. A helper that cannot
/// be spawned means nobody would start the agent, so that returns and the
/// startup goes on unsupervised.
fn handover(script: &str, log: &Path) {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    let out = std::fs::OpenOptions::new().create(true).append(true).open(log).ok();
    let err = out.as_ref().and_then(|f| f.try_clone().ok());
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(script).stdin(Stdio::null()).stdout(out.map_or(Stdio::null(), Stdio::from)).stderr(err.map_or(Stdio::null(), Stdio::from)).process_group(0);
    match cmd.spawn() {
        Ok(_) => {
            eprintln!("autostart\thanding over\tto the agent, log {}", log.display());
            std::process::exit(0)
        }
        Err(e) => eprintln!("autostart\thelper failed\t{e}; running unsupervised"),
    }
}

/// `s` as one POSIX shell word.
pub(crate) fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The wait every helper starts with: this process gone, then the agent.
pub(crate) fn wait_for_exit(pid: u32) -> String {
    format!("while kill -0 {pid} 2>/dev/null; do sleep 0.1; done\n")
}

// ---- macOS: launchd ---------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    extern "C" {
        fn getuid() -> u32;
    }

    /// One agent: where its two possible plists live and what they say.
    struct Agent {
        label: String,
        program: PathBuf,
        env: Vec<(String, String)>,
        uid: u32,
        login: PathBuf,
        session: PathBuf,
        dir: PathBuf,
    }

    #[derive(Debug, PartialEq, Eq)]
    enum Job {
        NotLoaded,
        /// Loaded, no process (`pal quit`, or a stale definition).
        Idle,
        Running(u32),
        Unknown(String),
    }

    impl Agent {
        fn new(app: &AppHandle) -> Option<Self> {
            let label = app.config().identifier.clone();
            let program = program()?;
            let home = PathBuf::from(std::env::var_os("HOME")?);
            let dir = state_dir();
            Some(Agent {
                login: home.join("Library/LaunchAgents").join(format!("{label}.plist")),
                session: dir.join(format!("{label}.plist")),
                uid: unsafe { getuid() },
                env: carried_env(),
                label,
                program,
                dir,
            })
        }

        /// The plist where `want` says, the other gone; returns the live one.
        fn sync_files(&self, want: bool) -> PathBuf {
            let text = plist(&self.label, &self.program, &self.env);
            let (live, other) = if want { (&self.login, &self.session) } else { (&self.session, &self.login) };
            match write_if_changed(live, &text) {
                Ok(true) => eprintln!("autostart\twrote\t{}", live.display()),
                Ok(false) => {}
                Err(e) => eprintln!("autostart\twrite failed\t{}\t{e}", live.display()),
            }
            if remove_if_present(other) {
                eprintln!("autostart\tremoved\t{}", other.display());
            }
            live.clone()
        }

        fn domain(&self) -> String {
            format!("gui/{}", self.uid)
        }

        fn job(&self) -> Job {
            let out = match std::process::Command::new("launchctl").args(["print", &format!("{}/{}", self.domain(), self.label)]).output() {
                Ok(o) => o,
                Err(e) => return Job::Unknown(format!("launchctl: {e}")),
            };
            if !out.status.success() {
                return Job::NotLoaded;
            }
            match job_pid(&String::from_utf8_lossy(&out.stdout)) {
                Some(pid) => Job::Running(pid),
                None => Job::Idle,
            }
        }
    }

    pub fn install(app: &AppHandle, want: bool) {
        let Some(agent) = Agent::new(app) else {
            eprintln!("autostart\tskipped\tno HOME or no executable path");
            return;
        };
        let plist = agent.sync_files(want);
        let me = std::process::id();
        match agent.job() {
            Job::Running(pid) if pid == me => eprintln!("autostart\tsupervised\t{} pid {pid}", agent.label),
            Job::Running(pid) => eprintln!("autostart\tunsupervised\tlaunchd runs {} as pid {pid}, not this process", agent.label),
            Job::Unknown(e) => eprintln!("autostart\tunsupervised\t{e}"),
            Job::NotLoaded | Job::Idle => {
                if !handover_allowed(&agent.dir) {
                    eprintln!("autostart\tunsupervised\thanded over less than {HANDOVER_GAP_SECS}s ago; staying");
                    return;
                }
                let script = helper(me, &agent.domain(), &agent.label, &plist, &agent.program);
                handover(&script, &agent.dir.join("handover.log"));
            }
        }
    }

    pub fn supervised(app: &AppHandle) -> bool {
        Agent::new(app).is_some_and(|a| a.job() == Job::Running(std::process::id()))
    }

    pub fn apply(app: &AppHandle, want: bool) {
        let Some(agent) = Agent::new(app) else { return };
        agent.sync_files(want);
        match agent.job() {
            Job::Running(pid) if pid == std::process::id() => eprintln!("autostart\tlaunch_at_login = {want}\tthe loaded agent stays this session; the new location counts from the next login"),
            _ => eprintln!("autostart\tlaunch_at_login = {want}\tthis run is not under launchd; supervision starts with the next launch"),
        }
    }

    /// The LaunchAgent. `KeepAlive.SuccessfulExit = false` implies
    /// `RunAtLoad`, so a loaded agent always has a process: what makes the
    /// on/off distinction a matter of where the file is.
    pub fn plist(label: &str, program: &Path, env: &[(String, String)]) -> String {
        let mut s = String::from(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n",
        );
        s.push_str(&format!("\t<key>Label</key>\n\t<string>{}</string>\n", xml(label)));
        s.push_str(&format!("\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>{}</string>\n\t</array>\n", xml(&program.to_string_lossy())));
        s.push_str("\t<key>RunAtLoad</key>\n\t<true/>\n");
        s.push_str("\t<key>KeepAlive</key>\n\t<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>\n");
        s.push_str("\t<key>ProcessType</key>\n\t<string>Interactive</string>\n");
        s.push_str("\t<key>ThrottleInterval</key>\n\t<integer>5</integer>\n");
        if !env.is_empty() {
            s.push_str("\t<key>EnvironmentVariables</key>\n\t<dict>\n");
            for (k, v) in env {
                s.push_str(&format!("\t\t<key>{}</key>\n\t\t<string>{}</string>\n", xml(k), xml(v)));
            }
            s.push_str("\t</dict>\n");
        }
        s.push_str("</dict>\n</plist>\n");
        s
    }

    fn xml(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    /// The `pid = N` line of `launchctl print` for a running job; a loaded
    /// job with no process has none.
    pub fn job_pid(print: &str) -> Option<u32> {
        print.lines().map(str::trim).find_map(|l| l.strip_prefix("pid = ")).and_then(|n| n.trim().parse().ok())
    }

    /// The hand-over helper: once `pid` is gone, unload whatever is under
    /// the label and load `plist`. A refused bootstrap falls back to
    /// kickstarting what is loaded, and that failing, to running the
    /// program itself, unsupervised (the marker keeps that from handing
    /// over again).
    pub fn helper(pid: u32, domain: &str, label: &str, plist: &Path, program: &Path) -> String {
        let plist = sh_quote(&plist.to_string_lossy());
        let program = sh_quote(&program.to_string_lossy());
        let mut s = wait_for_exit(pid);
        s.push_str(&format!("launchctl bootout {domain}/{label} 2>/dev/null\n"));
        s.push_str(&format!("launchctl bootstrap {domain} {plist} && exit 0\n"));
        s.push_str("echo \"bootstrap failed; kickstart\" >&2\n");
        s.push_str(&format!("launchctl kickstart {domain}/{label} && exit 0\n"));
        s.push_str("echo \"kickstart failed; running unsupervised\" >&2\n");
        s.push_str(&format!("exec {program}\n"));
        s
    }
}

// ---- Linux: systemd, else the XDG entry -------------------------------------

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use tauri_plugin_autostart::ManagerExt;

    const UNIT: &str = "pal.service";

    fn has_systemd() -> bool {
        std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join("systemctl").is_file()))
    }

    fn systemctl(args: &[&str]) -> Result<String, String> {
        let out = std::process::Command::new("systemctl").arg("--user").args(args).output().map_err(|e| format!("systemctl: {e}"))?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    /// `pal.service`'s main pid, when it is running.
    fn unit_pid() -> Option<u32> {
        systemctl(&["show", "-p", "MainPID", "--value", UNIT]).ok()?.parse().ok().filter(|p| *p != 0)
    }

    fn unit_path() -> Option<PathBuf> {
        Some(pal_core::fs::config_dir().parent()?.join("systemd/user").join(UNIT))
    }

    /// The XDG entry as the plugin keeps it; only where there is no systemd.
    fn xdg(app: &AppHandle, want: bool) {
        let m = app.autolaunch();
        let have = match m.is_enabled() {
            Ok(v) => v,
            Err(e) => return eprintln!("autostart\tstatus failed\t{e}"),
        };
        if want == have {
            return;
        }
        let r = if want { m.enable() } else { m.disable() };
        match r {
            Ok(()) => eprintln!("autostart\txdg entry\t{}", if want { "registered" } else { "removed" }),
            Err(e) => eprintln!("autostart\txdg entry {} failed\t{e}", if want { "register" } else { "remove" }),
        }
    }

    /// The unit file as `want` says (written and enabled, or disabled and
    /// gone); returns whether the file is there.
    fn sync_unit(want: bool, program: &Path) -> bool {
        let Some(path) = unit_path() else { return false };
        if want {
            match write_if_changed(&path, &unit(program, &carried_env())) {
                Ok(true) => eprintln!("autostart\twrote\t{}", path.display()),
                Ok(false) => {}
                Err(e) => {
                    eprintln!("autostart\twrite failed\t{}\t{e}", path.display());
                    return false;
                }
            }
            for args in [&["daemon-reload"][..], &["enable", UNIT]] {
                if let Err(e) = systemctl(args) {
                    eprintln!("autostart\tsystemctl {} failed\t{e}", args.join(" "));
                }
            }
            true
        } else {
            if path.exists() {
                if let Err(e) = systemctl(&["disable", UNIT]) {
                    eprintln!("autostart\tsystemctl disable failed\t{e}");
                }
                if remove_if_present(&path) {
                    eprintln!("autostart\tremoved\t{}", path.display());
                    let _ = systemctl(&["daemon-reload"]);
                }
            }
            false
        }
    }

    pub fn install(app: &AppHandle, want: bool) {
        if !has_systemd() {
            xdg(app, want);
            return;
        }
        xdg(app, false);
        let Some(program) = program() else { return };
        let enabled = sync_unit(want, &program);
        let me = std::process::id();
        match unit_pid() {
            Some(pid) if pid == me => eprintln!("autostart\tsupervised\t{UNIT} pid {pid}"),
            Some(pid) => eprintln!("autostart\tunsupervised\tsystemd runs {UNIT} as pid {pid}, not this process"),
            None => {
                let dir = state_dir();
                if !handover_allowed(&dir) {
                    eprintln!("autostart\tunsupervised\thanded over less than {HANDOVER_GAP_SECS}s ago; staying");
                    return;
                }
                handover(&helper(me, enabled, &program, &carried_env()), &dir.join("handover.log"));
            }
        }
    }

    pub fn supervised(_: &AppHandle) -> bool {
        has_systemd() && unit_pid() == Some(std::process::id())
    }

    pub fn apply(app: &AppHandle, want: bool) {
        if !has_systemd() {
            xdg(app, want);
            return;
        }
        if let Some(program) = program() {
            sync_unit(want, &program);
        }
        eprintln!("autostart\tlaunch_at_login = {want}");
    }

    /// The helper: the enabled unit, or a transient one of the same name
    /// for this session; that failing, the program itself, unsupervised.
    pub fn helper(pid: u32, enabled: bool, program: &Path, env: &[(String, String)]) -> String {
        let program = sh_quote(&program.to_string_lossy());
        let mut s = wait_for_exit(pid);
        if enabled {
            s.push_str(&format!("systemctl --user start {UNIT} && exit 0\n"));
        } else {
            // `--collect`: a unit that gave up restarting is unloaded, so the name is free for the next hand-over.
            let env: Vec<String> = env.iter().map(|(k, v)| format!(" --setenv={}", sh_quote(&format!("{k}={v}")))).collect();
            s.push_str(&format!("systemd-run --user --unit=pal --collect --property=Restart=on-failure --property=RestartSec=5{} {program} && exit 0\n", env.concat()));
        }
        s.push_str("echo \"systemd would not start pal; running unsupervised\" >&2\n");
        s.push_str(&format!("exec {program}\n"));
        s
    }
}

/// The user unit: pal under the graphical session, restarted after a
/// non-zero exit or a signal (never after `pal quit`), 5 s apart at most.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn unit(program: &Path, env: &[(String, String)]) -> String {
    let mut s = String::from("[Unit]\nDescription=pal\nPartOf=graphical-session.target\nAfter=graphical-session.target\n\n[Service]\n");
    s.push_str(&format!("ExecStart={}\n", program.to_string_lossy()));
    s.push_str("Restart=on-failure\nRestartSec=5\n");
    for (k, v) in env {
        s.push_str(&format!("Environment=\"{k}={}\"\n", v.replace('"', "\\\"")));
    }
    s.push_str("\n[Install]\nWantedBy=graphical-session.target\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_restarts_on_failure_only() {
        let u = unit(Path::new("/usr/bin/pal"), &[("PAL_CONFIG".into(), "/home/u/p.toml".into())]);
        assert!(u.contains("ExecStart=/usr/bin/pal\n"));
        assert!(u.contains("Restart=on-failure\n"));
        assert!(u.contains("Environment=\"PAL_CONFIG=/home/u/p.toml\"\n"));
        assert!(u.contains("WantedBy=graphical-session.target\n"));
    }

    #[test]
    fn shell_words_and_wait() {
        assert_eq!(sh_quote("/a b/it's"), "'/a b/it'\\''s'");
        assert_eq!(wait_for_exit(42), "while kill -0 42 2>/dev/null; do sleep 0.1; done\n");
    }

    #[test]
    fn handover_marker_gates_a_minute() {
        let dir = tempfile::tempdir().unwrap();
        assert!(handover_allowed(dir.path()));
        assert!(!handover_allowed(dir.path()), "a second hand-over right after the first");
        std::fs::write(dir.path().join("handover"), "1").unwrap();
        assert!(handover_allowed(dir.path()), "an old marker");
    }

    #[test]
    fn write_if_changed_writes_once() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.plist");
        assert!(write_if_changed(&p, "x").unwrap());
        assert!(!write_if_changed(&p, "x").unwrap());
        assert!(write_if_changed(&p, "y").unwrap());
        assert!(remove_if_present(&p));
        assert!(!remove_if_present(&p));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_helper_starts_the_unit_or_a_transient_one_with_the_env() {
        use super::platform::helper;
        let env = [("PAL_CONFIG".to_string(), "/tmp/a b.toml".to_string())];
        let h = helper(7, true, Path::new("/usr/bin/pal"), &env);
        let lines: Vec<&str> = h.lines().collect();
        assert_eq!(lines[0], "while kill -0 7 2>/dev/null; do sleep 0.1; done");
        assert_eq!(lines[1], "systemctl --user start pal.service && exit 0");
        assert_eq!(lines[3], "exec '/usr/bin/pal'");
        let h = helper(7, false, Path::new("/usr/bin/pal"), &env);
        assert_eq!(h.lines().nth(1).unwrap(), "systemd-run --user --unit=pal --collect --property=Restart=on-failure --property=RestartSec=5 --setenv='PAL_CONFIG=/tmp/a b.toml' '/usr/bin/pal' && exit 0");
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::super::platform::{helper, job_pid, plist};
        use std::path::Path;

        #[test]
        fn plist_keeps_alive_on_failure_only() {
            let p = plist("io.cagdas.pal", Path::new("/Applications/pal.app/Contents/MacOS/pal"), &[("PAL_CONFIG".into(), "/x/a&b.toml".into())]);
            assert!(p.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist"));
            assert!(p.contains("<key>Label</key>\n\t<string>io.cagdas.pal</string>"));
            assert!(p.contains("<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/Applications/pal.app/Contents/MacOS/pal</string>\n\t</array>"));
            assert!(p.contains("<key>RunAtLoad</key>\n\t<true/>"));
            assert!(p.contains("<key>KeepAlive</key>\n\t<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>"));
            assert!(p.contains("<key>ProcessType</key>\n\t<string>Interactive</string>"));
            assert!(p.contains("<key>ThrottleInterval</key>\n\t<integer>5</integer>"));
            assert!(p.contains("<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>PAL_CONFIG</key>\n\t\t<string>/x/a&amp;b.toml</string>\n\t</dict>"));
            assert!(p.ends_with("</dict>\n</plist>\n"));
            assert!(!plist("l", Path::new("/p"), &[]).contains("EnvironmentVariables"));
        }

        #[test]
        fn job_pid_from_launchctl_print() {
            let running = "io.cagdas.pal = {\n\tactive count = 1\n\tpath = /Users/u/Library/LaunchAgents/io.cagdas.pal.plist\n\tstate = running\n\n\tpid = 18839\n\tprogram = /Applications/pal.app/Contents/MacOS/pal\n}\n";
            assert_eq!(job_pid(running), Some(18839));
            let idle = "io.cagdas.pal = {\n\tactive count = 0\n\tstate = not running\n\tlast exit code = 0\n}\n";
            assert_eq!(job_pid(idle), None);
            assert_eq!(job_pid(""), None);
        }

        #[test]
        fn helper_waits_then_loads() {
            let h = helper(7, "gui/501", "io.cagdas.pal", Path::new("/Users/u/Library/LaunchAgents/io.cagdas.pal.plist"), Path::new("/Applications/pal.app/Contents/MacOS/pal"));
            let lines: Vec<&str> = h.lines().collect();
            assert_eq!(lines[0], "while kill -0 7 2>/dev/null; do sleep 0.1; done");
            assert_eq!(lines[1], "launchctl bootout gui/501/io.cagdas.pal 2>/dev/null");
            assert_eq!(lines[2], "launchctl bootstrap gui/501 '/Users/u/Library/LaunchAgents/io.cagdas.pal.plist' && exit 0");
            assert_eq!(lines[4], "launchctl kickstart gui/501/io.cagdas.pal && exit 0");
            assert_eq!(lines[6], "exec '/Applications/pal.app/Contents/MacOS/pal'");
        }
    }
}
