# Decisions so far

Working notes for the `pali` iteration. Not the contract: that evolves during
development and gets written down as it stabilises. Platform detail is in
`notes/linux.md` (marko, Hyprland, bundle) and `notes/matching.md` (nucleo vs
fzf-for-js benchmarks); this file links to them instead of repeating.

## State at 2026-09-16 morning

- Shell: Tauri v2, Rust core + React UI in the system webview; panel pre-painted at startup, page alive while hidden; `pal toggle|show|hide|settings|quit` over single-instance (`app/src-tauri/src/cli.rs`).
- Core `pal-core` (`core/`): file-first TOML config (round-trip edits, watch, schema, secrets), index with per-field matching + frecency, icons, clipboard history (SQLite+FTS), windows, system commands, `ax`.
- Host: one long-lived Bun sidecar `pal-bun` over stdio with a reverse-RPC bridge. 8 extensions: apps, bookmarks, calc, clipboard, emoji, scripts (v1 zero-code tier), system, windows.
- UI: `app/src/ui` (List, Grid, Detail, Form, ActionPanel, Search, Footer, Hud, Confirm, Empty, Kbd), grammar in `keys.ts`, gallery, brief + tokens in `app/design/`; Settings window live.
- Settings: manifests with declared settings, per-palette defaults, one watcher, secrets to the OS store, launch at login, tray menu, first-run Welcome.
- Packaging: binary `pal`, host + extensions as resources; Linux AppImage 137 MB / deb 44 MB / rpm 44 MB; `ci.yml` (macos-latest, ubuntu-24.04), `release.yml`, updater behind `general.check_updates`, `make release VERSION=x.y.z`.
- Docs: `docs/` 8 files (getting started, config, palettes, scripts, keyboard, CLI, releasing, README).
- Tests: `make test` = 127 Rust `#[test]`, 10 vitest, 91 bun host tests.
- Hotkey to paint: hornet release 1.7 ms first, 1.5-3 ms after (1-4 ms with two live palettes); marko release 12-20 ms first, 0.1-1 ms after. Keystroke to painted list over 14.7k rows: 9-26 ms hornet, 24-76 ms marko.
- Index restore answers the first query at ~400 ms cold (was ~10 s after host spawn). Host feed of 14.7k rows 25 ms hornet / 57 ms marko; `pal-app toggle` round trip 52-54 ms on marko (45 ms is loading 144 shared libraries).

## Decided

### Product

- Clean rewrite on the orphan branch `pali`; v1 stays on `main`, checked out at `~/proj/pal-v1`. `pali` takes over `main` when done.
- Name is `pal`; `pali` is the iteration. A standalone app people download, macOS and Linux. Raycast and Spotlight are the behaviour references; the visual identity is ours.
- Bar: high polish everywhere, no corners cut, minute UX details thought through.
- Root search: one box across everything; palettes are sections and drill-downs, not a root that lists palettes.
- Extensibility, one way: every palette including every default is an extension against the same API, no native tier. In-app code is shell (root search, action panel, settings, store, first run) plus OS capabilities as APIs (clipboard, windows, apps, files, hotkeys).
- Order of work: UI first (brief, component set, keyboard grammar), then protocol and host. Done in that order (`git log`).
- The pit board (pit.cagdas.io) holds Raycast research; its `in` lane is "relevant", never a commitment. Decisions are made here.

### Shell

