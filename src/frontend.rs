use crate::config::Frontend as FrontendConfig;
use crate::plugin::Plugin;
use crate::util;

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
        util::run_command(self.plugin.exec(), &["run"], Some(&config_with_items))
    }
}
