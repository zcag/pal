# Palettes

The palettes that ship with pal. Each is an extension under `extensions/`
with a `pal.json` manifest; its settings go under `[extensions.<name>]` in
the config file unless noted, and the per-palette keys (`enabled`, `alias`,
`hotkey`, `icon`) go under `[palettes.<id>]`. See [Config](config.md).

Three words used below. An **input** palette is never in the index: its
rows come from the extension on every keystroke inside it, and the root
only has the palette's own row. A **live** palette is listed again every
time the panel shows (not twice within 2 s, and with a `ttl` only once its
last listing is older than that), so its rows are current at the root. A
palette that is neither is indexed: listed once, searched from the index,
refreshed with `⌘R`; a `scripts` palette keeps its listing across restarts
for the extension's `ttl` (an hour by default) unless it sets its own.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Applications | `apps` | indexed | launches the app |
| Bookmarks | `bookmarks` | indexed | opens the link |
| Calculator | `calc` | input | copies the result |
| Clipboard History | `clipboard-history` | live, input | pastes into the app in front |
| Emoji | `emoji` | indexed, grid | copies the emoji |
| Files | `files` | input | opens the file |
| Processes | `processes` | live, input | kills the process (after a confirm) |
| SSH Hosts | `ssh` | indexed | opens a terminal running `ssh` |
| System | `system` | live, input | runs the command |
| Windows | `windows` | live | focuses the window |
| Scripts and data files | `scripts-<name>` | as configured | as configured |

## Applications (`apps`)

Installed applications with their own icons.

- **macOS**: `.app` bundles in `/Applications`, `/System/Applications` and
  `~/Applications`, one level deep so the Utilities folders come along. The
  row's subtitle is where it came from (Applications, macOS, User). The
  bundle id is a keyword, so `com.apple.` or `anthropic` finds the app.
  Enter opens the bundle path with the system opener.
- **Linux**: `.desktop` entries from every XDG data dir (`~/.local/share`,
  `$XDG_DATA_DIRS`, the flatpak exports), first directory wins per desktop
  id. Entries with `NoDisplay`, `Hidden`, a `TryExec` that is not installed,
  or an `OnlyShowIn`/`NotShowIn` that excludes `$XDG_CURRENT_DESKTOP` are
  skipped. `Comment` (else `GenericName`) is the subtitle; `GenericName`,
  `Keywords`, the binary and the desktop id are keywords. Enter launches
  through `gio launch`, else `gtk-launch`, else the parsed `Exec`.
  `Terminal=true` entries run in `$TERMINAL`, else the first of kitty,
  foot, xterm found on PATH.

Actions: one, Open.

Settings, `[extensions.apps]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `[]` | Extra folders scanned in addition to the system's application folders. `~` is expanded. A change rescans. |

## Bookmarks (`bookmarks`)

Hand-picked links from a JSON file: a JSON array of objects with `name` and
`url`, plus optional `subtitle` (the url when absent), `icon` (a glyph,
emoji or hex colour; a row with a url and no icon gets the site's favicon)
and `keywords` (a list of strings). Same file as v1's bookmarks palette.

```json
[
  { "name": "Home Assistant", "url": "http://ha.lan", "keywords": ["ha", "home"] },
  { "name": "GitHub", "url": "https://github.com", "icon": "🐙" }
]
```

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Open in browser | `Enter` | opens the url |
| Copy link | `⌘C` | copies the url |

Settings, `[extensions.bookmarks]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `file` | path | `~/.config/pal/data/bookmarks.json` | The bookmarks file. `~` is expanded. |

## Calculator (`calc`)

