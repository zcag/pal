# DPI Bypass

The `dpi` script's censorship bypass as a toggle with an indicator. The
script (`~/.local/bin/dpi`) is the engine: on macOS it runs byedpi as a
SOCKS proxy and points the active network service's DNS and SOCKS proxy
at it, remembering what to restore; on Linux it starts zapret and
dnscrypt-proxy under systemd. pal runs `dpi on`, `off`, `toggle`,
`status` and `build`, and draws what the script says. Nothing of byedpi
or the network settings lives here.

## The palette

| row | Enter |
| --- | --- |
| Turn on bypass / Turn off bypass | Runs the script; the panel hides and the HUD says its line (`dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)`). In the root's Now section while on. `cmd+t` tests, `cmd+c` copies the status, `cmd+shift+r` repairs while partial. |
| Repair bypass | Only while the status is partial: off, then on. |
| Status: on / off / partly on | The facts in the detail pane (proxy, service, DNS, SOCKS; the units and the DNS probe on Linux) and the script's output; Enter copies it. |
| Test the bypass | The test level (below). |
| Open the log | `~/Library/Logs/dpi.log`, byedpi's output; inert until the first `dpi on` writes it. macOS. |
| Build byedpi | `dpi build` (a clone and a make, minutes), asked first; the HUD says when it landed. macOS. |
| Copy the status | `dpi status`, as printed. |

Without the script the palette is one row saying where it lives, and
Enter opens the `tool` setting. A status the script cannot give (no
default route) is one row with its complaint; Enter reads again.

**Partial.** The status is judged from `dpi status`: on macOS the byedpi
process, the service's SOCKS proxy pointing at `127.0.0.1:<port>` (the
port the script prints) and its DNS set to the override (`dns`, the
script's `1.1.1.1 9.9.9.9`) are the three halves; all three is on, none
is off, anything else is partial with the reason (`Proxy up (pid 4242),
but SOCKS off and DNS not overridden`; a proxy that died under a service
still pointed at it reads the other way round). On Linux every unit
active is on unless the probe of a known-blocked name still answers the
block page (`195.175.254.2`); one unit down is partial. Partial is amber
everywhere and gets the Repair row.

**Timing.** `dpi on` and `off` take about five seconds on macOS
(Tailscale's DNS bounce and the script's sleeps) and the shell gives a
pick ten. A switch is waited for up to seven seconds and the HUD says the
script's line; past that the HUD says it is under way and the line lands
when the script finishes. The status is cached five seconds; a switch
drops it.

## The test

`Bypass Test` is the script's `dpi test` run here so the rows land one by
one: one curl per url, all at once, the script's shape (`-s -o /dev/null
-w '%{http_code}' --max-time 12`, through `socks5h://127.0.0.1:<port>` on
macOS while the proxy is up, direct otherwise). Each row is the host with
its url, a `blocked` or `control` badge, the HTTP code as a badge (green
for 2xx/3xx, amber for 4xx/5xx, red for `000`: a drop, a timeout, a
refusal) and the time. The header sums both halves: `2 blocked reach, 4
controls fine`, or what failed by host (`1 of 2 blocked reach (roblox.com
blocked), 3 of 4 controls fine (enpara.com broken)`); a control that
answered 4xx or 5xx counts as reached (the wire is fine, the site is not).
Opening the level runs the test; `cmd+r` runs it again; the arrows (`j`,
`k`) move the ring, Enter opens the url, `c` copies its line, `cmd+c` the
report.

`test_urls` lists what is tried: `url`, or `url = blocked` / `url =
control`; a url without a role takes the position's, the first two
blocked and the rest controls, as the script's own list reads. The
default is the script's six: discord and roblox as blocked, enpara,
raycast, slack and example.com as the controls OOB is known to break.

## The bar item

`dpi/bypass`: a shield while the bypass is on, hidden while off by its
`off` rule (`[bar.items."dpi/bypass"] show = "always"` keeps a muted
shield with the same popover), amber by its `partial` rule. The popover:
the status card with the facts, Enter turns it on or off (the popover
closes, the HUD says the line), `t` runs the test and its rows land in
the popover under the card (forgotten when the popover closes), `r`
repairs, `c` copies the status, `l` opens the log (macOS), `o` the
palette. Refreshed every minute and on `show`, `wake` and `network`.

States: `dpi/on` (on or partly on), `dpi/state` (`off`, `on`,
`partial`), `dpi/service` (the network service on macOS, the units on
Linux).

## Links

- `pal://dpi/toggle`, `pal://dpi/on`, `pal://dpi/off`: the switch, the HUD
  its line (`pal call dpi/toggle` from a shell).
- `pal://dpi/test`: the panel on the test level, the test running.
- `pal://dpi/status`: the palette.

## Linux

The script's `on` and `off` are `sudo systemctl`. Before either, `sudo -n
true` is probed (it never prompts): a closed credential window is a toast
saying to run `sudo -v` in a terminal first, and nothing runs; with the
window open the switch goes through. `dpi status` needs no root. No log
row (the units log to the journal) and no build row (zapret is packaged).

## Settings

| key | default | what |
| --- | --- | --- |
| `tool` | `dpi` | The script: a name on PATH (the login shell's, which pal adopts) or a path; `~/.local/bin` is looked in when the name is not on PATH |
| `test_urls` | the script's six | What the test curls, `url` or `url = blocked|control` |
| `dns` | `1.1.1.1`, `9.9.9.9` | The resolvers `dpi on` sets on macOS, to tell a full bypass from a partial one; empty leaves DNS unjudged |

For the tests: `PAL_DPI_OS` (`darwin` or `linux`) picks the platform,
`PAL_DPI_CURL` a stand-in for curl, `PAL_DPI_LOG` where the log is looked
for.
