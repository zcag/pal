use crate::config::Frontend as FrontendConfig;
use crate::plugin::Plugin;

pub struct Frontend {
    plugin: Plugin,
}

impl Frontend {
    pub fn new(base: &str, config: &FrontendConfig) -> Self {
        Self { plugin: Plugin::new(base, config) }
    }

    pub fn run(&self, items: &str) -> String {
        let config_with_items = format!(
            r#"{{"items": [{items}]}}"#,
            items = items.lines().collect::<Vec<_>>().join(",")
        );
        self.plugin.run("run", Some(&config_with_items))
    }
}
