# Apple TV

A remote for an Apple TV on the same network, spoken directly to the box:
no Home Assistant, no hub, no app on the phone. Five palettes and a bar
item: the remote under the keys, the TV's apps at the root, the commands at
the root, its users, the guided pairing, and what plays on the bar.

Two of Apple's protocols, the ones the iPhone's own remote uses:

- **Companion** (`_companion-link._tcp`, `protocol/`): the buttons (HID),
  swipes and taps on the touch surface, the apps (list and launch), the
  users, sleep and wake with the power state as events, the volume as
  the TV set reports it over HDMI-CEC, and the text field the TV shows
  (read, set, append, clear). Ported from pyatv: OPACK with its
  back-references, the encrypted frames, the session handshake.
- **MRP over AirPlay** (`_airplay._tcp`, `protocol/mrp.ts` on
  node-appletv-remote's AirPlay connection): what plays (title, artist,
  album, show and episode, the app, the position, the cover) and the
  transport that needs it (seek, shuffle, repeat, chapters). Optional:
  the remote works without it.

## Pairing

`Set Up Apple TV` walks four steps, the one in progress lit along the top:

1. **Find**: the Apple TVs on the network over mDNS (both services, merged
   by host), with the model as people say it ("Apple TV 4K (3rd
   generation)"), the address and the tvOS version. A digit pairs one, `i`
   types an address, `r` looks again.
2. **Remote**: the TV shows a four-digit code (HAP pair-setup over
   Companion); type it in the field and press Enter. A wrong code says so
   and the TV shows a new one by itself.
3. **Now playing**: a second code, for AirPlay. `s` skips it.
4. **Ready**: pal connects and reads what works from the TV itself: the
   remote, how many apps, typing, the volume (or that the TV set does not
   report one), what plays, the users.

The long-term keys stay in pal's storage (`<data dir>/pal/storage/
appletv.json`, `devices`); which Apple TV is current is the `device`
setting. `x` forgets one; remove pal on the TV too under Settings ›
Remotes and Devices › Remote App and Devices.

No code appears? On the Apple TV, Settings › AirPlay and HomeKit › Allow
Access should be "Everyone on the Same Network" (or "Anyone"), not "Only
People Sharing This Home".

## The remote

The clickpad on the arrows (each part lights for a moment when its key
is pressed, and a click on it works the same), Enter selects (`shift+enter`
holds it for the context menu), Backspace goes back, `h` is the TV button
(`tab` double-presses it: the app switcher; `c` holds it: Control
Center), `space` plays or pauses, `,` and `.` skip by the `skip` setting,
`cmd+left`/`cmd+right` previous and next, `-` and `=` the volume, `p` sleep
or wake, `s` the screen saver, `u` the users, `d` the next paired Apple TV,
`r` reconnects. Shift and an arrow swipes.

The card shows what plays with its cover and a seek bar a click moves, or
what the TV is doing (asleep, the screen saver, the app in front). The
dock is the `favorites` setting, else the apps opened most, each on a
digit. When the TV shows a keyboard, a banner says what it is asking for;
`t` opens a field in the search row and Enter types it into the TV.

Everything the TV tells (a new item, a pause, sleep, a keyboard) pushes a
new tree into the open remote and the bar popover; a playing item's
position ticks every second while one is open.

## The other palettes

- **Apple TV Apps**: every app with its icon (the App Store's for third-
  party apps, looked up once by bundle id at `itunes.apple.com/lookup`;
  Apple's own drawn from their marks). Enter opens it on the TV, cmd+Enter
  opens it and shows the remote, cmd+D adds it to the dock or takes it out.
  The list is kept per Apple TV, so the root finds `netflix` before the TV
  has answered.
- **Apple TV** (commands, primary at the root): play or pause, wake, sleep,
  home, Control Center, the screen saver, skip, next and previous, the
  volume, `Type on Apple TV` (Tab, then the text), switch user, switch to
  another paired Apple TV, set up. While something plays, the empty root's
  Now section has a row for it.
- **Apple TV Users**: the people signed in on the TV; Enter switches.

## The bar item

`playing`: the app's icon (or the TV mark) and what plays, muted while
paused (the `paused` rule), hidden while nothing plays or the TV sleeps
(`show = "always"` keeps the mark). The `when` setting shows it whenever the
TV is awake instead. The popover is the remote, laid out for 420 px.

States: `appletv/power` (`on`, `off`, `screensaver`, `unknown`),
`appletv/playing`, `appletv/app`, `appletv/title`.

## Links

| Route | Params |
| --- | --- |
| `pal://appletv/key` | `name` (up, down, left, right, select, menu, home, play_pause, volume_up, volume_down, sleep, wake, screensaver), `press` (tap, double, hold) |
| `pal://appletv/launch` | `app`: a name, a bundle id, or a url the app handles |
| `pal://appletv/power` | `to`: on, off, toggle |
| `pal://appletv/type` | `text`, `append` |
| `pal://appletv/media` | `command` (play_pause, play, pause, next, previous, skip_forward, skip_backward, seek), `value` (seconds) |
| `pal://appletv/volume` | `level`: up, down, or 0 to 100 |

## Settings

| Setting | Default | |
| --- | --- | --- |
| `device` | `""` | The current Apple TV by name; empty: the one paired last |
| `favorites` | `[]` | The dock's apps, by name or bundle id |
| `skip` | `10` | Seconds a skip moves |
| `wake` | `true` | Wake the Apple TV when the remote opens |
| `stay` | `true` | Keep the connection open for the bar item; off, it closes 90 s after the remote |

## Limits

- The volume is the TV set's, over HDMI-CEC or eARC; a set that does not
  report it gets the buttons only.
- An app decides what it tells: some give no cover (YouTube), some no
  position.
- Typing needs a text field the TV is showing (a search, a sign-in).
- The connection stays on the LAN; the one call out is the App Store
  icon lookup, by bundle id, once per app.

## Tests

`host/test/extensions/appletv.test.ts` runs the extension over the host
against a stand-in TV (`fake.ts`, `PAL_APPLETV_FAKE`: the TV's state a
JSON file, every command a log line). `appletv-protocol.test.ts` covers the
wire: OPACK against pyatv's vectors, the cipher's header and nonce, the
text-input archives, now playing from recorded MRP messages.
