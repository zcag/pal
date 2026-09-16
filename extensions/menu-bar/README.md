# Menu Bar Items

The menus of the app in front as one list, Raycast's Search Menu Bar
Items: every enabled item with the menus above it as the subtitle ("File
> Export"), its shortcut as key caps, a check mark when it is on, the
app's icon on every row, a section per top menu in menu order. Live: the
menus are read again every time the panel shows, and the rows are root
results, so `export pdf` at the root finds Preview's item without opening
the palette. The whole path is searched.

Enter presses the item. pal hides first and waits a few frames for key
focus to return to the app, so an item that opens a sheet or a dialog
lands there; then the item pal listed is pressed through Accessibility and
the HUD names the app and the path, or says why the press failed.

What is left out: separators and disabled items, the Apple menu, submenus
deeper than four levels, and whatever was not reached within 150 ms of
reading (a slow app never delays the panel; the last fuller listing of the
same app stands in when a read is cut short).

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Press the menu item |

A menu item can carry a global hotkey like any row
(`[palettes.menu-bar.item_hotkeys]`, the row id being the path, `"File >
Export as PDF…" = "ctrl+alt+e"`); the menus are read when it fires, so it
presses the item of whatever app is in front then.

## Setup

macOS only, and it needs the Accessibility permission: without it the one
row says so and Enter on it opens System Settings on the pane. On Linux the
one row says the menu bar is macOS only.

No settings.

## What it does not do

- No pinning or per-app disabling (Raycast's `app_menu_bar_pins`).
- The Apple menu is not listed; the System palette has Sleep, Lock and the
  rest.
- Fn (Globe) shortcuts are drawn from a guess: Accessibility has no bit for
  Globe, so a bare letter with the "no command" flag is shown as `fn F`.

## Platforms

macOS (Accessibility API).
