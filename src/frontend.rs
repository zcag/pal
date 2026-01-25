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
        self.plugin.run("run", Some(items))
    }
}
