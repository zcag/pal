# Bookmarks

Hand-picked links from a JSON file and your browsers' bookmarks, in one
indexed palette. Enter opens the link in the default browser; `⌘C` copies
it. Every source is read on every listing (`⌘R`), so an edit in the
browser or the file shows at once. A url two sources have is listed once,
the first wins: the file's rows come first, then each browser in the
`browsers` setting's order.

The file's rows show `subtitle` (the url when absent), an `icon` (a glyph,
emoji or hex colour; a row with a url and no icon gets the site's favicon)
and match their `keywords`. Browser rows sit in a section per browser and
profile (`Chrome`, `Chrome (Work)`, `Safari`, `Firefox`), carry the folder
path as an accessory (`Bookmarks Bar / Dev`) and as keywords, and get the
site's favicon.

## Sources

| source | what is read |
| --- | --- |
| the file | `~/.config/pal/data/bookmarks.json` (the `file` setting): a JSON array of `{ name, url, subtitle?, icon?, keywords? }` |
| Chrome, Brave, Edge, Chromium, Vivaldi, Arc | every profile's `Bookmarks` JSON; the profile name from `Local State` when there is more than one |
| Safari | `~/Library/Safari/Bookmarks.plist`, through `plutil -convert xml1`; the Reading List is left out |
| Firefox | every profile's `places.sqlite`, copied first because the running browser holds it locked; tags and `place:` queries left out |

```json
[
  { "name": "Home Assistant", "url": "http://ha.lan", "keywords": ["ha", "home"] },
  { "name": "GitHub", "url": "https://github.com", "icon": "🐙" }
]
```

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open in browser: the system's default |
| `cmd+c` | Copy link |
| `cmd+shift+c` | Copy as markdown: `[name](url)` |
| (action panel) | Open in Chrome, Safari, Firefox, ...: on a browser's row, the browser it came from (`open -a` on macOS, the browser's binary on Linux) |
| `cmd+r` | Read every source again |

## Setup

Nothing to install. A browser with no profile on the machine lists
nothing. Safari's file is behind Full Disk Access on macOS: without it
the Safari section is one inert row saying so (System Settings > Privacy
& Security > Full Disk Access, add pal); the other browsers still list.

Settings, `[extensions.bookmarks]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `file` | path | `~/.config/pal/data/bookmarks.json` | The bookmarks file. `~` is expanded. Not there: the browsers alone; unreadable: one hint row naming it. |
| `browsers` | list | `["chrome", "brave", "edge", "chromium", "vivaldi", "arc", "safari", "firefox"]` | Whose bookmarks to list, in order. `[]` is the file alone. |
| `exclude_folders` | list | `[]` | Bookmark folders skipped, by name (`Archive`) or a short path (`Bookmarks Bar/Old`), case-insensitive. |

## What it does not do

- Add, edit or delete a bookmark: the file is edited by hand, the
  browsers' bookmarks in the browser. The Quicklinks palette is the one
  edited in the panel.
- Safari's Reading List, Firefox's tags and `place:` smart folders.
- Arc on Linux: it has no Linux build, so the entry has no profile root.
- Favicons for the file's rows come from the url; a row without a url is
  skipped.

## Platforms

macOS and Linux. Safari (and Full Disk Access) is macOS only; the
Chromium browsers and Firefox are read from their platform's profile
roots (`~/Library/Application Support/...` or `~/.config/...` and
`~/.mozilla/firefox`).
