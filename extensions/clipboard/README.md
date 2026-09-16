# Clipboard History

What you copied, searchable, with images. Text, images and file lists are
recorded by a watcher that runs while pal runs; the search is SQLite
full-text search over the text, on every keystroke inside the palette
(an input palette, so the entries are never at the root). Pinned entries
sit in a **Pinned** section at the top, the rest follow newest first.

The palette opens with the detail pane showing: the full text (fenced),
the image, or the file list, with kind, size, source app and time as
metadata. A row that is a single url gets the site's favicon and an Open
link action; a row that is one colour (`#hex`, `rgb()`) has the colour
itself as its icon. The source app and the time are accessories, an image
row shows its size next to its dimensions, and a pinned entry carries a
`pinned` tag.

The filter dropdown (Tab cycles it) narrows by kind: All, Text, Images,
Files, Links (text that is one url) and Colors.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Paste: hides the panel and pastes the entry into the app that was in front |
| `cmd+enter` | Copy: puts the entry back on the clipboard |
| `cmd+o` | Open link, on an entry that is one url |
| `cmd+shift+v` | Paste as plain text, on a text entry |
| `cmd+shift+c` | Copy image file, on an image: the PNG the recorder keeps, as a file |
| `cmd+p` | Pin / Unpin: pinned entries sort first and never expire |
| `cmd+d` | Delete the entry; asks first |
| (action panel) | Delete all unpinned: every unpinned entry, one by one; asks first |
| `cmd+shift+d` | Clear history: every entry, pinned ones included; asks first |
| `tab` | Cycle the kind filter |

`primary_action = "copy"` swaps the first two, so `enter` copies and
`cmd+enter` pastes.

## Setup

Nothing to install; the recorder is part of pal. **Paste needs the
Accessibility permission on macOS**: the paste is a synthesised Cmd+V,
which the system only delivers from a process on the Accessibility list.
Without it pal shows the system prompt once per run and a toast, "Paste
needs Accessibility. Grant pal in System Settings > Privacy & Security >
Accessibility", instead of half-doing it. On Linux the paste is Ctrl+V
through `wtype`, else `ydotool` (which needs `ydotoold` running); with
neither, paste fails and the toast says so.

What is never recorded: anything a password manager marks as concealed or
transient (the `org.nspasteboard` convention), copies over 10 MB, and
copies made while an app in `exclude_apps` is in front. Copying something
already in history bumps it to the top instead of adding a duplicate.

Retention runs after every copy: unpinned entries older than
`max_age_days` are deleted, then the unpinned tail past `max_entries`.
Pinned entries never expire. A search lists at most 200 rows of what is
left.

Settings, `[extensions.clipboard]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `exclude_apps` | list | `["com.apple.keychainaccess", "com.apple.Passwords"]` | Bundle ids (`com.1password.1password`) or readable names (`Slack`). The recorder skips copies made while one is in front, and entries already recorded from one are not listed. `[]` excludes nothing. |
| `max_entries` | number, 1 to 100000 | `1000` | How many unpinned entries history keeps. |
| `max_age_days` | number, 0 to 3650 | `30` | Unpinned entries older than this are deleted. `0` is no age limit. |
| `primary_action` | `paste`, `copy` | `"paste"` | What `enter` does on an entry. |

The recorder reads the three retention keys once, when pal starts, so a
change to them takes effect at the next launch; `primary_action` applies
live.

## What it does not do

- Record while pal is not running: there is no background agent.
- Sync between machines, or keep entries past the retention limits
  unless they are pinned.
- Edit an entry's text: paste it and edit there.
- Know the source app on Linux: neither X11 nor the Wayland data-control
  protocol says who owns the selection, so `exclude_apps` has no effect
  there and the source accessory is absent.

## Platforms

macOS and Linux. Paste needs Accessibility on macOS and `wtype` or
`ydotool` on Linux; Copy file (`cmd+shift+c`) writes file URLs on macOS
and `text/uri-list` on Linux (X11, or Wayland with the wlr data-control
protocol).
