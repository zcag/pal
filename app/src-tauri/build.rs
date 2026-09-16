//! Before tauri-build: the bun sidecar for this target must exist under
//! `binaries/` (tauri-build fails on a missing `externalBin`), the Nerd
//! Font TTF `bar/glyph.rs` embeds must exist under `fonts/`
//! (`include_bytes!` fails on a missing file), the `resources/` tree
//! must exist (empty is fine; `tauri build` fills it via
//! `scripts/build-extensions.sh` from `beforeBuildCommand`), and on macOS
//! the MediaRemote adapter must exist under `mediaremote/`
//! (tauri.macos.conf.json ships it; `pal_core::media` runs it). All four
//! are gitignored, so a fresh clone gets them here rather than from a
//! README step. The fetches hit the network once per triple / once; see
//! `scripts/fetch-bun.sh`, `scripts/fetch-font.sh` and
//! `scripts/fetch-mediaremote.sh`.

use std::path::Path;
use std::process::Command;

fn main() {
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let sidecar = format!("binaries/pal-bun-{target}");
    if !Path::new(&sidecar).exists() {
        println!("cargo:warning=fetching the bun sidecar for {target} (scripts/fetch-bun.sh)");
        let status = Command::new("../scripts/fetch-bun.sh").arg(&target).status();
        assert!(status.map(|s| s.success()).unwrap_or(false), "fetch-bun.sh failed for {target}");
    }
    if !Path::new("fonts/SymbolsNerdFontMono-Regular.ttf").exists() {
        println!("cargo:warning=fetching the Nerd Font symbols TTF (scripts/fetch-font.sh)");
        let status = Command::new("../scripts/fetch-font.sh").status();
        assert!(status.map(|s| s.success()).unwrap_or(false), "fetch-font.sh failed");
    }
    println!("cargo:rerun-if-changed=fonts/SymbolsNerdFontMono-Regular.ttf");
    if target.contains("apple-darwin") && !Path::new("mediaremote/mediaremote-adapter.pl").exists() {
        println!("cargo:warning=building the MediaRemote adapter (scripts/fetch-mediaremote.sh)");
        let status = Command::new("../scripts/fetch-mediaremote.sh").status();
        assert!(status.map(|s| s.success()).unwrap_or(false), "fetch-mediaremote.sh failed");
    }
    println!("cargo:rerun-if-changed=mediaremote/mediaremote-adapter.pl");
    for dir in ["resources/host", "resources/sdk", "resources/extensions"] {
        std::fs::create_dir_all(dir).expect("resources placeholder");
    }
    tauri_build::build()
}
