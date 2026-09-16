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
pal settings        open the settings window
pal reload          restart the extension host (reloads every extension from disk)
pal quit            quit the running instance (flushes its state, stops the extension host)
pal install SPEC    install an extension into the store (see Extensions)
pal update [NAME]   fetch an installed extension's source again (every one with a source, without a name)
pal remove NAME     remove an installed extension
pal list            the installed extensions: name, version, source
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
pal install github:user/repo                  the repo's root is the extension
pal install github:user/repo/sub/dir@v1.2     a subdirectory, at a tag or branch
pal install https://github.com/user/repo/tree/main/sub/dir
pal install ~/src/my-extension                a local directory, copied
pal list
pal update my-extension
pal remove my-extension
```

What each does and what an extension is: [Extensions](extensions.md).
