//! macOS Spotlight's own hotkey. Spotlight holds ⌘Space by default and the
//! system takes it before any app's registration, so a `general.hotkey` of
//! `cmd+space` fails (or, worse, registers and never fires) until the user
//! unticks "Show Spotlight search" under System Settings > Keyboard >
//! Keyboard Shortcuts > Spotlight. The binding is readable: entry `64` of
//! `AppleSymbolicHotKeys` in `com.apple.symbolichotkeys` (`enabled`, and
//! `value.parameters` = [character, virtual keycode, modifier flags]). No
//! entry at all is the factory default: on, ⌘Space. Off macOS there is no
//! Spotlight and [`hotkey`] is `None`.

/// The combination Spotlight's "Show Spotlight search" is bound to, in
/// pal's hotkey syntax (`cmd+space`); `None` when it is off (or the key
/// cannot be named). Reads through `defaults`, so what cfprefsd holds, not
/// a stale file; a few milliseconds.
pub fn hotkey() -> Option<String> {
    platform::hotkey()
}

/// Open System Settings on Keyboard > Keyboard Shortcuts, where Spotlight's
/// binding is switched off. No-op off macOS.
pub fn open_keyboard_shortcuts() -> std::io::Result<()> {
    platform::open_keyboard_shortcuts()
}

#[cfg(target_os = "macos")]
mod platform {
    use std::process::{Command, Stdio};

    pub fn hotkey() -> Option<String> {
        let out = Command::new("defaults").args(["export", "com.apple.symbolichotkeys", "-"]).stderr(Stdio::null()).output().ok()?;
        if !out.status.success() {
            return None;
        }
        let root: plist::Dictionary = plist::from_bytes(&out.stdout).ok()?;
        super::parse(root.get("AppleSymbolicHotKeys").and_then(plist::Value::as_dictionary))
    }

    pub fn open_keyboard_shortcuts() -> std::io::Result<()> {
        // `open` returns at once; the child is reaped here so it never lingers as a zombie.
        let mut child = Command::new("open").arg("x-apple.systempreferences:com.apple.Keyboard-Settings.extension?Shortcuts").spawn()?;
        std::thread::spawn(move || child.wait());
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn hotkey() -> Option<String> {
        None
    }
    pub fn open_keyboard_shortcuts() -> std::io::Result<()> {
        Ok(())
    }
}

// The parse and its tests read plist values, a macOS-only dependency.

/// The `AppleSymbolicHotKeys` entry Spotlight's search binding lives under.
#[cfg(target_os = "macos")]
const SHOW_SPOTLIGHT: &str = "64";
/// Factory default: on, ⌘Space.
#[cfg(target_os = "macos")]
const DEFAULT: &str = "cmd+space";
/// Virtual keycode of Space, and the NSEvent modifier flag bits.
#[cfg(target_os = "macos")]
const VK_SPACE: i64 = 49;
#[cfg(target_os = "macos")]
const SHIFT: i64 = 1 << 17;
#[cfg(target_os = "macos")]
const CTRL: i64 = 1 << 18;
#[cfg(target_os = "macos")]
const ALT: i64 = 1 << 19;
#[cfg(target_os = "macos")]
const CMD: i64 = 1 << 20;

/// `AppleSymbolicHotKeys` as read: `None` for a Spotlight that is off.
#[cfg(target_os = "macos")]
fn parse(table: Option<&plist::Dictionary>) -> Option<String> {
    let Some(entry) = table.and_then(|t| t.get(SHOW_SPOTLIGHT)).and_then(plist::Value::as_dictionary) else {
        return Some(DEFAULT.into());
    };
    if !entry.get("enabled").is_some_and(|e| e.as_boolean() == Some(true) || e.as_signed_integer() == Some(1)) {
        return None;
    }
    let params: Vec<i64> = entry.get("value")?.as_dictionary()?.get("parameters")?.as_array()?.iter().filter_map(plist::Value::as_signed_integer).collect();
    let [ch, vk, flags] = params[..] else { return Some(DEFAULT.into()) };
    let key = if vk == VK_SPACE {
        "space".to_string()
    } else {
        char::from_u32(ch as u32).filter(|c| c.is_ascii_graphic()).map(|c| c.to_ascii_lowercase().to_string())?
    };
    let mods = [(CMD, "cmd"), (CTRL, "ctrl"), (ALT, "alt"), (SHIFT, "shift")].into_iter().filter(|(bit, _)| flags & bit != 0).map(|(_, m)| m);
    Some(mods.chain([key.as_str()]).collect::<Vec<_>>().join("+"))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use plist::{Dictionary, Value};

    fn entry(enabled: bool, params: [i64; 3]) -> Dictionary {
        let mut value = Dictionary::new();
        value.insert("parameters".into(), Value::Array(params.iter().map(|&p| Value::Integer(p.into())).collect()));
        value.insert("type".into(), Value::String("standard".into()));
        let mut e = Dictionary::new();
        e.insert("enabled".into(), Value::Boolean(enabled));
        e.insert("value".into(), Value::Dictionary(value));
        let mut t = Dictionary::new();
        t.insert(SHOW_SPOTLIGHT.into(), Value::Dictionary(e));
        t
    }

    #[test]
    fn spotlight_binding_is_read_from_entry_64() {
        assert_eq!(parse(None).as_deref(), Some("cmd+space"), "no entry: factory default");
        assert_eq!(parse(Some(&Dictionary::new())).as_deref(), Some("cmd+space"));
        assert_eq!(parse(Some(&entry(true, [32, 49, 1048576]))).as_deref(), Some("cmd+space"));
        assert_eq!(parse(Some(&entry(true, [32, 49, 524288]))).as_deref(), Some("alt+space"), "rebound to Option-Space (hornet)");
        assert_eq!(parse(Some(&entry(true, [32, 49, 1179648]))).as_deref(), Some("cmd+shift+space"));
        assert_eq!(parse(Some(&entry(true, [107, 40, 1310720]))).as_deref(), Some("cmd+ctrl+k"), "a letter, from the character code");
        assert_eq!(parse(Some(&entry(false, [32, 49, 1048576]))), None, "unticked");
        assert_eq!(parse(Some(&entry(true, [65535, 65535, 0]))), None, "no key");
    }

    #[test]
    fn enabled_as_integer_counts() {
        let mut t = entry(true, [32, 49, 1048576]);
        t.get_mut(SHOW_SPOTLIGHT).unwrap().as_dictionary_mut().unwrap().insert("enabled".into(), Value::Integer(1.into()));
        assert_eq!(parse(Some(&t)).as_deref(), Some("cmd+space"));
    }
}
