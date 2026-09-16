//! The sketchybar target: pal's items as sketchybar items named
//! `pal.<ext>.<id>` (a segment `pal.<ext>.<id>.<seg>`, a count badge
//! `pal.<ext>.<id>.badge`), set through one batched `sketchybar` call
//! per change. Only names under `pal.` are ever added, set, moved or
//! removed; the owner's items are never touched. Detection is
//! `sketchybar --query bar` exiting 0, probed every [`SKETCHYBAR_POLL`]
//! while the target is wanted, so a bar restarted by its own rc (which
//! wipes every item) gets pal's items back; `pal bar sync` does it at
//! once. A click runs `<pal> bar click <key> --anchor sketchybar` and
//! `mouse.entered` / `mouse.exited` run `<pal> bar hover <key> --anchor
//! sketchybar --state $SENDER` (absolute path: sketchybar's PATH is
//! launchd's). No popups, no per-row scripts: the popover is the one rich
//! surface.
//!
//! The builder ([`props`], [`diff`]) is pure, item to argv, and tested on
//! strings; [`Sketchybar`] runs what it builds and remembers what each
//! name was last set to, so an unchanged push costs nothing and `--add`
//! happens once per appearance.

use std::collections::BTreeMap;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{LazyLock, Mutex};

use tauri::{AppHandle, Manager};

use super::colors::Palette;
use super::{glyph, Bar, Draw, IconKind, Rect, Target, SKETCHYBAR_POLL};
use crate::{lock, settings};

/// Every name pal owns starts with this.
pub const PREFIX: &str = "pal.";
/// The progress rule's width in cells (the owner's timer rule).
const RULE_CELLS: usize = 8;

/// `pal.<ext>.<id>` for a key.
pub fn name_of(key: &str) -> String {
    format!("{PREFIX}{}", key.replace('/', "."))
}

/// The properties of one sketchybar item, by name.
pub type Props = BTreeMap<String, String>;
/// Every item drawn for one key: the main item first (a `BTreeMap` for
/// the diff, `order` for the `--move` chain).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Rendered {
    pub position: String,
    /// Names in strip order, the main item first.
    pub order: Vec<String>,
    pub props: BTreeMap<String, Props>,
}

/// `━━━───`: `cells` of heavy and light box drawing for `progress` 0..1.
pub fn rule(progress: f64, cells: usize) -> String {
    let filled = ((progress.clamp(0.0, 1.0) * cells as f64).round() as usize).min(cells);
    "━".repeat(filled) + &"─".repeat(cells - filled)
}

/// Shell-safe: the value goes through `Command`, not a shell, so nothing
/// needs quoting; only `=` in a key would break `k=v`, and keys are ours.
fn set(p: &mut Props, k: &str, v: impl Into<String>) {
    p.insert(k.to_string(), v.into());
}

