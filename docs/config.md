# Config

One TOML file holds every setting: `~/.config/pal/config.toml`
(`$XDG_CONFIG_HOME/pal/config.toml` when that variable is set, on macOS
too). The file is the source of truth. The Settings window reads and writes
it, and a hand edit is picked up live. A key you do not set has its default;
an empty or missing file is all defaults.

## The file

```toml
#:schema https://raw.githubusercontent.com/zcag/pal/main/core/schema/config.schema.json
# pal settings. The settings view writes this file; editing by hand is fine too.

[general]
hotkey = "ctrl+space"      # global hotkey, or several: ["cmd+space", "ctrl+space"]; "" turns it off (bind `pal toggle` instead)
theme = "system"           # system | light | dark
position = "top"           # top | centre | last
launch_at_login = false
menu_bar_icon = true
check_updates = true
ask_permissions_on_start = true   # macOS: ask for Accessibility on first show
selection_snapshot = true         # {selection}: fall back to a copy shortcut when the app hides its selection from the accessibility API
deeplink_confirm = true    # a pal:// link that acts asks first; false never asks; ["timer"] asks except for those extensions
extension_dirs = ["~/dotfiles/pal-extensions"]   # extra extension roots, loaded after the store

# Per-palette settings, keyed by palette id. Absent palette: all defaults.
[palettes.clipboard-history]
alias = "cb"               # extra keyword on the palette's row at the root
hotkey = "ctrl+shift+v"    # opens pal straight inside this palette

[palettes.calc]
icon = "∑"                 # replaces the extension's icon on the palette row

[palettes.windows]
enabled = false            # no rows in the index, no palette row

[palettes.emoji.settings]  # settings the extension declared for this palette
columns = 8

# Extension settings, keyed by extension name. Shape is whatever the
# extension declared in its pal.json.
[extensions.clipboard]
exclude_apps = ["com.1password.1password"]
primary_action = "copy"

[extensions.apps]
folders = ["~/Applications/Nix Apps"]

[extensions.github]
token = "keychain:pal/github-token"   # a secret reference, never the value
```

The first line is taplo's schema directive, pointing at the committed
schema's URL (`core/schema/config.schema.json` on `main`), so an editor
with TOML schema support (VS Code "Even Better TOML", nvim through taplo)
validates keys and completes them; taplo fetches it. The first launch
writes those two header lines and nothing else into the config directory.

## `[general]`

