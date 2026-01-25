use crate::plugin::Plugin;
use crate::util;

pub struct Action {
    plugin: Plugin,
}

impl Action {
    pub fn new(name: &str) -> Self {
        let base = format!("plugins/actions/{name}");
        // no user config for actions, pass empty object
        let empty: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
        Self {
            plugin: Plugin::new(&base, &empty),
        }
    }

    pub fn run(&self, value: &str) -> String {
        util::run_command(self.plugin.exec(), &["run"], Some(value))
    }
}