/// The items for `key` as drawn: the model mapped to sketchybar's
/// properties (`docs/design/bar.md`, Mapping). `pal_bin` is the absolute
/// path the click and hover scripts run.
pub fn props(key: &str, draw: &Draw, palette: &Palette, pal_bin: &str) -> Rendered {
    let item = &draw.item;
    let main = name_of(key);
    let mut out = Rendered { position: draw.position.clone(), order: vec![main.clone()], props: BTreeMap::new() };
    let color = |name: Option<&str>| name.and_then(|n| palette.hex(n)).or_else(|| palette.hex("text")).unwrap_or_default();
    let item_color = color(item.color_name());
    let mut p = Props::new();
    set(&mut p, "drawing", if item.hidden { "off" } else { "on" });
    set(&mut p, "updates", "on");
    let icon = item.icon_kind();
    let mut icon_text = match &icon {
        Some(IconKind::Glyph(c)) => c.to_string(),
        Some(IconKind::Text(t)) => t.clone(),
        _ => String::new(),
    };
    if let Some(pr) = item.progress {
        icon_text = format!("{} {icon_text}", rule(pr, RULE_CELLS)).trim_end().to_string();
    }
    match &icon {
        Some(IconKind::Image { value, .. }) => {
            set(&mut p, "icon.drawing", "off");
            match glyph::image_file(value) {
                Some(file) => {
                    set(&mut p, "background.image", file.to_string_lossy());
                    set(&mut p, "background.image.drawing", "on");
                    set(&mut p, "background.image.scale", "0.5");
                }
                None => set(&mut p, "background.image.drawing", "off"),
            }
        }
        _ => {
            set(&mut p, "icon", icon_text.clone());
            set(&mut p, "icon.drawing", if icon_text.is_empty() { "off" } else { "on" });
            set(&mut p, "background.image.drawing", "off");
        }
    }
    set(&mut p, "icon.color", if item.dot() { palette.hex("red").unwrap_or_default() } else { item_color.clone() });
    let title = item.title.clone().unwrap_or_default();
    set(&mut p, "label", title.clone());
    set(&mut p, "label.drawing", if title.is_empty() { "off" } else { "on" });
    set(&mut p, "label.color", item_color.clone());
    let trailing = item.segments.is_empty() && item.count().is_none();
    // Icon only: the icon takes the label's right padding (the owner's `icon_only`).
    set(&mut p, "icon.padding_left", "8");
    set(&mut p, "icon.padding_right", if title.is_empty() && trailing { "8" } else { "4" });
    set(&mut p, "label.padding_left", "0");
    set(&mut p, "label.padding_right", if trailing { "8" } else { "2" });
    set(&mut p, "click_script", format!("{pal_bin} bar click {key} --anchor sketchybar"));
    set(&mut p, "script", if draw.hover { format!("{pal_bin} bar hover {key} --anchor sketchybar --state $SENDER") } else { String::new() });
    out.props.insert(main.clone(), p);
    let extras: Vec<(String, Option<String>, Option<String>, String)> = item
        .segments
        .iter()
        .map(|s| (format!("{main}.{}", s.id), s.icon.clone(), s.text.clone(), if item.stale { palette.hex("muted").unwrap_or_default() } else { color(s.color.as_deref().or(item.color_name())) }))
        .chain(item.count().map(|n| (format!("{main}.badge"), None, Some(n.to_string()), palette.hex("red").unwrap_or_default())))
        .collect();
    let last = extras.len().saturating_sub(1);
    for (i, (name, icon, text, col)) in extras.into_iter().enumerate() {
        let mut p = Props::new();
        set(&mut p, "drawing", if item.hidden { "off" } else { "on" });
        set(&mut p, "updates", "on");
        let icon = icon.unwrap_or_default();
        set(&mut p, "icon", icon.clone());
        set(&mut p, "icon.drawing", if icon.is_empty() { "off" } else { "on" });
        set(&mut p, "icon.color", col.clone());
        set(&mut p, "icon.padding_left", "4");
        set(&mut p, "icon.padding_right", "2");
        let text = text.unwrap_or_default();
        set(&mut p, "label", text.clone());
        set(&mut p, "label.drawing", if text.is_empty() { "off" } else { "on" });
        set(&mut p, "label.color", col);
        set(&mut p, "label.padding_left", "0");
        set(&mut p, "label.padding_right", if i == last { "8" } else { "2" });
        set(&mut p, "click_script", format!("{pal_bin} bar action {key} segment:{}", name.rsplit('.').next().unwrap_or_default()));
        out.order.push(name.clone());
        out.props.insert(name, p);
    }
    out
}

/// The `--add` position and the `--move` for a `before:<item>` /
/// `after:<item>` position: sketchybar adds at a side, then the item is
/// moved next to the reference.
fn placement(position: &str) -> (String, Option<(String, String)>) {
    match position.split_once(':') {
        Some((dir @ ("before" | "after"), reference)) if !reference.is_empty() => ("right".into(), Some((dir.into(), reference.into()))),
        _ => (if position.is_empty() { "right".into() } else { position.into() }, None),
    }
}

/// sketchybar's item list reads left to right for `left`/`center` items
/// and right to left for `right` ones (measured on hornet: two items added
/// `right`, the second moved `after` the first, drew to its left), so "the
/// next item along the strip" is `after` on the left and `before` on the
/// right. `rtl` says which side the items are on.
fn along(rtl: bool) -> &'static str {
    if rtl { "before" } else { "after" }
}

