# Hue

Philips Hue over the bridge's own API (CLIP v2, https on the LAN). Eight
palettes and a bar item: rooms, lights and scenes at the root, a light or a
room under the keys, sensors, automations, entertainment areas, the home
on the bar, and a guided pairing. Nothing goes through the Hue cloud; the
cloud is asked once, for the bridge's address, and only during setup.

## Pairing

`Set up Hue` (a view palette; every other palette is a single "Set up
Hue" row until a bridge is paired):

1. The bridges on the network are listed: from `https://discovery.meethue.com/`
   (the addresses bridges on this public IP have phoned home with) and from
   mDNS (`_hue._tcp`, through `dns-sd` on macOS and `avahi-browse` on
   Linux). Each is asked its name and id (`GET /api/0/config`, no key
   needed). `i` types an address by hand, `r` scans again.
2. `1`..`9` (or Enter on the first) starts press-link: the view says "Press
   the round button on the bridge" with a thirty-second countdown, and a
   background task asks the bridge every second (`POST /api` with
   `devicetype: "pal#<host>"`, `generateclientkey: true`). Escape leaves
   the panel; the task keeps going and brings pal back inside the setup
   once the key is in (`effects.run({ push })`), or says in the HUD that
   the button was not pressed. Enter checks at once.
3. Paired: the bridge's address and application key are written to the
   settings (`settings.set`: `bridge` and `application_key` under
   `[extensions.hue]`, the key itself in the OS keychain and the file
   holding the `keychain:` reference, exactly as if pasted under
   Settings › Extensions › Hue), and the rest of the record (the
   entertainment client key, the pinned TLS certificate) goes to pal's
   storage (`<data dir>/pal/storage/hue.json`, `bridges`); then the home
   is read and the event stream opened. `c` copies the key. `x` forgets
   the bridge: its record leaves storage and, when the settings hold it,
   the two keys leave the file.

Several bridges make one home: the settings hold one (the first paired,
or the one typed there), and any further bridge paired keeps its key in
its storage record; the rows say which bridge a thing is on when there is
more than one. A key typed into the settings for an address wins over a
stored one for that address.

## TLS

Every request is https. The bridge's certificate has its bridge id as
the CN and is signed by Signify's private root CA (`root-bridge`,
`cert.ts`, sha256 `F0:BD:8E:65:…:8D:8A:CF`, copied from the developer
site's "Using HTTPS" page); pal verifies against that root plus the
leaf pinned at pairing (an older bridge's self-signed certificate is
pinned as its own root). The host name check is off, since the CN is
the id rather than the address; pairing checks the CN against the id
discovery gave. `insecure = true` skips all of it, for a bridge behind a
proxy. Bun ignores what `checkServerIdentity` returns (measured on 1.4.2),
so a mismatched CN after pairing is logged, not refused; the chain check
is the protection.

## The model and the stream

One `GET /clip/v2/resource` per bridge reads everything (rooms, zones,
devices, lights, grouped lights, scenes, sensors, buttons, behaviours,
entertainment configurations) into one map, and the bridge's event
stream (`GET /eventstream/clip/v2`, server-sent events) patches it from
then on, reconnecting with backoff and re-reading whole after a gap. So
a listing or a view is drawn from memory, and a change made in the Hue
app, on a switch or by an automation reaches the rows, the view (on its
next key) and the bar item (pushed, at most every 300 ms) without a
request. A change from pal is one `PUT`, applied to the model at once
and confirmed by the stream; per resource the newest state is sent no
more often than Hue asks (one per light per 100 ms, one per group per
second), so a held arrow key collapses to one command.

Ids are slugs of the names, unique per kind: `room:living-room`,
`zone:evening`, `light:sofa-lamp`, `scene:living-room/relax`,
`smart:living-room/natural-light`, `sensor:hallway-sensor-motion`,
`auto:weekday-wake-up`, `ent:tv-area`; a second "Lamp" is `light:lamp-2`.
They read in a deep link and an `item_hotkeys` entry, and a rename changes
them (so does the frecency of the row). `cmd+shift+c` copies one.

## Palettes

**Hue Rooms** (`hue-rooms`, live, primary tier): rooms then zones, each
with a tile of its lit lights' colours as stripes (faded with the
brightness; an outline when off), how many of its lights are on, the
grouped brightness, an `on`/`off` tag. Enter toggles the grouped light,
`cmd+enter` opens the room under the keys, `cmd+s` its scenes, `cmd+l`
its lights. `living room` at the root and Enter toggles it. The row's
fields in the bar, a brightness in % and (when a light in the room tunes
white) a colour temperature in K, go with `cmd+shift+b` only: one PUT on
the grouped light with the transition, `0` turns it off, the kelvin lands
inside the lights' range; a pick without the fields asks in a form.

**Hue Lights** (`hue-lights`, live): every light under its room's section,
a swatch of its colour (the bulb-off glyph when off), the room, the
archetype, the temperature in kelvin, `unreachable` in red when Zigbee
lost it, the running effect, the brightness. Enter toggles, `cmd+enter`
opens it, `cmd+b` blinks it (`alert: breathe`), `cmd+c` copies its hex,
`cmd+shift+b` sets the brightness (%) and, on a white-tuning light, the
colour temperature (K) typed into the bar's fields (arguments
`brightness`, `kelvin`; `0` is off; the rest of the actions ignore them).
The detail pane has the xy, the gamut, the effects and the reachability.

**Hue Scenes** (`hue-scenes`, live, primary tier): by room, each a strip
of up to five swatches (the palette's colours, else the actions', a
temperature as its white), `active` or `playing`, `dynamic` for one with
a palette, `smart` for a smart scene. Enter recalls it with the
`transition`, `cmd+enter` plays the palette dynamically, `cmd+o` opens
the room. `relax` at the root and Enter plays it.

