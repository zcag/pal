// Time zones: `3pm istanbul to new york`, `10:00 in tokyo`, `now in pst`,
// `time in tokyo`, `tokyo time`, `3pm tokyo`. A zone is an IANA id behind
// an alias and city table, read and written with `Intl.DateTimeFormat`
// (the runtime's tz data, no network); the local zone is the system's.
import type { Row } from "./row.ts";

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
  // Turkish spellings of the places above.
  londra: "Europe/London", moskova: "Europe/Moscow", atina: "Europe/Athens", roma: "Europe/Rome", viyana: "Europe/Vienna", brüksel: "Europe/Brussels", lizbon: "Europe/Lisbon", varşova: "Europe/Warsaw", prag: "Europe/Prague",
  kahire: "Africa/Cairo", tahran: "Asia/Tehran", pekin: "Asia/Shanghai", "yeni delhi": "Asia/Kolkata", almanya: "Europe/Berlin", fransa: "Europe/Paris", ingiltere: "Europe/London", japonya: "Asia/Tokyo", çin: "Asia/Shanghai", amerika: "America/New_York",
};
const IANA = new Map((Intl.supportedValuesOf?.("timeZone") ?? []).map((z) => [z.toLowerCase(), z]));
/** Every IANA id by its city, `caracas` for America/Caracas, `ho chi minh` for Asia/Ho_Chi_Minh: the places the table above does not name. */
const CITIES = new Map([...IANA.values()].filter((z) => z.includes("/")).map((z) => [city(z).toLowerCase(), z]));

