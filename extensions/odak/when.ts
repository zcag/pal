// The add line and the dates, pure. odak keeps a todo as one line of
// text with tags, a flag, a day it is due and a day it waits for; the web
// UI's add bar reads `#tag`, `!`, `/section` and `d:date` out of the line
// and pal reads the same, plus a day said in words at the end (`call the
// bank tomorrow`, `renew passport next mon`, `taxes in 3 days`, `dentist
// 20 sep`). The API stores a date as `YYYY-MM-DD` and a day only, so a
// time after the day (`next mon 9am`) stays in the text. `now` comes in
// so the tests pin it.

import { dayName, dayNameYear } from "@zcag/pal";

export const DAY = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TIME = /^(\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}:\d{2}|noon|midnight)$/i;

export const startOfDay = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const addDays = (t: number, n: number): number => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() + n); return d.getTime(); };
const addMonths = (t: number, n: number): number => { const d = new Date(startOfDay(t)); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return d.getTime(); };
const pad = (n: number) => String(n).padStart(2, "0");
/** `2026-09-22`, local: what odak stores. */
export const isoDay = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** The local midnight an odak date names, or undefined for anything that is not a `YYYY-MM-DD` day. */
export const dayOf = (iso: string | undefined): number | undefined => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso ?? "");
  return m ? valid(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
};
function valid(y: number, m: number, d: number): number | undefined {
  const t = new Date(y, m - 1, d).getTime(), dt = new Date(t);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? t : undefined;
}
const month = (s: string): number => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

/**
 * A day said in words, as local midnight: `today`, `tomorrow`, `tmr`, a
 * weekday (`fri`, `friday`: the next one, today included), `next fri`
 * (the coming one, today excluded, as the calendar's Quick Add reads
 * it), `next week` (seven days), `next month`,
 * `in 3 days` / `in 2 weeks` / `in a month` (`3d`, `2w`, `1m` too),
 * `20 sep`, `sep 20`, `20 sep 2027`, `2026-09-30`, `30.9`, `30/9/2026`.
 * A leading `by`, `on` or `due` is allowed. Undefined for anything else.
 */
export function parseWhen(s: string, now: number): number | undefined {
  const l = s.trim().toLowerCase().replace(/,/g, "").replace(/^(?:by|on|due)\s+/, "");
  if (!l) return;
  if (l === "today" || l === "tonight" || l === "eod") return startOfDay(now);
  if (l === "tomorrow" || l === "tmr" || l === "tmrw") return addDays(now, 1);
  const wd = WEEKDAYS.findIndex((w) => w === l || (l.length >= 3 && w.startsWith(l)));
  if (wd >= 0) return addDays(now, (wd - new Date(now).getDay() + 7) % 7);
  let m: RegExpMatchArray | null;
  if ((m = l.match(/^next\s+([a-z]+)$/))) {
    const w = WEEKDAYS.findIndex((w) => m![1].length >= 3 && w.startsWith(m![1]));
    if (w >= 0) return addDays(now, ((w - new Date(now).getDay() + 6) % 7) + 1);
    if (m[1] === "week") return addDays(now, 7);
    if (m[1] === "month") return addMonths(now, 1);
    return;
  }
  if ((m = l.match(/^(?:in\s+(\d+|an?)|(\d+))\s*(d|days?|w|weeks?|m|mo|months?)$/))) {
    const n = m[2] !== undefined ? Number(m[2]) : m[1] === "a" || m[1] === "an" ? 1 : Number(m[1]);
    return m[3].startsWith("d") ? addDays(now, n) : m[3].startsWith("w") ? addDays(now, n * 7) : addMonths(now, n);
  }
  const year = new Date(now).getFullYear();
  if ((m = l.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = l.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/))) return valid(m[3] ? Number(m[3]) : year, Number(m[2]), Number(m[1]));
  if ((m = l.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MON})(?:\\s+(\\d{4}))?$`)))) { const mo = month(m[2]); return mo ? valid(m[3] ? Number(m[3]) : year, mo, Number(m[1])) : undefined; }
  if ((m = l.match(new RegExp(`^(${MON})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?$`)))) { const mo = month(m[1]); return mo ? valid(m[3] ? Number(m[3]) : year, mo, Number(m[2])) : undefined; }
  return;
}

/** What `parseAdd` read out of a line. */
export type Parsed = {
  text: string;
  tags: string[];
  urgent: boolean;
  /** The section `/name` named, matched by prefix against the known ones; an unknown `/name` stays in the text. */
  section?: string;
  /** `YYYY-MM-DD` from `d:` or the words at the end; a `d:` odak cannot read as a day is kept as written (the file takes any string). */
  deadline?: string;
  /** `YYYY-MM-DD` from `w:`, odak's wait-until date. */
  trigger?: string;
  /** The words the day was read from (`tomorrow`, `next mon`), for the preview. */
  when?: string;
};

/**
 * The add bar's grammar: `#tag` (any number, a word's start), a bare
 * `!` (urgent), `/section` (a prefix of one of `sections`; case does
 * not matter), `d:<day>` and `w:<day>` (as `parseWhen` reads them,
 * without spaces: `d:fri`, `d:2026-10-01`, `d:3d`), and the day in words
 * at the end of what remains (`parseWhen` over the last one to three
 * words, a trailing time left in the text). What is left is the text.
 */
