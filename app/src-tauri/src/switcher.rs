//! The switcher: Cmd+Tab's shape over a palette's rows (docs/design/
//! switcher.md). A palette's hold chord (`palettes.<id>.hold`, or what
//! its manifest suggests; `hotkey::Target::Hold`) pressed while nothing
//! is held begins a hold. Nothing is painted yet: the panel shows after
//! [`SHOW_AFTER`] only if the chord is still held (`show_hold`, with
//! `hold` and the presses so far as `steps` in the `pal://shown` payload,
//! and the page lists the palette flat with the cursor on row `2 + steps`).
//! A release before that is the tap: the shell switches on its own, no
//! page, to row `2 + steps` of `pal_core::windows::list()` (the window
//! the user is in was stamped at the begin, so row 1 is it and row 2 the
//! one before; `windows::raise`). Once shown, every further press is a
//! step (`pal://switch { step }`, the `shift+` variant back), and letting
//! go of the chord's modifiers is the commit (`pal://switch { commit:
//! true }`): the page runs the primary action of the row under the cursor,
//! whose hide ends the hold. The OS only reports the chord's presses,
//! never the modifier going up on its own, so a task polls
//! `NSEvent.modifierFlags` every [`POLL`] while a hold is on (macOS; any
//! process may read it, no permission). A chord with no modifier has no
//! release: presses step, Enter commits. Escape, a click outside, any
//! hide cancels: `panel::hide` calls [`on_hidden`] the way it calls
//! `pick::on_hidden`, which also stops the poll. A hold is not a level to
//! come back to: its end tells `pop::forget`, so the next root hotkey
//! lands at the root whatever `general.pop_to_root` says.
//!
//! The tap is the windows palette's (the one with windows to switch to);
//! any other held palette shows at once, as a palette hotkey would.
//!
//! Linux has no global chord on Wayland, so the compositor drives the same
//! machine over the CLI, `pal switch [next|prev|commit|cancel]` (cli.rs,
//! [`cli`]): `next` begins when idle, for the palette with a hold chord
//! (else Windows), with the same show delay, and never polls, since the
//! keybind that ran it sends the `commit` (before the show: the tap; after
//! it: the page's). The same works on macOS from a terminal or skhd.
//!
//! A page commit waits up to [`RELIST_WAIT`] for a show relist still in
//! flight for the held palette (`index::relist_pending`), so the row it
//! lands on is the fresh listing's; the page holds the cursor as an index
//! across that relist either way. One hold at a time, keyed by a
//! generation so a poll or a show timer outlived by a cancel or a newer
//! hold ends itself.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use pal_core::index::Source;
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::Modifiers;

use crate::{events, index, lock, pop, windows};

/// How long the chord has to stay held before the panel shows; a release
/// before this is a tap.
const SHOW_AFTER: Duration = Duration::from_millis(150);
/// How often the modifiers are read while a hold is on (the poll is macOS's: `NSEvent.modifierFlags`).
#[cfg(target_os = "macos")]
const POLL: Duration = Duration::from_millis(40);
/// The most a commit waits for the held palette's show relist.
const RELIST_WAIT: Duration = Duration::from_millis(300);
const RELIST_TICK: Duration = Duration::from_millis(10);

/// The hold that is on: its palette, generation (a poll or show timer for
/// an older one stops), the presses taken before the show (down, less the
/// `shift+` ones) and whether the panel showed for it. The chord's
/// modifiers live with the poll, which is the only reader; a chord
/// without any, or a CLI begin, has no poll.
struct Active {
    source: Source,
    /// Read by the macOS poll alone; a Linux hold has none.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    generation: u64,
    steps: i32,
    shown: bool,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(1);

fn key_of(s: &Source) -> String {
    format!("{}/{}", s.extension, s.palette)
}

/// Whether `source` is the windows palette, the one a tap switches for.
fn taps(source: &Source) -> bool {
    source.extension == "windows" && source.palette == "windows"
}

/// The chord (or `pal switch next|prev`) for `source`: idle, a hold begins;
/// held, the cursor steps (`back`: up), on the page once it showed, else
/// counted for the show or the tap. Another palette's chord while one is
/// held begins anew for that palette. On the main thread (the hotkey
/// handler, the event tap, `Cmd::run`).
pub fn press(app: &AppHandle, source: &Source, mods: Modifiers, back: bool) {
    let step = if back { -1 } else { 1 };
    let mut active = lock(&ACTIVE);
    match active.as_mut() {
        Some(a) if a.source == *source => {
            if a.shown {
                drop(active);
                events::emit(app, events::SWITCH, json!({ "step": step }));
            } else {
                a.steps += step;
            }
        }
        _ => {
            drop(active);
            begin(app, source.clone(), mods);
        }
    }
}

fn begin(app: &AppHandle, source: Source, mods: Modifiers) {
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let key = key_of(&source);
    let tap = taps(&source);
    *lock(&ACTIVE) = Some(Active { source, generation, steps: 0, shown: !tap });
    eprintln!("switcher\tbegin\t{key}\tmods={mods:?}");
    // The window the user is in: row 1 of what a tap reads and the show relists.
    windows::stamp_focused();
    if !mods.is_empty() {
        poll(app, generation, mods);
    }
    if tap {
        show_later(app, generation, key);
    } else {
        crate::show_hold(app, key, 0);
    }
}

/// After [`SHOW_AFTER`], the panel for the hold `generation` if it is
/// still on and not yet shown; marked and shown in one go on the main
/// thread, so a commit that reads `shown` finds the page told first.
fn show_later(app: &AppHandle, generation: u64, key: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SHOW_AFTER).await;
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let steps = {
                let mut active = lock(&ACTIVE);
                match active.as_mut() {
                    Some(a) if a.generation == generation && !a.shown => {
                        a.shown = true;
                        a.steps
                    }
                    _ => return,
                }
            };
            eprintln!("switcher\tshow\t{key}\tsteps={steps}");
            crate::show_hold(&handle, key, steps);
        });
    });
}

