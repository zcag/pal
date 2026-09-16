// The extension's clock: `new Date()`, or the instant `PAL_NOW` names
// (`2026-09-16T09:05:00`, local to `TZ`; read once at load) so the tests
// pin what `{date}` and `{time}` expand to.
const PINNED = process.env.PAL_NOW ? Date.parse(process.env.PAL_NOW) : NaN;
if (process.env.PAL_NOW && !Number.isFinite(PINNED)) console.error(`snippets: PAL_NOW is not a date: ${process.env.PAL_NOW}`);

/** The moment. */
export const now = (): Date => new Date(Number.isFinite(PINNED) ? PINNED : Date.now());