**Hue Light** (`hue-light`, a view): a light or a room under the keys,
opened from a row (never listed at the root). Left: the tile in the
current colour with the brightness and name, the brightness bar, the
temperature along a warm-to-cool strip with a marker (the light's own
mirek range), the hue/saturation plane with a marker (only for a colour
light or a room with one). Right: the name and state, the presets
(Relax, Read, Concentrate, Energize, Bright, Dimmed, Nightlight, as the
Hue app defines them), the room's scenes as strips, the effects the light
supports (candle, fire, sparkle, prism, opal, glisten and the rest,
`none` first), and the options: apply to this light or its room (`a`),
the transition (`d`: instant, 400 ms, 1 s, 4 s). Keys: `←`/`→`
brightness in 5 % (`⇧` 20 %), `↑`/`↓` cooler/warmer by 20 mirek (`⇧`
80), `1`..`9` = 10..90 %, `0` off, `t`/`space` toggle, `tab` walks
light → colour → presets → scenes → effects (`⇧tab` back); on the colour
row the arrows move hue (10°, `⇧` 40°) and saturation (0.05, `⇧` 0.2)
inside the light's gamut; on a row `←`/`→` choose and Enter applies;
`s` the scenes as a list, `o` the room, `i` blink, `c` copy the hex, `r`
read the bridge again.

**Set up Hue** (`hue-setup`, a view): above.

**Hue Sensors** (`hue-sensors`, live): motion (`motion`/`clear`),
temperature (°C), light level (lux, from the bridge's log scale), buttons
and dials with their last event, contact sensors; grouped by device, the
device's battery on its first row (red when low), when the reading last
changed, `disabled` when the sensor is off. Enter copies the reading,
`cmd+e` enables or disables a sensor that can be.

**Hue Automations** (`hue-automations`, live): the bridge's behaviour
instances (wake up, go to sleep, timers, motion) with the script's name,
`running`/`disabled`/`error`. Enter enables or disables.

**Hue Entertainment** (`hue-entertainment`, live): the areas with their
type and light count; Enter starts streaming (`action: start`, the
lights go to streaming mode until a client streams or the bridge times
out), `cmd+enter` stops.

## The bar item

`hue/home`: the main room's colour as a dot (a PNG, since the menu bar
draws PNGs only) and `N on`; the bulb glyph, muted, with everything off;
hidden until a bridge is paired; `stale` when a paired bridge does not
answer. The main room is the item's `main_room` setting, else the room with most
lights on. Rendered every 60 s and on show, wake and network; pushed on
every stream event, so the popover follows a switch or the Hue app too.

The popover (420 px, `popover.ts`) is the home in reach: a status row
(how many lights are on, each motion sensor as a badge, green while it
sees motion, the temperatures, a red badge for a bridge that is away),
the rooms and zones as a grid of tiles two a row, each in its lit colour
shaded by the brightness with its name, a switch, the count and
brightness and a thin brightness bar (an off room is a plain card), then
the scenes as five-swatch tiles with their digit (the opened room's,
else the item's `scenes` by name or id, else the main room's, nine at most; the
one playing is a card with its name in the accent), and the key hints. A
tap on a tile toggles the room, the switch too; the chevron opens the
room: its lights inline, each a swatch, the name, a brightness slider
(a tap sets the level where it landed), the percentage and a switch.

| key | does |
| --- | --- |
| `↑` `↓` `←` `→`, `tab` | move over the rooms (two a row); in an opened room `↑` `↓` walk its lights |
| `enter` | open the room under the cursor (close it again); on a light, toggle it |
| `space` | toggle the room under the cursor (or the light) |
| `←` `→`, `+` `-` | brightness of the light under the cursor by 5 (`shift` for 20); `+` `-` on a room too |
| `backspace` | close the opened room |
| `1`..`9` | play that scene |
| `e` | everything on |
| `x`, `cmd+shift+o` | all off |
| `p` | open Rooms in pal |
| `r` | read the bridge again |

The cursor is kept while the popover is closed, so it reopens where it was.

## Links

`pal://hue/toggle?room=living-room` (`on=1` sets rather than toggles),
`pal://hue/scene?name=relax&room=living-room` (`dynamic=1` plays the
palette), `pal://hue/off`. Rooms and scenes go by name, slug or id.

## Settings, `[extensions.hue]`

| key | type | default | what |
| --- | --- | --- | --- |
| `bridge` | text | unset | The bridge's address; pairing writes it, or type it with a key of your own. |
| `application_key` | secret | unset | The key for `bridge`: pairing puts it in the keychain (`keychain:pal/hue-application_key`); an `env:` reference works too. |
| `insecure` | boolean | `false` | Skip the certificate check. |
| `transition` | number (ms) | `400` | How long a change from a row or a link takes. |
| `timeout` | number (s) | `5` | One request's limit. |

`home` item settings, `[bar.items."hue/home".settings]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `main_room` | text | unset | The room the tooltip names and whose scenes the popover lists; unset, the room with most lights on. |
| `scenes` | list | `[]` | Scenes in the popover, by name or id, in this order; empty, the main room's. |

## What it does not do

- No scene editing, no naming, no light setup: the Hue app's.
- Entertainment streaming itself (DTLS to the bridge): only start/stop.
- The mDNS browse is best effort: a box without `dns-sd`/`avahi-browse`
  relies on the cloud endpoint or a typed address.

## Tests

`host/test/extensions/hue.test.ts` against `hue-mock.ts`, a bridge over
https with a self-signed certificate that answers the routes above,
feeds the event stream from every PUT, and arms its button on `press()`.
