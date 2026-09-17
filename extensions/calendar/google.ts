// Google Calendar as a source: the API v3 read directly, per account, with
// a bearer token a shell command prints (the SDK's `mintToken`: the
// command owns the secret, pal keeps the access token in memory until its
// stated expiry).
//
// The events come back in the core's `CalendarEvent` shape so the
// palettes and the bar item read one kind of row whatever the source.
// `PAL_GOOGLE_API` replaces `https://www.googleapis.com/calendar/v3` (the
// tests point it at a local server).
import { errorMessage, mintToken, now as clock, type Attendee, type Calendar, type CalendarEvent } from "@zcag/pal";
import { startOfDay } from "./schedule.ts";

export type Account = { name: string; token_command: string; calendars: string[] };

export const API = (process.env.PAL_GOOGLE_API || "https://www.googleapis.com/calendar/v3").replace(/\/+$/, "");
const HTTP_MS = 10_000;
const MAX_RESULTS = 250;
const EVENT_FIELDS = "items(id,status,eventType,summary,description,location,start,end,htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(email,displayName,responseStatus,self,resource),organizer(email,displayName),recurringEventId)";
const CALENDAR_FIELDS = "items(id,summary,summaryOverride,backgroundColor,accessRole,primary)";

/**
 * The `accounts` setting as accounts. Each entry is `name = command` as
 * the Settings window's list takes it (`work = gcloud auth
 * application-default print-access-token`), or, from the config file, a table `{ name,
 * token_command, calendars }` with the calendar ids to read (`primary`
 * when absent). An entry without a name is `google`; blanks are dropped.
 */
export function parseAccounts(raw: unknown): Account[] {
  if (!Array.isArray(raw)) return [];
  const out: Account[] = [];
  for (const [i, entry] of raw.entries()) {
    if (typeof entry === "string") {
      const s = entry.trim();
      if (!s) continue;
      // `name = command`: the name is one word, so a `?aud=calendar` inside a bare command is not one.
      const m = s.match(/^([\w.-]+)\s*=\s*(.+)$/s);
      const name = m ? m[1] : "";
      const cmd = (m ? m[2] : s).trim();
      if (cmd) out.push({ name: name || (i ? `google${i + 1}` : "google"), token_command: cmd, calendars: ["primary"] });
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const cmd = typeof o.token_command === "string" ? o.token_command.trim() : "";
      if (!cmd) continue;
      const cals = Array.isArray(o.calendars) ? o.calendars.filter((c): c is string => typeof c === "string" && !!c.trim()).map((c) => c.trim()) : [];
      out.push({ name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : (i ? `google${i + 1}` : "google"), token_command: cmd, calendars: cals.length ? cals : ["primary"] });
    }
  }
  return out;
}

// ---- tokens -------------------------------------------------------------------

const tokens = new Map<string, { token: string; until: number }>();
const minting = new Map<string, Promise<string>>();

/** The account's token (`mintToken` on its `token_command`), cached until the expiry it stated, less a minute; two callers wanting one at once share the run. The error names the account. */
function token(a: Account, fresh = false): Promise<string> {
  const have = tokens.get(a.token_command);
  if (have && !fresh && clock() < have.until) return Promise.resolve(have.token);
  const running = minting.get(a.token_command);
  if (running) return running;
  const p = mintToken(a.token_command, clock())
    .then((t) => { tokens.set(a.token_command, t); return t.token; }, (e) => { throw new Error(`${a.name}: ${errorMessage(e)}`); })
    .finally(() => minting.delete(a.token_command));
  minting.set(a.token_command, p);
  return p;
}

/** Forget every cached token (the accounts setting changed). */
export const forgetTokens = () => tokens.clear();

