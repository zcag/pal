# GIFs

Search Giphy from the panel and paste the GIF. An input grid:
what is typed is searched 300 ms after the last key, nothing typed lists
what is trending, and every tile is the GIF's small animated preview.
`enter` puts the GIF **file** on the clipboard, so it pastes as a picture
into Slack, Messages, Notes or a document; `cmd+enter` copies the url
instead.

## The grid

| tile | what |
| --- | --- |
| a preview | Giphy's `fixed_height_small`, fetched once into the cache directory and sent as a data url, so the grid animates and a second look fetches nothing |
| the caption | the GIF's title, without its trailing "GIF" |
| `cmd+i` | the detail pane: the preview larger, the size in pixels and bytes, the page |

The section is "Trending" while nothing is typed. Six tiles a row by
default (`columns` under the palette's settings, both grids).

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Copy the GIF file: downloaded into the cache (once), then `copy_files`; the HUD says "Copied GIF" |
| `cmd+enter` | Copy the url of the GIF file |
| `cmd+o` | Open the GIF's page on giphy.com |
| `cmd+s` | Save the file to `save_to` (`~/Downloads`), named after its title |
| `cmd+f` | Add to favourites |
| `cmd+d` | In Favourite GIFs: remove |
| `cmd+i` | The detail pane |

## Favourite GIFs

`cmd+f` keeps a GIF in the Favourite GIFs palette (`gifs-favourites`,
storage, the last 200, newest first): the same grid with the same actions
and Remove; the last row clears it (asks first). The palette is live, so
its rows are at the root: a favourite is found by name from the root
search.

## The backend and its key

Giphy's v1 API on `api.giphy.com`, which takes an app key: at
developers.giphy.com *Create an App*, pick *API* (not SDK), and paste the
key as `giphy_api_key` (it lands in the keychain). The key is free with a
rate limit.

Without a key the grid is one row saying which setting to fill and where
the key comes from; a refused key names the fix.

`content_filter` is Giphy's `rating`: `off` (R), `low` (PG-13), `medium`
(PG), `high` (G); `medium` by default.

## The cache

Previews and downloaded GIFs go under `~/Library/Caches/pal/gifs` on
macOS, `$XDG_CACHE_HOME/pal/gifs` (`~/.cache/pal/gifs`) on Linux, named
by a hash of their url; the full GIF carries its title
(`<hash>-cat typing.gif`) so a paste or a Save shows a name. Delete the
directory any time.

## Setup

Settings, `[extensions.gifs]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `giphy_api_key` | secret | empty | The Giphy app key. |
| `content_filter` | `off`, `low`, `medium`, `high` | `medium` | What the results may show. |
| `save_to` | folder | `~/Downloads` | Where `cmd+s` writes the file. |

`[palettes.gifs.settings] columns` (3 to 10, default 6): tiles per row.

## What it does not do

- Paste the GIF straight into the app in front: `paste` takes text, so
  Enter copies the file and you paste it. `cmd+enter` copies the url for
  places that take one.
- Upload or share through Giphy: what it learns is the search.
- Search without a key: the API requires one.

## Platforms

macOS and Linux (`copy_files` puts file URLs on the pasteboard on macOS,
`text/uri-list` on Linux).
