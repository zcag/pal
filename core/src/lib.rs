//! pal core: the parts of pal that are neither UI nor OS glue.

pub mod account;
pub mod apps;
pub mod audio;
pub mod ax;
pub mod bluetooth;
pub mod calendar;
pub mod clipboard;
pub mod config;
pub mod controls;
pub mod dialog;
pub mod env;
pub mod expansion;
pub mod extensions;
pub mod features;
pub mod frecency;
pub mod fs;
pub mod icons;
pub mod index;
pub mod keycast;
pub mod log;
pub mod manage;
pub mod media;
pub mod net;
pub mod ocr;
pub mod privacy;
pub mod registry;
pub mod menubar;
pub mod permission;
pub mod selection;
pub mod spotlight;
pub mod states;
pub mod storage;
pub mod sync;
pub mod system;
pub mod theme;
pub mod tool;
pub mod updates;
pub mod usage;
pub mod wifi;
pub mod windows;

#[cfg(test)]
mod testutil;
