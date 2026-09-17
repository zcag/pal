//! First-run tips: one synthetic source, `pal/welcome`, whose rows lead the
//! empty query until the user hides them. No wizard: the rows are ordinary
//! rows (a pick opens Settings, a URL, the Accessibility prompt), the first
//! one's detail explains the panel, and the last one writes the marker
//! `<data dir>/pal/<profile>/welcomed` (an empty file) that keeps the
//! source out of the index from then on. `pal:welcome` in the root action
//! panel deletes the marker and the rows come back.
//!
//! The rows only exist for the empty query (`index::query` leaves the
//! source out otherwise) and a pick from them is never recorded in
//! frecency (`index::pick`). The rows are re-derived on every show
//! (`sync`, and on the grant from `permissions::watch`): the Accessibility
//! row leads while the permission is missing and goes as soon as it is there.

use std::path::{Path, PathBuf};

use pal_core::index::{Item, Source};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::{effects, events, index, permissions, settings};

pub const REPO: &str = "https://github.com/zcag/pal";
pub const EXTENSIONS_GUIDE: &str = "https://github.com/zcag/pal/blob/main/docs/extensions.md";
/// The marker file's name under the profile dir.
const MARKER: &str = "welcomed";
/// Added to every welcome row's score on the empty query, so no frecency
/// boost (`BOOST_SCALE` times a frecency) climbs above the section.
pub const BOOST: f32 = 1e9;

pub const ABOUT: &str = "about";
pub const HOTKEY: &str = "hotkey";
pub const EXTENSIONS: &str = "extensions";
pub const GITHUB: &str = "github";
pub const ACCESSIBILITY: &str = "accessibility";
pub const HIDE: &str = "hide";

/// The profile's data dir, managed so a pick can find the marker.
pub struct DataDir(PathBuf);

pub fn source() -> Source {
    Source::new("pal", "welcome")
}

pub fn marker(data: &Path) -> PathBuf {
    data.join(MARKER)
}

/// The user hid the tips.
pub fn welcomed(data: &Path) -> bool {
    marker(data).exists()
}

/// Write the marker: the tips stay hidden across runs.
pub fn dismiss(data: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(data)?;
    std::fs::write(marker(data), "")
}

