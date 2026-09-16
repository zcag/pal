//! Open windows: list them and focus, close or minimise one.
//!
//! One [`Window`] shape on every platform; the backend behind it is picked at
//! runtime ([`backend`]):
//!
//! - **macOS**: `CGWindowListCopyWindowInfo` for the list (layer 0, owner
//!   pid, bounds, on-screen) merged with `NSRunningApplication` for the app's
//!   name, bundle id and `.app` path, and with the Accessibility API
//!   ([`crate::ax::element`]) for what CoreGraphics does not say: the title
//!   of another app's window (CoreGraphics only gives it with Screen
//!   Recording permission) and whether it is minimised. The AX window for a
//!   CoreGraphics one is found by frame and title, both APIs report in the
//!   same coordinate space. Focus is `activateWithOptions` on the app plus
//!   `AXRaise` on the window; close presses the window's close button;
//!   minimise sets `AXMinimized`. Without Accessibility the list still works
//!   (titles from CoreGraphics when Screen Recording allows, else the app
//!   name), focus falls back to activating the app, and close / minimise
//!   fail with [`Error::NeedsAccessibility`].
//! - **Linux**: Hyprland (`hyprctl clients -j`, `dispatch focuswindow` /
//!   `closewindow`, minimise = move to the `special:minimized` workspace),
//!   Sway (`swaymsg -t get_tree`, `[con_id=N] focus` / `kill` / `move
//!   scratchpad`), or X11 (`wmctrl -lpx`, `-i -a` / `-i -c`, minimise via
//!   `xdotool` when present). Detected from the session's environment, then
//!   by which tool answers; [`Error::Unavailable`] when none does.
//!
//! [`app_icon_source`] gives the path [`crate::icons::app_icon`] renders: the
//! `.app` bundle, or the `.desktop` file whose id or `StartupWMClass` is the
//! window's class.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("no window {0}")]
    NotFound(String),
    /// macOS: the action reaches into another app, which needs Accessibility permission for pal.
    #[error("{0} needs Accessibility permission")]
    NeedsAccessibility(&'static str),
    /// No window manager pal can talk to, or no tool for this action on it.
    #[error("windows unavailable: {0}")]
    Unavailable(String),
    /// The window manager or the app refused.
    #[error("{0}")]
    Failed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    /// Backend-specific and stable while the window lives: the CoreGraphics
    /// window number, a Hyprland address, a Sway container id, an X11 id.
    pub id: String,
    /// What the user calls the program: the app's name, or the window class.
    pub app: String,
    pub title: String,
    /// Bundle id on macOS; `app_id` / `WM_CLASS` on Linux.
    pub bundle_or_class: String,
    pub pid: i32,
    pub minimized: bool,
    /// Visible right now (not minimised, hidden, or on another space).
    pub on_screen: bool,
    /// Which display, only when there is more than one.
    pub monitor: Option<String>,
    /// Workspace / space name where the backend has them.
    pub workspace: Option<String>,
}

/// Which window manager answers: `macos`, `hyprland`, `sway`, `x11`, or
/// `none`.
pub fn backend() -> &'static str {
    platform::backend()
}

/// Every window of every regular app, front to back (macOS) or most recently
/// focused first (Hyprland); minimised ones included.
pub fn list() -> Result<Vec<Window>> {
    platform::list()
}

/// Bring the window to the front, restoring it when minimised.
pub fn focus(id: &str) -> Result<()> {
    platform::focus(id)
}

/// Close it the way its close button would.
pub fn close(id: &str) -> Result<()> {
    platform::close(id)
}

pub fn minimize(id: &str) -> Result<()> {
    platform::minimize(id)
}

/// The file whose icon is the window's app's, for `icons::app_icon`.
pub fn app_icon_source(w: &Window) -> Option<PathBuf> {
    platform::app_icon_source(w)
}

