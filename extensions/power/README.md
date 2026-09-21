# Battery & Power

`power` reads the laptop battery from the operating system, then augments it
with `~/.local/share/power/state.json` when Cagdas's existing `power` watcher
is installed. The watcher remains the source of truth for measured watts,
rules and process attribution; this extension only presents that state.

The bar is intentionally absent while the battery is healthy. Its thresholds
are configurable: on battery it appears below 50% by default, on external
power at 20% or lower, or whenever the watcher reports a warning or high draw.
`show = "always"` under `[bar.items."power/battery"]` keeps the level on the
strip while healthy too, muted (docs/config.md).
Click goes straight to Battery Settings; the popover and `Battery & Power`
palette provide the percentage, source, remaining time, live draw, warnings,
top consumers and wake locks.

macOS uses `pmset -g batt`. Linux uses `upower`; machines without a battery
simply keep the item hidden and show an explanatory palette row.
