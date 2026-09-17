# Spotify

Spotify from the panel over the Web API: search as you type, play, queue
and like; your playlists and library; the devices and the queue; a
lyrics view that follows the song; a bar item with the line playing. It
needs a Spotify app of your own (two minutes at developer.spotify.com,
below) and signs in with PKCE, so there is no secret anywhere.

## Palettes

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Lyrics | `spotify-now-playing` | view | play or pause; the whole transport on keys |
| Search Spotify | `spotify-search` | input | plays the row (a track, or a playlist, album, artist or show as the context) |
| Playlists | `spotify-playlists` | indexed, 5 min | plays the playlist; `cmd+enter` lists its tracks |
| Library | `spotify-library` | indexed, 5 min, filters | plays the track (or the artist) |
| Spotify Devices | `spotify-devices` | live | transfers playback to the device; the volume rows act on the active one |
| Queue | `spotify-queue` | live | skips to the row (one Next per row ahead) |
| Spotify | `spotify-commands` | indexed, primary | play or pause, next, previous, like, lyrics, sign out, and "Play <playlist>" for each pinned one |

**Search** lists Tracks, Artists, Albums, Playlists, Podcasts and
Episodes as sections, five each, with the cover as the row's icon. A
track row: `enter` plays it alone, `cmd+enter` adds it to the queue,
`cmd+l` likes or unlikes it, `cmd+o` opens it in Spotify, `cmd+c` copies
the link. A playlist or album: `enter` plays it, `cmd+enter` lists its
tracks (a level whose rows play from that point inside the playlist, so
the rest follows), `cmd+s` plays a playlist shuffled. The search waits
300 ms for the typing to settle and asks Spotify once per query.

**Library** has four filters on `Tab`: Liked Songs (newest first, with
the date), Recently played (the time, each track once), Top tracks and
Top artists of the last weeks (ranked). **Devices** shows every device
Spotify is open on with its kind's glyph, its volume and an `active`
tag; the three Volume rows step the active device by 10 or mute it.
**Queue** lists what plays now and what comes next, numbered; the Web
API has no way to remove a row from the queue, so the row's Enter skips
to it instead.

The **Spotify** rows are root results: type `pause`, `next`, `like` or
`Play Focus` at the root. Each `pinned` setting entry (a playlist's name,
or its `spotify:playlist:` link) is one "Play <name>" row; a name that
is not among your playlists is a hint row saying so. The playing track
is also a row of the root's Now section (Enter opens the lyrics view).

## The lyrics view

The cover large at the left with the track, artist and album under it,
a progress bar that ticks with the times beside it, badges for paused,
shuffle, repeat, liked and the device with its volume, and the lyrics
beside it: the line playing bright and large, the three before it muted,
the three after faint. As the song advances the lines slide up, the top
one fades and a new one slides in at the bottom. Lyrics come from
[lrclib.net](https://lrclib.net) (free, no key): the exact lookup by
track, artist, album and duration first, then a search by track and
artist taking the closest duration within 3 s, once per track per run.
Unsynced lyrics scroll in proportion to the position; a track lrclib
does not have shows "No lyrics on lrclib" and `f` opens lrclib's search
for it. The cover's dominant colour (a small sampler over the 300 px
JPEG, decoded with jpeg-js) paints a band under the art and picks the
progress bar's colour from the tag palette, so the tint follows the
theme.

| keys | action |
| --- | --- |
| `space`, `enter` | play or pause |
| `left`, `right` | seek 10 s back or forward |
| `up`, `down` | volume down or up by 5 |
| `l` | like or unlike |
| `s` | shuffle on or off |
| `r` | repeat: all, one, off |
| `q` | the queue (a level over the view) |
| `d` | devices |
| `cmd+right`, `cmd+left` | next or previous track |
| `cmd+c` | copy the line playing (the track as `artist - title` without synced lyrics) |
| `cmd+o` | open in Spotify |
| `f` | search lrclib, when it has no lyrics |

Every key answers with the next tree at once from a state patched
locally (a pause shows `paused` before Spotify confirms), and the API is
read again on the next key. Signed out, the view says how to sign in
(Enter opens the browser); with nothing playing, Enter opens Spotify.

