//! Live views (docs/extensions.md, "Live views"): which view level each
//! window has on top, so an extension's push (`core/view.update`, and
//! `core/view.post` for a game surface's page) reaches
//! the page that draws it and the extension hears when to start and stop
//! pushing (`view/shown`, `view/hidden` to the host).
//!
//! The page reports its top view level through `view_open` whenever it
//! changes (a push, a pop, a level covered, the tree landing); the shell
//! reports whether the window is visible (`set_visible` from the panel's,
//! the popover's and the sidebar's show and hide). A view counts as open only while
//! both hold, and the notifications fire on the transitions of that set:
//! a hidden panel keeps its level, but nothing should tick for it. A push
//! goes to every window whose open view it names, as a `pal://view` event
//! the page applies in place; with none it is dropped and logged once
//! per target until the next one that lands.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::host::Host;
use crate::{events, lock};

/// A view level as the page names it: a view palette's (`palette`), or a
/// bar item's own `{ view }` popover level (`bar`, the item's id); `id` is
/// the `View.id` the tree carries (`view` when it sets none).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Open {
    pub extension: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub palette: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bar: Option<String>,
    pub id: String,
}

impl Open {
    /// Whether an update addressed to `extension`/`palette`-or-`bar` (and `id`, when given) is for this level.
    fn takes(&self, extension: &str, palette: Option<&str>, bar: Option<&str>, id: Option<&str>) -> bool {
        self.extension == extension && self.palette.as_deref() == palette && self.bar.as_deref() == bar && id.is_none_or(|i| i == self.id)
    }
}

/// One window's state: what its page reported last, and whether the shell shows it.
#[derive(Default, Debug)]
struct Slot {
    open: Option<Open>,
    visible: bool,
}

/// What the page and the shell tell about every window, and the open set
/// as of the last change; pure, so the transitions are testable.
#[derive(Default, Debug)]
pub struct Table {
    slots: BTreeMap<String, Slot>,
    /// `(open, compact)`: the views open somewhere as of the last change.
    effective: BTreeSet<(Open, bool)>,
    /// Targets a push was dropped for since it last landed: one log line each.
    dropped: BTreeSet<String>,
}

/// A change of the open set: `shown` true for a view that came open, false for one that closed.
#[derive(Debug, PartialEq, Eq)]
pub struct Change {
    pub open: Open,
    pub compact: bool,
    pub shown: bool,
}

impl Table {
    /// The page of `window` has `open` on top (or none); the transitions this makes.
    pub fn report(&mut self, window: &str, open: Option<Open>) -> Vec<Change> {
        self.slots.entry(window.to_string()).or_default().open = open;
        self.settle()
    }

    /// The shell shows or hides `window`; `clear` forgets what its page
    /// reported (the page is about to start over and report anew: a
    /// panel show that resets to the root, a popover opening on an item).
    pub fn set_visible(&mut self, window: &str, visible: bool, clear: bool) -> Vec<Change> {
        let slot = self.slots.entry(window.to_string()).or_default();
        slot.visible = visible;
        if clear {
            slot.open = None;
        }
        self.settle()
    }

    /// The windows a push for `extension`/`palette`-or-`bar` (and `id`) should reach: the visible ones with that level on top.
    pub fn targets(&self, extension: &str, palette: Option<&str>, bar: Option<&str>, id: Option<&str>) -> Vec<String> {
        self.slots.iter().filter(|(_, s)| s.visible && s.open.as_ref().is_some_and(|o| o.takes(extension, palette, bar, id))).map(|(w, _)| w.clone()).collect()
    }

    /// The windows whose page has `open` on top, shown or not, of the `compact` kind.
    pub fn holding(&self, open: &Open, compact: bool) -> Vec<String> {
        self.slots.iter().filter(|(w, s)| s.open.as_ref() == Some(open) && is_compact(w) == compact).map(|(w, _)| w.clone()).collect()
    }

    /// Whether a drop for `target` is the first since a push landed there (worth a log line).
    pub fn note_drop(&mut self, target: &str) -> bool {
        self.dropped.insert(target.to_string())
    }

    pub fn note_landed(&mut self, target: &str) {
        self.dropped.remove(target);
    }

    /// Every open view of `extension`, for the host after a reload.
    pub fn open_of(&self, extension: &str) -> Vec<(Open, bool)> {
        self.effective.iter().filter(|(o, _)| o.extension == extension).cloned().collect()
    }

    fn settle(&mut self) -> Vec<Change> {
        let now: BTreeSet<(Open, bool)> = self.slots.iter().filter(|(_, s)| s.visible).filter_map(|(w, s)| s.open.clone().map(|o| (o, is_compact(w)))).collect();
        let mut changes: Vec<Change> = self.effective.difference(&now).map(|(o, c)| Change { open: o.clone(), compact: *c, shown: false }).collect();
        changes.extend(now.difference(&self.effective).map(|(o, c)| Change { open: o.clone(), compact: *c, shown: true }));
        self.effective = now;
        changes
    }
}

