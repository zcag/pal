# Config

One TOML file holds every setting: `~/.config/pal/config.toml`
(`$XDG_CONFIG_HOME/pal/config.toml` when that variable is set, on macOS
too). The file is the source of truth. The Settings window reads and writes
it, and a hand edit is picked up live. A key you do not set has its default;
an empty or missing file is all defaults.

## The file

```toml
#:schema ./config.schema.json
# pal settings. The settings view writes this file; editing by hand is fine too.

[general]
hotkey = "ctrl+space"      # global hotkey; "" turns it off (bind `pal toggle` instead)
theme = "system"           # system | light | dark
position = "top"           # top | centre | last
launch_at_login = false
menu_bar_icon = true
check_updates = true

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

The first line is taplo's schema directive. The first launch writes the two
header lines and puts `config.schema.json` next to the file, so an editor
with TOML schema support (VS Code "Even Better TOML", nvim through taplo)
validates keys and completes them. The schema is refreshed when a new
release changes it. The committed copy is
`core/schema/config.schema.json`.

## `[general]`

| key | type | default | what |
| --- | --- | --- | --- |
| `hotkey` | string | `"ctrl+space"` | Global hotkey that shows pal. Empty turns it off, for a compositor keybind that runs `pal toggle` instead. |
| `theme` | `system`, `light`, `dark` | `"system"` | Follow the OS, or force one. Applied live to the panel and the Settings window. |
| `position` | `top`, `centre`, `last` | `"top"` | Where the panel appears on the screen with the pointer. `top`: a fifth of the way down, where Spotlight and Raycast sit. `centre`: centred. `last`: wherever it was last shown. On Wayland the compositor places the window and this key does nothing (see [Getting started](getting-started.md)). |
| `launch_at_login` | bool | `false` | Start pal when you sign in: a LaunchAgent (`~/Library/LaunchAgents/io.cagdas.pal.plist`) on macOS, an XDG autostart entry (`~/.config/autostart/pal.desktop`) on Linux. The app registers it when this changes; on macOS the plist takes effect at the next login. |
| `menu_bar_icon` | bool | `true` | Show pal's icon in the menu bar (macOS) or system tray (Linux). The app has no Dock icon, so this is the visible way to reach Settings and Quit; the hotkey and `pal settings` work without it. |
| `check_updates` | bool | `true` | Look for a newer release 20 s after startup and once a day (the GitHub release manifest; nothing installs without asking). `false` leaves the menu's "Check for updates" as the only check. Today a found update is a log line; download and install are not wired, and the menu entry is present but disabled. |

Hotkey syntax: modifiers first, `+` between, one main key, case does not
matter. Modifiers: `ctrl` (or `control`), `alt` (or `option`), `cmd` (or
`command`, `super`), `shift`, `cmdorctrl` (Cmd on macOS, Ctrl elsewhere).
Keys: letters, digits, `space`, `enter`, `f1`..`f12`, punctuation and the
rest of the usual key names. A `general.hotkey` that does not parse falls
back to `ctrl+space` and is logged, so pal stays reachable. A hotkey another
app already holds is reported and skipped. On Linux the hotkey reaches only
X11 clients; Wayland sessions bind `pal toggle` in the compositor.

## `[palettes.<id>]`

Settings pal provides to every palette without the extension declaring
them. A palette absent from the file gets the defaults.

| key | type | default | what |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | `false` removes the palette's rows from the index and its row from the root. The palette stays known, so re-enabling is immediate. The settings view unsets the key rather than writing `true`. |
| `alias` | string | unset | A short name for the palette. It is added as a keyword on the palette's row at the root, so typing it finds the palette; `Enter` opens it. |
| `hotkey` | string | unset | A global hotkey that opens pal directly in this palette. Same syntax as `general.hotkey`; the root hotkey wins a clash. Registered once the palette exists. |
| `icon` | string | unset | Icon override for the palette's row; the extension's own icon when unset. A glyph, an emoji or a hex colour. |
| `settings` | table | `{}` | Settings the extension declared for this palette, from `palettes.<key>.settings` in its `pal.json`. `[palettes.emoji.settings]` or inline `settings.columns = 8`. |

The id is the extension's name when the palette is named like it (`apps`,
`emoji`, `calc`, `system`, `windows`, `bookmarks`), else
`<extension>-<palette>` (`clipboard-history`; a script palette named `otp`
is `scripts-otp`). Bare keys, no quoting.

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
resolved values and lists the extension's palettes again. Two exceptions:
`emoji`'s `columns` is read once at load (edit the file, then Settings >
Restart extension host), and the `scripts` extension discovers its palettes
once at import, so its `config`, `skip`, `v1_repo` and `ttl` need a host
restart too (`timeout` and `preview_max` apply to the next run).

## Secrets

A setting of kind `secret` never sits in the file as plain text. The file
holds a reference:

- `keychain:<service>/<account>` or `keychain:<account>` (service `pal`):
  the OS store, macOS Keychain as a generic password. The Settings window
  writes the value there under `pal/<extension>-<key>` and puts
  `keychain:pal/<extension>-<key>` in the file. By hand:
  `security add-generic-password -s pal -a github-token -w`.
- `env:<NAME>`: an environment variable of the pal process.

The core resolves a reference when something asks for the value
(`core/src/config/secrets.rs`); anything that is not a reference passes
through as itself. Removing a secret in Settings unsets the key; the
keychain item stays. On Linux the Secret Service lookup is not implemented
yet: every `keychain:` lookup fails with a store error there, and `env:`
references work everywhere.

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
profile is logged at startup. `clipboard.db` stays one level up: it is
history, not a view of one config.

The data dir is `~/Library/Application Support/pal` on macOS and
`~/.local/share/pal` on Linux (`$XDG_DATA_HOME/pal` when set).

A symlinked config file (dotfiles setups) is followed: edits and the watch
go to the real file, so a write never replaces the link with a plain file.
The watch follows the link once, at startup; re-pointing it later is not
seen.
