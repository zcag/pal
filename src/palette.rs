use crate::action::Action;
use crate::config::Palette as PaletteConfig;
use crate::plugin::Plugin;
use crate::util;

use serde_json::{json, Value};

pub struct Palette<'a> {
    config: &'a PaletteConfig,
    plugin: Option<Plugin>,
}

impl<'a> Palette<'a> {
    pub fn new(config: &'a PaletteConfig) -> Self {
        let plugin = if config.auto_list && config.auto_pick {
            None
        } else {
            config.base.as_ref().map(|base| Plugin::new(base, config))
        };
        Self { config, plugin }
    }

    pub fn list(&self, query: Option<&str>) -> String {
        let items = if self.config.auto_list {
            self.data_items()
        } else if let Some(plugin) = &self.plugin {
            plugin.run("list", query)
        } else {
            String::new()
        };
        normalize_items(&items)
    }

    /// Same as `list`, but emits each item as it arrives instead of collecting
    /// the whole set first. Lets a driver paint progressively on slow palettes
    /// (network-backed ones especially).
    pub fn list_streaming(&self, query: Option<&str>, sink: &mut impl FnMut(&str)) {
        if self.config.auto_list {
            for line in normalize_items(&self.data_items()).lines() {
                sink(line);
            }
        } else if let Some(plugin) = &self.plugin {
            plugin.run_streaming("list", query, &mut |line| {
                if let Some(item) = normalize_item(line) {
                    sink(&item);
                }
            });
        }
    }

    fn data_items(&self) -> String {
        self.config
            .data
            .as_ref()
            .and_then(|p| {
                let path = util::expand_path(p);
                let content = std::fs::read_to_string(&path).ok()?;
                Some(parse_data(&content, p))
            })
            .unwrap_or_default()
    }

    /// Run the pick for `selected`. `action_id` selects one of the item's
    /// `actions[]` by id; without it the primary (or first) action wins.
    pub fn pick(&self, selected: &str, action_id: Option<&str>) -> String {
        inject_item_env(selected);
        let item: Value = serde_json::from_str(selected).unwrap_or_default();

        // Item-level actions win; otherwise the palette may declare defaults.
        let actions = item
            .get("actions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(|| self.config.actions.clone());

        if let Some(action) = choose_action(&actions, action_id) {
            return self.run_action(&action, &item, selected);
        }

        if self.config.auto_pick {
            let name = self.config.default_action.as_deref().unwrap_or("cmd");
            let key = self.config.action_key.as_deref().unwrap_or("name");
            let value = item.get(key).and_then(|v| v.as_str()).unwrap_or("");
            return Action::new(name).run(value);
        }

        match &self.plugin {
            Some(plugin) => plugin.run("pick", Some(selected)),
            None => String::new(),
        }
    }

    /// Execute one entry from an `actions[]` array.
    fn run_action(&self, action: &Value, item: &Value, selected: &str) -> String {
        let name = action.get("action").and_then(|v| v.as_str()).unwrap_or("pick");

        if let Some(id) = action.get("id").and_then(|v| v.as_str()) {
            std::env::set_var("PAL_ACTION", id);
        }

        // `value` inline, else read the field named by `key`, else the palette's
        // configured action_key, else the item name.
        let value = action
            .get("value")
            .and_then(|v| v.as_str())
            .map(String::from)
            .or_else(|| {
                let key = action
                    .get("key")
                    .and_then(|v| v.as_str())
                    .or(self.config.action_key.as_deref())?;
                item.get(key).and_then(|v| v.as_str()).map(String::from)
            })
            .unwrap_or_default();

        // "pick" hands back to the plugin so a plugin can expose its own
        // default behaviour as one action among several.
        let out = if name == "pick" {
            match &self.plugin {
                Some(plugin) => plugin.run("pick", Some(selected)),
                None => String::new(),
            }
        } else {
            Action::new(name).run(&value)
        };

        // An action that mutates state can ask for a refresh without every
        // plugin having to hand-roll the envelope.
        let reload = action.get("reload").and_then(|v| v.as_bool()).unwrap_or(false);
        if reload && !crate::result::is_envelope(&out) {
            return json!({ "reload": true }).to_string();
        }
        out
    }
}

/// Pick the requested action, else the one flagged `primary`, else the first.
fn choose_action(actions: &[Value], action_id: Option<&str>) -> Option<Value> {
    if actions.is_empty() {
        return None;
    }
    if let Some(id) = action_id {
        return actions
            .iter()
            .find(|a| {
                a.get("id").and_then(|v| v.as_str()) == Some(id)
                    || a.get("title").and_then(|v| v.as_str()) == Some(id)
            })
            .cloned();
    }
    actions
        .iter()
        .find(|a| a.get("primary").and_then(|v| v.as_bool()).unwrap_or(false))
        .or_else(|| actions.first())
        .cloned()
}

/// Set PAL_<KEY> env vars from a JSON item so child processes can access them
fn inject_item_env(selected: &str) {
    let item: serde_json::Value = serde_json::from_str(selected).unwrap_or_default();
    if let Some(obj) = item.as_object() {
        for (k, v) in obj {
            let val = match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            std::env::set_var(format!("PAL_{}", k.to_uppercase()), val);
        }
    }
}

/// Parse data file - supports JSON lines, JSON array, and TOML array-of-tables
fn parse_data(content: &str, path: &str) -> String {
    if path.ends_with(".toml") {
        return parse_toml_data(content);
    }
    let trimmed = content.trim();
    if trimmed.starts_with('[') {
        // JSON array format - convert to JSON lines
        serde_json::from_str::<Vec<serde_json::Value>>(trimmed)
            .map(|arr| arr.into_iter().map(|v| v.to_string()).collect::<Vec<_>>().join("\n"))
            .unwrap_or_else(|_| content.to_string())
    } else {
        // Already JSON lines format
        content.to_string()
    }
}

/// Parse TOML data file - finds the first top-level array and converts items to JSON lines
fn parse_toml_data(content: &str) -> String {
    let table: toml::Value = match content.parse() {
        Ok(v) => v,
        Err(_) => return String::new(),
    };
    let arr = table.as_table()
        .and_then(|t| t.values().find(|v| v.is_array()))
        .and_then(|v| v.as_array());

    match arr {
        Some(items) => items.iter()
            .filter_map(|item| serde_json::to_value(item).ok())
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join("\n"),
        None => String::new(),
    }
}

/// Ensure a JSON item has an id field (defaults to name if missing)
fn normalize_item(line: &str) -> Option<String> {
    let mut item: serde_json::Value = serde_json::from_str(line).ok()?;
    if item.get("id").is_none() {
        let name = item.get("name").and_then(|v| v.as_str()).map(String::from);
        if let (Some(name), Some(obj)) = (name, item.as_object_mut()) {
            obj.insert("id".to_string(), serde_json::Value::String(name));
        }
    }
    Some(item.to_string())
}

fn normalize_items(items: &str) -> String {
    items
        .lines()
        .filter_map(normalize_item)
        .collect::<Vec<_>>()
        .join("\n")
}
