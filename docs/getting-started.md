# Getting started

pal is a keyboard launcher for macOS and Linux. One hotkey opens a panel with
one search box over your apps, bookmarks, clipboard history, emoji, windows,
system commands and a calculator. Each of those is a palette.

## Install

Download from the [Releases page](https://github.com/zcag/pal/releases):

| platform | file |
| --- | --- |
| macOS, Apple silicon | `pal_<version>_aarch64.dmg` |
| macOS, Intel | `pal_<version>_x64.dmg` |
| Linux, any distro | `pal_<version>_amd64.AppImage` |
| Linux, Debian and Ubuntu | `pal_<version>_amd64.deb` |

### macOS

Open the dmg and drag pal to Applications. macOS 11 or newer.

**The first launch is refused.** pal's releases are ad-hoc signed (no
Apple Developer ID) and not notarised, and the browser marks the download
as quarantined, so Gatekeeper blocks it. Which dialog you see depends on
the macOS version: "Apple could not verify pal is free of malware" on
macOS 15, "pal cannot be opened because the developer cannot be verified"
before that, and on some systems "pal is damaged and can't be opened".
None of them is pal's own doing and none of them can be answered from the
dialog. Any one of these gets past it, once per download:

- Remove the quarantine mark, which is what Gatekeeper keys on:
  `xattr -dr com.apple.quarantine /Applications/pal.app`. This is the
  one that also works when the dialog says "damaged".
- After the refused launch, open System Settings > Privacy & Security,
  scroll to the line about pal and click **Open Anyway**, then Open in the
  dialog that comes back. This is Apple's documented route
  (support.apple.com/102445).
- On macOS 14 and earlier, right-click (or Control-click) pal.app in
  Finder and choose Open: the dialog gains an Open button. macOS 15
  removed this shortcut.

