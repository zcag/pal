# Icons

Two grids of glyphs to copy into a script's `icon`, a bar item or a
config, and a third over Iconify's sets for an SVG.

**Nerd Font icons** is every glyph in the Symbols Nerd Font the app
bundles (`app/src/assets/fonts`, Nerd Fonts 3.5.1): 10995 glyphs, one
section per set in a fixed order (Material Design, Font Awesome,
Codicons, Octicons, Devicons, Seti, Weather, Font Logos, Font Awesome
Extension, Powerline, Powerline Extra, Pomicons, IEC Power, Custom, Extra,
Indent). The tile is the glyph, the name is the set's name with spaces
(`account circle`), the code point is the subtitle and the
`nf-md-account_circle` name a keyword, so `md-account` or `f0009` finds
it. The last twelve picked lead in a **Recent** section, kept in the
extension's storage.

The detail pane (`cmd+i`) names the set and the Nerd Fonts version, the
code point, the CSS class and the `\u{f0009}` escape; it does not draw
the glyph large, since the pane's text is the UI font and only the icon
box uses the bundled symbols font.

**Freedesktop icon names** is the 114 freedesktop names the SDK's `xdg()`
maps to a glyph (`sdk/src/icons.ts`, what a script's `icon_xdg` may say),
each drawn with its glyph and its Nerd Font name as the subtitle. pal
draws only the names in that table, so nothing larger is listed: a name
outside it would render as nothing.

**Iconify Icons** searches every set Iconify hosts (Material Design
Icons, Tabler, Lucide, Phosphor, Simple Icons, Heroicons and the rest,
some 200k icons) over its public API as you type: `/search?query=` for
the names, then one `/<prefix>.json?icons=` per set for the SVG bodies,
250 ms after the last keystroke, cached per word and per icon for the
process. Each tile is the icon's own SVG, filled mid-grey so it reads
on both the light and the dark panel (Iconify draws in `currentColor`,
which a picture cannot inherit); the set is the section. `Enter` copies
the SVG with `currentColor` kept, `cmd+enter` the `mdi:home` name,
`cmd+shift+d` a `data:image/svg+xml` url (what an `{ image }` icon or a
CSS background takes), `cmd+o` opens the icon's page on
icon-sets.iconify.design, `cmd+s` writes `<prefix>-<name>.svg` into the
`save_to` folder (`-2` when the name is taken). Nothing typed lists
nothing; no hit, a rate limit or an unreachable API is one hint row.
The `sets` setting narrows a search to those prefixes.

## Keyboard

In any grid, arrows move across and down the tiles and `Enter` runs
the first action of the tile under the cursor.

Nerd Font icons:

| keys | action |
| --- | --- |
| `enter` | Copy glyph: the character itself |
| `cmd+enter` | Copy code point: `U+F0009` |
| `cmd+shift+n` | Copy name: `nf-md-account_circle` |
| `cmd+shift+c` | Copy CSS class: `nf nf-md-account_circle` |
| `cmd+i` | The detail pane |

Freedesktop icon names:

| keys | action |
| --- | --- |
| `enter` | Copy name: `folder-open` |
| `cmd+enter` | Copy glyph |
| `cmd+shift+u` | Copy code point |

Iconify Icons:

| keys | action |
| --- | --- |
| `enter` | Copy SVG: the whole file, `currentColor` kept |
| `cmd+enter` | Copy name: `mdi:home` |
| `cmd+shift+d` | Copy as data URL |
| `cmd+o` | Open on icon-sets.iconify.design |
| `cmd+s` | Save SVG into the `save_to` folder |

## Setup

Nothing to install and no permission. The glyph table is generated: `bun
run extensions/icons/build.ts` fetches `glyphnames.json` at the pinned
release and writes `data.json` (282 KB, `[name, code]` pairs by set),
committed; bump the version in the script together with the font.

Iconify needs the network and no key. Settings, `[extensions.icons]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `sets` | list | `[]` | Set prefixes the Iconify search is limited to (`mdi`, `tabler`, `lucide`, `phosphor`, `simple-icons`). Empty: every set. |
| `save_to` | path | `~/Downloads` | Where Save SVG puts an Iconify icon. `~` is expanded. |

Per palette, `[palettes.icons.settings]` and `[palettes.iconify.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` (Iconify `8`) | Tiles per row in the grid. Read once when the extension loads: after a change, Settings > Restart extension host. |

The freedesktop grid is 10 columns, not configurable.

A listing is eleven thousand rows (about 3.4 MB over the host's pipe) on
every start, as the palette has no `ttl`; the rows carry the least they
can for that (the set is the section, the code is in the subtitle).

## What it does not do

- Draw a glyph outside the bundled font: the tiles are the Symbols Nerd
  Font the app ships, so a glyph a newer Nerd Fonts release added is not
  in the table until the font and `build.ts` are bumped together.
- Show the glyph large in the detail pane (the pane's text is the UI
  font).
- Paste: every palette copies.
- Recolour an Iconify SVG: the copy keeps `currentColor`; the data url
  keeps it too (a CSS `background` shows it black).
- Search Iconify offline: the tiles are fetched per search, nothing is
  bundled; a search that failed is not cached, so `cmd+r` asks again.
- List the larger freedesktop icon set of pal v1: only the names pal can
  draw are rows.

## Platforms

macOS and Linux, the same on both: the font is bundled, nothing is read
from the system; Iconify is `api.iconify.design` over https.
