use crate::plugin::Plugin;

pub struct Action {
    plugin: Plugin,
}

impl Action {
    pub fn new(name: &str) -> Self {
        // Try local path first (config dir, then _PAL_CONFIG_DIR), fall back to github
        let config_dir = dirs::config_dir()
            .map(|p| p.join("pal"))
            .unwrap_or_default();
        let local_path = config_dir.join(format!("plugins/actions/{name}"));

        let base = if local_path.join("plugin.toml").exists() {
            local_path.to_string_lossy().to_string()
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
