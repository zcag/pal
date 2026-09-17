# Shell

Run one command in your login shell and read what it printed without
leaving the panel. An input palette: what you type is one `Run: <cmd>`
row and nothing runs until you press `enter`; the answer is a view with
the output. `$ ls` or `> git status` at the root lists the same row
inline.

## What the query does

| query | rows |
| --- | --- |
| nothing | three hints: the shell, folder and timeout in use; the root prefixes; where the history is |
| `ls -la` | one row, `Run: ls -la`; `enter` runs it, `cmd+enter` opens it in a terminal, `cmd+c` copies it |
| `rm -rf build` | the same row, with `asks first` in the subtitle: `enter` shows a confirm card before anything runs (while `confirm` is on) |
| `$ ls`, `> ls` | the marker is stripped; at the root these are what wakes the palette inline |

## The output view

The command runs through the `shell` setting (`$SHELL -lic` by default:
your login shell with the profile and the interactive rc loaded, so PATH,
aliases and functions apply), in `cwd`, with the `env` lines set, for at
most `timeout` seconds. The view:

- the command as the title and the first line, the folder under it;
- badges on the right: `exit 0` (green) or `exit N` (red), the duration;
  `killed after N s` (red) when the timeout struck; `output cut` (amber)
  when a stream passed 256 KB (the tail is kept);
- stdout in monospace on a sunken surface, stderr under it in red, the
  whole thing scrolling past the panel; `(no output)` when both were
  empty.

A command still running 2.5 s after `enter` gets the view at once with a
blue `running` badge and the elapsed time ticking; when it ends the
result lands in the same view (`view.update`), so a command may take
longer than the panel would wait for a pick. `cmd+r` runs it again in
place.

| keys | action |
| --- | --- |
| `enter` | Copy the output (stdout; stderr when there was no stdout) |
| `cmd+enter` | Open the command in a terminal window, in the working directory |
| `cmd+r` | Run again |
| `cmd+c` | Copy the command |
| `cmd+shift+e` | Copy stderr |
| `escape` | Back to the palette |

`cmd+r` is the panel's Refresh on a list; in a view level the view's own
actions take the keys, so here it re-runs.

## Terminal

`cmd+enter` on the row or in the view opens a terminal on `cd <cwd> &&
<command>; exec <shell>`, so the window stays open with the output. The
`terminal` setting names the app: `Terminal` (default) and `iTerm` are
driven over AppleScript; `kitty`, `Alacritty`, `WezTerm` and `Ghostty` by
their own flags through `open -na`; any other name is `open -na <name>
--args -e <shell> -c ...`. On Linux the setting is a command name, else
`$TERMINAL`, else the first installed of `x-terminal-emulator`, kitty, foot,
Alacritty, WezTerm, Ghostty, GNOME Terminal, Konsole, xfce4-terminal and
xterm, each handed the command the way it takes one (kitty and foot as
trailing arguments, WezTerm after `start --`, the rest after `-e`).

## Shell History

Every command that ran lands in the Shell History palette
(`shell-history`), newest first, once each, the last hundred (`storage`),
with its exit code (`exit 0` green, `exit N` red, `killed` for a timeout),
the duration and the folder. `enter` runs it again (the same confirm for
a destructive-looking one), `cmd+enter` opens it in a terminal, `cmd+c`
copies it, `cmd+d` removes the entry; the last row clears the history
(asks first). The palette is `input`, not `live`: it lists on every
keystroke so a command just run is there, and its rows never reach the
root, where an `enter` would run one.

## What looks destructive

With `confirm` on (the default) the Run action asks first when any
simple command of the line (split on `;`, `&&`, `||`, `|`, subshells;
`VAR=x` prefixes and wrappers like `xargs`, `time`, `nohup`, `exec`
skipped) is `rm`, `mv`, `dd`, `mkfs`, `shred`, `truncate`, `wipefs`,
`shutdown`, `reboot`, `halt`, `poweroff`, `dropdb`, `sudo` or `doas`; or,
by its arguments, `chmod`/`chown`/`chgrp -R`, `git push --force` / `-f`,
`git reset --hard`, `git clean -f`, `git branch -D`, `git checkout --`,
`kill -9`, `docker rm`/`rmi`/`system prune`, a package manager's
`uninstall`/`remove`/`purge`, `diskutil erase`, `launchctl bootout`, a
`DROP TABLE`; or a redirect onto a disk device. An argument named `rm`
(`grep rm *.txt`) is not a command, and `rmdir`, `mvn`, `format` never
match. A heuristic, not a sandbox: the shell runs whatever you confirm.

## Setup

Nothing to install. Settings, `[extensions.shell]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `shell` | text | `$SHELL -lic` | The shell and its flags; the command is appended as the last argument. `zsh -lc` skips aliases and the interactive rc's noise (a `zle` warning from an rc file that assumes a terminal shows up in red). |
| `cwd` | folder | `~` | Where commands run. |
| `timeout` | 1 to 600 s | `10` | SIGTERM after this, SIGKILL 1.5 s later; the process group, so a pipeline dies whole. |
| `env` | list of `KEY=VALUE` | empty | Set for every command, on top of the host's environment. |
| `confirm` | boolean | `true` | Ask before a destructive-looking command. |
| `terminal` | text | empty (`Terminal`) | What `cmd+enter` opens. |

## What it does not do

- Interactive commands: stdin is closed. A command that prompts gets EOF.
- Colour: ANSI escapes are shown as printed, not rendered. `NO_COLOR=1`
  or `TERM=dumb` in `env` keeps most tools plain.
- Streaming: the view fills when the command ends (or is killed), not
  line by line.
- A shell session: every command is a fresh shell; `cd` does not stick.
  Set `cwd` instead.

## Platforms

macOS and Linux.
