# Icons

Two grids of glyphs to copy into a script's `icon`, a bar item or a
config.

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

## Keyboard

In either grid, arrows move across and down the tiles and `Enter` runs
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

## Setup

Nothing to install and no permission. The glyph table is generated: `bun
run extensions/icons/build.ts` fetches `glyphnames.json` at the pinned
release and writes `data.json` (282 KB, `[name, code]` pairs by set),
committed; bump the version in the script together with the font.

No extension settings. Per palette, `[palettes.icons.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads: after a change, Settings > Restart extension host. |

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
- Paste: both palettes copy.
- List the larger freedesktop icon set of pal v1: only the names pal can
  draw are rows.

## Platforms

macOS and Linux, the same on both: the font is bundled, nothing is read
from the system.