async function get<T>(a: Account, path: string, params: Record<string, string>): Promise<T> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  let tok = await token(a);
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${tok}`, accept: "application/json" }, signal: AbortSignal.timeout(HTTP_MS) });
    if (r.status === 401 && attempt === 0) { tok = await token(a, true); continue; }
    if (!r.ok) {
      let msg = `${r.status}`;
      try { const j = (await r.json()) as { error?: { message?: string } }; if (j.error?.message) msg = `${r.status} ${j.error.message}`; } catch { /* the status is the message */ }
      throw new Error(`${a.name}: ${msg}`);
    }
    return (await r.json()) as T;
  }
}

// ---- the API's shapes --------------------------------------------------------------

type GCalendar = { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; accessRole?: string; primary?: boolean };
type GWhen = { date?: string; dateTime?: string };
type GAttendee = { email?: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean };
export type GEvent = {
  id: string; status?: string; eventType?: string; summary?: string; description?: string; location?: string; start?: GWhen; end?: GWhen; htmlLink?: string; hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: GAttendee[]; organizer?: { email?: string; displayName?: string }; recurringEventId?: string;
};

/** `Calendar.id` for a Google calendar: the account's name and the calendar id, so two accounts' calendars stay apart. The account's primary calendar is `<name>:primary`, whatever its address. */
export const calendarId = (account: string, id: string) => `${account}:${id}`;

/** One account's calendars, as the core shapes them; `source` is the account's name. */
export async function calendars(a: Account): Promise<Calendar[]> {
  const r = await get<{ items?: GCalendar[] }>(a, "/users/me/calendarList", { minAccessRole: "reader", fields: CALENDAR_FIELDS, maxResults: "250" });
  return (r.items ?? []).map((c) => ({
    id: calendarId(a.name, c.primary ? "primary" : c.id),
    title: c.summaryOverride || c.summary || c.id,
    color: c.backgroundColor?.toLowerCase() ?? null,
    source: a.name,
    writable: c.accessRole === "owner" || c.accessRole === "writer",
  }));
}

/**
 * The events of one calendar of one account in `[from, to)` (unix ms),
 * occurrences expanded, cancelled ones dropped. `cal` names the calendar
 * the rows carry (from `calendars`); an id the list does not know gets a
 * bare one.
 */
export async function events(a: Account, id: string, from: number, to: number, cal?: Calendar): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  const calendar: Calendar = cal ?? { id: calendarId(a.name, id), title: id, color: null, source: a.name, writable: false };
  do {
    const r = await get<{ items?: GEvent[]; nextPageToken?: string }>(a, `/calendars/${encodeURIComponent(id)}/events`, {
      singleEvents: "true", orderBy: "startTime", timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), maxResults: String(MAX_RESULTS), fields: `nextPageToken,${EVENT_FIELDS}`,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const e of r.items ?? []) { const ev = toEvent(e, a.name, calendar); if (ev) out.push(ev); }
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

const STATUS: Record<string, Attendee["status"]> = { accepted: "accepted", declined: "declined", tentative: "tentative", needsAction: "pending" };

/** A Google event as the core's `CalendarEvent`; nothing for a cancelled one, one without times, or a working-location chip (`eventType: workingLocation`, "Home" on every day of the week: a setting, not an event to attend). */
export function toEvent(e: GEvent, account: string, calendar: Calendar): CalendarEvent | undefined {
  if (e.status === "cancelled" || e.eventType === "workingLocation") return;
  const start = when(e.start), end = when(e.end);
  if (start === undefined || end === undefined) return;
  const attendees: Attendee[] = (e.attendees ?? []).filter((a) => !a.resource).map((a) => ({ name: a.displayName || a.email || "?", status: STATUS[a.responseStatus ?? ""] ?? "unknown", me: a.self === true }));
  const me = attendees.find((a) => a.me);
  const notes = e.description ? text(e.description) : null;
  const location = e.location?.trim() || null;
  return {
    id: `${account}:${e.id}`,
    occurrence: e.recurringEventId ? start : null,
    title: e.summary?.trim() ?? "",
    start,
    end,
    all_day: !!e.start?.date,
    location,
    notes,
    url: e.htmlLink ?? null,
    calendar,
    attendees,
    organizer: e.organizer?.displayName || e.organizer?.email || null,
    conference_url: joinLink(e),
    recurring: !!e.recurringEventId,
    my_status: me ? me.status : null,
  };
}

/** `dateTime` as given (with its offset), `date` as the local midnight of that day (all-day; `end.date` is exclusive, like the core's). */
function when(w: GWhen | undefined): number | undefined {
  if (!w) return;
  if (w.dateTime) { const t = Date.parse(w.dateTime); return Number.isFinite(t) ? t : undefined; }
  if (w.date) {
    const m = w.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return startOfDay(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime());
  }
  return;
}

// ---- join links ------------------------------------------------------------------

/**
 * The call to join: `conferenceData`'s video entry point, else
 * `hangoutLink`, else the first known provider's meeting link in the
 * location, then the description (Zoom, Meet, Teams, Webex, Jitsi,
 * Whereby, GoTo; a Zoom marketing page or an agenda doc is not a call).
 */
export function joinLink(e: Pick<GEvent, "conferenceData" | "hangoutLink" | "location" | "description">): string | null {
  const points = e.conferenceData?.entryPoints ?? [];
  const video = points.find((p) => p.entryPointType === "video" && p.uri?.startsWith("http")) ?? points.find((p) => p.entryPointType === "more" && p.uri?.startsWith("http"));
  if (video?.uri) return video.uri;
  if (e.hangoutLink?.startsWith("http")) return e.hangoutLink;
  for (const field of [e.location, e.description]) {
    if (!field) continue;
    const u = links(field).find(isConference);
    if (u) return u;
  }
  return null;
}

/** The `https?://` links in `text`, in order, `&amp;` unescaped, trailing punctuation and a closing bracket dropped, Outlook safelinks unwrapped. */
export function links(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/&amp;/g, "&").matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const raw = m[0].replace(/[.,;:)\]}!?]+$/, "");
    if (/^https?:\/\/$/i.test(raw)) continue;
    out.push(unwrapSafelink(raw) ?? raw);
  }
  return out;
}

