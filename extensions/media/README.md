# Now Playing

One row per running player: the track as the title, artist and album as
the subtitle, the artwork (else the app's icon) and a `playing` /
`paused` / `stopped` tag, with the player's name next to it. A player
with nothing loaded reads "Nothing playing" with the player's name; one
that is playing but reports no track (Chrome with a YouTube tab on macOS
gives the position and nothing else) is its app's name, with the position
as the subtitle (`42:12 / 1:06:03`). A live palette: read again on every
show through the core's media capability, so the track that is on right
now is a root result too (type its title or artist at the root). With no
player running the one row says so, and on Linux how to see players.

Every control keeps the palette up and lists again, so the tag follows
what you did; a player that refuses (Music not running, a player that
has no next track) is a toast with its message.

## Keyboard

| keys | action | what |
| --- | --- | --- |
| `enter` | Play / Pause | toggles; the row's tag follows |
| `cmd+right` | Next track | |
| `cmd+left` | Previous track | |
| `cmd+c` | Copy track | copies `artist - title` |
| `cmd+o` | Open in Spotify / Music / ... | the track's url (Spotify's `spotify:track:` link), else the app on macOS |

A row for a player with nothing loaded has only the three transport
actions.

## Setup

No settings. What is listed depends on what the core's media capability
can see:

- **macOS**: Spotify and Music through AppleScript, only while the app is
  running (the check is `NSRunningApplication`, so pal never launches one
  to ask); Spotify gives the artwork url and the track url. The first
  AppleScript run asks whether pal may control the app (the Automation
  permission). The system-wide Now Playing (any other player: a browser,
  VLC, IINA) is one more row, from the MediaRemote adapter pal bundles
  ([mediaremote-adapter](https://github.com/ungive/mediaremote-adapter),
  a small framework run through `/usr/bin/perl`): the one source that
  still works on macOS 15.4 and later, where `mediaremoted` answers only
  entitled clients and `nowplaying-cli` gets null for everything. Nothing
  to install. The row is the app's name and icon (from its bundle id),
  the track when the player reports one, and the position.
- **Linux**: `playerctl` over MPRIS, one row per player; the icon is the
  player's `.desktop` when one is named like it. Without `playerctl` the
  one row says to install it.

The bar item **Now Playing** puts the playing track on the strip (hidden
while nothing plays) with the transport in its popover: Pause (`space`),
Next (`right`), Previous (`left`), Copy track (`cmd+c`), Open (`cmd+o`).
The core asks for it every 30 s and on show and wake; in between the
extension looks at the players itself every 5 s while one was playing at
the last look, and pushes when the track or the state changed, so a skip
shows within seconds and an idle machine costs nothing.

## What it does not do

- Seek, shuffle, repeat or volume: the capability has play, pause, next
  and previous.
- Launch a player: a player that is not running is not listed, and
  nothing here starts one.
- Show a queue or a playlist; one row per player, the current track only.
- Artwork for Music on macOS: Music gives no url, so the row shows the
  app's icon.

## Platforms

macOS and Linux. macOS needs the Automation permission for Spotify and
Music (asked once per app); anything else comes through the bundled
MediaRemote adapter. Linux needs `playerctl`.
