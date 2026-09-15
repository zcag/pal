//! `pal-app [toggle|show|hide]`. No subcommand runs the app. With one, and
//! an instance already running, the argv reaches that instance through the
//! single-instance plugin's channel and this process exits at once; with
//! none running the app starts and applies the command once the page has
//! loaded. Wayland has no global hotkey API, so this is what a compositor
//! keybind runs.

use clap::{Parser, Subcommand};
use tauri::AppHandle;

#[derive(Parser)]
#[command(version, about = "pal launcher")]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Option<Cmd>,
}

#[derive(Subcommand, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cmd {
    /// Show the panel if hidden, hide it if shown.
    Toggle,
    /// Show the panel.
    Show,
    /// Hide the panel.
    Hide,
}

impl Cmd {
    /// A second instance's argv. No subcommand there means show: what a
    /// second launch of a single-instance app conventionally does.
    pub fn from_args(args: Vec<String>) -> Option<Cmd> {
        match Cli::try_parse_from(args) {
            Ok(cli) => Some(cli.cmd.unwrap_or(Cmd::Show)),
            Err(e) => {
                eprintln!("cli\t{e}");
                None
            }
        }
    }

    /// Runs on the main thread: callers arrive from the plugin's socket
    /// task or the page-load hook. Fails only once the event loop is gone,
    /// when there is nothing left to show.
    pub fn run(self, app: &AppHandle) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || match self {
            Cmd::Toggle => crate::toggle(&handle),
            Cmd::Show => crate::show(&handle),
            Cmd::Hide => crate::panel::hide(&handle),
        });
    }
}

/// Hands this process's argv to a running instance over the channel the
/// single-instance plugin listens on, before any of tauri is built: the
/// plugin would do the same from its setup, but only after GTK and the
/// display are up, 150 ms on marko against 40 for the bare binary. Same
/// wire format as tauri-plugin-single-instance 2.4 (its client side is
/// private; `platform_impl/{macos,linux}.rs` there is the reference, and
/// its `semver` feature, which suffixes the name, must stay off). False
/// when no instance answered; the plugin then settles it.
pub fn handover(identifier: &str) -> bool {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned();
    send(identifier, &args, &cwd).is_ok()
}

#[cfg(target_os = "macos")]
fn send(identifier: &str, args: &[String], cwd: &str) -> std::io::Result<()> {
    use std::io::Write;
    let path = format!("/tmp/{}_si.sock", identifier.replace(['.', '-'], "_"));
    let mut s = std::os::unix::net::UnixStream::connect(path)?;
    write!(s, "{cwd}\0\0{}", args.join("\0"))
}

#[cfg(target_os = "linux")]
fn send(identifier: &str, args: &[String], cwd: &str) -> zbus::Result<()> {
    let name = format!("{identifier}.SingleInstance");
    let path = format!("/{}", name.replace('.', "/").replace('-', "_"));
    zbus::blocking::Connection::session()?.call_method(
        Some(name.as_str()),
        path.as_str(),
        Some("org.SingleInstance.DBus"),
        "ExecuteCallback",
        &(args, cwd),
    )?;
    Ok(())
}