/// The bar popover (420 px, bar/popover.rs) and the sidebar (320 by
/// default, sidebar.rs) are the compact surfaces.
pub(crate) fn is_compact(window: &str) -> bool {
    window == crate::bar::popover::WINDOW || window == crate::sidebar::WINDOW
}

pub struct Views(Mutex<Table>);

pub fn install(app: &AppHandle) {
    app.manage(Views(Mutex::new(Table::default())));
}

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Table) -> T) -> T {
    let st = app.state::<Views>();
    let mut t = lock(&st.0);
    f(&mut t)
}

fn shown_params(open: &Open, compact: bool) -> Value {
    let mut v = serde_json::to_value(open).unwrap_or(Value::Null);
    if compact {
        v["compact"] = Value::Bool(true);
    }
    v
}

/// The changes as `view/shown` / `view/hidden` notifications to the host,
/// and a log line each; the windows still holding the level (hidden with
/// the window, not popped) hear it too, as `pal://view` with `shown`, for
/// a surface's page (`pal.onShown`/`pal.onHidden`).
fn announce(app: &AppHandle, changes: Vec<Change>) {
    if changes.is_empty() {
        return;
    }
    let host = app.try_state::<Arc<Host>>().map(|h| h.inner().clone());
    for c in changes {
        let target = c.open.palette.clone().or_else(|| c.open.bar.as_ref().map(|b| format!("bar:{b}"))).unwrap_or_default();
        eprintln!("view\t{}/{target}\t{}\t{}{}", c.open.extension, c.open.id, if c.shown { "shown" } else { "hidden" }, if c.compact { "\tcompact" } else { "" });
        for w in with(app, |t| t.holding(&c.open, c.compact)) {
            events::emit_to(app, &w, events::VIEW, json!({ "extension": c.open.extension, "palette": c.open.palette, "bar": c.open.bar, "id": c.open.id, "shown": c.shown }));
        }
        let Some(host) = host.clone() else { continue };
        let method = if c.shown { "view/shown" } else { "view/hidden" };
        let params = shown_params(&c.open, c.compact);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = host.notify(method, params).await {
                eprintln!("view\t{method} notify failed\t{e}");
            }
        });
    }
}

/// The page of `window` reports its top view level, or none.
#[tauri::command]
pub fn view_open(app: AppHandle, window: tauri::Window, open: Option<Open>) {
    let changes = with(&app, |t| t.report(window.label(), open));
    announce(&app, changes);
}

/// The shell shows or hides `window` (lib.rs, bar/popover.rs); `clear` when the page starts over.
pub fn set_visible(app: &AppHandle, window: &str, visible: bool, clear: bool) {
    let changes = with(app, |t| t.set_visible(window, visible, clear));
    announce(app, changes);
}

/// The host loaded (or reloaded) `extension`: the new module hears about the levels already open.
pub fn resend(app: &AppHandle, extension: &str) {
    let open = with(app, |t| t.open_of(extension));
    announce(app, open.into_iter().map(|(open, compact)| Change { open, compact, shown: true }).collect());
}

