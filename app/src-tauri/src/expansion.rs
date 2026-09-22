//! Snippet expansion, the watcher half (`pal_core::expansion` is the
//! matcher, the plan and the injection): while `[extensions.snippets]
//! expand = true`, the shared key monitor (keytap.rs: one `NSEvent`
//! global monitor for expansion and keycast alike; it observes without
//! swallowing and fires only with the **Input Monitoring** grant) feeds
//! every key typed in other apps to the matcher, and a keyword completed
//! runs its plan on a thread: the backspaces, the paste through the
//! concealed pasteboard write (put back as it was after), the arrows for
//! a `{cursor}`, then the HUD's "Expanded <name>".
//!
//! What never expands: pal's own windows (a global monitor does not see
//! the active app's keys), the apps in `expand_exclude_apps` (terminals
//! and password managers by default), and any secure text field
//! (`Event::secure`, `IsSecureEventInputEnabled`: a password prompt,
//! `sudo`). A Cmd or Ctrl combo, an arrow, Enter, Tab or Escape empties
//! the buffer, as does a change of app.
//!
//! The snippets are the extension's storage file (`storage/snippets.json`,
//! the key `snippets`), read again whenever its mtime moves, so a snippet
//! saved in the panel expands on the next keystroke. Settings come from
//! the manifest's defaults under the config file's `[extensions.snippets]`
//! (like clipboard.rs) and are re-read on every reload (`apply_config`);
//! turning the key on asks for Input Monitoring once when it is missing.
//! Linux has no portable keyboard tap: `install` logs that and does
//! nothing.

// Off macOS `install` says so and returns; the matcher, the cache and the plan runner below are the subscription's alone, and the tests still cover them.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use pal_core::config::{spec_defaults, Config};
use pal_core::expansion::{Clock, Hit, Key, Matcher, Plan, Prefix, Snippet, Sources};
use pal_core::storage::Storage;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::keytap::{self, Event, Wants};
use crate::{hud, lock, permissions, settings};

/// The extension's manifest, compiled in: its `settings` defaults are the
/// watcher's too, so a key absent from the file means what Settings shows.
const MANIFEST: &str = include_str!("../../../extensions/snippets/pal.json");

/// `[extensions.snippets]` as the watcher reads it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Settings {
    pub expand: bool,
    pub expand_prefix: String,
    pub expand_exclude_apps: Vec<String>,
    pub expand_hud: bool,
}

impl Settings {
    /// From a loaded config: the manifest's defaults under the file's
    /// keys; a value of the wrong type is logged and the defaults stand in.
    pub fn from(config: &Config) -> Settings {
        let manifest: Value = serde_json::from_str(MANIFEST).expect("bundled pal.json parses");
        let defaults = spec_defaults(&manifest["settings"]);
        let table = config.extension_settings("snippets", &defaults, &manifest["settings"]);
        table.try_into().unwrap_or_else(|e| {
            eprintln!("expansion\tbad settings\t{e}; using the defaults");
            defaults.try_into().expect("manifest defaults fit Settings")
        })
    }

    fn prefix(&self) -> Prefix {
        Prefix::parse(&self.expand_prefix)
    }
}

/// The live settings, read by the key handler on every key.
static CONF: Mutex<Option<Settings>> = Mutex::new(None);
/// The buffer of what was typed.
static MATCHER: Mutex<Option<Matcher>> = Mutex::new(None);
/// True while a plan's keys are being posted: the monitor sees them too
/// and must not feed them back.
static INJECTING: AtomicBool = AtomicBool::new(false);

/// The snippets as last read, with the storage file's mtime. Shared, not
/// cloned, per key: the handler runs on every keystroke typed anywhere.
#[derive(Default)]
struct Cache {
    loaded: bool,
    mtime: Option<SystemTime>,
    snippets: Arc<Vec<Snippet>>,
}
static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

/// The stored list (`storage/snippets.json`, key `snippets`, the palette's
/// `{ id, name, keyword?, text }` rows) as the matcher's snippets: only
/// the ones with a keyword.
fn parse_snippets(v: &Value) -> Vec<Snippet> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let keyword = s["keyword"].as_str()?.trim();
            let text = s["text"].as_str()?;
            (!keyword.is_empty()).then(|| Snippet { name: s["name"].as_str().unwrap_or(keyword).to_string(), keyword: keyword.to_string(), text: text.to_string() })
        })
        .collect()
}

