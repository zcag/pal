# YouTube

Search YouTube from the panel: videos with their thumbnail, channel,
length, views and age, trending while nothing is typed; open one, play
it in IINA, mpv or VLC, or keep it for later. Channels by name with their
latest videos. Through the Data API v3 with a free key, or an Invidious
instance without one.

## The rows

Searched 400 ms after the last key (a Data API search costs 100 of the
day's 10,000 quota units). Each row: the thumbnail as the icon
(`i.ytimg.com`, no key), the title, then `channel · length · views ·
age` (`live now` for a stream); `cmd+i` shows the bigger thumbnail, the
channel as a link, the exact views and the date. The same query again is
answered from a cache.

| query | what |
| --- | --- |
| nothing | the trending list for `region` (YouTube's default when unset), under a Trending section |
| `lofi` | the search |
| `yt: lofi` | the same, inline at the root under a YouTube section; a root query nothing matched offers "Search YouTube for …" |

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open in the browser |
| `cmd+enter` | Play in the player: IINA, mpv or VLC per `player` (`auto` takes the first installed), the browser when none is; the HUD says which |
| `cmd+c` | Copy the url |
| `cmd+s` | Watch later |
| `cmd+shift+o` | Open the channel |
| `cmd+i` | The detail pane |
| `cmd+d` | In Watch Later: remove |

mpv and VLC need `yt-dlp` on PATH to play a YouTube url; IINA brings its
own.

## Channels

The YouTube Channels palette (`youtube-channels`) searches channels by
name: the avatar, the subscriber count and the description as the row;
`enter` lists the channel's latest videos (a level of the search palette
with the channel as its args; what you type there filters them),
`cmd+enter` opens the channel, `cmd+c` copies its url. **Your
subscriptions are not listed**: reading them needs a Google sign-in
(OAuth), which pal does not do; the empty palette says so.

## Watch Later

`cmd+s` keeps a video in the Watch Later palette (`youtube-later`,
storage, the last 200, newest first) with the same actions and Remove;
the last row clears it (asks first). The palette is live, so its rows are
at the root: a saved video is found by title from the root search.

## Backends and keys

- **Data API v3** (`api_key`): a Google Cloud API key with *YouTube Data
  API v3* enabled on its project (console.cloud.google.com › APIs &
  Services › Enable APIs › YouTube Data API v3 › Credentials › API key).
  Free; 10,000 units a day, a search 100, a trending list or a videos
  lookup 1. A used-up quota is one row saying so.
- **Invidious** (`invidious_url`): a search through `/api/v1/search`,
  trending through `/api/v1/trending`, a channel's videos through
  `/api/v1/channels/<id>/videos`, no key. **Most public instances have
  turned the API off** (2026-09-17: of the instances api.invidious.io
  lists, only `invidious.f5.si` advertised the API and answered; others
  returned "Endpoint disabled", a captcha page or 401); a self-hosted
  instance is the reliable choice. An instance that answers HTML or an
  error is one row saying so.

The key wins when both are set. With neither, the palettes show which
setting to fill.

## Setup

Settings, `[extensions.youtube]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `api_key` | secret | empty | The Data API v3 key. |
| `invidious_url` | text | empty | An Invidious instance serving its API. |
| `player` | `auto`, `iina`, `mpv`, `vlc`, `browser` | `auto` | What `cmd+enter` plays in. |
| `region` | text | empty | A two-letter country code for the trending list. |

## What it does not do

- Subscriptions, history, playlists or likes: those need OAuth.
- Play inside the panel: the player or the browser does.
- Comments, transcripts, downloads.

## Platforms

macOS and Linux (IINA on macOS only; mpv and VLC on both).
