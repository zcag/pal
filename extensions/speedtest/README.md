# Speedtest

A speed test you can watch in the panel, run by the CLI you already have.
A view palette: opening it shows the last result and which tool was
found; **nothing runs until Enter**. Enter spawns the tool and the view
follows its output live; Enter again stops it.

## The tools

| tool | how it is read | install |
| --- | --- | --- |
| **Speedtest by Ookla** (`speedtest`) | `--format=jsonl --progress=yes`: a JSON line per progress step with the phase's fraction, the live bandwidth, the server, the ISP, the result page | `brew tap teamookla/speedtest && brew install speedtest` (the licence is accepted on the command line) |
| **speedtest-cli** (`speedtest-cli`, Python) | its lines as they print: the ISP, the server with its ping, then the download and upload figures | `brew install speedtest-cli` (or `pip install speedtest-cli`) |
| **fast** (`fast-cli`, Netflix) | `--upload --verbose`: the one line it redraws, read for the last `N Mbps ↓` and `↑` in each chunk, then the unloaded latency and the client line | `npm install --global fast-cli` |

`tool = auto` takes them in that order (Ookla is the one with real
progress). `speedtest` on PATH is two different programs (sivel's pip
package installs a `speedtest` alias too), so it is told apart by its
`--version`. With none installed the view lists the three install lines
and Enter looks again.

## The view

A head row (the tool, the server and ISP once known, the status badge),
then a card with a **bar per direction** and the figure in Mbps beside
it, and the **ping** tiles (latency, jitter, packet loss when the tool
reports it). Ookla's fraction fills the bar; for the other two the bar
estimates from the elapsed time and stops short of full. The foot line
is the elapsed time while running, the date and duration after, or the
failure. Every step the tool prints is pushed into the open view
(`view.update`); a tick keeps the elapsed time moving between them.

## Keyboard

| keys | action |
| --- | --- |
| `enter` | Start the test; while it runs, stop it (the tool's process group is killed) |
| `cmd+enter` | Copy the result: `↓ 93.2 Mbps · ↑ 29.6 Mbps · ping 12.4 ms (jitter 1.0 ms) · server · ISP` |
| `cmd+o` | Open the result page (Ookla only) |
| `cmd+h` | The history |
| `esc` | Leave the view; a running test keeps running and the view catches up when reopened |

## Speedtest History

Every finished run lands in the Speedtest History palette
(`speedtest-history`, storage, the last `keep`), newest first: the two
figures and the ping as the name, the server, ISP and tool as the
subtitle, the date on the right; `enter` copies the run's line, `cmd+o`
opens its result page, `cmd+d` removes it; the last row clears the
history. The first row, **Trend**, draws the last twenty runs as bars,
download in blue and upload in green, each against the best of its own,
with the ping beside; Enter there copies the history as text.

## Setup

Settings, `[extensions.speedtest]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `tool` | `auto`, `ookla`, `speedtest-cli`, `fast` | `auto` | Which CLI runs the test. |
| `server` | text | empty | A speedtest.net server id (`speedtest -L` lists nearby ones); empty picks the nearest. fast ignores it. |
| `keep` | number | 30 | Runs the history holds. |

A test that has not ended after two minutes is stopped.

## What it does not do

- Measure anything itself: no tool, no test. The three above are the
  ones read; another CLI's output is not understood.
- Run on a schedule or from the bar: Enter is the only start.
- Show packet loss or the result page for speedtest-cli and fast: they
  do not report them.

## Platforms

macOS and Linux.
