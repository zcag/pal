# Timer

Named countdown timers over the `timer` CLI: the CLI keeps the timers
(one detached process per timer that fires on its own, one state file per
timer under its directory), and pal is a view of that directory, so a
timer started from a terminal and one started here are the same thing.
Every change goes back through the CLI (`timer 25m tea`, `pause`,
`resume`, `add`, `stop`, `done`).

**Timers** (`timers`) is one row per timer, most urgent first: landed
ones (newest first), then running (soonest first), then paused. The row
is the timer's name; the subtitle is `3:12 left, done at 04:41 PM`,
`Paused at 41:05`, or `Landed 1:35 ago`; the tag on the right is the state
(`running` blue, `paused` amber, `done` red). A live palette: listed again
on every show, so the numbers are current, and the timers are root
results (type the name). A landed timer stays listed for five minutes,
then drops out as the CLI reaps it.

**New timer** is the last row: a form with the duration (`25m`, `90s`,
`1h30m`, `2:30`; a bare number is minutes), an optional name (the
duration otherwise; a name already taken restarts that timer) and a
checkbox to ring the phone out loud when it lands (the CLI's `--ring`).
Start runs the CLI and toasts what it printed; a duration the CLI refuses
comes back on the form with its message.

## Keyboard

| keys | action | what |
| --- | --- | --- |
| `enter` | Pause / Resume / Dismiss | pause a running timer, resume a paused one, dismiss a landed one (`timer done`) |
| `cmd++` | Add 5 minutes | `timer add 5m <id>` |
| `cmd+backspace` | Stop | `timer stop <id>`, the timer is gone |
| `enter` on New timer | New timer | the form; `enter` in the form starts it |

Every action keeps the panel open; the directory watcher lists the change
within a moment. A CLI refusal is a toast with its message.

## Setup

Needs the `timer` CLI: a standalone script that keeps its timers as
`<id>.state` files (bash `printf %q` key-value lines: `id`, `name`,
`total`, `deadline`, `left`, `state`, `fired`, `auto`) in `TIMER_DIR`,
and takes `<duration> [name] [--ring]`, `pause <id>`, `resume <id>`,
`add <duration> <id>`, `stop <id>` and `done`. pal runs it with
`TIMER_DIR` set to the `dir` setting, so both look at the same files.

Settings, `[extensions.timer]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `command` | path | `timer` | The timer CLI: a name on PATH or a path. It keeps the timers; pal only reads and asks. |
| `dir` | path | `~/.local/share/timer` | Where the CLI keeps one file per timer (its `TIMER_DIR`). `~` is expanded. |

The bar item **Timer** shows the soonest timer's remaining time with a
fill for how far along it is (blue, amber past two thirds, red past 90 %,
muted while paused), the name and the count of the others as its tooltip,
and a red alarm with the timer's name once it lands; hidden with no timer
at all. A click opens the Timers palette. The core asks every 10 s and on
wake; between those an `fs.watch` on the directory pushes on every change
the CLI makes and a 1 Hz tick pushes the countdown, running only while a
timer runs.

## What it does not do

- Keep time itself: with no `timer` CLI the palette lists only New timer,
  and Start fails with the shell's message.
- Edit a timer's name or deadline: stop it and start another, or add five
  minutes.
- Show a landed timer for longer than the CLI's badge ttl (five minutes).
- Notify: the chime, the notification and the phone ring are the CLI's.

## Platforms

macOS and Linux, wherever the CLI runs; the extension itself is a
directory reader and a process spawner. Nothing to grant.
