// Dates, durations and time zones: `today + 3 days`, `3 weeks from now`,
// `days until 2026-12-25`, `2026-01-01 - 2025-06-15`, `10:00 in tokyo`,
// `14:30 ist to cet`, `unix 1700000000`. Calendar math runs in the local
// zone through `Date`; zones are IANA ids behind an alias table, read and
// written with `Intl.DateTimeFormat`.
import type { Row } from "./row.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WORD = "(?:now|today|tomorrow|yesterday)";
const ISO = "\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{1,2}:\\d{2}(?::\\d{2})?)?";
const DMY = "\\d{1,2}[./]\\d{1,2}[./]\\d{4}";
const DM = `\\d{1,2}(?:st|nd|rd|th)?\\s+${MON}(?:\\s+\\d{4})?`;
const MD = `${MON}\\s+\\d{1,2}(?:st|nd|rd|th)?,?(?:\\s+\\d{4})?`;
const DATE = `(?:${WORD}|${ISO}|${DMY}|${DM}|${MD})`;
const UNIT = "(?:days?|d|weeks?|wks?|w|months?|mo|years?|yrs?|y|hours?|hrs?|h|minutes?|mins?|min|m)";
const DUR = `\\d+(?:\\.\\d+)?\\s*${UNIT}`;
const DURS = `${DUR}(?:\\s*(?:,|and)?\\s*${DUR})*`;
const COUNT = "(days?|weeks?|months?|years?|hours?|minutes?)";
const re = (s: string) => new RegExp(`^${s}$`, "i");

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

