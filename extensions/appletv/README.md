# Apple TV

A remote for an Apple TV on the same network, spoken directly to the box:
no Home Assistant, no hub, no app on the phone. Seven palettes and a bar
item: the remote under the keys, Now Playing in full, links played on the
TV, the TV's apps at the root, the commands at the root, its users, the
guided pairing, and what plays on the bar.

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

## Now Playing

`Now Playing on Apple TV` (also `n` on the remote, or a click on its card):
the left side sits on the cover's own colour brought down to a deep tone
(the dominant hue of the JPEG, `image.ts`): the cover (wide for a film or a
show), the app, the title, the show with its season and episode or the
artist and album, the year, rating and genre, a line of the synopsis. The
position bar is split at the chapters when the app gives them, each part
filling as it plays, the chapter's name under it. Left and right scrub: each
press moves a target 10 s, 30 s once the key repeats, a minute after that
(shift: a minute, then five), the bar shows where it will land, and one seek
goes when the keys rest 700 ms (Enter: at once). The transport is large
buttons; chips beside them set the speed (`[` `]`), the subtitles and the
audio, like a song (`l`), shuffle and repeat. On the right a panel, Tab to
cycle or its letter: Up Next (`q`, the queue with its pictures, Enter plays
one), Chapters (`c`, Enter jumps), Audio (`a`) and Subtitles (`s`, Enter
picks a track or turns them off), Lyrics (`y`, the line playing lit) and
Info (`i`). What a panel shows is what the app tells the TV: YouTube
gives a title and its channel, the TV app much more.

## Play on Apple TV

A link sent to the TV in one key: a YouTube video (opened in the TV's
YouTube app at its start time), a Netflix title or an Apple TV+ page.
Not yet: a media file over AirPlay (tvOS 26.6 takes the request and never
fetches the file) and Twitch (its app refuses every link form). Wherever
the link is:

- **Copied**: pal reads its own clipboard history every two seconds while
  an Apple TV is paired. A new playable link becomes the offer: the bar
  item comes up for 90 s ("Play on TV: <title>"), the remote shows it as a
  banner (`l` plays, `x` waves it off), and the empty root's Now section
  leads with it for 10 minutes. The entry on the clipboard when pal starts
  is never offered.
- **At the root**: typed or pasted, the `Play on Apple TV` palette answers
  inline with "Play on <TV>".
- **The palette** lists the offer, the browser tab in front when it plays
  something, every link in the clipboard history and what was played
  before, with titles and pictures (YouTube's oEmbed, no key). cmd+Enter
  plays a YouTube link from the start.
- **`pal://appletv/play`**: the `url` given, else the copied link, else the
  browser tab in front; bind it to a key.

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

`playing`: the TV mark (or, with the `artwork` setting, the app's App Store
icon with rounded corners) and what plays, muted while paused (the `paused`
rule), hidden while nothing plays or the TV sleeps (`show = "always"` keeps
the mark). The `when` setting shows it whenever the TV is awake instead. A
link just copied brings it up to offer it. The popover is the remote, laid
out for 420 px.

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
| `pal://appletv/play` | `url`; without it the link just copied, else the browser tab in front |

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
- The connection stays on the LAN; the calls out are the App Store icon
  lookup (by bundle id, once per app) and YouTube's oEmbed for a link's
  title (once per link).

## Tests

`host/test/extensions/appletv.test.ts` runs the extension over the host
against a stand-in TV (`fake.ts`, `PAL_APPLETV_FAKE`: the TV's state a
JSON file, every command a log line). `appletv-protocol.test.ts` covers the
wire: OPACK against pyatv's vectors, the cipher's header and nonce, the
text-input archives, now playing from recorded MRP messages.
