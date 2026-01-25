use crate::config::Palette as PaletteConfig;
use crate::plugin::Plugin;

pub struct Palette {
    plugin: Plugin,
}

impl Palette {
    pub fn new(base: &str, config: &PaletteConfig) -> Self {
        Self { plugin: Plugin::new(base, config) }
    }

    pub fn list(&self) -> String {
        self.plugin.run("list", None)
    }

    pub fn pick(&self, selected: &str) -> String {
        self.plugin.run("pick", Some(selected))
    }
}
