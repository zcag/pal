# Theater

Your home media stack in one extension: Jellyfin, Jellyseerr, Radarr,
Sonarr, Lidarr, Prowlarr, NZBHydra2, Bazarr, SABnzbd, qBittorrent,
Navidrome, Audiobookshelf, Kavita, Shelfmark, Filebrowser and Homepage.
The Theater palette shows every configured service with live health and
opens it; each service has its own palettes (what to continue, what is
queued, a search, the requests, the wanted items) with the actions the
service's own UI would offer (play, approve, add, pause, grab, star);
four bar items say what is downloading, who is watching, what waits for
an approval and what the arrs are fetching, each hidden while it has
nothing to say. Only the services you fill in light up.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Theater | `theater` | live, 30 s | opens the service's web UI |
| Jellyfin | `theater-jellyfin` | live, 60 s | opens the item in Jellyfin |
| Search Jellyfin | `theater-jellyfin-search` | input | opens the item in Jellyfin |
| Now Playing on Jellyfin | `theater-jellyfin-playing` | live, 30 s | opens the item |
| Play on | `theater-jellyfin-play` | pushed from Play on a device | plays the item on that session |
| Requests | `theater-seerr-requests` | live, 60 s | opens the request in Jellyseerr |
| Request a title | `theater-seerr-request` | input | requests it (asks first) |
| Radarr, Sonarr, Lidarr | `theater-radarr`, `theater-sonarr`, `theater-lidarr` | live, 60 s | opens in the app |
| Add a movie, series, artist | `theater-<app>-add` | input | adds with the default profile and searches (asks first) |
| Wanted | `theater-<app>-wanted` | indexed, 5 min | searches for it now |
| History | `theater-<app>-history` | indexed, 5 min | opens in the app |
| Downloads | `theater-downloads` | live, 20 s | opens the download client |
| Download history | `theater-downloads-history` | indexed, 2 min | opens the download client |
| Indexers | `theater-prowlarr` | indexed, 5 min | opens Prowlarr's indexers |
| Search indexers | `theater-prowlarr-search` | input | grabs through Prowlarr (asks first) |
| Search NZBHydra2 | `theater-hydra-search` | input | sends the NZB to SABnzbd (asks first) |
| Navidrome | `theater-navidrome` | live, 60 s | opens in Navidrome |
| Search Navidrome | `theater-navidrome-search` | input | opens in Navidrome |
| Audiobookshelf | `theater-abs` | live, 60 s | opens in Audiobookshelf |
| Search Audiobookshelf | `theater-abs-search` | input | opens in Audiobookshelf |
| Kavita | `theater-kavita` | live, 60 s | opens the web reader |
| Search Kavita | `theater-kavita-search` | input | opens the web reader |
| Request a book | `theater-shelfmark` | input | lists the releases for the book |
| Releases | `theater-shelfmark-releases` | pushed from Request a book | downloads the release (asks first) |
| Subtitles | `theater-bazarr` | indexed, 5 min | opens in Bazarr |

## Setting up

Everything is under Settings › Extensions › Theater, one group per
service. A service with an empty URL (or an empty key, user or
password) is not an error: the Theater palette shows one "Set up X" row
whose Enter opens Settings on the field, its indexed palettes list
nothing, and its search palettes say what to set.

