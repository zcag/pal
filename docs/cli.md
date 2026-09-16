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
open pal://...      deep links: the same, from a URL (see below)
pal --version
pal --help
```

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
panel has loaded.

```text
pal://                                          show the panel
pal://show   pal://hide   pal://toggle          as the subcommands
pal://settings[/overview|general|palettes|extensions|bar|about]   the settings window, on that page
pal://extensions                                Settings > Extensions
pal://open/<extension>/<palette>[?q=<query>]    the panel inside that palette, with the query typed
pal://run/<extension>/<palette>/<id>[?action=<id>]   run one item, as a pick, with the panel down
pal://install/<spec>                            install an extension (a `pal install` spec)
pal://bar/<extension>/<id>                      open a bar item's popover
```

Parts are percent-decoded (`%20`, `+` in the query, is a space); the
extension and palette are the two names a `pal://open` link takes, as
[Extensions](extensions.md) explains, not the one-word palette id. A link
over 2048 bytes, or any other route, is refused with "pal: unknown link"
in the HUD.

**A web page can emit any of these**, so the two that act show a card in
the panel first: `run` asks "Run X from a link?" naming the extension,
palette, item and action (Enter runs it, Escape does not);
`install` asks "Install X from a link?" with the spec, then installs,
says "Installed X 1.0" in the HUD and shows the panel with the extension's
name typed so its new palette rows are in view. A script that drives pal
by link can turn the `run` card off with `deeplink_confirm = false` under
`[general]` ([Configuration](config.md)); `install` always asks, since it
fetches and runs code from the network. `open` types the query into the
search box and nothing else; a query is never run.

Registration is the bundle's: macOS reads the scheme from the app's
`Info.plist` when the `.app` is first seen in `/Applications` (or
`lsregister -f /path/to/pal.app`); the deb and AppImage carry
`MimeType=x-scheme-handler/pal` in their desktop entry. On macOS the link
is an Apple Event to the app; on Linux it is `pal pal://...`, which the
binary forwards to the running instance like a subcommand. A bare release
binary on Linux (no desktop entry) needs one to be a handler: a
`~/.local/share/applications/pal.desktop` with `Exec=/path/to/pal %u` and
`MimeType=x-scheme-handler/pal;`, then `xdg-mime default pal.desktop
x-scheme-handler/pal`. A debug build on Linux writes that entry itself at
startup; a `tauri dev` binary on macOS is not a bundle and cannot be a
handler.

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

pal v1's own subcommands (`pick`, `run`, `meta`, `prompt`, ...) do not
exist here; v1 is retired, not forwarded to.