function parseDate(s: string, now = Date.now()): Moment | undefined {
  const l = s.trim().toLowerCase();
  if (l === "now") return { t: now, dateOnly: false };
  if (l === "today") return { t: midnight(now), dateOnly: true };
  if (l === "tomorrow") return { t: add(midnight(now), { n: 1, unit: "day" }), dateOnly: true };
  if (l === "yesterday") return { t: add(midnight(now), { n: -1, unit: "day" }), dateOnly: true };
  let m: RegExpMatchArray | null;
  if ((m = l.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)))
    return valid(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? undefined : [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)]);
  if ((m = l.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  if ((m = l.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})(?:\\s+(\\d{4}))?$`)))) return valid(year(m[3], now), month(m[2]), Number(m[1]));
  if ((m = l.match(new RegExp(`^(${MON})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?$`)))) return valid(year(m[3], now), month(m[1]), Number(m[2]));
  return;
}
const month = (name: string) => MONTHS.indexOf(name.slice(0, 3)) + 1;
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
  new Intl.DateTimeFormat(locale, m.dateOnly ? { dateStyle: "full", timeZone } : { dateStyle: "full", timeStyle: "short", timeZone }).format(m.t);
const fmtTime = (t: number, locale: string, timeZone?: string) => new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(t);

/** "in 3 weeks", "tomorrow", "2 hours ago": the nearest unit that reads well. */
export function relative(m: Moment, locale: string, now = Date.now()): string {
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

function countRows(a: Moment, b: Moment, unit: string, subtitle: string): Row[] {
  const u = unit.toLowerCase().replace(/s$/, "");
  const days = daysBetween(a.t, b.t);
  let n: number;
  switch (u) {
    case "week": n = Math.round((days / 7) * 10) / 10; break;
    case "month": n = monthsBetween(a.t, b.t).months; break;
    case "year": n = Math.round((days / 365.25) * 100) / 100; break;
    case "hour": n = Math.round(((b.t - a.t) / 3600e3) * 10) / 10; break;
    case "minute": n = Math.round((b.t - a.t) / 60e3); break;
    default: n = days;
  }
  const name = plural(n, u);
  const accessories = u === "day" ? breakdown(a.t, b.t).map((text) => ({ text })) : [{ text: plural(days, "day") }];
  return [{ id: "result", name, subtitle, raw: String(n), accessories }];
}

// ---- time zones ----------------------------------------------------------

/** Names people type, to IANA ids. `ist` is Istanbul here (the airport code), India is `india`/`delhi`/`mumbai`. */
const ZONES: Record<string, string> = {
  utc: "UTC", gmt: "UTC", z: "UTC", zulu: "UTC",
  cet: "Europe/Berlin", cest: "Europe/Berlin", eet: "Europe/Athens", eest: "Europe/Athens", wet: "Europe/Lisbon", bst: "Europe/London", msk: "Europe/Moscow", trt: "Europe/Istanbul",
  est: "America/New_York", edt: "America/New_York", et: "America/New_York", cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver", mt: "America/Denver", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles",
  ist: "Europe/Istanbul", jst: "Asia/Tokyo", kst: "Asia/Seoul", hkt: "Asia/Hong_Kong", sgt: "Asia/Singapore", aest: "Australia/Sydney", aedt: "Australia/Sydney", awst: "Australia/Perth", nzst: "Pacific/Auckland", nzdt: "Pacific/Auckland",
  istanbul: "Europe/Istanbul", ankara: "Europe/Istanbul", izmir: "Europe/Istanbul", turkey: "Europe/Istanbul", türkiye: "Europe/Istanbul",
  london: "Europe/London", ldn: "Europe/London", uk: "Europe/London", edinburgh: "Europe/London", manchester: "Europe/London", dublin: "Europe/Dublin", lisbon: "Europe/Lisbon",
  paris: "Europe/Paris", berlin: "Europe/Berlin", munich: "Europe/Berlin", frankfurt: "Europe/Berlin", hamburg: "Europe/Berlin", germany: "Europe/Berlin", madrid: "Europe/Madrid", barcelona: "Europe/Madrid",
  rome: "Europe/Rome", milan: "Europe/Rome", amsterdam: "Europe/Amsterdam", brussels: "Europe/Brussels", vienna: "Europe/Vienna", zurich: "Europe/Zurich", geneva: "Europe/Zurich",
  stockholm: "Europe/Stockholm", oslo: "Europe/Oslo", copenhagen: "Europe/Copenhagen", helsinki: "Europe/Helsinki", athens: "Europe/Athens", warsaw: "Europe/Warsaw", prague: "Europe/Prague",
  budapest: "Europe/Budapest", bucharest: "Europe/Bucharest", sofia: "Europe/Sofia", belgrade: "Europe/Belgrade", zagreb: "Europe/Zagreb", kyiv: "Europe/Kyiv", kiev: "Europe/Kyiv", moscow: "Europe/Moscow",
  dubai: "Asia/Dubai", riyadh: "Asia/Riyadh", tehran: "Asia/Tehran", "tel aviv": "Asia/Jerusalem", jerusalem: "Asia/Jerusalem", cairo: "Africa/Cairo", karachi: "Asia/Karachi",
  india: "Asia/Kolkata", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata", mumbai: "Asia/Kolkata", bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", kolkata: "Asia/Kolkata", chennai: "Asia/Kolkata", hyderabad: "Asia/Kolkata",
  bangkok: "Asia/Bangkok", jakarta: "Asia/Jakarta", singapore: "Asia/Singapore", "kuala lumpur": "Asia/Kuala_Lumpur", manila: "Asia/Manila", "hong kong": "Asia/Hong_Kong", hk: "Asia/Hong_Kong",
  shanghai: "Asia/Shanghai", beijing: "Asia/Shanghai", china: "Asia/Shanghai", taipei: "Asia/Taipei", seoul: "Asia/Seoul", tokyo: "Asia/Tokyo", osaka: "Asia/Tokyo", japan: "Asia/Tokyo",
  sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", canberra: "Australia/Sydney", brisbane: "Australia/Brisbane", adelaide: "Australia/Adelaide", perth: "Australia/Perth", auckland: "Pacific/Auckland",
  "new york": "America/New_York", nyc: "America/New_York", ny: "America/New_York", boston: "America/New_York", washington: "America/New_York", dc: "America/New_York", miami: "America/New_York", atlanta: "America/New_York",
  toronto: "America/Toronto", montreal: "America/Toronto", ottawa: "America/Toronto", halifax: "America/Halifax", chicago: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", austin: "America/Chicago",
  denver: "America/Denver", phoenix: "America/Phoenix", "salt lake city": "America/Denver", calgary: "America/Edmonton", edmonton: "America/Edmonton",
  "los angeles": "America/Los_Angeles", la: "America/Los_Angeles", sf: "America/Los_Angeles", "san francisco": "America/Los_Angeles", seattle: "America/Los_Angeles", vancouver: "America/Vancouver", "las vegas": "America/Los_Angeles",
  anchorage: "America/Anchorage", honolulu: "Pacific/Honolulu", hawaii: "Pacific/Honolulu", "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo", "são paulo": "America/Sao_Paulo",
  "buenos aires": "America/Argentina/Buenos_Aires", santiago: "America/Santiago", bogota: "America/Bogota", lima: "America/Lima", johannesburg: "Africa/Johannesburg", "cape town": "Africa/Johannesburg",
  nairobi: "Africa/Nairobi", lagos: "Africa/Lagos", reykjavik: "Atlantic/Reykjavik",
};
const IANA = new Map((Intl.supportedValuesOf?.("timeZone") ?? []).map((z) => [z.toLowerCase(), z]));

/** An alias, an IANA id (any case), or `utc+3` / `gmt-5:30`; undefined for anything else. */
export function zone(name: string): string | undefined {
  const l = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (ZONES[l]) return ZONES[l];
  if (IANA.has(l)) return IANA.get(l);
  const m = l.match(/^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?$/);
  if (m) {
    const h = Number(m[2]);
    if (h > 14 || m[3]) return; // whole hours only: `Etc/GMT` has no half-hour zones
    return h === 0 ? "UTC" : `Etc/GMT${m[1] === "+" ? "-" : "+"}${h}`; // IANA's sign is inverted
  }
  try { new Intl.DateTimeFormat("en", { timeZone: name }); return name; } catch { return; }
}

type Wall = { y: number; m: number; d: number; hh: number; mm: number; ss: number };
function wall(tz: string, t: number): Wall {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(t).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute), ss: Number(p.second) };
}
const offsetOf = (tz: string, t: number) => { const w = wall(tz, t); return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss) - Math.floor(t / 1000) * 1000; };
/** The instant at which `tz` reads that wall-clock time. */
function instant(tz: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const t = guess - offsetOf(tz, guess);
  return guess - offsetOf(tz, t);
}
const abbr = (tz: string, t: number, locale: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" }).formatToParts(t).find((p) => p.type === "timeZoneName")?.value ?? tz;
const city = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");
const label = (tz: string, t: number, locale: string) => `${tz === "UTC" ? "UTC" : city(tz)} (${abbr(tz, t, locale)})`;

/** `10:00`, `10am`, `5 pm`, `14:30`, `now`, `time`. */
function parseTime(s: string): { hh: number; mm: number } | "now" | undefined {
  const l = s.trim().toLowerCase();
  if (l === "now" || l === "time") return "now";
  const m = l.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return;
  let hh = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  if (m[3]) { if (hh < 1 || hh > 12) return; hh = (hh % 12) + (m[3] === "pm" ? 12 : 0); }
  if (hh > 23 || mm > 59) return;
  return { hh, mm };
}

function zoneRows(time: string, from: string | undefined, to: string, locale: string, now: number): Row[] | undefined {
  const tm = parseTime(time);
  const src = from === undefined ? Intl.DateTimeFormat().resolvedOptions().timeZone : zone(from);
  const dst = zone(to);
  if (!tm || !src || !dst) return;
  let t: number;
  if (tm === "now") t = now;
  else { const w = wall(src, now); t = instant(src, w.y, w.m, w.d, tm.hh, tm.mm); }
  const shown = tm === "now" ? fmtTime(now, locale, src) : `${pad(tm.hh)}:${pad(tm.mm)}`;
  const subtitle = `${shown} ${label(src, t, locale)} → ${label(dst, t, locale)}`;
  const dayDiff = daysOf(wall(dst, t)) - daysOf(wall(src, t));
  const accessories = [{ text: dst }, ...(dayDiff ? [{ text: dayDiff > 0 ? "next day" : "previous day" }] : [])];
  const full = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: dst }).format(t);
  return [
    { id: "result", name: fmtTime(t, locale, dst), subtitle, raw: fmtTime(t, "en", dst), accessories },
    { id: "full", name: full, subtitle: `in ${dst}`, raw: full },
  ];
}
const daysOf = (w: Wall) => Math.round(Date.UTC(w.y, w.m - 1, w.d) / 86400e3);

// ---- the entry ----------------------------------------------------------

/** Rows for a date, time or zone query; undefined when the query is none of these. */
export function dates(q: string, locale: string, now = Date.now()): Row[] | undefined {
  let m: RegExpMatchArray | null;
  const l = q.trim();

  // Time zones: `14:30 ist to cet`, `10:00 in tokyo`, `now in utc`, `time in tokyo`, `tokyo time`.
  if ((m = l.match(/^(now|time|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:in\s+)?(.+?)\s+(?:to|in)\s+(.+)$/i)) && parseTime(m[1]) && zone(m[2]) && zone(m[3]))
    return zoneRows(m[1], m[2], m[3], locale, now);
  if ((m = l.match(/^(now|time|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:in|at|to)\s+(.+)$/i)) && parseTime(m[1]) && zone(m[2])) return zoneRows(m[1], undefined, m[2], locale, now);
  if ((m = l.match(/^(.+?)\s+time$/i)) && zone(m[1])) return zoneRows("now", undefined, m[1], locale, now);

  // Unix time: `unix 1700000000`, `1700000000 to date`, `unix now`, `2026-01-01 to unix`.
  if ((m = l.match(/^(?:unix|epoch)\s+(\d{9,13})$/i)) || (m = l.match(/^(\d{9,13})\s+(?:to|as|in)\s+(?:date|time|datetime|iso)$/i))) {
    const n = Number(m[1]);
    const t = m[1].length > 11 ? n : n * 1000;
    return momentRows({ t, dateOnly: false }, `unix ${m[1]}`, locale, now);
  }
  if (/^(?:unix|epoch)(?:\s+(?:time|now))?$/i.test(l) || /^now\s+(?:to|as|in)\s+(?:unix|epoch)$/i.test(l))
    return [{ id: "result", name: String(Math.floor(now / 1000)), subtitle: "unix time now", raw: String(Math.floor(now / 1000)), accessories: [{ text: fmtDate({ t: now, dateOnly: false }, locale) }] }];
  if ((m = l.match(re(`(${DATE})\\s+(?:to|as|in)\\s+(?:unix|epoch)`))) || (m = l.match(re(`(?:unix|epoch)\\s+(${DATE})`)))) {
    const d = parseDate(m[1], now);
    if (!d) return []; // date-shaped but no such date: nothing, not mathjs
    return [{ id: "result", name: String(Math.floor(d.t / 1000)), subtitle: `${iso(d)} as unix time`, raw: String(Math.floor(d.t / 1000)) }];
  }

  // Counts: `days until 2026-12-25`, `weeks since 1 jan`, `until 25 dec`.
  if ((m = l.match(re(`${COUNT}\\s+(until|till|to|since|from|after|before)\\s+(${DATE})`))) || (m = l.match(re(`()(until|till)\\s+(${DATE})`)))) {
    const d = parseDate(m[3], now);
    if (!d) return []; // date-shaped but no such date: nothing, not mathjs
    const today = d.dateOnly ? { t: midnight(now), dateOnly: true } : { t: now, dateOnly: false };
    const since = /since|from|after/i.test(m[2]);
    const [a, b] = since ? [d, today] : [today, d];
    return countRows(a, b, m[1] || "days", `${m[1] || "days"} ${m[2]} ${fmtDate(d, locale)}`);
  }
  // Between: `2026-01-01 - 2025-06-15`, `1 jan to 25 dec`, `weeks between A and B`.
  if ((m = l.match(re(`(?:${COUNT}\\s+)?(?:between\\s+)?(${DATE})\\s*(-|to|until|till|and)\\s*(${DATE})`)))) {
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
  // A date on its own: `today`, `now`, `2026-12-25`, `25 dec`.
  if ((m = l.match(re(`(${DATE})`)))) {
    const d = parseDate(m[1], now);
    if (!d) return []; // date-shaped but no such date: nothing, not mathjs
    if (l.toLowerCase() === "now") {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return [
        { id: "result", name: fmtTime(now, locale), subtitle: `now in ${tz}`, raw: iso(d), accessories: [{ text: fmtDate({ t: now, dateOnly: true }, locale) }] },
        { id: "iso", name: iso(d), subtitle: "ISO 8601", raw: iso(d) },
        { id: "unix", name: String(Math.floor(now / 1000)), subtitle: "unix time", raw: String(Math.floor(now / 1000)) },
      ];
    }
    return momentRows(d, l, locale, now);
  }
  return;
}