/// The release: the hold ends. Before the show it is a tap: the shell
/// raises row `2 + steps` of the windows list itself. After it, once the
/// held palette's show relist has landed (or [`RELIST_WAIT`] passed), the
/// page is told to run the row under the cursor. Nothing when no hold is on.
pub fn commit(app: &AppHandle) {
    let Some(Active { source, steps, shown, .. }) = lock(&ACTIVE).take() else { return };
    if !shown {
        return tap(app, steps);
    }
    pop::forget();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let t0 = Instant::now();
        while index::relist_pending(&source) && t0.elapsed() < RELIST_WAIT {
            tokio::time::sleep(RELIST_TICK).await;
        }
        eprintln!("switcher\tcommit\t{}\twaited {:.0}ms", key_of(&source), t0.elapsed().as_secs_f64() * 1000.0);
        events::emit(&app, events::SWITCH, json!({ "commit": true }));
    });
}

/// The row a tap raises out of `n`: `2 + steps` (row 1 is the window the
/// user is in), wrapping either way; the only row when there is one.
fn tap_row(steps: i32, n: usize) -> Option<usize> {
    (n > 0).then(|| (1 + steps).rem_euclid(n as i32) as usize)
}

/// The tap: the window `steps` below the previous one in the MRU list
/// (wrapping; the only window when there is one), raised off the main
/// thread once the begin's stamp has landed.
fn tap(app: &AppHandle, steps: i32) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        windows::await_stamp();
        let list = match pal_core::windows::list() {
            Ok(l) => l,
            Err(e) => return eprintln!("switcher\ttap failed\t{e}"),
        };
        let Some(w) = tap_row(steps, list.len()).map(|i| &list[i]) else {
            return eprintln!("switcher\ttap\tno windows");
        };
        eprintln!("switcher\ttap\t{}\t{}", w.id, w.title);
        if let Err(e) = windows::raise(&app, &w.id) {
            eprintln!("switcher\ttap failed\t{}\t{e}", w.id);
        }
    });
}

/// `pal switch cancel`: a shown hold hides the panel, which ends it through
/// [`on_hidden`]; one not yet shown simply ends.
pub fn cancel(app: &AppHandle) {
    match lock(&ACTIVE).as_ref().map(|a| a.shown) {
        Some(true) => crate::panel::hide(app),
        Some(false) => on_hidden(app),
        None => {}
    }
}

/// The panel hid (a pick, Escape, a click elsewhere, `pal hide`): the hold
/// is over, its poll and show timer end on their next tick, and the next
/// show is at the root.
pub fn on_hidden(_app: &AppHandle) {
    if let Some(a) = lock(&ACTIVE).take() {
        eprintln!("switcher\tended\t{}\tshown={}", key_of(&a.source), a.shown);
        pop::forget();
    }
}

/// `pal switch WHAT` on the instance: `next` and `prev` press for the
/// palette with a hold chord (`hotkey::hold_target`; Windows when none has
/// one), with no modifiers to poll; `commit` and `cancel` as named.
pub fn cli(app: &AppHandle, what: crate::cli::SwitchCmd) {
    use crate::cli::SwitchCmd::*;
    match what {
        Next | Prev => {
            let source = crate::hotkey::hold_target(app).unwrap_or_else(|| Source::new("windows", "windows"));
            press(app, &source, Modifiers::empty(), what == Prev);
        }
        Commit => commit(app),
        Cancel => cancel(app),
    }
}

/// Every [`POLL`], until none of `mods` is down: then the commit. Ends
/// itself when the hold it was started for is gone (cancelled, hidden,
/// replaced), and the read needs no main thread.
#[cfg(target_os = "macos")]
fn poll(app: &AppHandle, generation: u64, mods: Modifiers) {
    use objc2_app_kit::{NSEvent, NSEventModifierFlags};
    let pairs = [(Modifiers::SUPER, NSEventModifierFlags::Command), (Modifiers::ALT, NSEventModifierFlags::Option), (Modifiers::CONTROL, NSEventModifierFlags::Control), (Modifiers::SHIFT, NSEventModifierFlags::Shift)];
    let watched = pairs.iter().filter(|(m, _)| mods.contains(*m)).fold(NSEventModifierFlags::empty(), |f, (_, n)| f | *n);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL).await;
            if lock(&ACTIVE).as_ref().is_none_or(|a| a.generation != generation) {
                return;
            }
            if !NSEvent::modifierFlags_class().intersects(watched) {
                commit(&app);
                return;
            }
        }
    });
}

/// No modifier state to read off macOS: `pal switch commit` is the release.
#[cfg(not(target_os = "macos"))]
fn poll(_app: &AppHandle, _generation: u64, _mods: Modifiers) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tap_row_wraps_and_is_the_only_window_when_there_is_one() {
        assert_eq!(tap_row(0, 4), Some(1), "row 2: the previous window");
        assert_eq!(tap_row(2, 4), Some(3));
        assert_eq!(tap_row(3, 4), Some(0), "wraps");
        assert_eq!(tap_row(-1, 4), Some(0), "the shift variant steps back");
        assert_eq!(tap_row(-2, 4), Some(3));
        assert_eq!(tap_row(0, 1), Some(0));
        assert_eq!(tap_row(5, 0), None, "no window: nothing raised");
    }
}
