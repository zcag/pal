// Dates and durations: `today + 3 days`, `next friday`, `days until 25
// dec`, `workdays until 25 aralık`, `2026-01-01 - 2025-06-15`, `what week
// is it`, `what day is 2027-01-01`, `@1759000000`, `3h20m + 45m`; time
// zones are `zones.ts`. Calendar math runs in the local zone through
// `Date`; `now` is the caller's (the SDK's clock, which a test pins).
// Month and day names are English or Turkish (`25 aralık`, `gelecek cuma`),
// with or without the Turkish letters.
import { dayName, dayNameYear } from "@zcag/pal";
import type { Row } from "./row.ts";
import { zoneQuery, zoneRows } from "./zones.ts";

/** Lower-cased names to a number, each line's words numbered from `from`. */
const numbered = (lines: string[], from = 0) => Object.fromEntries(lines.flatMap((line) => line.split(" ").map((w, i) => [w, i + from] as const)).filter(([w]) => w !== "-"));
const MONTH_OF: Record<string, number> = numbered([
  "january february march april may june july august september october november december",
  "jan feb mar apr - jun jul aug sep oct nov dec",
  "- - - - - june july - sept - - -",
  "ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık",
  "- subat - - mayis - - agustos eylul - kasim aralik",
], 1);
const WEEKDAY_OF: Record<string, number> = numbered([
  "sunday monday tuesday wednesday thursday friday saturday",
  "sun mon tue wed thu fri sat",
  "- - tues - thur - -",
  "- - - - thurs - -",
  "pazar pazartesi salı çarşamba perşembe cuma cumartesi",
  "- - sali carsamba persembe - -",
]);
const alt = (o: object) => `(?:${Object.keys(o).sort((a, b) => b.length - a.length).join("|")})`;
const MON = alt(MONTH_OF);
const NEXT = "next|coming|gelecek|önümüzdeki", LAST = "last|previous|geçen|gecen", THIS = "this|bu";
const WD = `(?:(?:${NEXT}|${LAST}|${THIS})\\s+)?${alt(WEEKDAY_OF)}`;
const PERIOD = `(?:${NEXT}|${LAST})\\s+(?:week|month|year|hafta|ay|yıl|yil)`;
const WORD = `(?:now|today|tomorrow|yesterday|${PERIOD}|${WD})`;
const ISO = "\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{1,2}:\\d{2}(?::\\d{2})?)?";
const DMY = "\\d{1,2}[./]\\d{1,2}[./]\\d{4}";
const DM = `\\d{1,2}(?:st|nd|rd|th)?\\.?\\s+${MON}(?:\\s+\\d{4})?`;
const MD = `${MON}\\s+\\d{1,2}(?:st|nd|rd|th)?,?(?:\\s+\\d{4})?`;
const DATE = `(?:${WORD}|${ISO}|${DMY}|${DM}|${MD})`;
const UNIT = "(?:days?|d|weeks?|wks?|w|months?|mo|years?|yrs?|y|hours?|hrs?|h|minutes?|mins?|min|m)";
const DUR = `\\d+(?:\\.\\d+)?\\s*${UNIT}`;
const DURS = `${DUR}(?:\\s*(?:,|and)?\\s*${DUR})*`;
const COUNT = "(days?|weeks?|months?|years?|hours?|minutes?|workdays?|work days?|working days?|business days?|weekdays?)";
const re = (s: string) => new RegExp(`^${s}$`, "i");
/** Lower case that leaves `İ` an `i` (JS writes it `i̇`, two code units). */
const lower = (s: string) => s.replace(/İ/g, "i").toLowerCase();

type Moment = { t: number; dateOnly: boolean };
type Dur = { n: number; unit: "day" | "week" | "month" | "year" | "hour" | "minute" };

