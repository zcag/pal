# Getting started

pal is a keyboard launcher for macOS and Linux. One hotkey opens a panel with
one search box over your apps, bookmarks, clipboard history, emoji, windows,
system commands and a calculator. Each of those is a palette, and every
palette is an extension: the bundled ones and the ones you install or
write are the same kind of thing.

This page walks from install to a first extension, in the order things
come up. Every section points at the page with the detail.

## Install

Download from the [Releases page](https://github.com/zcag/pal/releases).
The builds there today are the previous pal's (`v0.1.x` to `v0.2.1`, a
different program); this pal's first release is not published yet. Until
it is, build from source
([README](https://github.com/zcag/pal#building-from-source)). The files
a release will carry:

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

## First run

pal has no Dock icon. It lives in the menu bar (the system tray on Linux)
and the hotkey brings up the panel from anywhere. The icon's menu has Open
pal, Settings…, Restart extension host, Check for updates… and Quit pal;
`general.menu_bar_icon = false` removes the icon and the hotkey and
`pal settings` still work.

The first panel leads with a Welcome section: a few rows that explain the
panel, open Settings and ask for the one permission most palettes need.
The last row hides them ("Show tips again" in the ⌘K panel brings them
back).

### Permissions on macOS

Three palettes need the Accessibility permission: clipboard history
(pasting into the app in front sends a synthesised ⌘V), windows (raise,
close, minimise) and window management (move and resize); so does
`pal action type`. macOS lists an app under Privacy &
Security > Accessibility only once the app has asked, so pal asks: the
first time the panel opens on a new profile (the system prompt, and System
Settings opened on that pane; `ask_permissions_on_start = false` in the
config turns that off), from the first row of the Welcome section, from
Settings > General > Permissions (a granted / not granted dot and a Grant
button), and the first time a paste, a window switch or a layout is refused (a
toast says so). Flip the switch next to pal in that pane; pal sees it within a
couple of seconds, no restart.

Four more are asked for only by what needs them, never at first run, and
never two at once: the Calendar extension asks for Calendars from its own
row; the Wi-Fi palette asks for Location Services the first time it lists
while you are inside it (its "Wi-Fi names need Location access" row asks
too), because macOS 15 and later show Wi-Fi network names only to an app
with it (the prompt says so; say no and the palette still works, with the
names hidden and that row opening the pane); the OTP palette needs Full
Disk Access, which has no prompt (its row opens the pane, where pal is
added by hand); Snippets' expansion asks for Input Monitoring when it is
switched on (a bar peek's close-on-keypress wants it too, and does without:
the peek closes when the pointer leaves). Settings > General > Permissions
lists all five with what each is for. The Overview lists a permission only
when nothing else will ask for it: Accessibility while it is missing, Full
Disk Access, Input Monitoring once expansion is on, and Calendars or
Location once their prompt was answered no; one the OS has not asked about
yet is not a thing to fix.

The grant is tied to the app's code signature, and pal's releases are
ad-hoc signed, so every build carries a new one. After installing a rebuilt
pal.app the switch can look on and still do nothing: remove pal from the
list (the minus button) and grant it again. A Developer ID signature is
what keeps a grant across updates; releases do not have one.
[Troubleshooting](troubleshooting.md#permissions-on-macos) has the rest.

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

A palette can have a hotkey of its own (`[palettes.<id>] hotkey`), which
opens pal inside it, and one row of a palette can too
(`item_hotkeys`), which runs it without showing the panel: a window layout
on `ctrl+alt+left`, for one ([Config](config.md#palettesid)).

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
   (clipboard entries open with it showing). `⌘⇧M` switches to the compact
   panel (560 px, 32 px rows, no pane, the footer folded into the search
   row) and back; the choice is written to the config file
   (`general.compact`).
10. `⌘R` lists the current palette again, or everything at the root,
    ignoring any cache.
11. Several rows at once: `⇧↓` and `⇧↑` mark the row under the cursor as
    they move, `⌘`-click marks or unmarks one, and in a palette that opts
    in (Files, Windows, `pal pick --multi`) `Tab` marks and steps down, as
    does a bare `x` while nothing is typed. Marked rows carry a check and a
    tint, the footer counts them, and `⌘K` lists only what works on
    several: Open, Reveal, Copy paths, Copy files and Move to Trash for
    files; Close and Minimize for windows; Delete and Copy (the texts
    joined) for clipboard entries; Open in browser for bookmarks (every one
    in a tab). `Enter` runs the first over all of them as one pick. `Esc`
    clears the marks first.
12. Dialog jump: with an app's Open or Save panel up, the empty root leads
    with a "Dialog" hint and every Files or Recent Files row leads with
    "Use in TextEdit's open panel" (`⌘G`): pal hides and types the path
    into the panel through its Go to Folder sheet (`Ctrl+L` on a GTK
    chooser), so a search in pal points the dialog anywhere.
13. Folders: `Enter` (or `→`) on a folder row in Files browses it as a
    level (the crumb is the folder, `..` first, `←` or `⌫` goes up, the
    dropdown sorts by name, date or size, `⌘.` shows hidden files); `~/`
    or `/` typed in Files lists that folder the same way.
14. `⌘⇧C` on anything copies its `pal://` link ([Links](links.md)).

On Linux, `⌘` in the above is `Ctrl`. The whole grammar is in
[Keyboard](keyboard.md).

## The root: inline answers, fallbacks, and the empty list

The root list is more than the index's hits.

- **Inline answers.** A query that reads as something a palette can
  answer on the spot is answered at the root, under that palette's name,
  above the hits: `2+2`, `15% of 80`, `12 usd to try`, `5 km to miles`,
  `3 days from now` (Calculator: Enter copies the result), `#ff6b35`,
  `rgb(255 136 0)`, `rebeccapurple` (Convert Colour: the first notations,
  Enter opens the picker on it), `docs.rs/serde` or any address
  (Quicklinks: Open), `~/Down` or `/usr/local` (Files: the file, or the
  entries that complete it; Enter opens, ⌘Enter reveals). The local hits
  paint first; the inline rows arrive a beat later and are dropped the
  moment the query moves on. A palette opts in with `match` and `inline`
  ([Extensions](extensions.md#the-code-indexts)).
- **Fallbacks.** When nothing matches, the rows under "Use “…” with" say
  what the query can still do: Search the web (the engine in
  `general.search_engine`), Open as URL when it reads as one, every
  quicklink with a `{query}` filled in, Ask Calculator, Search Files, and
  "Ask `<palette>`" for any palette that opted in. Enter on an Ask row
  opens the palette with the query already typed. `general.fallbacks`
  orders them; `general.fallbacks_always` shows them under the hits too
  ([Config](config.md#general)).
- **Alias and space.** A palette's alias (`[palettes.<id>] alias`), its
  name, its one-word title, or a prefix of two letters or more that only
  one palette answers to, followed by a space, jumps into it with the rest
  typed there: `em cat`, `calc 2+2`, `files report`. An extension's name
  (or its prefix) stands for its search palette, so `tela pal` is tela's
  search with `pal` typed and the results live. The crumb shows where you
  are; Escape twice is back at the root. `general.alias_space = false`
  turns it off.
- **The empty list.** Before you type: the Welcome tips on a fresh
  install, then **Now** (the current or next calendar event with Join on
  Enter, the running timer, what is playing), then **Clipboard** (what is
  on the clipboard, read as the things it could be: an address to open or
  show as a QR code, a colour for the picker, a path to reveal, an email,
  a phone number, JSON to pretty-print, an expression with its answer, a
  timestamp in local time, a hex or base64 string decoded, a tracking
  number, a GitHub ref, an image to save or read; "Hide" in ⌘K keeps the
  section away until the next copy), then **Frequent** (the five rows you
  pick most), then **Recent Files**, then your palettes and the rest by
  use. `general.now` orders the Now palettes.
- **Search history.** Up at the top of the empty list brings back the
  last query that led to a pick, Up again the one before, Down forward,
  Escape clears. "Clear Search History" is in pal's own commands;
  `general.search_history = false` turns it off.
- **Reset ranking.** ⌘K on any row has "Reset ranking for this item":
  its history of picks and the queries that found it are forgotten, so it
  ranks as never used. Settings > General > Maintenance resets all of it.
- **Where a re-show lands.** Hide pal and press the hotkey again within
  90 s and you are where you left, level and query kept; later than that,
  at the root. `general.pop_to_root` is `"always"`, `"never"` or `"after
  <seconds>s"`.

## Palettes

A palette is one list with its own actions: Applications, Clipboard
History, Emoji, Files, Windows, Calculator and a hundred more ship with
pal, in fifty-five extensions.
[Palettes](palettes.md) describes each with its keys and settings. Three
kinds, which matter for what the root shows: an **indexed** palette is
listed once and searched from the index (apps, bookmarks, emoji); a
**live** one is listed again on every show (windows, processes); an
**input** one answers each keystroke inside it and puts only its own row
at the root (the calculator, Files, a web search). At the root every
palette has a tier that says how many rows it may take for a typed query
([Extensions](extensions.md#tier-what-the-rows-are-at-the-root)).

Every palette has an id (`apps`, `clipboard-history`, `github-prs`) and
a table `[palettes.<id>]` in the config file for what pal provides
without the extension's say: `enabled`, `alias`, `hotkey`,
`item_hotkeys`, `icon`, `tier`, and the palette's own `settings`
([Config](config.md#palettesid)). Settings > Palettes edits the same.

Two ways to make the panel yours: a theme file (`general.theme_file`,
Settings > General > Theme file; two examples ship, Catppuccin Frappé and
Rosé Pine Dawn) recolours every window from a TOML of tokens, and
Snippets' expansion (`expand = true`, macOS) replaces a keyword typed in
any app with its snippet. Both in [Config](config.md#theme-file) and
[Palettes](palettes.md#snippets-snippets).

## The bar

An extension can put an item on the macOS menu bar, or on sketchybar
when one is running (`[bar] target`, `auto` by default): a glyph, a short
title, a badge, and a popover on a click, a hover or a hotkey. The
bundled ones are the running timer, today's next event, what is playing,
the newest verification code, and the unread counts of GitHub, Slack,
Gmail and WhatsApp once those are signed in; an item takes no space
while it has nothing to say, so a fresh install shows none. Settings >
Bar lists every item with its target, position, hotkey and appearance
(`[bar]` in [Config](config.md#bar)). Not drawn on Linux: the table is
read and the items are listed by `pal bar list`, but no item renders.

## Settings

`⌘,` in the panel, `pal settings`, or Settings… in the menu bar icon's
menu opens the Settings window: six pages across the top. **Overview**
is what needs attention (a hotkey that did not register, a missing
permission, an extension that needs a token, a config file problem, an
update) and the counts; **General** the hotkeys, permissions, theme,
position, startup, the config file and maintenance (reset the search
history, restart the extension host, list everything again);
**Palettes** every palette with its switch, alias, hotkey, icon, tier,
item hotkeys and declared settings; **Extensions** every extension with
its settings, its instances, load errors and warnings, and a box that
installs one; **Bar** the bar items; **About** the version, the updater
and the last crash. `/` focuses the window's search, which finds any
setting on any page; `Esc` hides the window.

Every change the window makes is a write to the config file, and every
hand edit shows in the window at once.

## The config file

`~/.config/pal/config.toml` on both platforms
(`$XDG_CONFIG_HOME/pal/config.toml` when that variable is set;
`PAL_CONFIG=<path>` overrides both). The first launch creates it from a two-line
template whose first line points an editor with TOML schema support at the
published schema, so it validates and completes the file. The only other
thing written into that directory is a `themes/` folder with the two example
theme files, the first time the Settings window opens
([Config](config.md#theme-file)). A config file from the previous pal found
there is migrated first: kept whole as `config.v1.toml` and run through the
`scripts` extension ([Config](config.md#coming-from-the-previous-pal)).

The window's General page has an Open file button for the editor of your
choice; edits are picked up live, keeping your comments and formatting.
Every key, with its default, is in [Config](config.md).

## Extensions and the store

Every palette is an extension: a directory with a `pal.json` and an
`index.ts` that runs inside one long-lived Bun process, the extension
host. The bundled ones ship with pal; more are at
[pal.cagdas.io/extensions](https://pal.cagdas.io/extensions), and the
**Store** palette lists the same in the panel, tagged by what is
installed, with the description, screenshots and keys in the detail
pane; Enter installs ([Palettes](palettes.md#store-store)). From the
shell, `pal install wordle` (a store name), `pal install
github:user/repo` or `pal install ~/src/my-extension`; `pal update`,
`pal remove` and `pal list` do the rest ([CLI](cli.md)). Installed
extensions live in the store directory under pal's data directory; a
directory you keep in dotfiles is loaded through `general.extension_dirs`.

An extension with several accounts (GitHub, Slack, Gmail, Home Assistant)
runs as instances: Settings > Extensions has "Add another account", and
`[instances."github@work"]` in the file is the same thing
([Config](config.md#instances)).

Writing one is a directory with two files; the walkthrough is in
[Extensions](extensions.md#writing-one), and the zero-code tier, a
palette from a data file or a shell script, in
[Scripts and data files](scripts.md).

## The CLI and links

The `pal` binary is the app: `pal toggle`, `pal show`, `pal settings`,
`pal open emoji/emoji -q smile`, `pal copy`, `pal paste`, `pal hud`, `pal
pick` (the panel as a picker for a script) and the store commands reach
the running pal ([CLI](cli.md)). Every one of them is also a `pal://`
link (`pal://open/emoji/emoji?q=smile`) that works from a browser, a
bookmark, a Shortcuts action or a keybind, and extensions declare routes
of their own (`pal://timer/start?duration=25m`); a link that acts asks
first, a command never does ([Links](links.md)). `⌘⇧C` on any row copies
its link.

## pal's own commands

pal's own housekeeping is in the root search too, as rows of a `pal`
section, the way Raycast lists "Raycast Settings" or "Quit Raycast":
Settings (and Settings › Extensions, › Palettes, › About), Extension Store,
Install Extension (a form: `github:user/repo`, a GitHub URL or a local
directory), Reload Extensions (restarts the extension host), Refresh Index,
Check for Updates (and Install Update, listed only while a newer release is
known), Open Config File and Reveal Config File, Show Tips Again,
Documentation, Report a Bug (a GitHub issue with your version and OS filled
in), Copy Diagnostics (version, OS, config path, extensions, hotkey and
permission status, onto the clipboard), Toggle Theme (light, dark, system),
Clear Search History (what Up recalls at an empty root), Quit pal (asks
first), Restart pal, and pal Version (Enter copies it). Every
row answers to `pal`, so `pal set` finds Settings and `pal quit` Quit. They
are searched and ranked like any other row; `⌘,`, `⌘R` and the action
panel's "Open Settings", "Refresh everything" and "Show tips again" run the
same code. Each has a link too, `pal://commands/<id>`
([Links](links.md#the-routes)).

## Updates

pal looks for a newer release 20 s after it starts and once a day while
`general.check_updates` is on (the check reads `latest.json` from the
latest GitHub release; nothing is downloaded by it). A found release
shows in three places, and installing is always your click: Settings ›
About, where the Version row gets an "Install `<version>`" button; the
Overview, where it is a row with Install inline; and the root, where an
"Install Update" row appears under the `pal` section until it is
installed (Check for Updates, on the About page, the menu bar icon or the
root row, runs a check any time).

Install downloads the signed bundle, verifies it against the key built
into pal, puts it in place and relaunches pal: the HUD says where it is
("Downloading pal 0.2.0: 40%", "Installing", "installed, restarting")
and the About row says the same. macOS replaces `pal.app` where it is
(the Accessibility grant is lost with the ad-hoc signature, as above).
Linux replaces the AppImage where it is; the `.deb` and `.rpm` are the
package manager's, so on those builds the row says so and points at the
releases page (download the new package, `dpkg -i` or `rpm -U` it), and a
bare binary you built yourself is not updated either. A development build
never is.

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
- Extension storage (quicklinks, snippets, tokens some extensions keep):
  `storage/<extension>.json`, next to `clipboard.db`.
- The log: every line pal and its extension host print, when pal was not
  started from a terminal: `~/Library/Logs/pal/pal.log` on macOS,
  `~/.local/state/pal/pal.log` on Linux (`$XDG_STATE_HOME/pal/` when set).
  Rotated to `pal.log.1` past 5 MB at startup. Copy Diagnostics names it.

When something does not work, [Troubleshooting](troubleshooting.md) goes
through the log, the permissions, the hotkey, PATH, the extension host and
a palette that lists nothing.
