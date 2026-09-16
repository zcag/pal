# Unicode characters

A grid of 1795 characters one pastes rather than types, from
`extensions/unicode/data.json`: arrows, math, Greek, currency, quotes and
dashes, punctuation, typographic and zero-width spaces, superscripts and
fractions, accented Latin letters (the Turkish, German, French, Nordic
and Spanish sets), letterlike symbols, the Mac keyboard glyphs (⌘ ⌥ ⇧ ⌃ ⎋
⏎ ⌫ ⇥ ⏏ and the control pictures), check marks, box drawing and block
elements, geometric shapes, miscellaneous symbols, dingbats, enclosed
numbers and letters.

The tile is the glyph (a space shows as the open box `␣`); the name is
the Unicode name in lower case; the code point is the subtitle; the
section is the block. The search matches the name, the code point (`2192`
or `u+2192`), the HTML entity names (`rarr`, `nbsp`), the LaTeX command
where there is an obvious one (`\rightarrow`, `\alpha`), the character's
Unicode 1.0 name (`command key`) and plain words (`cmd`, `turkish`,
`tick`, `eur`).

The last twelve characters copied lead the grid in a **Recent** section
(kept in the extension's storage) and leave their block while they are
there. The section is rebuilt when the palette lists again (at start, on
`cmd+r`); between listings the core's frecency already moves a picked
tile up.

The detail pane (`cmd+i`) shows the glyph large, the block, the code
point, both HTML forms, the UTF-8 bytes (`E2 86 92`), the LaTeX command
and the aliases.

## Keyboard

In the grid, arrows move across and down the tiles and `Enter` runs the
first action of the tile under the cursor.

| keys | action |
| --- | --- |
| `enter` | Copy character |
| `cmd+enter` | Paste it into the app that was in front |
| `cmd+shift+u` | Copy code point: `U+2192` |
| `cmd+shift+e` | Copy HTML entity: `&rarr;`, or `&#x2192;` for a character without a named entity |
| `cmd+shift+n` | Copy numeric reference: `&#x2192;` |
| `cmd+i` | The detail pane |
| `cmd+k` | Every action |

## Setup

Nothing to install. Pasting is a synthesised Cmd+V, which macOS only
delivers from a process on the Accessibility list: without the permission
pal shows the system prompt once per run and a toast saying what to grant
(System Settings > Privacy & Security > Accessibility). Copying needs
nothing. On Linux the paste is Ctrl+V through `wtype`, else `ydotool`
(which needs `ydotoold` running).

The table is generated: `bun run extensions/unicode/build.ts` fetches
`UnicodeData.txt` (names) and the WHATWG `entities.json` (entity names),
applies the sections, LaTeX and keyword tables in the script, and writes
`data.json` (160 KB), which is committed. The whole UCD is not shipped;
add a range or a code point to the script's `SECTIONS` to widen the
table.

No extension settings. Per palette, `[palettes.unicode.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads: after a change, Settings > Restart extension host. |

## What it does not do

- Every Unicode character: 1795 curated ones, by block. A code point
  outside the table finds nothing; widen `SECTIONS` in `build.ts`.
- Emoji: they have their own palette (Emoji), with shortcodes and skin
  tones.
- Compose characters (a base letter plus a combining mark); the accented
  letters are the precomposed ones.
- Type a code point to get its character as an input palette would; the
  grid is searched, so `2192` finds the arrow's tile.

## Platforms

macOS and Linux. The glyphs are drawn by the system font, so a character
the font lacks shows as its fallback box; paste needs Accessibility on
macOS and `wtype` or `ydotool` on Linux.
