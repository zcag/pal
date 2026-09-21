# Network

This machine's addresses, one row per value: the value is the row's name
so it reads at a glance, the label is the subtitle, `enter` copies. Live,
listed again when the panel shows and the last listing is over a minute
old; `cmd+r` lists now. The palette opens with the detail pane showing.

## The rows

| section | rows | from |
| --- | --- | --- |
| This machine | every interface's IPv4 and global IPv6 addresses (loopback and link-local left out), the Wi-Fi one labelled with its SSID; the Tailscale IPv4 and IPv6; the hostname; the Bonjour `.local` name on macOS | macOS: `ifconfig`, `networksetup -listallhardwareports` (the kind), `ipconfig getsummary <dev>` (SSID, security); Linux: `ip -j addr`, `iw dev`; `tailscale ip` where the CLI is on PATH (or the Tailscale.app binary on macOS); `os.hostname()`, `scutil --get LocalHostName` |
| Internet | the public IP, with the city, country and organisation when the endpoint gives them | one GET of `public_ip_url` with a 3 s timeout, kept 10 minutes (`cmd+r` fetches again; a failure is not kept); JSON with `ip` (ipinfo), `query` (ip-api) or `connection.isp` (ipwho.is) shapes, or a bare address |
| Network | the default gateway with its interface; the DNS servers in resolver order | macOS: `route -n get default`, `scutil --dns`; Linux: `ip -j route show default`, `/etc/resolv.conf` (behind systemd-resolved's stub, `resolvectl dns`) |

Every tool runs with a 3 s timeout and a missing one just leaves its rows
out. The tunnel interface carrying the Tailscale addresses (`utun4`,
`tailscale0`) is folded into the Tailscale rows. When nothing has an
address, or there is no route, an inert row says so; the public IP row
says why when the fetch fails.

Keywords make the rows findable from the root: `wifi`, `lan`, `ip` for an
interface address, `public`, `wan`, `external` for the public IP,
`gateway`, `router` for the route, `dns`, `nameserver` for a resolver,
`tailscale`, `vpn` for those.

The detail pane lists every field of the row: interface, kind, SSID,
security, IPv4, IPv6, MAC and status for an address; city, region,
country, organisation and when it was fetched for the public IP; the
resolver order for a DNS server.

## Bar item

**Network status** reads the interface carrying the default route every five
seconds (and on wake/network events). The glyph is the whole message on Wi-Fi:
four levels of signal strength, or its own mark for a hotspot, an open network
or a wired link, and a red one when there is no default route. Beside it the
network's name, unless **Icon only** is set — then the glyph stands alone and
hovering gives the name, the address, the signal and the gateway. Click opens
Network Settings, while the popover opens this palette.

`networks` is one line per network, `SSID = kind label:Name icon:X`, keyed
on the SSID or on the gateway (neither alone is enough, since macOS redacts
the name, see below, and a cable into the same router has no name at all, so
`192.168.1.1 = ...` reaches both). The fields are keyed rather than
positional: any subset in any order reads the same and a line with only an
icon needs no placeholders. A bare word is the kind, `label:` gives the strip
a friendlier name (the palette always retains the real SSID; a name with a
space goes in quotes, `label:"Cafe Corner"`), `icon:` is one emoji or a Nerd
Font glyph pasted in (the Icons palette copies one; the bar draws the bundled
Symbols Nerd Font). Each field comes from the first matching line that sets
it, so an SSID line and a gateway line for the same router can split the work.

```
192.168.1.1 = hide icon:󰋜
Cafe Wifi = hotspot label:Cafe icon:☕
marvin = icon:📱
```

| kind | what it does |
| --- | --- |
| `hide` | The item is not drawn. For the network you are on almost all the time: it can tell you nothing you do not already know from the room you are in, so its *absence* is what carries information; the item appearing at all means you are somewhere else. |
| `hotspot` | Marks a link whose data costs money. A name containing `iphone`, `android`, `hotspot` or `tether` is taken as one without being configured. |
| `public` | Marks one not to be trusted. A network with no security is marked that way on its own. |

The icon stands in for the signal, hotspot, open or wired mark on the strip,
and on that interface's rows in the palette; the tooltip then carries
`hotspot` or `open network` where the glyph would have said it, and the
popover's badge still names the kind. The label replaces the SSID, and on a
cable the kind, since a gateway-keyed line reaches both. Settings includes
Wi-Fi, weak, hotspot, open, icon-only, wired and offline preview states.

The older `ssid_labels` (`SSID = label`) and `network_icons` (`SSID = glyph`)
lists still work this release: they are folded into the table after the
`networks` lines, so a `networks` line wins for the field it sets, and their
presence is logged once as deprecated. Move them onto `networks` lines; the
keys go away next release.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Copy the value |
| `cmd+enter` | Open Network settings: the Network pane of System Settings on macOS; on Linux the first of `gnome-control-center network`, `systemsettings kcm_networkmanagement`, `nm-connection-editor` installed |
| `cmd+i` | Hide or show the detail pane (open by default here) |
| `cmd+r` | List again, and fetch the public IP again |

## Setup

Nothing to install: the rows come from the OS's own tools. `tailscale` on
PATH (or Tailscale.app) adds the Tailscale rows.

**The SSID on macOS**: since Sonoma the system redacts the network name
for a process without Location Services access (`ipconfig getsummary`
prints `<redacted>`, `networksetup -getairportnetwork` says not
associated), and pal's own grant does not reach the tools it runs, so the
summary is followed by a read through the core's wifi capability
(CoreWLAN, in-process). That read also carries the signal strength, which
needs no grant at all; the name it has only once pal holds Location
access: the Wi-Fi palette asks for it the first time it lists,
and Settings > General > Permissions has the button. Without it the Wi-Fi
row is labelled by kind (`en0 · Wi-Fi`) and the detail pane says what is
missing; everything else works without it.

The public IP is one request to `public_ip_url` (ipinfo.io by default);
set it empty for no Internet section and no request at all.

Settings, `[extensions.network]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `public_ip_url` | text | `https://ipinfo.io/json` | The endpoint the public IP row asks. Empty: no Internet section. `https://api.ipify.org` (a bare address) and `http://ip-api.com/json` work too. |
| `networks` | list | `[]` | One line per network, `SSID = kind label:Name icon:X` (or `gateway = ...`); each field optional, any order. Kind is `hide`, `hotspot` or `public`; the label is the bar's name; the icon is one emoji or a Nerd Font glyph drawn instead of the signal, hotspot, open or wired mark. The old `ssid_labels` and `network_icons` lists are still read this release. |
| `icon_only` | boolean | `false` | Drop the name from the bar item and let the glyph speak. |

## What it does not do

- Flush DNS: on macOS it is `dscacheutil -flushcache; killall -HUP
  mDNSResponder`, which needs sudo, and the host has no way to ask for a
  password; run it from a terminal.
- Change anything: no joining, no interface toggles; Open Network
  settings hands that to the OS. Wi-Fi networks are the Wi-Fi extension's.
- Speed tests, ping, port scans: only what the machine already knows
  about itself, plus the one public IP request.
- Watch for changes: the rows are as of the last listing, a minute old at
  most when the panel shows.

## Platforms

macOS and Linux, with the platform's own tools as in the table above. The
Bonjour `.local` name and the SSID redaction are macOS only; the
`resolvectl` path is for a Linux behind systemd-resolved.
