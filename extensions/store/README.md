# Store

pal.cagdas.io's extension list in the panel. An input palette: what you
type narrows the list by name, title, tagline, category and author, the
dropdown (`tab`) filters to Installed, Updates, or one of the site's
shelves. Every row is one extension with its tile, its tagline and chips
for what it brings (`menu bar`, `links`, `accounts`), an `Installed` or
`bundled` tag, and `Update to x.y.z` when the site has a newer version of
a store-installed one.

## Rows and actions

| standing | Enter | cmd+Enter | cmd+c | ctrl+x |
| --- | --- | --- | --- | --- |
| not installed | Install (asks first) | Open store page | Copy `pal install <name>` | |
| from the store, current | Open store page | Update (asks first) | Copy install command | Remove (asks first) |
| from the store, behind | Update (asks first) | Open store page | Copy install command | Remove (asks first) |
| bundled with pal | Open store page | | Copy install command | |

Install, Update and Remove go through the core's `pal://install`,
`pal://update` and `pal://remove` routes: the HUD says what is happening,
the extension host restarts with the change, and an install reopens the
root with the extension's name typed so its palettes are one keystroke
away. The panel's confirm card is the only question; the link's card is
skipped since Enter here is your hand.

What is behind leads the list under an **Updates** heading (unless the
filter already narrows to updates). A bundled extension is never
updated from here: it ships with pal and moves with the app.

## The detail pane

`cmd+i` on a row: the description, "What it does" (the manifest's
features), the screenshots (loaded from the site), and a keys table per
palette; the metadata lists the author, the version (with the installed
one when they differ), category, licence, platforms, what it needs, the
`pal install` line and a link to the page.

## The list

Fetched from `https://pal.cagdas.io/api/extensions` at most once an
hour, trimmed to what the rows and the pane need, and kept in the
extension's storage across restarts. `cmd+r` fetches now. Offline with a
list from before, the rows show under a "Showing the list from N min
ago" note; with none, one row says the site is not reachable.

`PAL_STORE_API` points the palette at another server (the tests serve a
fixture).

No settings.
