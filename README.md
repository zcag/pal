# pal

A keyboard launcher for macOS and Linux. One hotkey, one search box over
your apps, bookmarks, clipboard history, emoji and a calculator. Every palette
is a TypeScript extension against the same API, so your own live next to the
defaults.

## Layout

- `app/` the Tauri v2 shell: React UI in `src/`, Rust in `src-tauri/`
- `core/` `pal-core`, the parts that are neither UI nor OS glue (config, index, clipboard, icons)
- `host/` the extension host, one long-lived Bun process the app talks to over stdio
- `extensions/` the default extensions, one directory each with an `index.ts`
- `notes/` decisions and platform notes

## Dev setup

Prerequisites: Rust (stable), Node 20+, Bun, and the
[Tauri v2 system prerequisites](https://v2.tauri.app/start/prerequisites/)
for your platform (Xcode command line tools on macOS; webkit2gtk-4.1, gtk3,
librsvg, openssl, base-devel on Linux).

```sh
git clone git@github.com:zcag/pal.git && cd pal
(cd app && npm install)
(cd host && bun install)
(cd extensions/calc && bun install)
cd app && npm run tauri dev
```

The first cargo build fetches the pinned Bun release into
`app/src-tauri/binaries/bun-<triple>` (`app/scripts/fetch-bun.sh`, checksum
verified, gitignored): it ships inside the app as the extension host's
runtime, and in dev the app runs that same copy. In dev the host and the
extensions load from the repo and reload when a file changes.

Ctrl+Space toggles the panel (`general.hotkey` in `~/.config/pal/config.toml`,
written with a commented template and its JSON schema on first launch). On
Wayland there is no global hotkey API, so bind `pal toggle` in the
compositor instead; `notes/linux.md` has the Hyprland rules.

Checks: `cargo clippy --all-targets` from the repo root, `npx tsc --noEmit`
in `app/` and `../app/node_modules/.bin/tsc --noEmit -p .` in `host/` (which
covers `extensions/`).

## Build

```sh
cd app && npm run tauri build
```

`beforeBuildCommand` builds the UI and stages the host and the extensions
under `app/src-tauri/resources/` (`app/scripts/build-extensions.sh`: each
extension bundled to one `index.js` with `bun build`, so no `node_modules`
ships). Output under `target/release/bundle/`:

- macOS: `macos/pal.app` and `dmg/pal_0.1.0_aarch64.dmg`, ad-hoc signed
  (`bundle.macOS.signingIdentity: "-"`). A Developer ID certificate plus
  `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` in the environment makes the
  same command sign and notarise.
- Linux: `appimage/pal_0.1.0_amd64.AppImage`, `deb/pal_0.1.0_amd64.deb` and
  an rpm. The first build downloads `linuxdeploy` and its plugins into
  `~/.cache/tauri/`. On a distro with current binutils (Arch) run it as
  `NO_STRIP=true npm run tauri build`: linuxdeploy's bundled `strip` cannot
  read the libraries and the bundle fails otherwise.

Inside the bundle, `bun` sits next to the `pal` binary (`Contents/MacOS/`,
`usr/bin/`) and the staged tree under the resource directory
(`Contents/Resources/`, `usr/lib/pal/`). User extensions go in
`~/.config/pal/extensions/<name>/index.ts`; the host loads the bundled root
first and that one last, so a user extension with the same name wins.
