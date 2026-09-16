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
pal show            show the panel
pal hide            hide the panel
pal settings [page] open the settings window (overview, general, palettes, extensions, bar, about)
pal reload          restart the extension host (reloads every extension from disk)
pal quit            quit the running instance (flushes its state, stops the extension host)
pal install NAME    install an extension: a name from pal.cagdas.io, or a source (see below)
pal update [NAME]   fetch an installed extension's source again (every one with a source, without a name)
pal remove NAME     remove an installed extension
pal list            the installed extensions: name, version, source
pal action NAME     act on the value on stdin (see Actions for scripts)
pal bar ...         bar items (see below)
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
open pal://...      deep links: the same, from a URL (see Links)
pal --version
pal --help
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

## `pal bar`

The bar items extensions draw on the menu bar or sketchybar (the `[bar]`
table in [Configuration](config.md)). `list` and `json` read the last
state the running instance wrote (`bar.json` under pal's data directory),
in the calling process; the rest reach the instance, which is what
sketchybar's click and hover scripts run (pal sets those itself, with the
absolute path of its binary, since sketchybar's `PATH` is launchd's).

```text
pal bar list                                  every declared item: key, state (visible, hidden, stale, unrendered), title, last text
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
instance needed (script palettes call it from the host). `copy` puts it on
the clipboard, `paste` prints the clipboard (the value is ignored), `open`
opens it, `type` pastes it into the app in front (a synthesised Cmd+V, so
Accessibility on macOS), `cmd` runs it with `bash -c`. `copy` and `open`
print the `{"hud": ...}` line the script tier reads, so a palette whose
command ends in `| pal action copy` gets its HUD. Any other name is an
action script: `plugins/actions/NAME/plugin.toml` next to the config file,
else under the `scripts` extension's plugin repo, run as `<command> run`
from its directory with the value on stdin.

pal v1's own subcommands (`pick`, `meta`, `prompt`, ...) do not exist
here; v1 is retired, not forwarded to. `pal run` is the link twin above,
not v1's.
