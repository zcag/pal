# Snippets

Short texts by name and keyword, kept in the extension's storage and
edited in the panel. Enter pastes the text into the app that was in front,
`cmd+c` copies it instead. The keyword is a row keyword, so typing `sig`
finds the signature; it shows as a tag, the first line of the text is the
subtitle, and the whole text is in the detail pane (`cmd+i`) with its
keyword and length.

Placeholders in the text are filled in when it is pasted or copied:

| placeholder | becomes |
| --- | --- |
| `{clipboard}` | the newest text on the clipboard |
| `{selection}` | the text selected in the app in front (the clipboard when nothing is) |
| `{files}` | the files selected in Finder, one path per line (`{files sep=", "}` joins them otherwise); nothing when Finder is not in front or nothing is selected |
| `{date}` | today, `YYYY-MM-DD` |
| `{time}` | now, `HH:MM` |
| `{datetime}` | both, with a space between |
| `{uuid}` | a fresh UUID, a different one per occurrence |
| `{snippet name=sig}` | another snippet's text (by name or keyword), its own placeholders filled; one level deep |
| `{cursor}` | where the caret lands after an expansion (below); dropped by a paste from the panel |

`{date}`, `{time}` and `{datetime}` take two attributes: `format=`, with
the tokens `YYYY` `YY` `MM` `DD` `HH` `mm` `ss` `ddd` (Wed) `MMM` (Sep) and
anything else written as it is (`{date format=DD.MM.YYYY}`, `{time
format=HH:mm:ss}`, quotes around a format with spaces: `{date format="ddd
D MMM"}`), and `offset=`, a signed count of days, weeks, hours or minutes
applied first (`{date offset=+1d}`, `{date offset=-2w}`, `{time
offset=+3h}`, `{datetime offset=-90m format=HH:mm}`).

Anything else in braces is left as it is, so a snippet of code keeps its
braces. A snippet with placeholders carries a `dynamic` accessory. The
grammar is the SDK's (`expand` in `@zcag/pal`), shared with quicklinks
(`{selection}` in a url) and obsidian (an appended line).

The palette is indexed, so a snippet's name and keyword find it from the
root, and the rows around the list are its tools:

| row | what |
| --- | --- |
| Create Snippet | a form: name, keyword (one word, no spaces), text |
| Import Snippets | a form with one path field; reads a JSON array of `{name, text, keyword?}` (Raycast's export too), skips a snippet whose name and text you already have, says how many came in |
| Export Snippets | writes your snippets as a JSON array (no ids) to the path, `~/Downloads/pal-snippets.json` by default, replacing the file |

A keyword with a space in it is refused with the message under the field,
as is a path that cannot be read or written.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Paste: hides, then pastes the filled text into the app in front |
| `cmd+c` | Copy the filled text |
| `cmd+e` | Edit: the form, filled in |
| `ctrl+x` | Delete, after a confirm |
| `cmd+i` | The detail pane, with the whole text |

## Setup

No settings. The snippets live in `<data dir>/pal/storage/snippets.json`
(Storage in the Extensions guide), shared by every config profile.

Paste is a synthesised Cmd+V, which macOS only delivers from a process on
the Accessibility list: without the permission pal shows the system prompt
once per run and a toast, "Paste needs Accessibility", instead of
half-doing it. On Linux the paste is Ctrl+V through `wtype`, else `ydotool`
(which needs `ydotoold` running); with neither, paste fails and the toast
says so. Copy needs nothing.

An import file looks like this:

```json
[
  { "name": "Email signature", "keyword": "sig", "text": "Best,\nAda" },
  { "name": "Today", "keyword": "today", "text": "{date} {time}" }
]
```

## Expansion: the keyword typed in any app (macOS)

With `expand = true` in `[extensions.snippets]`, a keyword typed in any
other app is replaced by its snippet in place: `;sig` becomes the
signature where it was typed, placeholders filled (the plain forms:
`format=`, `offset=` and `{snippet}` are the panel's, an expansion
leaves them as written), the clipboard left as it was, `{cursor}` placing
the caret. Off by default. pal watches the
keys typed in other apps (needs Input Monitoring) and types the
replacement (needs Accessibility, like Paste). The prefix is a setting
(`;`, `:`, or none for the bare keyword at a word start); terminals and
password managers never expand (`expand_exclude_apps`), nor does a secure
text field; the HUD says "Expanded <name>" (`expand_hud`). Not available
on Linux, where no portable keyboard tap exists: the palette's Enter and
`pal://snippets/paste?name=sig` are the ways there.

## What it does not do

- No rich text: what is pasted is plain text.
- No expansion on Linux (above).

## Platforms

macOS and Linux. Paste needs Accessibility on macOS and `wtype` or
`ydotool` on Linux; everything else is the same on both.
