// Where the events come from, and one cache for everything that reads
// them. `source`: `system` is the core's capability (EventKit on macOS,
// khal on Linux), `google` the Calendar API per account (google.ts),
// `auto` google once an account is configured, else system. Every reader
// (My Schedule, Today, the bar item) goes through `load`, which keeps the
// last window fetched and answers it while it is younger than the caller's
// `maxAge`: the bar renders from the cache on every minute tick and
// fetches every five, the palettes take up to a minute, `refresh` takes
// nothing. A fetch that fails leaves the last events in place and marks
// them stale, so a broker that is away costs the strip its freshness, not
// the meeting.
import { calendar, settings, type Calendar, type CalendarEvent, type CalendarStatus } from "@zcag/pal";
import { now } from "./clock.ts";
import * as google from "./google.ts";

export type SourceName = "auto" | "system" | "google";
export type Settings = {
  source: SourceName; accounts: unknown[]; calendars: string[]; days: number; hide_declined: boolean; hide_all_day: boolean;
  horizon_hours: number; warn_minutes: number; urgent_minutes: number; default_length: number;
};
export type Loaded = { events: CalendarEvent[]; at: number; stale: boolean; error?: string };

export const EXTENSION = "calendar";
const CALENDARS_TTL = 5 * 60_000;

export const conf = () => settings.get<Settings>(EXTENSION);
export const accounts = (s = conf()) => google.parseAccounts(s.accounts);
/** The source in force: `auto` is google with an account configured, else the system's. */
export const active = (s = conf()): "system" | "google" => (s.source === "google" || (s.source !== "system" && accounts(s).length > 0) ? "google" : "system");

// ---- calendars -----------------------------------------------------------------------

let calendarCache: { at: number; source: string; list: Calendar[] } | undefined;

/** Every calendar of the source (Google: the ones each account reads, its `calendars`), cached five minutes; `refresh` reads again. */
export async function calendars(refresh = false): Promise<Calendar[]> {
  const src = active();
  if (!refresh && calendarCache && calendarCache.source === src && now() - calendarCache.at < CALENDARS_TTL) return calendarCache.list;
  let list: Calendar[];
  if (src === "google") {
    // Every account at once: each token command is a process (his is an ssh hop).
    const per = await Promise.allSettled(accounts().map(async (a) => (await google.calendars(a)).filter((c) => a.calendars.includes(c.id.slice(a.name.length + 1)))));
    list = per.flatMap((r) => (r.status === "fulfilled" ? r.value : (console.error(`[calendar] ${r.reason instanceof Error ? r.reason.message : r.reason}`), [])));
  } else list = await calendar.calendars();
  calendarCache = { at: now(), source: src, list };
  return list;
}

/** The `calendars` setting (titles or ids) as ids; undefined means all. */
export async function chosenIds(s: Settings, refresh: boolean): Promise<string[] | undefined> {
  const want = (s.calendars ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return;
  const all = await calendars(refresh);
  const ids = all.filter((c) => want.includes(c.id.toLowerCase()) || want.includes(c.title.toLowerCase()) || want.includes(c.id.replace(/^[^:]+:/, "").toLowerCase())).map((c) => c.id);
  return ids.length ? ids : undefined;
}

/** `granted` for Google (a token failure shows on the listing instead); the system's state otherwise. */
export async function permission(): Promise<CalendarStatus | null> {
  if (active() === "google") return "granted";
  try { return await calendar.permission(); } catch { return null; }
}

// ---- events -------------------------------------------------------------------------

let last: (Loaded & { key: string }) | undefined;
let inflight: Promise<Loaded> | undefined;

const keyOf = (from: number, to: number, ids?: string[]) => `${active()}\0${from}\0${to}\0${ids?.join(",") ?? ""}`;

/**
 * The events in `[from, to)`, narrowed to `ids` (the system source does
 * it in the backend, Google in memory after reading each account's
 * calendars). From the cache while the same window is younger than
 * `maxAge` ms; one fetch at a time (a bar tick and a palette show that
 * land together share it). A failure with a cache in hand answers the
 * cache as `stale` with the error; with none it throws.
 */
export async function load(from: number, to: number, ids: string[] | undefined, maxAge: number): Promise<Loaded> {
  const key = keyOf(from, to, ids);
  if (last && last.key === key && now() - last.at < maxAge) return last;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const events = await fetchEvents(from, to, ids);
      last = { key, events, at: now(), stale: false };
      return last;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (last && last.key === key) { last = { ...last, stale: true, error }; return last; }
      throw e;
    } finally { inflight = undefined; }
  })();
  return inflight;
}

/** The last loaded events, whatever their age (a render that must not wait). */
export const cached = (): Loaded | undefined => last;

/** Forget the events and calendars (the settings changed: the source or an account may have). */
export function forget() {
  last = undefined;
  calendarCache = undefined;
  google.forgetTokens();
}

async function fetchEvents(from: number, to: number, ids?: string[]): Promise<CalendarEvent[]> {
  if (active() !== "google") return calendar.events(from, to, ids);
  const all = await calendars();
  const byId = new Map(all.map((c) => [c.id, c]));
  const per = await Promise.allSettled(accounts().map(async (a) => {
    const out: CalendarEvent[] = [];
    for (const id of a.calendars) {
      const cid = google.calendarId(a.name, id);
      if (ids && !ids.includes(cid)) continue;
      out.push(...(await google.events(a, id, from, to, byId.get(cid))));
    }
    return out;
  }));
  const errors = per.flatMap((r) => (r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : String(r.reason)] : []));
  for (const err of errors) console.error(`[calendar] ${err}`);
  // One account being away is not the other's problem; all of them away is.
  if (errors.length === per.length) throw new Error(errors.length ? errors.join("; ") : "No Google account configured: add one under Settings > Calendar > Accounts");
  const out = per.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
