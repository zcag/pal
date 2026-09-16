# SSH Hosts

Every `Host` in `~/.ssh/config` that is a name rather than a pattern (`*`,
`?` and `!` entries are skipped, a `Host a b` line gives two rows), in file
order. `Include` lines are followed one level: `~`, absolute and globbed
operands work, a relative one is under `~/.ssh`. A `Match` block ends the
current host. The section is the file a host came from, relative to the
config's directory (`.ssh/config`, `.ssh/conf.d/work.conf`).

## The palette

The row is the host's name; `HostName` is the subtitle and a keyword, so
the real name finds the alias from the root; `User` is an accessory and a
keyword, `Port` a `:22`-style tag. A host with `ProxyJump` carries a `via
<jump>` tag and the jump as a keyword. The detail pane (`cmd+i`) has the
command and every field of the block. The palette is indexed: listed
once, searched from the root, refreshed with `cmd+r` after the config
changes. A config with no named host lists one row saying so.

With `include_known_hosts` on, the names in `~/.ssh/known_hosts` (next to
the config) come after, in a last Known hosts section: `[host]:port`
unwrapped, comma lists split, hashed lines, bare IPs and hosts already in
the config skipped.

Connect opens a terminal window running `ssh <host>` and hides the panel.
Ping sends one echo to the `HostName` (else the name) with a 2 s wait and
toasts the round trip (`web-1.example.com: 3 ms`), or why it did not
answer; the panel stays open.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Connect: a terminal window running `ssh <host>` |
| `cmd+c` | Copy host: the name as written in the config |
| `cmd+shift+c` | Copy ssh command: `ssh <host>` |
| `cmd+shift+j` | Copy ssh -J command: `ssh -J <jump> <host>` (only on a host with a `ProxyJump`) |
| `cmd+p` | Ping: one echo, the round trip as a toast |
| `cmd+r` | Refresh: read the config again |

The plain command already goes through the config's `ProxyJump`; the `-J`
form is for a machine that does not have your config.

## Setup

An `~/.ssh/config` with `Host` entries; `ssh` and `ping` on PATH. Nothing
else.

Which terminal Connect opens:

- **macOS**: the `terminal` setting. `auto` takes the first installed of
  kitty, Ghostty, Alacritty, iTerm2, Terminal (Terminal is always there,
  so it is the fallback). kitty gets `kitty -1 ssh host` (a new OS window
  in the running instance when that was started single-instance), Ghostty
  and Alacritty `open -na <app> --args -e ssh host`, Terminal and iTerm2
  an AppleScript that opens a window running the command, which asks for
  the Automation permission the first time. A terminal that is picked but
  not installed keeps the panel open with a toast.
- **Linux**: `$TERMINAL`, else the first of kitty, foot, alacritty, xterm
  on PATH; kitty and foot take the command as arguments, the others after
  `-e`.

Settings, `[extensions.ssh]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `config` | path | `~/.ssh/config` | The config to read. `~` is expanded; `known_hosts` is looked for next to it. |
| `include_known_hosts` | bool | `false` | List the names in `known_hosts` too, in a last section. |
| `terminal` | `auto`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | macOS only: which terminal Connect opens. |

## What it does not do

- Run ssh inside the panel: Connect hands the command to a terminal
  window and pal hides.
- Pattern hosts (`Host *.example.com`) and `Match` blocks: they are not
  rows, though their settings still apply when ssh runs.
- Nested includes: an `Include` inside an included file is not followed.
- Passwords, keys or agents: ssh's own business, in the terminal.

## Platforms

macOS and Linux. The terminal is chosen per platform as above; `ping`'s
wait flag is `-W 2000` on macOS and `-W 2` on Linux, the same one echo.
