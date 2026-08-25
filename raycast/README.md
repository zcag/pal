# pal for Raycast

Runs [pal](../) palettes as native Raycast views. Every palette you have in
`~/.config/pal/config.toml` shows up here - the same bash plugins and data
files that back fzf and rofi, rendered with icons, accessories, detail panes
and action panels.

## How it works

pal normally drives the frontend: it lists items, pipes them into fzf or rofi
as a subprocess, and gets a selection back. Raycast can't be driven that way -
it's a resident app - so this extension inverts the flow and drives pal:

| Extension does | pal command |
|---|---|
| List palettes | `pal meta` |
| Configure the view | `pal meta <palette>` |
| List items | `pal list <palette> [--query …]` |
| Run an item | `pal pick <palette> [--action id]` (item JSON on stdin) |

A pick may answer with a result envelope (`toast`, `hud`, `clipboard`, `open`,
`show`, `reload`, `close`), which becomes the matching Raycast feedback.

## Setup

1. Install pal (`cargo install rpal`) - this extension needs `pal meta` and
   `pal pick`, so a build with the driver API.
2. Run the extension. If the `pal` binary isn't found, set its full path in the
   extension preferences.

The first run resolves your login shell's `PATH` and caches it, because
Raycast's node runtime starts with a minimal one and pal's plugins shell out to
`jq`, `gh`, and whatever else you use. "Reload Shell Environment" in the action
panel re-resolves it.

## Palette commands

By default there's one **Pal** command that lists every palette. To give a
palette its own root-search keyword and hotkey:

```bash
npm run sync -- --enable otp,tabs,cmds
```

This reads `pal meta` and writes one Raycast command per palette (plus its
entry file). Palettes you don't `--enable` are generated but marked
`disabledByDefault`, so you can switch them on in Raycast's settings without
regenerating.

Re-run it whenever you add a palette.

## Item fields it renders

Everything below is optional; palettes that don't set them still work.

| Field | Becomes |
|---|---|
| `name`, `subtitle`, `keywords` | Title, subtitle, extra search terms |
| `icon` / `icon_xdg` / `icon_utf` / `icon_rc` | Item icon - freedesktop names and emoji are mapped to Raycast icons; `icon_rc` names one directly |
| `color` | Icon tint |
| `accessories[]` | Right-hand text, relative dates, and coloured tags |
| `section` | List section |
| `detail` | Detail pane: markdown plus a metadata sidebar |
| `preview` | Shell command run for the selected item, output shown in the detail pane with the item's `PAL_*` variables set |
| `actions[]` | Action panel entries, with `shortcut`, `style: destructive` and `confirm` |
| `quicklook` | Quick Look preview |
| `url` | Favicon fallback when there's no icon |

Palette-level `view = "grid"` renders tiles instead of a list, and items
carrying a hex colour become swatches.
