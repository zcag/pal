# Decisions so far

Working notes for the `pali` iteration. Short, dated, appended as things settle.
Not the contract: the contract evolves during development and gets written
down as it stabilises.

## 2026-09-16

- **Clean rewrite** on the orphan branch `pali`; v1 stays on `main`, checked
  out at `~/proj/pal-v1` for reference. `pali` takes over `main` when done.
- **Name is `pal`**. `pali` is the iteration, not the product.
- **Product**: a standalone app people download and use. macOS and Linux.
  Raycast and Spotlight are the behaviour references throughout; the visual
  identity is ours.
- **Bar**: high polish everywhere. No corners cut, no rushing, minute UX
  details thought through.
- **Shell**: Tauri v2 (Rust core, React UI in the system webview), the same
  shape as Raycast 2.0. Go/no-go passed on hornet, dev build: hotkey to paint
  ~30 ms steady (706 ms first show, to fix by pre-painting), keystroke to
  filtered list 14-42 ms over 14.7k rows, 14.7k rows streamed from a child
  process in ~70 ms. Linux numbers still to take on marko.
- **Root search**: one search box across everything, palettes are sections
  and drill-downs (Spotlight/Raycast model), not a root that lists palettes.
- **Extensibility, one way**: every palette, including every default one, is
  an extension against the same API. No native palette tier. In-app code is
  shell (root search, action panel, settings, store, first run) and OS
  capabilities exposed to extensions as APIs (clipboard, windows, apps,
  files, hotkeys).
- **Extensions are TypeScript**, run in one long-lived extension host (Bun as
  a sidecar), and describe UI as a render tree from a fixed component set,
  never HTML. Scripts and data files remain as the zero-code tier, run by one
  built-in extension. Raycast API compatibility: nice to have, not required;
  keep the component set close enough that a shim stays plausible.
- **Settings**: an extensive settings view where a user sets up everything.
  Extensions declare their own settings; palette extensions additionally get
  a set of pal-provided per-palette defaults (hotkey, alias, enabled, ranking
  behaviour and the like) without declaring them.
- **Hotkey on hornet**: Ctrl+Space for now (Alt+Space is taken).
- **Order of work**: lock the UI first (design brief, component set, keyboard
  grammar), then the protocol and extension host.
- **Config is declarative and file-first.** Everything the settings view can
  set lives in a config file the user can edit and version-control; the UI
  is a front for the file, never the only path. Extension settings and the
  per-palette defaults are part of the same file. The two directions stay in
  sync: a UI change writes the file, a file change is picked up live (watch),
  and the file keeps the user's formatting and comments where the format
  allows. Whichever format we pick, pal ships a schema so an editor can
  validate and complete it.
- **The pit board for pal** (pit.cagdas.io) collects findings from a research
  pass on how Raycast does things. Its `in` lane is "relevant", not "we will
  build this": a card there is input to a decision here, never a commitment.
  Decisions still get made in this file, one at a time.

- **Extension manifest is `pal.json`** next to `index.ts`, not a field of the
  default export: readable without running code, so the settings window
  lists an extension whose code fails to load (the host sends the manifest
  with `extension/error` too). Shape (provisional, host/src/protocol.ts
  `Manifest`): `name title description version icon author repo`,
  `settings: SettingSpec[]` (`[extensions.<name>]`), `palettes.<key>.settings`
  (`[palettes.<id>].settings`). Title/icon of a palette stay in the code; the
  manifest's `palettes.<key>.title` is only a fallback while it fails.
- **Palette id in the file**: the extension's name when the palette is named
  like it (`emoji`, `apps`), else `<extension>-<palette>`
  (`clipboard-history`). Bare keys, no quoting; the registry resolves them
  back (`index::palette_id`).
- **Settings reach an extension resolved**: the core overlays the file over
  the manifest defaults (`Config::extension_settings` / `palette_settings`,
  one level deep, a set key replaces the default whole) and pushes
  `settings/changed` to the host before the extension's first `list` and on
  every config change; `settings.get()` in `api.ts` reads that table. Which
  extension is asking comes from the host's async context inside
  `list`/`pick`, from the caller's file on the stack at import time, and from
  an explicit argument anywhere else (Bun does not carry the context through
  a dynamic import). An extension whose resolved values changed is listed
  again.
- **A declared setting equal to its default leaves the file**: the settings
  view unsets the key rather than writing the default back, so the file only
  holds what differs. `enabled = true` is unset the same way.
- **Secrets**: a `secret` field's typed value goes to the OS store under
  `pal/<extension>-<key>` (`SecretStore::set`, `security add-generic-password
  -U` on macOS) and the file gets `keychain:pal/<extension>-<key>`. Remove
  only unsets the key; the keychain item stays.
