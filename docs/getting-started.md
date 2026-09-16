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

Open the dmg and drag pal to Applications. The app is ad-hoc signed, not
notarised, so the first launch needs a right-click on the app, then Open;
Gatekeeper shows its "unidentified developer" dialog once per install.
macOS 11 or newer.

pal has no Dock icon. It lives in the menu bar, and the hotkey brings up the
panel from anywhere.

Two palettes need the Accessibility permission: clipboard history (pasting
into the app in front sends a synthesised Cmd+V) and windows (raise, close,
minimise). The first time one of them needs it, pal shows the system prompt
once and a toast that says "Grant pal in System Settings > Privacy &
Security > Accessibility". Nothing else asks for a permission.

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
(see [Config](config.md)). On Hyprland, this is the rule set that floats,
pins and places the panel a fifth of the way down the screen, plus the bind:

```text
windowrule = float on, pin on, no_anim on, border_size 0, no_shadow on, move (monitor_w*0.5-window_w*0.5) (monitor_h*0.2), match:class ^(pal)$
bind = CTRL, space, exec, pal toggle
```

Other compositors: bind `pal toggle` to a key the same way. Bind the deb's
`/usr/bin/pal` or the `usr/bin/pal` of an extracted AppImage, not the
AppImage file itself: each run of the AppImage mounts its squashfs first,
which puts `pal toggle` at about 230 ms instead of 50.

Autostart: `launch_at_login` writes `~/.config/autostart/pal.desktop`.
Hyprland does not read XDG autostart, so add `exec-once = pal` to
`hyprland.conf` instead.

## The hotkey

`Ctrl+Space` by default, on both platforms. Change it in Settings under
Hotkey, or set `general.hotkey` in the config file (`alt+space`,
`cmd+shift+p`, ...). An empty value turns the hotkey off, for a compositor
bind that runs `pal toggle`.

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

## The config file

`~/.config/pal/config.toml` on both platforms (`$XDG_CONFIG_HOME/pal/config.toml`
when that variable is set; `PAL_CONFIG=<path>` overrides both). The first
launch creates it from a two-line template and puts `config.schema.json`
next to it, so an editor with TOML schema support validates and completes
the file.

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
- Your own extensions: `~/.config/pal/extensions/<name>/index.ts`, see
  [Extensions](extensions.md).
