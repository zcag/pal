# Docker

Three live palettes over the docker CLI (`docker ps -a`, `docker images`,
`docker compose ls -a`, each with `--format '{{json .}}'`), listed again
when the panel shows once their rows are older than `ttl`. Podman works
through the same commands: set `binary` to `podman`, or install its
`docker` alias. Without the binary, or with the daemon not answering, each
palette is one inert hint row that says which.

## Palettes

**Docker Containers** (`docker`): every container, the running ones first
in a Running section, the rest under Stopped. The row is the container's
name, its image the subtitle; on the right the published ports, compact
(`80, 443`; `8080:80` when host and container differ), docker's status
(`Up 27 hours`, `Exited (0) 3 days ago`) and a state tag (running green,
exited grey, paused and restarting amber, created blue, dead red). The id,
the image and the Compose project are keywords, so `nginx` or the project
name finds the container from the root. The detail pane lists id, image,
command, status, created, ports, mounts, networks and project.

**Docker Images** (`images`): `repository:tag` (the id for an untagged
image), the id as subtitle, size and age on the right. Run asks for a name
and ports in a form (`host:container` pairs, comma separated; a malformed
one is refused under the field) and runs `docker run -d [--name] [-p …]
<image>`.

**Compose Projects** (`compose`): every project docker knows of, its
folder as subtitle, the status text and a tag (running green, a mix amber,
exited grey). Every config file of the project is passed with `-f`.

A command keeps the panel open and lists again, with a toast naming what
happened. A command still running after 8 s (a `stop` whose process
ignores SIGTERM, a `compose up` that pulls) is left to finish on its own
and the toast says so; `cmd+r` later shows the outcome. A failed command
keeps the panel open with docker's last stderr line.

## Keyboard

Containers:

| keys | action |
| --- | --- |
| `enter` | Stop a running container (asks first), Start a stopped one |
| `cmd+l` | Logs: `docker logs --tail 200`, stdout and stderr, in the panel |
| `cmd+t` | Shell: a terminal running `docker exec -it <id>` (bash when the image has it, sh otherwise); running containers only |
| `cmd+shift+r` | Restart |
| `cmd+d` | Remove: `docker rm -f`, after a confirm |
| `cmd+c` | Copy the short id |

Images:

| keys | action |
| --- | --- |
| `enter` | Run: the form, then `docker run -d` |
| `cmd+c` | Copy id |
| `cmd+d` | Remove: `docker rmi`, after a confirm |

Compose projects:

| keys | action |
| --- | --- |
| `enter` | Up: `compose up -d` |
| `cmd+l` | Logs: `compose logs --tail 200` |
| `cmd+shift+r` | Restart |
| `cmd+d` | Down, after a confirm |
| `cmd+o` | Open the project folder |

## Setup

Docker (or Podman) installed and its daemon running; the CLI is looked up
on PATH. Nothing else.

Which terminal Shell opens: on macOS the `terminal` setting (`auto` takes
the first installed of kitty, Ghostty, Alacritty, iTerm2, Terminal);
Terminal and iTerm2 are driven through AppleScript, so the first Shell
into one of them asks for the Automation permission once. On Linux
`$TERMINAL`, else the first of kitty, foot, alacritty, xterm on PATH.

Settings, `[extensions.docker]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `binary` | text | `docker` | The CLI to run; `podman` works. |
| `ttl` | number (s) | `10` | How long a listing stays good for before a show lists again. Read when the extension loads. |
| `terminal` | `auto`, `kitty`, `Terminal`, `iTerm2`, `Ghostty`, `Alacritty` | `auto` | macOS only: which terminal Shell opens. |

## What it does not do

- Pull, build or push: only what is already on the machine is listed.
- Remote hosts and contexts beyond what the CLI's own default context
  points at.
- Stream logs: Logs is a snapshot of the last 200 lines, read again on the
  next `cmd+l`.
- Wait for a slow command: after 8 s it goes on alone and the toast says
  so.

## Platforms

macOS and Linux. The terminal for Shell is chosen per platform as above;
everything else is the same CLI on both.
