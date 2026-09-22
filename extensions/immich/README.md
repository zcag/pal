# Immich

Your Immich photo library from the panel. One input grid over Immich's
CLIP search: type what is in the picture ("a receipt", "dog on the
beach") and the matches come back as thumbnails; nothing typed lists the
newest uploads. Enter opens the photo in Immich, the rest copies,
downloads, favourites, files into an album or Quick Looks it. Albums,
people and today's memories are lists of their own whose Enter drills
into the same grid, scoped.

## The grid (`immich`)

| tile | what |
| --- | --- |
| the picture | Immich's own `thumbnail` rendition (WebP, ~10 KB), fetched once into the cache directory and sent as a data url |
| the caption | the place and the day ("Serdivan · 3 May 2022"); a video leads with "▶" and its length |
| the pane (`cmd+i`, open by default) | the `preview` rendition (1440 px), when and where it was taken (the place a link to the map), the camera, lens and exposure, the pixel size, bytes and format, the file name, the people on it, the albums it is in, the tags |

The query:

- words go to `/search/smart` (CLIP): "a receipt", "sunset over the sea"
- a file name (`DSC00500`, `IMG-20260418-WA0021.jpg`, anything with a
  photo extension) goes to `/search/metadata` by name
- `since:2025`, `since:2025-03-10` (`--since 2025` works too),
  `before:2024-06`, `in:2023` (that year), `in:Ataşehir` (the city as
  Immich stores it), `type:video` / `type:photo`, `is:favourite` /
  `is:archived` narrow either search
- nothing typed: the newest uploads under a Recent section

The dropdown (`tab`) limits to photos, videos, favourites or the archive.
Every search sends `visibility` (timeline, or archive for that filter):
Immich v3 lists archived and hidden assets when it is left out. 24 tiles
a page; the More tile at the end appends the next page, `cmd+r` starts
over.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open in Immich (`web_url`, else `url`) |
| `cmd+enter` | Copy link |
| `cmd+shift+c` | Copy image: the preview JPEG onto the clipboard as a picture (`copyImage` in `@zcag/pal`), or as a file where the clipboard cannot take one |
| `cmd+y` | Quick Look the preview (macOS) |
| `cmd+s` | Download preview: the 1440 px JPEG into `download_to` as `<day>_<name>.jpg` |
| `cmd+shift+s` | Download original: the file as uploaded (a HEIC, a 30 MB ARW, a video), fetched behind the panel; the HUD says when it landed |
| `cmd+f` | Favourite or Unfavourite (`PUT /assets`, one call for every marked row) |
| `cmd+shift+a` | Add to album…: your albums as a picker, New album… first |
| `cmd+shift+f` | Copy file name |
| `cmd+i` | The detail pane |

Download, Download original, Favourite and Add to album take marked rows
(`cmd+click`, `shift+↑↓`; Tab is the dropdown's). A taken download name
gets `-2`.

## Albums (`immich-albums`)

Every album, the ones with photos first (changed last first) with their
cover, count, date range, description and a `shared` tag; the empty ones
last. Enter opens the album as the grid, where a search runs inside it
(`albumIds` on the request); `cmd+enter` opens it in Immich, `cmd+c`
copies the link. A key that may read `/assets/statistics` or
`/server/statistics` gets an "Immich library" row on top with the photo
and video counts and the bytes on disk; a key without those permissions
gets no row (Immich answers 403). Indexed with a 5 minute `ttl`, listed
lazily, so an album is found by name from the root.

Reached with `cmd+shift+a` on a photo, the same list is the picker:
Enter on an album adds the photos (the ones already there are counted,
not errors), New album… asks for a name and creates it holding them.
Only the albums the key's user owns are offered when the key may read
`/users/me`; otherwise every album is.

## People (`immich-people`)

The people Immich has named, favourites first with a tag, each with the
face crop; a last row counts the faces without a name and opens Immich's
People page. Enter lists the person's photos as the grid (`personIds`),
`cmd+enter` opens them in Immich, `cmd+c` copies the link. Indexed, 10
minutes.

## On This Day (`immich-memories`)

Immich's memories for today (`/memories?for=<today>`): a row per past
year ("A year ago, 2025", "5 years ago, 2021") with the count, the places
and the first picture. Enter lists that memory's photos as the grid (they
came with the memory: no search, the query filters them by name, place
and person); `cmd+enter` opens Immich's memory viewer. Live, once every
30 minutes. The memories endpoint sends no EXIF, so those tiles carry no
place.

## Links

- `pal://immich/search?q=a+receipt&filter=videos`: the grid on that
  query; `filter` is `photos`, `videos`, `favourites` or `archived` and
  rides as a word of the query (`type:video`), since a push cannot set
  the dropdown. Empty `q` lists the newest uploads.
- `pal://immich/album?name=receipts` (or `id=`): the album's grid; the
  name is matched whole, then as a part, case aside.
- `pal://immich/person?name=mehmet` (or `id=`): the person's grid.

## Setup

Settings, `[extensions.immich]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `url` | text | empty | Where the API answers (`https://immich.example.com`); a trailing slash or `/api` is dropped. |
| `api_key` | secret | empty | From Immich › Account Settings › API Keys; lands in the keychain. |
| `web_url` | text | empty | Where Open and Copy link point when the site has another name than the API (a tailnet API behind a public site). Empty: `url`. |
| `download_to` | folder | `~/Downloads` | Where the downloads go. |

`[palettes.immich.settings] columns` (3 to 10, default 6): tiles per row.

The key's permissions, as Immich names them: reading needs `asset.read`,
`asset.download` (the thumbnails and previews), `album.read`,
`person.read` and `memory.read`; Favourite needs `asset.update`, Add to
album `albumAsset.create` and New album `album.create`; the library row
`asset.statistics` or `server.statistics`, the owned-albums picker
`user.read`. A refused write is a toast naming the permission, a wrong
key one row saying so, an unreachable server one row naming the url.
Without `url` or `api_key` every palette is one row that opens Settings
on the missing field.

## The cache

`~/Library/Caches/pal/immich` on macOS, `$XDG_CACHE_HOME/pal/immich`
(`~/.cache/pal/immich`) on Linux: `thumbs/<id>.webp` (3000 at most),
`previews/<id>.jpg` (200), `faces/<id>.jpg`; pruned oldest first every
hundred writes. Delete the directory any time. `PAL_IMMICH_CACHE` moves it
(the tests).

## The endpoints

`GET /server/version`, `POST /search/smart`, `POST /search/metadata`,
`GET /assets/{id}`, `GET /assets/{id}/thumbnail?size=thumbnail|preview`,
`GET /assets/{id}/original`, `PUT /assets` (`isFavorite`), `GET /albums`
(`?assetId=` for one asset's), `PUT /albums/{id}/assets`, `POST /albums`,
`GET /people?withHidden=false`, `GET /people/{id}/thumbnail`,
`GET /memories?for=`, `GET /assets/statistics`, `GET /server/statistics`,
`GET /users/me`. Written against v3.1 (probed 2026-09-22) and the v3.2
OpenAPI spec; a v2 clock-string `duration` is still read.

## What it does not do

- Upload, archive, delete, edit metadata or share: the library is
  browsed and filed, not curated, from here.
- Search by a person's name in the query: the People palette does that.
- Paste the picture straight into the app in front: `paste` takes text,
  so Copy image then paste.

## Platforms

macOS and Linux (Quick Look is macOS's; Copy image uses `wl-copy` or
`xclip` on Linux).