An input palette: what you type is evaluated on every keystroke by
[mathjs](https://mathjs.org). The result is the row's title, the expression
its subtitle; `Enter` copies the result. An expression that does not
evaluate gives an empty list. With nothing typed the palette shows two hint
rows with examples.

Before mathjs sees it, the query is rewritten for three calculator idioms
mathjs lacks: `15% of 240` becomes `(15/100)*240`, a bare `15%` becomes
`(15/100)`, and `°C` / `°F` become `degC` / `degF`.

What works (checked against the bundled mathjs):

| expression | result |
| --- | --- |
| `2+2`, `10 / 3`, `2^10`, `5!`, `1e3`, `0x1f` | `4`, `3.3333333333333`, `1024`, `120`, `1000`, `31` |
| `sqrt(16)`, `sin(pi/2)`, `log(100,10)`, `abs(-3)`, `round(2.567, 2)` | `4`, `1`, `2`, `3`, `2.57` |
| `15% of 240`, `15%` | `36`, `0.15` |
| `12 GB to MB`, `1 GiB to MB`, `3 weeks to days`, `3 inches to cm`, `1 mile to km`, `5 kg to lb` | `12000 MB`, `1073.741824 MB`, `21 days`, `7.62 cm`, `1.609344 km`, `11.023113109244 lb` |
| `72 °F to °C`, `72 degF to degC` | `22.222222222222 degC` |
| `2 hours + 30 minutes to minutes` | `150 minutes` |
| `hex(255)` | `"0xff"` |

What does not:

- Currencies (`5 usd to eur`): mathjs has no exchange rates.
- Words mathjs does not know: `now`, `tomorrow`, `mph`, `20% off 50`.
- A trailing `=` or an incomplete expression (`1 +`).
- `50 + 10%` is `50.1`, not `55`: the bare percent is a fraction, and only
  `% of` multiplies.
- Variables do not persist between keystrokes: `x = 5` shows `5`, but a
  later `x` is undefined. Each evaluation starts from an empty scope.

Actions: one, Copy result.

Settings, `[extensions.calc]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `precision` | number, 2 to 20 | `14` | Significant digits in the result. |

## Clipboard History (`clipboard-history`)

What you copied, searchable, with images. Text, images and file lists are
recorded by a watcher that runs while pal runs; the search is SQLite
full-text search over the text, ordered pinned first, then newest. The
palette opens with the detail pane showing: the full text (fenced), the
image, or the file list, with kind, size, source app and time as metadata.
A row that is a single url gets the site's favicon; the source app and the
time are accessories, and a pinned entry carries a `pinned` tag.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Paste | `Enter` | hides the panel and pastes the entry into the app that was in front |
| Copy | `⌘Enter` | puts the entry back on the clipboard |
| Pin / Unpin | `⌘P` | pinned entries sort first and never expire |
| Delete | `⌘D` | removes the entry; asks first |
| Clear history | `⌘⇧D` | removes every entry, pinned ones included; asks first |

`primary_action = "copy"` swaps the first two, so `Enter` copies and
`⌘Enter` pastes.

**Paste needs the Accessibility permission on macOS**: the paste is a
synthesised Cmd+V, which the system only delivers from a process on the
Accessibility list. Without it pal shows the system prompt once per run
and a toast, "Paste needs Accessibility. Grant pal in System Settings >
Privacy & Security > Accessibility", instead of half-doing it. On Linux the
paste is Ctrl+V through `wtype`, else `ydotool` (which needs `ydotoold`
running); with neither, paste fails and the toast says so.

What is never recorded: anything a password manager marks as concealed or
transient (the `org.nspasteboard` convention), copies over 10 MB, and
copies made while an app in `exclude_apps` is in front. Copying something
already in history bumps it to the top instead of adding a duplicate.

Retention runs after every copy: unpinned entries older than
`max_age_days` are deleted, then the unpinned tail past `max_entries`.
Pinned entries never expire. A search lists at most 200 rows of what is
left, newest first after the pinned ones; type more to narrow it.

Settings, `[extensions.clipboard]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `exclude_apps` | list | `["com.apple.keychainaccess", "com.apple.Passwords"]` | Bundle ids (`com.1password.1password`) or readable names (`Slack`). The recorder skips copies made while one of them is in front, and entries already recorded from one are not listed. The default is Keychain Access and Passwords; `[]` excludes nothing. |
| `max_entries` | number, 1 to 100000 | `1000` | How many unpinned entries history keeps. |
| `max_age_days` | number, 0 to 3650 | `30` | Unpinned entries older than this are deleted. `0` is no age limit: entries stay until the count limit. |
| `primary_action` | `paste`, `copy` | `"paste"` | What `Enter` does on an entry. |

The recorder reads the three retention keys once, when pal starts, so a
change to them takes effect at the next launch (`primary_action` applies
live). On Linux the source app of a copy is not known (neither X11 nor the
Wayland data-control protocol says who owns the selection), so
`exclude_apps` has no effect there.

## Emoji (`emoji`)

A grid of every emoji in the bundled list, searched by name and keyword.
The tile is the glyph; the name is the shortcode with spaces.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Copy emoji | `Enter` | copies the glyph |
| Copy shortcode | `⌘⇧C` | copies `:shortcode:` |

Settings, per palette, `[palettes.emoji.settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `columns` | number, 4 to 16 | `10` | Tiles per row in the grid. Read once when the extension loads: after a change, Settings > Restart extension host. |

## Processes (`processes`)

What is running, from `ps`, listed again on every keystroke because the
set changes constantly (an input palette; the root only has its own row).
The query matches the name or a pid prefix. The row is the executable's
name, its full path the subtitle on macOS (Linux `ps` gives only the
name); the pid and the resident memory sit on the right, and a process
above 10% CPU carries a `NN% cpu` tag (orange, red from 50%). Rows are
sorted by CPU, then memory. On macOS a process that lives in a `.app`
bundle gets that app's icon.

The filter dropdown scopes the list:

| filter | rows |
| --- | --- |
| All | everything (the default) |
| Mine | your own user's processes |
| Top CPU | the 25 busiest |
| Top memory | the 25 largest, by resident memory |

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Kill | `Enter` | `SIGTERM`, after a confirm; the palette stays open and lists again |
| Force kill | `⌘⇧K` | `SIGKILL`, after a confirm |
| Copy PID | `⌘C` | copies the pid |

A kill that fails (a process of another user, a pid that is gone) keeps
the panel open with a toast carrying the OS's message.

Settings, `[extensions.processes]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_system` | bool | `false` | List system processes too: pids below 100, and kernel threads (children of `kthreadd`) on Linux. |

## SSH Hosts (`ssh`)

Every `Host` in `~/.ssh/config` that is a name rather than a pattern
(`*`, `?` and `!` entries are skipped, a `Host a b` line gives two rows),
in file order. `Include` lines are followed one level: `~`, absolute and
globbed operands work, a relative one is under `~/.ssh`. A `Match` block
ends the current host. `HostName` is the subtitle (and a keyword, so the
real name finds the alias), `User` an accessory and a keyword, `Port` a
tag.

With `include_known_hosts` on, the names in `~/.ssh/known_hosts` (next to
the config) come after, in a second section: `[host]:port` unwrapped,
comma lists split, hashed lines, bare IPs and hosts already in the config
skipped.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Connect | `Enter` | opens a terminal window running `ssh <host>` |
| Copy host | `⌘C` | copies the host name |
| Copy ssh command | `⌘⇧C` | copies `ssh <host>` |

Which terminal Connect opens:

- **macOS**: the `terminal` setting. `auto` takes the first installed of
  kitty, Ghostty, Alacritty, iTerm2, Terminal (Terminal is always there,
  so it is the fallback). kitty gets `kitty -1 ssh host` (a new OS window
  in the running instance when that was started single-instance), Ghostty
  and Alacritty `open -na <app> --args -e ssh host`, Terminal and iTerm2
  an AppleScript that opens a window running the command. A terminal that
  is picked but not installed keeps the panel open with a toast.
- **Linux**: `$TERMINAL`, else the first of kitty, foot, alacritty, xterm
  on PATH; kitty and foot take the command as arguments, the others after
  `-e`. Same rule as the Applications palette's terminal entries.

Settings, `[extensions.ssh]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `config` | path | `~/.ssh/config` | The config to read. `~` is expanded; `known_hosts` is looked for next to it. |
| `include_known_hosts` | bool | `false` | List the names in `known_hosts` too, in a second section. |
| `terminal` | `auto`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | macOS only: which terminal Connect opens. |

## Files (`files`)

An input palette over the operating system's own file index: what you type
is a name search on every keystroke, never a walk pal indexes itself. The
row is the file name; the parent folder is the subtitle (home shortened to
`~`); the size and the modification date are accessories. `.app` bundles
get their own icon, everything else a glyph by kind (folder, image,
document, code, archive). Exact and prefix name matches come first, the
rest in the backend's order, at most `limit` rows. With nothing typed the
palette shows one hint row naming the backend and the folders it searches.

The backend is picked once when the extension loads:

| platform | backend | how |
| --- | --- | --- |
| macOS | Spotlight | `mdfind -name <query> -onlyin <folder>...`; case-insensitive substring of the display name, so `kitty` finds `kitty.app` |
| Linux | `fd` | `fd --absolute-path --fixed-strings --max-results <limit> <query> <folders>`; respects `.gitignore` like fd does everywhere |
| Linux, no fd | `locate` | `locate -i <query>`, filtered to the folders (`updatedb` decides how fresh it is) |
| Linux, neither | `find` | `find <folders> -iname '*<query>*'`; walks the folders on every keystroke, and a second hint row says so |

Every search is one process: killed after 3 s, killed as soon as `limit`
paths have been read, and killed when the next keystroke starts a new one.

The detail pane (lazy, asked when the cursor rests on a row) shows the
path, size, modified time and kind; for a text file under 64 KB the first
40 lines in a code block. No image preview: the app's `icon://` scheme
serves app icons, favicons and clipboard images only.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Open | `Enter` | the system opener |
| Reveal in Finder / Show in file manager | `⌘Enter` | `open -R` on macOS, `xdg-open` on the parent folder on Linux |
| Copy path | `⌘C` | copies the absolute path |
| Move to Trash | `⌘D` | asks first; Finder's delete on macOS, `gio trash` on Linux; the palette stays open with a toast |

Not there yet: copying the file itself (the clipboard effect carries text
only) and "Open with…" (needs an application picker from the core).

Settings, `[extensions.files]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `["~"]` | Where to search. `~` is expanded. |
| `limit` | number, 1 to 500 | `50` | At most this many rows per query. |
| `show_hidden` | bool | `false` | List files and folders whose name starts with a dot (below the configured folder; `~/.config` as a folder is fine either way). |

## System (`system`)

Sleep, lock, log out, restart, shut down, empty the trash, dark mode,
volume, brightness, do not disturb, eject, show desktop, keep awake. An
input palette (the query filters the rows by title, subtitle and keyword),
live because the Keep Awake row flips to Allow Sleep while a keep-awake is
running. pal hides the panel before running a command, so it lands on the
desktop, not on pal.

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

Log Out, Restart, Shut Down and Empty Trash are destructive: with
`confirm_destructive` on, `Enter` asks "(command) now?" first. A command
that fails keeps the panel open with a toast carrying the tool's message.

Settings, `[extensions.system]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `confirm_destructive` | bool | `true` | Confirm before logging out, restarting, shutting down or emptying the trash. |

## Windows (`windows`)

Every open window with its app's icon, in the desktop's order (front to
back on macOS, most recently focused first on Hyprland), never ranked by
use. A live palette: the list runs on every show, so window titles are
root results. The app name is the subtitle; the bundle id or window class
is a keyword; a minimised window carries a `minimized` tag, one on another
workspace or space `ws <n>` or `other space`, and the monitor when known.

Actions:

| action | shortcut | what |
| --- | --- | --- |
| Focus | `Enter` | hides the panel, then raises the window, restoring it if minimised |
| Close | `⌘W` | closes the window; the palette stays open and lists again |
| Minimize | `⌘M` | minimises; not offered on a window that already is |

- **macOS**: the list comes from CoreGraphics merged with the Accessibility
  API for the parts CoreGraphics does not give (another app's window title,
  whether it is minimised). Without the Accessibility permission the list
  still works (titles only when Screen Recording allows, else the app
  name), focusing falls back to activating the app, and close and minimise
  fail with "needs Accessibility permission". Focus shows the same
  one-time prompt and toast as paste when the permission is missing.
- **Linux**: the backend is detected, not configured. Hyprland when
  `hyprctl` and an instance signature exist (the newest
  `$XDG_RUNTIME_DIR/hypr/*` when the variable is missing, so a
  service-started pal works); Sway on `SWAYSOCK`; X11 on `DISPLAY` plus
  `wmctrl`. Hyprland has no minimise, so pal parks the window on the
  `special:minimized` workspace and Focus brings it back. Sway minimise is
  `move scratchpad`; X11 minimise needs `xdotool`. With none of the three
  the palette reports "no Hyprland, Sway or X11 (wmctrl) session".

Settings, `[extensions.windows]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `include_minimized` | bool | `true` | List minimised windows too (focusing one restores it). |

## Scripts and data files (`scripts`)

The zero-code tier: every `[palette.<name>]` table of a pal v1 config
becomes a palette, backed by a shell script speaking JSON lines or by a
json / jsonl / toml data file. Each such palette has the id
`scripts-<name>`. Its settings and the whole format are in
[Scripts and data files](scripts.md).