/// One batched argv from `prev` (what the bar has for this key) to
/// `next`: `--add` and `--subscribe` for a new name, `--set` with only
/// the changed properties for a known one, `--remove` for a gone one,
/// then `placed` (the `--move` that puts the main item among pal's others,
/// [`order_move`]) and the chain of `--move`s that keeps the extras behind
/// it (`rtl`: see [`along`]). Empty when nothing changed.
pub fn diff(prev: Option<&Rendered>, next: Option<&Rendered>, rtl: bool, placed: Option<&[String]>) -> Vec<String> {
    let mut argv: Vec<String> = Vec::new();
    let empty = Rendered::default();
    let (mut prev, next) = (prev.unwrap_or(&empty), next.unwrap_or(&empty));
    // A position is fixed at `--add`: a key that moved to another one is removed and added afresh.
    let moved = !prev.props.is_empty() && !next.props.is_empty() && prev.position != next.position;
    if moved {
        argv.extend(prev.props.keys().flat_map(|n| ["--remove".to_string(), n.clone()]));
        prev = &empty;
    }
    for name in prev.props.keys() {
        if !next.props.contains_key(name) {
            argv.extend(["--remove".into(), name.clone()]);
        }
    }
    let (side, reference) = placement(&next.position);
    let mut added = Vec::new();
    for name in &next.order {
        let Some(p) = next.props.get(name) else { continue };
        match prev.props.get(name) {
            None => {
                argv.extend(["--add".into(), "item".into(), name.clone(), side.clone()]);
                argv.push("--set".into());
                argv.push(name.clone());
                argv.extend(p.iter().map(|(k, v)| format!("{k}={v}")));
                argv.extend(["--subscribe".into(), name.clone(), "mouse.entered".into(), "mouse.exited".into()]);
                added.push(name.clone());
            }
            Some(old) => {
                let changed: Vec<String> = p.iter().filter(|(k, v)| old.get(*k) != Some(*v)).map(|(k, v)| format!("{k}={v}")).collect();
                if !changed.is_empty() {
                    argv.push("--set".into());
                    argv.push(name.clone());
                    argv.extend(changed);
                }
            }
        }
    }
    // Order: the main item next to its reference (a `before:`/`after:`
    // position, or `placed`), then each extra along the strip after the
    // one before it, so the whole chain moves together.
    if !added.is_empty() || moved || prev.order != next.order {
        if let (Some(main), Some((dir, r))) = (next.order.first(), &reference) {
            argv.extend(["--move".into(), main.clone(), dir.clone(), r.clone()]);
        }
        if let Some(p) = placed {
            argv.extend(p.iter().cloned());
        }
        for pair in next.order.windows(2) {
            argv.extend(["--move".into(), pair[1].clone(), along(rtl).into(), pair[0].clone()]);
        }
    }
    argv
}

/// The `--move` that puts a new key's main item among pal's other keys by
/// `order`, ascending along the strip: left of the first key with a
/// greater order, else right of the last with a smaller one; empty when
/// it is alone. `others` are the other keys' chains (names in strip
/// order) with their `order`. Left of a chain is before its first name on
/// the left side and after it on the right; right of a chain is after its
/// last name on the left side and before it on the right (`rtl`: see
/// [`along`]). The extras follow through [`diff`]'s chain.
pub fn order_move(name: &str, order: i64, others: &[(Vec<String>, i64)], rtl: bool) -> Vec<String> {
    let mut sorted: Vec<&(Vec<String>, i64)> = others.iter().filter(|(chain, _)| chain.first().is_some_and(|n| n != name)).collect();
    sorted.sort_by_key(|(_, o)| *o);
    if let Some((chain, _)) = sorted.iter().find(|(_, o)| *o > order) {
        let (dir, r) = (along(!rtl), &chain[0]);
        return vec!["--move".into(), name.into(), dir.into(), r.clone()];
    }
    match sorted.iter().rev().find(|(_, o)| *o <= order) {
        Some((chain, _)) => vec!["--move".into(), name.into(), along(rtl).into(), chain[chain.len() - 1].clone()],
        None => Vec::new(),
    }
}

/// Whether items at `position` sit on the right side (see [`along`]):
/// `right` does, `left`/`center`/`q`/`e` do not, `before:<x>`/`after:<x>`
/// follow `x`'s own position (`query`, a `--query` of it).
pub fn is_rtl(position: &str, query: impl Fn(&str) -> Option<String>) -> bool {
    match placement(position) {
        (_, Some((_, reference))) => query(&reference).as_deref() == Some("right"),
        (side, None) => side == "right",
    }
}

/// `--query <name>`'s `geometry.position`.
fn position_of(name: &str) -> Option<String> {
    let out = Command::new(bin()).args(["--query", name]).output().ok()?;
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    v["geometry"]["position"].as_str().map(str::to_string)
}

