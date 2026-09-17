// The clock every read of the time should go through: `Date.now()`, or the
// instant `PAL_NOW` names (`2026-09-16T10:30:00`, local to `TZ`; read once
// at load) so a test pins the day and the hour instead of building
// fixtures around the real clock. The host's test harness forwards
// `PAL_NOW` and `TZ` to the extension host.
const PINNED = process.env.PAL_NOW ? Date.parse(process.env.PAL_NOW) : NaN;
if (process.env.PAL_NOW && !Number.isFinite(PINNED)) console.error(`[pal] PAL_NOW is not a date: ${process.env.PAL_NOW}`);

/** The moment, in unix ms. */
export const now = (): number => (Number.isFinite(PINNED) ? PINNED : Date.now());
