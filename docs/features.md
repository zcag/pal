# Features

What pal does on its own, built into the app: the clipboard recorder,
text expansion, the window switcher, the sidebar, keeping windows below
a bar, mouse and trackpad tweaks, keycast. A feature runs whether or not
the panel is open, cannot be uninstalled, and is not an extension:
extensions are the palettes, bar items and routes you install
([Extensions](extensions.md)). Why the line is drawn there:
`docs/design/model.md`.

Settings › Features has a card for each: what it is doing (on, off, the
permission it waits on), its switch, and its settings unfolding under
it. The file keeps each in `[features.<id>]`:

```toml
[features.expansion]
enabled = true
prefix = ";"

[features.mouse]
middle_click = true
reverse_mouse = true

[features.keycast.hotkeys]
toggle = "ctrl+alt+k"
```

## Commands

Every yes/no setting of a feature is a command, and some features have
commands of their own (keycast's Start and Stop). A command is a row at
the root (type `reverse` and Enter on *Reverse scrolling on the mouse*
flips it; the tag says on or off, the HUD what it became), a `pal`
command and a link, and it takes a hotkey:

```sh
pal command mouse.reverse_mouse           # flip it
open pal://commands/keycast.toggle        # start or stop keycast
```

```toml
[features.mouse.hotkeys]
reverse_mouse = "ctrl+alt+r"
```

Settings › Features lists each card's commands with a hotkey field
under the card's settings. A feature's headline switch (Text expansion,
Keep below the bar) is named after the feature: *Text expansion*, on or
off.

## Clipboard history

Records what you copy (text, images, files, links, colours) so the
Clipboard History palette can list, search and paste it again
([Palettes](palettes.md#clipboard-history-clipboard-history)). On from
launch; `app/src-tauri/src/clipboard.rs` over `pal_core::clipboard`, the
history a SQLite database under the data directory, nothing leaving the
machine. What is never recorded, and how retention runs, is on the
palette's page.

| key | type | default | what |
| --- | --- | --- | --- |
| `exclude_apps` | list of bundle ids | Keychain Access, Passwords | Copies made while one of these is in front are not recorded, and entries recorded from one before it was added are not listed. `[]` excludes nothing. |
| `max_entries` | number, 1 to 100000 | `1000` | How many unpinned entries history keeps. |
| `max_age_days` | number, 0 to 3650 | `30` | Unpinned entries older than this are deleted. `0` is no age limit. |

All three are read when pal starts. On Linux the source app of a copy is
not known (neither X11 nor Wayland's data-control protocol says who owns
the selection), so `exclude_apps` has no effect there.

## Text expansion

On macOS, a snippet's keyword typed in any other app is replaced by its
text in place: type `;sig` in a mail and the signature lands where the
keyword was, placeholders filled, the clipboard left as it was. Off by
default. The snippets are the ones the Snippets palette edits
([Palettes](palettes.md#snippets-snippets)); they belong to this feature
(`storage/expansion.json`), and the palette reads and writes them through
`core/snippets.{list, set}`.

How it works (`pal_core::expansion`, `app/src-tauri/src/expansion.rs`):
pal watches the keys typed in other apps (an `NSEvent` global monitor,
which needs **Input Monitoring** for pal) and keeps the last 64
characters typed in the app in front; when they end in the prefix and a
keyword, it deletes what was typed with that many backspaces, puts the
filled text on the pasteboard marked concealed (clipboard managers and
pal's own history skip it), pastes it, moves the caret back for a
`{cursor}`, and 300 ms later puts the previous clipboard back (the
backspaces and the paste need **Accessibility**, like Paste). Then the
HUD says "Expanded Signature".

- The buffer empties on an arrow, Enter, Tab, Escape, a `⌘` or `⌃`
  combination, a change of app, and after an expansion; Backspace takes
  one character back, so a typo corrected still expands.
- A secure text field (a password field, `sudo` in a terminal) never
  expands, and neither do pal's own windows.
- `{cursor}` in the text: the caret lands there after the paste. A paste
  from the panel drops it. `{selection}` is left as written: the
  selection while a keyword is being typed is the keyword.
- A snippet saved or edited in the panel expands on the next keystroke.
- Linux: not available (Wayland hands key events to the focused client
  only, and X11 has no portable tap either).

| key | type | default | what |
| --- | --- | --- | --- |
| `enabled` | bool | `false` | Expand keywords typed in other apps (macOS). The card's switch. |
| `prefix` | `";"`, `":"`, `"none"` | `";"` | What comes before the keyword; `none` is the bare keyword at the start of a word, which fires inside ordinary typing more often. |
| `exclude_apps` | list of bundle ids | terminals and password managers | Apps where nothing expands. |
| `hud` | bool | `true` | "Expanded `<name>`" in the HUD after an expansion. |

## Window switcher

Cmd+Tab's shape over the Windows palette: hold the chord to step through
the windows, let go to switch; a quick tap goes back to the window you
were in before, without painting anything. The chord is the Windows
palette's `hold` (`[palettes.windows] hold`, `alt+tab` suggested by the
palette; any palette can have one, [Keyboard](keyboard.md#switcher));
the design is `docs/design/switcher.md`. `cmd+tab` as the chord goes
through an event tap and needs **Input Monitoring**.

| key | type | default | what |
| --- | --- | --- | --- |
| `app_switcher` | hotkey | unset | macOS's own App Switcher (Cmd+Tab's) on another Tab chord, `"alt+tab"`, for when the window switcher has taken `cmd+tab`; its `shift+` variant steps back. A hold chord equal to it is dropped with a log line. macOS only. |

## Sidebar

A live palette docked to a screen edge: it peeks the moment the pointer
touches the edge, and `cmd+N` runs row N. Off until a palette is picked;
the card's switch puts the Windows palette there. Its keys,
`[features.sidebar]`, are listed in [Config](config.md#featuressidebar).

## Keep below the bar

macOS: a window that opens, zooms or is dragged under a bar drawn over a
hidden menu bar (sketchybar), where macOS reserves nothing, is moved down
clear of it, its bottom edge kept; pal's own window layouts leave the
strip free too. One accessibility observer per running app sees windows
created, moved and resized; a window being dragged is moved when it is
let go; full-screen and minimised windows, panels and popovers are left
alone (`app/src-tauri/src/reserve.rs`). Needs **Accessibility**.

| key | type | default | what |
| --- | --- | --- | --- |
| `enabled` | bool | `false` | The card's switch. |
| `bar_height` | number (px) | `0` | The strip kept free at the top of every display; `0` asks sketchybar for its own height. |

## Mouse & Trackpad

A three-finger tap or click on the trackpad as a middle click, and
scrolling reversed for the trackpad, the mouse or both, each axis apart
(what MiddleClick and Scroll Reverser do), and the pointer hidden while it
is idle, macOS only.

An active event tap on a thread of its own (`app/src-tauri/src/mouse.rs`)
turns a left click made with three fingers on the trackpad into a middle
click (its drag and release follow) and negates the scroll deltas on the
reversed axes; MultitouchSupport counts the fingers and tells a tap
(three fingers down and up within 0.3 s, not moved, no fourth, no press)
from a swipe. A scroll is the mouse's when it comes in a wheel's notches
or under fewer than two fingers (a Magic Mouse); momentum keeps the
source of the scroll it follows. Devices are listed again every 3 s, so
a trackpad paired later and a wake are picked up. Turning a switch on
asks for **Accessibility** when it is missing and starts on the grant.
The card says "No trackpad is being read" when the middle click is on
and no trackpad is found.

The pointer is hidden in every app once it has not moved or clicked for
`hide_pointer_after` seconds, never while a button is held, and comes
back on the first move or button down; a scroll does not bring it back.
macOS hides the pointer only for the app in front, so pal marks its
window-server connection `SetsCursorInBackground` (private, as Cursorcerer
does). The idle time is read when it could have run out, not polled, and
the tap that sees the pointer move is enabled only while it is hidden.
Keycast's cursor ring hides with it. A pal that exits leaves nothing
hidden.

| key | type | default | what |
| --- | --- | --- | --- |
| `middle_click` | bool | `false` | A three-finger click on the trackpad is a middle click. |
| `middle_click_tap` | bool | `true` | With `middle_click`, a three-finger tap is one too. Turn off System Settings > Trackpad > Look up with three fingers so the two do not fight. |
| `reverse_trackpad` | bool | `false` | The trackpad scrolls against System Settings' direction. |
| `reverse_mouse` | bool | `false` | The mouse scrolls against System Settings' direction. |
| `reverse_vertical` | bool | `true` | Reversed devices flip up and down. |
| `reverse_horizontal` | bool | `true` | Reversed devices flip left and right. |
| `hide_pointer` | bool | `false` | Hide the pointer while it is idle. |
| `hide_pointer_after` | number | `3` | Seconds still before it is hidden (1 to 60). |

## Keycast

Keystrokes and clicks drawn over the screen for a recording or a screen
share (KeyCastr, Keyviz), macOS only. Commands: *Start keycast* (*Stop
keycast* while it runs, then with an `on` tag), *Keycast: keys only*,
*Keycast: cursor only*, *Keycast: keys and cursor* (start in, or switch
to, that mode), and the toggles of its yes/no settings. Starting and
stopping from the panel hide it first and the HUD says `Keycast on: keys
and cursor`, so the panel is never in the recording.

What it draws (`app/src-tauri/src/keycast.rs`, the overlay window; the
caps and the feed are `pal_core::keycast`): the recent entries as one
row along the chosen edge, oldest on the left and newest on the right,
each a frosted capsule. Plain typing runs together as text in the
capsule as typed (`hello world`, a caret while the run still takes
characters: the next character within a second joins it, up to 24, and
a pause, a shortcut or a named key starts the next); a shortcut is caps
with a lip, `⌃ ⌥ ⇧ ⌘` as glyphs drawn a shade lighter than the key they
chord with (`⌘⇧S`); a named key its symbol (`↵ ⇥ ⌫ ⌦ esc ← ⇞ F5`); a
repeat within the hold folded into one entry with a `×3` badge on its
corner; a click with modifiers `⌥ click`. An entry fades and settles
with age and is gone `hold` seconds after its last press, `max` kept.
With `gestures` on the strip also names what the trackpad and the wheel
do: `scroll ↓` (sized by how far in three steps), `pinch out +35%`,
`rotate ↻ 12°`, `swipe ←`, `smart zoom`; only what AppKit hands a global
monitor, so the system's three- and four-finger swipes never show. A
ring around the cursor in the `ring_color` (smaller while a button is
down) and a ripple on every click, a filled disc for the left button, a
hollow amber ring for the right, grey for the middle. The overlay is a
full-screen pass-through window on the display under the cursor,
following it across displays; the strip keeps clear of the menu bar and
the Dock. Nothing typed shows while a secure text field has the keyboard
(a password, `sudo`), nor what is typed into pal itself; with
`shortcuts_only` plain typing stays off the screen and only a key with
`cmd`, `ctrl` or `alt` or a function or navigation key shows.

States `keycast/active` and `keycast/mode`. The bar item
`keycast/active`, the feature's own: a red record dot with the mode
(`keys + cursor`) while it runs, hidden otherwise (a rule `on` colours
it; `show = "always"` keeps a muted dot). The popover: the three modes
as tiles (`k`, `c`, `b`), the shortcuts-only (`s`) and gestures (`g`)
switches, `backspace` stops, `o` opens these settings.

Input Monitoring: starting asks once when it is missing (as text
expansion does; the two share one `NSEvent` global monitor), and the
Overview lists the permission while keycast is on. Linux: not available
(no portable input tap).

| key | type | default | what |
| --- | --- | --- | --- |
| `mode` | `both`, `keys`, `cursor` | `both` | What Start draws when no mode is named. |
| `position` | `bottom-center`, `bottom-left`, `bottom-right`, `top-right`, `top-left` | `bottom-center` | The strip's edge of the work area; the row grows from that anchor. |
| `scale` | 0.5 to 3 | `1` | The size of the caps and the ring. |
| `hold` | 0.5 to 10 | `2` | Seconds a key stays after its last press. |
| `max` | 1 to 12 | `5` | How many entries the strip keeps. |
| `shortcuts_only` | bool | `false` | Only combos and function or navigation keys show. |
| `ring` | bool | `true` | The ring around the cursor (clicks ripple either way). |
| `ring_color` | tag colour | `blue` | The ring's and the left click's colour. |
| `ripples` | bool | `true` | A ripple on every click. |
| `gestures` | bool | `true` | Scrolls and trackpad gestures on the strip (keys and both modes). |
