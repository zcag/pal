# Services

The OS's service manager, one live palette: systemd units on Linux,
launchd jobs on macOS. What it lists depends on the platform; on both the
rows are listed again when the panel shows once they are older than
`ttl`, and `cmd+r` lists now. The backend is picked from the platform
(`PAL_SERVICES_BACKEND=systemd|launchd` forces one; the tests run both on
one machine against fake binaries).

## Linux: systemd

Filters: User (`systemctl --user`), System, Failed and Running (the last
two span both managers, in a User and a System section). The row is the
unit without `.service`, its description the subtitle; on the right the
unit file's state (`enabled`, `disabled`; nothing for static, generated
and transient units) and a tag with the active state: the sub state alone
when active (`running`, `exited`, green), `active/sub` otherwise
(`inactive/dead` grey, `failed` red, activating amber). Units are
what `list-units --all` has loaded, then the unit files it has not (a
disabled service that never ran), inactive and without a description;
templates, masked and alias files are skipped. An instance
(`app-foo@autostart.service`) shows its template's enabled state. The
detail pane lists the unit, its scope, the load and active states and the
unit file's state.

A system unit's Stop, Restart and Disable ask first (a user unit's too
with `confirm_user`). A system verb runs as `systemctl --no-ask-password
<verb>`; when that is refused for want of authentication it is tried
through `sudo -n` (a credential window opened by `sudo -v` in a terminal),
then `pkexec` (a polkit agent's prompt, when one is running). When none is
allowed the panel stays open with a toast quoting all three refusals. A
verb still running after 8 s (a stop waiting on `TimeoutStopSec`, a polkit
prompt) goes on without the panel; `cmd+r` shows the outcome. A
`journalctl` for a system unit shows what your user may read.

## macOS: launchd

Filters: Agents (the plists in the `agent_dirs` folders, one section per
folder), Loaded (everything `launchctl list` knows, sorted; the
`application.*` jobs of running apps skipped) and Running (those with a
pid). The row is the label, the program from the plist (its `Program`, or
the first `ProgramArguments` entry) the subtitle, and on the right the pid
and a tag: `running` (green), `loaded` (blue, no process right now), `exit
N` (red, the last exit was not 0), `not loaded` (grey, a plist launchd has
not been given). A binary plist is read through `plutil`.

## Keyboard

Linux:

| keys | action |
| --- | --- |
| `enter` | Stop an active unit (`systemctl stop`), Start an inactive one |
| `cmd+l` | Logs: `journalctl -u <unit> -n 200 --no-pager` (`--user` for a user unit) in the panel |
| `cmd+shift+r` | Restart |
| `cmd+e` | Enable or Disable, on the unit file's state; absent for a static, generated or transient unit |
| `cmd+c` | Copy unit name: `name.service` |
| `tab` | The next filter: User, System, Failed, Running |

macOS:

| keys | action |
| --- | --- |
| `enter` | Unload a loaded job (`launchctl bootout gui/$UID/<label>`, after a confirm), Load one that is not (`launchctl bootstrap gui/$UID <plist>`) |
| `cmd+shift+r` | Restart: `launchctl kickstart -k gui/$UID/<label>` |
| `cmd+l` | Show plist: the plist as XML in the panel |
| `cmd+o` | Open the plist file |
| `cmd+c` | Copy label |
| `tab` | The next filter: Agents, Loaded, Running |

## Setup

Nothing to install: `systemctl` and `journalctl` on Linux, `launchctl` and
`plutil` on macOS are the OS's own. For system units on Linux, either an
open sudo window (`sudo -v` in a terminal) or a running polkit agent lets
a verb through; without both, the toast says what was refused.

Settings, `[extensions.services]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `ttl` | number (s) | `10` | How long a listing stays good for before a show lists again. Read when the extension loads. |
| `confirm_user` | bool | `false` | Ask before stopping, restarting or disabling a user unit too. |
| `agent_dirs` | list | `~/Library/LaunchAgents`, `/Library/LaunchAgents` | macOS only: where agent plists are read from. |

## What it does not do

- Ask for a password itself: the host has no way to; a system verb goes
  through `sudo -n` or `pkexec` and needs one of them to be allowed.
- Edit a unit or a plist: Open plist file hands it to the default app.
- Timers, sockets, mounts: on Linux only `.service` units are listed; on
  macOS launch daemons (`/Library/LaunchDaemons`, root's) are not.
- Follow logs: Logs is a snapshot of the last 200 lines.

## Platforms

Both, with a different backend each: systemd on Linux, launchd on macOS.
The filters, the tags and the verbs are the backend's own, as above.
