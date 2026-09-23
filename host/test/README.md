# Host tests

`bun test` here covers the extension host and every bundled extension (`extensions/`), each file against a real host process
(`harness.ts`). `make test` runs them with the rest of the repo, as CI does.

They run **in parallel**: bun gives each file a worker process (`--parallel`, up to 8 locally, one per core on CI), so the suite
takes about as long as its slowest file. `test/budget.ts` prints the slowest five after every run and **fails any file over 30 s**
(90 s on CI). The suite went from 4 min to 43 s on 2026-09-24; the rules below are what keeps it there.

## Stand-in tools: `writeTool`

A fake CLI (`open`, `docker`, `scutil`, a `timer`) is written with `writeTool(path, body)` from `harness.ts`, never
`writeFileSync` plus `chmodSync(…, 0o755)`. macOS checks every new executable file the first time it runs (0.15–0.3 s each), and a
test that writes fresh fakes per host pays it again every time: the network file spent 28 of its 33 s on it. `writeTool` links the
tool to one stub made once per machine and keeps the script beside it as data, so only the stub's first run ever pays. The body is
any script: a `#!` line picks the interpreter (sh without one), and a shell script's `$0` is still the tool's path.
`rules.test.ts` fails on an executable made any other way; its allow-list says who may and why.

## Time: never wait on the real clock

- **A tick, a poll, a timeout** in an extension is read from an environment variable at module load, with the real value as the
  default: `const TICK_MS = Number(process.env.PAL_OTP_TICK_MS) || 1000`. The test sets it short before starting its host
  (otp, media, spotify, calendar do this). A test that waits out a real 1 s tick, or an 8 s "still running" timeout, is a test that
  takes seconds; those are the files at the top of the budget list.
- **Waiting for something** is `host.until`, `host.nextUpdate` or `host.nextViewUpdate`, never a fixed `Bun.sleep`. Their budgets
  are tripled on CI, and so is the per-test timeout (5 s locally, 15 s on CI, `setDefaultTimeout` in `harness.ts`): a test with a
  longer wait than that gives its own timeout as `test`'s third argument.
- **Never wait for an exact value that time moves.** A countdown can already read `4:59` on its first push, and a tick that lands
  late skips a second; check that it keeps falling instead (`timer.test.ts`, the pushes test).
- **Clean up in `finally`** anything that keeps a tick running (a running timer's state file): a failure otherwise leaves it pushing
  into the tests after it.

## Dates

`bun test` runs in UTC, and the harness hands the host the same zone. A fixture "five minutes ago" is yesterday in a run just after
midnight: derive a Today/Earlier or day-number expectation from the same clock the extension reads (`otp.test.ts`,
`wordle.test.ts`), or pin the time with `PAL_NOW` where the extension reads it.

## Parallel safety

Any file may run beside any other. Each takes its own `mkdtemp` directory, starts servers on port 0, writes nothing at a fixed path
in the temp dir or home, and restores what it changes in `process.env` (network's `withPath`).
