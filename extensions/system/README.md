# System

Sleep, lock, log out, restart, shut down, empty the trash, dark mode,
volume, brightness, do not disturb, eject, show desktop, keep awake (for a
while, until a time, or while an app runs, with a countdown on the bar),
quit or unhide every app, dismiss notifications. The rows are indexed, so
`mute` or `sleep` at the root finds them (each carries keywords:
`suspend`, `power off`, `bin`); live because the Keep Awake row reads
Allow Sleep with the time left while a run is on, and a live palette lists
again on every show. pal hides the panel before running a command, so it
lands on the desktop, not on pal.

Only commands this machine can run are listed:

| command | macOS | Linux |
| --- | --- | --- |
| Sleep | `pmset sleepnow` | `systemctl suspend` |
| Sleep Displays | `pmset displaysleepnow` | Hyprland (`hyprctl dispatch dpms off`) or Sway (`swaymsg output * dpms off`) only |
| Lock Screen | the login framework's immediate lock, falling back to the Cmd+Ctrl+Q keystroke (which needs Accessibility) | `loginctl lock-session` |
| Log Out | System Events | `hyprctl dispatch exit`, `swaymsg exit`, else `loginctl terminate-session` |
| Restart, Shut Down | System Events | `systemctl reboot`, `systemctl poweroff` |
| Empty Trash | Finder | `gio trash --empty` |
| Toggle Dark Mode | System Events appearance | `gsettings` `color-scheme` between `default` and `prefer-dark` |
| Volume Up, Down, Toggle Mute | 10% steps, System Events | `wpctl`, else `pactl`, 10% steps |
| Brightness Up, Down | needs the `brightness` CLI on PATH; hidden otherwise | `brightnessctl`, 10% steps |
| Toggle Do Not Disturb | runs a Shortcut named "Toggle Do Not Disturb"; hidden until you create one (Focus has no CLI) | `swaync-client`, `makoctl` or `dunstctl`; hidden with none |
| Eject All Disks | Finder | not available |
| Show Desktop | Mission Control | not available |
| Keep Awake / Allow Sleep | `caffeinate -i` (`-di` with the display), `-t` for the deadline, `-w` to follow an app; below | `systemd-inhibit --what=sleep` (`idle:sleep` with the display) around `sleep <secs>`, `tail --pid`, or `timeout`; hidden with no `systemd-inhibit`, a hint row says so |
| Quit All Apps | System Events: every regular app but Finder and pal asked to quit, one by one, so an app with unsaved work still shows its sheet | not available |
| Unhide All Apps | System Events: every hidden app made visible | not available |
| Dismiss Notifications | Notification Center over Accessibility: the Clear All (else Close) action of every notification group; nothing on screen is nothing to do | `swaync-client --close-all`, `makoctl dismiss --all` or `dunstctl close-all`; hidden with none |
| Quick Look Finder Selection | `qlmanage -p` over what is marked in Finder (the core's `selection.files()`, read once per show), the names as the subtitle and the count on the right; inert with the reason while nothing is marked or Finder is not in front. `pal://system/run?id=quick-look-selection` for a hotkey | not available |

Two rows carry state on the right: Empty Trash shows what is in the Trash
(`3 items`, `empty`), and Toggle Dark Mode carries the current appearance
as a tag (`dark` violet, `light` amber, from `defaults read -g
AppleInterfaceStyle` on macOS and GNOME's `color-scheme` on Linux).

## Keep Awake

The row takes how long in the bar: `45m`, `2h`, `1h30m`, a bare number of
minutes, a clock time (`14:30`, `2pm`, `until 14:30`; tomorrow's when
today's has passed), or `forever`. Blank runs the `awake_default` setting
(an hour). A second field says whether the display stays up too (the
`awake_display` setting preselected). `Enter` starts it and the HUD says
what it did (`Awake for 45 min`, `Awake until 14:30`, `Awake until turned
off`); `cmd+enter` keeps awake until turned off; `cmd+u` opens a form with
the same spelling, the display switch and an app to follow (an app with a
window open: the run ends when it quits, `caffeinate -w`). While a run is
on the row reads **Allow Sleep** with the time left as a tag: `Enter` ends
it, `Keep awake for…` (with the bar's fields) restarts it for a new span,
`cmd+d` flips the display. The row is in the empty root's Now section
while a run is on.

`caffeinate` does the timing itself (`-t <secs>`), so a run ends on time
whether or not pal is up. pal keeps one record of the run (pid, until,
display, app) in its storage and checks it against the live process on
every read (the pid alive, its command line `caffeinate`'s, the deadline
not passed); the child is spawned unref'd and is not killed with the host,
so a restarted pal finds the same run back rather than starting over, and
a record whose process is gone (or is something else after a reboot) is
dropped silently. A run that ends while pal watches says so in the HUD.

**Bar item `system/awake`**: a coffee glyph and the countdown (`2h 40m`,
`12m`, `45s`; `∞` without an end), a monitor mark after it when the
display is kept awake too, amber in the last five minutes (the `ending`
rule); hidden while off, and `[bar.items."system/awake"] show = "always"`
keeps a muted coffee whose click still opens the popover. The popover: the
run on a card (what it is, since when, the time left large, a bar), the
presets as tiles on the digits `1`..`5` (a new end from now, on or off),
the display switch on `d` (a run is restarted with the other flag; off, it
is the next run's), `u` a field for a spelling, `Enter` allows sleep while
on and starts the default while off, `backspace` allows sleep, `o` the
System palette. The ticks are pal's own: a push when the countdown's text
next changes (every minute; every second under one, or while the popover
is up). The item publishes `system/awake` (on), `system/awake_until`
(unix ms, null without an end), `system/awake_left` (minutes, rounded up)
and `system/awake_display`, for rules and `show_when` expressions.

**Link**: `pal://system/awake?for=1h&display=1` (`until=14:30`,
`app=Xcode`, `off=1`; bare toggles: the default duration, or off while
on), `pal call system/awake for=2h` from a shell; `pal://system/run?id=keep-awake`
is the same toggle. The bar item's actions have their `pal bar action
system/awake preset:0` twins and a hotkey under `[bar.items."system/awake"]`.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Run the command; Log Out, Restart, Shut Down, Empty Trash and Quit All Apps ask first; on Keep Awake, for what the bar says (the default when blank); Allow Sleep while a run is on |
| `cmd+enter` | On Keep Awake: until turned off |
| `cmd+u` | On Keep Awake: a form for a time, an app to follow and the display |
| `cmd+d` | On Allow Sleep: keep the display awake too, or let it sleep |

One action per command row. A command that fails keeps the panel open with
a toast carrying the tool's message.

## Setup

Nothing to install for the common commands. On macOS: Brightness needs the
`brightness` CLI on PATH (`brew install brightness`), Do Not Disturb a
Shortcut named exactly "Toggle Do Not Disturb" in the Shortcuts app. The
System Events commands (log out, restart, volume, dark mode, quit all,
unhide all) ask for Automation once; Dismiss Notifications scripts
Notification Center's window, which needs Accessibility as well. `~/.Trash` is readable only with Full Disk Access, and
without it the Empty Trash row simply has no count. On Linux the volume
rows want `wpctl` (PipeWire) or `pactl`, brightness `brightnessctl`, Do
Not Disturb one of `swaync-client`, `makoctl`, `dunstctl`, and Keep Awake
`systemd-inhibit` (logind).

Settings, `[extensions.system]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `confirm_destructive` | bool | `true` | Confirm before logging out, restarting, shutting down, emptying the trash or quitting every app. |
| `awake_default` | string | `"1h"` | What a bare Keep Awake runs for: a duration, a clock time, or `forever`. |
| `awake_presets` | list of strings | `["30m", "1h", "2h", "forever"]` | The popover's tiles and digit keys, five at most. |
| `awake_display` | bool | `true` | Keep the display awake too (`caffeinate -d`); off, the display may sleep while the machine stays up. The row's field and the popover's switch override it per run. |

## What it does not do

- No "Restart pal" row: the tray has it.
- No volume or brightness slider: the rows step by 10%; press Enter
  again for the next step.
- Keep Awake follows one app by its windows (`windows.list`), not a
  background process; a run with no end and no popover open is checked
  once a minute by the core's render, so an app that quit shows for up
  to a minute.
- Eject All Disks, Show Desktop, Quit All Apps and Unhide All Apps are
  macOS only (no desktop-neutral way on Linux); Sleep Displays on Linux is
  Hyprland or Sway only.
- Quit All Apps quits every regular app, the one in front included; Finder
  and pal stay. There is no exclude list beyond those two.
- Do Not Disturb on macOS is hidden until the Shortcut exists: macOS has
  no command line for Focus.

## Platforms

macOS and Linux, with the per-command differences in the table above.
