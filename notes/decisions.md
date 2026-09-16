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
- **`general.launch_at_login`** is a key the view writes; registering the
  login item is not wired. **`general.position`** is: `top` (20%), `centre`,
  `last` (leave it where it was after the first show).
- **Dev config on hornet**: `~/.config/pal/config.toml` is v1's file, so the
  `pali` dev instance runs with `PAL_CONFIG=~/.config/pal/pali.toml` until
  `pali` takes over `main`.

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