**It follows the song while it is open**: the extension pushes the tree
every second while something plays (`view.update`, the lines sliding up
as the song advances, the bar ticking), from the moment the level comes
on top until it leaves, and the app re-asks it every 5 s besides
(`refresh` in the manifest) as the safety net. The bar popover is the
same view in a compact layout, fed the same way.

## The bar item

`spotify/playing`: the track playing (`title · artist`) beside the
Spotify mark, or, with **Lyrics on the bar** (`bar_lyrics`, on), the
lyric line playing when lrclib has synced lyrics for the track; hidden
while nothing plays. A click opens the lyrics view in the popover, in a
compact layout: the cover with the track, the artist and the album
beside it, the progress bar with the times, the line playing large with
one before and two after, the transport as key hints (`space` pause or
play, `cmd+left`/`cmd+right` track, `left`/`right` seek 10 s,
`up`/`down` volume), a row for `l` like, `d` devices, `q` queue with the
paused/shuffle/repeat badges, and under a hairline the queue's next two
tracks ("next", "then": the 64 px cover, the name, the artist), a click
on one skipping to it (as many Nexts as its place, the queue palette's
rule). The queue is asked at most every 15 s while the popover shows and
again after a skip, an enqueue or a track change from the keys; the rows
are left out while it is unknown. `q` and `d` open the queue and the
devices inside the popover. While the popover is up the item is pushed
every second, so the bar and the lines move; the playback state is read
from Spotify every 5 s and the position between reads comes from the
clock. The pushes go on for five minutes after the popover was last
shown (`view/hidden` of its level ends the window early); outside that
window the item asks to be rendered
again exactly when the next lyric line starts, so the strip changes line
on time without polling. The core also renders it every 30 s, on show,
wake and network, and on its `media` trigger (macOS: the moment the
track or the state changes, through the MediaRemote stream).

## Setup

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard):
   any name, the Web API checked, and the redirect URI
   `http://127.0.0.1:27182/callback` (the port is the **Redirect port**
   setting; change both together). Spotify requires the loopback
   address written as `127.0.0.1`, not `localhost`.
2. Put the app's client id under Settings › Extensions › Spotify. No
   secret: pal uses the authorization code flow with PKCE.
3. Run any Spotify palette: the one row says "Sign in to Spotify"; Enter
   opens Spotify's consent page in the browser while pal listens on
   `127.0.0.1:27182`. Approve, and the tab says pal has what it needs;
   the HUD says "Signed in to Spotify". The listener is up for five
   minutes at most and only while a sign-in is pending.

Playback control (play, pause, seek, volume, transfer) needs Spotify
Premium; Spotify answers `403 Premium required` otherwise and the panel
says so. Search, the library and the lyrics work on any account.

**Where the tokens live.** The refresh token and the current access
token are kept in the extension's storage file,
`<data dir>/pal/storage/spotify.json` (`~/Library/Application
Support/pal/storage/spotify.json` on macOS, `~/.local/share/pal/storage/`
on Linux), readable by your user only. pal's secret settings can hold a
`keychain:` reference, but the SDK has no `settings.set` an extension
could write one through, so the file it is. The **Sign Out of Spotify**
row deletes it; the app stays authorised on your account until you
remove it at spotify.com/account/apps. The access token is renewed a
minute before it expires and once on a 401; Spotify rotates the refresh
token on each renewal and the new one is kept.

Settings, `[extensions.spotify]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `client_id` | text | unset | Your app's client id. |
| `redirect_port` | number | `27182` | The loopback port for the sign-in redirect; must match the app's redirect URI. |
| `bar_lyrics` | boolean | `true` | The lyric line on the bar strip instead of the track name (when lrclib has synced lyrics). |
| `pinned` | list | `[]` | Playlist names or `spotify:playlist:` links, each a "Play <name>" root row. |

## Limits and failures

- A `429` is honoured: a `Retry-After` of two seconds or less is waited
  out inside the call, a longer one is remembered and every call until
  then answers "Spotify rate limit reached, try again in N s" without a
  request.
- No network: one row, "Spotify is unreachable"; the bar item hides
  (it has no room for a hint) and comes back on the next render.
- No active device: playing from a row is a toast naming the fix; the
  view says "No active device" with `d` for the devices.
- lrclib down: the view says "Looking for lyrics" and asks again on the
  next key; a miss is remembered for the run, a failure is not.