/// The snippets, re-read when the storage file changed since (one `stat` per key typed).
fn snippets(app: &AppHandle) -> Arc<Vec<Snippet>> {
    let store = app.state::<Storage>();
    let mtime = std::fs::metadata(store.dir().join("snippets.json")).and_then(|m| m.modified()).ok();
    let mut guard = lock(&CACHE);
    let c = guard.get_or_insert_with(Cache::default);
    if !c.loaded || c.mtime != mtime {
        c.loaded = true;
        c.mtime = mtime;
        c.snippets = Arc::new(store.get("snippets", "snippets").map(|v| parse_snippets(&v)).unwrap_or_default());
        eprintln!("expansion\tsnippets\t{} with a keyword", c.snippets.len());
    }
    c.snippets.clone()
}

/// Startup: the settings as loaded, the subscription when they say so.
pub fn install(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        eprintln!("expansion\tnot available off macOS (no portable keyboard tap)");
        return;
    }
    apply(app, Settings::from(&settings::config(app)));
}

/// A config reload: the subscription follows `expand`, the rest is read live.
pub fn apply_config(app: &AppHandle, prev: &Config, next: &Config) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let (before, after) = (Settings::from(prev), Settings::from(next));
    if before != after {
        apply(app, after);
    }
}

fn apply(app: &AppHandle, s: Settings) {
    let on = s.expand;
    let prefix = s.prefix();
    *lock(&CONF) = Some(s);
    let mut m = lock(&MATCHER);
    match m.as_mut() {
        Some(m) => m.prefix = prefix,
        None => *m = Some(Matcher::new(prefix)),
    }
    drop(m);
    eprintln!("expansion\t{}\tprefix {prefix:?}", if on { "on" } else { "off" });
    if on && !permissions::input_monitoring() {
        // The prompt once (and the pane); the subscription is made either way and starts delivering on the grant.
        permissions::request_once(app, "input_monitoring");
    }
    if on {
        keytap::subscribe(app, "expansion", Wants { keys: true, ..Wants::default() }, on_event);
    } else {
        keytap::unsubscribe(app, "expansion");
    }
}

/// Key codes that move the caret or leave the field: the buffer no
/// longer describes what precedes the caret after one.
const RESETS: [u16; 12] = [36, 76, 48, 53, 123, 124, 125, 126, 115, 119, 116, 121];
const BACKSPACE: u16 = 51;
const FORWARD_DELETE: u16 = 117;

/// The event as the matcher sees it.
fn classify(ev: &Event) -> Key {
    if ev.mods.cmd || ev.mods.ctrl {
        return Key::Reset;
    }
    if ev.code == BACKSPACE {
        return Key::Backspace;
    }
    if ev.code == FORWARD_DELETE || RESETS.contains(&ev.code) {
        return Key::Reset;
    }
    if !ev.chars.is_empty() && !ev.chars.chars().any(char::is_control) {
        Key::Text(ev.chars.clone())
    } else {
        Key::Reset
    }
}

/// The shared monitor's delivery (main thread).
fn on_event(app: &AppHandle, ev: &Event) {
    on_key(app, classify(ev), ev.front.clone(), ev.secure);
}

/// Whether keys from `app` (a bundle id) may expand: not an excluded app,
/// and never while a secure text field has the keyboard.
fn allowed(conf: &Settings, app: Option<&str>, secure: bool) -> bool {
    !secure && app.is_none_or(|a| !conf.expand_exclude_apps.iter().any(|x| x.eq_ignore_ascii_case(a)))
}

/// One key: fed to the matcher; a hit runs its plan off the main thread.
fn on_key(app: &AppHandle, key: Key, front: Option<String>, secure: bool) {
    if INJECTING.load(Ordering::Relaxed) {
        return;
    }
    let Some(conf) = lock(&CONF).clone() else { return };
    if !conf.expand {
        return;
    }
    let snippets = if matches!(key, Key::Text(_)) { snippets(app) } else { Arc::default() };
    let hit = {
        let mut guard = lock(&MATCHER);
        let Some(m) = guard.as_mut() else { return };
        if !allowed(&conf, front.as_deref(), secure) {
            m.reset();
            return;
        }
        m.feed(key, front.as_deref(), &snippets)
    };
    let Some(hit) = hit else { return };
    let Some(snippet) = snippets.get(hit.index).cloned() else { return };
    let app = app.clone();
    std::thread::Builder::new()
        .name("expansion".into())
        .spawn(move || run(&app, &hit, &snippet, conf.expand_hud))
        .map(|_| ())
        .unwrap_or_else(|e| eprintln!("expansion\tthread\t{e}"));
}