/// `core/view.update {extension, palette | bar, id?, spec}` from the host (bridge.rs):
/// to every window showing that level, else dropped. `core/view.post
/// {..., msg}` likewise, for the page of the level's `surface` node.
pub fn call(app: &AppHandle, func: &str, params: Value) -> Result<Value, String> {
    // The page reads a push as `spec` (a tree to draw) or `post` (a message for the surface).
    let (what, from) = match func {
        "update" if params["spec"].get("tree").is_none() => return Err("view.update: spec has no tree".into()),
        "update" => ("spec", "spec"),
        "post" if !params["msg"].is_object() => return Err("view.post: no msg".into()),
        "post" => ("post", "msg"),
        _ => return Err(format!("unknown view function {func}")),
    };
    let ext = params["extension"].as_str().ok_or_else(|| format!("view.{func}: no extension"))?;
    let (palette, bar) = (params["palette"].as_str(), params["bar"].as_str());
    if palette.is_none() == bar.is_none() {
        return Err(format!("view.{func}: one of palette or bar"));
    }
    let id = params["id"].as_str();
    let target = format!("{ext}/{}{}", palette.unwrap_or(""), bar.map(|b| format!("bar:{b}")).unwrap_or_default());
    let windows = with(app, |t| {
        let w = t.targets(ext, palette, bar, id);
        if w.is_empty() {
            if t.note_drop(&target) {
                eprintln!("view\t{target}\t{func} dropped\tno such view open (logged once until one is)");
            }
        } else {
            t.note_landed(&target);
        }
        w
    });
    // `PAL_VIEW_TRACE`: the page logs what the update cost in DOM terms (core.ts).
    let trace = std::env::var_os("PAL_VIEW_TRACE").is_some_and(|v| !v.is_empty());
    for w in windows {
        events::emit_to(app, &w, events::VIEW, json!({ "extension": ext, "palette": palette, "bar": bar, "id": id, (what): params[from], "trace": trace }));
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(palette: &str, id: &str) -> Open {
        Open { extension: "ext".into(), palette: Some(palette.into()), bar: None, id: id.into() }
    }

    #[test]
    fn a_view_is_open_only_while_reported_and_visible() {
        let mut t = Table::default();
        // Reported while hidden: nothing is open, nothing is announced.
        assert_eq!(t.report("main", Some(open("lyrics", "view"))), vec![]);
        assert!(t.targets("ext", Some("lyrics"), None, None).is_empty());
        // The panel shows with the level kept: shown.
        let c = t.set_visible("main", true, false);
        assert_eq!(c, vec![Change { open: open("lyrics", "view"), compact: false, shown: true }]);
        assert_eq!(t.targets("ext", Some("lyrics"), None, None), vec!["main".to_string()]);
        // An id narrows; another palette or a bar target is not it.
        assert_eq!(t.targets("ext", Some("lyrics"), None, Some("view")), vec!["main".to_string()]);
        assert!(t.targets("ext", Some("lyrics"), None, Some("other")).is_empty());
        assert!(t.targets("ext", Some("queue"), None, None).is_empty());
        assert!(t.targets("ext", None, Some("lyrics"), None).is_empty());
        // Covered by a palette level: hidden; back on top: shown again.
        assert_eq!(t.report("main", None), vec![Change { open: open("lyrics", "view"), compact: false, shown: false }]);
        assert!(t.targets("ext", Some("lyrics"), None, None).is_empty());
        assert_eq!(t.report("main", Some(open("lyrics", "view"))).len(), 1);
        // The panel hides: hidden, the level still remembered; shown again on the next show.
        assert_eq!(t.set_visible("main", false, false), vec![Change { open: open("lyrics", "view"), compact: false, shown: false }]);
        assert!(t.targets("ext", Some("lyrics"), None, None).is_empty());
        assert_eq!(t.set_visible("main", true, false).len(), 1);
        // A show that resets the page forgets the level: nothing shown until the page reports anew.
        assert_eq!(t.set_visible("main", false, false).len(), 1);
        assert_eq!(t.set_visible("main", true, true), vec![]);
        assert!(t.targets("ext", Some("lyrics"), None, None).is_empty());
    }

    #[test]
    fn one_level_in_two_windows_is_shown_once_per_window_and_the_popover_is_compact() {
        let mut t = Table::default();
        t.set_visible("main", true, false);
        t.set_visible("bar", true, false);
        assert_eq!(t.report("main", Some(open("light", "light:lamp"))), vec![Change { open: open("light", "light:lamp"), compact: false, shown: true }]);
        assert_eq!(t.report("bar", Some(open("light", "light:lamp"))), vec![Change { open: open("light", "light:lamp"), compact: true, shown: true }]);
        let mut w = t.targets("ext", Some("light"), None, Some("light:lamp"));
        w.sort();
        assert_eq!(w, vec!["bar".to_string(), "main".to_string()]);
        assert_eq!(t.open_of("ext").len(), 2);
        assert_eq!(t.report("bar", None), vec![Change { open: open("light", "light:lamp"), compact: true, shown: false }]);
        assert_eq!(t.targets("ext", Some("light"), None, None), vec!["main".to_string()]);
        // A bar item's own popover level is addressed by `bar`.
        let popover = Open { extension: "spotify".into(), palette: None, bar: Some("playing".into()), id: "view".into() };
        assert_eq!(t.report("bar", Some(popover.clone())), vec![Change { open: popover.clone(), compact: true, shown: true }]);
        assert_eq!(t.targets("spotify", None, Some("playing"), None), vec!["bar".to_string()]);
        assert!(t.targets("spotify", Some("playing"), None, None).is_empty());
    }

    #[test]
    fn a_hidden_window_still_holds_its_level_a_popped_one_does_not() {
        let mut t = Table::default();
        t.set_visible("main", true, false);
        t.report("main", Some(open("snake", "view")));
        assert_eq!(t.holding(&open("snake", "view"), false), vec!["main".to_string()]);
        assert!(t.holding(&open("snake", "view"), true).is_empty(), "not the compact kind");
        // Hidden with the window: the page still has it (its surface hears `hidden`).
        t.set_visible("main", false, false);
        assert_eq!(t.holding(&open("snake", "view"), false), vec!["main".to_string()]);
        // Popped: nothing holds it.
        t.report("main", None);
        assert!(t.holding(&open("snake", "view"), false).is_empty());
    }

    #[test]
    fn a_drop_is_logged_once_until_a_push_lands() {
        let mut t = Table::default();
        assert!(t.note_drop("ext/lyrics"));
        assert!(!t.note_drop("ext/lyrics"));
        t.note_landed("ext/lyrics");
        assert!(t.note_drop("ext/lyrics"));
    }

    #[test]
    fn shown_params_carry_compact_only_when_set() {
        let o = Open { extension: "e".into(), palette: None, bar: Some("b".into()), id: "view".into() };
        assert_eq!(shown_params(&o, true), json!({ "extension": "e", "bar": "b", "id": "view", "compact": true }));
        assert_eq!(shown_params(&open("p", "i"), false), json!({ "extension": "ext", "palette": "p", "id": "i" }));
    }
}
