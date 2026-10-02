# Store

Every extension your registries list, in the panel: pal's own registry
first, then any you added (Settings › Extensions › Registries). An input
palette: what you type narrows the list by name, title, tagline,
category, keywords and palette titles; the dropdown (`tab`) filters to
Installed, Updates, Registries, or one of the shelves. Every row is one
listed extension with its tile, its tagline and how it stands: `update`,
`needs a newer pal`, `not updated` (its registry no longer lists it),
`comes with pal`, `installed`, or why it cannot be installed here. A row
from a registry other than pal's carries that registry's name.

## Rows and actions

| standing | Enter | cmd+Enter | cmd+c | ctrl+x |
| --- | --- | --- | --- | --- |
| not installed | Install (asks first) | Open store page | Copy `pal install <name>` | |
| not for this machine | Open store page | | Copy install command | |
| installed, update ready | Update | Open | Copy install command | Remove (asks first) |
| installed | Open (its first palette) | Open store page | Copy install command | Remove (asks first) |
| comes with pal | Open | Open store page | Copy install command | |

Install, Update and Remove go through the core (`extensions.install`,
`update`, `remove` in the SDK) and wait until the extension is loaded, or
gone: a toast says how it went and the list relists in place. A failure
names the extension and the reason, including one that installed but
failed to load. Whether something has an update is the core's one check;
the palette compares nothing. The store page is on pal.cagdas.io, so only
pal's own registry's extensions have one. An extension that comes with
pal is turned off in Settings › Extensions, never removed.

What has an update leads the list under an **Updates** heading (unless
the filter already narrows to updates). Opened on All with nothing typed,
**Featured** follows (the first three of Spotify, GitHub, Solitaire,
Calendar, Translate, Disk Space, Hue and Typing that are not installed and
install here; Settings' Browse has the same row), then a section per
category, each by title. A search or a filter is one list, the
extensions whose title the words start first.

Marked extensions (cmd-click, shift-click, shift+arrows) install, update
or remove together, open their pages, or copy their install commands one
per line; the questions name no extension, so they read for one or
several.

## The detail pane

`cmd+i` on a row: where it comes from and its category over its title,
how it stands as a chip (the row's tag); then the description, what it
does (the listing's features, when its index has them), the palettes, the
screenshots from the listing, and what it installs first; the metadata
lists the author, its status, its build (short hash and date), whether it
updates by itself, platforms, the `pal install` line and, for pal's
registry, a link to the page.

## Registries

The Registries filter lists each registry with how its last check went,
its channel and whether its extensions update by themselves, plus an Add
registry row; Enter on any of them opens Settings › Extensions ›
Registries, where they are added, removed and switched.

## The list

The core keeps the registries' indexes (`extensions.state()`, cheap).
The first listing in ten minutes, and `cmd+r`, fetch every registry
(`extensions.refresh()`); the cached rows show at once and the fresh ones
replace them. A registry that did not answer says so above the list,
with how old its list is; a fetch that failed says why.

No settings.
