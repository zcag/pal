# Links

Everything pal can do has a `pal://` link and a `pal` command that say the
same thing. A link works from anywhere that opens a URL: a browser (the
store's "Open in pal" button), a bookmark, a Shortcuts action, skhd or a
Hyprland bind (`open pal://toggle`, `xdg-open pal://toggle`), a script, a
Stream Deck. The command works from a shell. Both reach the running pal;
with none running they start it and apply once the panel has loaded.

```sh
open pal://open/emoji/emoji?q=smile        # macOS
xdg-open 'pal://open/emoji/emoji?q=smile'  # Linux
pal open emoji/emoji -q smile              # the same, from a shell
pal link 'pal://open/emoji/emoji?q=smile'  # a link as written
pal link --list                            # every route
```

**Copy deep link** (⌘⇧C, in the ⌘K panel under Link) is on every row,
inside every palette and view, and on a form: it copies the link for what
is under the cursor and the HUD says `Copied pal://...`. That is the
quickest way to get one right.

## The grammar

`pal://<route>[/<part>...][?key=value&...]`. Parts are percent-encoded
(`%20` or `+` is a space, `%2F` a slash inside an id). The first part is
one of the routes below; anything else is an extension's name followed by
a route that extension declares (`pal://timer/start?duration=25m`). A
repeated key is an array. `args` (on `run`) is percent-encoded JSON. A
link over 2048 bytes, a route that does not exist, or a missing parameter
is one line in the HUD (`pal: unknown link`, `pal: text is required`).

## The routes

| Link | Command | What it does |
| --- | --- | --- |
| `pal://` or `pal://show` | `pal show` | Show the panel |
| `pal://hide` | `pal hide` | Hide it |
| `pal://toggle` | `pal toggle` | One or the other (a keybind's link) |
| `pal://settings` | `pal settings` | The settings window |
| `pal://settings/<page>` | `pal settings <page>` | On `overview`, `general`, `palettes`, `extensions`, `bar` or `about` |
| `...?anchor=<row>` | | Landing on a row of that page, lit as a search hit is: `extensions:<name>` selects an extension, `extensions:<name>:<setting>` its setting (`pal://settings/extensions?anchor=extensions:gmail:token` is what a "Set the token" hint row opens), `general:hotkey` the recorder, `palettes:<id>` a palette |
| `pal://reload` | `pal reload` | Restart the extension host |
| `pal://quit` | `pal quit` | Quit pal |
| `pal://commands/<id>` | `pal command <id>` | One of pal's own rows, by id (below); `pal://run/pal/commands/<id>` spells the same |
| `pal://open/<ext>/<palette>` | `pal open <ext>/<palette>` | The panel inside that palette |
| `...?q=<text>` | `-q <text>` | With that typed in the search box (never run) |
| `...?filter=<id>` | `--filter <id>` | With that filter chosen |
| `pal://run/<ext>/<palette>/<id>` | `pal run <ext>/<palette>/<id>` | Run that row as Enter would, the panel down; `?action=` one of its actions, any other `?name=value` a typed argument of the row (`Item.args`) |
| `...?action=<id>` | `-a <id>` | One of the row's other actions |
| `...?args=<json>` | `--args <json>` | For a row that only exists inside a drill-in |
| `pal://form/<ext>/<palette>/<id>?<field>=<value>` | `pal form <ext>/<palette>/<id> field=value` | The form that row opens, those fields filled in, nothing submitted |
| `pal://copy?text=<text>` | `pal copy <text>` | Text onto the clipboard ("Copied" in the HUD); the command reads stdin without an argument |
| `pal://paste?text=<text>` | `pal paste <text>` | Text pasted into the app in front (Accessibility on macOS) |
| `pal://open?url=<url>` | `pal open --url <url>` | A url, path or app given to the OS opener (`?path=` is read too) |
| `pal://hud?text=<text>` | `pal hud <text>` | One line in the HUD |
| `pal://toast?title=<t>&message=<m>` | `pal toast <t> [<m>]` | A toast in the panel while it is up, else the HUD |
| `pal://confetti` | `pal confetti [<text>]` | A celebration in the HUD (`?text=` for its line) |
| `pal://install/<spec>` | `pal install <spec>` | Install an extension (a store name or a source, see [CLI](cli.md)) |
| `pal://update/<name>`, `pal://update` | `pal update [<name>]` | Fetch one or every installed extension again |
| `pal://remove/<name>` | `pal remove <name>` | Remove an installed extension |
| `pal://instance/add/<name>/<suffix>` | `pal instance add <name> <suffix>` | Add an instance of a `multi` extension: `[instances."<name>@<suffix>"]` written (`?title=` its name, `?tint=` its tile colour; `--title`, `--tint`) |
| `pal://instance/remove/<key>` | `pal instance remove <key>` | Remove an instance (`gmail@work`): its tables, storage, cache and ranking; the keychain items stay |
| `pal://bar/<ext>/<id>` | `pal bar click <ext>/<id>` | A bar item's popover |
| `...?action=<id>` | `pal bar action <ext>/<id> <action>` | One of the item's actions instead |
| `pal://<ext>/<route>?<params>` | `pal call <ext>/<route> key=value ...` | A route the extension declares (below) |
| `pal://extensions` | | Same as `settings/extensions` (older spelling, kept) |

`<ext>/<palette>` are the extension's and the palette's names from its
`pal.json`, as the palette's Copy deep link writes them (`clipboard/history`,
`emoji/emoji`), not the one-word id the config file uses. A row's `<id>` is
the extension's own, so a link keeps working across restarts.

pal's own rows (`pal://commands/<id>`): `settings`, `settings-extensions`,
`settings-palettes`, `settings-about`, `store`, `install` (the install
form), `reload`, `refresh` (list every palette again), `updates` (check
for updates), `install-update` (install the release the check found),
`config-open`, `config-reveal`, `tips`, `docs`, `bug`, `diagnostics`
(copies them), `theme` (cycles it), `history-clear` (the search history),
`quit`, `restart`, `version` (copies it).

## Extension routes

An extension can declare routes of its own; the bundled ones:

| Link | What it does |
| --- | --- |
| `pal://quicklinks/open?name=<name>` | Open the quicklink by name or keyword; a `{query}` link opens the panel to fill it, or `&query=<text>` fills it from the link |
| `pal://snippets/paste?name=<name>` | Paste the snippet by name or keyword, placeholders filled; `&copy=1` copies it instead |
| `pal://window-management/layout?name=<layout>` | Move the focused window: `left_half`, `right_half`, `top_half`, `bottom_half`, `left_third`, `center_third`, `right_third`, `left_two_thirds`, `right_two_thirds`, the four `*_quarter`s, `maximize`, `almost_maximize`, `center`, `reasonable_size`, `next_display`, `previous_display`, `restore` |
| `pal://system/run?id=<command>` | A system command: `sleep`, `lock`, `logout`, `restart`, `shutdown`, `empty-trash`, `dark-mode`, `volume-up`, `volume-down`, `volume-mute`, `brightness-up`, `brightness-down`, `dnd`, `eject-all`, `show-desktop`, `keep-awake` (the toggle below), `quit-all`, `unhide-all`, `dismiss-notifications` (always asks first) |
| `pal://system/awake?for=1h` | Keep the machine awake for a while (`45m`, `2h`, `1h30m`), until a time (`until=14:30`, `for=2pm`), or `for=forever`; `&display=1` keeps the display up too (the setting otherwise), `&app=Xcode` follows that app (the run ends when it quits), `&off=1` allows sleep; bare, it toggles: on for the default duration, or off while a run is on |
| `pal://timer/start?duration=25m&name=tea` | Start a timer (`&ring=1` rings the phone when it lands) |
| `pal://clipboard/copy?index=0` | Put a history entry back on the clipboard, `0` the newest |
| `pal://hue/toggle?room=<room>` | Toggle a room's lights (`&on=1` or `&on=0` sets them instead) |
| `pal://hue/scene?name=<scene>` | Play a scene (`&room=<room>` when the name is in several; `&dynamic=1` for its dynamic form) |
| `pal://hue/off` | Every light off |
| `pal://obsidian/open?path=<note>` | Open a note in Obsidian, or in the editor |
| `pal://obsidian/new?title=<title>` | Create a note and open it (`&body=`, `&folder=`) |
| `pal://obsidian/append-today?text=<text>` | Append a line to today's daily note, created when missing |
| `pal://whatsapp/open?chat=<name>` | Open a chat |
| `pal://whatsapp/search?q=<text>` | Search the message archive |
| `pal://displays/brightness?value=50&display=external` | Set a display's brightness: a percent or `+10` / `-10`; `display` is `main`, `external`, `builtin`, an id or a name (the bar item's display otherwise); `contrast` and `volume` the same for an external monitor over DDC |
| `pal://displays/input?source=hdmi1` | Switch an external monitor's input: `hdmi1`, `hdmi2`, `dp1`, `dp2`, `usbc` or a VCP 60 code |
| `pal://displays/mode?mode=2560x1440%20hidpi&display=<id>` | Set a display's resolution: a mode number from the palette, or `WxH`, `WxH@Hz`, with `hidpi` or `native` |
| `pal://displays/preset?name=<name>` | Apply a saved arrangement preset |
| `pal://displays/night-shift?state=toggle` | Night Shift `on`, `off` or `toggle` (the nightlight CLI) |
| `pal://dpi/toggle`, `pal://dpi/on`, `pal://dpi/off` | The `dpi` script's censorship bypass on or off; the HUD says the script's line (`dpi on (Wi-Fi -> socks5://127.0.0.1:1080, ...)`) |
| `pal://dpi/test` | The panel on the bypass test level, the test running |
| `pal://dpi/status` | The DPI Bypass palette |

