// The clock every read of the time should go through: `Date.now()`, or the
// instant `PAL_NOW` names (`2026-09-16T10:30:00`, local to `TZ`; read once
// at load) so a test pins the day and the hour instead of building
// fixtures around the real clock. The host's test harness forwards
// `PAL_NOW` and `TZ` to the extension host.
//
// Below it, the one way a moment is written on a row or in a pane:
// `clock` (`14:05`, 24 h), `dayName` (`Fri 18 Sep`), `dayNameYear`
// (`Fri 18 Sep 2026`), `when` (the clock alone today, the day before
// it on another day, the year on another year) and `ago` (`5 min ago`,
// `2 h ago`; `5m`, `2h` short). Hand-formatted rather
// than `toLocaleString`: the host runs under whatever locale launchd
// gave it (`en-US` on a machine set to `en_TR`), so the locale forms put
// the month first and an AM/PM on a user whose system clock says 14:05.
const PINNED = process.env.PAL_NOW ? Date.parse(process.env.PAL_NOW) : NaN;
if (process.env.PAL_NOW && !Number.isFinite(PINNED)) console.error(`[pal] PAL_NOW is not a date: ${process.env.PAL_NOW}`);

/** The moment, in unix ms. */
export const now = (): number => (Number.isFinite(PINNED) ? PINNED : Date.now());

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const at = (t: number | string | Date) => (t instanceof Date ? t : new Date(t));

/** `14:05`, 24 h, local. */
export const clock = (t: number | string | Date): string => { const d = at(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** `Fri 18 Sep`, local. */
export const dayName = (t: number | string | Date): string => { const d = at(t); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MON_SHORT[d.getMonth()]}`; };
/** `Fri 18 Sep 2026`. */
export const dayNameYear = (t: number | string | Date): string => `${dayName(t)} ${at(t).getFullYear()}`;
/** `2026-09-18`, local. */
export const isoDay = (t: number | string | Date): string => { const d = at(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * A moment as a row or a pane writes it: `14:05` on the day of `ref`
 * (today), `Fri 18 Sep 14:05` on another day of the year, `Fri 18 Sep
 * 2025 14:05` in another year. `ref` defaults to `now()`.
 */
export function when(t: number | string | Date, ref: number = now()): string {
  const d = at(t), r = new Date(ref);
  if (d.toDateString() === r.toDateString()) return clock(d);
  return `${d.getFullYear() === r.getFullYear() ? dayName(d) : dayNameYear(d)} ${clock(d)}`;
}

/** The ladder `ago` climbs: how many of a unit make the next, the long and the short spelling. */
const AGO: [number, string, string][] = [[60, "s", "s"], [60, "min", "m"], [24, "h", "h"], [7, "d", "d"], [30 / 7, "w", "w"], [365 / 30, "mo", "mo"], [Infinity, "y", "y"]];

/**
 * How long ago `t` was, as a row says it: `just now` under 5 s, then
 * `23 s ago`, `5 min ago`, `2 h ago`, `3 d ago`, `2 w ago`, `5 mo ago`,
 * `1 y ago`; a moment past `now` reads `in 2 h`. `short` is the form a
 * narrow column or the bar takes: `now` under a minute, then `5m`, `2h`,
 * `3d`, `2w`, `5mo`, `1y` (`in 2h`). `now` defaults to `now()`.
 */
export function ago(t: number | string | Date, { now: ref = now(), short = false }: { now?: number; short?: boolean } = {}): string {
  const diff = ref - at(t).getTime();
  let n = Math.abs(diff) / 1000, unit = "s";
  if (n < (short ? 60 : 5)) return short ? "now" : "just now";
  for (const [size, long, brief] of AGO) { unit = short ? brief : long; if (Math.round(n) < size) break; n /= size; }
  const span = short ? `${Math.round(n)}${unit}` : `${Math.round(n)} ${unit}`;
  return diff < 0 ? `in ${span}` : short ? span : `${span} ago`;
}
