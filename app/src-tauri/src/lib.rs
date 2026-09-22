//! The shell: a hidden, pre-warmed panel toggled by the global hotkey or by
//! `pal toggle` from a second process, the extension host and the item
//! index behind it, the core capabilities the host calls back for
//! (`bridge`), the `icon://` scheme, the menu bar icon, and timing marks.

mod apps;
mod audio;
mod autostart;
mod bar;
mod bluetooth;
mod bridge;
mod cache;
mod cli;
mod clipboard;
mod color;
mod commands;
mod compact;
mod compat;
mod crash;
mod deeplink;
mod dialog;
mod effects;
mod events;
mod expansion;
mod fallback;
mod firstrun;
mod host;
mod hotkey;
mod hud;
mod icon;
mod index;
mod large;
mod media;
mod ocr;
mod registry;
mod selection;
mod settings;
mod sidebar;
mod states;
mod storage;
mod switcher;
mod system;
mod theme;
mod tray;
mod updater;
mod views;
mod welcome;
mod wifi;
mod windows;
#[cfg_attr(target_os = "macos", path = "panel/macos.rs")]
#[cfg_attr(not(target_os = "macos"), path = "panel/linux.rs")]
mod panel;
mod permissions;
mod pershow;
mod pick;
mod pop;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use clap::Parser;
use pal_core::config::{ConfigFile, Position};
use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, RunEvent, WebviewWindow};
use tauri::webview::PageLoadEvent;
use tauri_plugin_global_shortcut::ShortcutState;

const WINDOW: &str = "main";

/// When `run` began: the origin of the startup timing lines.
static START: OnceLock<Instant> = OnceLock::new();

/// Seconds since the epoch, for the log's session marker (no chrono dependency here).
fn chrono_free_now() -> String {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| format!("start at unix {}", d.as_secs())).unwrap_or_default()
}

pub(crate) fn since_start_ms() -> f64 {
    START.get().map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0)
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// Lock a `std` mutex, poisoned or not: a panic in one command (the
/// runtime catches it) must not take every later lock of that state down
/// with it. All the shell's state is plain data, valid after any panic.
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Prints a timing mark from either side, on one clock (wall time, ms),
/// and where it fell since `run` began (the startup timeline).
#[tauri::command]
fn mark(name: String, t: Option<f64>) {
    eprintln!("mark\t{}\t{:.1}\t{:.1}ms since start", name, t.unwrap_or_else(now_ms), since_start_ms());
}

#[derive(Clone, Serialize)]
struct Shown {
    t0: f64,
    /// `extension/palette` to open straight into (a palette hotkey).
    #[serde(skip_serializing_if = "Option::is_none")]
    palette: Option<String>,
    /// The page keeps its level and query (`general.pop_to_root`, pop.rs)
    /// instead of going back to the root.
    keep: bool,
    /// The switcher opened `palette` (switcher.rs): the page lists it flat
    /// with the cursor on row 2 and follows `pal://switch`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    hold: bool,
    /// The presses the hold took before this show (the chord pressed again
    /// within the show delay): the cursor starts that many rows below row 2.
    #[serde(skip_serializing_if = "is_zero")]
    steps: i32,
}

fn is_zero(n: &i32) -> bool {
    *n == 0
}

// ---- show / hide ---------------------------------------------------------

/// Whether `place` has positioned the panel once; `position = "last"` then
/// leaves it where it is.
static PLACED: AtomicBool = AtomicBool::new(false);

/// Centre the window horizontally on the monitor under the cursor, and
/// vertically where `general.position` says: a fifth of the way down (where
/// Spotlight and Raycast put theirs), centred, or wherever it was last.
/// Harmless on Wayland, where every step fails or no-ops and the compositor
/// rule places.
pub(crate) fn place(app: &AppHandle) {
    let Some(w) = app.get_webview_window(WINDOW) else { return };
    let position = settings::config(app).general.position;
    if position == Position::Last && PLACED.load(Ordering::Relaxed) {
        return;
    }
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
        .or_else(|| w.current_monitor().ok().flatten());
    let (Some(m), Ok(size)) = (monitor, w.outer_size()) else { return };
    let area = m.work_area();
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = match position {
        Position::Centre => area.position.y + (area.size.height as i32 - size.height as i32) / 2,
        Position::Top | Position::Last => area.position.y + (area.size.height as f64 * 0.2) as i32,
    };
    let _ = w.set_position(PhysicalPosition::new(x, y));
    PLACED.store(true, Ordering::Relaxed);
}

