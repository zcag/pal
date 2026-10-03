# Samsung TV

A remote for a Samsung TV on the same network, spoken directly to the TV:
no SmartThings account, no hub, no app on the phone. Four palettes and a
bar item: the remote under the keys, the TV's apps at the root, the
commands at the root, and the guided pairing; the app on screen on the bar.
Current Tizen TVs only (2016 on, with token auth); built against a 2024
QE75QN85D.

Three of the TV's own local interfaces, the ones its phone remote uses:

- **The remote websocket** (`wss://<tv>:8002/api/v2/channels/samsung.remote.control`,
  `protocol/remote.ts`): the keys, text into the TV's own keyboard (and
  the events saying it opened), the app list where the TV gives one.
- **REST** (`http://<tv>:8001/api/v2/`, `protocol/rest.ts`): what the TV
  is and whether it is on or in standby, each app's state (installed,
  running, on screen), opening and closing an app.
- **UPnP** (`:9197`, `protocol/upnp.ts`): the volume as a level and mute,
  and what a DLNA sender plays on the TV.

Turning on from off is Wake-on-LAN to the TV's MAC (`protocol/net.ts`).

## Pairing

`Set Up Samsung TV` walks three steps, the one in progress lit along the top:

1. **Find**: the TVs on the network over mDNS (`_samsungmsf._tcp`, and
   `_airplay._tcp` from Samsung, which a 2024 TV answered when the first
   went unheard) and SSDP, with the model and the address. A digit pairs
   one, `i` types an address, `r` looks again.
2. **Allow**: pal opens the remote channel without a token and the TV asks
   "Allow pal?"; press Allow with its remote. The wait counts down from 35 s.
3. **Ready**: pal connects with the token and reads what works from the
   TV itself: the remote, how many apps, the volume, whether it can be
   turned on from off.

The token and the TV's MAC stay in pal's storage (`<data dir>/pal/storage/
samsungtv.json`, `devices`); which TV is current is the `device` setting.
The TV may hand out a new token on a connect; it is kept. `x` forgets one;
remove pal on the TV too under Settings › General › External Device
Manager › Device Connection Manager › Device List. Pressed Deny once? The
TV remembers it there, too.

## The remote

The d-pad on the arrows (each part lights for a moment when its key is
pressed, and a click on it works the same), Enter is OK, Backspace goes
back, `h` is Home, `space` plays or pauses, `,` and `.` rewind and fast
forward, `cmd+left`/`cmd+right` previous and next, `-` and `=` the volume,
`m` mutes, `p` turns the TV off (standby) or on, `i` moves to the next
HDMI input, `[` and `]` the channel, `s` the TV's settings, `g` the guide,
`e` exit, `a` all apps, `d` the next paired TV, `r` reconnects.

The card shows the app on screen with its tile, what a DLNA sender plays
with its position, or that the TV is in standby. The dock is the
`favorites` setting, else the apps opened most, else the usual ones
(YouTube, Netflix, ...), each on a digit, the one on screen dotted. Below
it, the inputs as chips and the volume as a slider.

**Typing.** When the TV shows its own keyboard (a search, a sign-in field
of the TV's), a banner says so and a field opens in the search row by
itself: type, Enter sends the text and submits it, Escape puts the field
away. An app that draws its own keyboard (YouTube does) takes nothing from
here, so typing is only offered while the TV's keyboard is up.

## Controls: driving it from another remote

The TV provides four controls (`docs/design/controls.md`): `volume` (the
level 0..1 and mute), `power` (offered even when the TV is off, as long as
its MAC is known: Wake-on-LAN), `inputs` (Next HDMI, the input menu, TV)
and `player` (the app on screen, or what a DLNA sender plays). Put it in a
group with an Apple TV in Settings › Groups, the volume and the inputs
served by the TV, and the Apple TV's remote sets this TV's volume,
switches its inputs and turns both on. The remote here draws the volume,
power and inputs from what it is served too: in a group with a soundbar
of its own, the slider is the soundbar's.

## The other palettes

- **Samsung TV Apps**: the apps on the TV with their tiles. Enter opens it
  on the TV, cmd+Enter opens it and shows the remote, cmd+D adds it to the
  dock or takes it out, cmd+W closes it. The list is kept per TV, so the
  root finds `youtube` before the TV has answered.
- **Samsung TV** (commands, primary at the root): turn on, turn off, home,
  play or pause, mute, the volume, the next HDMI input, the input menu,
  TV, the TV's settings, the guide, switch to another paired TV, set up.

## The bar item

`tv`: the TV mark and the app on screen (the TV's name when none is),
hidden in standby. Its `when` setting shows it only while an app is on
screen instead. The popover is the remote, laid out for 420 px.

States: `samsungtv/power` (`on`, `standby`, `off`, `unknown`),
`samsungtv/app`.

## Links

| Route | Params |
| --- | --- |
| `pal://samsungtv/key` | `name` (up, down, left, right, select, back, home, menu, exit, play_pause, rewind, forward, volume_up, volume_down, mute, power, channel_up, channel_down, guide, info, or a raw `KEY_` code), `press` (tap, hold) |
| `pal://samsungtv/launch` | `app`: a name or an id |
| `pal://samsungtv/power` | `to`: on, off, toggle |
| `pal://samsungtv/volume` | `level`: up, down, mute, unmute, or 0 to 100 |
| `pal://samsungtv/input` | `to`: hdmi (the next HDMI input), source (the input menu), tv |
| `pal://samsungtv/type` | `text`, into the TV's own keyboard while it is open |

## Settings

| Setting | Default | |
| --- | --- | --- |
| `device` | `""` | The current TV by name; empty: the one paired last |
| `favorites` | `[]` | The dock's apps, by name or id |
| `wake` | `false` | Turn the TV on when the remote opens |
| `stay` | `true` | Keep the connection open for the bar item; off, it closes 90 s after the remote |

## Limits, measured on a 2024 QE75QN85D

- **Apps.** `ed.installedApp.get` answers nothing; the app list is the
  known ids checked one by one over REST (`rest.ts` `CATALOG`), so an app
  that is not in it is not listed. `ed.apps.icon` gives no icon for them:
  each app is its initial on a colour.
- **Opening an app** works over REST only; the websocket's launch, with or
  without a deep link, opened nothing, so links into an app (a YouTube
  video) are not offered.
- **Inputs.** `KEY_HDMI` moves to the next HDMI input and `KEY_SOURCE`
  opens the TV's input menu; the numbered `KEY_HDMI1..4` do nothing. The
  current input is not told.
- **Seeking** is not possible from here; the TV's own remote does it.
- **Turning on from off** needs Power On with Mobile (Settings › General
  › Network › Expert Settings); from standby `p` works always.
- Everything stays on the LAN.

## Tests

`host/test/extensions/samsungtv.test.ts` runs the extension over the host
against a stand-in TV (`fake.ts`, `PAL_SAMSUNGTV_FAKE`: the TV's state a
JSON file, every command a log line), groups and the controls through the
harness. `samsungtv-protocol.test.ts` covers the wire against a local
server playing the TV: REST, UPnP, the websocket with Allow and Deny, the
token, keys, text and the keyboard events.