// ---- runtime -------------------------------------------------------------

struct State {
    drawn: BTreeMap<String, (Rendered, i64)>,
    /// `position` of the items other positions reference, as last queried.
    sides: BTreeMap<String, Option<String>>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State { drawn: BTreeMap::new(), sides: BTreeMap::new() }));

/// The `sketchybar` binary: on PATH, else where Homebrew puts it. pal
/// under launchd (the supervised instance, `autostart.rs`) has launchd's
/// PATH, which has neither `/opt/homebrew/bin` nor `/usr/local/bin`.
fn bin() -> &'static std::path::Path {
    static BIN: LazyLock<std::path::PathBuf> = LazyLock::new(|| {
        let on_path = std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join("sketchybar")).find(|b| b.is_file()));
        on_path.or_else(|| ["/opt/homebrew/bin/sketchybar", "/usr/local/bin/sketchybar"].iter().map(std::path::PathBuf::from).find(|b| b.is_file())).unwrap_or_else(|| "sketchybar".into())
    });
    &BIN
}

/// `sketchybar --query bar` exits 0: the bar is up.
pub fn detect() -> bool {
    Command::new(bin()).arg("--query").arg("bar").output().is_ok_and(|o| o.status.success())
}

fn run(argv: &[String]) -> Result<(), String> {
    if argv.is_empty() {
        return Ok(());
    }
    let out = Command::new(bin()).args(argv).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The path click scripts run: this executable.
fn pal_bin() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "pal".into())
}

pub fn install(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            probe(&handle).await;
            tokio::time::sleep(SKETCHYBAR_POLL).await;
        }
    });
}

/// One detection; a change re-syncs every item. A wiped bar (the rc
/// reloaded: our names gone from `--query bar`) is treated as gone then
/// back, so everything is re-added.
async fn probe(app: &AppHandle) {
    let wanted = {
        let c = settings::config(app);
        !matches!(c.bar.target, pal_core::config::BarTarget::Off | pal_core::config::BarTarget::Menubar) || c.bar.items.values().any(|i| matches!(i.target, Some(pal_core::config::BarTarget::Sketchybar | pal_core::config::BarTarget::Both)))
    };
    let alive = wanted && tauri::async_runtime::spawn_blocking(detect).await.unwrap_or(false);
    let st = app.state::<Bar>();
    let was = st.sketchybar.swap(alive, Ordering::Relaxed);
    let wiped = alive && was && {
        let names = tauri::async_runtime::spawn_blocking(bar_items).await.unwrap_or_default();
        lock(&STATE).drawn.values().any(|(r, _)| r.order.first().is_some_and(|n| !names.contains(n)))
    };
    if alive != was {
        eprintln!("bar\tsketchybar\t{}", if alive { "up" } else { "gone" });
    }
    if !alive {
        let mut st = lock(&STATE);
        st.drawn.clear();
        st.sides.clear();
    }
    if wiped {
        eprintln!("bar\tsketchybar\twiped; re-adding");
        lock(&STATE).drawn.clear();
    }
    if alive != was || wiped {
        super::sync_all(app);
    }
}

/// `pal bar sync`: probe now and re-apply.
pub fn resync(app: &AppHandle) {
    lock(&STATE).drawn.clear();
    let app = app.clone();
    tauri::async_runtime::spawn(async move { probe(&app).await });
}

/// The bar's item names (`--query bar`).
fn bar_items() -> Vec<String> {
    let Ok(out) = Command::new(bin()).args(["--query", "bar"]).output() else { return Vec::new() };
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
    v["items"].as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// The item's `bounding_rects` (`--query <name>`): the first display's, in
/// screen points.
pub fn anchor_of(name: &str) -> Option<Rect> {
    let out = match Command::new(bin()).args(["--query", name]).output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("bar\tsketchybar\tquery {name} failed\t{e}");
            return None;
        }
    };
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let rects = v["bounding_rects"].as_object()?;
    let r = rects.values().next()?;
    let (o, s) = (r["origin"].as_array()?, r["size"].as_array()?);
    Some(Rect { x: o.first()?.as_f64()?, y: o.get(1)?.as_f64()?, w: s.first()?.as_f64()?, h: s.get(1)?.as_f64()? })
}

fn palette(app: &AppHandle) -> Palette {
    let c = settings::config(app);
    Palette::new(super::menubar::dark(app), &c.bar.sketchybar.colors)
}