/** An alias, a city, an IANA id (any case), or `utc+3` / `gmt-5`; undefined for anything else. */
export function zone(name: string): string | undefined {
  const l = name.trim().replace(/İ/g, "i").toLowerCase().replace(/\s+/g, " ");
  const known = ZONES[l] ?? IANA.get(l) ?? CITIES.get(l);
  if (known) return known;
  const m = l.match(/^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?$/);
  if (m) {
    const h = Number(m[2]);
    if (h > 14 || m[3]) return; // whole hours only: `Etc/GMT` has no half-hour zones
    return h === 0 ? "UTC" : `Etc/GMT${m[1] === "+" ? "-" : "+"}${h}`; // IANA's sign is inverted
  }
  if (!l.includes("/")) return; // what Intl would take besides: only ids, which IANA holds unless this runtime lists fewer
  try { new Intl.DateTimeFormat("en", { timeZone: name }); return name; } catch { return; }
}

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type Wall = { y: number; m: number; d: number; hh: number; mm: number; ss: number };
export function wall(tz: string, t: number): Wall {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(t).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute), ss: Number(p.second) };
}
/** `tz`'s offset from UTC at `t`, in ms. */
const offsetOf = (tz: string, t: number) => { const w = wall(tz, t); return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss) - Math.floor(t / 1000) * 1000; };
/** The instant at which `tz` reads that wall-clock time. */
function instant(tz: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const t = guess - offsetOf(tz, guess);
  return guess - offsetOf(tz, t);
}
const abbr = (tz: string, t: number, locale: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" }).formatToParts(t).find((p) => p.type === "timeZoneName")?.value ?? tz;
function city(tz: string) { return tz.split("/").pop()!.replace(/_/g, " "); }
const label = (tz: string, t: number, locale: string) => `${tz === "UTC" ? "UTC" : city(tz)} (${abbr(tz, t, locale)})`;
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (w: { hh: number; mm: number }) => `${pad(w.hh)}:${pad(w.mm)}`;
const dayNo = (w: Wall) => Math.round(Date.UTC(w.y, w.m - 1, w.d) / 86400e3);

/** `2026-09-16T21:00:00+09:00`: the moment as `tz` writes it. */
export function isoIn(tz: string, t: number): string {
  const w = wall(tz, t), off = Math.round(offsetOf(tz, t) / 60e3), a = Math.abs(off);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${hm(w)}:${pad(w.ss)}${off < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** `6 h ahead`, `2 h 30 min behind`, `same time`: `b`'s clock against `a`'s. */
function gap(a: string, b: string, t: number): string {
  const mins = Math.round((offsetOf(b, t) - offsetOf(a, t)) / 60e3), x = Math.abs(mins);
  if (!mins) return "same time";
  return `${Math.floor(x / 60) ? `${Math.floor(x / 60)} h` : ""}${x % 60 ? ` ${x % 60} min` : ""}`.trim() + (mins > 0 ? " ahead" : " behind");
}

/** `10:00`, `10am`, `5 pm`, `14:30`, `noon`, `midnight`, `now`, `time`. */
export function parseTime(s: string): { hh: number; mm: number } | "now" | undefined {
  const l = s.trim().toLowerCase();
  if (l === "now" || l === "time") return "now";
  if (l === "noon") return { hh: 12, mm: 0 };
  if (l === "midnight") return { hh: 0, mm: 0 };
  const m = l.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return;
  let hh = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  if (m[3]) { if (hh < 1 || hh > 12) return; hh = (hh % 12) + (m[3] === "pm" ? 12 : 0); }
  if (hh > 23 || mm > 59) return;
  return { hh, mm };
}

const TIME = "(now|time|noon|midnight|\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm)?)";

/**
 * A time zone query read into its parts, or undefined: `3pm istanbul to
 * new york`, `10:00 in tokyo`, `now in pst`, `time in tokyo`, `tokyo time`,
 * `3pm tokyo` / `3pm tokyo time` (Tokyo's 3pm here). `from`/`to` undefined
 * is the local zone.
 */
export type ZoneQuery = { time: string; from?: string; to?: string };
export function zoneQuery(q: string): ZoneQuery | undefined {
  const l = q.trim();
  let m: RegExpMatchArray | null;
  const ok = (time: string, from?: string, to?: string) => (parseTime(time) && (from === undefined || zone(from)) && (to === undefined || zone(to)) ? { time, from, to } : undefined);
  if ((m = l.match(new RegExp(`^${TIME}\\s+(?:in\\s+)?(.+?)\\s+(?:to|in)\\s+(.+)$`, "i")))) { const r = ok(m[1], m[2], m[3]); if (r) return r; }
  if ((m = l.match(new RegExp(`^${TIME}\\s+(?:in|at|to)\\s+(.+)$`, "i")))) return ok(m[1], undefined, m[2]);
  if ((m = l.match(/^(?:what\s+)?time\s+(?:is\s+it\s+)?in\s+(.+?)\??$/i)) || (m = l.match(/^(?:now|current time)\s+(.+)$/i))) return ok("now", undefined, m[1]);
  if ((m = l.match(/^(.+?)\s+time$/i)) && zone(m[1])) return { time: "now", to: m[1] };
  // `3pm tokyo`: the time written as one (`15:00`, `3pm`, `noon`), not a bare number, so `12 usd` stays money.
  if ((m = l.match(new RegExp(`^${TIME}\\s+(.+?)(?:\\s+time)?$`, "i"))) && /[:.]|am|pm|noon|midnight/i.test(m[1])) return ok(m[1], m[2], undefined);
  return;
}

/** The rows for a zone query: the time there (with `tomorrow, ` when its day is not today's here), how far ahead, the full date and ISO there. */
export function zoneRows(z: ZoneQuery, locale: string, now: number): Row[] | undefined {
  const tm = parseTime(z.time);
  const here = localZone();
  const src = z.from === undefined ? here : zone(z.from), dst = z.to === undefined ? here : zone(z.to);
  if (!tm || !src || !dst) return;
  let t = now;
  if (tm !== "now") { const w = wall(src, now); t = instant(src, w.y, w.m, w.d, tm.hh, tm.mm); }
  const there = wall(dst, t), days = dayNo(there) - dayNo(wall(here, now));
  const day = days ? `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day")}, ` : "";
  const subtitle = `${hm(wall(src, t))} ${label(src, t, locale)} → ${label(dst, t, locale)}`;
  const full = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", hourCycle: "h23", timeZone: dst }).format(t);
  return [
    { id: "result", name: `${day}${hm(there)}`, subtitle, raw: hm(there), accessories: [{ text: src === dst ? dst : gap(src, dst, t) }, ...(src === dst ? [] : [{ text: dst }])] },
    { id: "full", name: full, subtitle: `in ${dst}`, raw: full },
    { id: "iso", name: isoIn(dst, t), subtitle: "ISO 8601", raw: isoIn(dst, t) },
    { id: "unix", name: String(Math.floor(t / 1000)), subtitle: "unix time", raw: String(Math.floor(t / 1000)) },
  ];
}
