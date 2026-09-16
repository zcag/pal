# Window Management

Move and resize windows from the keyboard, Raycast's set: one row per
layout (halves, thirds, quarters, the maximize family, larger and smaller,
a nudge by a step, the other display, fullscreen, minimize, restore),
Enter applies it to the window you were in. pal hides its panel
first, so the window with focus is the one behind the panel, not pal; the
HUD then names the layout, or says why it did not happen ("Restore:
nothing to restore", "Next Display: only one display").

| layout | id | what |
| --- | --- | --- |
| Left Half, Right Half, Top Half, Bottom Half | `left_half` `right_half` `top_half` `bottom_half` | half of the screen |
| Left Third, Center Third, Right Third | `left_third` `center_third` `right_third` | a third |
| Left Two Thirds, Right Two Thirds | `left_two_thirds` `right_two_thirds` | two thirds |
| Top Left, Top Right, Bottom Left, Bottom Right Quarter | `top_left_quarter` `top_right_quarter` `bottom_left_quarter` `bottom_right_quarter` | a quarter |
| Maximize | `maximize` | the whole screen |
| Almost Maximize | `almost_maximize` | `almost_maximize_percent` of the screen, centred |
| Maximize Height, Maximize Width | `maximize_height` `maximize_width` | the screen's height (or width), the other side kept |
| Center | `center` | the same size, centred |
| Reasonable Size | `reasonable_size` | `reasonable_size_percent` of the screen, centred |
| Larger, Smaller | `larger` `smaller` | 10% more (or less) on each side about the centre, kept on the screen |
| Move Left, Right, Up, Down | `move_left` `move_right` `move_up` `move_down` | nudged by `step` pixels, stopping at the screen's edge |
| Next Display, Previous Display | `next_display` `previous_display` | the same place and proportions on the other display; refused with one |
| Toggle Fullscreen | `fullscreen` | the app's own full screen on or off (a Space of its own on macOS) |
| Minimize | `minimize` | to the Dock |
| Unminimize | `unminimize` | back and in front: the window Minimize last put away, else the frontmost minimised one |
| Restore | `restore` | back to where the window was before pal moved it |

"The screen" is the display the window's centre is on, minus the menu bar,
Dock or bars, minus `gap` on every side; the halves, thirds and quarters
are equal cells with `gap` between them. Restore remembers, per window and
in memory until pal quits, the frame a window had before a run of layouts
started: moving the window by hand in between starts a new run, so Restore
goes back to where you had put it.

Two palettes:

- **Window Management** (`window-management`) is the layouts, indexed, so
  `left half` or `quarter` finds one from the root (each row carries
  keywords: `split`, `corner`, `zoom`, `monitor`, `undo`).
- **Arrange Window** (`arrange`) is the same thing the other way round: an
  input palette of the open windows (minimised ones left out); Enter on
  one lists the layouts with that window's title as the subtitle, and
  Enter on a layout applies it there.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Apply the layout to the focused window |
| `cmd+enter` | Apply to…: pick a window from the open ones, then the layout goes on that one |
| `enter` in Arrange Window | Arrange: the layouts for the picked window |

Per-layout global hotkeys, which move the focused window without showing
pal at all, are `item_hotkeys` under the palette in the config file; the
moves and the resizes are the ones worth a key, since they repeat:

```toml
[palettes.window-management.item_hotkeys]
left_half = "ctrl+alt+left"
right_half = "ctrl+alt+right"
maximize = "ctrl+alt+enter"
restore = "ctrl+alt+backspace"
larger = "ctrl+alt+="
smaller = "ctrl+alt+-"
move_left = "ctrl+alt+shift+left"
move_right = "ctrl+alt+shift+right"
move_up = "ctrl+alt+shift+up"
move_down = "ctrl+alt+shift+down"
fullscreen = "ctrl+alt+f"
minimize = "ctrl+alt+m"
```

## Setup

On macOS the frame is set through the window's `AXPosition` and `AXSize`,
so it needs the Accessibility permission: without it Enter shows the same
toast as paste and asks once. The displays are `NSScreen`'s frames with
`visibleFrame` for the usable part, so an auto-hidden menu bar or Dock
gives the whole screen. Apps keep their minimum size and may round.

On Linux nothing to configure: Hyprland (`movewindowpixel exact` and
`resizewindowpixel exact`; a tiled window is floated first, since an exact
frame means nothing inside the tiling layout; Toggle Fullscreen focuses the
window and runs `fullscreen 0`), Sway (`floating enable`, `move absolute
position`, `resize set`, `fullscreen toggle`) or X11 (`wmctrl -i -r <id>
-e`, `-b toggle,fullscreen`, `xrandr --listmonitors` for the displays,
`xprop` for the focused window). Minimize is the compositor's (Hyprland
parks the window on `special:minimized`, Sway on the scratchpad, X11 needs
`xdotool`) and Unminimize focuses it back.

Settings, `[extensions.window-management]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `gap` | number (px) | `0` | Pixels between a window and the screen edge, and between two windows of a split. |
| `almost_maximize_percent` | number (%) | `90` | How much of the screen Almost Maximize fills. |
| `reasonable_size_percent` | number (%) | `60` | How much of the screen Reasonable Size fills. |
| `step` | number (px) | `32` | How far Move Left, Right, Up and Down nudge the window. |

## What it does not do

- No custom layouts: the thirty-one above are the set; `gap`, `step` and
  the two percentages are the knobs. Larger and Smaller are a fixed 10%.
- No tiling or snapping as you drag; every move is a pick or a hotkey.
- Restore forgets when pal quits: the frames are kept in memory only.
- Sway and X11 are written to the tools' documented shapes and unit-tested
  on fixtures, not run against a live session yet.

## Platforms

macOS (Accessibility API) and Linux (Hyprland, Sway, or X11 with `wmctrl`).
