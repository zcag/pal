# CLI

The `pal` binary is the app. Run with no subcommand it starts pal; with a
subcommand and an instance already running, the command reaches that
instance and this process exits at once (about 50 ms on Linux for the
deb's binary). With no instance running, the app starts and applies the
command once its page has loaded.

Where the binary is:

- macOS: `/Applications/pal.app/Contents/MacOS/pal`
- Linux: `/usr/bin/pal` from the deb; `usr/bin/pal` inside an extracted
  AppImage. The AppImage file itself works too, but each run mounts its
  squashfs first (about 230 ms), so a keybind wants one of the other two.

```text
pal                 start pal; with one running, show the panel
pal toggle          show the panel if hidden, hide it if shown
pal switch [WHAT]   the switcher: next (default) begins or steps, prev steps up, commit runs the row, cancel hides (see below)
pal show            show the panel
pal hide            hide the panel
pal settings [page] open the settings window (overview, general, palettes, extensions, bar, about)
pal reload          restart the extension host (reloads every extension from disk)
pal quit            quit the running instance (flushes its state, stops the extension host)
pal install NAME    install an extension: a name from pal.cagdas.io, or a source (see below)
pal update [NAME]   fetch an installed extension's source again (every one with a source, without a name)
pal remove NAME     remove an installed extension
pal list            the installed extensions: name, version, source
pal instance ...    instances of a multi extension: list, add, remove (see below)
pal action NAME     act on the value on stdin (see Actions for scripts)
pal bar ...         bar items (see below)
pal state ...       states: the table, set one by hand, reset, eval, watch (see below)
pal link URL        run a pal:// link as written; --list prints every route
pal open EXT/PAL    the panel inside a palette (-q QUERY, --filter ID); --url URL opens a url instead
pal run EXT/PAL/ID  run one row, the panel down (-a ACTION, --args JSON)
pal form EXT/PAL/ID [FIELD=VALUE ...]   the form a row opens, prefilled (-a ACTION)
pal copy [TEXT]     text (or stdin) onto the clipboard
pal paste [TEXT]    text (or stdin) pasted into the app in front
pal hud TEXT        one line in the HUD
pal toast TITLE [MESSAGE]   a toast in the panel, else the HUD
pal confetti [TEXT] a celebration in the HUD
pal command ID      one of pal's own rows (refresh, updates, theme, ...)
pal call EXT/ROUTE [KEY=VALUE ...]   a route an extension declares
pal pick            the panel as a picker over the lines on stdin; the choice on stdout (see below)
open pal://...      deep links: the same, from a URL (see Links)
pal --version
pal --help          every subcommand takes --help too
```

The block from `link` down are the `pal://` links as commands, one per
route: [Links](links.md) has every one with an example and what each does.
A command never shows the confirm card a link from a web page would
(typing it is the consent); a link the grammar refuses is printed with
the reason and exit 2 before anything is sent, and what happens after is
the HUD's.

`pal toggle` is what a compositor keybind runs on Wayland, where there is
no global hotkey API (see [Getting started](getting-started.md)).

`pal quit` with no instance running prints `not running` and does not start
one. It gives the extension host up to 2 seconds to exit on its own, then
flushes the search history and the index cache.

A second `pal` with no subcommand while one is running shows the panel:
what a second launch of a single-instance app conventionally does.

## `pal install`, `update`, `remove`, `list`

These work the extension store in the calling process (so their output is
on your terminal), then tell a running instance to `reload` its host so it
sees the change. With no instance running the change is on disk and the
extension loads at the next start. None of them starts the app.

```text
pal install wordle                            a name from the store at pal.cagdas.io
pal install github:user/repo                  the repo's root is the extension
pal install github:user/repo/sub/dir@v1.2     a subdirectory, at a tag or branch
pal install https://github.com/user/repo/tree/main/sub/dir
pal install ~/src/my-extension                a local directory, copied
pal install --from ./my-extension             a source, never a store name
pal list
pal update my-extension
pal remove my-extension
```

A bare name (letters, digits, `-`, `_`, `.`; no slash) is looked up at
`https://pal.cagdas.io/api/extensions/<name>`, whose `spec` is then
installed like the explicit forms (`pal list` shows that spec as the
source, and `pal update` fetches it again from GitHub, not from the site).
A name the site does not list fails with `<name>: not an extension the
store at pal.cagdas.io knows; pass its source with --from`. Anything with
a slash, a `:` scheme, or a leading `.` or `~` is a source and never
looked up; `--from SPEC` says so for a bare word too, so `pal install
--from my-extension` is the directory of that name, not the store's.
The site unreachable is an error, not a fallback: an explicit source
works offline the same as before.

What each does and what an extension is: [Extensions](extensions.md).

## `pal instance`

A `multi` extension (Gmail, GitHub, Slack, Home Assistant) runs as
several *instances*, one per account ([Configuration](config.md),
"`[instances]`"). `list` reads the config file in the calling process;
`add` and `remove` are the `pal://instance/add` and
`pal://instance/remove` links ([Deep links](links.md)): file edits the
running pal makes, its host reloading the extension's instances at once,
no confirm card from the shell.

```text
pal instance list                                     every instance the file describes: key, title, state
pal instance add gmail work --title Work              [instances."gmail@work"] written (--tint amber picks the tile colour)
pal instance remove gmail@work                        its tables, storage, index cache and ranking gone
```

`list` prints `<key>\t<title>\t<state>` per instance, the default of each
extension first (`default`, `on`, or `off` for `enabled = false`); an
extension with no `[instances.*]` table has one instance and is not
listed. The suffix is lowercase letters, digits, `-` and `_`, never
`default`; a bad one is refused in the calling process with exit 2.
`remove` refuses the default instance, which is the extension itself.
Keychain items stay, as with `pal remove`.

## `pal bar`

The bar items extensions draw on the menu bar or sketchybar (the `[bar]`
table in [Configuration](config.md)). `list` and `json` read the last
state the running instance wrote (`bar.json` under pal's data directory),
in the calling process; the rest reach the instance, which is what
sketchybar's click and hover scripts run (pal sets those itself, with the
absolute path of its binary, since sketchybar's `PATH` is launchd's).

```text
pal bar list                                  every declared item: key, state (visible, hidden, held, stale, unrendered), title, last text
pal bar json <ext>/<id>                       the item's last rendered state as JSON
pal bar click <ext>/<id> [--anchor A]         a click: the popover under the item, or its open action
pal bar hover <ext>/<id> --state S [--anchor A]   the pointer entered (`enter`, `mouse.entered`) or left (`exit`, `mouse.exited`) the item
pal bar action <ext>/<id> <action>            run one of the item's actions (a menu row's, or `segment:<id>`)
pal bar render <ext>/<id>                     render the item again now
pal bar sync                                  probe sketchybar and re-apply every item (the end of a sketchybarrc)
```

`--anchor` is where the popover goes: `sketchybar` queries the item's
`bounding_rects`, `menubar` and nothing use the panel's usual place, and
`x,y,w,h` in screen points is a rect of your own. `--state` also takes
sketchybar's `$SENDER` as it is, so an item's `script` is one line.

## `pal state`

The named variables of `[states]` ([Configuration](config.md)) with
their live values. The table, `get`, `json`, `eval` and `watch` read the
feed the running instance writes (`states.json` under pal's data
directory) in the calling process; `set` and `reset` reach the instance.

```text
pal state                                     name, value, source (manual, expr, builtin, an extension's key, default), time left, description
pal state get <name>                          the value, one line (`null` for unknown); exit 1 when there is no such state
pal state set <name> <value>                  by hand until reset: true, false, a number, or any text
pal state set <name> <value> --for 3h         ... for a while: 90s, 25m, 1h30m, 2h, 1d (a bare number is minutes)
pal state set <name> <value> --until 18:00    ... until a time of day (tomorrow's when it has passed)
pal state reset <name>                        the manual value goes; the expression, the publisher or the default answers
pal state eval "hour >= 9 and working"        what an expression reads now, for writing one
pal state json                                every state as JSON
pal state watch                               name<TAB>value on every change, until killed
```

`set` on a name nothing declared makes the state for this run and keeps
its value across relaunches, so a shell hook, a cron or a launchd tick
feeds a state the way an extension would, without being one. A held
state shows on the bar (`states/forced`, amber, with the time left) and
under the States palette's "Held by hand" filter.

## `pal pick`

The panel as a picker for a script: rows in on stdin, the choice out on
stdout, like `fzf` or rofi's `-dmenu`, with pal's search, look and
hotkey-free reach (a keybind can run it too). Every non-empty line is a
row; a line that is a JSON object `{ "id", "name", "subtitle"?, "icon"? }`
is a row with those parts (the icon as an item's: a glyph, an emoji, a hex
colour, an app path). The panel shows them under `--title`, fuzzy-filtered
as you type; `Enter` prints the row's id (the line itself, for line input)
and exits 0. `Escape` prints nothing and exits 1; no running instance is
exit 2; `Ctrl+C` in the terminal is 130. `--query` types a query first.

`--multi` picks several: `Tab`, `⇧↓`/`⇧↑` and (while nothing is typed)
`x` mark rows (a check on the row, a count in the footer), `⌘`-click
marks or unmarks one, `Escape` clears the marks, `Enter` prints every
marked id, one per line, the cursor's first.

```sh
# fzf-style file pick: open what you choose
f=$(fd -t f . ~/proj | pal pick -t "Open") && open "$f"

# a kill menu: rows are JSON so the pid is the id and the name is readable
ps -eo pid=,pcpu=,comm= | sort -k2 -rn | head -30 |
  awk '{ printf "{\"id\":\"%s\",\"name\":\"%s\",\"subtitle\":\"%s%% cpu\"}\n", $1, $3, $2 }' |
  pal pick -t "Kill" --multi | xargs -r kill

# a git branch switcher, the current branch typed as the query
git branch --format='%(refname:short)' | pal pick -t "Switch to" -q "$(git branch --show-current)" | xargs -r git switch
```

The rows travel to the running instance over a socket the CLI opens for
the answer (`$TMPDIR/pal-pick-<pid>.sock`, gone when the CLI exits), the
one subcommand with a reply channel; the picker level is the panel's own
list, so the keyboard grammar is the usual one. Only one picker is up at
a time: a second `pal pick` cancels the first (exit 1). The panel hiding
for any other reason (a click elsewhere, `pal hide`) cancels too.

## `pal switch`

The switcher ([Keyboard](keyboard.md#switcher)) from a keybind, for
Wayland, where no global chord can be registered: the compositor sends the
presses and the release that the `hold` chord delivers by itself on macOS.
`pal switch` (or `pal switch next`) begins a hold when none is on, over
the palette whose `hold` is set (Windows, by its manifest's suggestion,
when no other is), and steps the cursor down when one is; `prev` steps
up; `commit` runs the row under the cursor (Focus, for a window) and
`cancel` hides. Hyprland:

```
bind  = ALT, Tab, exec, pal switch
bind  = ALT SHIFT, Tab, exec, pal switch prev
bindr = ALT, Alt_L, exec, pal switch commit
```

`bindr` fires on the key's release, so letting go of Alt is the commit.
The same commands work on macOS (a Karabiner or skhd user can drive it
too); begun from the CLI a hold never watches the modifiers, so `commit`
is the only release.

## Deep links

`pal://` links do what the subcommands do, from anywhere that opens a URL:
a browser (the store's "Open in pal" button), a bookmark, a Shortcuts
action, skhd (`open pal://toggle`), or a script. A link reaches the
running instance; with none running it starts pal and applies once the
panel has loaded. Every route, its `pal` twin, the extension routes, what
asks first and how the scheme is registered: [Links](links.md).

```text
pal://                                          show the panel
pal://show   pal://hide   pal://toggle          as the subcommands
pal://settings[/<page>]   pal://reload   pal://quit
pal://commands/<id>                             one of pal's own rows
pal://open/<extension>/<palette>[?q=&filter=]   the panel inside that palette
pal://run/<extension>/<palette>/<id>[?action=&args=]   run one row, the panel down
pal://form/<extension>/<palette>/<id>?<field>=  the form a row opens, prefilled
pal://copy?text=  pal://paste?text=  pal://open?url=  pal://hud?text=  pal://toast?title=  pal://confetti
pal://install/<spec>   pal://update[/<name>]   pal://remove/<name>
pal://bar/<extension>/<id>[?action=]           a bar item's popover, or one of its actions
pal://<extension>/<route>?<params>             a route the extension declares
```

**A web page can emit any of these**, so what acts shows a card in the
panel first ("Run “Safari” from a link?"); `deeplink_confirm` under
`[general]` ([Configuration](config.md)) turns the cards off or trusts a
list of extensions; `install`, `update` and `remove` always ask. "Copy
deep link" (⌘⇧C) on any row, palette, view or form copies its link.

## Actions for scripts

`pal action NAME` reads a value on stdin and acts on it, with no running
instance needed (script palettes call it from the host,
[Scripts and data files](scripts.md)). `copy` puts it on
the clipboard, `paste` prints the clipboard (the value is ignored), `open`
opens it, `type` pastes it into the app in front (a synthesised Cmd+V, so
Accessibility on macOS), `cmd` runs it with `bash -c`. `copy` and `open`
print the `{"hud": ...}` line the script tier reads, so a palette whose
command ends in `| pal action copy` gets its HUD. Any other name is an
action script: `plugins/actions/NAME/plugin.toml` next to the config file,
else under the `scripts` extension's plugin repo, run as `<command> run`
from its directory with the value on stdin.

The previous pal's subcommands (`meta`, `prompt`, ...) do not exist here,
and `pal pick` and `pal run` are the commands above, not the old ones
([Config](config.md#coming-from-the-previous-pal)).