/// Run a tool and give back its stdout, [`Error::Failed`] with stderr when it
/// exits non-zero, [`Error::Unavailable`] when it is not installed.
#[cfg(not(target_os = "macos"))]
fn run(bin: &str, args: &[&str]) -> Result<String> {
    let out = std::process::Command::new(bin).args(args).output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::Unavailable(format!("{bin} not installed")),
        _ => Error::Io(e),
    })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let err = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err };
        return Err(Error::Failed(format!("{bin} {}: {err}", args.join(" "))));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use crate::ax::element::{Element, Frame};
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSApplicationActivationOptions, NSApplicationActivationPolicy, NSRunningApplication};
    use objc2_core_foundation::CFRetained;
    use objc2_core_graphics::{CGDirectDisplayID, CGDisplayBounds, CGGetActiveDisplayList, CGMainDisplayID, CGWindowListCopyWindowInfo, CGWindowListOption};
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

    /// A CoreGraphics and an AX frame agree within this many points.
    const FRAME_SLACK: f64 = 2.0;

    /// One row of `CGWindowListCopyWindowInfo`, the fields pal reads.
    struct CgWindow {
        id: u32,
        pid: i32,
        /// Empty without Screen Recording permission.
        name: String,
        frame: Frame,
        on_screen: bool,
    }

    pub fn backend() -> &'static str {
        "macos"
    }

    /// Layer-0, visible-alpha windows of other processes, front to back.
    fn cg_windows() -> Vec<CgWindow> {
        let Some(arr) = CGWindowListCopyWindowInfo(CGWindowListOption::OptionAll | CGWindowListOption::ExcludeDesktopElements, 0) else {
            return vec![];
        };
        // SAFETY: CFArray of CFDictionary is toll-free bridged to NSArray of NSDictionary.
        let arr: &NSArray<NSDictionary<NSString, AnyObject>> = unsafe { &*CFRetained::as_ptr(&arr).as_ptr().cast() };
        let me = std::process::id() as i32;
        arr.iter()
            .filter_map(|d| {
                let num = |k: &str| d.objectForKey(&NSString::from_str(k)).and_then(|v| v.downcast::<NSNumber>().ok());
                let text = |k: &str| d.objectForKey(&NSString::from_str(k)).and_then(|v| v.downcast::<NSString>().ok()).map(|s| s.to_string());
                if num("kCGWindowLayer")?.integerValue() != 0 || num("kCGWindowAlpha").is_some_and(|a| a.doubleValue() <= 0.0) {
                    return None;
                }
                let pid = num("kCGWindowOwnerPID")?.integerValue() as i32;
                if pid == me {
                    return None;
                }
                let bounds = d.objectForKey(&NSString::from_str("kCGWindowBounds"))?.downcast::<NSDictionary>().ok()?;
                let b = |k: &str| bounds.objectForKey(&*NSString::from_str(k)).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.doubleValue());
                Some(CgWindow {
                    id: num("kCGWindowNumber")?.integerValue() as u32,
                    pid,
                    name: text("kCGWindowName").unwrap_or_default(),
                    frame: Frame { x: b("X")?, y: b("Y")?, w: b("Width")?, h: b("Height")?, },
                    on_screen: num("kCGWindowIsOnscreen").is_some_and(|n| n.boolValue()),
                })
            })
            .collect()
    }

    /// One AX window with its attributes read once, for matching.
    struct AxWindow {
        el: Element,
        title: String,
        frame: Option<Frame>,
        minimized: bool,
    }

    fn ax_windows(pid: i32) -> Vec<AxWindow> {
        let Some(app) = Element::app(pid) else { return vec![] };
        app.windows()
            .into_iter()
            .map(|el| AxWindow { title: el.title().unwrap_or_default(), frame: el.frame(), minimized: el.minimized(), el })
            .collect()
    }

    fn same_frame(a: &Frame, b: &Frame) -> bool {
        (a.x - b.x).abs() <= FRAME_SLACK && (a.y - b.y).abs() <= FRAME_SLACK && (a.w - b.w).abs() <= FRAME_SLACK && (a.h - b.h).abs() <= FRAME_SLACK
    }

    /// The AX window that is `cg`: same frame, and the same title when
    /// CoreGraphics has one. Removed from `pool` so two identical windows
    /// each get their own.
    fn take_match(pool: &mut Vec<AxWindow>, cg: &CgWindow) -> Option<AxWindow> {
        let i = pool.iter().position(|ax| ax.frame.is_some_and(|f| same_frame(&f, &cg.frame)) && (cg.name.is_empty() || ax.title == cg.name))?;
        Some(pool.remove(i))
    }

    /// Active displays, main first, in the window list's coordinate space.
    fn displays() -> Vec<Frame> {
        let mut ids = [0 as CGDirectDisplayID; 16];
        let mut n = 0u32;
        // SAFETY: the buffer holds `ids.len()` entries; `n` receives how many were written.
        if unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut n) } != objc2_core_graphics::CGError::Success {
            return vec![];
        }
        let main = CGMainDisplayID();
        let mut ids: Vec<_> = ids[..n as usize].to_vec();
        ids.sort_by_key(|d| *d != main);
        ids.into_iter()
            .map(|d| {
                let r = CGDisplayBounds(d);
                Frame { x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height }
            })
            .collect()
    }

    fn monitor_of(displays: &[Frame], f: &Frame) -> Option<String> {
        if displays.len() < 2 {
            return None;
        }
        let (cx, cy) = (f.x + f.w / 2.0, f.y + f.h / 2.0);
        let i = displays.iter().position(|d| cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h)?;
        Some(format!("Display {}", i + 1))
    }

    fn running(pid: i32) -> Option<Retained<NSRunningApplication>> {
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid).filter(|a| a.activationPolicy() == NSApplicationActivationPolicy::Regular)
    }

    pub fn list() -> Result<Vec<Window>> {
        let displays = displays();
        let cg = cg_windows();
        // Per app: its AX windows still unmatched, and whether it had any at
        // all (an app that answers AX with nothing gets CoreGraphics rows).
        // Each AX read is a round trip to that app's main thread, 10-30 ms
        // for a napping one, so the apps are asked side by side.
        let mut apps: Vec<(i32, Retained<NSRunningApplication>, Vec<AxWindow>, bool)> = vec![];
        let mut pids: Vec<i32> = vec![];
        for w in &cg {
            if !pids.contains(&w.pid) {
                if let Some(app) = running(w.pid) {
                    pids.push(w.pid);
                    apps.push((w.pid, app, vec![], false));
                }
            }
        }
        if crate::ax::trusted() {
            let ax: Vec<Vec<AxWindow>> = std::thread::scope(|s| {
                let handles: Vec<_> = pids.iter().map(|&pid| s.spawn(move || ax_windows(pid))).collect();
                handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
            });
            for (entry, ax) in apps.iter_mut().zip(ax) {
                entry.3 = !ax.is_empty();
                entry.2 = ax;
            }
        }
        let mut out = vec![];
        for cg in cg {
            let Some(i) = apps.iter().position(|(p, ..)| *p == cg.pid) else { continue };
            let (_, app, pool, by_ax) = &mut apps[i];
            let (title, minimized) = match take_match(pool, &cg) {
                Some(ax) => (if ax.title.is_empty() { cg.name.clone() } else { ax.title }, ax.minimized),
                // The app's own window list is the truth: a layer-0 window
                // it does not list is a helper (tooltip, overlay). Without
                // one, CoreGraphics is all there is.
                None if *by_ax => continue,
                None if cg.name.is_empty() && !cg.on_screen => continue,
                None => (cg.name.clone(), false),
            };
            let name = app.localizedName().map(|s| s.to_string()).unwrap_or_default();
            out.push(Window {
                id: cg.id.to_string(),
                title: if title.is_empty() { name.clone() } else { title },
                app: name,
                bundle_or_class: app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default(),
                pid: cg.pid,
                minimized,
                on_screen: cg.on_screen,
                monitor: monitor_of(&displays, &cg.frame),
                workspace: None,
            });
        }
        Ok(out)
    }

    fn find(id: &str) -> Result<CgWindow> {
        let n: u32 = id.parse().map_err(|_| Error::NotFound(id.into()))?;
        cg_windows().into_iter().find(|w| w.id == n).ok_or_else(|| Error::NotFound(id.into()))
    }

    /// The AX window behind a CoreGraphics one, when pal may look.
    fn ax_of(cg: &CgWindow, what: &'static str) -> Result<Element> {
        if !crate::ax::trusted() {
            return Err(Error::NeedsAccessibility(what));
        }
        take_match(&mut ax_windows(cg.pid), cg).map(|ax| ax.el).ok_or_else(|| Error::NotFound(cg.id.to_string()))
    }

    pub fn focus(id: &str) -> Result<()> {
        let cg = find(id)?;
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(cg.pid).ok_or_else(|| Error::NotFound(id.into()))?;
        // The window first, so the app comes forward showing it rather than
        // whichever window it last had in front.
        let raised = match ax_of(&cg, "focus") {
            Ok(win) => {
                if win.minimized() {
                    win.set_minimized(false);
                }
                win.raise()
            }
            // App-level activation is what is left without the permission.
            Err(Error::NeedsAccessibility(_)) => true,
            Err(e) => return Err(e),
        };
        app.unhide();
        #[allow(deprecated)] // `activate()` (14+) does not take focus from another app without a cooperative handoff.
        let ok = app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
        match (ok, raised) {
            (true, true) => Ok(()),
            (true, false) => Err(Error::Failed("the app came forward but refused to raise that window".into())),
            (false, _) => Err(Error::Failed("the app refused to activate".into())),
        }
    }

    pub fn close(id: &str) -> Result<()> {
        let cg = find(id)?;
        ax_of(&cg, "close")?.close().then_some(()).ok_or_else(|| Error::Failed("no close button on that window".into()))
    }

    pub fn minimize(id: &str) -> Result<()> {
        let cg = find(id)?;
        ax_of(&cg, "minimize")?.set_minimized(true).then_some(()).ok_or_else(|| Error::Failed("the window cannot be minimised".into()))
    }

    pub fn app_icon_source(w: &Window) -> Option<PathBuf> {
        let url = NSRunningApplication::runningApplicationWithProcessIdentifier(w.pid)?.bundleURL()?;
        Some(PathBuf::from(url.path()?.to_string()))
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use crate::fs::on_path as has;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Backend {
        Hyprland,
        Sway,
        X11,
    }

    /// `hyprctl` needs `HYPRLAND_INSTANCE_SIGNATURE`, which a pal started
    /// from a systemd user service does not inherit; the running instance
    /// is the newest directory under `$XDG_RUNTIME_DIR/hypr`.
    fn hyprland_signature() -> Option<String> {
        if let Some(s) = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").filter(|s| !s.is_empty()) {
            return Some(s.to_string_lossy().into_owned());
        }
        let dir = PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR")?).join("hypr");
        let mut dirs: Vec<_> = std::fs::read_dir(dir).ok()?.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).ok()));
        Some(dirs.first()?.file_name().to_string_lossy().into_owned())
    }

    fn detect() -> Option<Backend> {
        if has("hyprctl") && hyprland_signature().is_some() {
            return Some(Backend::Hyprland);
        }
        if has("swaymsg") && std::env::var_os("SWAYSOCK").is_some() {
            return Some(Backend::Sway);
        }
        if has("wmctrl") && std::env::var_os("DISPLAY").is_some() {
            return Some(Backend::X11);
        }
        None
    }

    fn need() -> Result<Backend> {
        detect().ok_or_else(|| Error::Unavailable("no Hyprland, Sway or X11 (wmctrl) session".into()))
    }

    pub fn backend() -> &'static str {
        match detect() {
            Some(Backend::Hyprland) => "hyprland",
            Some(Backend::Sway) => "sway",
            Some(Backend::X11) => "x11",
            None => "none",
        }
    }

    fn hyprctl(args: &[&str]) -> Result<String> {
        let sig = hyprland_signature().ok_or_else(|| Error::Unavailable("no Hyprland instance".into()))?;
        let out = std::process::Command::new("hyprctl").env("HYPRLAND_INSTANCE_SIGNATURE", sig).args(args).output()?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        // A dispatch answers "ok" on stdout, anything else is its complaint.
        if !out.status.success() || (args.first() == Some(&"dispatch") && text != "ok") {
            return Err(Error::Failed(format!("hyprctl {}: {}", args.join(" "), if text.is_empty() { String::from_utf8_lossy(&out.stderr).trim().to_string() } else { text })));
        }
        Ok(text)
    }

    /// `swaymsg` exits 0 with `[{"success": false, "error": ...}]` on a bad command.
    fn swaymsg(cmd: &str) -> Result<()> {
        let out = run("swaymsg", &["-t", "command", cmd])?;
        let v: serde_json::Value = serde_json::from_str(&out).unwrap_or_default();
        match v.get(0) {
            Some(r) if r.get("success").and_then(|s| s.as_bool()) == Some(true) => Ok(()),
            Some(r) => Err(Error::Failed(format!("swaymsg {cmd}: {}", r.get("error").and_then(|e| e.as_str()).unwrap_or("failed")))),
            None => Err(Error::Failed(format!("swaymsg {cmd}: no reply"))),
        }
    }

    pub fn list() -> Result<Vec<Window>> {
        Ok(match need()? {
            Backend::Hyprland => parse_hyprland(&hyprctl(&["clients", "-j"])?, &hyprctl(&["monitors", "-j"])?),
            Backend::Sway => parse_sway(&run("swaymsg", &["-t", "get_tree"])?),
            Backend::X11 => parse_wmctrl(&run("wmctrl", &["-lpx"])?),
        })
    }

    fn find(id: &str) -> Result<Window> {
        list()?.into_iter().find(|w| w.id == id).ok_or_else(|| Error::NotFound(id.into()))
    }

    pub fn focus(id: &str) -> Result<()> {
        match need()? {
            Backend::Hyprland => {
                let w = find(id)?;
                if w.minimized {
                    // Back onto the workspace in front, which also focuses it.
                    let ws: serde_json::Value = serde_json::from_str(&hyprctl(&["activeworkspace", "-j"])?).unwrap_or_default();
                    let ws = ws.get("id").and_then(|i| i.as_i64()).ok_or_else(|| Error::Failed("no active workspace".into()))?;
                    hyprctl(&["dispatch", "movetoworkspace", &format!("{ws},address:{id}")])?;
                }
                hyprctl(&["dispatch", "focuswindow", &format!("address:{id}")]).map(drop)
            }
            Backend::Sway => {
                let w = find(id)?;
                swaymsg(&format!("[con_id={id}] {}", if w.minimized { "scratchpad show" } else { "focus" }))
            }
            Backend::X11 => run("wmctrl", &["-i", "-a", id]).map(drop),
        }
    }

    pub fn close(id: &str) -> Result<()> {
        match need()? {
            Backend::Hyprland => hyprctl(&["dispatch", "closewindow", &format!("address:{id}")]).map(drop),
            Backend::Sway => swaymsg(&format!("[con_id={id}] kill")),
            Backend::X11 => run("wmctrl", &["-i", "-c", id]).map(drop),
        }
    }

    pub fn minimize(id: &str) -> Result<()> {
        match need()? {
            Backend::Hyprland => hyprctl(&["dispatch", "movetoworkspacesilent", &format!("special:minimized,address:{id}")]).map(drop),
            Backend::Sway => swaymsg(&format!("[con_id={id}] move scratchpad")),
            Backend::X11 if has("xdotool") => run("xdotool", &["windowminimize", id]).map(drop),
            Backend::X11 => Err(Error::Unavailable("minimise on X11 needs xdotool".into())),
        }
    }

    // ---- parsers ---------------------------------------------------------

    /// `hyprctl clients -j` with `hyprctl monitors -j` for the monitor names,
    /// most recently focused first. Unmapped clients (still starting, or
    /// gone) are skipped; a window parked on `special:minimized` (what
    /// [`minimize`] does) is reported minimised.
    pub fn parse_hyprland(clients: &str, monitors: &str) -> Vec<Window> {
        let monitors: Vec<serde_json::Value> = serde_json::from_str(monitors).unwrap_or_default();
        let monitor_name = |id: i64| monitors.iter().find(|m| m["id"].as_i64() == Some(id)).and_then(|m| m["name"].as_str()).map(str::to_string);
        let mut clients: Vec<serde_json::Value> = serde_json::from_str(clients).unwrap_or_default();
        clients.sort_by_key(|c| c["focusHistoryID"].as_i64().unwrap_or(i64::MAX));
        clients
            .iter()
            .filter(|c| c["mapped"].as_bool() == Some(true) && c["pid"].as_i64().unwrap_or(-1) > 0)
            .map(|c| {
                let class = c["class"].as_str().filter(|s| !s.is_empty()).or_else(|| c["initialClass"].as_str()).unwrap_or_default().to_string();
                let ws = c["workspace"]["name"].as_str().unwrap_or_default().to_string();
                let title = c["title"].as_str().unwrap_or_default().to_string();
                Window {
                    id: c["address"].as_str().unwrap_or_default().to_string(),
                    app: class.clone(),
                    title: if title.is_empty() { class.clone() } else { title },
                    bundle_or_class: class,
                    pid: c["pid"].as_i64().unwrap_or_default() as i32,
                    minimized: ws.starts_with("special:"),
                    on_screen: c["visible"].as_bool() == Some(true),
                    monitor: if monitors.len() > 1 { c["monitor"].as_i64().and_then(monitor_name) } else { None },
                    workspace: Some(ws),
                }
            })
            .collect()
    }

    /// `swaymsg -t get_tree`: every container with a pid, in tree order;
    /// scratchpad ones (under `__i3_scratch`) are the minimised.
    pub fn parse_sway(tree: &str) -> Vec<Window> {
        let root: serde_json::Value = serde_json::from_str(tree).unwrap_or_default();
        let outputs = root["nodes"].as_array().map_or(0, |o| o.iter().filter(|o| o["name"].as_str() != Some("__i3")).count());
        let mut out = vec![];
        fn walk(n: &serde_json::Value, output: Option<&str>, workspace: Option<&str>, many: bool, out: &mut Vec<Window>) {
            let name = n["name"].as_str();
            let (output, workspace) = match n["type"].as_str() {
                Some("output") => (name, None),
                Some("workspace") => (output, name),
                _ => (output, workspace),
            };
            if let Some(pid) = n["pid"].as_i64() {
                let class = n["app_id"].as_str().or_else(|| n["window_properties"]["class"].as_str()).unwrap_or_default().to_string();
                let title = name.unwrap_or_default().to_string();
                let scratch = workspace == Some("__i3_scratch") || n["scratchpad_state"].as_str().is_some_and(|s| s != "none");
                out.push(Window {
                    id: n["id"].as_i64().unwrap_or_default().to_string(),
                    app: class.clone(),
                    title: if title.is_empty() { class.clone() } else { title },
                    bundle_or_class: class,
                    pid: pid as i32,
                    minimized: scratch,
                    on_screen: n["visible"].as_bool() == Some(true),
                    monitor: if many && !scratch { output.map(str::to_string) } else { None },
                    workspace: workspace.filter(|_| !scratch).map(str::to_string),
                });
            }
            for k in ["nodes", "floating_nodes"] {
                for c in n[k].as_array().into_iter().flatten() {
                    walk(c, output, workspace, many, out);
                }
            }
        }
        walk(&root, None, None, outputs > 1, &mut out);
        out
    }

    /// `wmctrl -lpx`: `id desktop pid instance.class host title...`. The
    /// desktop itself and panels come as pid 0 with class `N/A`; skipped.
    pub fn parse_wmctrl(text: &str) -> Vec<Window> {
        text.lines()
            .filter_map(|l| {
                // Five fixed columns, then the title with its own spaces.
                let mut rest = l.trim_start();
                let mut field = || {
                    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                    let f = &rest[..end];
                    rest = rest[end..].trim_start();
                    f
                };
                let (id, desktop, pid, class, _host) = (field(), field(), field(), field(), field());
                let title = rest.trim_end().to_string();
                let pid: i32 = pid.parse().ok().filter(|p| *p > 0)?;
                if class == "N/A" {
                    return None;
                }
                let class = class.rsplit('.').next().unwrap_or(class).to_string();
                Some(Window {
                    id: id.to_string(),
                    app: class.clone(),
                    title: if title.is_empty() { class.clone() } else { title },
                    bundle_or_class: class,
                    pid,
                    minimized: false,
                    on_screen: true,
                    monitor: None,
                    workspace: Some(desktop.to_string()).filter(|d| d != "-1"),
                })
            })
            .collect()
    }

    // ---- icons -------------------------------------------------------------

    fn desktop_dirs() -> Vec<PathBuf> {
        let home = dirs::home_dir().unwrap_or_default();
        let data_home = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local/share"));
        let sys = std::env::var_os("XDG_DATA_DIRS").filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
        let mut dirs = vec![data_home];
        dirs.extend(std::env::split_paths(&sys));
        dirs.push("/var/lib/flatpak/exports/share".into());
        dirs.push(home.join(".local/share/flatpak/exports/share"));
        dirs.into_iter().map(|d| d.join("applications")).collect()
    }

    /// The `.desktop` file for a window class: `<class>.desktop` by name
    /// (case-insensitive, the common case for `app_id`s like `org.gnome.Nautilus`
    /// or `kitty`), else the entry whose `StartupWMClass` is the class.
    fn desktop_for_class(class: &str) -> Option<PathBuf> {
        let want = format!("{}.desktop", class.to_lowercase());
        let mut by_wmclass = None;
        for dir in desktop_dirs() {
            for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let name = e.file_name().to_string_lossy().to_lowercase();
                if !name.ends_with(".desktop") {
                    continue;
                }
                if name == want {
                    return Some(e.path());
                }
                if by_wmclass.is_none() {
                    let text = std::fs::read_to_string(e.path()).unwrap_or_default();
                    if text.lines().any(|l| l.strip_prefix("StartupWMClass=").is_some_and(|v| v.trim().eq_ignore_ascii_case(class))) {
                        by_wmclass = Some(e.path());
                    }
                }
            }
        }
        by_wmclass
    }

    pub fn app_icon_source(w: &Window) -> Option<PathBuf> {
        static CACHE: Mutex<Option<HashMap<String, Option<PathBuf>>>> = Mutex::new(None);
        if w.bundle_or_class.is_empty() {
            return None;
        }
        let mut cache = CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        cache.get_or_insert_with(HashMap::new).entry(w.bundle_or_class.clone()).or_insert_with(|| desktop_for_class(&w.bundle_or_class)).clone()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::*;

    pub fn backend() -> &'static str {
        "none"
    }
    pub fn list() -> Result<Vec<Window>> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn focus(_: &str) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn close(_: &str) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn minimize(_: &str) -> Result<()> {
        Err(Error::Unavailable("unsupported platform".into()))
    }
    pub fn app_icon_source(_: &Window) -> Option<PathBuf> {
        None
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::platform::*;

    const CLIENTS: &str = include_str!("../fixtures/hyprctl-clients.json");
    const MONITORS: &str = include_str!("../fixtures/hyprctl-monitors.json");
    const TREE: &str = include_str!("../fixtures/swaymsg-tree.json");
    const WMCTRL: &str = include_str!("../fixtures/wmctrl-lpx.txt");

    #[test]
    fn hyprland_rows_by_focus_order_with_monitor_and_minimised() {
        let w = parse_hyprland(CLIENTS, MONITORS);
        assert_eq!(w.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), ["0x5555f04c7b30", "0x5555f0ea8e70", "0x5555f0aa0000"], "focusHistoryID order, the unmapped one dropped");
        let chromium = &w[0];
        assert_eq!((chromium.app.as_str(), chromium.title.as_str(), chromium.pid), ("chromium", "Migros - Chromium", 1693751));
        assert_eq!((chromium.on_screen, chromium.minimized), (true, false));
        assert_eq!(chromium.monitor.as_deref(), Some("HDMI-A-1"));
        assert_eq!(chromium.workspace.as_deref(), Some("3"));
        let kitty = &w[2];
        assert!(kitty.minimized && !kitty.on_screen);
        assert_eq!(kitty.monitor.as_deref(), Some("DP-2"));
        assert_eq!(kitty.workspace.as_deref(), Some("special:minimized"));
    }

    #[test]
    fn hyprland_single_monitor_has_no_monitor_column() {
        let one = MONITORS.replacen("},{", "}]", 1);
        let one = &one[..one.find("}]").unwrap() + 2];
        assert!(parse_hyprland(CLIENTS, one).iter().all(|w| w.monitor.is_none()));
    }

    #[test]
    fn sway_walks_outputs_workspaces_and_scratchpad() {
        let w = parse_sway(TREE);
        assert_eq!(w.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(), ["21", "5", "7", "9"]);
        let scratch = &w[0];
        assert_eq!((scratch.app.as_str(), scratch.title.as_str(), scratch.minimized, scratch.on_screen), ("kitty", "scratch term", true, false));
        assert_eq!((scratch.monitor.as_deref(), scratch.workspace.as_deref()), (None, None));
        let foot = &w[1];
        assert_eq!((foot.app.as_str(), foot.title.as_str(), foot.pid, foot.on_screen), ("foot", "nvim ~/notes.md", 1200, true));
        assert_eq!((foot.workspace.as_deref(), foot.monitor.as_deref()), (Some("1"), None), "one real output: no monitor");
        let steam = &w[3];
        assert_eq!(steam.bundle_or_class, "steam", "XWayland class from window_properties");
        assert_eq!(steam.workspace.as_deref(), Some("2"));
    }

    #[test]
    fn wmctrl_columns_and_the_desktop_row() {
        let w = parse_wmctrl(WMCTRL);
        assert_eq!(w.len(), 3, "the N/A desktop row is skipped");
        assert_eq!((w[0].id.as_str(), w[0].pid, w[0].app.as_str(), w[0].title.as_str()), ("0x03400003", 12345, "kitty", "~/proj/pal"));
        assert_eq!((w[1].bundle_or_class.as_str(), w[1].title.as_str()), ("firefox", "GitHub - zcag/pal - Mozilla Firefox"));
        assert_eq!(w[2].workspace.as_deref(), Some("1"));
        assert_eq!((w[2].app.as_str(), w[2].title.as_str()), ("Code", "windows.rs - pal - Visual Studio Code"));
    }
}