/// Delete the marker: the tips are back on the next `sync`.
pub fn reset(data: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(marker(data)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

/// What the rows depend on, taken once per `sync`.
#[derive(Debug, Clone, PartialEq)]
pub struct Env {
    /// The first of `general.hotkey` as configured (`ctrl+space`); empty when off.
    pub hotkey: String,
    /// Off macOS always true: the Accessibility row is for macOS only.
    pub ax_trusted: bool,
}

impl Env {
    fn read(app: &AppHandle) -> Self {
        Self { hotkey: settings::config(app).general.hotkey.first().unwrap_or_default().into(), ax_trusted: !cfg!(target_os = "macos") || pal_core::ax::trusted() }
    }
}

/// `ctrl+space` as the platform writes it: `⌃Space` on macOS, `Ctrl+Space`
/// elsewhere (docs/config.md's modifier names; `cmdorctrl` is the shell's
/// own key, `⌘` or `Ctrl`, as the footer spells it). "the hotkey" when
/// none is set.
pub fn hotkey_label(hotkey: &str) -> String {
    let hotkey = hotkey.trim();
    if hotkey.is_empty() {
        return "the hotkey".into();
    }
    let mac = cfg!(target_os = "macos");
    let part = |p: &str| -> String {
        match (p, mac) {
            ("cmd" | "command" | "super" | "meta" | "cmdorctrl", true) => "⌘".into(),
            ("ctrl" | "control", true) => "⌃".into(),
            ("alt" | "option", true) => "⌥".into(),
            ("shift", true) => "⇧".into(),
            ("cmdorctrl" | "control", false) => "Ctrl".into(),
            ("cmd" | "command" | "meta", false) => "Super".into(),
            _ => {
                let mut c = p.chars();
                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
            }
        }
    };
    let parts: Vec<String> = hotkey.split('+').map(part).collect();
    parts.join(if mac { "" } else { "+" })
}

fn row(id: &str, name: &str, subtitle: &str, icon: &str, markdown: String) -> Item {
    Item {
        id: id.into(),
        name: name.into(),
        subtitle: Some(subtitle.into()).filter(|s: &String| !s.is_empty()),
        keywords: Vec::new(),
        icon: Some(Value::String(icon.into())),
        section: None,
        extra: serde_json::Map::from_iter([("detail".to_string(), json!({ "markdown": markdown }))]),
    }
}

/// The rows, top to bottom. Every one carries a `detail` so the pane has
/// something to say; the about row declares `actions: []` so Enter on it
/// shows that detail instead of picking (the shell's "Show details" is
/// then its first action). Accessibility leads while it is missing: it is
/// the one thing a first run has to do.
pub fn rows(env: &Env) -> Vec<Item> {
    let hk = hotkey_label(&env.hotkey);
    // The shell's own keys as the footer spells them: `⌘K` here, `Ctrl+K` on Linux.
    let (k, enter, comma, i) = (hotkey_label("cmdorctrl+k"), hotkey_label("cmdorctrl+enter"), hotkey_label("cmdorctrl+,"), hotkey_label("cmdorctrl+i"));
    let mut rows = Vec::new();
    if !env.ax_trusted {
        rows.push(row(
            ACCESSIBILITY,
            "Grant Accessibility for paste and window switching",
            "Enter shows the system prompt and opens the switch in System Settings",
            "\u{f0565}",
            "# Accessibility\n\nPasting a row into the app in front and switching to a window both drive another app, which macOS only allows to apps on its Accessibility list.\n\nEnter here shows the system prompt (which puts pal on that list) and opens System Settings › Privacy & Security › Accessibility, where the switch is. pal reads nothing you type. This row goes as soon as the permission is there.".into(),
        ));
    }
    let mut about = row(
        ABOUT,
        "You are in pal: type to search apps, bookmarks, emoji, your clipboard and more",
        "",
        "\u{f1821}",
        format!(
            "# pal\n\nOne search box over everything: apps, bookmarks, emoji, clipboard history, windows, and whatever your extensions add. The sections are the palettes that matched.\n\n- **{hk}** opens and hides pal from any app\n- **Type** to search; the list narrows as you go\n- **Enter** runs the row's first action, **{enter}** its second\n- **{k}** lists every action for the row\n- **Esc** clears the query, then steps back, then hides\n- **{comma}** opens Settings; **{i}** shows a row's details, like this one"
        ),
    );
    about.extra.insert("actions".into(), json!([]));
    rows.extend([
        about,
        row(
            HOTKEY,
            "Change the hotkey",
            &format!("{hk} now; Enter opens the recorder in Settings"),
            "\u{f030c}",
            format!("# Change the hotkey\n\npal opens with **{hk}**. Enter opens the recorder under Settings › General: press another combination, or pick a preset. Every palette can have its own hotkey too, on its row under Settings › Palettes."),
        ),
        row(
            EXTENSIONS,
            "Add your own palettes",
            "A palette is a small TypeScript file; the guide is on GitHub",
            "\u{f0431}",
            format!("# Add your own palettes\n\nEvery palette in pal is an extension, the built-in ones included. An extension is a folder with a `pal.json` and an `index.ts` that lists rows and answers picks. The guide walks through one:\n\n{EXTENSIONS_GUIDE}"),
        ),
        row(
            GITHUB,
            "Star or report an issue",
            "github.com/zcag/pal",
            "\u{f02a4}",
            format!("# pal on GitHub\n\nSource, releases and the issue tracker:\n\n{REPO}\n\nA star helps others find it; an issue with what you expected and what happened helps fix it."),
        ),
    ]);
    rows.push(row(
        HIDE,
        "Hide these tips",
        &format!("Bring them back any time with “Show tips again” in {k}"),
        "\u{f06d1}",
        format!("# Hide these tips\n\nThe Welcome section goes and the empty query starts with your palettes and apps. {k} at the root has “Show tips again”."),
    ));
    rows
}

pub fn install(app: &AppHandle, data: &Path) {
    app.manage(DataDir(data.to_path_buf()));
}

pub(crate) fn data_dir(app: &AppHandle) -> PathBuf {
    app.state::<DataDir>().0.clone()
}

/// Put the rows the current state calls for in the index (none once the
/// marker exists), and tell the page when that changed something. Cheap:
/// called at startup and on every show.
pub fn sync(app: &AppHandle) {
    let data = data_dir(app);
    let rows = if welcomed(&data) { Vec::new() } else { rows(&Env::read(app)) };
    let source = source();
    let n = rows.len();
    let changed = index::with_index(app, |ix| {
        if ix.snapshot(&source) == rows {
            return false;
        }
        if rows.is_empty() {
            ix.remove(&source);
        } else {
            ix.replace(source, rows);
        }
        true
    });
    if changed {
        eprintln!("welcome\t{}", if n == 0 { "removed".to_string() } else { format!("{n} rows") });
        events::emit(app, events::INDEX, ());
    }
}

/// A pick on a welcome row. Returns the envelope the page should see, as
/// `index::pick` does for a host row.
pub async fn pick(app: &AppHandle, id: &str) -> Result<Value, String> {
    let data = data_dir(app);
    match id {
        // Straight to the recorder, not the Overview: the row promised the hotkey.
        HOTKEY => {
            settings::open_at(app, Some("general"), Some("general:hotkey"));
            Ok(json!({ "hide": true }))
        }
        EXTENSIONS => effects::apply(app, json!({ "open": EXTENSIONS_GUIDE })).await,
        GITHUB => effects::apply(app, json!({ "open": REPO })).await,
        ACCESSIBILITY => {
            // The user asked: prompt and pane every time, not once per run.
            let status = permissions::request(app, "accessibility")?;
            if status.accessibility {
                sync(app);
                Ok(json!({ "toast": { "title": "Accessibility granted", "message": "Paste and window switching work now", "style": "success" } }))
            } else {
                Ok(effects::accessibility_toast("Paste and window switching"))
            }
        }
        HIDE => {
            dismiss(&data).map_err(|e| format!("could not write {}: {e}", marker(&data).display()))?;
            eprintln!("welcome\thidden\t{}", marker(&data).display());
            sync(app);
            Ok(json!({ "keep": true }))
        }
        // `about` declares no actions; anything else is a stale row.
        _ => Ok(json!({ "keep": true })),
    }
}

/// `pal:welcome` in the root action panel: the rows come back.
#[tauri::command(async)]
pub fn welcome_reset(app: AppHandle) -> Result<(), String> {
    let data = data_dir(&app);
    reset(&data).map_err(|e| format!("could not remove {}: {e}", marker(&data).display()))?;
    eprintln!("welcome\treset");
    sync(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(ax_trusted: bool) -> Env {
        Env { hotkey: "ctrl+space".into(), ax_trusted }
    }

    #[test]
    fn marker_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("profile");
        assert!(!welcomed(&data), "a fresh profile has no marker");
        dismiss(&data).unwrap();
        assert!(welcomed(&data));
        assert_eq!(marker(&data), data.join("welcomed"));
        assert_eq!(std::fs::read(marker(&data)).unwrap(), b"", "the marker is an empty file");
        reset(&data).unwrap();
        assert!(!welcomed(&data));
        reset(&data).unwrap();
        assert!(!welcomed(&data), "resetting twice is fine");
    }

    #[test]
    fn rows_in_order_with_accessibility_only_while_untrusted() {
        let ids = |rows: &[Item]| rows.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&rows(&env(false))), [ACCESSIBILITY, ABOUT, HOTKEY, EXTENSIONS, GITHUB, HIDE], "the permission leads until granted");
        assert_eq!(ids(&rows(&env(true))), [ABOUT, HOTKEY, EXTENSIONS, GITHUB, HIDE]);
    }

    #[test]
    fn rows_carry_icon_detail_and_the_about_row_is_inert() {
        let untrusted = rows(&env(false));
        for r in &untrusted {
            assert!(r.icon.as_ref().and_then(Value::as_str).is_some_and(|s| s.chars().count() == 1), "{}: one glyph", r.id);
            assert!(r.extra["detail"]["markdown"].as_str().is_some_and(|m| m.starts_with("# ")), "{}: a detail", r.id);
        }
        assert!(untrusted[0].extra.get("actions").is_none(), "Enter on the Accessibility row asks");
        let rows = rows(&env(true));
        assert_eq!(rows[0].extra["actions"], json!([]), "Enter on the about row shows its detail");
        assert!(rows.iter().skip(1).all(|r| r.extra.get("actions").is_none()));
        let about = rows[0].extra["detail"]["markdown"].as_str().unwrap();
        assert!(about.contains(&hotkey_label("ctrl+space")), "the detail names the hotkey");
        assert!(rows[2].extra["detail"]["markdown"].as_str().unwrap().contains(EXTENSIONS_GUIDE));
        assert!(rows[3].extra["detail"]["markdown"].as_str().unwrap().contains(REPO));
    }

    #[test]
    fn hotkey_labels() {
        assert_eq!(hotkey_label(""), "the hotkey");
        assert_eq!(hotkey_label("  "), "the hotkey");
        if cfg!(target_os = "macos") {
            assert_eq!(hotkey_label("ctrl+space"), "⌃Space");
            assert_eq!(hotkey_label("cmd+shift+k"), "⌘⇧K");
        } else {
            assert_eq!(hotkey_label("ctrl+space"), "Ctrl+Space");
            assert_eq!(hotkey_label("alt+space"), "Alt+Space");
            assert_eq!(hotkey_label("cmd+space"), "Super+Space");
            assert_eq!(hotkey_label("cmdorctrl+k"), "Ctrl+K");
        }
    }

    #[test]
    fn shell_keys_are_spelled_for_the_platform() {
        let rows = rows(&env(true));
        let hide = rows.iter().find(|r| r.id == HIDE).unwrap();
        let about = rows[0].extra["detail"]["markdown"].as_str().unwrap();
        let (k, enter) = if cfg!(target_os = "macos") { ("⌘K", "⌘Enter") } else { ("Ctrl+K", "Ctrl+Enter") };
        assert!(hide.subtitle.as_deref().unwrap().contains(k), "{:?}", hide.subtitle);
        assert!(hide.extra["detail"]["markdown"].as_str().unwrap().contains(k));
        assert!(about.contains(enter) && about.contains(k), "{about}");
        assert!(!cfg!(target_os = "macos") || !about.contains("Ctrl+"));
        assert!(cfg!(target_os = "macos") || !about.contains('⌘'), "{about}");
    }
}
