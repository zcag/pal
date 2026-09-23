# Stats

CPU, memory, disk, network and load as bar items, each its own item that
stays off the strip until it has something to say, with a popover of the
breakdown; the same facts as rows in a `Stats` palette; `pal://stats/<item>`.

## Sources and what they cost

One sampler runs every `interval` seconds (3 by default, from the first
render on) and pushes all five items with `bar.update`; the core diffs, so
a strip that did not change costs nothing past the check. Measured on an
M5 Max (18 cores, ~1100 processes), per call:

| fact | macOS | Linux | cost |
| --- | --- | --- | --- |
| CPU, total and per core | `os.cpus()` times, the delta between two samples | the same | 0.01 ms |
| load averages, uptime | `os.loadavg()`, `os.uptime()` | the same | 0 |
| memory | `vm_stat` (Activity Monitor's arithmetic: app = anonymous less purgeable, used = app + wired + compressed, cached = file-backed + purgeable) and `sysctl -n hw.memsize vm.swapusage kern.memorystatus_vm_pressure_level` | `/proc/meminfo` (used = total less available, cached = page cache + buffers + reclaimable slab) and `/proc/pressure/memory` (PSI: warn from `some avg10` 10%, critical from `full avg10` 5%) | 1 ms + 1 ms |
| network throughput per interface, with its IPv4 | `netstat -ibn` (the Link row's counters, the inet row's address) | `/proc/net/dev`, the addresses from `ip -j -br addr` every 30 s | 1.5 ms |
| volumes | `df -kP` and `mount`, every 60 s | `df -kP` and `/proc/mounts`, every 60 s | 1 ms + 3 ms |
| top processes | `ps` (the SDK's `listProcesses`), every 10 s, and every tick while the CPU or Memory popover is open | the same | 22 ms |

So a tick is about 5 ms every 3 s with nothing open, 27 ms with a process
popover up. No root anywhere. **No temperature**: on macOS the sensors
need a native reader (IOKit's HID sensor services on Apple silicon, the
SMC on Intel), which the host has none of, and `powermetrics` needs root;
the Battery extension shows a temperature when the optional `power`
watcher's state file carries one. On Linux `/sys/class/thermal` would do
without root; not read yet.

What Linux lacks: the memory segments are two (used and shared) rather than
Activity Monitor's four, and there is no compressed figure; the startup
volume is named `/`; the Wi-Fi interface is told apart from a cable only
where `nmcli` answers the core's `wifi.status()`.

## The items

Each item renders its facts as states (below) and leaves presence and
colour to the manifest's rules, which Settings > Bar shows per item and the
user edits by id (`[bar.items."stats/cpu".rules.quiet] when = "..."`):

| item | strip | hidden while (`quiet`) | amber | red |
| --- | --- | --- | --- | --- |
| `cpu` | `42%`, or `▂▃▅▇▆` (last eight samples), one bar per core, `42% · node` (its `label`) | `stats.cpu < 70` | from 70% | from 90% |
| `memory` | `63%`, `24.2 GB`, `14.4 GB free`, or the sparkline (its `label`) | under 80% and the kernel reports no pressure | from 80%, or pressure `warn` | from 90%, or pressure `critical` |
| `disk` | the startup volume's free space, share or used (its `label`) | over 20 GB free and every writable volume under 85% | from 85% used or 20 GB free | from 95% or 5 GB |
| `network` | `↓1.2M ↑80K`, `↓1.2M`, or the download sparkline (its `label`) | under 1 MB/s either way | (blue from 10 MB/s) | |
| `load` | `3.26`, or all three (its `label`) | the 1 minute load under the core count | from the core count | from twice it |

Two ways to keep an item on the strip at rest: `[bar.items."stats/cpu"]
show = "always"` draws the same figure muted (the core's `empty` shape), or
override the `quiet` rule (`when = "false"`, or turn Hidden off in Settings
> Bar) and it stays in colour. `enabled = false` takes it off entirely. An
icon-only item is the core's `show_title = false`.

The popovers (`view.ts`, laid out for the 420 px popover), each with a
sparkline of the last 60 samples as an SVG `image` in the theme's tag ink
(the `theme` state picks light or dark; a shade that reads on both when it
is unknown) and a keycap hint row; `up`/`down` (or `j`/`k`) move the ring, a
click on a row moves it too, `s` opens the Stats palette:

- **CPU**: the share, the level badge, cores / load / uptime, the
  sparkline, one bar per core in two columns, the five busiest processes
  (cpu and memory columns); `Enter` Activity Monitor (the Processes
  palette on Linux), `x` kills the focused one (asks first), `c` copies the
  share, `p` the Processes palette.
- **Memory**: the share, the pressure badge, used of total and swap, the
  segments bar (app blue, wired violet, compressed amber, cached grey,
  free outlined) with a legend, the sparkline, the five largest processes;
  the same keys.
- **Disk**: the free space on the focused volume, then a card per volume
  (name, a `read-only` badge for a mounted image, free space in the
  level's colour, a bar, the mount point, used of total); `Enter` reveals
  it in Finder (`open` on the mount point), `c` copies the path.
- **Network**: the two rates large, a busy / active / quiet badge, both
  lines in one sparkline, then every interface that counts, has an
  address or moved a byte (the Apple-private `awdl`/`anpi`/`llw` ones
  only when they did), with its kind (Wi-Fi with the SSID from the core's
  `wifi.status()`, VPN for a tunnel), address and rates; `Enter` opens the
  Network palette (every address, the public IP), `c` copies the focused
  address. The totals count the physical links only (`en*`, `eth*`,
  `wl*`, ...), so a VPN's bytes are not counted twice.
- **Load**: the three averages as tiles coloured by their share of the
  cores, the per-core figure, the sparkline scaled to the core count.

## The palette

`Stats` is live (listed on every show from the last sample, no tool
runs; `⌘R` samples now). Sections: Processor (CPU, load), Memory (memory,
swap), Disks (a row per volume, `free` as the name), Network (a row per
interface, then the totals), Busiest processes, Largest processes (five
each), System (uptime). The value is the row's name and `Enter` copies it
(a volume's mount point, an interface's address, a process's pid);
`⌘O` Activity Monitor, `⌘P` the row's bar popover, `⌘R` reveals a volume,
`⌘A` the Network palette, `⌘⌫` kills a process (asks first). The detail
pane has the sparkline and every figure. A push with `args: { section }`
(what `pal://stats/cpu?palette=1` and the popover's `s` do) lists that
section's rows only.

## Links and states

`pal://stats/cpu`, `memory`, `disk`, `network`, `load` open the item's
popover (through `pal://bar/stats/<item>`); `?palette=1` opens the palette
on that section instead.

States, all `stats/<name>`: `cpu` (percent), `cpu_top` (the busiest
process's name), `cores`, `memory` (percent), `memory_pressure`
(`normal` / `warn` / `critical`), `swap` (percent of the swap total),
`disk` (the startup volume's percent used), `disk_free` (GB), `disk_worst`
(the fullest writable volume's percent), `net_down` and `net_up` (KB/s),
`load1`, `load5`, `load15`. A rule of your own reads them like the
manifest's (`stats.net_down >= 51200`).

## Settings, `[extensions.stats]`

| key | type | default | what |
| --- | --- | --- | --- |
| `interval` | number | 3 | Seconds between samples (1..60). |
| `disk_hide` | list | `[]` | Mount points or volume names left out of the item and the palette. |

Each item's own settings, `[bar.items."stats/<item>".settings]` (Settings › Bar, on the item's pane): one key, `label`, what the strip says.

| item | `label` | default | what |
| --- | --- | --- | --- |
| `cpu` | `percent` / `spark` / `bars` / `top` | `percent` | The share, a sparkline, one bar per core, or the share and the busiest process. |
| `memory` | `percent` / `used` / `free` / `spark` | `percent` | The share, the used or free size, or a sparkline. |
| `disk` | `percent` / `free` / `used` | `free` | The startup volume's share, free or used size. |
| `network` | `rate` / `down` / `spark` | `rate` | Both rates, the download rate, or its sparkline. |
| `load` | `one` / `three` | `one` | The 1 minute average, or all three. |

## Tests

`host/test/extensions/stats.test.ts`: the parsers on canned `vm_stat`,
`sysctl`, `df -kP`, `mount`, `netstat -ibn`, `/proc/meminfo`,
`/proc/pressure/memory`, `/proc/net/dev`, `/proc/mounts` and `ps` output;
the level and colour logic; the five popovers through `checkView` on
fixtures; the extension in the host against the real machine (shapes, not
numbers); the label settings; the popover keys; the palette's rows, picks
and section argument; the links; the loop's pushes.
