# The model: features, extensions, surfaces

Design spec, 2026-09-23. Where each thing in pal belongs, and the reshape
that gets the code there. Status: agreed with Cagdas 2026-09-23. Phases 1 and 2 built the same
day (features, their commands and hotkeys, the Features page, the
migration); the rest below as planned.

## Why

`notes/decisions.md` ("Extensibility, one way") made every palette an
extension with no native tier. That is right for palettes. It gave no home
to the things pal grew later that are not palettes: an event tap, a key
listener, a window watcher. They borrowed one:

- The app compiles extension manifests in to get a settings schema, and
  reads `[extensions.<name>]`: `mouse.rs`, `keycast.rs`, `clipboard.rs`,
  `expansion.rs` (snippets), `reserve.rs` (window-management).
- `expansion.rs` reads the snippets extension's storage file.
- The extension is left as a remote control: `extensions/mouse` is rows
  that flip settings over 739 lines of `mouse.rs`; keycast's palette is
  start, stop and switches, and the shell publishes `keycast/*` states
  under the extension's name.
- The switcher and the sidebar are spread over `[general] app_switcher`,
  `[palettes.windows] hold`, `[sidebar]`, three Settings pages, and
  `switcher.rs` special-cases `windows/windows`.

The bar has the same problem one level down: an item has no settings of
its own, so it borrows its extension's through `"bar": "<id>"` or a
`bar_` prefix, and one item is configured on two Settings pages.

## The shape

```
pal
├── Features     built into the app, run on their own, not installable
├── Extensions   TypeScript plugins, installable, replaceable
└── Surfaces     where things show: panel, bar, sidebar, switcher, popover, HUD
```

Features and extensions provide; surfaces show. What each provides:

| Piece | What | Feature | Extension |
| --- | --- | --- | --- |
| Settings | values the user sets | `[features.<id>]` | `[extensions.<name>]` |
| Commands | one named action | yes (toggles automatic) | rows, as today |
| Palettes | rows to browse | no | yes |
| Bar items | glanceable status | yes (native render) | yes |
| States | named facts | `<feature>/<name>` | `<ext>/<name>` |

Rule of thumb for where a new thing goes:

- runs in the background in Rust, never uninstalled: a **feature**
- a list of rows to browse: a **palette** in an extension
- one action: a **command**
- glanceable status: a **bar item**, which owns its settings
- a fact others react to: a **state**

The healthy pattern stays as it is: Rust provides a capability
(`core/audio.*`, `core/wifi.*`, `core/windows.*`), an extension builds
rows over it. A feature may also expose a capability an extension builds
on; the direction is always extension → feature, never the reverse.

## Features

A feature is a Rust module plus a spec, `core/features/<id>.json`:

```json
{
  "id": "mouse",
  "title": "Mouse & Trackpad",
  "description": "Three-finger middle click and scroll direction per device.",
  "icon": { "tile": { "glyph": "…", "bg": "slate" } },
  "platforms": ["macos"],
  "permission": "accessibility",
  "settings": [ { "kind": "boolean", "id": "middle_click", … } ],
  "commands": [ { "id": "start", "title": "Start keycast" } ],
  "states": { "active": { "description": "…", "kind": "boolean" } },
  "bar": { "active": { "title": "…" } }
}
```

- `settings` is the same `SettingSpec` extensions use, so the Settings
  window renders it with the same fields. Values live in
  `[features.<id>]`; the defaults are the spec's (`spec_defaults`), read
  the way `extension_settings` reads an extension's.
- A `boolean` setting is a command without being declared: `Toggle
  <label>` at the root, `pal command <id>.<setting>`, `pal://commands/<id>.<setting>`,
  a hotkey. `"command": false` on the setting opts out.
- Declared `commands` are the feature's own actions, the same surfaces.
- Hotkeys for a feature's commands: `[features.<id>.hotkeys] <command> = "…"`.
- A command is a row of pal's own source (`pal/commands`, id
  `<feature>.<command>`), so ranking, frecency, `pal command` and
  `pal://commands/…` needed nothing new; extensions keep contributing
  single actions as rows (and `item_hotkeys`), which is already the same
  thing, so no extension-side command API was added.
- States a feature publishes are `<id>/<name>`; the spec declares them for
  the States palette.
- A bar item a feature declares is rendered by the app, never the host
  (`bar::register_native`, `features::bar_item`), keyed `<id>/<item>` like
  an extension's.

The features:

| Feature | Was | Settings |
| --- | --- | --- |
| `clipboard` Clipboard history | recorder half of `extensions/clipboard` | `exclude_apps`, `max_entries`, `max_age_days` |
| `expansion` Text expansion | expansion half of `extensions/snippets` | `enabled`, `prefix`, `exclude_apps`, `hud` |
| `mouse` Mouse & Trackpad | `extensions/mouse` | the six switches |
| `keycast` Keycast | `extensions/keycast` | all ten, plus start/stop/toggle and mode commands, the `active` bar item, the `active`/`mode` states |
| `reserve` Keep below bar | `keep_below_bar`, `bar_height` of `extensions/window-management` | `enabled`, `bar_height` |
| `switcher` Window switcher | `[general] app_switcher`, the windows palette's `hold` | `app_switcher`; the chord stays the palette's `hold` (any palette can be held) |
| `sidebar` Sidebar | `[sidebar]` | the table as it is |

