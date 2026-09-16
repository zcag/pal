// The extension's clock. `now()` is `Date.now()`, or the instant `PAL_NOW`
// names (`2026-09-16T10:30:00`, local to `TZ`; read once at load) so the
// tests pin the day and the hour instead of building fixtures around the
// real clock. Every read of the time in the extension goes through it:
// the rows' states, the bar item's minute tick, the popover's redraw, the
// caches' ages, the token expiries.
const PINNED = process.env.PAL_NOW ? Date.parse(process.env.PAL_NOW) : NaN;
if (process.env.PAL_NOW && !Number.isFinite(PINNED)) console.error(`calendar: PAL_NOW is not a date: ${process.env.PAL_NOW}`);

/** The moment, in unix ms. */
export const now = (): number => (Number.isFinite(PINNED) ? PINNED : Date.now());
