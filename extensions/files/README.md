# Files

Two palettes over the operating system's own file index, never a walk pal
indexes itself.

**Files** is an input palette: what you type is a name search on every
keystroke. The row is the file name; the parent folder is the subtitle
(home shortened to `~`); the size and the modification date are
accessories. `.app` bundles get their own icon, everything else a glyph by
kind (folder, image, document, code, archive). Exact and prefix name
matches come first, the rest in the backend's order, at most `limit` rows.
Before you type, the palette lists the **recently used files** (a
`Recently used` section) instead of hints.

**Recent Files** lists those same rows as a palette of its own: the files
used in the last seven days within the configured folders, newest first
(on macOS Spotlight's `kMDItemLastUsedDate`, on Linux GTK's
`~/.local/share/recently-used.xbel`), listed again on a show once the
listing is a minute old, with the same actions and detail pane. Folders,
hidden and excluded paths and files that are gone are left out.

## Backends

Picked once when the extension loads and logged (`[files] backend: fd`):

| platform | backend | how |
| --- | --- | --- |
| macOS | Spotlight | `mdfind -name <query> -onlyin <folder>...`; case-insensitive substring of the display name, so `kitty` finds `kitty.app` |
| Linux | `fd` | `fd --absolute-path --fixed-strings --max-results <limit> --max-depth 8 --exclude <x>... <query> <folders>`; respects `.gitignore` like fd does everywhere |
| Linux, no fd | `locate` | `locate -i <query>`, filtered to the folders (`updatedb` decides how fresh it is) |
| Linux, neither | `find` | `find <folders> -iname '*<query>*'`; walks the folders on every keystroke, and a second hint row says so |

Every search is one process: killed after 3 s, killed as soon as `limit`
paths have been read, and killed when the next keystroke starts a new one.
The `exclude` folders are pruned from the walk (fd, find) or dropped from
the answer (Spotlight, locate).

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open with the system opener |
| `cmd+enter` | Reveal in Finder (`open -R`), Show in file manager on Linux (`xdg-open` on the parent folder) |
| `cmd+y` | Quick Look (`qlmanage -p`), macOS only |
| `cmd+o` | Open with…: a level listing the apps registered for the file, the default first with a `Default` tag; typing narrows them, Enter opens the file with that app |
| `cmd+c` | Copy path |
| `cmd+shift+c` | Copy file: the file itself onto the clipboard; a paste in Finder or a file manager copies it, a paste in a text field gets its path |
| `cmd+d` | Move to Trash: asks first; Finder's delete on macOS, `gio trash` on Linux; the palette stays open with a toast |
| `cmd+i` | The detail pane: path, size, modified time and kind; for a text file under 64 KB the first 40 lines in a code block |

Open with… lists Launch Services' apps on macOS (`NSWorkspace`, every
role); on Linux the file's MIME type is looked up in the `mimeapps.list`
files and every data dir's `mimeinfo.cache`, the default from
`xdg-mime query default`.

## Setup

macOS needs nothing: Spotlight is always there. On Linux install `fd`
(else `locate`; with neither, `find` works but is slow). Move to Trash on
macOS goes through Finder, so the first one shows the Automation prompt.

Settings, `[extensions.files]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folders` | list of paths | `["~"]` | Where to search. `~` is expanded. |
| `limit` | number, 1 to 500 | `50` | At most this many rows per query. |
| `show_hidden` | bool | `false` | List files and folders whose name starts with a dot (below the configured folder; `~/.config` as a folder is fine either way). |
| `exclude` | list of names | `["node_modules", ".cache", "Library/Caches", "target"]` | Folders skipped below the search folders, by name or a short path. |

## What it does not do

- Search file contents: it is a name search. Spotlight's content index
  is not asked.
- Preview images: the app's `icon://` scheme serves app icons, favicons
  and clipboard images only, so the pane shows text files and metadata.
- Rename, move or copy files: Reveal and open the file manager.
- Index anything itself: no fd, locate or Spotlight means no results
  (one hint row says which tool is missing), and fd stops eight levels
  down.

## Platforms

macOS (Spotlight, Quick Look, Finder) and Linux (fd, locate or find; GTK's
recently-used list; `gio trash` and `xdg-open`).