pub struct Sketchybar;

impl Target for Sketchybar {
    fn apply(&self, app: &AppHandle, key: &str, draw: Option<&Draw>) {
        if !super::sketchybar_alive(app) {
            return;
        }
        let Some(draw) = draw else { return self.remove(app, key) };
        let next = props(key, draw, &palette(app), &pal_bin());
        let mut st = lock(&STATE);
        if let (_, Some((_, reference))) = placement(&next.position) {
            st.sides.entry(reference.clone()).or_insert_with(|| position_of(&reference));
        }
        let rtl = is_rtl(&next.position, |r| st.sides.get(r).cloned().flatten());
        let prev = st.drawn.get(key).map(|(r, _)| r.clone());
        // A first appearance, or a key re-added at another position: placed by `order` among pal's keys already there.
        let placed = prev.as_ref().is_none_or(|p| p.position != next.position).then(|| {
            let others: Vec<(Vec<String>, i64)> = st.drawn.iter().filter(|(_, (r, _))| r.position == next.position).map(|(_, (r, o))| (r.order.clone(), *o)).collect();
            order_move(&next.order[0], draw.order, &others, rtl)
        });
        let argv = diff(prev.as_ref(), Some(&next), rtl, placed.as_deref());
        match run(&argv) {
            Ok(()) => {
                if !argv.is_empty() {
                    eprintln!("bar\tsketchybar\t{key}\t{} args", argv.len());
                }
                st.drawn.insert(key.to_string(), (next, draw.order));
            }
            Err(e) => eprintln!("bar\tsketchybar\t{key}\tfailed\t{e}"),
        }
    }

    fn remove(&self, _app: &AppHandle, key: &str) {
        let prev = lock(&STATE).drawn.remove(key);
        if let Some((r, _)) = prev {
            let argv = diff(Some(&r), None, false, None);
            if let Err(e) = run(&argv) {
                eprintln!("bar\tsketchybar\t{key}\tremove failed\t{e}");
            }
        }
    }

    fn remove_all(&self, app: &AppHandle) {
        if !super::sketchybar_alive(app) {
            return;
        }
        let mut st = lock(&STATE);
        st.drawn.clear();
        st.sides.clear();
        drop(st);
        // Everything under the prefix, ours from this run or a crashed one.
        if let Err(e) = run(&["--remove".into(), format!("/{}.*/", PREFIX.replace('.', "\\."))]) {
            eprintln!("bar\tsketchybar\tremove all failed\t{e}");
        }
    }