- **One config watcher** (`settings::install`), not one per consumer: a
  reload updates managed state, re-applies hotkeys (root and per palette),
  removes/lists palettes as `enabled` says, pushes `settings/changed`, and
  emits `pal://config` to every window. Both webviews follow `general.theme`
  from that event (`data-theme` on `<html>`).
- **Settings window** is a second Tauri window on the same bundle
  (`index.html?settings`), decorated, hidden until asked, closes to hidden;
  opened by `pal-app settings`, the `pal:settings` action at the root, and
  `cmd+,` in the panel. Escape / cmd+w hide it.
- **Diagnostics carry no line numbers for unknown keys**: serde does not
  report spans for ignored keys, so `line` stays `None` and the strip shows
  the dotted path; only parse errors have a line.
- **`general.launch_at_login`** is wired through tauri-plugin-autostart
  (`autostart.rs`): a LaunchAgent `~/Library/LaunchAgents/io.cagdas.pal.plist`
  on macOS (the plist is written, not `launchctl load`ed: it takes effect at
  the next login), `~/.config/autostart/pal.desktop` on Linux. The watcher
  applies it on every change of the key, so the Settings toggle and a hand
  edit land the same way. A debug build never registers (it would point at
  `target/debug/pal`) and says so in the log. **`general.position`** is:
  `top` (20%), `centre`, `last` (leave it where it was after the first show).
- **Menu bar icon** (`tray.rs`, tauri `tray-icon`): the app has no Dock icon,
  so this is the visible way to Settings and Quit. Menu: Open pal (with the
  root hotkey as its accelerator hint), Settings… (⌘,), Restart extension
  host, Check for updates… (disabled until the updater's flow is in; the
  check itself exists, `updater::check`), Quit pal. Left click opens the menu
  (Raycast does the same). The image is `app/design/tray.svg`, the app icon
  as one colour: the slab's outline with the caret and the empty query
  inside, black on transparent as a macOS template image (`icons/tray/36x36`
  for the 18 pt bar at 2x, `18x18` for 1x), white for Linux panels
  (`22x22`). `general.menu_bar_icon = false` removes it live; `true` is the
  default and the view unsets the key for it.
- **Data is keyed by config file.** `<data dir>/pal/<profile>/{index,
  frecency.json}` where `<profile>` is `default` for `~/.config/pal/config.toml`
  and the first 8 hex of sha256 of the canonical path otherwise
  (`ConfigFile::profile` / `data_dir`; `pali.toml` on hornet is `ff8fb0c4`).
  Logged at startup as `profile`. `clipboard.db` stays one level up: it is
  history, not a view of one config. Nothing was migrated; the old
  `pal/index` and `pal/frecency.json` are dead files to delete by hand.
- **Quit** (tray, `pal quit`): the host gets EOF and up to 2 s to exit on its
  own (`Host::stop`, no respawn), then `app.exit(0)` runs the `RunEvent::Exit`
  flush of frecency and the cache saver (`quit  flushed` in the log). `pal
  quit` with no instance running prints `not running` and does not start one.
- **Dev config on hornet**: `~/.config/pal/config.toml` is v1's file, so the
  `pali` dev instance runs with `PAL_CONFIG=~/.config/pal/pali.toml` until
  `pali` takes over `main`.

- **Windows and system commands are core capabilities** (`pal_core::windows`,
  `pal_core::system`), reached as `core/windows.{list,close,minimize}` and
  `core/system.{commands,run}`; the extensions `windows` and `system` are
  thin over them. Focusing a window is a pick **effect** (`{ focus: id }`,
  effects.rs), not a bridge call, for the same reason `paste` is: the panel
  has to hide first so its orderOut hands key focus back before the target
  is activated. `system.run` hides the panel itself before running.
- **Accessibility lives in `pal_core::ax`** (moved out of clipboard.rs):
  `trusted` / `request`, plus the `AXUIElement` wrapper the window switcher
  uses. The app's toast for a missing permission is one function in
  effects.rs (`accessibility_blocked`), shared by paste and focus.
- **Both new palettes are `input: true`** so `list` runs on open and per
  keystroke (windows must be current; the keep-awake row flips), which also
  means their rows are not at the root. See the open question below.
- **macOS window list** is CoreGraphics (ids, order, bounds, on-screen)
  matched to AX windows by frame and title; titles come from AX because
  CoreGraphics only gives other apps' titles with Screen Recording. An app
  that answers AX with no windows falls back to its CoreGraphics rows. AX is
  asked per app in parallel: one read is a round trip to that app's main
  thread, 10-30 ms when it naps.