/// The plan for the hit, run: the keys go out with the monitor muted.
fn run(app: &AppHandle, hit: &Hit, snippet: &Snippet, flash: bool) {
    let clipboard = pal_core::clipboard::read_text;
    let uuid = || uuid::Uuid::new_v4().to_string();
    let p: Plan = pal_core::expansion::plan(hit, snippet, &Sources { clipboard: &clipboard, clock: Clock::now(), uuid: &uuid });
    INJECTING.store(true, Ordering::Relaxed);
    let r = pal_core::expansion::perform(&p);
    INJECTING.store(false, Ordering::Relaxed);
    match r {
        Ok(()) => {
            eprintln!("expansion\texpanded\t{}\t{} back, {} chars, {} left", snippet.name, p.backspaces, p.text.chars().count(), p.left);
            if flash {
                hud::show(app, &format!("Expanded {}", snippet.name));
            }
        }
        Err(pal_core::clipboard::Error::NeedsAccessibility) => {
            eprintln!("expansion\trefused\tneeds Accessibility");
            permissions::request_once(app, "accessibility");
            hud::show(app, "Snippet expansion needs Accessibility");
        }
        Err(e) => eprintln!("expansion\tfailed\t{}\t{e}", snippet.name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn manifest_defaults_fit_the_watcher_and_are_off() {
        let s = Settings::from(&Config::default());
        assert!(!s.expand, "opt-in");
        assert_eq!(s.prefix(), Prefix::Semicolon);
        assert!(s.expand_hud);
        assert!(s.expand_exclude_apps.iter().any(|a| a == "com.apple.Terminal"));
        assert!(s.expand_exclude_apps.iter().any(|a| a.contains("1password")));
    }

    #[test]
    fn the_file_overrides_the_defaults() {
        let mut c = Config::default();
        let t: toml::Table = toml::from_str("expand = true\nexpand_prefix = \":\"\nexpand_exclude_apps = []").unwrap();
        c.extensions.insert("snippets".into(), t);
        let s = Settings::from(&c);
        assert!(s.expand);
        assert_eq!(s.prefix(), Prefix::Colon);
        assert!(s.expand_exclude_apps.is_empty());
    }

    #[test]
    fn stored_snippets_become_keywords_only_with_a_keyword() {
        let v = json!([
            { "id": "1", "name": "Signature", "keyword": "sig", "text": "Best" },
            { "id": "2", "name": "No keyword", "text": "x" },
            { "id": "3", "name": "Blank", "keyword": "  ", "text": "x" },
            { "id": "4", "keyword": "k", "text": "named by keyword" },
            7
        ]);
        let s = parse_snippets(&v);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0], Snippet { name: "Signature".into(), keyword: "sig".into(), text: "Best".into() });
        assert_eq!(s[1].name, "k");
        assert!(parse_snippets(&json!(null)).is_empty());
    }

    #[test]
    fn keys_are_classified_for_the_matcher() {
        use pal_core::keycast::Mods;
        let ev = |code: u16, chars: &str, mods: Mods| Event { kind: keytap::Kind::KeyDown, code, mods, chars: chars.into(), base: String::new(), front: None, secure: false, scroll: None, gesture: None };
        let none = Mods::default();
        assert_eq!(classify(&ev(0, "a", none)), Key::Text("a".into()));
        assert_eq!(classify(&ev(0, "A", Mods { shift: true, ..none })), Key::Text("A".into()));
        assert_eq!(classify(&ev(0, "å", Mods { alt: true, ..none })), Key::Text("å".into()), "option types a character");
        assert_eq!(classify(&ev(0, "a", Mods { cmd: true, ..none })), Key::Reset, "a combo");
        assert_eq!(classify(&ev(0, "\u{1}", Mods { ctrl: true, ..none })), Key::Reset);
        assert_eq!(classify(&ev(51, "\u{7f}", none)), Key::Backspace);
        assert_eq!(classify(&ev(117, "\u{f728}", none)), Key::Reset, "forward delete");
        assert_eq!(classify(&ev(123, "\u{f702}", none)), Key::Reset, "an arrow");
        assert_eq!(classify(&ev(36, "\r", none)), Key::Reset, "enter");
        assert_eq!(classify(&ev(53, "\u{1b}", none)), Key::Reset, "escape");
        assert_eq!(classify(&ev(63, "", none)), Key::Reset, "fn alone types nothing");
    }

    #[test]
    fn excluded_apps_and_secure_input_never_expand() {
        let conf = Settings { expand: true, expand_prefix: ";".into(), expand_exclude_apps: vec!["net.kovidgoyal.kitty".into()], expand_hud: true };
        assert!(allowed(&conf, Some("com.apple.TextEdit"), false));
        assert!(!allowed(&conf, Some("net.kovidgoyal.KITTY"), false), "case-insensitive");
        assert!(!allowed(&conf, Some("com.apple.TextEdit"), true), "a secure field");
        assert!(allowed(&conf, None, false), "an unknown app is not excluded");
    }
}
