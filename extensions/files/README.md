# Files

Three palettes: two over the operating system's own file index, never a
walk pal indexes itself, and one that browses a folder.

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

**Browse Folder** is where Enter (or `→`) on any folder row leads: a level
whose crumb is the folder, a `..` row first (Enter, `←` or Backspace on it,
or `←`/Backspace from anywhere in the level while nothing is typed, goes
up), then the entries under the dropdown's sort: **Name** (folders first,
then files, case-insensitive), **Date** (newest first, mixed) or **Size**
(largest first, folders last); typing filters by name. Pictures draw their
own thumbnail, `cmd+.` shows or hides dot entries (it flips the
`show_hidden` setting), and a folder over 500 entries shows that many and
a row counting the rest. File rows have the same actions as search rows.
Inside Files a typed path ending in `/` (`~/`, `/usr/local/`) lists that
folder the same way; without the slash it completes the last segment.

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
| `enter` | Open with the system opener; on a folder, browse it |
| `right` | Browse the folder under the cursor (while nothing is typed) |
| `left`, `backspace` | In a browsed folder: go up (while nothing is typed) |
| `tab` | In a browsed folder: cycle the sort (name, date, size) |
| `cmd+.` | In a browsed folder: show or hide hidden files |
| `cmd+enter` | Reveal in Finder (`open -R`), Show in file manager on Linux (`xdg-open` on the parent folder) |
| `cmd+y` | Quick Look (`qlmanage -p`), macOS only |
| `cmd+o` | Open with…: a level listing the apps registered for the file, the default first with a `Default` tag; typing narrows them, Enter opens the file with that app |
| `cmd+c` | Copy path |
| `cmd+shift+c` | Copy file: the file itself onto the clipboard; a paste in Finder or a file manager copies it, a paste in a text field gets its path |
| `cmd+t` | Open in Terminal: a terminal window in the folder (a file's folder), the app the `terminal` setting names (shell's table: Terminal, iTerm, kitty, Alacritty, WezTerm, Ghostty; Linux `$TERMINAL` or the first installed) |
| `cmd+shift+r` | Rename…: a form with the name; the same folder, a taken name refused |
| `cmd+m` | Move to…: a form with the folder (`~` expanded, made when missing); across volumes `mv` does it |
| `cmd+alt+c` | Copy to…: the same form, a copy under the same name (a folder whole) |
| `cmd+shift+z` | Compress: a zip next to the file named after it (`-2` when taken); with rows marked, one zip of them all named after the first (`ditto -c -k --sequesterRsrc --keepParent` on macOS, `zip -r` on Linux) |
| `cmd+d` | Move to Trash: asks first; Finder's delete on macOS, `gio trash` on Linux; the palette stays open with a toast |
| `cmd+i` | The detail pane: path, size, modified time and kind, then on macOS what Spotlight knows (`mdls`): an image's pixel size and Finder's tags; for a text file under 64 KB the first 40 lines in a code block |

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
| `terminal` | string | `""` | What Open in Terminal opens: `Terminal` (the default), `iTerm`, `kitty`, `Alacritty`, `WezTerm`, `Ghostty`, or any app name; on Linux a command name, else `$TERMINAL`, else the first installed terminal. |

## What it does not do

- Preview images: the app's `icon://` scheme serves app icons, favicons
  and clipboard images only, so the pane shows text files and metadata.
- Unzip: Compress makes archives; the Archive Utility or `unzip` opens
  them.
- Index anything itself: no fd, locate or Spotlight means no results
  (one hint row says which tool is missing), and fd stops eight levels
  down.

## Platforms

macOS (Spotlight, Quick Look, Finder, `mdls`, `ditto`) and Linux (fd,
locate or find; GTK's recently-used list; `gio trash`, `xdg-open`, `zip`;
a PNG's size off its header, no tags).

The rename, move and copy forms and the tool runner live in `ops.ts` and
are the Downloads extension's too (`../files/ops.ts`).
