# Host tests

`bun test` here covers the extension host and every bundled extension (`extensions/`), each file against a real host process
(`harness.ts`). `make test` runs them with the rest of the repo, as CI does.

They run **in parallel**: bun gives each file a worker process (`--parallel`, up to 8 locally, one per core on CI), so the suite
takes about as long as its slowest file. `test/budget.ts` prints the slowest five after every run and **fails any file over 30 s**
(90 s on CI) and any single test over 1 s (3 s on CI). The suite went from 4 min to 43 s on 2026-09-24; the rules below are what keeps it there.

## Stand-in tools: `writeTool`

A fake CLI (`open`, `docker`, `scutil`, a `timer`) is written with `writeTool(path, body)` from `harness.ts`, never
`writeFileSync` plus `chmodSync(…, 0o755)`. macOS checks every new executable file the first time it runs (0.15–0.3 s each), and a
test that writes fresh fakes per host pays it again every time: the network file spent 28 of its 33 s on it. `writeTool` links the
tool to one stub made once per machine and keeps the script beside it as data, so only the stub's first run ever pays. The body is
any script: a `#!` line picks the interpreter (sh without one), and a shell script's `$0` is still the tool's path.
`rules.test.ts` fails on an executable made any other way; its allow-list says who may and why.

What a fake logged is read with `logLines(file)`: no lines while the file is missing or still empty. A shell's `>>` creates the
file before the command writes, so a hand-rolled `split("\n")` reads one empty line there and a wait on `.length > 0` passes early
(shell's and translate's CI flakes).

## Time: the host runs on a fake clock

Every test host runs on a fake clock (`src/clock.ts`, switched on by the harness with `PAL_TEST_CLOCK`). In the host and in each
extension worker, a timer of **100 ms or more** (a tick, a timeout, a debounce, a retry, `Bun.sleep`, `AbortSignal.timeout`) fires only
when the test moves the clock: `await host.advance(ms)` runs every timer due on the way, in order, and answers once they ran. `Date`
and `performance.now` read the real time plus how far the clock was advanced, so timestamps from a mock server, a stand-in tool or a
file stay comparable. A timer under 100 ms is real: it orders work (the SDK's 33 ms push coalescing, a yield) rather than waits.

- **Let time pass with `host.advance`**, never a sleep: an 8 s "still running" toast is `advance(8000)` and then the toast; a 1 Hz
  tick is `advance(1000)` and one push. A request whose answer waits on a timer is started, the clock advanced, then awaited:
  `const r = host.pick(...); await host.advance(8000); await r`. There are no `PAL_*_MS` knobs for tests to set; the real values
  are what the test advances past.
- **Nothing moves on its own**, so "nothing happens" is checked exactly: `advance(999)`, no push; `advance(1)`, one.
- **What an advance starts** (a fetch, a tool, a file write) is real I/O: wait for its result with `host.until`, `host.nextUpdate`
  or `host.nextViewUpdate`, which poll for a condition and return the moment it holds.
- **A timer armed after real I/O** (a gap that starts when a reply lands, an idle check after a tool ran) can be missed by one advance
  that lands first: `host.advanceUntil(step, pred)` steps the clock until a condition holds, `host.through(p, step)` until a request
  answers. `host.after(p, ms)` is the plain case: advance, then the answer.
- **The host's time** is `host.now()` (the wall clock plus `host.advanced`). A stand-in tool that stamps a time reads how far the clock
  moved, in seconds, from `$PAL_TEST_AHEAD_FILE` (set for the host, so only for the tools it runs).
- **A slow mock** holds its answer on a promise the test releases (`hue-mock.ts`'s `hold()`), or never answers when the test is
  about the extension's timeout, which the test then advances past. It never sleeps. **A slow stand-in tool** waits for a file the
  test writes (dpi's `curl` and its gate); one that runs until it is killed says so with `never waited for` on the line.
- **A bundled host loads every extension**, and their root sections are real machine state (sessions reads this Mac's Claude
  sessions and waits on its idle check, files asks Spotlight): `Host.bundled({ only: ["odak"] })` turns the rest off, and the harness
  refuses `suggest`, `inline` and `fallback` on a bundled host without `only`.
- **Clean up in `finally`** anything that keeps a tick running (a running timer's state file): a failure otherwise leaves it pushing
  into the tests after it.

Two checks keep it so. `rules.test.ts` fails on a sleep or timer of 100 ms or more in any test source (a mock, a fake, a stand-in
tool's shell `sleep`); a line inside a fixture extension's own source, which runs in the host on the fake clock, says so with
`// on the host's clock`.
`budget.ts` fails any single test over 1 s (3 s on CI), whatever made it slow.

## Dates

`bun test` runs in UTC, and the harness hands the host the same zone. A fixture "five minutes ago" is yesterday in a run just after
midnight: derive a Today/Earlier or day-number expectation from the same clock the extension reads (`otp.test.ts`,
`wordle.test.ts`), or pin the time with `PAL_NOW` where the extension reads it.

## Parallel safety

Any file may run beside any other. Each takes its own `mkdtemp` directory, starts servers on port 0, writes nothing at a fixed path
in the temp dir or home, and restores what it changes in `process.env` (network's `withPath`).