    fn anchor(&self, _app: &AppHandle, key: &str) -> Option<Rect> {
        anchor_of(&name_of(key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::BarItem;
    use serde_json::json;

    fn draw(item: serde_json::Value, position: &str, hover: bool) -> Draw {
        Draw { item: serde_json::from_value::<BarItem>(item).unwrap(), order: 0, position: position.into(), hover }
    }

    fn pal() -> Palette {
        Palette::new(true, &BTreeMap::new())
    }

    #[test]
    fn names_and_rule() {
        assert_eq!(name_of("github/prs"), "pal.github.prs");
        assert_eq!(rule(0.5, 8), "━━━━────");
        assert_eq!(rule(1.2, 8), "━━━━━━━━");
        assert_eq!(rule(-1.0, 4), "────");
        assert_eq!(placement("before:clock"), ("right".into(), Some(("before".into(), "clock".into()))));
        assert_eq!(placement("left"), ("left".into(), None));
        assert_eq!(placement(""), ("right".into(), None));
    }

    #[test]
    fn props_map_the_model() {
        let d = draw(json!({ "icon": "\u{f09b}", "badge": 3, "color": "green", "progress": 0.5, "menu": [] }), "right", true);
        let r = props("github/prs", &d, &pal(), "/Applications/pal.app/Contents/MacOS/pal");
        assert_eq!(r.order, ["pal.github.prs", "pal.github.prs.badge"]);
        let m = &r.props["pal.github.prs"];
        assert_eq!(m["drawing"], "on");
        assert_eq!(m["icon"], "━━━━──── \u{f09b}", "the rule before the glyph");
        assert_eq!(m["icon.color"], "0xff5ccb8e");
        assert_eq!(m["label.drawing"], "off", "no title: no label");
        assert_eq!(m["icon.padding_right"], "4", "a badge follows, so no trailing padding");
        assert_eq!(m["click_script"], "/Applications/pal.app/Contents/MacOS/pal bar click github/prs --anchor sketchybar");
        assert!(m["script"].ends_with("bar hover github/prs --anchor sketchybar --state $SENDER"));
        let b = &r.props["pal.github.prs.badge"];
        assert_eq!((b["label"].as_str(), b["label.color"].as_str(), b["icon.drawing"].as_str()), ("3", "0xffff8a82", "off"));
        // Hidden: drawing off everywhere, the item stays.
        let h = props("x/y", &draw(json!({ "hidden": true, "segments": [{ "id": "a", "text": "1" }] }), "left", false), &pal(), "pal");
        assert!(h.props.values().all(|p| p["drawing"] == "off"));
        assert_eq!(h.props["pal.x.y"]["script"], "", "no hover script when the item does not peek");
        // Segments: one item each, own colour, stale mutes all.
        let s = props("x/y", &draw(json!({ "icon": "\u{f062c}", "color": "muted", "segments": [{ "id": "block", "icon": "\u{f0159}", "text": "2", "color": "red" }, { "id": "sep", "text": "│", "color": "muted" }, { "id": "oss", "text": "1" }] }), "right", false), &pal(), "pal");
        assert_eq!(s.order, ["pal.x.y", "pal.x.y.block", "pal.x.y.sep", "pal.x.y.oss"]);
        assert_eq!(s.props["pal.x.y.block"]["icon.color"], "0xffff8a82");
        assert_eq!(s.props["pal.x.y.oss"]["label.color"], "0xffa3a4ae", "a segment without a colour takes the item's");
        assert_eq!(s.props["pal.x.y.oss"]["label.padding_right"], "8", "the last one carries the trailing padding");
        assert_eq!(s.props["pal.x.y.block"]["click_script"], "pal bar action x/y segment:block");
        let st = props("x/y", &draw(json!({ "stale": true, "segments": [{ "id": "a", "text": "1", "color": "red" }] }), "right", false), &pal(), "pal");
        assert_eq!(st.props["pal.x.y.a"]["label.color"], "0xffa3a4ae", "stale mutes the segments too");
        assert_eq!(st.props["pal.x.y"]["label.color"], "0xffa3a4ae");
        // Urgent, dot, emoji, title only.
        let u = props("x/y", &draw(json!({ "icon": "🔔", "title": "Ring", "urgent": true, "badge": "dot" }), "right", false), &pal(), "pal");
        let m = &u.props["pal.x.y"];
        assert_eq!((m["icon"].as_str(), m["icon.color"].as_str(), m["label.color"].as_str()), ("🔔", "0xffff8a82", "0xffff6e66"));
        assert_eq!((m["label"].as_str(), m["label.padding_right"].as_str()), ("Ring", "8"));
        let t = props("x/y", &draw(json!({ "title": "12:00" }), "right", false), &pal(), "pal");
        assert_eq!(t.props["pal.x.y"]["icon.drawing"], "off");
    }

    #[test]
    fn diff_adds_once_sets_only_changes_and_removes_the_gone() {
        let a = props("x/y", &draw(json!({ "icon": "\u{f09b}", "title": "1", "segments": [{ "id": "s", "text": "a" }] }), "before:clock", false), &pal(), "pal");
        let first = diff(None, Some(&a), false, None);
        let s = first.join(" ");
        assert!(s.starts_with("--add item pal.x.y right --set pal.x.y "), "{s}");
        assert!(s.contains("--subscribe pal.x.y mouse.entered mouse.exited"));
        assert!(s.contains("--add item pal.x.y.s right --set pal.x.y.s "));
        assert!(s.contains("--move pal.x.y before clock"), "placed next to the reference");
        assert!(s.ends_with("--move pal.x.y.s after pal.x.y"), "the segment follows the main item: {s}");
        assert!(diff(None, Some(&a), true, None).join(" ").ends_with("--move pal.x.y.s before pal.x.y"), "on the right side the list runs right to left");
        let placed = diff(None, Some(&a), true, Some(&["--move".to_string(), "pal.x.y".into(), "after".into(), "pal.o".into()])).join(" ");
        assert!(placed.ends_with("--move pal.x.y before clock --move pal.x.y after pal.o --move pal.x.y.s before pal.x.y"), "the order move comes before the chain, so the extras follow: {placed}");
        assert!(first.iter().all(|a| !a.contains(' ') || a.starts_with("click_script=") || a.starts_with("script=") || a.starts_with("icon=") || a.starts_with("label=")), "one argv element per property");
        assert!(diff(Some(&a), Some(&a), false, None).is_empty(), "an identical push touches nothing");
        let b = props("x/y", &draw(json!({ "icon": "\u{f09b}", "title": "2", "segments": [{ "id": "s", "text": "a" }] }), "before:clock", false), &pal(), "pal");
        assert_eq!(diff(Some(&a), Some(&b), false, None), ["--set", "pal.x.y", "label=2"], "only what changed");
        let c = props("x/y", &draw(json!({ "icon": "\u{f09b}", "title": "2" }), "before:clock", false), &pal(), "pal");
        let d = diff(Some(&b), Some(&c), false, None);
        assert!(d.starts_with(&["--remove".to_string(), "pal.x.y.s".into()]), "{d:?}");
        assert!(d.contains(&"label.padding_right=8".to_string()), "the trailing padding moves to the main item: {d:?}");
        assert_eq!(diff(Some(&c), None, false, None), ["--remove", "pal.x.y"]);
        assert!(diff(None, None, false, None).is_empty());
        let hidden = props("x/y", &draw(json!({ "hidden": true }), "before:clock", false), &pal(), "pal");
        let dh = diff(Some(&c), Some(&hidden), false, None);
        assert!(dh.contains(&"drawing=off".to_string()) && !dh.contains(&"--remove".to_string()), "hidden is drawing=off, not a removal: the item comes back cheaply");
        let left = props("x/y", &draw(json!({ "icon": "\u{f09b}", "title": "2" }), "left", false), &pal(), "pal");
        let dm = diff(Some(&c), Some(&left), false, None).join(" ");
        assert!(dm.starts_with("--remove pal.x.y --add item pal.x.y left "), "another position: removed and added there: {dm}");
    }

    #[test]
    fn order_move_places_among_pals_items() {
        let mv = |v: Vec<&str>| v.into_iter().map(String::from).collect::<Vec<_>>();
        // a (10) is `pal.a` with a badge, c (30) is `pal.c` alone; chains in strip order.
        let others = vec![(mv(vec!["pal.a", "pal.a.badge"]), 10), (mv(vec!["pal.c"]), 30)];
        // Left side (list runs left to right): left of c is before c; right of a is after a's last extra.
        assert_eq!(order_move("pal.b", 20, &others, false), mv(vec!["--move", "pal.b", "before", "pal.c"]));
        assert_eq!(order_move("pal.d", 40, &others, false), mv(vec!["--move", "pal.d", "after", "pal.c"]));
        assert_eq!(order_move("pal.z", 5, &others, false), mv(vec!["--move", "pal.z", "before", "pal.a"]));
        let only_a = vec![others[0].clone()];
        assert_eq!(order_move("pal.b", 10, &only_a, false), mv(vec!["--move", "pal.b", "after", "pal.a.badge"]), "an equal order goes right of the whole chain");
        // Right side (list runs right to left): left of c is after c; right of a is before a's last extra, which is a's first in the list.
        assert_eq!(order_move("pal.b", 20, &others, true), mv(vec!["--move", "pal.b", "after", "pal.c"]));
        assert_eq!(order_move("pal.d", 40, &others, true), mv(vec!["--move", "pal.d", "before", "pal.c"]));
        assert_eq!(order_move("pal.b", 10, &only_a, true), mv(vec!["--move", "pal.b", "before", "pal.a.badge"]), "the badge stays with its item");
        assert_eq!(order_move("pal.a", 10, &others, false), mv(vec!["--move", "pal.a", "before", "pal.c"]), "itself is left out of the others");
        assert!(order_move("pal.a", 10, &[(mv(vec!["pal.a"]), 10)], false).is_empty(), "alone");
        assert!(order_move("pal.x", 0, &[], false).is_empty());
        assert!(is_rtl("right", |_| None));
        assert!(!is_rtl("left", |_| None) && !is_rtl("center", |_| None));
        assert!(is_rtl("", |_| None), "no position is the right side");
        assert!(is_rtl("before:clock", |r| (r == "clock").then(|| "right".to_string())), "a reference on the right side");
        assert!(!is_rtl("after:apple", |_| Some("left".into())));
        assert!(!is_rtl("after:gone", |_| None), "an unknown reference reads as the left side");
    }
}
