# Maps

Places and directions from the panel, opened in Google Maps or Apple
Maps. No key: the rows are urls (`google.com/maps/search/?api=1&query=`,
`maps/dir/?api=1&origin=&destination=&travelmode=`, `maps://?q=` and
`maps://?daddr=&saddr=&dirflg=`), so nothing is fetched unless a Places
API key is set. An input palette.

## What the query does

| query | rows |
| --- | --- |
| nothing | Home, Work, the commute both ways (with both set), every saved place |
| `kadıköy` | Search kadıköy; Directions from here, from home, from work; the saved places whose name or address contains it |
| `home > work`, `here -> Kadıköy`, `Moda to Levent` | a route with both ends and its reverse; `home`, `work` and `here` resolve to the settings and the current location; `>` and `->` always split, ` to ` only when an end is home, work, here or a saved place (`things to do in Moda` is a search) |
| `go: coffee`, `maps: home > work` | the same, inline at the root under a Maps section |

The **travel mode** is the filter (Tab cycles it): driving, transit,
walking, cycling. It applies to every directions row and route.

With `api_key` set, **Places autocomplete** rows follow the standing rows
250 ms after the last key: the prediction's main text as the name, the
rest as the subtitle; Enter opens the search pinned to the place id
(`query_place_id`), so it lands on that place and not a lookalike. The
root's inline ask never waits on it.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Open: the place in the chosen app; on a route row, the directions |
| `cmd+enter` | Directions from here (the current location) to the place |
| `cmd+h` | Directions from home |
| `cmd+w` | Directions from work |
| `cmd+c` | Copy the address |
| `cmd+l` | Copy the link: the web url of what Enter would open (Apple's `maps://` becomes `maps.apple.com`) |
| `cmd+shift+o` | Open in the other app: Apple Maps when Google is chosen, and the other way |
| `tab` | Next travel mode |

## Setup

Settings, `[extensions.maps]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `app` | `google`, `apple` | `google` | Which app the rows open. Apple Maps is macOS only. |
| `home` | text | empty | An address or place name: the Home row, `home` in a route, "from home" directions. |
| `work` | text | empty | Likewise; with both set the empty palette lists the commute. |
| `places` | list | empty | One per line, `Name = address`; a line without `=` is both. Each is a row and a route end. |
| `api_key` | secret | empty | A Google Cloud key with **Places API (New)** enabled, for autocomplete. Google bills autocomplete requests past the monthly free credit, so the calls are debounced and cached per input. |

## What it does not do

- Show a map or a route in the panel: the apps do that; the palette gets
  you there in two keystrokes.
- Reverse geocoding or the current address: "here" is whatever the app
  takes as the current location.
- Read Apple Maps' or Google's saved places: the `places` setting is
  yours to fill.

## Platforms

macOS and Linux (Apple Maps on macOS only; Google Maps opens in the
browser on both).
