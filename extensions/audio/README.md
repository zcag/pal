# Audio

Every audio output and input, in two sections, over the core's audio
capability. The default of each direction carries a `default` tag, the
volume is the accessory, a muted device is tagged `muted`; the subtitle
says the direction and, when the OS reports it, the transport
(`bluetooth`, `usb`, `builtin`, `hdmi`). A headset shows once under Output
and once under Input, since it is one device in both directions. The
palette is live: the defaults and volumes are read again on every show,
so `airpods` at the root finds the row with its current volume.

One palette, **Audio** (`audio`). With no audio backend the one row says
which tool is missing.

## Bar items

**Volume** shows where the sound is going: headphones for a Bluetooth output, a
speaker for HDMI or AirPlay, and otherwise a three-step loudness ramp — one more
arc on the same cone each step, with silence drawn as muted, since zero is the
same fact rather than the bottom of the ramp. The glyph slot is a fixed width, so
the arcs appear into space already reserved instead of shoving the neighbours
along.

The level is **not** in the bar by default. It changes only when you change it,
so a percentage sitting there permanently is a number you stop reading; instead
it appears for three seconds after a change as feedback for the thing you just
did, then collapses back to one glyph. `level` picks between that (`flash`),
`always` and `never`; the standing answer either way is the popover, where the
level sits against the device it applies to. Only a change *you* made through the
item flashes it — a poll or a device change must not, or it would be permanent
again by another route. A change made with the keyboard's own volume keys is not
seen until the next poll, and does not flash: that needs a native audio event,
which the core does not have yet.

Click mutes or unmutes; on sketchybar, the wheel moves in 5% steps.

The popover leads with the device in use, on a card: its glyph, its name and what
it is, then a slider a click sets anywhere along it, the level beside it and a
mute switch. Under it the other outputs are rows — a click or Enter makes one the
default — and under those, the input in a single line, muted in red when it is,
so one popover is the whole picture rather than half of it. The cursor opens on
the first row rather than on the card, because the card is already the device you
are on and the rows are the only thing to choose between. `m` mutes, `-` and `+`
move by 5%, the digits `0`–`4` are the 0/25/50/75/100 presets, `p` opens the
Audio palette for the searchable list. A device the backend reports no level for
(an optical out, some interfaces) gets no slider rather than a dead one at zero.

**Microphone** stays out of the way while the default input is usable; it appears
red when that input is muted or absent, and a click restores an available input
to 75%. Its popover is the same shape the other way round: the microphone in use
on the card, the other inputs as rows, the output in the line beneath.
`bar_show_microphone` narrows that to muted alone (a missing input stays
quiet) or keeps the strip up always, the live microphone as a muted glyph
whose click opens the popover. Both poll every five seconds until the core
has a native audio-change event. Their Bar settings offer representative
mock states.

Settings, `[extensions.audio]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `level` | select | `flash` | Where the percentage lives: `flash` for three seconds after a change, `always`, or `never`. |
| `bar_show_volume` | `auto` / `always` | `auto` | When the Volume strip is drawn: with an output device in use, or always (a muted glyph without one). |
| `bar_show_microphone` | `auto` / `muted` / `always` | `auto` | When the Microphone strip is drawn: muted or missing, muted only, or always (a live mic is the glyph alone, muted, its click opening the popover). |

## Rows

| part | what |
| --- | --- |
| icon | headphones for a Bluetooth output, a speaker for any other output, a microphone for an input |
| title | the device's name as the OS reports it |
| subtitle | `Output · bluetooth`, `Input · usb`; the direction alone when the OS gives no transport |
| accessories | `muted` (amber) when muted, the volume (`45%`), `default` (green) for the default of that direction |
| keywords | the direction and the transport, so `bluetooth` or `input` finds the rows |
| section | Output, then Input |

A device with a volume control carries one field in the bar, the percent
(argument `volume`); only Set volume reads it, Enter and Mute run as they
are. A pick without the field (a hotkey, a bare `pal run`) asks for it in
a form, and anything but 0 to 100 comes back on the field.

A hotkey can open the palette straight away, and an item hotkey can make
one device the default without showing pal, keyed on the row's id
(`output:<uid>` or `input:<uid>`):

```toml
[palettes.audio]
hotkey = "ctrl+alt+a"

[palettes.audio.item_hotkeys]
"output:BuiltInSpeakerDevice" = "ctrl+alt+s"
```

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Set as output / Set as input: makes the row the default for its direction; the HUD names it |
| `cmd+shift+v` | Set volume: the percent typed in the bar (argument `volume`) goes to the device; the HUD says so |
| `cmd+m` | Mute / Unmute: toggles mute and stays in the list |

A digital output without a volume control has no volume accessory and no
Mute action. A setter that fails keeps the panel open with a toast
carrying the backend's message.

## Setup

Nothing to configure and nothing to install on macOS.

- **macOS**: the CoreAudio HAL, in-process. The device's UID is its id
  (stable across replugs); the volume is the virtual main volume the menu
  bar slider moves, with the per-channel scalar for a device without one.
- **Linux**: `wpctl` (PipeWire), else `pactl -f json` (PulseAudio 16 or
  later). With neither the palette is one row naming the missing tool.

No settings. Nothing beyond the panel: no permission prompt on either
platform.

## What it does not do

- No per-app volume, no balance, no sample rate: the capability exposes
  the default, the main volume and mute of each device, nothing finer.
- No AirPlay or Bluetooth pairing from here: the Bluetooth palette
  connects a paired device, the OS pairs it.

## Platforms

macOS and Linux. The transport in the subtitle comes from CoreAudio, so
on Linux the subtitle is the direction alone.
