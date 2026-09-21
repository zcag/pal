# Windows

Every open window with its app's icon, most recently used first on macOS
and Hyprland (front to back on Sway and X11), never ranked by how often
it was picked. A live palette: the list runs on every show, so window
titles are root results. Rows are grouped by app, a section per app in
the order the most recent window of each gives; the app name is the
subtitle and a keyword, the bundle id or window class a keyword too. A
hidden app's window carries a `hidden` tag, a minimised one `minimized`,
one on another workspace or space `ws 3` or `other space`, and the
monitor when known.

Enter focuses: the panel hides, then the window comes up, restored if it
was minimised. The other actions close or minimise, one window or the
app's whole set, without leaving the palette, which lists again so the
row is seen to go.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Focus: hides the panel, then raises the window |
| `cmd+w` | Close the window; the palette stays open and lists again |
| `cmd+m` | Minimize; not offered on a window that already is |
| `cmd+h` | Hide app (macOS): System Events hides the window's process; not offered on a hidden app |
| `cmd+shift+h` | Show app (macOS, on a hidden app's window): the app comes forward with every window it had, and the panel hides |
| `cmd+shift+m` | Minimize all of this app; on an app with more than one window |
| `cmd+shift+w` | Close all of this app, after a confirm; on an app with more than one window |
| `alt+tab` (held), `shift+alt+tab` | The switcher: the manifest's `hold` chord. Held, the palette shows flat with the cursor on row 2; each press steps down (shift: up); letting go of Alt focuses the row under the cursor. `[palettes.windows] hold = ""` turns it off, another chord moves it; Linux drives it with `pal switch` from a keybind (docs/cli.md) |

A focus, close or minimise that fails keeps the panel open with a toast
carrying the reason ("needs Accessibility permission", "the window is
gone").

## Setup

Nothing to install on macOS. The list comes from CoreGraphics merged with
the Accessibility API for the parts CoreGraphics does not give (another
app's window title, whether it is minimised). Without the Accessibility
permission the list still works (titles only when Screen Recording allows,
else the app name), focusing falls back to activating the app, and close
and minimise fail with "needs Accessibility permission"; Focus shows the
same one-time prompt and toast as paste when the permission is missing.
Hide app goes through System Events, which asks for Automation once.

On Linux the backend is detected, not configured: Hyprland when `hyprctl`
and an instance signature exist (the newest `$XDG_RUNTIME_DIR/hypr/*` when
the variable is missing, so a service-started pal works); Sway on
`SWAYSOCK`; X11 on `DISPLAY` plus `wmctrl`. Hyprland has no minimise, so
pal parks the window on the `special:minimized` workspace and Focus brings
it back; Sway minimise is `move scratchpad`; X11 minimise needs `xdotool`.
With none of the three the palette reports "no Hyprland, Sway or X11
(wmctrl) session".

Settings, `[extensions.windows]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_minimized` | bool | `true` | List minimised windows too (focusing one restores it). |

## Order

Most recently used first, so row 1 is the window you came from and row 2
the one before it. Hyprland keeps that history itself; on macOS pal keeps
one, stamped on every app activation (the workspace notification), when
the panel shows (the window in front at the hotkey), and by Focus (the
window picked is the next "previous"). A focus change inside one app
(``cmd+` `` in a browser) is not an activation, so it shows up on the next
one. The history lives in the running pal: a fresh start lists front to
back until windows get used. Sway and X11 list front to back.

## What it does not do

- No ranking by pick count: the order is the desktop's recency, not how
  often you chose a window. Type part of its title instead.
- No moving or resizing: that is Window Management, which has Apply to…
  for a window picked from this list's rows.
- Hide app is macOS only; on Linux the action is not offered.
- No window previews: the row has the app's icon, not a thumbnail.

## Platforms

macOS (CoreGraphics and the Accessibility API) and Linux (Hyprland, Sway,
or X11 with `wmctrl`).
