# Keycast

Keystrokes and clicks drawn over the screen for a recording or a screen
share, the way KeyCastr and Keyviz do it, built into pal: the recent keys
as one row of caps along an edge of the display under the cursor (plain
typing runs together as text, the older entries fading with age), a ring
around the cursor with a ripple on every click, a red dot on the bar
while it runs. macOS only.

## What it draws

- **Keys**: each press as the panel's own key caps at twice the size, in
  a capsule like the HUD's: `⌃ ⌥ ⇧ ⌘` as glyphs in macOS's order, then
  the key. A named key is its symbol (`↵ ⇥ ⌫ ⌦ ␣ esc ← → ↑ ↓ ⇞ ⇟ ↖ ↘
  F1..F20`); a typed key is what it typed (`A`, `!`, `å`), and inside a
  combo the key's own face, so `⌘⇧S` reads as the shortcut it is. The
  same key pressed again within the hold folds into one cap with `×3`
  (a held key repeating counts up). A click that carries modifiers
  (`⌥ click`, `⌘ right click`) goes on the strip too. Each entry fades
  once `hold` seconds have passed since its last press; the strip keeps
  `max` entries, the oldest leaving first.
- **Scroll and gestures** (on the strip, with `gestures` on): a scroll as
  `scroll ↓`, the arrow the dominant axis of what has piled up and sized
  by how far (three steps), one entry per stretch of trackpad scrolling
  that its momentum keeps on screen, a wheel's notches in one direction
  joining the newest; a pinch as `pinch out +35%` and a rotation as
  `rotate ↻ 12°`, one entry each that counts up from the fingers landing
  to their lifting; a two-finger swipe as `swipe ←`; a smart zoom
  (two-finger double tap) as `smart zoom`. Only what AppKit hands a
  global monitor: the system's three- and four-finger swipes (Spaces,
  Mission Control) are the window server's and never arrive.
- **Cursor**: a ring around the pointer in the `ring_color`, shrinking
  while a button is down, and a ripple spreading from every click: a
  filled disc in the ring's colour for the left button, a hollow amber
  ring for the right, grey for the middle. The overlay covers the whole
  display under the cursor and moves with it across displays.
- **Both**: the strip and the ring together, the default.

Never drawn: anything typed while a secure text field has the keyboard
(a password prompt, `sudo`; macOS's `IsSecureEventInputEnabled`), and,
with **Shortcuts only** on, plain typing: only a key with `cmd`, `ctrl`
or `alt`, or a function or navigation key, shows. What is typed into pal
itself never shows either (a global monitor does not see the active
app's keys).

## The palette

| row | Enter |
| --- | --- |
| Start keycast / Stop keycast | On in the default mode, or off. The row is in the root's Now section while it is on. |
| Keys only, Cursor only, Keys and cursor | Start in that mode, or switch to it while on; `cmd+enter` stops from a mode row. The one on is tagged `current`, the default `default`. |
| Shortcuts only: on / off | Flip the setting (`cmd+shift+s` on any row). |
| Scroll and gestures: on / off | Flip the setting (`cmd+shift+g` on any row). |
| Keycast needs Input Monitoring | Shown while the grant is missing; Enter shows the system prompt, or the pane once it was refused. |

`cmd+,` on any row opens the extension's settings. The palette hides
after Start and Stop (the HUD says `Keycast on: keys and cursor`), so the
recording never has the panel in it.

## The bar item

A red record dot with the mode (`keys + cursor`) while it runs, hidden
otherwise (`show = "always"` keeps a muted dot). Its popover: the three
modes as tiles (`k`, `c`, `b`; the one on wears the ring), the
shortcuts-only (`s`) and gestures (`g`) switches, `backspace` stops, `o`
opens the palette.

## Links

- `pal://keycast/toggle?mode=keys|cursor|both`: off to on in that mode
  (the default without one); on in that mode, or with no mode named, to
  off; on in another mode switches. For a keybind.
- `pal://keycast/start?mode=`, `pal://keycast/stop`.

`keycast/active` (boolean) and `keycast/mode` (`keys`, `cursor`, `both`,
null while off) are published as states, so an expression can read them
(`docs/design/states.md`).

## Permission

Input Monitoring (Privacy & Security). Start asks once when it is
missing; without it nothing typed reaches pal, the palette's row says so,
and the Overview lists the permission while keycast is on. The monitor is
the one snippet expansion uses (one `NSEvent` global monitor for both).

## Settings

| key | default | what |
| --- | --- | --- |
| `mode` | `both` | What Start draws when no mode is named: `both`, `keys`, `cursor` |
| `position` | `bottom-center` | The strip's edge of the work area, the row reading oldest to newest: `bottom-center`, `bottom-left`, `bottom-right`, `top-right`, `top-left` |
| `scale` | `1` | The size of the caps and the ring, 0.5 to 3 |
| `hold` | `2` | Seconds a key stays after its last press |
| `max` | `5` | How many entries the strip keeps |
| `shortcuts_only` | `false` | Only combos and function or navigation keys show |
| `ring` | `true` | The ring around the cursor (clicks ripple either way) |
| `ring_color` | `blue` | The ring's and the left click's colour, from the tag palette |
| `ripples` | `true` | A ripple on every click |
| `gestures` | `true` | Scrolls and trackpad gestures on the strip (keys and both modes; cursor-only draws the pointer alone) |

## Linux

Not available: there is no portable input tap (Wayland hands input to
the focused client only, and pal has no X11 key backend). The palette is
one row saying so; the links and the bar item answer the same.
