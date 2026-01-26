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

    pub fn list(&self) -> String {
        if self.config.auto_list {
            self.config.data.as_ref()
                .and_then(|p| std::fs::read_to_string(util::expand_path(p)).ok())
                .unwrap_or_default()
        } else if let Some(plugin) = &self.plugin {
            plugin.run("list", None)
        } else {
            String::new()
        }
    }

    pub fn pick(&self, selected: &str) -> String {
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
