//! The `web` target (docs/design/remote.md, "The bar in a browser"): the
//! strip a remote page draws with `BarStrip`. It keeps what it draws per
//! key; a change sends the whole strip (`pal://bar/strip`) once a burst has
//! settled, and `bar_web_items` answers the same for a page that just
//! loaded. It draws while a page is connected, on every platform.

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::{Bar, BarItem, Draw, Rect, Target};
use crate::remote::Caller;
use crate::{events, lock};

/// Changes within this window go out as one strip.
const SETTLE: Duration = Duration::from_millis(30);

pub struct Web;

impl Target for Web {
    fn apply(&self, app: &AppHandle, key: &str, draw: Option<&Draw>) {
        let st = app.state::<Bar>();
        let changed = {
            let mut drawn = lock(&st.web);
            match draw {
                Some(d) => drawn.insert(key.to_string(), d.clone()).as_ref() != Some(d),
                None => drawn.remove(key).is_some(),
            }
        };
        if changed {
            send_soon(app);
        }
    }

    fn remove(&self, app: &AppHandle, key: &str) {
        self.apply(app, key, None);
    }

    fn remove_all(&self, app: &AppHandle) {
        let had = !std::mem::take(&mut *lock(&app.state::<Bar>().web)).is_empty();
        if had {
            send_soon(app);
        }
    }

    fn anchor(&self, _app: &AppHandle, _key: &str) -> Option<Rect> {
        None
    }
}

fn send_soon(app: &AppHandle) {
    if app.state::<Bar>().web_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        app.state::<Bar>().web_pending.store(false, Ordering::SeqCst);
        events::emit(&app, events::BAR_STRIP, current(&app));
    });
}

/// What `bar_web_items` and `pal://bar/strip` carry: the items that take a
/// slot, and every registered item by key and title (`all`, those hidden by
/// their rules included), for a page that lets someone pick what shows.
#[derive(Debug, Clone, Serialize)]
pub struct Strip {
    pub items: Vec<StripItem>,
    pub all: Vec<Named>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Named {
    pub key: String,
    pub title: String,
}

/// One item on the strip: the item as `BarStrip` reads it (`BarStripItem`,
/// the look already applied, the popover's parts left out: a tap asks
/// `bar_web_open`), and the resolved look in the page's spelling (`BarLook`
/// in BarStrip.tsx).
#[derive(Debug, Clone, Serialize)]
pub struct StripItem {
    pub key: String,
    pub item: BarItem,
    pub look: Value,
    pub position: String,
}

/// The strip from what the target holds: the items that take a slot, by
/// `order` then key.
pub fn strip(drawn: &BTreeMap<String, Draw>) -> Strip {
    let mut items: Vec<(&String, &Draw)> = drawn.iter().filter(|(_, d)| !d.item.hidden).collect();
    items.sort_by_key(|(k, d)| (d.order, k.as_str()));
    let items = items
        .into_iter()
        .map(|(key, d)| StripItem {
            key: key.clone(),
            item: BarItem { menu: None, empty: None, glance: None, scroll: None, click: None, refresh: None, states: BTreeMap::new(), ..d.item.clone() },
            look: camel(serde_json::to_value(&d.look).unwrap_or(Value::Null)),
            position: d.position.clone(),
        })
        .collect();
    Strip { items, all: Vec::new() }
}

fn current(app: &AppHandle) -> Strip {
    let mut s = strip(&lock(&app.state::<Bar>().web));
    s.all = super::snapshot(app).into_iter().map(|(key, _)| Named { title: super::popover::title_of(app, &key), key }).collect();
    s
}

/// `BarLook`'s file keys (`icon_size`) as the page's (`iconSize`).
fn camel(v: Value) -> Value {
    let Value::Object(o) = v else { return v };
    let key = |k: String| {
        let mut out = String::with_capacity(k.len());
        let mut up = false;
        for c in k.chars() {
            if c == '_' {
                up = true;
            } else if up {
                out.extend(c.to_uppercase());
                up = false;
            } else {
                out.push(c);
            }
        }
        out
    };
    Value::Object(o.into_iter().map(|(k, v)| (key(k), v)).collect())
}

/// The strip as the remote page draws it now.
#[tauri::command]
pub fn bar_web_items(app: AppHandle, _caller: Caller) -> Strip {
    current(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pal_core::config::BarLook;
    use serde_json::json;

    #[test]
    fn the_strip_is_what_takes_a_slot_in_order_with_the_pages_look() {
        let draw = |order: i64, item: Value| Draw { item: serde_json::from_value(item).unwrap(), order, position: "right".into(), hover: false, look: BarLook { icon_size: 16.0, ..Default::default() } };
        let drawn = BTreeMap::from([
            ("a/late".to_string(), draw(5, json!({ "title": "late" }))),
            ("b/first".to_string(), draw(-1, json!({ "title": "first", "badge": 3, "menu": [{ "type": "item", "id": "x", "title": "X" }] }))),
            ("c/gone".to_string(), draw(0, json!({ "hidden": true }))),
            ("a/mid".to_string(), draw(0, json!({ "icon": "x" }))),
        ]);
        let v = serde_json::to_value(strip(&drawn)).unwrap();
        let keys: Vec<&str> = v["items"].as_array().unwrap().iter().map(|i| i["key"].as_str().unwrap()).collect();
        assert_eq!(keys, ["b/first", "a/mid", "a/late"], "by order, then key; a hidden item takes no slot");
        assert_eq!(v["items"][0]["item"], json!({ "title": "first", "badge": 3 }), "the strip's wire item, the menu left to the popover");
        assert_eq!((v["items"][0]["look"]["iconSize"].as_f64(), v["items"][0]["look"]["urgentColor"].as_str(), v["items"][0]["position"].as_str()), (Some(16.0), Some("destructive"), Some("right")));
    }
}