fn show(app: &AppHandle) {
    show_in(app, None);
}

/// Show the panel, at the root or inside `palette` (`extension/palette`).
/// An already visible panel is not moved; the page still gets the event, so
/// a palette hotkey switches what is showing.
pub(crate) fn show_in(app: &AppHandle, palette: Option<String>) {
    show_with(app, palette, None);
}

/// `show_in` for the switcher, `steps` presses into the hold: `hold` and
/// `steps` ride in the event, and the held palette lists again on this
/// show whatever the live relist gap says (a switch and a switch back
/// within two seconds must see the new order).
pub(crate) fn show_hold(app: &AppHandle, palette: String, steps: i32) {
    show_with(app, Some(palette), Some(steps));
}

fn show_with(app: &AppHandle, palette: Option<String>, hold: Option<i32>) {
    let t0 = now_ms();
    let keep = pop::keep(&settings::config(app).general.pop_to_root);
    if !panel::is_visible(app) {
        // The window the user was in when they pressed the hotkey: first in the windows palette (the bridge's `list` waits for the stamp). A hold stamped at its begin.
        if hold.is_none() {
            windows::stamp_focused();
        }
        place(app);
        panel::show(app);
    } else if palette.is_none() {
        return;
    }
    // The page keeps its level only with `keep` and no palette to open; otherwise it starts over and reports its view anew.
    views::set_visible(app, WINDOW, true, !(keep && palette.is_none()));
    let held = hold.and(palette.clone());
    events::emit(app, events::SHOWN, Shown { t0, palette, keep, hold: hold.is_some(), steps: hold.unwrap_or(0) });
    // After the event: the live palettes list again off this thread; a file dialog in front and the Finder selection are looked for once per show.
    pershow::on_shown();
    index::on_shown(app, held.as_deref());
    bar::on_shown(app);
    states::on_panel(app, true);
    // A fresh profile's first show asks for Accessibility (once per run);
    // a missing permission is watched for while the panel is up.
    permissions::ask_on_first_show(app);
    permissions::watch(app);
}

fn toggle(app: &AppHandle) {
    if panel::is_visible(app) {
        panel::hide(app);
    } else {
        show(app);
    }
}

#[tauri::command]
fn hide(app: AppHandle) {
    panel::hide(&app);
}

/// Quit: the host gets EOF and up to its stop timeout to exit, then the
/// event loop ends (`RunEvent::Exit` below flushes frecency and the cache
/// saver) and the process exits 0. Off the caller's thread, so the tray
/// menu and `pal quit` (both on the main thread) return at once.
pub(crate) fn quit(app: &AppHandle) {
    eprintln!("quit\trequested");
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(host) = app.try_state::<std::sync::Arc<host::Host>>() {
            host.stop().await;
        }
        app.exit(0);
    });
}

// ---- app -----------------------------------------------------------------

