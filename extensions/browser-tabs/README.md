# Browser Tabs

Every open tab of your browsers, in the browsers' own order, never ranked.
A live palette: listed again on every show, so tab titles are root
results and typing part of one at the root finds it. Enter selects the tab
in its browser and raises the window.

The row is the tab's title (the url without its scheme when there is
none), the host is the subtitle, the favicon comes from the url; a tab
without a web url (`chrome://settings`) gets the browser's icon. On the
right: the browser's name when more than one is listed, `window N` when
the browser has more than one window, and `playing` (green) or `muted` for
a tab the DevTools protocol could ask. The url, the host and the browser's
name are keywords.

## Sources

Three are merged:

| source | how |
| --- | --- |
| DevTools protocol | a Chromium browser (Chrome, Chromium, Brave, Edge, Vivaldi, Arc) started with `--remote-debugging-port=<port>`: the tab list from `http://127.0.0.1:<port>/json`, then one WebSocket asking every page whether a media element is playing and whether it is muted, and which window it is in |
| AppleScript (macOS) | the browsers in `apps` that are running, over one `osascript` run (JavaScript for Automation): Safari, and Chrome when nothing on the port already covers it. No playing or muted state this way |
| Firefox | its session file (`sessionstore-backups/recovery.jsonlz4`, the newest profile's, LZ4-decoded in the extension). Read-only: its tabs list, and Focus can only raise its window |

Chrome 136 and later ignore the port flag on the default profile: it
needs `--user-data-dir` too.

The filter dropdown (Tab cycles it):

| filter | rows |
| --- | --- |
| All | everything |
| Audible | tabs a page reports as playing sound unmuted (DevTools tabs only) |
| This window | the front window of each browser |

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Focus: selects the tab in the browser, then hides and raises the browser window; for Firefox, "Focus window" raises its window only |
| `cmd+c` | Copy URL |
| `cmd+m` | Mute / Unmute: DevTools tabs only, sets `muted` on every media element in the page |
| `cmd+shift+c` | Copy as markdown link: `[title](url)` |
| `cmd+w` | Close the tab, last in the panel since it is destructive; not for Firefox |
| `tab` | Cycle All, Audible, This window |

Close and mute keep the palette open and list again. A focus, close or
mute that fails keeps the panel open with a toast carrying the reason.

## Setup

For the richest listing, start your Chromium browser with
`--remote-debugging-port=9222 --user-data-dir=<dir>`; without it, Safari
and Chrome are asked over AppleScript on macOS and Firefox is read from
its session file.

The first AppleScript run asks whether pal may control Safari (and
Chrome); a refusal makes every later run fail, which the palette shows as
one row, "Automation permission needed", whose action opens Privacy &
Security, Automation. Raising the browser window needs Accessibility,
like the Windows palette.

Settings, `[extensions.browser-tabs]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `port` | number | `9222` | The `--remote-debugging-port` to look at. |
| `apps` | list | `["Safari", "Google Chrome"]` | macOS: browsers asked over AppleScript when running, by app name. A Chromium browser already on the port is skipped. |
| `firefox` | bool | `true` | List Firefox tabs from its session file. |
| `firefox_session` | path | `` | A `recovery.jsonlz4` to read; empty finds the most recently written profile's. |

## What it does not do

- Close or mute a Firefox tab, or select one: Firefox has no scripting
  interface, so its tabs are read-only.
- Playing and muted state for AppleScript tabs: only the DevTools
  protocol can ask the page.
- Open a new tab or a url: use Quicklinks or Bookmarks for that.
- Nothing on the port, no scriptable browser running and no Firefox
  session is one row saying so.

## Platforms

macOS: all three sources. Linux: the DevTools protocol and Firefox only,
since there is no AppleScript.
