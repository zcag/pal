# Downloads

Your Downloads folder as a palette, newest first, with what a download is
(its size, its kind or a thumbnail, its age) and what you do with one
next: open it, reveal it, copy it, move it somewhere, rename it, trash it.
A live palette: the rows are indexed, so a download's name finds it at
the root, and the folder is read again on every show, so what just
finished is there.

## The rows

| section | what |
| --- | --- |
| Downloading | a file still coming in, first: Chrome's `.crdownload`, Firefox's `.part`, Safari's `.download` bundle, curl's `.partial`; the name it will have, a blue `downloading` tag, its size and, once it has grown between two listings, the rate; Safari's bundle says its percentage and total from its own plist. Reveal and Copy path only |
| Today, Yesterday, This week, Older | every other file by its modification day, newest first: the size and the age on the right, the kind (`Document`, `Image`, `Disk`, `App`, `Archive`, `Code`, `Video`, `Audio`, or the extension) as the subtitle |
| Folder | `Clear older than 30 days`: how many files and how much they weigh, moved to the Trash on Enter after a confirm card; `Open Downloads`: the folder in Finder |

An image or a PDF wears a 64 px thumbnail instead of its kind glyph,
made once per file (`sips` on macOS, ImageMagick's `magick` or `convert`
on Linux) into `~/Library/Caches/pal/downloads` (`$XDG_CACHE_HOME/pal/downloads`),
the newest 24 per listing so a big folder lists fast and the rest fill in
on later shows; `thumbnails = false` turns them off. Dotfiles are skipped.

With `browser_folders` on, each browser's own download folder is listed
too when it is not the main one: Chrome, Chrome Beta, Chromium, Brave,
Edge, Vivaldi and Arc from their `Preferences` (`download.default_directory`),
Firefox from `prefs.js` (`browser.download.dir` when it is in charge);
the subtitle then carries the folder.

The detail pane (`cmd+i`): name, folder, size, kind, modified, and on
macOS the url the file came from and the page it was on, as Spotlight
recorded them (`kMDItemWhereFroms`, what the browser stamps on a
download).

The root's Now section (the empty panel) shows the newest download of
the last ten minutes as `Downloaded: <name>` with the same actions.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open the file (marked rows: every one) |
| `cmd+enter` | Reveal in Finder / show in the file manager (marked rows together) |
| `cmd+y` | Quick Look (macOS) |
| `cmd+c` | Copy the file itself: a paste in Finder copies it (marked rows together) |
| `cmd+shift+c` | Copy the path (marked rows: one per line) |
| `cmd+m` | Move to a folder: a form with the target; `~` is expanded, a missing folder is created, a file of the same name there refuses |
| `cmd+shift+r` | Rename: argument `name` typed in the bar; blank (or a pick without the field) opens the form with the current name; a name in use refuses |
| `cmd+d` | Move to the Trash (asks first; marked rows together) |
| `tab`, `shift+↓`, `cmd+click` | Mark rows for a multi pick |
| `cmd+i` | The detail pane |

Trash is Finder's own on macOS (the file lands in the Trash and can be
put back) and `gio trash` on Linux. Moving across volumes copies then
removes.

## Setup

Nothing to install; thumbnails on Linux want ImageMagick. Settings,
`[extensions.downloads]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `folder` | folder | `~/Downloads` | The downloads folder. |
| `browser_folders` | boolean | `true` | Also list the browsers' own download folders when they differ. |
| `limit` | 10 to 2000 | `200` | At most this many files, the newest. |
| `thumbnails` | boolean | `true` | Previews for images and PDFs. |
| `clear_days` | 1 to 365 | `30` | The age the Clear row trashes. |

## What it does not do

- Pause, resume or cancel a download: the browser owns it; the palette
  only watches the file grow.
- Show a fraction for a Chrome or Firefox download: their partial files
  carry no total, so the row shows the size and the rate; Safari's
  bundle has both.
- Watch the folder: the listing is what the folder held when the panel
  was shown; `cmd+r` lists again.

## Platforms

macOS and Linux.
