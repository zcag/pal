//! The switcher: Cmd+Tab's shape over a palette's rows (docs/design/
//! switcher.md). A palette's hold chord (`palettes.<id>.hold`, or what
//! its manifest suggests; `hotkey::Target::Hold`) pressed while nothing
//! is held begins: the panel shows inside that palette with `hold` in the
//! `pal://shown` payload, and the page lists it flat with the cursor on
//! row 2. Every further press is a step (`pal://switch { step }`, the
//! `shift+` variant back), and letting go of the chord's modifiers is the
//! commit (`pal://switch { commit: true }`): the page runs the primary
//! action of the row under the cursor, whose hide ends the hold. The OS
//! only reports the chord's presses, never the modifier going up on its
//! own, so a task polls `NSEvent.modifierFlags` every [`POLL`] while a
//! hold is on (macOS; any process may read it, no permission). A chord
//! with no modifier has no release: presses step, Enter commits. Escape,
//! a click outside, any hide cancels: `panel::hide` calls [`on_hidden`]
//! the way it calls `pick::on_hidden`, which also stops the poll.
//!
//! Linux has no global chord on Wayland, so the compositor drives the same
//! machine over the CLI, `pal switch [next|prev|commit|cancel]` (cli.rs,
//! [`cli`]): `next` begins when idle, for the palette with a hold chord
//! (else Windows), and never polls, since the keybind that ran it sends
//! the `commit`. The same works on macOS from a terminal or skhd.
//!
//! A commit waits up to [`RELIST_WAIT`] for a show relist still in flight
//! for the held palette (`index::relist_pending`), so the row it lands on
//! is the fresh listing's; the page follows the cursor's row by id across
//! that relist either way. One hold at a time, keyed by a generation so a
//! poll outlived by a cancel or a newer hold ends itself.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use pal_core::index::Source;
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::Modifiers;

use crate::{events, index, lock};

/// How often the modifiers are read while a hold is on.
const POLL: Duration = Duration::from_millis(40);
/// The most a commit waits for the held palette's show relist.
const RELIST_WAIT: Duration = Duration::from_millis(300);
const RELIST_TICK: Duration = Duration::from_millis(10);

/// The hold that is on: its palette and generation (a poll for an older
/// one stops). The chord's modifiers live with the poll, which is the
/// only reader; a chord without any, or a CLI begin, has no poll.
struct Active {
    source: Source,
    generation: u64,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(1);

fn key_of(s: &Source) -> String {
    format!("{}/{}", s.extension, s.palette)
}

/// The chord (or `pal switch next|prev`) for `source`: idle, a hold begins;
/// held, the cursor steps (`back`: up). Another palette's chord while one is
/// held begins anew for that palette. On the main thread (the hotkey
/// handler, `Cmd::run`).
pub fn press(app: &AppHandle, source: &Source, mods: Modifiers, back: bool) {
    let held = lock(&ACTIVE).as_ref().map(|a| a.source.clone());
    match held {
        Some(ref s) if s == source => events::emit(app, events::SWITCH, json!({ "step": if back { -1 } else { 1 } })),
        _ => begin(app, source.clone(), mods),
    }
}

fn begin(app: &AppHandle, source: Source, mods: Modifiers) {
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let key = key_of(&source);
    *lock(&ACTIVE) = Some(Active { source, generation });
    eprintln!("switcher\tbegin\t{key}\tmods={mods:?}");
    crate::show_hold(app, key);
    if !mods.is_empty() {
        poll(app, generation, mods);
    }
}

/// The release: the hold ends and, once the held palette's show relist has
/// landed (or [`RELIST_WAIT`] passed), the page is told to run the row
/// under the cursor. Nothing when no hold is on.
pub fn commit(app: &AppHandle) {
    let Some(Active { source, .. }) = lock(&ACTIVE).take() else { return };
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

/// `pal switch cancel`: the panel hides, which ends the hold through [`on_hidden`].
pub fn cancel(app: &AppHandle) {
    if lock(&ACTIVE).is_some() {
        crate::panel::hide(app);
    }
}

/// The panel hid (a pick, Escape, a click elsewhere, `pal hide`): the hold
/// is over and its poll ends on its next tick.
pub fn on_hidden(_app: &AppHandle) {
    if let Some(a) = lock(&ACTIVE).take() {
        eprintln!("switcher\tended on hide\t{}", key_of(&a.source));
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
