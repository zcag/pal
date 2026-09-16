//! Before tauri-build: the bun sidecar for this target must exist under
//! `binaries/` (tauri-build fails on a missing `externalBin`) and the
//! `resources/` tree must exist (empty is fine; `tauri build` fills it via
//! `scripts/build-extensions.sh` from `beforeBuildCommand`). Both are
//! gitignored, so a fresh clone gets them here rather than from a README
//! step. The fetch hits the network once per triple; see
//! `scripts/fetch-bun.sh`.

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
    for dir in ["resources/host", "resources/sdk", "resources/extensions"] {
        std::fs::create_dir_all(dir).expect("resources placeholder");
    }
    tauri_build::build()
}