const UNIT_OF: Record<string, Dur["unit"]> = { d: "day", w: "week", wk: "week", mo: "month", y: "year", yr: "year", h: "hour", hr: "hour", m: "minute", min: "minute" };
const unitOf = (u: string): Dur["unit"] => {
  const l = u.toLowerCase();
  return UNIT_OF[l] ?? UNIT_OF[l.replace(/s$/, "")] ?? (l.replace(/s$/, "") as Dur["unit"]);
};
const durations = (s: string): Dur[] => [...s.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT})`, "gi"))].map((m) => ({ n: Number(m[1]), unit: unitOf(m[2]) }));

const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const local = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0) => new Date(y, m - 1, d, hh, mm, ss).getTime();

function parseDate(s: string, now: number): Moment | undefined {
  const l = lower(s.trim()).replace(/\s+/g, " ");
  const today = midnight(now), day = (n: number): Moment => ({ t: add(today, { n, unit: "day" }), dateOnly: true });
  if (l === "now") return { t: now, dateOnly: false };
  if (l === "today") return day(0);
  if (l === "tomorrow") return day(1);
  if (l === "yesterday") return day(-1);
  let m: RegExpMatchArray | null;
  // `next week` is a week from today, `last month` a month back.
  if ((m = l.match(re(`(${NEXT}|${LAST})\\s+(week|month|year|hafta|ay|yıl|yil)`)))) {
    const unit = ({ hafta: "week", ay: "month", yıl: "year", yil: "year" } as Record<string, Dur["unit"]>)[m[2]] ?? (m[2] as Dur["unit"]);
    return { t: add(today, { n: new RegExp(`^(?:${LAST})$`).test(m[1]) ? -1 : 1, unit }), dateOnly: true };
  }
  // `friday` and `this friday` are the coming one (today on a Friday), `next friday` the one after today, `last friday` the one before.
  if ((m = l.match(re(`(?:(${NEXT}|${LAST}|${THIS})\\s+)?(${alt(WEEKDAY_OF)})`)))) {
    let diff = (WEEKDAY_OF[m[2]] - new Date(today).getDay() + 7) % 7;
    if (m[1] && new RegExp(`^(?:${LAST})$`).test(m[1])) diff = diff ? diff - 7 : -7;
    else if (m[1] && new RegExp(`^(?:${NEXT})$`).test(m[1]) && !diff) diff = 7;
    return day(diff);
  }
  if ((m = l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)))
    return valid(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? undefined : [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]);
  if ((m = l.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  if ((m = l.match(re(`(\\d{1,2})(?:st|nd|rd|th)?\\.?\\s+(${MON})(?:\\s+(\\d{4}))?`)))) return valid(year(m[3], now), MONTH_OF[m[2]], Number(m[1]));
  if ((m = l.match(re(`(${MON})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?`)))) return valid(year(m[3], now), MONTH_OF[m[1]], Number(m[2]));
  return;
}
const year = (y: string | undefined, now: number) => (y ? Number(y) : new Date(now).getFullYear());
function valid(y: number, m: number, d: number, time?: [number, number, number]): Moment | undefined {
  const t = local(y, m, d, ...(time ?? []));
  const dt = new Date(t);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return;
  if (time && (time[0] > 23 || time[1] > 59)) return;
  return { t, dateOnly: !time };
}

/** Calendar arithmetic in the local zone: months and years keep the day (clamped), hours and minutes are exact. */
function add(t: number, { n, unit }: Dur): number {
  const d = new Date(t);
  switch (unit) {
    case "day": d.setDate(d.getDate() + n); break;
    case "week": d.setDate(d.getDate() + n * 7); break;
    case "month": setMonths(d, n); break;
    case "year": setMonths(d, n * 12); break;
    case "hour": return t + n * 3600e3;
    case "minute": return t + n * 60e3;
  }
  return d.getTime();
}
function setMonths(d: Date, n: number) {
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
}
const timed = (unit: Dur["unit"]) => unit === "hour" || unit === "minute";

/** Whole days between two local dates, DST-proof (UTC midnights). */
const daysBetween = (a: number, b: number) => {
  const u = (t: number) => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  return Math.round((u(b) - u(a)) / 86400e3);
};
/** Calendar months between, then the days left over. */
function monthsBetween(a: number, b: number): { months: number; days: number } {
  if (b < a) { const r = monthsBetween(b, a); return { months: -r.months, days: -r.days }; }
  const da = new Date(a), db = new Date(b);
  let months = (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth();
  if (db.getDate() < da.getDate()) months--;
  const anchor = new Date(a); setMonths(anchor, months);
  return { months, days: daysBetween(anchor.getTime(), b) };
}

// ---- formatting ---------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
/** `2026-09-16T21:21:00+03:00` for a moment with a time, `2026-09-16` for a date. */
export function iso({ t, dateOnly }: Moment): string {
  const d = new Date(t);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (dateOnly) return date;
  const off = -d.getTimezoneOffset();
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
const fmtDate = (m: Moment, locale: string, timeZone?: string) =>
  new Intl.DateTimeFormat(locale, m.dateOnly ? { dateStyle: "full", timeZone } : { dateStyle: "full", timeStyle: "short", hourCycle: "h23", timeZone }).format(m.t);
/** 24 h whatever the locale, as pal writes every time (the SDK's clock.ts). */
const fmtTime = (t: number, locale: string, timeZone?: string) => new Intl.DateTimeFormat(locale, { timeStyle: "short", hourCycle: "h23", timeZone }).format(t);

/** "in 3 weeks", "tomorrow", "2 hours ago": the nearest unit that reads well. */
export function relative(m: Moment, locale: string, now: number): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const days = daysBetween(now, m.t);
  if (days === 0 && !m.dateOnly) {
    const mins = Math.round((m.t - now) / 60e3);
    if (Math.abs(mins) < 1) return rtf.format(0, "second");
    if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
    return rtf.format(Math.round(mins / 60), "hour");
  }
  const a = Math.abs(days);
  if (a < 7) return rtf.format(days, "day");
  if (a < 30) return rtf.format(Math.round(days / 7), "week");
  if (a < 365) return rtf.format(Math.round(days / 30.4375), "month");
  return rtf.format(Math.round(days / 365.25), "year");
}

const plural = (n: number, unit: string) => `${n} ${unit}${Math.abs(n) === 1 ? "" : "s"}`;
/** `28 weeks 3 days`, `6 months 17 days`: what a day count is in larger units. */
function breakdown(a: number, b: number): string[] {
  const days = daysBetween(a, b), sign = days < 0 ? -1 : 1, ad = Math.abs(days);
  const out: string[] = [];
  if (ad >= 7) out.push(`${plural(sign * Math.floor(ad / 7), "week")}${ad % 7 ? " " + plural(ad % 7, "day") : ""}`);
  const { months, days: rest } = monthsBetween(a, b);
  if (Math.abs(months) >= 1) out.push(`${plural(months, "month")}${rest ? " " + plural(Math.abs(rest), "day") : ""}`);
  return out;
}

function momentRows(m: Moment, subtitle: string, locale: string, now: number): Row[] {
  const rows: Row[] = [{ id: "result", name: fmtDate(m, locale), subtitle, raw: iso(m), accessories: [{ text: relative(m, locale, now) }] }];
  rows.push({ id: "iso", name: iso(m), subtitle: "ISO 8601", raw: iso(m) });
  if (!m.dateOnly) rows.push({ id: "unix", name: String(Math.floor(m.t / 1000)), subtitle: "unix time", raw: String(Math.floor(m.t / 1000)) });
  return rows;
}

/** Monday to Friday in [a, b) by local date, negative when b is before a. Holidays are not known. */
function workdays(a: number, b: number): number {
  if (b < a) return -workdays(b, a);
  const days = daysBetween(a, b), start = new Date(a).getDay();
  let n = Math.floor(days / 7) * 5;
  for (let i = 0; i < days % 7; i++) { const wd = (start + i) % 7; if (wd !== 0 && wd !== 6) n++; }
  return n;
}

function countRows(a: Moment, b: Moment, unit: string, subtitle: string): Row[] {
  const l = unit.toLowerCase();
  const u = /work|business|weekday/.test(l) ? "workday" : l.replace(/s$/, "");
  const days = daysBetween(a.t, b.t);
  let n: number;
  switch (u) {
    case "workday": n = workdays(a.t, b.t); break;
    case "week": n = Math.round((days / 7) * 10) / 10; break;
    case "month": n = monthsBetween(a.t, b.t).months; break;
    case "year": n = Math.round((days / 365.25) * 100) / 100; break;
    case "hour": n = Math.round(((b.t - a.t) / 3600e3) * 10) / 10; break;
    case "minute": n = Math.round((b.t - a.t) / 60e3); break;
    default: n = days;
  }
  const accessories = u === "day" ? breakdown(a.t, b.t).map((text) => ({ text })) : u === "workday" ? [{ text: plural(days, "day") }, { text: "Mon to Fri, holidays not counted" }] : [{ text: plural(days, "day") }];
  return [{ id: "result", name: plural(n, u), subtitle, raw: String(n), accessories }];
}

// ---- weeks --------------------------------------------------------------

/** Local midnight of the Monday that starts ISO week 1 of `y` (the week with 4 January in it). */
const week1 = (y: number) => { const j4 = new Date(y, 0, 4); return local(y, 1, 4 - ((j4.getDay() + 6) % 7)); };
/** The ISO week a day is in, and the year that week belongs to (29 Dec can be week 1 of the next). */
function isoWeek(t: number): { year: number; week: number } {
  const d = new Date(t), thu = local(d.getFullYear(), d.getMonth() + 1, d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const year = new Date(thu).getFullYear();
  return { year, week: Math.floor(daysBetween(week1(year), thu) / 7) + 1 };
}
const weeksIn = (y: number) => isoWeek(local(y, 12, 28)).week;

function weekRows(year: number, week: number, subtitle: string, now: number): Row[] {
  const mon = add(week1(year), { n: (week - 1) * 7, unit: "day" }), sun = add(mon, { n: 6, unit: "day" });
  const range = `${dayName(mon)} to ${new Date(sun).getFullYear() === new Date(now).getFullYear() ? dayName(sun) : dayNameYear(sun)}`;
  const code = `${year}-W${pad(week)}`;
  return [
    { id: "result", name: `Week ${week}`, subtitle: `${subtitle}: ${range}`, raw: String(week), accessories: [{ text: `of ${weeksIn(year)} in ${year}` }] },
    { id: "iso", name: code, subtitle: "ISO 8601 week", raw: code },
    { id: "start", name: iso({ t: mon, dateOnly: true }), subtitle: "its Monday", raw: iso({ t: mon, dateOnly: true }) },
  ];
}

// ---- durations ----------------------------------------------------------

/** Seconds in each unit a duration sum takes; `m` is minutes only beside an hour (alone it is metres, mathjs's). */
const SPAN: [RegExp, number, string][] = [[/^(?:d|days?)$/, 86400, "d"], [/^(?:h|hrs?|hours?)$/, 3600, "h"], [/^(?:m|mins?|minutes?)$/, 60, "m"], [/^(?:s|secs?|seconds?)$/, 1, "s"]];
const SPAN_UNIT = "(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)";
const TERM = `\\d+(?:\\.\\d+)?\\s*${SPAN_UNIT}(?:\\s*\\d+(?:\\.\\d+)?\\s*${SPAN_UNIT})*`;
const SUM = re(`(${TERM}(?:\\s*[+-]\\s*${TERM})*)(?:\\s+(?:to|in|as)\\s+(days?|hours?|hrs?|h|minutes?|mins?|min|seconds?|secs?|s))?`);
const spanOf = (u: string) => SPAN.find(([r]) => r.test(u.toLowerCase()))!;

/** `3h20m + 45m`, `2 hours + 30 minutes`, `90 min in hours`, `1h30m to minutes`: the total as `4 h 5 min`, or in the unit asked for. */
function durationRows(q: string, locale: string): Row[] | undefined {
  const m = q.match(SUM);
  if (!m) return;
  const terms = [...m[1].matchAll(new RegExp(`(^|[+-])\\s*(${TERM})`, "gi"))];
  const units = terms.flatMap((t) => [...t[2].matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${SPAN_UNIT})`, "gi"))].map((x) => ({ sign: t[1] === "-" ? -1 : 1, n: Number(x[1]), u: spanOf(x[2]) })));
  const short = units.map((x) => x.u[2]);
  // A time duration: an hour, a written-out minute or a second in it; `5m + 3m` and `3d` are left to mathjs.
  if (!short.includes("h") && !short.includes("s") && !/min/i.test(m[1])) return;
  const secs = units.reduce((a, x) => a + x.sign * x.n * x.u[1], 0);
  const fmt = (x: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(x);
  const text = hms(secs), clockForm = `${secs < 0 ? "-" : ""}${Math.floor(Math.abs(secs) / 3600)}:${pad(Math.floor((Math.abs(secs) % 3600) / 60))}${Math.abs(secs) % 60 ? `:${pad(Math.round(Math.abs(secs) % 60))}` : ""}`;
  const subtitle = q.trim().replace(/\s+/g, " ");
  const inUnit = (u: [RegExp, number, string]) => { const name = { d: "day", h: "hour", m: "minute", s: "second" }[u[2]]!; const v = secs / u[1]; return { name: `${fmt(v)} ${name}${Math.abs(v) === 1 ? "" : "s"}`, raw: String(Math.round(v * 1e4) / 1e4) }; };
  if (m[2]) {
    const r = inUnit(spanOf(m[2]));
    return [{ id: "result", name: r.name, subtitle, raw: r.raw, accessories: [{ text: text }] }, { id: "clock", name: clockForm, subtitle: "hours:minutes", raw: clockForm }];
  }
  const mins = inUnit(SPAN[2]), hours = inUnit(SPAN[1]);
  return [
    { id: "result", name: text, subtitle, raw: clockForm, accessories: [{ text: clockForm }] },
    { id: "minutes", name: mins.name, subtitle: "in minutes", raw: mins.raw },
    { id: "hours", name: hours.name, subtitle: "in hours", raw: hours.raw },
  ];
}
/** `4 h 5 min`, `1 d 2 h`, `45 s`. */
function hms(secs: number): string {
  let s = Math.round(Math.abs(secs));
  const parts: string[] = [];
  for (const [unit, n] of [["d", 86400], ["h", 3600], ["min", 60], ["s", 1]] as const) if (s >= n) { parts.push(`${Math.floor(s / n)} ${unit}`); s %= n; }
  return (secs < 0 ? "-" : "") + (parts.join(" ") || "0 min");
}

