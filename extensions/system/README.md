# System

Sleep, lock, log out, restart, shut down, empty the trash, dark mode,
volume, brightness, do not disturb, eject, show desktop, keep awake, quit
or unhide every app, dismiss notifications. The rows are indexed, so `mute` or `sleep` at the root finds them (each
carries keywords: `suspend`, `power off`, `bin`); live because the Keep
Awake row flips to Allow Sleep while a keep-awake is running, and a live
palette lists again on every show. pal hides the panel before running a
command, so it lands on the desktop, not on pal.

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
| Keep Awake / Allow Sleep | `caffeinate -d -i`, detached; running it again stops it | `systemd-inhibit --what=idle:sleep ... sleep infinity`, the same toggle |
| Quit All Apps | System Events: every regular app but Finder and pal asked to quit, one by one, so an app with unsaved work still shows its sheet | not available |
| Unhide All Apps | System Events: every hidden app made visible | not available |
| Dismiss Notifications | Notification Center over Accessibility: the Clear All (else Close) action of every notification group; nothing on screen is nothing to do | `swaync-client --close-all`, `makoctl dismiss --all` or `dunstctl close-all`; hidden with none |

Two rows carry state on the right: Empty Trash shows what is in the Trash
(`3 items`, `empty`), and Toggle Dark Mode carries the current appearance
as a tag (`dark` violet, `light` amber, from `defaults read -g
AppleInterfaceStyle` on macOS and GNOME's `color-scheme` on Linux).

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Run the command; Log Out, Restart, Shut Down, Empty Trash and Quit All Apps ask first |

One action per row. A command that fails keeps the panel open with a toast
carrying the tool's message.

## Setup

Nothing to install for the common commands. On macOS: Brightness needs the
`brightness` CLI on PATH (`brew install brightness`), Do Not Disturb a
Shortcut named exactly "Toggle Do Not Disturb" in the Shortcuts app. The
System Events commands (log out, restart, volume, dark mode, quit all,
unhide all) ask for Automation once; Dismiss Notifications scripts
Notification Center's window, which needs Accessibility as well. `~/.Trash` is readable only with Full Disk Access, and
without it the Empty Trash row simply has no count. On Linux the volume
rows want `wpctl` (PipeWire) or `pactl`, brightness `brightnessctl`, and
Do Not Disturb one of `swaync-client`, `makoctl`, `dunstctl`.

Settings, `[extensions.system]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `confirm_destructive` | bool | `true` | Confirm before logging out, restarting, shutting down, emptying the trash or quitting every app. |

## What it does not do

- No "Restart pal" row: the tray has it.
- No volume or brightness slider: the rows step by 10%; press Enter
  again for the next step.
- Eject All Disks, Show Desktop, Quit All Apps and Unhide All Apps are
  macOS only (no desktop-neutral way on Linux); Sleep Displays on Linux is
  Hyprland or Sway only.
- Quit All Apps quits every regular app, the one in front included; Finder
  and pal stay. There is no exclude list beyond those two.
- Do Not Disturb on macOS is hidden until the Shortcut exists: macOS has
  no command line for Focus.

## Platforms

macOS and Linux, with the per-command differences in the table above.
