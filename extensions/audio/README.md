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

## Rows

| part | what |
| --- | --- |
| icon | headphones for a Bluetooth output, a speaker for any other output, a microphone for an input |
| title | the device's name as the OS reports it |
| subtitle | `Output · bluetooth`, `Input · usb`; the direction alone when the OS gives no transport |
| accessories | `muted` (amber) when muted, the volume (`45%`), `default` (green) for the default of that direction |
| keywords | the direction and the transport, so `bluetooth` or `input` finds the rows |
| section | Output, then Input |

The volume level pushed by Set volume… has one row per preset with the
device's name as the subtitle and a `current` tag on the level the device
is at exactly; its icon is the muted speaker for 0 % and the
loud one for the rest.

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
| `cmd+shift+v` | Set volume…: drills into a level of presets, 0 / 25 / 50 / 75 / 100 %, the current one tagged; a pick sets it and the HUD says so |
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
- No arbitrary level: the presets are the five steps; use the system's
  volume keys for anything in between.
- No AirPlay or Bluetooth pairing from here: the Bluetooth palette
  connects a paired device, the OS pairs it.

## Platforms

macOS and Linux. The transport in the subtitle comes from CoreAudio, so
on Linux the subtitle is the direction alone.