| key | type | default | what |
| --- | --- | --- | --- |
| `hotkey` | string, or list of strings | `"ctrl+space"` | Global hotkey that shows pal, or several that all do: `hotkey = ["cmd+space", "ctrl+space"]`. Every entry registers; one another app or Spotlight holds is reported on its own row in Settings and costs the others nothing. Empty (`""` or `[]`) turns it off, for a compositor keybind that runs `pal toggle` instead. Settings writes back whichever spelling the file has, and turns a string into a list only when Add another gives it a second entry (up to three there; the file may hold more). The menu bar hint and the Welcome tips show the first. |
| `theme` | `system`, `light`, `dark` | `"system"` | Follow the OS, or force one. Applied live to the panel and the Settings window. |
| `position` | `top`, `centre`, `last` | `"top"` | Where the panel appears on the screen with the pointer. `top`: a fifth of the way down, where Spotlight and Raycast sit. `centre`: centred. `last`: wherever it was last shown. On Wayland the compositor places the window and this key does nothing (see [Getting started](getting-started.md)). |
| `launch_at_login` | bool | `false` | Start pal when you sign in: a LaunchAgent (`~/Library/LaunchAgents/io.cagdas.pal.plist`) on macOS, a `pal.service` user unit (or, without systemd, an XDG autostart entry) on Linux. The same agent relaunches pal after a crash, on or off; see [Crash relaunch](#crash-relaunch). |
| `menu_bar_icon` | bool | `true` | Show pal's icon in the menu bar (macOS) or system tray (Linux). The app has no Dock icon, so this is the visible way to reach Settings and Quit; the hotkey and `pal settings` work without it. |
| `check_updates` | bool | `true` | Look for a newer release 20 s after startup and once a day, in release builds (the GitHub release manifest; nothing is downloaded). Today a found update is a log line: download and install are not wired, and the menu's "Check for updates" is a disabled placeholder until they are, so `false` means no automatic check at all: neither this one nor the settings Overview's (which otherwise checks the app and the store's extensions when it opens, at most once a day). The Overview's "Check now" and About's "Check for Updates" run regardless. |
| `extension_dirs` | list of paths | `[]` | Extra directories of extensions, one subdirectory per extension like the store, for a dotfiles-managed set. Loaded after the bundled extensions and the store, in order, so a later directory's extension replaces an earlier one's by name. `~` is expanded. Read when the host starts: `pal reload` after a change. See [Extensions](extensions.md). |
| `ask_permissions_on_start` | bool | `true` | macOS: ask for the Accessibility permission (the system prompt, and System Settings opened on that pane) the first time the panel shows on a profile that has not hidden the Welcome tips yet. Paste and window switching need it. `false` leaves the ask to the Welcome row and to Settings > General > Permissions. Nothing on Linux. |
| `selection_snapshot` | bool | `true` | When an app does not expose its selected text to the accessibility API (`selection.text()`, `{selection}` in a snippet), send the copy shortcut and read the clipboard, then put it back as it was; pal's own history records none of it. `false` keeps pal off the clipboard: the selection is then only what the API reports. macOS needs Accessibility for either. |
| `root_caps` | table | `{ primary = 8, normal = 6, catalog = 3 }` | How many rows one palette may show at the root for a typed query, by its tier ([Extensions](extensions.md#tier-what-the-rows-are-at-the-root)); the rest is a "12 more in Emoji" row that opens the palette. Inline, `root_caps = { catalog = 5 }` keeps the other two at their defaults. The empty query and a palette's own level are never capped. |
| `fallbacks` | list of strings | `["web", "url", "quicklinks", "calc", "files"]` | The rows offered when a typed query matches nothing, in this order ([Getting started](getting-started.md#the-root-inline-answers-fallbacks-and-the-empty-list)): `web` is Search the web (through `search_engine`), `url` is Open as URL (only when the query reads as one: a scheme, or `docs.rs/serde`, `localhost:8080`), and the rest are palette ids that opted in (`quicklinks` lists every `{query}` link filled in, `calc` and `files` open with the query typed, any other input palette that declared it as "Ask <name>"). A fallback palette not named here comes after these, in load order; an id that names nothing is skipped. |
| `fallbacks_always` | bool | `false` | Show the fallback rows under the hits as well, not only when nothing matched. |
| `search_engine` | string | `"https://www.google.com/search?q={query}"` | The Search the web fallback's URL; `{query}` is percent-encoded into it (`https://duckduckgo.com/?q={query}`, `https://kagi.com/search?q={query}`). Without the placeholder the query is appended. |
| `alias_space` | bool | `true` | Typing a palette's alias (or its palette name, or its one-word title) and a space at the root jumps into that palette with whatever follows typed there: `em cat`, `calc 2+2`, `files report`. Only a word typed forward jumps (a deletion never does), and only when exactly one palette answers to it. `false` leaves the space as a character. |
| `search_history` | bool | `true` | Remember the last 20 root queries that led to a pick (in `frecency.json` under the profile, never synced). Up at the top of an empty root list recalls them, newest first; Down walks back; Escape clears. "Clear Search History" in pal's own commands empties them. `false` neither records nor recalls. |
| `pop_to_root` | `"always"`, `"never"`, `"after 90s"` | `"after 90s"` | Where a re-show lands: `"always"` back at the root with an empty box, `"never"` where you left (the level and the query kept), `"after 90s"` (any number of seconds; `2m`, `1h` read too) kept while the panel was hidden for less than that, the root after. A palette hotkey opens its palette either way. |
| `now` | list of strings | `["calendar-today", "timer-timers", "media", "clipboard-rows"]` | The palettes whose suggestions lead the empty root (the "Now" section: the next event, the running timer, what is playing; the "Clipboard" section: what is on the clipboard), in this order; suggesting palettes not named here follow in load order. |
| `deeplink_confirm` | bool or string[] | `true` | A `pal://` link that acts (`run`, `form`, `paste`, `open?url=`, a bar action, an extension's route; a web page can emit one) shows a card naming what it is about to do. `false` runs it straight away, for a machine that scripts pal by link; a list of extension names (`["timer", "quicklinks"]`) asks for everything except links into those extensions. `install`, `update` and `remove` always ask; the `pal` commands never do. See [Links](links.md). |

Hotkey syntax: modifiers first, `+` between, one main key, case does not
matter. Modifiers: `ctrl` (or `control`), `alt` (or `option`), `cmd` (or
`command`, `super`), `shift`, `cmdorctrl` (Cmd on macOS, Ctrl elsewhere).
Keys: letters, digits, `space`, `enter`, `f1`..`f12`, punctuation and the
rest of the usual key names. A `general.hotkey` entry that does not parse
is reported and skipped; when none parses the first falls back to
`ctrl+space` and is logged, so pal stays reachable. A hotkey another app
already holds is reported and skipped: the other entries still register,
and when none of them could be had the previous root hotkeys stay
registered. Settings > General says "Not registered" with the OS's reason
under that entry's field, and the Overview names it. On macOS `cmd+space`
is Spotlight's until "Show Spotlight search" is unticked under System
Settings > Keyboard > Keyboard Shortcuts > Spotlight; pal reads that
binding, says so in Settings, and while the key is wanted and held polls
it every 2 s so the registration lands as soon as it is freed. On Linux
the hotkey reaches only X11 clients; Wayland sessions bind `pal toggle`
in the compositor.

## `[palettes.<id>]`

Settings pal provides to every palette without the extension declaring
them. A palette absent from the file gets the defaults.

| key | type | default | what |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | `false` removes the palette's rows from the index and its row from the root. The palette stays known, so re-enabling is immediate. The settings view unsets the key rather than writing `true`. |
| `alias` | string | unset | A short name for the palette. It is added as a keyword on the palette's row at the root, so typing it finds the palette; `Enter` opens it. |
| `hotkey` | string | unset | A global hotkey that opens pal directly in this palette. Same syntax as `general.hotkey`; the root hotkey wins a clash. Registered once the palette exists. |
| `item_hotkeys` | table of strings | `{}` | Global hotkeys that run one item of the palette without showing the panel, keyed by the item's id: the item's primary action runs as if you had pressed `Enter` on it, and whatever it shows after hiding (the HUD) still shows. `[palettes.window-management.item_hotkeys]` with `left_half = "ctrl+alt+left"` is the case it exists for ([Window Management](palettes.md#window-management-window-management)); any palette's item ids work, an indexed palette's being the stable ones. Same syntax and registration as `hotkey`; in a clash the root hotkey wins, then a palette's, then an item's. Config-only for now: the Settings window does not list these. |
| `icon` | string | unset | Icon override for the palette's row; the extension's own icon when unset. A glyph, an emoji or a hex colour. |
| `tier` | `primary`, `normal`, `catalog` | unset | The palette's tier at the root over what its manifest says: `primary` is ranked up and capped at `root_caps.primary` rows, `catalog` ranked down and capped at `root_caps.catalog` ([Extensions](extensions.md#tier-what-the-rows-are-at-the-root)). `tier = "catalog"` on a data-file palette whose rows flood the root; `tier = "primary"` on one you reach for by name. Config-only for now. |
| `settings` | table | `{}` | Settings the extension declared for this palette, from `palettes.<key>.settings` in its `pal.json`. `[palettes.emoji.settings]` or inline `settings.columns = 8`. |

The id is the extension's name when the palette is named like it (`apps`,
`emoji`, `calc`, `system`, `windows`, `bookmarks`), else
`<extension>-<palette>` (`clipboard-history`; a script palette named `otp`
is `scripts-otp`). Bare keys, no quoting.

## `[bar]`

Bar items: what extensions put on the macOS menu bar or on sketchybar
(the design in `docs/design/bar.md`; what an extension declares in
[Extensions](extensions.md)). Every item is keyed `<extension>/<id>`.
Not on Linux yet: the table is read and kept there, declared items are
listed by `pal bar list`, but nothing is drawn and no item renders
(Settings > Bar says so).

| key | type | default | what |
| --- | --- | --- | --- |
| `target` | `"auto"`, `"menubar"`, `"sketchybar"`, `"both"`, `"off"` | `"auto"` | Where items are drawn. `auto` is sketchybar when `sketchybar --query bar` answers (probed at start, on a `[bar]` change, on wake and on a Space change), else the menu bar. |
| `hover_delay` | integer, ms | `250` | How long the pointer rests on an item before its popover peeks. |
| `hover_grace` | integer, ms | `400` | How long after the pointer has left both the item and the popover a peek stays. |
| `menubar.open_on_hover` | bool | `false` | A hover peeks on the menu bar (Apple's bar has no hover convention, so off). |
| `sketchybar.open_on_hover` | bool | `true` | A hover peeks on sketchybar. |
| `sketchybar.position` | string | `"right"` | Where pal's items go: `left`, `right`, `center`, `q`, `e`, or `before:<item>` / `after:<item>` next to one of the bar's own items. |
| `sketchybar.colors` | table of strings | `{}` | Overrides of the colour names the model uses (`red`, `amber`, `muted`, `text`, ...) as `0xAARRGGBB` or `#rrggbb`, so a themed bar keeps its own palette. |

Per item, `[bar.items."<extension>/<id>"]` (the key needs quoting):

| key | type | default | what |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | `false` takes the item off every target and stops its refresh. |
| `target` | as above | unset | This item's target; the global one when unset. |
| `position` | string | unset | This item's sketchybar position; `sketchybar.position` when unset. |
| `hotkey` | string | unset | A global hotkey that opens the item's popover (or runs its open action). Same syntax as `general.hotkey`; the root and palette hotkeys win a clash. |
| `open_on_hover` | bool | unset | This item's say on hovering; the target's default when unset. |
| `order` | integer | `0` | Order among pal's own items, ascending left to right (on the menu bar, and within one sketchybar position). |

A change re-targets, moves or removes items live. pal only ever touches
sketchybar items named `pal.<extension>.<id>` (a segment is
`pal.<extension>.<id>.<segment>`, a count badge `pal.<extension>.<id>.badge`);
the bar's own items are never touched, and every pal item is removed on
quit. A bar restarted by its own rc (which wipes its items) gets pal's
back at the next probe, or at once with `pal bar sync` at the end of the
rc.

## `[extensions.<name>]`

Extension settings, keyed by extension name. The shape is whatever the
extension declared in its `pal.json`; the defaults live there and the
[Palettes](palettes.md) page lists them for the bundled extensions.

The values an extension sees are the manifest's defaults with every key you
set on top, one level deep: a key you set replaces the default whole (a
list is not appended to, a table not merged). Keys the manifest does not
declare pass through, so a setting written ahead of an upgrade is not lost.
A declared setting set to its default is unset by the settings view, so the
file only holds what differs.

Changes reach a running extension without a restart: the core pushes the
resolved values and lists the extension's palettes again. Three exceptions:
`emoji`'s `columns` is read once at load (edit the file, then Settings >
Restart extension host); the `scripts` extension discovers its palettes
once at import, so its `config`, `skip`, `v1_repo` and `ttl` need a host
restart too (`timeout` and `preview_max` apply to the next run); and the
clipboard recorder, which runs in pal itself rather than in the host,
reads `exclude_apps`, `max_entries` and `max_age_days` once at startup, so
those want pal relaunched.

## Secrets

A setting of kind `secret` never sits in the file as plain text. The file
holds a reference:

- `keychain:<service>/<account>` or `keychain:<account>` (service `pal`):
  the OS store. On macOS that is the Keychain, as a generic password; on
  Linux the Secret Service (gnome-keyring, KWallet's compat service) through
  the `secret-tool` CLI from libsecret, as an item with the attributes
  `service` and `account`. The Settings window writes the value there under
  `pal/<extension>-<key>` and puts `keychain:pal/<extension>-<key>` in the
  file. By hand: `security add-generic-password -s pal -a github-token -w`
  on macOS, `secret-tool store --label="pal github-token" service pal
  account github-token` on Linux.
- `env:<NAME>`: an environment variable of the pal process.

A setting the extension declared `kind: "secret"` reaches it resolved:
the values it gets (at import and on every change) carry the secret itself,
fetched from the store by the core (`core/src/config/secrets.rs`,
`resolve_declared`). Anything that is not a reference passes through as
itself. A reference that does not resolve (no such item, locked keychain)
stays as the reference string and is logged as `secrets  unresolved`; the
extension still loads. Settings of any other kind are never resolved, even
when their value looks like a reference, and neither is a key the manifest
does not declare. Removing a secret in Settings unsets the key; the
keychain item stays. On Linux without `secret-tool` on PATH (package
`libsecret` on Arch, `libsecret-tools` on Debian and Ubuntu) or without a
Secret Service on the session bus, every `keychain:` reference is
unresolved and the log says which of the two is missing; `env:` references
work everywhere.

## Live reload

pal watches the config file's directory (editors save by writing a new file
and renaming it over the old one, and a watch on the old file would go
quiet after the first save). Events within 150 ms collapse into one reload,
and a reload only fires when the bytes changed. After a reload the hotkeys
are re-registered, palettes are removed or listed as `enabled` says,
extensions get their new values, `launch_at_login` and `menu_bar_icon` are
applied, and both windows follow `theme`.

A save that does not parse keeps the last good config live and adds an
error diagnostic; nothing blanks while you are mid-edit. A deleted file is a
reload to the defaults.

## Crash relaunch

pal runs under the OS's service manager so that a crash brings it back
and a quit does not. On macOS the agent is a LaunchAgent labelled after
the bundle (`io.cagdas.pal`) with `RunAtLoad` and
`KeepAlive { SuccessfulExit = false }`: launchd restarts pal after a
non-zero exit or a signal, within about five seconds
(`ThrottleInterval`), and leaves it alone after `pal quit` or the menu's
Quit, which exit 0. `launch_at_login` only decides where the plist lives:
on, `~/Library/LaunchAgents/`, which launchd loads at login; off,
`~/Library/Application Support/pal/launchd/`, which nothing loads at
login and pal bootstraps itself for the session. A pal started by hand
(`open -a pal`, a terminal) hands itself over to the agent at startup, so
the process you see is always the supervised one; that costs one extra
startup and happens at most once a minute, so a manager that will not
start pal cannot loop. On Linux the unit is `~/.config/systemd/user/pal.service`
with `Restart=on-failure` (a transient unit of the same name when the
setting is off); without systemd the XDG entry starts pal at login and
nothing relaunches it. Debug builds do none of this. After a relaunch pal
shows "pal restarted after a crash" once, logs the report it found, and
Settings > About lists the last crash (the `.ips` under
`~/Library/Logs/DiagnosticReports`, or the `coredumpctl` entry) and the
last Rust panic (`<data dir>/<profile>/last-panic.txt`, written by pal's
own panic hook with the message and a backtrace). Nothing is uploaded.

Edits the settings view makes go through `toml_edit`: comments, key order
and spacing you wrote survive.

## Diagnostics

The Settings window shows a strip at the bottom when the file has problems,
one line each:

```text
1 error in config.toml. The file did not parse, so pal is still using the last settings that did.
✕ error   unknown variant `blue`, expected one of `system`, `light`, `dark`   line 3
```

```text
2 warnings in config.toml. Unknown keys stay in the file and are ignored.
! warning   unknown key  general.hotkeys
! warning   unknown key  palettes.clipboard.enabld
```

- A **warning** is an unknown key, shown as its dotted path. The key stays
  in the file and is ignored; a typo'd key does not reach the real one. No
  line number: the parser does not report where an ignored key sits.
- An **error** means the file did not parse (bad TOML, or a value outside
  its enum such as `theme = "blue"`); it carries the 1-based line, and the
  line is a button that opens the file in your editor. The config shown is
  the last good one, or the defaults at startup.

## `PAL_CONFIG` and profiles

`PAL_CONFIG=<path>` makes pal use that file instead of the default. The
index cache and the frecency file are keyed by config file: they live under
`<data dir>/pal/<profile>/`, where `<profile>` is `default` for
`~/.config/pal/config.toml` and the first 8 hex digits of the sha256 of the
file's canonical path otherwise. Two config files never share a cache or a
search history, since a palette enabled in one may not be in the other. The
profile is logged at startup. `clipboard.db` and `storage/` (what
extensions keep through the storage API: quicklinks, snippets) stay one
level up and are shared by every profile: they are your data, not a view of
one config, so a quicklink made under a test profile shows up in all of them.

The data dir is `~/Library/Application Support/pal` on macOS and
`~/.local/share/pal` on Linux (`$XDG_DATA_HOME/pal` when set). The
extension store, `extensions/` in it, is shared by every profile.

A symlinked config file (dotfiles setups) is followed: edits and the watch
go to the real file, so a write never replaces the link with a plain file.
The watch follows the link once, at startup; re-pointing it later is not
seen.

## Coming from pal v1

v1 kept its config at the same path in another shape (`[palette.<name>]`
tables, `general.default_frontend`). The first launch that finds one there
migrates it, and logs each step as a `migrate` line:

- the v1 file is kept whole as `config.v1.toml` next to it (written and
  read back before the original is touched);
- in that copy, a `base` that no longer exists on disk but does under the
  `scripts` extension's `v1_repo` (the v1 checkout, `~/proj/pal-v1` by
  default) is pointed there;
- a new `config.toml` is written from the template, with
  `[extensions.scripts] config` set to the copy's absolute path, so every
  `[palette.*]` table keeps running through [Scripts](scripts.md), and
  `[extensions.bookmarks] file` set to v1's `palette.bookmarks.data` when
  there was one. v1 had no hotkey key; everything else starts from the
  defaults.

A `config.v1.toml` already there with other content stops the migration
(the log says so; move it away). A file already in this shape, or an empty
or missing one, is not touched: the template is written when there is no
file. `cargo run -p pal-core --example migrate` runs the same code on
`PAL_CONFIG`, for a dry run on a copy.
