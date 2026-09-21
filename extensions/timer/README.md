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

**New timer** is next to last: a form with the duration (`25m`, `90s`,
`1h30m`, `2:30`; a bare number is minutes), an optional name (the
duration otherwise; a name already taken restarts that timer) and a
checkbox to ring the phone out loud when it lands (the CLI's `--ring`).
Start runs the CLI and toasts what it printed; a duration the CLI refuses
comes back on the form with its message.

**Start Pomodoro** is the last row while no pomodoro runs: it starts a
work timer (`Pomodoro 1 of 4`, 25 minutes) and from then on the cycle
runs itself. When that timer lands the extension stops it and starts the
break's (`Break 1 of 4`, 5 minutes), then the next round, and after the
last round the long break (15 minutes), then round 1 again, each a timer
of the CLI's own (its chime and its phone ping fire as for any timer) and
each announced on the HUD ("Pomodoro. Break: 5 min"). The pomodoro's row
wears an apple, the phase as a tag (`work` violet, `break` green) and
"Round 2 of 4, work" before what is left; the bar reads `18:27 · 2/4`
while working and `4:59 · break` on a break. Two actions of its own:
**Skip to the next phase** (`cmd+s`: this phase's timer stopped, the
next started; a skipped round is not counted) and **Stop pomodoro**
(`cmd+shift+d`: the cycle over, the timer gone). Stopping the timer
itself (`cmd+d`, or `timer stop` in a terminal) ends the cycle too. A
finished work round counts toward **Pomodoros today: N**, an inert row
at the bottom (sixty days of counts kept in storage); the session itself
is in storage, so a restart of the host picks it up where it was.

## Keyboard

| keys | action | what |
| --- | --- | --- |
| `enter` | Pause / Resume / Dismiss | pause a running timer, resume a paused one, dismiss a landed one (`timer done`) |
| `cmd++` | Add 5 minutes | `timer add 5m <id>` |
| `cmd+s` | Skip to the next phase | on the pomodoro's timer: `timer stop <id>`, then the next phase's timer |
| `cmd+shift+d` | Stop pomodoro | on the pomodoro's timer: the cycle over |
| `cmd+d` | Stop | `timer stop <id>`, the timer is gone |
| `enter` on New timer | New timer | the form; `enter` in the form starts it |
| `enter` on Start Pomodoro | Start pomodoro | the first round's timer |

Without the CLI (the `command` setting names nothing on PATH or on disk)
the New row is one hint row instead, and the timers the state directory
already holds are still listed.

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
| `pomodoro_work` | number, minutes | `25` | A work round. |
| `pomodoro_break` | number, minutes | `5` | The break after a round. |
| `pomodoro_long_break` | number, minutes | `15` | The break after the last round of a cycle. |
| `pomodoro_rounds` | number | `4` | Work rounds per cycle. |
| `bar_show` | `running` / `always` | `running` | When the bar item is drawn: while there is a timer, or always (the glyph alone, muted, with none; its popover opens on the field to start one). |

## The bar item

**Timer** shows the soonest timer's remaining time with a fill for how
far along it is (blue, amber past two thirds, red past 90 %, muted while
paused), the name and the count of the others as its tooltip, and a red
alarm with the timer's name once it lands; hidden with no timer at all
(unless `bar_show` keeps the glyph, muted).

A click opens the popover: a card per timer, most urgent first, with the
name and when it lands (`until 02:35 PM`; a `paused` tag; `landed 0:35
ago` with a `done` tag), the time left large on the right (`0:00` in red
once landed) and a thin bar under them in the strip's colour. The card
the keys act on wears the accent ring; the arrows or a click on a card
move it. It ticks every second while it is up (the fs watcher and the
1 Hz tick push the whole item, popover included).

| keys | what |
| --- | --- |
| `space` / `enter` | pause a running timer, resume a paused one, dismiss a landed one (`d` too) |
| `+` | add five minutes (`timer add 5m <id>`) |
| `backspace` | stop it (`timer stop <id>`) |
| `up` / `down` | move the ring to another timer |
| `n` | start one: the search row becomes a field (`25m tea`; a trailing `ring` rings the phone), `enter` starts it, `escape` closes the field; under it the last durations used are tiles that start one on a click |
| `p` | start a pomodoro (while none runs) |
| `s` | skip to the pomodoro's next phase (while one runs); `cmd+shift+d` stops the cycle |
| `o` | open the Timers palette |

A pomodoro's card carries the phase as a tag next to when it lands; the
second row of key hints ends with today's finished rounds (`3 today`).

The core asks every 10 s and on wake; between those an `fs.watch` on
the directory pushes on every change the CLI makes and a 1 Hz tick
pushes the countdown, running while a timer runs or the popover is up.

## What it does not do

- Keep time itself: with no `timer` CLI the palette lists only New timer,
  and Start fails with the shell's message.
- Edit a timer's name or deadline: stop it and start another, or add five
  minutes.
- Pause a pomodoro as a whole: pausing its timer pauses the phase, and
  the cycle waits with it. A pomodoro timer stopped from the terminal
  ends the cycle; one that landed while the host was down (the CLI reaps
  a landed timer after five minutes) ends it too.
- Show a landed timer for longer than the CLI's badge ttl (five minutes).
- Notify: the chime, the notification and the phone ring are the CLI's.

## Platforms

macOS and Linux, wherever the CLI runs; the extension itself is a
directory reader and a process spawner. Nothing to grant.
