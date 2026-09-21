# Wi-Fi

The network the machine is on, the saved ones and what is in range, over
the core's wifi capability, in sections Current, Known and Available,
plus a Wi-Fi row that turns the radio off or on. The palette is live:
read again on every show.

One palette, **Wi-Fi** (`wifi`).

## Rows

| section | row | subtitle | right side |
| --- | --- | --- | --- |
| Current | the network you are on | the IP, channel and security (`192.168.1.42 · channel 44 · WPA3 Personal`) | the signal (`▂▄▆█ 92%`) and a `connected` tag |
| Known | every saved network, in the OS's preference order | the security and channel when a scan sees it, else `Saved` | its signal and an `in range` tag when a scan sees it |
| Available | what the last scan found that is not saved | the security (`Open` for none) and the channel | the signal |
| Available | **Scan for Networks** (macOS, or when names are hidden) | how old the last scan is, and how many nearby networks have their names hidden | |
| Wi-Fi | **Wi-Fi names need Location access** (macOS, access refused) | where the switch is | |
| Wi-Fi | **Turn Wi-Fi Off** / **Turn Wi-Fi On** | the interface (`en0`) | |

A secured network in range has a lock as its icon, an open one the Wi-Fi
glyph. With the radio off only the Wi-Fi row is listed. Without a Wi-Fi
interface, or with no backend, the one row says so.

## Keyboard

| keys | action | on |
| --- | --- | --- |
| `enter` | Join: a saved or open network at once; a secured network that is not saved has a masked Password field in the search bar (Tab into it, type, Enter), asks for it in a form when the field is left empty, and a refused join shows the form with the tool's message | a known or available row |
| `cmd+shift+c` | Copy password: the saved password onto the clipboard | the current row and known rows |
| `cmd+c` | Copy IP: the interface's IPv4 address | the current row |
| `cmd+c` | Copy name: the network's name | a known or available row |
| `ctrl+x` | Forget: removes the saved network, after a confirm ("Forget X? Its password goes with it.") | the current row and known rows |
| `enter` | Scan: a fresh scan, then the list again | the Scan row |
| `enter` | Turn off / Turn on: the radio | the Wi-Fi row |
| `enter` | Open System Settings: the Location Services pane | the Location row |

Forget and the power toggle keep the palette open and list again; a join
that succeeds hides pal with "Joined X" in the HUD.

## Setup

Nothing to configure and nothing to install.

- **macOS**: CoreWLAN in-process for the interface, the radio, the
  current link (name, signal, channel, security) and a scan;
  `networksetup` for the preferred list, join, forget and the radio
  switch; `ipconfig getsummary` for the IP; `security
  find-generic-password -wa <ssid>` for a password (the keychain prompts,
  and that dialog is yours to answer). A scan takes several seconds, so
  Available shows the last one (kept for a minute) and the Scan for
  Networks row runs a fresh one.
- **Linux**: NetworkManager over `nmcli -t` (`device wifi list`, which
  answers from NetworkManager's own scan cache, so Available lists at
  once; `connection show` for the saved ones; `device wifi connect`;
  `connection delete`; `radio wifi`; `-s -g 802-11-wireless-security.psk`
  for a password).

**Location Services on macOS.** macOS 15 and later show network names
only to an app with Location Services, so the first time the palette
lists with the names withheld it asks, once (the system prompt; nothing
asks at first run). Say yes and the next listing has the names. Until
then the current row reads "Connected network" with its IP and channel
and says the name is hidden, and the Scan row counts the nearby networks
whose names are hidden instead of listing them. A refusal is a row,
**Wi-Fi names need Location access**, whose `enter` opens Privacy &
Security > Location Services; Settings > General > Permissions has the
same button.

No settings.

## What it does not do

- No hidden-SSID join: a network that does not broadcast its name is not
  in the scan, and the palette has no "other network" form.
- No enterprise credentials: an `802.1X` network that needs a username as
  well as a password joins only when the OS already has its profile.
- No password for a network the OS keeps outside the keychain or
  NetworkManager's store.
- No signal history or channel graph: the signal is the number at the
  time of the last scan.
- No `wdutil` fallback for a withheld name on macOS: it needs sudo, and
  the host has no way to ask for a password; Location access is the way.

## Platforms

macOS and Linux. The Scan row exists on macOS always (a scan is slow
there) and on Linux only when the OS reports hidden names, which
NetworkManager does not; on Linux Available comes from NetworkManager's
cache at once.
