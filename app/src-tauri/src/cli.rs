//! `pal [toggle|show|hide|settings|reload|quit]`. No subcommand runs the app. With one, and
//! an instance already running, the argv reaches that instance through the
//! single-instance plugin's channel and this process exits at once; with
//! none running the app starts and applies the command once the page has
//! loaded. Wayland has no global hotkey API, so this is what a compositor
//! keybind runs.
//!
//! `pal install|update|remove|list` work the extension store in this process
//! (`Cmd::run_store`: results on stdout, one `pal\t<reason>` line on stderr
//! and exit 1 on failure), then `reload` reaches the running instance so
//! its host picks the change up. `install` takes a store name (looked up
//! at pal.cagdas.io, `pal_core::extensions::REGISTRY`) or an explicit
//! source; `--from SPEC` is the source with no lookup.
//!
//! `pal action NAME` and the v1 subcommands (`pick`, `run`, `meta`, ...)
//! are for the scripts written against pal v1: `compat.rs`, in this
//! process, no instance needed.
//!
//! `pal bar ...` (bar/mod.rs): `list` and `json` read the feed file the
//! instance writes, in this process; `click`, `hover`, `action`, `render`
//! and `sync` reach the instance (sketchybar's click and hover scripts
//! run them).

use clap::{Parser, Subcommand};
use pal_core::extensions::Store;
use tauri::{AppHandle, Manager};

#[derive(Parser)]
#[command(version, about = "pal launcher")]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Option<Cmd>,
}

#[derive(Subcommand, Clone, Debug, PartialEq, Eq)]
pub enum Cmd {
    /// Show the panel if hidden, hide it if shown.
    Toggle,
    /// Show the panel.
    Show,
    /// Hide the panel.
    Hide,
    /// Open the settings window, on a page when one is named.
    Settings {
        /// `overview`, `general`, `palettes`, `extensions`, `bar` or `about`.
        page: Option<String>,
    },
    /// Restart the extension host, so it reloads every extension from disk.
    Reload,
    /// Quit the running instance (flushes its state, stops the extension host).
    Quit,
    /// Install an extension: a name from the store at pal.cagdas.io, a directory, github:user/repo[/subdir][@ref], or a github.com URL.
    Install {
        /// A store name (`wordle`), or a source as with --from.
        spec: Option<String>,
        /// The source itself (a directory, github:user/repo[/subdir][@ref], or a github.com URL), never looked up as a store name.
        #[arg(long, conflicts_with = "spec", required_unless_present = "spec")]
        from: Option<String>,
    },
    /// Fetch an installed extension's source again; every one with a source when no name is given.
    Update { name: Option<String> },
    /// Remove an installed extension (its settings stay in the config file).
    Remove { name: String },
    /// List the extensions in the store.
    List,
    /// Run a pal v1 action on the value on stdin: copy, paste, open, type, cmd, or a plugins/actions/NAME script.
    Action { name: String },
    /// Bar items: list them, click or hover one, run an action, render again, re-apply sketchybar.
    Bar {
        #[command(subcommand)]
        cmd: BarCmd,
    },
}

#[derive(Subcommand, Clone, Debug, PartialEq, Eq)]
pub enum BarCmd {
    /// Every declared item, visible or not, with its last title.
    List,
    /// The item's last rendered state as JSON.
    Json { key: String },
    /// A click on the item: its popover, or its open action.
    Click {
        key: String,
        /// Where the click came from: `sketchybar` (the item's bounding rect is queried), `menubar`, or `x,y,w,h` in screen points.
        #[arg(long)]
        anchor: Option<String>,
    },
    /// The pointer entered or left the item (sketchybar's `mouse.entered` / `mouse.exited`).
    Hover {
        key: String,
        #[arg(long)]
        anchor: Option<String>,
        /// `enter` or `exit`; `$SENDER`'s `mouse.entered` / `mouse.exited` are read too.
        #[arg(long)]
        state: String,
    },
    /// Run one of the item's actions (a menu node's `action`, or `segment:<id>`).
    Action { key: String, action: String },
    /// Render the item again now.
    Render { key: String },
    /// Re-apply the sketchybar target (the end of a sketchybarrc).
    Sync,
}

impl Cmd {
    /// The commands that run in this process with no instance: `Some(status)`
    /// for one of them, `None` for the rest.
    pub fn run_compat(&self) -> Option<i32> {
        match self {
            Cmd::Action { name } => Some(crate::compat::action(name)),
            Cmd::Bar { cmd: BarCmd::List } => {
                let feed = crate::bar::read_feed();
                for (key, e) in &feed.items {
                    let item = e.item.as_ref();
                    let state = match item {
                        None => "unrendered",
                        Some(i) if i.hidden => "hidden",
                        _ if e.stale => "stale",
                        _ => "visible",
                    };
                    let title = item.and_then(|i| i.title.clone()).unwrap_or_default();
                    println!("{key}\t{state}\t{}\t{title}", e.title);
                }
                Some(0)
            }
            Cmd::Bar { cmd: BarCmd::Json { key } } => match crate::bar::read_feed().items.get(key) {
                Some(e) => {
                    println!("{}", serde_json::to_string_pretty(e).unwrap_or_default());
                    Some(0)
                }
                None => {
                    eprintln!("pal\tno bar item {key}");
                    Some(1)
                }
            },
            _ => None,
        }
    }

