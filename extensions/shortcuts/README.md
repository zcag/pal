# Shortcuts

Every shortcut from the Shortcuts app as a row, the folder it sits in as
the section (the ones in no folder first). The rows are indexed, so a
shortcut's name at the root finds it; the folder is a keyword too, so
`home` narrows to that folder. macOS only, over the `shortcuts` command
line tool that ships with macOS 12 and later.

`enter` runs the shortcut and the panel hides; when the run ends, however
long it took (a shortcut can show its own UI and wait for you), the HUD
shows `<name>: Done`, or the first line of what the shortcut output, or
the tool's message when it failed. `cmd+enter` runs it with the newest
clipboard text as its input; `cmd+t` asks for the input in a form. `cmd+o`
opens the shortcut in the Shortcuts app.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Run the shortcut |
| `cmd+enter` | Run it with the clipboard's text as its input |
| `cmd+t` | Run with text: a form for the input, then the run |
| `cmd+o` | Open it in Shortcuts |
| `cmd+c` | Copy its name |
| `cmd+i` | The detail pane: name, folder, identifier |
| `cmd+r` | List again now (the listing is otherwise kept for five minutes) |

## Setup

Nothing to install on macOS 12 or later. The first run of a shortcut that
touches another app may bring up macOS's Automation prompt, once. A global
hotkey per shortcut goes through the palette's item hotkeys, keyed by the
shortcut's name:

```toml
[palettes.shortcuts.item_hotkeys]
"Lights On" = "ctrl+alt+l"
```

Two shortcuts with the same name: the second one's row id is
`<name> (<identifier>)`, and that is the key to use.

## What it does not do

- Show a shortcut's own icon or colour: the Shortcuts database is behind
  macOS's privacy guard and the command line tool does not expose them, so
  every row wears the palette's mark.
- Run with a file, an image or anything but text as input; `shortcuts run
  -i` takes a file, and this palette writes text into one.
- Know whether a shortcut accepts input: Run with clipboard and Run with
  text are on every row, and a shortcut that takes none ignores it.
- Create or edit a shortcut: `cmd+o` hands it to the app.

## Platforms

macOS. On Linux, or a Mac without the tool, the palette is one row saying
so.
