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
| `{selection}` | the same as `{clipboard}` (Raycast's spelling; pal cannot read the selected text) |
| `{date}` | today, `YYYY-MM-DD` |
| `{time}` | now, `HH:MM` |
| `{datetime}` | both, with a space between |
| `{uuid}` | a fresh UUID, a different one per occurrence |

Anything else in braces is left as it is, so a snippet of code keeps its
braces. A snippet with placeholders carries a `dynamic` accessory.

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

## What it does not do

- No expansion by typing: Raycast expands a keyword typed in another app;
  pal pastes on Enter from the panel.
- `{cursor}` is not supported: pal pastes the text whole and cannot place
  the caret, so it is left in the text as typed.
- `{selection}` is the clipboard, not the selected text: copy first.
- No rich text: what is pasted is plain text.

## Platforms

macOS and Linux. Paste needs Accessibility on macOS and `wtype` or
`ydotool` on Linux; everything else is the same on both.