    /// The store commands, run in this process: `Some(changed)` for one of
    /// them (printed, exit status set on failure), `None` for the rest.
    pub fn run_store(&self) -> Option<bool> {
        let store = Store::locate();
        let bun = crate::host::bun();
        let text = |e: pal_core::extensions::Error| e.to_string();
        let r: Result<bool, String> = match self {
            Cmd::Install { spec, from } => match (spec, from) {
                (_, Some(from)) => store.install_from(from, Some(&bun)),
                (Some(spec), None) => store.install(spec, Some(&bun)),
                (None, None) => unreachable!("clap requires one of them"),
            }
            .map_err(text)
            .map(|i| {
                println!("installed {} {} at {}", i.name, i.version, i.dir.display());
                true
            }),
            Cmd::Update { name: Some(name) } => store.update(name, Some(&bun)).map_err(text).map(|i| {
                println!("updated {} {}", i.name, i.version);
                true
            }),
            // Every extension with a source, each failure on its own line;
            // the exit status is 1 only when none could be updated.
            Cmd::Update { name: None } => store.list().map_err(text).and_then(|all| {
                let (mut changed, mut failed) = (false, Vec::new());
                for i in all.iter().filter(|i| i.record.is_some()) {
                    match store.update(&i.name, Some(&bun)) {
                        Ok(u) => {
                            println!("updated {} {}", u.name, u.version);
                            changed = true;
                        }
                        Err(e) => {
                            eprintln!("pal\t{}: {e}", i.name);
                            failed.push(i.name.clone());
                        }
                    }
                }
                if !changed && !failed.is_empty() {
                    return Err(format!("no extension updated ({})", failed.join(", ")));
                }
                Ok(changed)
            }),
            Cmd::Remove { name } => store.remove(name).map_err(text).map(|()| {
                println!("removed {name}");
                true
            }),
            Cmd::List => store.list().map_err(text).map(|all| {
                for i in &all {
                    let source = i.record.as_ref().map_or("(by hand)", |r| r.source.as_str());
                    println!("{}\t{}\t{}", i.name, i.version, source);
                }
                false
            }),
            _ => return None,
        };
        match r {
            Ok(changed) => Some(changed),
            Err(e) => {
                eprintln!("pal\t{e}");
                std::process::exit(1);
            }
        }
    }

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
            Cmd::Settings { page } => crate::settings::open_page(&handle, page.as_deref()),
            Cmd::Reload => {
                if let Some(host) = handle.try_state::<std::sync::Arc<crate::host::Host>>() {
                    let host = host.inner().clone();
                    tauri::async_runtime::spawn(async move { host.restart().await });
                }
            }
            Cmd::Quit => crate::quit(&handle),
            Cmd::Bar { cmd } => run_bar(&handle, cmd),
            // Reaches the instance only when a second process skipped
            // `run_store` (it never does); the store is that process's job.
            Cmd::Install { .. } | Cmd::Update { .. } | Cmd::Remove { .. } | Cmd::List | Cmd::Action { .. } => {}
        });
    }
}

/// `--anchor`: `sketchybar` queries the item's bounding rect (off the
/// main thread, it is a subprocess), `x,y,w,h` is a rect, anything else
/// (or nothing) no rect. Then the popover's event.
fn run_bar(app: &AppHandle, cmd: BarCmd) {
    use crate::bar::{popover, sketchybar, Rect};
    let anchor_of = |anchor: Option<&str>, key: &str| -> (Option<Rect>, &'static str) {
        match anchor {
            Some("sketchybar") => (sketchybar::anchor_of(&sketchybar::name_of(key)), "sketchybar"),
            Some("menubar") => (None, "menubar"),
            Some(s) => (Rect::parse(s), "cli"),
            None => (None, "cli"),
        }
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || match cmd {
        BarCmd::Click { key, anchor } => {
            let (rect, name) = anchor_of(anchor.as_deref(), &key);
            popover::on_click(&app, &key, rect, name);
        }
        BarCmd::Hover { key, anchor, state } => {
            let entered = matches!(state.trim(), "enter" | "entered" | "mouse.entered");
            let (rect, name) = if entered { anchor_of(anchor.as_deref(), &key) } else { (None, "cli") };
            popover::on_hover(&app, &key, rect, entered, name);
        }
        BarCmd::Action { key, action } => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::bar::action(&app, &key, &action, "cli", popover::WINDOW).await {
                    eprintln!("bar\taction\t{key}\t{action}\tfailed\t{e}");
                }
            });
        }
        BarCmd::Render { key } => crate::bar::render(&app, &key, "cli"),
        BarCmd::Sync => sketchybar::resync(&app),
        BarCmd::List | BarCmd::Json { .. } => {}
    });
}

/// Hands this process's argv to a running instance over the channel the
/// single-instance plugin listens on, before any of tauri is built: the
/// plugin would do the same from its setup, but only after GTK and the
/// display are up, 150 ms on marko against 40 for the bare binary. Same
/// wire format as tauri-plugin-single-instance 2.4.4 (its client side is
/// private; `platform_impl/{macos,linux}.rs` there is the reference:
/// macOS a unix socket `/tmp/<identifier with . and - as _>_si.sock`
/// carrying `<cwd>\0\0<argv joined by \0>`, Linux the session bus
/// `<identifier>.SingleInstance` `ExecuteCallback(argv, cwd)`; its
/// `semver` feature, which suffixes the name, must stay off). Checked
/// against that version's source 2026-09-16; a plugin bump is where this
/// breaks. False when no instance answered; the plugin then settles it.
pub fn handover(identifier: &str) -> bool {
    let args: Vec<String> = std::env::args().collect();
    handover_with(identifier, args)
}

/// Same channel, a different subcommand than this process was given
/// (`reload` after a store command). `argv[0]` stays ours.
pub fn handover_args(identifier: &str, args: &[&str]) -> bool {
    let mut argv = vec![std::env::args().next().unwrap_or_else(|| "pal".into())];
    argv.extend(args.iter().map(|a| a.to_string()));
    handover_with(identifier, argv)
}

fn handover_with(identifier: &str, args: Vec<String>) -> bool {
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
