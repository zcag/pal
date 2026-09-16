# Applications

Installed applications with their own icons, one indexed palette. The row
is the app's name, its source the subtitle (Applications, macOS, User, or
the extra folder it came from), and Enter launches it. The bundle id and
the display name are keywords, so `com.apple.` or `anthropic` finds the
app and `Chrome` finds Google Chrome. Rows are sorted by name; the palette
is indexed, so every app is a root result and `⌘R` rescans.

A running app carries a green `Running` tag as of the last listing (the
tag is refreshed by `⌘R`, a settings change, and after a Quit or Hide from
the panel) and gains Quit and Hide at the top of its actions; an app that
is not running has them last, and both answer "is not running" as a toast
rather than launching it.

## Where the apps come from

- **macOS**: `.app` bundles in `/Applications`, `/System/Applications` and
  `~/Applications`, one level deep so the Utilities folders come along.
  The first root wins a name. `CFBundleIdentifier`, `CFBundleDisplayName`
  and `CFBundleName` are read from the XML `Info.plist`; localised names
  are not. Enter opens the bundle path with the system opener.
- **macOS, System Settings panes**: 35 common panes (Keyboard, Displays,
  Privacy & Security, Wi-Fi, Battery, ...) are rows with the System
  Settings icon and `System Settings` as subtitle; `settings`,
  `preferences` and a few words per pane (`dark mode`, `dns`, `airdrop`)
  are keywords. Enter opens the pane through its
  `x-apple.systempreferences:` url. A curated table of macOS 13+ ids, not
  a scan.
- **Linux**: `.desktop` entries from every XDG data dir (`~/.local/share`,
  `$XDG_DATA_DIRS`, the flatpak exports), the first directory winning a
  desktop id. Entries with `NoDisplay`, `Hidden`, a `TryExec` that is not
  installed, or an `OnlyShowIn`/`NotShowIn` that excludes
  `$XDG_CURRENT_DESKTOP` are skipped. `Comment` (else `GenericName`) is
  the subtitle; `GenericName`, `Keywords`, the binary and the desktop id
  are keywords. Enter launches through `gio launch`, else `gtk-launch`,
  else the parsed `Exec`; `Terminal=true` entries run in `$TERMINAL`, else
  the first of kitty, foot, xterm on PATH. A `[Desktop Action ...]` group
  ("New Window", "New Private Window") is a secondary action run from its
  own `Exec`.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open (a pane: open it in System Settings) |
| `cmd+q` | Quit: asks the app through AppleScript, so it may ask you to save; `SIGTERM` for a bundle Launch Services does not know |
| `cmd+h` | Hide, through System Events |
| `cmd+shift+r` | Reveal in Finder |
| `cmd+c` | Copy path (a pane: Copy URL) |
| `cmd+shift+c` | Copy bundle id |
| `cmd+r` | Rescan the application folders |
| `cmd+i` | Details: the path, bundle id, version and whether it runs (on Linux the desktop file, its command and its actions) |

On Linux the actions are Open, the entry's own desktop actions, and Copy
path.

## Setup

Nothing to install. The first Quit or Hide on macOS shows the Automation
prompt once: pal asks the app (or System Events) through Apple events, and
macOS wants your say before it lets a process control another.

Settings, `[extensions.apps]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `[]` | Extra folders scanned in addition to the system's application folders. `~` is expanded. A change rescans. |

## What it does not do

- Localised app names (`InfoPlist.strings`): they are binary plists in
  most system apps and would cost a spawn per app, so only the bundle's
  own names are keywords.
- Panes beyond the curated 35: `/System/Library/ExtensionKit` mixes panes
  with intents and widgets and carries no display names, so it is not
  scanned.
- Quit does not force: an app that puts up a save dialog keeps it, and
  the dialog is yours to finish.
- Force quit, uninstall, or a per-app "open new window": use the Windows
  palette for what is open, the Processes palette to kill.

## Platforms

macOS and Linux. The System Settings panes, Quit, Hide and Reveal in
Finder are macOS; the desktop actions are Linux.
