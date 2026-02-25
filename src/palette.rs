use crate::action::Action;
use crate::config::Palette as PaletteConfig;
use crate::plugin::Plugin;
use crate::util;

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
            self.config.data.as_ref()
                .and_then(|p| {
                    let path = util::expand_path(p);
                    let content = std::fs::read_to_string(&path).ok()?;
                    Some(parse_data(&content, p))
                })
                .unwrap_or_default()
        } else if let Some(plugin) = &self.plugin {
            plugin.run("list", query)
        } else {
            String::new()
        };
        normalize_items(&items)
    }

    pub fn pick(&self, selected: &str) -> String {
        inject_item_env(selected);

        if self.config.auto_pick {
            let action_name = self.config.default_action.as_ref().unwrap();
            let action_key = self.config.action_key.as_ref().unwrap();
            let item: serde_json::Value = serde_json::from_str(selected).unwrap_or_default();
            let value = item.get(action_key).and_then(|v| v.as_str()).unwrap_or("");
            Action::new(action_name).run(value)
        } else if let Some(plugin) = &self.plugin {
            plugin.run("pick", Some(selected))
        } else {
            String::new()
        }
    }
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

/// Ensure each JSON item has an id field (defaults to name if missing)
fn normalize_items(items: &str) -> String {
    items
        .lines()
        .filter_map(|line| {
            let mut item: serde_json::Value = serde_json::from_str(line).ok()?;
            if item.get("id").is_none() {
                let name = item.get("name").and_then(|v| v.as_str()).map(String::from);
                if let (Some(name), Some(obj)) = (name, item.as_object_mut()) {
                    obj.insert("id".to_string(), serde_json::Value::String(name));
                }
            }
            Some(item.to_string())
        })
        .collect::<Vec<_>>()
        .join("\n")
}
