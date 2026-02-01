use crate::plugin::Plugin;
use crate::util;

pub struct Action {
    plugin: Plugin,
}

impl Action {
    pub fn new(name: &str) -> Self {
        // Try local path first (relative to config dir), fall back to github
        let local_base = format!("plugins/actions/{name}");
        let local_path = util::expand_path(&local_base);

        let base = if local_path.join("plugin.toml").exists() {
            local_base
        } else {
            format!("github:zcag/pal/plugins/actions/{name}")
        };

        // no user config for actions, pass empty object
        let empty: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
        Self {
            plugin: Plugin::new(&base, &empty),
        }
    }

    pub fn run(&self, value: &str) -> String {
        self.plugin.run("run", Some(value))
    }
}