A route an extension declares shows on its store page and in Settings >
Extensions. `pal call timer/start duration=25m name=tea` is the command
form; `pal link --list` prints the app's routes.

Examples:

```sh
pal call window-management/layout name=left_half   # a skhd bind
open 'pal://snippets/paste?name=sig'                 # a Shortcuts action
open -g 'pal://confetti?text=Deployed'               # at the end of a deploy script (-g: pal stays behind)
pal form quicklinks/quicklinks/create -a create name=GitHub url=https://github.com/search?q={query}
pal copy < notes.txt
```

## What asks first

A web page can emit any of these, so what acts shows a card in the panel
before it runs (Enter runs, Escape does not, 30 seconds then no):

- `run`, `form`, a bar action and an extension route name what they are
  about to do ("Run “Safari” from a link?", "“Start a timer” from a link?
  timer/start duration=25m");
- `paste` and `open?url=` ask too: a page must not type into the app in
  front or launch a file through pal unasked;
- `install`, `update`, `remove` and `instance/add`, `instance/remove`
  always ask: they fetch or delete code, or edit the config file.

What only shows something (`open` a palette, `settings`, `hud`, `toast`,
`confetti`, `copy`, a bar popover) never asks.

`deeplink_confirm` under `[general]` ([Configuration](config.md)) tunes it:
`false` turns every card off but the store's (a machine that scripts pal by
link); a list of extension names, `deeplink_confirm = ["timer", "quicklinks"]`,
keeps the cards on except for links into those extensions (their `run`, `form`
and routes; a name covers every instance of the extension, a key like
`"gmail@work"` one instance). A route the extension declares with `confirm:
true` (system's `run`) asks whatever the setting says.

The `pal` commands never ask: typing the command is the consent. So a
keybind that runs `pal call window-management/layout name=left_half` just
does it, while a bookmark to the same link asks (unless
`window-management` is on the list).

## Errors and exit codes

The outcome of a link is the HUD's: `pal: unknown link`, `pal: no palette
x/y`, `pal: no route x/y`, `pal: timer/start: duration is required`, `pal:
<what the extension said>`. The `pal` commands print a link they can
refuse before sending (the grammar) to stderr and exit 2; a link that is
handed over exits 0 at once, and what happened is on screen. `pal quit`
and `pal reload` with no pal running print `not running`; every other
command starts pal and applies once the panel is up.

## Registration

macOS reads the scheme from the app's `Info.plist` when the `.app` is
first seen in `/Applications` (or `lsregister -f /path/to/pal.app`); the
deb and AppImage carry `MimeType=x-scheme-handler/pal` in their desktop
entry. On macOS the link is an Apple Event to the app; on Linux it is
`pal pal://...`, which the binary forwards to the running instance like a
subcommand. A bare release binary on Linux (no desktop entry) needs one to
be a handler: a `~/.local/share/applications/pal.desktop` with
`Exec=/path/to/pal %u` and `MimeType=x-scheme-handler/pal;`, then
`xdg-mime default pal.desktop x-scheme-handler/pal`. A debug build on
Linux writes that entry itself at startup; a `tauri dev` binary on macOS
is not a bundle and cannot be a handler (the `pal` commands still work
against it).

macOS activates pal as it hands a link over (a browser's click, `open`
without `-g`); pal waits for that to settle before showing the panel, so
the panel stays up. `open -g` keeps the app that opened the link in front,
which is what a script wants for `hud`, `copy` or `confetti`.
