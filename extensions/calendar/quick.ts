// Quick Add's grammar: one line into an event, pure. `standup tomorrow
// 10:00`, `dentist fri 2pm-3pm`, `lunch with ali 12:30 for 45m`, `retro
// next tue 15:00 at Room 4`, `birthday 20 sep all day`, `call mum 5pm`
// (today, or tomorrow once 17:00 has passed), `1:1 mon 9am in Work`. The
// day and time words are schedule.ts's (`parseDay`, `parseTime`); the
// title is what is left once the day, the times, the length, the place
// and the calendar have been taken from the end of the line. Nothing here
// touches the core; `now` comes in so the tests pin it.

import { addDays, DAY, parseDay, parseTime, startOfDay } from "./schedule.ts";

export type Quick = {
  title: string;
  /** Local midnight of the day. */
  day: number;
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  /** The calendar named after `@` (any name) or `in` (one of `calendars`), as typed. */
  calendar?: string;
  /** The day was not named: today, or tomorrow when the time has passed. */
  assumedDay: boolean;
};

export type QuickProblem = { problem: string };

/** Minutes, from `45m`, `1h`, `1h30m`, `2 hours`, `90 min`. */
export function parseLength(s: string): number | undefined {
  const l = s.trim().toLowerCase();
  const m = l.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/);
  if (!m || (!m[1] && !m[2])) return;
  const mins = Math.round((Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0));
  return mins > 0 ? mins : undefined;
}

const DAY_WORD = /^(today|tomorrow|tmr|next\s+[a-z]+|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i;
/** A time as `parseTime` reads it, but never a bare number under 3 digits without am/pm (that is a count in a title: `2 coffees`). */
const timeAt = (w: string): number | undefined => (/^(\d{1,2}(:\d{2})?(am|pm|a|p)|\d{1,2}:\d{2}|\d{4}|noon|midnight)$/i.test(w) ? parseTime(w) : undefined);

/**
 * The line as an event, or what could not be read. Taken from the end,
 * in any order: `@ <calendar>` (anywhere; `in <calendar>` too when one
 * of `calendars` starts with the word), `at <place>`, `for <length>`,
 * `all day`, a time or a range (`2pm-3pm`, `14:00 to 15:30`, `at 5pm`),
 * a day (`tomorrow`, `fri`, `next tue`, `20 sep`, `2026-09-20`, `on
 * monday`). What remains is the title. Without a time it is an all-day
 * event; without a day, today, or tomorrow when the time is gone.
 */
export function parseQuick(line: string, now: number, defaultLength = 30, calendars: string[] = []): Quick | QuickProblem {
  let s = line.trim().replace(/\s+/g, " ");
  if (!s) return { problem: "Type an event: standup tomorrow 10:00" };
  let calendar: string | undefined, location: string | undefined, length: number | undefined;
  let day: number | undefined, start: number | undefined, end: number | undefined, allDay = false;
  let m: RegExpMatchArray | null;
  // The calendar: `@ Work` anywhere (one or two words), `in Work` only when a calendar starts with that (an `in` in a title stays).
  const named = (name: string) => calendars.some((c) => c.toLowerCase().startsWith(name.toLowerCase()));
  const take = (m: RegExpMatchArray, name: string) => { calendar = name; s = (s.slice(0, m.index) + " " + s.slice(m.index! + m[0].length - (m[1].length - name.length))).replace(/\s+/g, " ").trim(); };
  if ((m = s.match(/(?:^|\s)@\s*([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)?)(?=\s|$)/))) take(m, named(m[1]) ? m[1] : m[1].split(" ")[0]);
  else if ((m = s.match(/(?:^|\s)in\s+([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)?)(?=\s|$)/i)) && (named(m[1]) || named(m[1].split(" ")[0]))) take(m, named(m[1]) ? m[1] : m[1].split(" ")[0]);
  // The place is free text at the end, after `at`, unless a time follows it (`at 5pm`).
  if ((m = s.match(/^(.*?)\s+at\s+(.+)$/i)) && timeAt(m[2].split(" ")[0]) === undefined && !/^(\d|noon|midnight)/i.test(m[2])) { location = m[2].trim(); s = m[1].trim(); }
  if ((m = s.match(/^(.*?)\s+for\s+(\d[\w.]*(?:\s+\w+)?)$/i)) && parseLength(m[2]) !== undefined) { length = parseLength(m[2]); s = m[1].trim(); }
  if ((m = s.match(/^(.*?)\s+all[\s-]?day$/i))) { allDay = true; s = m[1].trim(); }
  // A time or a range anywhere after the first word: `2pm-3pm`, `14:00 to 15:30`, `at 5pm`, `from 9 to 10am`.
  const range = /(?:^|\s)(?:at\s+|from\s+)?(\d{1,2}(?::\d{2})?(?:\s?[ap]m?)?|\d{4}|noon|midnight)(?:\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?(?:\s?[ap]m?)?|\d{4}|noon|midnight))?(?=\s|$)/gi;
  for (const r of [...s.matchAll(range)].reverse()) {
    // `9-10am`: the first end takes the second's am/pm when it has none.
    const ap = r[2]?.match(/[ap]m?$/i)?.[0];
    const first = r[1].replace(/\s/g, "") + (ap && !/[ap]m?$/i.test(r[1]) ? ap : "");
    const a = timeAt(first), b = r[2] ? timeAt(r[2].replace(/\s/g, "")) : undefined;
    if (a === undefined || (r[2] && b === undefined)) continue;
    start = a;
    end = b;
    s = (s.slice(0, r.index) + " " + s.slice(r.index! + r[0].length)).replace(/\s+/g, " ").trim();
    break;
  }
  // The day: the last one to three words that read as one (`next tue`, `20 sep`, `sep 20 2026`, `on monday`).
  const words = s.split(" ");
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const tail = words.slice(-n).join(" ").replace(/^on\s+/i, "");
    if (!/\d|[a-z]{3,}/i.test(tail) || tail.length < 3) continue;
    const d = parseDay(tail, now);
    // A bare weekday, `today`, `tomorrow`, `next x`, or a form with a digit; not `may` alone as a month.
    if (d !== undefined && (DAY_WORD.test(tail) || /\d/.test(tail))) { day = d; words.splice(-n, n); if (/^on$/i.test(words.at(-1) ?? "")) words.pop(); break; }
  }
  const title = words.join(" ").trim();
  if (!title) return { problem: "A title first: dentist fri 2pm" };
  if (start === undefined && !allDay && !length) allDay = true;
  const assumedDay = day === undefined;
  if (day === undefined) day = startOfDay(now);
  if (allDay) return { title, day, start: day, end: day + DAY, allDay: true, location, calendar, assumedDay };
  if (start === undefined) start = Math.ceil((now - startOfDay(now)) / 900_000) * 15;
  let from = day + start * 60_000;
  // No day named and the time gone: tomorrow.
  if (assumedDay && from <= now) { day = addDays(now, 1); from = day + start * 60_000; }
  let to = end !== undefined ? day + end * 60_000 : from + (length ?? defaultLength) * 60_000;
  if (to <= from) to += DAY;
  return { title, day, start: from, end: to, allDay: false, location, calendar, assumedDay };
}
