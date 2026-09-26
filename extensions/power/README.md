# Battery & Power

`power` reads the laptop battery from the operating system (`pmset -g batt`
on macOS, `upower` on Linux), then adds what Cagdas's `power` watcher knows
when it is installed: `~/.local/share/power/state.json` (the live verdict),
`samples.jsonl` beside it (a sample every 30 s) and the `power` CLI, which
apportions watt-hours over a window (`power blame 1d`). The watcher stays
the source of truth for measured watts, its rules and process attribution;
this extension reads and presents it (`data.ts`) and draws it (`view.ts`).

**The palette**, Battery & Power, is one view:

- On the left, the level with one plain sentence (`Drawing 12 W · 1 h 48 min
  left`, `Charging at 38 W · full in 40 min`), six hours of draw as a chart
  (the stretches on the charger shaded, the charge level dashed), today's
  watt-hours as a share of a full charge, and health, cycles and
  temperature as tiles.
- On the right, four tabs. **Now**: the watcher's warning in words, the
  draw split between the apps and chip and the screen and the rest (on the
  charger only the chip is measurable, and it says so), and the processes
  using power with the watts their share comes to and why they cost (CPU,
  wakeups, disk, network). **Today**, **7 days**, **All time**: what used
  the battery in watt-hours with each one's share; the watcher's
  bookkeeping lines are named plainly (`Screen & the rest`, `Short-lived
  processes`) and explained under the cursor. A window spent on the
  charger has no draw to apportion, so it ranks by activity instead.

Enter finds the process under the cursor in Processes (to quit it there),
`tab`/`1`–`4` switch tabs, `cmd+c` copies the name, `s` opens Battery
settings. While open it re-reads every 10 s.

**The bar item** is absent while the battery is healthy. On battery it
appears below 50% by default, on external power at 20% or lower, or
whenever the watcher reports a warning or a draw of 15 W; `show = "always"`
under `[bar.items."power/battery"]` keeps it on the strip, muted
(docs/config.md). Hover shows the popover: the level, the last hour's draw,
the warning, the top four processes and today's watt-hours. A click opens
the palette.

Without the watcher only the level and time left are known, and both views
say what installing it adds. A machine without a battery keeps the item
hidden.

`bun run extensions/power/fixture.ts` writes the gallery fixtures the store
screenshots are taken from (a made-up watcher, nothing of the owner's).