function unwrapSafelink(u: string): string | undefined {
  const host = hostOf(u);
  if (!host?.endsWith("safelinks.protection.outlook.com")) return;
  const q = u.split("?")[1];
  const enc = q?.split("&").map((kv) => kv.match(/^url=(.*)$/)?.[1]).find((v) => v !== undefined);
  if (enc === undefined) return;
  try { return decodeURIComponent(enc); } catch { return; }
}

const hostOf = (u: string): string | undefined => {
  const after = u.split("://")[1];
  if (!after) return;
  const host = after.split(/[/?#]/)[0].split("@").pop()!.split(":")[0].toLowerCase();
  return host || undefined;
};
const pathOf = (u: string): string => { const after = u.split("://")[1] ?? ""; const i = after.search(/[/?#]/); return i < 0 ? "" : after.slice(i); };

/** The same rule as `pal_core::calendar::is_conference`: a known host with a meeting-shaped path. */
export function isConference(u: string): boolean {
  const host = hostOf(u);
  if (!host) return false;
  const path = pathOf(u);
  const under = (d: string) => host === d || host.endsWith(`.${d}`);
  const has = (...p: string[]) => p.some((x) => path.startsWith(x));
  return ((under("zoom.us") || under("zoomgov.com") || under("zoom.com")) && has("/j/", "/my/", "/w/", "/s/", "/wc/"))
    || (host === "meet.google.com" && path.length > 1 && !path.startsWith("/new"))
    || (under("teams.microsoft.com") && has("/l/meetup-join/", "/meet/"))
    || (under("teams.live.com") && has("/meet/"))
    || (under("webex.com") && path.length > 1 && !has("/signin", "/webappng/sites"))
    || (host === "meet.jit.si" && path.length > 1)
    || (under("whereby.com") && path.length > 1)
    || (under("meet.goto.com") && path.length > 1);
}

// ---- description text --------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** A Google description, which may be HTML, as text: breaks and block ends to newlines, tags dropped, entities decoded, blank runs collapsed. */
export function text(html: string): string {
  if (!/<[a-z!/]/i.test(html)) return html.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e: string) => ENTITIES[e]).replace(/\r\n?/g, "\n").trim();
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e: string) => ENTITIES[e])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