| service | settings | how it signs in | where the key is |
| --- | --- | --- | --- |
| Jellyfin | `jellyfin_url`, `jellyfin_key`, `jellyfin_user` | `X-Emby-Token` | Dashboard › API Keys; `jellyfin_user` picks whose watched state the rows show (the first administrator otherwise) |
| Jellyseerr | `seerr_url`, `seerr_key` | `X-Api-Key` | Settings › General (Overseerr works the same) |
| Radarr, Sonarr, Lidarr | `<app>_url`, `<app>_key` | `X-Api-Key` | Settings › General › Security |
| Prowlarr | `prowlarr_url`, `prowlarr_key` | `X-Api-Key` | Settings › General › Security |
| NZBHydra2 | `hydra_url`, `hydra_key` | `apikey` query | Config › Main |
| Bazarr | `bazarr_url`, `bazarr_key` | `X-Api-Key` | Settings › General › Security |
| SABnzbd | `sab_url`, `sab_key` | `apikey` query | Config › General (the full API key, not the NZB key) |
| qBittorrent | `qbit_url`, then `qbit_key` or `qbit_user` + `qbit_password` | a bearer key (5.2+), else a cookie from `/auth/login` with a `Referer` (qBittorrent's CSRF guard reports a wrong password without one) | `POST /api/v2/app/rotateAPIKey` from a logged-in session |
| Navidrome | `navidrome_url`, `navidrome_user`, `navidrome_password` | Subsonic salted token (`t = md5(password + salt)`) | the account |
| Audiobookshelf | `abs_url`, `abs_user`, `abs_password` | `POST /login`, a bearer JWT | the account |
| Kavita | `kavita_url`, `kavita_user`, `kavita_password` | `POST /api/Account/login`, a bearer JWT; the user's API key signs cover urls | the account |
| Shelfmark | `shelfmark_url` | none | |
| Filebrowser, Homepage | `filebrowser_url`, `homepage_url` | none (open rows) | |

Keys and passwords are `secret` settings (the OS keychain). For the
tests and a scratch run, `PAL_THEATER_<SERVICE>_<URL|KEY|USER|PASSWORD>`
(`PAL_THEATER_JELLYFIN_URL`, `PAL_THEATER_QBIT_PASSWORD`) replaces any
setting.

## The endpoints each service is read and written through

| service | reads | writes |
| --- | --- | --- |
| Jellyfin | `/System/Info/Public`, `/Users`, `/Sessions?activeWithinSeconds=960`, `/UserItems/Resume`, `/Items/Latest`, `/Items?searchTerm=`, `/Items/{id}`; posters `/Items/{id}/Images/Primary` (no key needed) | `POST`/`DELETE /UserPlayedItems/{id}`, `POST`/`DELETE /UserFavoriteItems/{id}`, `POST /Sessions/{id}/Playing?playCommand=PlayNow&itemIds=`, `POST /Sessions/{id}/Playing/PlayPause`, `.../Stop` |
| Jellyseerr | `/api/v1/status`, `/settings/public` (4K flags), `/request/count`, `/request?filter=&take=&sort=added`, `/movie/{tmdb}`, `/tv/{tmdb}`, `/search?query=`; posters from `image.tmdb.org` | `POST /request/{id}/approve`, `.../decline`, `POST /request { mediaType, mediaId, is4k, seasons }` |
| Radarr, Sonarr (`/api/v3`), Lidarr (`/api/v1`) | `/system/status`, `/health`, `/queue`, `/calendar?start&end`, `/wanted/missing`, `/history`, `/importlist`, `/qualityprofile`, `/rootfolder`, `/metadataprofile`, `/{movie,series,artist}/lookup?term=` | `DELETE /queue/{id}?removeFromClient=true&blocklist=false`, `POST /command` (`ImportListSync` with `definitionId`, `MoviesSearch`, `EpisodeSearch`, `AlbumSearch`), `POST /movie`, `/series`, `/artist` |
| Prowlarr | `/api/v1/system/status`, `/indexer`, `/indexerstatus`, `/health`, `/search?query=&limit=` | `POST /search { guid, indexerId }` (a grab), `POST /indexer/{id}/test` |
| NZBHydra2 | `/api?t=caps`, `/api?t=search&q=&o=json` | none (the NZB link goes to SABnzbd's `addurl`) |
| Bazarr | `/api/system/status`, `/movies/wanted`, `/episodes/wanted`, `/providers` | `POST /system/tasks?taskid=wanted_search_missing_subtitles_{movies,series}`, `PATCH /movies/subtitles?radarrid=`, `PATCH /episodes/subtitles?sonarrepisodeid=` |
| SABnzbd | `/api?mode=version`, `queue`, `history` | `mode=pause`, `resume`, `queue&name=pause|resume|delete&value=`, `history&name=delete`, `config&name=speedlimit&value=`, `addurl` |
| qBittorrent | `/api/v2/app/version`, `/torrents/info`, `/transfer/info` | `/torrents/stop` and `start` (5.x; `pause`/`resume` before), `/torrents/delete`, `/transfer/setDownloadLimit`, `/torrents/add` |
| Navidrome | `ping`, `getNowPlaying`, `getAlbumList2?type=newest`, `search3`, `getCoverArt` | `star`, `unstar` |
| Audiobookshelf | `/status`, `/api/libraries`, `/api/me`, `/api/me/items-in-progress`, `/api/libraries/{id}/items?sort=addedAt`, `/api/libraries/{id}/search?q=`, covers `/api/items/{id}/cover?token=` | `PATCH /api/me/progress/{id} { isFinished }` |
| Kavita | `/api/Server/server-info-slim`, `POST /api/Series/on-deck`, `POST /api/Series/recently-added-v2`, `/api/Search/search?queryString=`, covers `/api/image/series-cover?seriesId=&apiKey=` | none |
| Shelfmark | `/api/status`, `/api/metadata/search?query=`, `/api/releases?provider=&book_id=` | `POST /api/releases/download { book_data, release_data, context }` |

Every request has an 8 s timeout (searches through indexers 30 s, a
Shelfmark release search 60 s, the health probes 3.5 s). Listings cache
in memory for their palette's cadence (a queue 10 to 15 s, a calendar or
wanted list 5 min, a TMDB title an hour); `⌘R` refreshes; a request that
fails while a cached answer stands keeps the cached rows (logged), except
a refused key.

## Design notes

- **Unconfigured means quiet, not broken.** A service with no settings
  is one row in the Theater palette and nothing else at the root: with
  33 palettes over 16 services, a hint row per palette would spam the
  root of a user who set up two services.
- **The arrs share one module** (`arr.ts`): the same queue, calendar,
  wanted, history, lookup and add code with an `App` row for where the
  nouns differ (movie, series, artist; `/api/v3` and `/api/v1`; the web
  routes). Sync watchlist runs `ImportListSync` per enabled list by
  `definitionId`, which sidesteps the Trakt list's hardcoded 12 h
  interval (the whole-app sync honours it).
- **SABnzbd and qBittorrent are one Downloads palette and one bar item**:
  the question is "what is coming in", not which client has it. The
  history stays per client because failure reasons are.
- **The bar popovers are one render** (`view.ts`): rows with a glyph or
  a poster, a tag, a figure and a progress bar, a cursor the arrows move,
  the keys per item (space, a, d, backspace, p). Every destructive key
  asks first.
- **Nothing is hardcoded**: no host, key or password in the code;
  `http://marko:8096` and the like appear only as placeholders in the
  settings.

## Tests and the fixture

`host/test/extensions/theater.test.ts` runs the extension through the
host harness against `theater-mock.ts`, one Bun server with every
service under its own prefix; the writes are exercised there and never
against a live stack. `bun run extensions/theater/fixture.ts` writes the
gallery fixtures (`app/src/gallery/shots/theater.json`, `bar-theater.json`)
from the same mock.