A signed and notarised release would install without any of this; what
that takes is in [Releasing](releasing.md#macos-signing-later).

pal has no Dock icon. It lives in the menu bar, and the hotkey brings up the
panel from anywhere.

Three palettes need the Accessibility permission: clipboard history
(pasting into the app in front sends a synthesised Cmd+V), windows (raise,
close, minimise) and window management (move and resize); so does
`pal action type`. macOS lists an app under Privacy &
Security > Accessibility only once the app has asked, so pal asks: the
first time the panel opens on a new profile (the system prompt, and System
Settings opened on that pane; `ask_permissions_on_start = false` in the
config turns that off), from the first row of the Welcome section, from
Settings > General > Permissions (a granted / not granted dot and a Grant
button), and the first time a paste, a window switch or a layout is refused (a
toast says so). Flip the switch next to pal in that pane; pal sees it within a
couple of seconds, no restart. Nothing else asks for a permission.

The grant is tied to the app's code signature, and pal's releases are
ad-hoc signed, so every build carries a new one. After installing a rebuilt
pal.app the switch can look on and still do nothing: remove pal from the
list (the minus button) and grant it again. A Developer ID signature is
what keeps a grant across updates; releases do not have one yet.

### Linux

The deb installs `/usr/bin/pal`, `/usr/bin/bun` (the extension host's
runtime) and `/usr/lib/pal/` (host and bundled extensions). It depends on
`libwebkit2gtk-4.1-0` and `libgtk-3-0`. The AppImage bundles the whole
WebKitGTK stack, so it is large (about 140 MB); `chmod +x` it and run it.

The tray icon needs `libayatana-appindicator` (Arch) or
`libayatana-appindicator3-1` (Debian, Ubuntu) and a bar with an SNI tray
(for example waybar's `tray` module). Without them there is no icon and
everything else still works: the hotkey, `pal toggle` and `pal settings`.

**Wayland has no global hotkey API.** pal's hotkey registration goes through
X11, so under Wayland it only fires while an X11 client has focus. Bind
`pal toggle` in the compositor instead and set `hotkey = ""` in the config
(see [Config](config.md)). On Hyprland, these are the rules that float,
pin and place the panel a fifth of the way down the screen and the HUD
(the "Copied" capsule) at the bottom, plus the bind:

```text
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:title ^(pal)$
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, no_focus on, move (monitor_w*0.5-window_w*0.5) (monitor_h-window_h-8), match:title ^(pal HUD)$
bind = CTRL, space, exec, pal toggle
```

The rules key on the window title, not the class: every pal window has
the class `pal`, and the settings window (`pal Settings`) is a normal
window that should tile like any other.

Other compositors: bind `pal toggle` to a key the same way. Bind the deb's
`/usr/bin/pal` or the `usr/bin/pal` of an extracted AppImage, not the
AppImage file itself: each run of the AppImage mounts its squashfs first,
which puts `pal toggle` at about 230 ms instead of 50.

Autostart: `launch_at_login` writes and enables a `pal.service` user unit
(`Restart=on-failure`, wanted by `graphical-session.target`), so a session
that reaches that target (GNOME, KDE, Hyprland under uwsm) starts pal and
relaunches it after a crash. Hyprland without uwsm reaches neither that
target nor XDG autostart, so add `exec-once = pal` to `hyprland.conf`: the
hand-started pal moves itself under the unit at startup. Without systemd
the setting writes `~/.config/autostart/pal.desktop` and nothing relaunches
a crashed pal. See [Config](config.md#crash-relaunch).

## The hotkey

`Ctrl+Space` by default, on both platforms. Change it in Settings under
Hotkey (record a combination, or press one of the presets), or set
`general.hotkey` in the config file (`alt+space`, `cmd+shift+p`, ...). An
empty value turns the hotkey off, for a compositor bind that runs
`pal toggle`. The line under the field says whether the OS took the
registration, and why not when it did not.

Several combinations can open pal: "Add another" in Settings gives a
second row (up to three), or write a list in the file,
`hotkey = ["cmd+space", "ctrl+space"]`. Each row has its own status line,
so one that another app holds is named there while the others keep
working, and the Overview lists all of them (`⌘Space, ⌃Space`).

On macOS, `⌘Space` is Spotlight's: the system takes the press before any
app, so it cannot even be recorded (Spotlight opens instead; use the
preset). Set it, and Settings says "Spotlight uses ⌘Space" with a button
to System Settings > Keyboard > Keyboard Shortcuts, where unticking
Spotlight's "Show Spotlight search" frees it; pal registers the key
within a couple of seconds of that, nothing to restart.

## Ten-second tour

1. Press the hotkey. The panel opens with an empty search box. With nothing
   typed it lists everything, palettes and apps first, with what you have
   picked before boosted to the top.
2. Type. Results from every palette arrive as you type, grouped by palette.
   Words match fuzzily and independently; there are no search operators.
3. `Enter` runs the row's primary action (launch the app, open the bookmark,
   copy the emoji).
4. `⌘K` opens the action panel: every action the row has, with its shortcut.
   `⌘Enter` runs the second one without opening the panel.
5. `Esc` closes the action panel, else clears the query, else goes back a
   level, else hides the panel.
6. `⌘,` opens the Settings window.
7. Drill into a palette: type its name (or its alias) and press `Enter` on
   its row, or press `⌘⇧B` on any result to browse the palette it came from.
   Inside, the search is scoped to that palette and the crumb in the search
   row says where you are. `⌘⌫` with an empty query goes back.
8. `Tab` and `⇧Tab` cycle the filter dropdown when the palette has one.
9. `⌘I` toggles the detail pane, the wider view of the current row
   (clipboard entries open with it showing).
10. `⌘R` lists the current palette again, or everything at the root,
    ignoring any cache.

On Linux, `⌘` in the above is `Ctrl`. The whole grammar is in
[Keyboard](keyboard.md).

## pal's own commands

pal's own housekeeping is in the root search too, as rows of a `pal`
section, the way Raycast lists "Raycast Settings" or "Quit Raycast":
Settings (and Settings › Extensions, › Palettes, › About), Extension Store,
Install Extension (a form: `github:user/repo`, a GitHub URL or a local
directory), Reload Extensions (restarts the extension host), Refresh Index,
Check for Updates, Open Config File and Reveal Config File, Show Tips Again,
Documentation, Report a Bug (a GitHub issue with your version and OS filled
in), Copy Diagnostics (version, OS, config path, extensions, hotkey and
permission status, onto the clipboard), Toggle Theme (light, dark, system),
Quit pal (asks first), Restart pal, and pal Version (Enter copies it). Every
row answers to `pal`, so `pal set` finds Settings and `pal quit` Quit. They
are searched and ranked like any other row; `⌘,`, `⌘R` and the action
panel's "Open Settings", "Refresh everything" and "Show tips again" run the
same code.

## The config file

`~/.config/pal/config.toml` on both platforms (`$XDG_CONFIG_HOME/pal/config.toml`
when that variable is set; `PAL_CONFIG=<path>` overrides both). The first
launch creates it from a two-line template whose first line points an
editor with TOML schema support at the published schema, so it validates
and completes the file; nothing else is written into that directory. A pal
v1 config found there is migrated first: kept whole as `config.v1.toml`
and run through the `scripts` extension ([Config](config.md)).

The Settings window (`⌘,` in the panel, `pal settings`, or Settings... in
the menu) is a front for that file: every change it makes is a write to the
file, and every hand edit is picked up live, keeping your comments and
formatting. The window's General page has an Open file button for the
editor of your choice.

Every key, with its default, is in [Config](config.md).

## Where the rest lives

- Index cache and search history (frecency):
  `~/Library/Application Support/pal/<profile>/` on macOS,
  `~/.local/share/pal/<profile>/` on Linux (`$XDG_DATA_HOME/pal/` when set).
  `<profile>` is `default` for the default config path.
- Clipboard history: `clipboard.db` and a `clipboard/` folder of images, one
  level up from the profile directory.
- Installed extensions: `extensions/<name>/`, next to `clipboard.db`. Your
  own can also live anywhere `general.extension_dirs` names, see
  [Extensions](extensions.md).