pub fn run() {
    START.get_or_init(Instant::now);
    // A `pal://` link as the only argument (Linux: what the desktop entry runs) is not a subcommand: the plugins carry it (deeplink.rs).
    let cli = if deeplink::argv_link().is_some() { cli::Cli { cmd: None } } else { cli::Cli::parse() };
    // Only the instance logs to the file (a link argv starts one too); a `pal <cmd>` keeps its stderr.
    if cli.cmd.is_none() {
        if let Some(p) = pal_core::log::capture() {
            eprintln!("\nlog\t{}\t{}", p.display(), chrono_free_now());
        }
    }
    // Before anything spawns: the user's PATH, not launchd's (core env.rs).
    let (_, from_shell) = pal_core::env::adopt();
    eprintln!("env\tpath {}\t{:.1}ms since start", if from_shell { "from the login shell" } else { "inherited" }, since_start_ms());
    // The v1 compatibility commands never touch an instance.
    if let Some(status) = cli.cmd.as_ref().and_then(cli::Cmd::run_compat) {
        std::process::exit(status);
    }
    let context = tauri::generate_context!();
    // The store commands run here, in this process, so their output lands
    // on the caller's terminal; a running instance is then told to restart
    // its host (`reload`), and none of them starts the app.
    if let Some(changed) = cli.cmd.as_ref().and_then(cli::Cmd::run_store) {
        if changed && !cli::handover_args(&context.config().identifier, &["reload"]) {
            eprintln!("pal	not running; the extension loads at the next start");
        }
        return;
    }
    // `pal pick`: this process reads the rows, hands the picker to the instance and waits for the answer (pick.rs).
    if let Some(cli::Cmd::Pick { reply: None, title, multi, query, select }) = &cli.cmd {
        std::process::exit(pick::client(pick::Options { title: title.clone(), multi: *multi, query: query.clone(), select: select.clone() }, &context.config().identifier));
    }
    // A subcommand or a link for a running instance: handed over here, before tauri is built (cli.rs).
    if (cli.cmd.is_some() || deeplink::argv_link().is_some()) && cli::handover(&context.config().identifier) {
        return;
    }
    if matches!(cli.cmd, Some(cli::Cmd::Quit | cli::Cmd::Reload)) {
        // Nothing answered: starting an app to quit or reload it is not what was asked.
        eprintln!("pal\tnot running");
        return;
    }
    // Applied once the page has loaded, when started with a subcommand.
    let startup = Mutex::new(cli.cmd);
    let builder = tauri::Builder::default()
        // First: a second process the handover above missed exits inside
        // this plugin's setup, before anything else is built.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A link's argv went to the deep-link plugin already (the `deep-link` feature); clap would only refuse it.
            if deeplink::is_link_argv(&args) {
                return;
            }
            if let Some(cmd) = cli::Cmd::from_args(args) {
                cmd.run(app);
            }
        }));
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    let builder = icon::register(builder).plugin(tauri_plugin_updater::Builder::new().build()).plugin(autostart::plugin());
    let builder = deeplink::register(builder);
    // Size and position of the settings window only; the panel and the HUD place themselves.
    let builder = builder.plugin(tauri_plugin_window_state::Builder::new().with_state_flags(settings::STATE).with_filter(|label| label == settings::WINDOW).build());
    builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                // A release is not an event here: the switcher reads the modifiers itself (switcher.rs), since a
                // chord's key may go up long before its modifier does.
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        hotkey::pressed(app, shortcut);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            mark,
            hide,
            host::host_request,
            index::query,
            index::sources,
            index::pick,
            index::detail,
            index::filter,
            index::index_refresh,
            index::frecency_forget,
            index::search_history,
            index::search_history_clear,
            fallback::fallback,
            settings::settings_general,
            settings::settings_get,
            settings::settings_theme,
            settings::settings_set,
            settings::settings_unset,
            settings::settings_set_secret,
            settings::settings_open_file,
            settings::settings_reveal_file,
            settings::settings_reset_frecency,
            settings::settings_restart_host,
            settings::extensions_install,
            settings::extensions_update,
            settings::extensions_remove,
            settings::extensions_check_updates,
            settings::instances_add,
            settings::instances_rename,
            settings::instances_remove,
            settings::settings_check_updates,
            settings::settings_about,
            settings::settings_open_link,
            settings::settings_open,
            settings::settings_close,
            updater::check_updates,
            updater::update_install,
            updater::update_progress,
            welcome::welcome_reset,
            hotkey::hotkey_status,
            permissions::permissions_status,
            permissions::permissions_request,
            permissions::open_system_settings,
            bar::popover::bar_hide,
            bar::popover::bar_size,
            bar::popover::bar_engage,
            bar::popover::bar_action,
            bar::popover::bar_refresh,
            views::view_open,
            deeplink::link_copy,
            pick::pick_reply,
            dialog::dialog_detect,
            large::large_hide,
            large::large_show,
            theme::theme_current,
            theme::theme_status,
            theme::theme_open,
            theme::theme_open_dir,
        ])
        .on_page_load(move |webview, payload| {
            // The panel's page: the settings window loads later and on demand.
            if payload.event() == PageLoadEvent::Finished && webview.label() == WINDOW {
                if let Some(cmd) = lock(&startup).take() {
                    cmd.run(webview.app_handle());
                }
            }
        })
        .setup(|app| {
            // Startup order, each step needing the ones before it:
            //   1. activation policy: no Dock icon, before any window shows
            //   2. firstrun: a v1 config is migrated, the config file exists for the watcher
            //   3. panel: the pre-warmed window, so the first show paints
            //   4. profile: the config file keys the data dir
            //   5. index: the index, frecency, registry, cache saver, welcome
            //   6. hotkey: the registered map, before settings applies it
            //   7. settings: load the file, apply hotkeys/tray/autostart, watch
            //      (the settings window itself is built on its first open)
            //      permissions: log what the OS lets pal do, watch for a grant
            //   8. clipboard: the recorder, retention from the loaded settings
            //      storage: the extensions' key-value files, nothing read yet
            //   9. updater: the daily check (release builds)
            //  10. cache restore: last run's listings, so the root answers now
            //      bar: the popover window, the strip targets and their probes
            //      sidebar: its window and edge strips (macOS)
            //      media: where the bundled MediaRemote adapter is (macOS)
            //  11. host: spawned last, its notifications need everything above
            // Every step logs its own failure and the next one still runs:
            // no state is half-managed, a step that cannot start just leaves
            // its feature off (no clipboard, no tray, no watcher).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            firstrun::install();
            let window = app.get_webview_window(WINDOW).ok_or("tauri.conf.json has no `main` window")?;
            panel::install(&window);
            match app.get_webview_window(hud::WINDOW) {
                Some(w) => panel::hud_install(&w),
                None => eprintln!("hud\ttauri.conf.json has no `hud` window; no HUD this run"),
            }
            match app.get_webview_window(large::WINDOW) {
                Some(w) => panel::large_install(&w),
                None => eprintln!("large\ttauri.conf.json has no `large` window; no Large Type this run"),
            }
            // The index cache and frecency are keyed by config file, so two
            // configs (a dev profile, `config.toml`) never share one.
            let config = ConfigFile::locate();
            let data = config.data_dir();
            eprintln!("profile\t{}\t{}\t{}\t{:.1}ms since start", config.profile(), config.path().display(), data.display(), since_start_ms());
            for n in cache::adopt_pre_profile(&pal_core::fs::data_dir(), &config.profile()) {
                eprintln!("profile\t{n}");
            }
            crash::install(app.handle(), &data);
            index::install(app.handle(), &data);
            hotkey::install(app.handle());
            settings::install(app.handle(), config);
            permissions::install(app.handle());
            clipboard::install(app.handle());
            storage::install(app.handle());
            expansion::install(app.handle());
            theme::install(app.handle());
            compact::install(app.handle());
            updater::install_checks(app.handle());
            index::restore_cache(app.handle());
            views::install(app.handle());
            states::install(app.handle());
            bar::install(app.handle());
            sidebar::install(app.handle());
            media::install(app.handle());
            host::Host::start(app.handle());
            // Icons and favicons are cached forever otherwise; a month is
            // long enough that a daily app never refetches.
            tauri::async_runtime::spawn_blocking(|| {
                match pal_core::icons::prune(std::time::Duration::from_secs(30 * 24 * 3600)) {
                    Ok(n) if n > 0 => eprintln!("icons\tpruned\t{n}"),
                    Ok(_) => {}
                    Err(e) => eprintln!("icons\tprune failed\t{e}"),
                }
            });
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // The host is already down (`quit`), or the OS is ending us and
            // its stdin closes with the process: flush what is ours.
            if let RunEvent::Exit = event {
                bar::remove_all(app);
                index::flush(app);
                eprintln!("quit\tflushed\t{:.1}ms since start", since_start_ms());
            }
        });
}