// ---- the entry ----------------------------------------------------------

/** `@` and a unix time, or a bare one from 2001 to 2033 (10 digits starting with 1, 13 for ms): a date, not a number, even at the root. */
const UNIX = /^@?(\d{9,13})$/;
const BARE_UNIX = /^1(?:\d{9}|\d{12})$/;
export const isUnix = (q: string) => { const s = q.trim(); return s.startsWith("@") ? UNIX.test(s) : BARE_UNIX.test(s); };

/** Rows for a date, time or zone query; undefined when the query is none of these. */
export function dates(q: string, locale: string, now: number): Row[] | undefined {
  let m: RegExpMatchArray | null;
  const l = q.trim().replace(/\?$/, "").trim();

  const z = zoneQuery(l);
  if (z) return zoneRows(z, locale, now);

  // Unix time: `@1759000000`, `1759000000`, `unix 1700000000`, `1700000000 to date`, `unix now`, `2026-01-01 to unix`.
  if ((isUnix(l) && (m = l.match(UNIX))) || (m = l.match(/^(?:unix|epoch)\s+(\d{9,13})$/i)) || (m = l.match(/^(\d{9,13})\s+(?:to|as|in)\s+(?:date|time|datetime|iso)$/i))) {
    const t = m[1].length > 11 ? Number(m[1]) : Number(m[1]) * 1000;
    return momentRows({ t, dateOnly: false }, `unix ${m[1]}`, locale, now);
  }
  if (/^(?:(?:current\s+)?(?:unix|epoch)(?:\s+(?:time|timestamp|now))?|now\s+(?:to|as|in)\s+(?:unix|epoch))$/i.test(l))
    return [{ id: "result", name: String(Math.floor(now / 1000)), subtitle: "unix time now", raw: String(Math.floor(now / 1000)), accessories: [{ text: fmtDate({ t: now, dateOnly: false }, locale) }] }];
  if ((m = l.match(re(`(${DATE})\\s+(?:to|as|in)\\s+(?:unix|epoch)`))) || (m = l.match(re(`(?:unix|epoch)\\s+(${DATE})`)))) {
    const d = parseDate(m[1], now);
    if (!d) return []; // date-shaped but no such date: nothing, not mathjs
    return [{ id: "result", name: String(Math.floor(d.t / 1000)), subtitle: `${iso(d)} as unix time`, raw: String(Math.floor(d.t / 1000)) }];
  }

  // Weeks: `what week is it`, `week number`, `week of 25 dec`, `week 42`, `week 1 2027`.
  if (/^(?:what(?:'s|\s+is)?\s+(?:the\s+)?(?:current\s+)?week(?:\s+(?:number|no))?(?:\s+is\s+it)?(?:\s+(?:now|today))?|(?:current\s+|iso\s+|this\s+)?week\s*(?:number|no\.?|#)|week)$/i.test(l)) {
    const w = isoWeek(now);
    return weekRows(w.year, w.week, "this week", now);
  }
  if ((m = l.match(re(`(?:what\\s+week\\s+is|(?:iso\\s+)?week(?:\\s*(?:number|no\\.?|#))?\\s+(?:of|for))\\s+(${DATE})`)))) {
    const d = parseDate(m[1], now);
    if (!d) return [];
    const w = isoWeek(d.t);
    return weekRows(w.year, w.week, `the week of ${dayName(d.t)}`, now);
  }
  if ((m = l.match(/^week\s+(\d{1,2})(?:\s+(?:of\s+)?(\d{4}))?$/i))) {
    const y = m[2] ? Number(m[2]) : new Date(now).getFullYear(), w = Number(m[1]);
    if (w < 1 || w > weeksIn(y)) return [];
    return weekRows(y, w, `week ${w} of ${y}`, now);
  }
  // `what day is 2027-01-01`, `day of week 25 dec`: the weekday first.
  if ((m = l.match(re(`(?:what\\s+day\\s+(?:of\\s+the\\s+week\\s+)?(?:is|was|will\\s+be)|(?:day\\s+of\\s+(?:the\\s+)?week|weekday)\\s+(?:of\\s+|for\\s+)?)\\s*(${DATE})(?:\\s+(?:be|fall|fall\\s+on))?`)))) {
    const d = parseDate(m[1], now);
    if (!d) return [];
    const [first, ...rest] = momentRows(d, "", locale, now);
    return [{ ...first, name: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(d.t), subtitle: fmtDate(d, locale), raw: new Intl.DateTimeFormat("en", { weekday: "long" }).format(d.t) }, ...rest];
  }

  // Counts: `days until 2026-12-25`, `weeks since 1 jan`, `workdays until friday`, `until 25 dec`.
  if ((m = l.match(re(`${COUNT}\\s+(until|till|to|since|from|after|before|left\\s+until)\\s+(${DATE})`))) || (m = l.match(re(`()(until|till)\\s+(${DATE})`)))) {
    const d = parseDate(m[3], now);
    if (!d) return []; // date-shaped but no such date: nothing, not mathjs
    const today = d.dateOnly ? { t: midnight(now), dateOnly: true } : { t: now, dateOnly: false };
    const since = /since|from|after/i.test(m[2]);
    const [a, b] = since ? [d, today] : [today, d];
    return countRows(a, b, m[1] || "days", `${m[1] || "days"} ${m[2]} ${fmtDate(d, locale)}`);
  }
  // Between: `2026-01-01 - 2025-06-15`, `1 jan to 25 dec`, `weeks between A and B`.
  if ((m = l.match(re(`(?:${COUNT}\\s+)?(?:between\\s+|from\\s+)?(${DATE})\\s*(-|to|until|till|and)\\s*(${DATE})`)))) {
    const a = parseDate(m[2], now), b = parseDate(m[4], now);
    if (!a || !b) return [];
    const [from, to] = m[3] === "-" ? [b, a] : [a, b]; // `A - B` is A minus B: the time from B to A
    const unit = m[1] ?? (from.dateOnly && to.dateOnly ? "days" : "hours");
    return countRows(from, to, unit, `${fmtDate(from, locale)} → ${fmtDate(to, locale)}`);
  }

  // Arithmetic: `today + 3 days`, `now - 2 hours`, `2026-12-25 - 1 week`.
  if ((m = l.match(re(`(${DATE})((?:\\s*[+-]\\s*${DUR})+)`)))) {
    const d = parseDate(m[1], now);
    if (!d) return []; // date-shaped but no such date: nothing, not mathjs
    let t = d.t, dateOnly = d.dateOnly;
    for (const [, sign, dur] of m[2].matchAll(new RegExp(`([+-])\\s*(${DUR})`, "gi"))) {
      for (const x of durations(dur)) { t = add(t, { ...x, n: sign === "-" ? -x.n : x.n }); if (timed(x.unit)) dateOnly = false; }
    }
    return momentRows({ t, dateOnly }, l.replace(/\s+/g, " "), locale, now);
  }
  // Relative: `3 weeks from now`, `in 3 weeks`, `2 days ago`, `2 weeks before 25 dec`, `3 days after today`.
  if ((m = l.match(re(`(${DURS})\\s+(from|after|before)\\s+(${DATE})`))) || (m = l.match(re(`in\\s+(${DURS})()()`))) || (m = l.match(re(`(${DURS})\\s+(ago)()`)))) {
    const ds = durations(m[1]);
    const base = m[3] ? parseDate(m[3], now) : ds.some((x) => timed(x.unit)) ? { t: now, dateOnly: false } : { t: midnight(now), dateOnly: true };
    if (!base) return [];
    const back = /before|ago/i.test(m[2]);
    let t = base.t, dateOnly = base.dateOnly;
    for (const x of ds) { t = add(t, { ...x, n: back ? -x.n : x.n }); if (timed(x.unit)) dateOnly = false; }
    return momentRows({ t, dateOnly }, l.replace(/\s+/g, " "), locale, now);
  }
  const span = durationRows(l, locale);
  if (span) return span;
  // A date on its own: `today`, `now`, `2026-12-25`, `25 dec`, `next friday`.
  if ((m = l.match(re(`(${DATE})`)))) {
    const d = parseDate(m[1], now);
    if (!d) return []; // date-shaped but no such date: nothing, not mathjs
    if (l.toLowerCase() === "now") {
      return [
        { id: "result", name: fmtTime(now, locale), subtitle: `now in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`, raw: iso(d), accessories: [{ text: fmtDate({ t: now, dateOnly: true }, locale) }] },
        { id: "iso", name: iso(d), subtitle: "ISO 8601", raw: iso(d) },
        { id: "unix", name: String(Math.floor(now / 1000)), subtitle: "unix time", raw: String(Math.floor(now / 1000)) },
      ];
    }
    return momentRows(d, l, locale, now);
  }
  return;
}
