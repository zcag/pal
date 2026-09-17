# Emoji

A grid of every emoji in the bundled list, searched by name, keyword and
shortcode. The tile is the glyph; the name is the shortcode with spaces
(`thumbs up`), and `thumbs_up`, `:thumbs_up:` and the keywords
(`approve`, `+1`) are what the search also matches.

Sections: **Recently used** first (the last 24 you copied or pasted, kept
in the extension's storage), then Unicode's groups in their order: Smileys
& Emotion, People & Body, Animals & Nature, Food & Drink, Travel & Places,
Activities, Objects, Symbols, Flags. The palette is live with a 30 s
`ttl`: the order is the sections' own, never frecency's, and a show more
than 30 s after the last listing lists again so the recents follow what
you used.

`data.json` carries the emoji, its shortcode name, the keywords, the
category and whether a skin tone applies to it (the names and keywords
are emojilib's, the categories and the skin flag unicode-emoji-json's).

## Keyboard

In the grid, arrows move across and down the tiles, `cmd+1` to `cmd+9`
jump to a tile, `Enter` runs the first action of the tile under the
cursor.

| keys | action |
| --- | --- |
| `enter` | Copy emoji |
| `cmd+enter` | Paste emoji into the app that was in front |
| `cmd+shift+c` | Copy shortcode: `:thumbs_up:` |
| `cmd+k` | The three actions |

With `paste_by_default` on, `Enter` pastes and `cmd+enter` copies. A copy
or a paste moves the emoji to the front of Recently used.

## Setup

Nothing to install. Pasting is a synthesised Cmd+V, which macOS only
delivers from a process on the Accessibility list: without the permission
pal shows the system prompt once per run and a toast saying what to grant
(System Settings > Privacy & Security > Accessibility). Copying needs
nothing. On Linux the paste is Ctrl+V through `wtype`, else `ydotool`
(which needs `ydotoold` running); with neither, paste fails and the toast
says so.

Settings, `[extensions.emoji]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `skin_tone` | `none`, `light`, `medium-light`, `medium`, `medium-dark`, `dark` | `"none"` | The Fitzpatrick modifier applied where an emoji takes one (329 of them: hands, people), in the tile, on copy and on paste. |
| `paste_by_default` | bool | `false` | `Enter` pastes into the app in front, `cmd+enter` copies. |
| `keywords` | list of lines | `[]` | Your own search words: `rocket: ship deploy`, `🎉: party, woo` (a shortcode or the emoji, a colon, the words). A line naming no emoji is ignored; the words join the emoji's own for search. |

The modifier goes after the first code point, which tones a single person
and the first person of a family or profession sequence; a two-person
sequence gets one tone, on its first person.

Per palette, `[palettes.emoji.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads: after a change, Settings > Restart extension host. |

## What it does not do

- Expand `:shortcode:` as you type in other apps: pal copies or pastes on
  Enter, there is no text expansion.
- Tone each person of a two-person sequence differently; one tone, on the
  first.
- Search by the emoji's Unicode name (`GRINNING FACE`); the names are
  shortcodes. The Unicode characters palette has the named symbols.
- Show the emoji large in a detail pane; the tile is the whole picture.

## Platforms

macOS and Linux. The glyphs are drawn by the platform's colour emoji font,
so what a tile looks like is the OS's; paste needs Accessibility on macOS
and `wtype` or `ydotool` on Linux.
