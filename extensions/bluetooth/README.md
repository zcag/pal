# Bluetooth

The paired devices over the core's bluetooth capability, connected ones
first then by name, each with a glyph for its kind (headphones, speaker,
keyboard, mouse, game controller, phone, computer), a `connected` tag and
the battery as the accessory when the OS reports one (AirPods show
`L 80% · R 75% · Case 90%`). The palette is live: the connected state is
read again on every show, so `airpods` at the root tells you whether they
are on before you press anything.

One palette, **Bluetooth** (`bluetooth`). With no adapter the one row
says so.

It also has one interruption-only bar item, **Bluetooth Battery**
(`bluetooth/battery`). It stays out of the bar until a *connected* device
whose battery the OS reports is at or below **Low battery alert** (30% by
default). It names the lowest device and level; amber means low and red
means 15% or below (or the configured level when that is lower). With
several low devices it says `2 low`, while its tooltip carries every name,
level, and AirPods-style per-part detail. Click opens the system Bluetooth
settings; hover opens this Bluetooth palette, so the same complete device
list is available without another scanner. Settings can preview Low,
Critical, and All healthy states without changing the live item.

## Rows

| part | what |
| --- | --- |
| icon | the kind's glyph; a Bluetooth mark (filled when connected) for a kind the table does not know |
| title | the device's name |
| subtitle | the kind (`Headphones`, `Keyboard`, `Game controller`); the address when the kind is unknown |
| accessories | the battery (`62%`, or the per-part levels), then `connected` (green) |
| keywords | the address and the kind, so `keyboard` or `DC:2B` finds the row |

The list is the OS's: connected first, then by name. There are no
sections.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Connect on a device that is not connected; Disconnect (asks first) on one that is |
| `cmd+c` | Copy address: `AA:BB:CC:DD:EE:FF` |

Enter reads the state back from the OS at that moment rather than trust
the row, since the list may have been up a while; the HUD then says
"Connected to AirPods Pro" or "Disconnected AirPods Pro". A connect or
disconnect that fails keeps the panel open with a toast carrying the
OS's message.

An item hotkey toggles one device without showing pal, keyed on the
row's id (the address):

```toml
[palettes.bluetooth.item_hotkeys]
"F4:5C:89:AB:12:01" = "ctrl+alt+h"
```

## Setup

Nothing to install. **Low battery alert** is the only setting; it is the
percentage at which connected, battery-reporting devices become visible on
the bar. The palette itself always lists every paired device.

- **macOS**: the list is `system_profiler SPBluetoothDataType -json`, the
  one unprivileged source with the device type and the battery levels
  (about 80 ms); connect and disconnect are IOBluetooth's own calls, what
  `blueutil` does, so no tool is needed.
- **Linux**: BlueZ over `bluetoothctl` (`devices Paired`, `info`,
  `connect`, `disconnect`), each call time-boxed, and only with an
  adapter under `/sys/class/bluetooth`; without one `bluetoothctl` would
  hang rather than answer empty, so the palette does not ask.

No settings. No permission prompt: reading the paired list and
connecting need nothing beyond the panel on either platform.

## What it does not do

- No pairing and no discovery: the rows are the devices the OS already
  knows; pair a new one in System Settings or `bluetoothctl`.
- No unpairing, no renaming.
- No battery for a device the OS does not report one for (most speakers
  and controllers over classic Bluetooth).
- No radio toggle: turning Bluetooth itself off is the system's.

## Platforms

macOS and Linux. The kind and the battery come from the OS's own data on
both; the per-part battery detail (buds and case) is macOS only, since
that is what `system_profiler` reports.
