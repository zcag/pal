// The pure side of My Schedule: which section a moment falls in, the time
// range in a subtitle, the "now" / "in 12 min" tag, the details text a copy
// puts on the clipboard, and the date and time words the New event form
// takes. Everything runs on the local clock through `Date`; nothing here
// touches the core, so it is tested by import.
import type { CalendarEvent } from "@zcag/pal";

export const DAY = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local midnight of the day `t` falls on. */
export const startOfDay = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Local midnight `n` days after the one `t` falls on (DST-safe: by calendar day, not by 24 h). */
export const addDays = (t: number, n: number): number => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() + n); return d.getTime(); };
const pad = (n: number) => String(n).padStart(2, "0");
/** `14:05`, 24 h. */
export const clock = (t: number): string => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** `Fri 18 Sep`. */
export const dayName = (t: number): string => { const d = new Date(t); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MON_SHORT[d.getMonth()]}`; };
/** `Fri 18 Sep 2026`. */
export const dayNameYear = (t: number): string => `${dayName(t)} ${new Date(t).getFullYear()}`;
/** `2026-09-18`, local. */
export const isoDay = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Today, Tomorrow, This week (within seven days of now), Later. */
export function section(start: number, now: number): string {
  const today = startOfDay(now);
  if (start < addDays(today, 1)) return "Today";
  if (start < addDays(today, 2)) return "Tomorrow";
  if (start < addDays(today, 7)) return "This week";
  return "Later";
}

/** The subtitle's time part: a range, `All day`, or the days an all-day event spans. */
export function timeRange(e: Pick<CalendarEvent, "start" | "end" | "all_day">): string {
  if (e.all_day) {
    const last = e.end - 1;
    return startOfDay(last) > startOfDay(e.start) ? `All day, until ${dayName(last)}` : "All day";
  }
  const sameDay = startOfDay(e.start) === startOfDay(e.end - 1);
  return sameDay ? `${clock(e.start)} – ${clock(e.end)}` : `${clock(e.start)} – ${dayName(e.end)} ${clock(e.end)}`;
}

/** The tag on the current or next event: `now` while it runs, `in 12 min` / `in 2 h` before it; nothing further out than a day. */
export function soonTag(e: Pick<CalendarEvent, "start" | "end" | "all_day">, now: number): string | undefined {
  if (e.all_day) return;
  if (e.start <= now && now < e.end) return "now";
  const mins = Math.round((e.start - now) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) return `in ${Math.round(mins / 60)} h`;
  return;
}

/** The events still worth a row: not ended (an all-day one lasts to its midnight), not declined when the setting hides those, in start order. */
export function upcoming(events: CalendarEvent[], now: number, hideDeclined: boolean): CalendarEvent[] {
  return events.filter((e) => e.end > now && !(hideDeclined && e.my_status === "declined")).sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
}

/** The text "Copy event details" puts on the clipboard. */
export function details(e: CalendarEvent): string {
  const when = e.all_day ? `${dayNameYear(e.start)}${startOfDay(e.end - 1) > startOfDay(e.start) ? ` – ${dayNameYear(e.end - 1)}` : ""} (all day)` : `${dayNameYear(e.start)}, ${timeRange(e)}`;
  return [e.title, when, e.location, e.conference_url ?? e.url].filter((l): l is string => !!l).join("\n");
}

/** `3 people`; nothing for an event without attendees. */
export const people = (n: number): string | undefined => (n ? `${n} ${n === 1 ? "person" : "people"}` : undefined);

/**
 * A day as typed in the form: `today`, `tomorrow`, a weekday (the next one,
 * today included), `2026-09-20`, `20.9` / `20.9.2026`, `20 sep`, `sep 20`.
 * Local midnight of that day, or undefined.
 */
export function parseDay(s: string, now = Date.now()): number | undefined {
  const l = s.trim().toLowerCase().replace(/,/g, "");
  if (!l || l === "today") return startOfDay(now);
  if (l === "tomorrow" || l === "tmr") return addDays(now, 1);
  const wd = WEEKDAYS.findIndex((w) => w === l || (l.length >= 3 && w.startsWith(l)));
  if (wd >= 0) return addDays(now, (wd - new Date(now).getDay() + 7) % 7);
  const next = l.match(/^next\s+([a-z]+)$/);
  if (next) {
    const w = WEEKDAYS.findIndex((w) => w.startsWith(next[1]));
    if (w >= 0) return addDays(now, ((w - new Date(now).getDay() + 6) % 7) + 1);
    if (next[1] === "week") return addDays(now, 7);
    return;
  }
  let m: RegExpMatchArray | null;
  const year = new Date(now).getFullYear();
  if ((m = l.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = l.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/))) return valid(m[3] ? Number(m[3]) : year, Number(m[2]), Number(m[1]));
  if ((m = l.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})(?:\s+(\d{4}))?$/))) { const mo = month(m[2]); return mo ? valid(m[3] ? Number(m[3]) : year, mo, Number(m[1])) : undefined; }
  if ((m = l.match(/^([a-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/))) { const mo = month(m[1]); return mo ? valid(m[3] ? Number(m[3]) : year, mo, Number(m[2])) : undefined; }
  return;
}
const month = (name: string) => MONTHS.indexOf(name.slice(0, 3)) + 1;
function valid(y: number, m: number, d: number): number | undefined {
  const t = new Date(y, m - 1, d).getTime();
  const dt = new Date(t);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? t : undefined;
}

/** A time as typed: `14:30`, `14`, `2pm`, `2:30 pm`, `1430`, `noon`. Minutes since midnight, or undefined. */
export function parseTime(s: string): number | undefined {
  const l = s.trim().toLowerCase().replace(/\s+/g, "");
  if (l === "noon") return 12 * 60;
  if (l === "midnight") return 0;
  const m = l.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return;
  if (m[3]) {
    if (h < 1 || h > 12) return;
    h = (h % 12) + (m[3].startsWith("p") ? 12 : 0);
  } else if (h > 23) return;
  return h * 60 + min;
}

/** The next quarter hour after `now`, as `HH:MM`, for the form's default start. */
export function nextQuarter(now: number): string {
  const q = 15 * 60_000;
  return clock(Math.ceil((now + 60_000) / q) * q);
}

/** `HH:MM` plus `minutes`, wrapping at midnight (the form's default end). */
export function plusMinutes(hhmm: string, minutes: number): string {
  const m = (parseTime(hhmm) ?? 0) + minutes;
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