Extensions that go away: `mouse`, `keycast`. Extensions that shrink:
`clipboard` (keeps the palettes and `ocr_concealed`, `primary_action`),
`snippets` (keeps the palette), `window-management` (keeps layouts).

**Snippets' data.** The snippets move from the extension's storage to the
expansion feature's (`storage/expansion.json`, key `snippets`, moved once
at startup), and the feature exposes `core/snippets.{list, set}`; the
snippets extension is a palette over that capability. A replaced or removed snippets extension no
longer breaks expansion, and nothing reads another's storage.

**Switcher.** The quick tap (release before the show, switch without
painting) becomes a palette flag the windows palette sets (`tap: true` in
its manifest), not `== "windows/windows"` (phase 5, with the other
special cases).

## Bar items own their settings

- `bar.<id>.settings` in the manifest (`SettingSpec[]`), values in
  `[bar.items."<key>".settings]`, handed to `render` as `ctx.settings`.
- `"bar": "<id>"` on an extension setting and the `bar_` prefix go away.
  A setting only the item reads moves to the item; one the palette also
  reads stays on the extension (and is no longer on the Bar page).
- Settings › Extensions stops listing item settings; Settings › Bar has
  them on the item's pane, the only place.

The settings that move (audited per extension in phase 3):
bluetooth `low_threshold`, displays `bar_display`, github
`review_requests`, hue `main_room`/`bar_scenes`, media `bar_artwork`,
network `networks`, odak `today_sections`, otp `hours`, sessions
`agents`/`stale_minutes`, spotify `bar_lyrics`, stats `*_label`/`disk_hide`,
system `awake_presets`; window-management `bar_height` goes to `reserve`.

## Settings window

```
Overview    what needs attention
General     hotkey, theme, startup, search behaviour
Features    NEW: one card per feature, switch + status + permission on the card
Extensions  installed plugins; their palettes inside them
Bar         bar items, each with all its settings
Shortcuts   every hotkey in one list
About
```

- Features is cards, not a master/detail list: seven features, each
  glanceable (on/off, running, what it needs), its settings unfolding in
  place. The same idea is what the Extensions page's redesign starts from
  (later, with Cagdas).
- The Palettes page folds into Extensions (phase 4).
- The Sidebar card leaves General, its Bar row goes; the switcher's
  pieces leave General and Palettes. Both are Features cards.

## Config

The file mirrors the window one to one. A config written before this is
rewritten once at load (`core/src/config/migrate.rs`, logged, the old
file kept as `config.pre-model.toml`):

| From | To |
| --- | --- |
| `[extensions.mouse]` | `[features.mouse]` |
| `[extensions.keycast]` | `[features.keycast]` |
| `[extensions.clipboard] exclude_apps, max_entries, max_age_days` | `[features.clipboard]` |
| `[extensions.snippets] expand, expand_prefix, expand_exclude_apps, expand_hud` | `[features.expansion] enabled, prefix, exclude_apps, hud` |
| `[extensions.window-management] keep_below_bar, bar_height` | `[features.reserve] enabled, bar_height` |
| `[general] app_switcher` | `[features.switcher] app_switcher` |
| `[sidebar]` | `[features.sidebar]` |
| `[palettes.keycast]`, `[palettes.mouse]` | dropped (the palettes are gone) |
| `[bar.items."keycast/active"]` | kept (the feature's item has the same key) |
| a bar-item setting in `[extensions.x]` | `[bar.items."x/<id>".settings]` (phase 3) |

## Phases

1. **Features.** The spec files, `[features.*]`, the Features page, the
   migration; mouse, keycast, clipboard recorder, expansion (with the
   snippets data move), reserve, switcher, sidebar out of extensions and
   `[general]`. `extensions/mouse` and `extensions/keycast` deleted.
2. **Commands.** Feature commands and the automatic toggles as root rows
   (`pal/commands`), `pal command`, `pal://commands/…`, hotkeys, listed on
   Shortcuts.
3. **Bar item settings.** `bar.<id>.settings`, `ctx.settings`, the audit
   above, Settings › Bar the only place; `bar:`/`bar_` removed.
4. **Settings IA.** Palettes into Extensions; Shortcuts as the full list.
   Then the Extensions page redesign, with Cagdas.
5. **Leftover special cases.** `media.rs`'s `"media"` trigger, the
   `calendar` permission id (a manifest `permissions` list), `store`'s
   palette in `commands.rs`, `Launcher.tsx`'s push to `files/files`,
   `index.rs` putting `apps` first.

Not in scope, noted: one spelling of a palette's id (`github-prs` in the
file, `github/prs` everywhere else) is a large migration with little
user-facing gain; revisit after phase 4. The eight ways a bar item can be
hidden (`bar.md`, Appearance) get their own pass after phase 3.