export function parseAdd(line: string, now: number, sections: string[] = []): Parsed {
  const out: Parsed = { text: "", tags: [], urgent: false };
  let s = line.replace(/\s+/g, " ").trim();
  s = s.replace(/(^|\s)#([^\s#]+)/g, (_, pre: string, t: string) => { out.tags.push(t); return pre; });
  s = s.replace(/(^|\s)!(?=\s|$)/g, (_, pre: string) => { out.urgent = true; return pre; });
  s = s.replace(/(^|\s)([dw]):(\S+)/g, (m, pre: string, k: string, v: string) => {
    const day = parseWhen(v, now);
    const iso = day !== undefined ? isoDay(day) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    if (k === "d") { if (out.deadline) return m; out.deadline = iso ?? v; return pre; }
    if (!iso || out.trigger) return m;
    out.trigger = iso;
    return pre;
  });
  s = s.replace(/(^|\s)\/(\S+)/g, (m, pre: string, name: string) => {
    if (out.section) return m;
    const hit = sections.find((x) => x.toLowerCase().startsWith(name.toLowerCase()));
    if (!hit) return m;
    out.section = hit;
    return pre;
  });
  const words = s.split(" ").filter(Boolean);
  if (!out.deadline) {
    // The day at the end, the last one to three words (`fri`, `next mon`, `in 3 days`, `by 20 sep`); with a time after it (`next mon 9am`) the time stays.
    const end = words.length && TIME.test(words.at(-1)!) ? words.length - 1 : words.length;
    for (let n = Math.min(3, end); n >= 1; n--) {
      const tail = words.slice(end - n, end).join(" ");
      const day = parseWhen(tail, now);
      if (day === undefined) continue;
      out.deadline = isoDay(day);
      out.when = tail;
      words.splice(end - n, n);
      break;
    }
  }
  out.text = words.join(" ").trim();
  return out;
}

/** How a due day reads on a row and what colour it takes: overdue in red, today amber, tomorrow blue, the rest grey. `days` is the distance from today, negative once past. */
export type Due = { text: string; color: "red" | "amber" | "blue" | "grey"; days: number };

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** `Fri 26 Sep`, with the year when it is not this one. */
export const dayLabel = (t: number, now: number): string => (new Date(t).getFullYear() === new Date(now).getFullYear() ? dayName(t) : dayNameYear(t));

/** Whole days from today to `day` (local midnights, DST-proof through UTC). */
export const daysUntil = (day: number, now: number): number => Math.round((Date.UTC(new Date(day).getFullYear(), new Date(day).getMonth(), new Date(day).getDate()) - Date.UTC(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate())) / DAY);

/** The due tag for an odak deadline: `overdue 3 d`, `today`, `tomorrow`, `Fri` within the week, `Fri 26 Sep` beyond; a deadline that is not a day is shown as written, grey. */
export function due(deadline: string | undefined, now: number): Due | undefined {
  if (!deadline) return;
  const day = dayOf(deadline);
  if (day === undefined) return { text: deadline, color: "grey", days: NaN };
  const days = daysUntil(day, now);
  if (days < 0) return { text: `overdue ${-days} d`, color: "red", days };
  if (days === 0) return { text: "today", color: "amber", days };
  if (days === 1) return { text: "tomorrow", color: "blue", days };
  if (days < 7) return { text: DAY_SHORT[new Date(day).getDay()], color: "grey", days };
  return { text: dayLabel(day, now), color: "grey", days };
}

/** The wait-until tag for an odak trigger still ahead: `from Fri 3 Oct`; nothing once the day has come. */
export function waits(trigger: string | undefined, now: number): string | undefined {
  const day = dayOf(trigger);
  if (day === undefined || daysUntil(day, now) <= 0) return;
  return `from ${dayLabel(day, now)}`;
}

/** The first http(s) link in a todo's text, for Open link. */
export const linkIn = (text: string): string | undefined => /https?:\/\/[^\s<>()]+/.exec(text)?.[0]?.replace(/[.,;:!?]+$/, "");
