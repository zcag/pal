use crate::config::Palette as PaletteConfig;
use crate::plugin::Plugin;
use crate::util;

pub struct Palette {
    plugin: Plugin,
}

impl Palette {
    pub fn new(base: &str, config: &PaletteConfig) -> Self {
        Self { plugin: Plugin::new(base, config) }
    }

    pub fn list(&self) -> String {
        util::run_command(self.plugin.exec(), &["list"], Some(self.plugin.config_str()))
    }

    pub fn pick(&self, selected: &str) -> String {
        util::run_command(self.plugin.exec(), &["pick"], Some(selected))
    }
}