- Tauri v2, the shape of Raycast 2.0. Go/no-go on hornet, dev build: hotkey to paint ~30 ms steady (706 ms first show, fixed by pre-painting), keystroke to list 14-42 ms over 14.7k rows, 14.7k rows streamed from a child in ~70 ms.
- Hotkey on hornet: Ctrl+Space (Alt+Space is taken); from `general.hotkey`, re-registered on file change (`hotkey.rs`). `general.position`: `top` (20%), `centre`, `last`.
- Settings window: second Tauri window on the same bundle (`index.html?settings`), decorated, hidden until asked, closes to hidden; opened by `pal-app settings`, the `pal:settings` root action, `cmd+,`. Escape / cmd+w hide it.
- Menu bar icon (`tray.rs`): there is no Dock icon, so this is the way to Settings and Quit. Menu: Open pal (hotkey as accelerator hint), Settings… (⌘,), Restart extension host, Check for updates… (disabled until the updater flow is in; `updater::check` exists), Quit pal. Left click opens the menu (Raycast does). Image `app/design/tray.svg` (the app icon as one colour: the slab's outline with the caret and the empty query inside): black template `icons/tray/36x36` + `18x18` on macOS, white `22x22` for Linux panels. `general.menu_bar_icon = false` removes it live; `true` default, unset by the view.
- `general.launch_at_login` via tauri-plugin-autostart (`autostart.rs`): `~/Library/LaunchAgents/io.cagdas.pal.plist` (written, not `launchctl load`ed: next login) / `~/.config/autostart/pal.desktop`; applied on every change of the key. A debug build never registers (would point at `target/debug/pal`) and logs so.
- Quit (tray, `pal quit`): host gets EOF and 2 s (`Host::stop`, no respawn), then `app.exit(0)` runs the `RunEvent::Exit` flush of frecency and the cache saver (`quit  flushed` in the log). `pal quit` with no instance prints `not running`, starts nothing.
- Data keyed by config file: `<data dir>/pal/<profile>/{index, frecency.json}`, `<profile>` = `default` for `~/.config/pal/config.toml` else first 8 hex of sha256 of the canonical path (`ConfigFile::profile`; hornet's `pali.toml` is `ff8fb0c4`; logged at startup as `profile`). `clipboard.db` stays one level up: history, not a view of one config. Nothing migrated.
- Index persisted (`cache.rs`): every default listing to `<data dir>/pal/index/<extension>/<palette>.json` (wire items, `listed_at`, meta, extension title; atomic, debounced 500 ms per source; >50k items not written). `index::restore_cache` restores all before the host spawns (items `stale`, registry entry, palette row, hotkeys): first query 32 items at ~400 ms cold vs the full ~15.5k at ~400 ms warm. `host/ready` prunes extensions gone from disk (`known`; failed-to-load keeps its cache). Restored order `pal/palettes`, `apps`, then by name, so a cold frecency profile still leads with palettes and apps.
- `ttl` is palette meta (seconds; palette object, manifest `palettes.<key>.ttl`, `scripts` maps v1 `ttl` else its own setting). On `extension/loaded`: no `ttl` = list now; younger than `ttl` = keep restored rows; else one sequential pass 1 s after `host/ready` (`refresh_expired`). `live` still re-lists on show. `SourceInfo.stale` = listing pending: footer "updating…" + search sweep. `index_refresh(source?)` / `pal:refresh` (cmd+r) force past `ttl`, the `list` carries `refresh: true` so an extension's own cache steps aside.
- d811024: hotkey apply deadlock, request timeout covering the write, stray rows after an extension leaves, zombie open children, bounded icon threads, poison-tolerant locks, `events`/`registry` modules.

### Core

- Matching in Rust: corpus in the core, `nucleo-matcher` single-thread, per-field scoring (name 100%, keyword 80%, subtitle 50%), top 200 to the webview, frecency hook before the top-N select. Numbers and why: `notes/matching.md`. Wired in 92dc234.
- Windows and system commands are core capabilities (`pal_core::windows`, `pal_core::system`; `core/windows.{list,close,minimize}`, `core/system.{commands,run}`), the `windows`/`system` extensions thin over them. Focus is a pick effect (`{ focus: id }`, effects.rs), like `paste`: the panel hides first so orderOut hands key focus back. `system.run` hides the panel itself.
- Accessibility in `pal_core::ax` (`trusted`/`request`, `AXUIElement` wrapper); one `accessibility_blocked` toast in effects.rs shared by paste and focus.
- macOS window list: CoreGraphics (ids, order, bounds, on-screen) matched to AX windows by frame and title; titles from AX (CG needs Screen Recording for other apps' titles); an app answering AX with no windows falls back to CG rows; AX asked per app in parallel (10-30 ms when it naps).
- Linux backends detected, not configured: Hyprland (`hyprctl` + instance signature, newest `$XDG_RUNTIME_DIR/hypr/*` when the env var is missing), Sway (`SWAYSOCK`), X11 (`DISPLAY` + `wmctrl`). Hyprland has no minimise: parked on `special:minimized`, `focus` brings it back.
- Clipboard retention has one meaning (fcb967a): `max_age_days = 0` = no age limit; `exclude_apps` default in the manifest, so an explicit `[]` no longer drops the Keychain/Passwords protection.

### Extensions and protocol

- Extensions are TypeScript in one Bun host, UI as a render tree from a fixed component set, never HTML. Scripts/data files stay the zero-code tier under the built-in `scripts` extension (runs v1 script plugins and data palettes from a v1 config). Raycast API compatibility: nice to have; keep the component set close enough that a shim stays plausible.
- Manifest is `pal.json` next to `index.ts`, readable without running code (Settings lists an extension whose code fails; host sends the manifest with `extension/error`). Shape (`host/src/protocol.ts` `Manifest`): `name title description version icon author repo`, `settings: SettingSpec[]` (`[extensions.<name>]`), `palettes.<key>.{settings,ttl,title}` (`[palettes.<id>].settings`; title only a fallback while it fails). Settings come from the manifest only (9332904).
- Palette id in the file: the extension's name when the palette is named like it (`emoji`, `apps`), else `<extension>-<palette>` (`clipboard-history`); bare keys, `index::palette_id` resolves.
- Settings reach extensions resolved: core overlays file over manifest defaults (`Config::extension_settings`/`palette_settings`, one level deep, a set key replaces the default whole), pushes `settings/changed` before the first `list` and on every change; `settings.get()` reads it. Caller identity: host async context in `list`/`pick`, file on the stack at import, explicit argument elsewhere (Bun drops context through dynamic import). Changed values relist. `secret` settings arrive resolved (fcb967a).
- `list`/`pick`/`detail` take a trailing `ctx: { filter?, args?, refresh? }`; on the wire `filter`/`args` ride flat.
- Lazy detail: palette method `detail(id, ctx)`, meta `detail: "lazy"`; the open-with-pane flag is `showDetail`. UI asks after 100 ms cursor rest on an item without inline markdown (`Item.lazyDetail`), merges the reply over the inline one, skeleton only past 150 ms more, drops replies for a left item. Host caches per palette+id until relist/reload, UI per level until the index changes. `scripts` runs v1 `preview` there, `preview_max` (default 4): `prs` lists in ~40 ms instead of ~5.9 s, one `gh pr view` per rest (~1 s, cached).
- Filters through the core: `PaletteMeta.filters` via `sources()`; Search dropdown, Tab cycles, first is default (core sends `filter: filters[0].id` explicitly). Indexed palette listed per filter (`index::filter`), bucket swapped, each filter's list kept until relist; root sees the filtered bucket while inside, reset to the first on leaving, the next query restores it; the page asks per query and the core no-ops when the bucket already holds that filter. Input palettes get it per keystroke. Verified with `scripts/otp` (4), `ha-states` (10).
- Drill-in: `Effect.push { extension, palette, args? }` pushes a scoped level; with `args` it lists from the extension per keystroke (never the index) and picks are not remembered (frecency is the parent's). `Effect.show: Detail & { title? }` pushes a detail-only level (full width, crumb, Back on Enter/Escape, arrows/PageUp/Down scroll, input read-only). `scripts` maps v1 `{palette, env}` to `push` (env as args, re-exported to the script; rows kept per args so a root pick still works after a drill-in listing) and v1 `show` to `show`.
- `keep` relists an indexed palette (`index::pick`): "stay open and list again" holds for every palette; a closed window is gone next query.
- Live at the root: a `live` non-`input` palette (windows, otp) is indexed and relisted on every `pal://shown` (`index::on_shown`), all at once, 2 s each, one `pal://index`, spawned after the event: paint stayed 1-4 ms; relist ~15-20 ms windows, ~300 ms otp (reads the Messages db); a timeout keeps old rows. `windows` is plain `live` so titles are root results; `system` stays `input: true` (keep-awake row flips), so its rows are not at the root.
- Picks from live and input palettes are not remembered (edc1670).
- `ssh` and `processes` (v1's builtins `ssh`/`psg`) and `files` (mdfind / fd / locate / find) are real extensions (708abf7, c8f478f); the v1 rows under `scripts` for them are gone.
- Palette rows carry the extension title as subtitle (Raycast does), omitted when equal to the palette title (Windows / Windows). Root sections ordered by best hit.
- 9332904: process-group timeouts in scripts, stable bookmark ids, apps honour refresh, calc import guard, `home()`. 0b48368: extension `console.log` to stderr, non-array `list` is an error, symlinked roots. Linux `apps` (`.desktop`): `notes/linux.md`.

### UI

- Both webviews follow `general.theme` from `pal://config` (`data-theme` on `<html>`).
- Glyph icons: bundled Symbols Nerd Font Mono (woff2, 1.2 MB) scoped to the private-use range; freedesktop icon names mapped (474e670).
- Landed: grapheme highlights, IME and key-repeat guards, hover vs keyboard cursor, overlay key swallowing, focus traps, roles, motion from tokens, exit motion via a presence wrapper, Tab swallowed without a filter; first run = Welcome section on the empty root until dismissed, "Show tips again", empty-state copy.
- Diagnostics strip: unknown keys show the dotted path with no line (serde gives no spans for ignored keys); parse errors have a line.
- `alias` is an extra keyword on the palette row, not a jump; docs say so now. Settings cmd+w also honours Super+W on Linux (both fcb967a).

### Settings and config

- Declarative, file-first TOML: everything the view sets lives in the file the user edits and versions; the UI is a front, never the only path. UI change writes the file, file change is picked up live, formatting and comments kept, JSON schema shipped.
- Extensive settings view; extensions declare their settings, palette extensions also get pal-provided per-palette defaults (hotkey, alias, enabled, ranking behaviour) without declaring them.
- A declared setting equal to its default leaves the file (the view unsets the key); `enabled = true` likewise.
- Secrets: a `secret` field goes to the OS store as `pal/<extension>-<key>` (`SecretStore::set`, `security add-generic-password -U` on macOS), the file gets `keychain:pal/<extension>-<key>`; remove only unsets the key, the keychain item stays.
- One config watcher (`settings::install`): reload updates managed state, re-applies root and per-palette hotkeys, removes/lists palettes per `enabled`, pushes `settings/changed`, emits `pal://config` to every window.

### Packaging and release

- Sidecar `pal-bun` (pinned release, `app/scripts/fetch-bun.sh`, checksum verified), host and extensions as resources, binary `pal`, bundle targets narrowed, first-run config written with a commented template and schema.
- CI + release workflows, updater with a daily check behind `general.check_updates`, `make release VERSION=x.y.z` (sets the version everywhere, prints the tag commands; `docs/releasing.md`).
- Linux bundle (`NO_STRIP=true`, `GDK_BACKEND=wayland,x11` under `APPDIR`, deb depends on `libayatana-appindicator3-1`): `notes/linux.md`.

### Linux

- All in `notes/linux.md`: go/no-go numbers, no global hotkey on Wayland (bind `pal toggle` in the compositor), Hyprland windowrule set, `panel/linux.rs` (hide on focus loss, pre-map at startup), tray via `libappindicator` dlopen, XDG autostart (Hyprland needs `exec-once = pal`).

## How to run it

- Dev instance: `cd app && PAL_CONFIG=~/.config/pal/pali.toml npm run tauri dev` (hornet's `~/.config/pal/config.toml` is v1's; `pali.toml` until `pali` takes `main`). Host and extensions load from the repo and reload on change; README has the installs. `pal toggle|show|hide|settings|quit` drive the running instance.
- `make test`: Rust workspace, app vitest, host bun test.
- Logs: tab-separated marks on stderr (`profile`, `hotkey\t...`, `quit\tflushed`, extension `console.log`), so in dev the `tauri dev` terminal; no log file. Data in `<data dir>/pal/<profile>/`.
- marko: clone `marko:~/proj/pali` (`pali` branch). Release: `cargo build --release --features tauri/custom-protocol`; bundle: `NO_STRIP=true npm run tauri build` in `app/`; take `WAYLAND_DISPLAY`/`DISPLAY` from `systemctl --user show-environment` when launching by hand. `notes/linux.md`.

## Open for Cagdas

- **Your `~/.config/pal` is a symlink into `~/dotty`**, so the dev run left three untracked things in the dotfiles repo: `pali.toml` (the dev config; track it or not, your call), `config.schema.json` (installed next to the config for the `#:schema` directive) and `extensions/` (the user store, with a `node_modules/pal` symlink the host makes for bare `import "pal"`). Decide: ignore them in dotty, or move the store and the schema out of the config dir (a dotfiles-managed `extensions/` is arguably a feature, the symlink and staging dir are not).

Things an agent could not decide alone; each waits for a call.

- Font, match highlight, selection shape from the brief (bundled Plex vs system stack; amber highlighter vs coloured glyphs; inset pill vs full-bleed row). Unchanged until you have used the panel. `app/design/brief.html`.
- Config path once `pali` ships: v1 and pal both want `~/.config/pal/config.toml`, formats differ. Migrate v1's aside on first run, or keep `pali.toml` a while? Blocks taking over `main`.
- Exact-name priority vs frecency: a picked emoji can outrank a bookmark named exactly what was typed (`ha`). Raycast gives exact alias/name matches priority over history. Same here? `core/src/index.rs`.
- `ttl` default and the live budget: no v1 plugin on hornet declares a `ttl`, so every `scripts` palette still runs on every start (in the background, root already answered). Default for palettes without one (an hour?), or keep "no ttl = always fresh" and set `[extensions.scripts] ttl` by hand? Also `live` palettes relist on every show (`otp` ~300 ms per show): fine for two, a budget question once user extensions declare `live` freely; a `ttl` that skips a fresh relist is the obvious knob. `index::on_shown`, `refresh_expired`.
- HUD after copy: the panel is the only window and goes to alpha 0 on hide, so a Raycast-style "Copied" HUD needs a second small NSPanel. Worth one, or is the hide enough feedback? `app/src/ui/Hud.tsx`.
- macOS `show-desktop`, `lock`, `dark-mode` system commands are the only unverified ones on hornet (window list/focus/minimize/restore were verified after the unlock at 08:10; see Findings). One-liner: `cargo run -q -p pal-core --example system -- run show-desktop` twice.
- Focus without Accessibility: the core can still activate the app (not the window); today the effect shows the paste toast instead of half-doing it. Keep, or activate and toast? `effects.rs`.
- v1 config lines to fix by hand once v1 stops reading the file: `[palette.ha-states]`/`[palette.ha-services]` still say `base = "~/proj/pal/plugins/..."`; `scripts` falls back to `~/proj/pal-v1` so they load, but the file should say where they live.
- Secrets on Linux: `keychain:` get/set fail with a `Store` error until the Secret Service path exists (`core/src/config/secrets.rs:134`: `secret-tool` or the `secret-service` crate); `env:` works everywhere.
- Cache adoption of the old profile: the old `pal/index` and `pal/frecency.json` were not migrated to `<data dir>/pal/<profile>/`; dead files to delete by hand, or adopt into `default`.
- `show`'s metadata: the show level renders the Detail, so v1's `show.metadata` comes along; the brief said markdown only. Keep or drop?
- `SACLockScreenImmediate` (private login.framework) is what Lock Screen uses, Cmd+Ctrl+Q as fallback: fine for a downloaded app, not the App Store.
- Do Not Disturb on macOS runs a Shortcut named "Toggle Do Not Disturb" when one exists (Focus has no CLI), row hidden otherwise. Ship a first-run hint to create it?

## Findings that changed the design

- Raycast 2.0 is a Rust core with a web UI in the system webview, the shape Tauri v2 gives; that set the go/no-go candidate (Shell, above).
- WebKit suspends rendering (rAF, timers) for a page whose window is ordered out or occluded, so the macOS panel is never ordered out (hidden = alpha 0, mouse ignored) and occlusion detection is switched off via the private `_setWindowOcclusionDetectionEnabled:` Raycast also flips. `app/src-tauri/src/panel/macos.rs:49`.
- `global-hotkey` 0.8 is X11-only on Linux; on Wayland the grab lives on Xwayland and fires only with an X11 client focused (0 of 7 from Chromium). Hence `pal toggle` over single-instance. `notes/linux.md`.
- First key after a re-show lost on WebKitGTK: hiding inside an unhandled keydown leaves a "forward next key" flag stuck. Rule: `preventDefault()` on the key that hides, never hide from an unhandled key event (`ui/keys.ts:110`). `notes/linux.md`.
- Pre-mapping at startup (show then hide, never on screen) took marko's first show from 111-124 ms to 12-20 ms; pre-painting took hornet's 706 ms to 1.7 ms release. `notes/linux.md`, 1db672e.
- The joined-haystack fuzzy match (fzf-for-js, nucleo par) ranks `hand` above the bookmark `ha` and drops Terminal.app from the `term` top 10; per-field weighting fixes it under 0.7 ms per keystroke. `notes/matching.md`.
- `!`, `^`, `'`, `$` are ordinary text in a query, not fzf operators (Spotlight and Raycast have none; a bookmark `!important` must be findable). `core/src/index.rs:263`, 75a7f47.
- Hotkey apply deadlock, found and fixed in d811024 (re-register order first touched in 75a7f47). `app/src-tauri/src/hotkey.rs`.
- WebKitGTK does no PUA font fallback: Nerd Font glyphs were tofu on Linux, so the font is bundled for that range. `notes/linux.md`.
- linuxdeploy exports `GDK_BACKEND=x11`, so the AppImage ran under Xwayland and the windowrule never matched; `main.rs` sets `wayland,x11` under `APPDIR`. `NO_STRIP=true` is load-bearing on Arch. `notes/linux.md`.
- CoreGraphics gives other apps' titles only with Screen Recording, so titles come from AX; AX returns nothing while the screen is locked, and lists only the current Space's windows, so an unmatched CG row is kept and focusing it activates the app (which switches Spaces); `kCGWindowName` lags AX, so matching is frame-first (`core/src/windows.rs`, commit 27d9873).
- Bun does not carry async context through a dynamic import; serde reports no spans for ignored keys. Both shaped the settings and diagnostics paths above.
- The docs pass (06:30) found six code/doc contradictions (clipboard retention meaning, `exclude_apps = []`, `alias` semantics, unresolved `keychain:` in extension settings, cmd+w on Linux, deb tray dependency); all fixed in fcb967a, not papered over.
