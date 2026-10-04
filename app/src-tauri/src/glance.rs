//! The glance strip (`general.glance`, a design's empty root: Launcher
//! `glance`): what the chosen bar items say right now, as up to four cards
//! over the root, so the next meeting, the track playing or the unread
//! count is there before anything is typed. The cards are the items' last
//! renders (`bar::entry`), not a second render; an item hidden right now
//! (nothing playing) has no card. A card's Enter is the item's own click:
//! the panel steps aside and the item's popover opens under the bar. A
//! card's own lines (`BarItem.glance.lines`) are ways in of their own: a
//! click runs the line's action, opened as a click on an item without a
//! menu would be. An item can live here alone (`ManifestBar.strip:
//! false`): it renders while a card shows it (`bar::renders`).

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::registry::Palettes;
use crate::{bar, panel, settings};

/// The most cards the strip holds: one row at the panel's width.
pub const MAX: usize = 4;

/// One card: whose it is (`label`: the extension's title, "Gmail", the item's own name when there is none to find) and what it says.
#[derive(Debug, Clone, Serialize)]
pub struct Card {
    pub key: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub urgent: bool,
    /// The item's `progress` (0..1): a thin bar along the card's foot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    /// The item's `glance.lines`, under its text; `glance_open` with a line's index runs its action.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<bar::GlanceLine>,
}

/// The cards for the configured items, in the configured order: enabled, rendered, not hidden.
#[tauri::command]
pub fn glance_items(app: AppHandle) -> Vec<Card> {
    let config = settings::config(&app);
    config
        .general
        .glance
        .iter()
        .filter(|k| config.bar.item(k).enabled)
        .filter_map(|k| {
            let e = bar::entry(&app, k)?;
            let i = e.last?;
            if i.hidden {
                return None;
            }
            let count = i.count();
            let ext = k.split('/').next().unwrap_or_default();
            let label = Palettes::with(&app, |reg| reg.iter().find(|r| r.source.extension == ext).map(|r| r.ext_title.clone())).unwrap_or(e.manifest.title);
            let lines = i.glance.map(|g| g.lines).unwrap_or_default();
            Some(Card { key: k.clone(), label, title: i.title, count, tooltip: i.tooltip, icon: i.icon, color: i.color, urgent: i.urgent, progress: i.progress, lines })
        })
        .take(MAX)
        .collect()
}

/// A card's Enter or click: the panel hides and the item is clicked, as on
/// the bar. With `line`: that line's action instead, its Effect opened the
/// way a click on an item without a menu opens one (`bar::open_action`).
#[tauri::command]
pub fn glance_open(app: AppHandle, key: String, line: Option<usize>) {
    let action = line.and_then(|n| bar::entry(&app, &key)?.last?.glance?.lines.into_iter().nth(n)?.action);
    panel::hide(&app);
    match action {
        Some(action) => {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = bar::open_action(&app, &key, &action, "panel").await {
                    eprintln!("glance\t{key}\t{action}\tfailed\t{e}");
                }
            });
        }
        None => bar::popover::on_click(&app, &key, None, "panel"),
    }
}