- **Linux backends** are detected, not configured: Hyprland when `hyprctl`
  and an instance signature exist (the newest `$XDG_RUNTIME_DIR/hypr/*`
  when the env var is missing, so a service-started pal works), Sway on
  `SWAYSOCK`, X11 on `DISPLAY` + `wmctrl`. Hyprland has no minimise; pal
  parks the window on `special:minimized` and `focus` brings it back to the
  active workspace.

- **Lazy detail is a palette method, `detail(id, ctx)`**, and the meta says
  `detail: "lazy"` when it exists (host/protocol.ts `Palette`). The old
  "open with the pane" flag is renamed `showDetail` so the two do not share
  a name. The UI asks when the pane is open and the cursor has rested 100 ms
  on an item whose inline detail has no markdown (`Item.lazyDetail`, set by
  `items.ts` for a lazy palette); the reply is merged over the inline one
  (markdown/metadata that came back win, the rest stays), a skeleton shows
  only when the answer is slower than 150 ms more, and a reply for an item
  the cursor has left is dropped. The host caches answers per palette and
  item id (`details` in host.ts) until that palette lists again or its
  extension reloads; the UI keeps them per level until the index changes.
  `scripts`: v1 `preview` runs there now, on demand, `preview_max` (default
  4) capping how many run at once; `prs` lists in ~40 ms instead of ~5.9 s,
  one `gh pr view` per pane rest (~1 s, then cached).
- **`list`/`pick`/`detail` take a trailing `ctx: { filter?, args? }`**
  rather than more positional strings: how the palette was opened. On the
  wire the two ride flat in the params (`filter`, `args`).
- **Filters through the core.** `PaletteMeta.filters` passes through
  `sources()`; inside a palette the Search dropdown holds them (Tab cycles),
  the first is the default and is what a plain list runs with (the core
  sends `filter: filters[0].id` explicitly, so an extension sees the same
  id either way). An indexed palette is listed again per filter
  (`index::filter`): the bucket is swapped for that filter's rows, each
  filter's list kept until the palette lists again, so the second visit is
  a swap; the page asks on every query and the core no-ops when the bucket
  already holds that filter. The root sees the filtered bucket while the
  user is inside (the filter resets to the first on leaving the level, and
  the next query restores it). An input palette gets the filter with every
  keystroke. Verified with `scripts/otp` (4) and `ha-states` (10).
- **Drill-in envelopes.** `Effect.push: { extension, palette, args? }`
  pushes a level scoped to that palette; a level with `args` is listed from
  the extension on every keystroke (never from the index), `args` reach
  `list`/`pick`/`detail` as `ctx.args`, and its picks are not remembered
  (frecency is the parent's). `Effect.show: Detail & { title? }` pushes a
  detail-only level: the Detail full width, the crumb and the footer's Back
  (Enter or Escape pop), arrows and PageUp/Down scroll, the input read-only.
  `scripts` maps v1 `{palette, env}` to `push` (env as args, exported to the
  script again; the script's rows are kept per args so a root pick still
  works after a drill-in listing) and v1 `show` to `show`.
- **`keep` lists an indexed palette again** (`index::pick`), so "stay open
  and list again" holds for every palette, not only input ones: a closed
  window is gone from the next query.
- **Live palettes at the root.** A `live` palette that is not `input`
  (windows, otp) is in the index and listed again on every `pal://shown`
  (`index::on_shown`), all at once, 2 s each, one `pal://index` at the end,
  spawned after the event so the paint never waits: hotkey to paint stayed
  at 1-4 ms with two live palettes; the relist itself is ~15-20 ms for
  windows and ~300 ms for otp (its script reads the Messages db), and a
  palette that misses the timeout keeps its old rows for that show.
  `windows` is plain `live` now, so window titles are root results.
- **Palette rows carry the extension title as subtitle** (Raycast shows the
  extension name), left out when it equals the palette's title (Windows /
  Windows). Root sections stay ordered by best hit.

- **The index is persisted.** Every default listing is written to
  `<data dir>/pal/index/<extension>/<palette>.json` (`app/src-tauri/src/
  cache.rs`: the wire items, `listed_at`, the palette meta and the extension
  title; atomic, debounced 500 ms per source; a palette over 50k items is not
  written). At startup, before the host is spawned, `index::restore_cache`
  puts every file back (items flagged `stale`, registry entry, palette row,
  palette hotkeys), so the root answers from the previous run: first query
  answer 32 items at ~400 ms cold vs the full corpus (~15.5k items) at
  ~400 ms warm, where the full corpus used to land ~10 s after host spawn
  (the scripts extension). `host/ready` prunes files of extensions no longer
  on disk (`known` in its params; a failed-to-load one keeps its cache).
  Order of the restored buckets: `pal/palettes`, then `apps`, then by name,
  so a cold frecency profile's empty query still leads with palette rows
  and apps.
- **`ttl` is a palette meta field** (seconds, from the palette object or
  the manifest's `palettes.<key>.ttl`; `scripts` maps v1's `ttl`, else its
  own `ttl` setting). On `extension/loaded` the core lists a palette again
  now when it has no `ttl` (as before), leaves the restored rows when the
  cached listing is younger than the `ttl`, and otherwise queues it for one
  sequential pass 1 s after `host/ready` (`refresh_expired`). `live` still
  re-lists on show. `SourceInfo.stale` on the wire means "a listing is
  pending for this source"; the footer shows "updating…" and the search
  sweep while the current scope has one. `index_refresh(source?)` and the
  `pal:refresh` action (cmd+r) force a listing past any `ttl`; the `list`
  then carries `refresh: true` in its ctx so an extension's own cache steps
  aside.

## Open for Cagdas

Things an agent could not decide alone; each waits for a call.

- **HUD after copy.** The panel is the only window and goes to alpha 0 on
  hide, so a Raycast-style "Copied" HUD needs a second small NSPanel. Worth
  one, or is the hide itself enough feedback?
- **Exact-name priority vs frecency.** A frecency-boosted item (a picked
  emoji) can outrank a bookmark named exactly what was typed (`ha`). Raycast
  gives exact alias/name matches priority over history. Same here?
- **Config path once `pali` ships.** v1 and pal both want
  `~/.config/pal/config.toml`; pal's file format is not v1's. Migrate v1's
  file aside on first run, or keep `pali.toml` for a while?
- **Font, match highlight, selection shape** from the brief (bundled Plex vs
  system stack; amber highlighter vs coloured glyphs; inset pill vs full-bleed
  row). Unchanged until you have used the panel.
- **v1 config lines to fix by hand** once v1 stops reading the file:
  `[palette.ha-states]`/`[palette.ha-services]` still say
  `base = "~/proj/pal/plugins/..."` (the old checkout); the `scripts`
  extension falls back to `~/proj/pal-v1` so they load, but the file should
  say where they really live.
- **`ssh` and `psg`** were v1 builtins and show as inert rows under `scripts`.
  Reimplement as real extensions (small: `~/.ssh/config` parser; `ps` + kill)?
- **Live palettes relist on every show.** `otp` (a script) costs ~300 ms
  of background work per show, after the paint; fine for two palettes, a
  budget question once user extensions declare `live` freely. A per-palette
  `ttl` (skip the relist when the last one is fresher) is the obvious knob.
- **`ttl` default.** No v1 plugin on hornet declares one, so every
  `scripts` palette still runs on every start (in the background now, the
  root is already answered). Give palettes without a `ttl` a default (an
  hour?), or leave "no ttl = always fresh" and set `[extensions.scripts]
  ttl` by hand? (The cache is keyed per config file now, see above.)
- **`show`'s metadata.** The show level renders the Detail, so v1's
  `show.metadata` comes along; the brief said markdown only. Keep or drop?
- **Focus without Accessibility.** The core can still activate the app
  (not the window) when the permission is missing; the effect shows the
  same toast as paste instead of half-doing it. Keep that, or activate and
  toast?
- **`SACLockScreenImmediate`** (private login.framework) is what Lock Screen
  uses, with the Cmd+Ctrl+Q keystroke as the fallback; fine for a downloaded
  app, not for the App Store.
- **Do Not Disturb on macOS** runs a Shortcut named "Toggle Do Not Disturb"
  when one exists (Focus has no CLI); the row is hidden otherwise. Ship a
  first-run hint to create it?
- **macOS window focus/minimize unverified**: AX returns zero windows while
  the screen is locked, which it was for the whole overnight run. Check when
  unlocked: `cargo run -q -p pal-core --example windows -- list`, then
  `focus <kitty id>`, `minimize <id>`, `list` (shows `min`), `focus <id>`
  (restores); `cargo run -q -p pal-core --example system -- run show-desktop`
  twice.
- **Contradictions the docs pass found** (2026-09-16 06:30), to fix in code,
  not paper over: clipboard `max_entries`/`max_age_days` mean list limits in
  the manifest but recorder retention in `app/src-tauri/src/clipboard.rs`
  (an explicit `max_age_days = 0` deletes every unpinned entry); an explicit
  `exclude_apps = []` drops the Keychain/Passwords protection the absent-key
  default gives; `alias` is an extra keyword on the palette row, not a jump,
  while the schema doc says jump; extension settings receive `keychain:`
  references unresolved (nothing calls `secrets::resolve`); the settings
  window's cmd+w checks `metaKey` only, so Super+W on Linux; the deb does not
  declare `libayatana-appindicator3-1`.
