// My Schedule: the next days' events over the core's calendar capability
// (EventKit on macOS, khal on Linux), live so the "now" tag and the join
// links are current on every show. Today, Tomorrow, This week and Later as
// sections; the current or next event carries the tag; a row joins its
// call, opens in Calendar, copies its details, or deletes it; New event is
// a form. The permission is the extension's own row while it is missing.
import { calendar, settings, type Action, type Calendar, type CalendarEvent, type CalendarStatus, type Detail, type Effect, type Extension, type Form, type Item, type Metadata } from "@zcag/pal";
import { addDays, DAY, dayName, dayNameYear, details, nextQuarter, parseDay, parseTime, people, plusMinutes, section, soonTag, startOfDay, timeRange, upcoming } from "./schedule.ts";

type Settings = { calendars: string[]; days: number; hide_declined: boolean };

const EXTENSION = "calendar";
const ICON = "\u{f00ed}";
const NEW = "new";
const GRANT = "grant";
const HINT = "hint";
const CALENDARS_TTL = 5 * 60_000;
const MAC = process.platform === "darwin";

/** Row id to event, from the last listing; a pick after a restart refetches. */
const table = new Map<string, CalendarEvent>();
let calendarCache: { at: number; list: Calendar[] } | undefined;

const rowId = (e: CalendarEvent) => `${e.id}@${e.start}`;
const STATUS_COLOR: Record<string, string> = { accepted: "green", declined: "red", tentative: "amber", pending: "grey", unknown: "grey" };

async function calendars(refresh = false): Promise<Calendar[]> {
  if (!refresh && calendarCache && Date.now() - calendarCache.at < CALENDARS_TTL) return calendarCache.list;
  const list = await calendar.calendars();
  calendarCache = { at: Date.now(), list };
  return list;
}

/** The `calendars` setting (titles or ids) as ids; undefined means all. */
async function chosenIds(s: Settings, refresh: boolean): Promise<string[] | undefined> {
  const want = (s.calendars ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!want.length) return;
  const all = await calendars(refresh);
  const ids = all.filter((c) => want.includes(c.id.toLowerCase()) || want.includes(c.title.toLowerCase())).map((c) => c.id);
  return ids.length ? ids : undefined;
}

/** The permission's own rows: the ask, the pane, or the missing backend. */
function statusRows(status: CalendarStatus | null): Item[] {
  switch (status) {
    case "not_determined":
      return [{ id: GRANT, name: "Grant calendar access", subtitle: "pal lists your events once macOS allows it; Enter shows the system prompt", icon: "\u{f033e}", actions: [{ id: GRANT, title: "Grant access" }] }];
    case "denied":
    case "restricted":
      return [{ id: GRANT, name: status === "denied" ? "Calendar access denied" : "Calendar access restricted", subtitle: "Switch pal on under Privacy & Security > Calendars", icon: "\u{f033e}", actions: [{ id: "settings", title: "Open System Settings" }] }];
    default:
      return [{ id: HINT, name: "No calendar on this machine", subtitle: MAC ? "EventKit did not answer" : "Install khal: pal reads your calendars through it", icon: ICON, actions: [] }];
  }
}

const failed = (what: string, e: unknown): Effect => ({ keep: true, toast: { title: `Could not ${what}`, message: e instanceof Error ? e.message : String(e), style: "failure" } });

function actions(e: CalendarEvent): Action[] {
  const out: Action[] = [];
  if (e.conference_url) out.push({ id: "join", title: "Join call" });
  if (MAC) out.push({ id: "open", title: "Open in Calendar" });
  if (e.conference_url) out.push({ id: "copy_link", title: "Copy conference link", shortcut: "cmd+shift+c" });
  out.push({ id: "copy_details", title: "Copy event details", shortcut: "cmd+c" });
  if (MAC) out.push({ id: "delete", title: e.recurring ? "Delete this occurrence" : "Delete event", shortcut: "ctrl+x", style: "destructive", confirm: `Delete "${e.title}"${e.recurring ? " on " + dayName(e.start) : ""}?` });
  return out;
}

function row(e: CalendarEvent, now: number, tagged: boolean): Item {
  const id = rowId(e);
  table.set(id, e);
  const tag = tagged ? soonTag(e, now) : undefined;
  const accessories: Item["accessories"] = [];
  if (tag) accessories.push({ tag, color: tag === "now" ? "green" : "blue" });
  if (e.my_status === "declined") accessories.push({ tag: "declined", color: "red" });
  else if (e.my_status === "tentative") accessories.push({ tag: "maybe", color: "amber" });
  const n = people(e.attendees.length);
  if (n) accessories.push({ text: n });
  if (e.conference_url) accessories.push({ tag: "Join", color: "green" });
  return {
    id,
    name: e.title || "(no title)",
    subtitle: [timeRange(e), e.location].filter(Boolean).join(" · "),
    icon: e.calendar.color ?? ICON,
    section: section(e.start, now),
    keywords: [e.calendar.title, ...(e.location ? [e.location] : []), section(e.start, now).toLowerCase(), dayName(e.start)],
    accessories,
    actions: actions(e),
  };
}

const newRow: Item = { id: NEW, name: "New event", subtitle: "Title, day, time and calendar in a form", icon: "\u{f0415}", keywords: ["add", "create"], actions: [{ id: NEW, title: "New event" }] };

async function form(values: Record<string, string | boolean> = {}, errors?: Record<string, string>): Promise<Form> {
  let cals: Calendar[] = [];
  try { cals = (await calendars()).filter((c) => c.writable); } catch { /* the backend's default calendar then */ }
  const now = Date.now();
  const start = typeof values.start === "string" ? values.start : nextQuarter(now);
  const v = (k: string, d: string) => (typeof values[k] === "string" ? (values[k] as string) : d);
  return {
    id: NEW,
    title: "New event",
    fields: [
      { kind: "text", id: "title", label: "Title", required: true, default: v("title", ""), placeholder: "Dentist" },
      { kind: "text", id: "day", label: "Day", default: v("day", "today"), placeholder: "today", description: "today, tomorrow, fri, next mon, 2026-09-20, 20 sep" },
      { kind: "text", id: "start", label: "Start", default: start, placeholder: "14:30", description: "14:30, 2pm, 1430; ignored for an all-day event" },
      { kind: "text", id: "end", label: "End", default: v("end", plusMinutes(start, 60)), placeholder: "15:30", description: "A time, or a day for an all-day event (its last day)" },
      { kind: "checkbox", id: "all_day", label: "All day", text: "The whole day, no times", default: values.all_day === true },
      ...(cals.length ? [{ kind: "select" as const, id: "calendar", label: "Calendar", options: [{ id: "", title: "Default calendar" }, ...cals.map((c) => ({ id: c.id, title: c.source ? `${c.title} (${c.source})` : c.title }))], default: v("calendar", "") }] : []),
      { kind: "text", id: "location", label: "Location", default: v("location", ""), placeholder: "Room 4, or a meeting link" },
      { kind: "textarea", id: "notes", label: "Notes", default: v("notes", "") },
    ],
    submit: { id: "create", title: "Add event" },
    errors,
  };
}

async function create(values: Record<string, string | boolean>): Promise<Effect> {
  const errors: Record<string, string> = {};
  const now = Date.now();
  const title = String(values.title ?? "").trim();
  if (!title) errors.title = "Give the event a title";
  const day = parseDay(String(values.day ?? ""), now);
  if (day === undefined) errors.day = "Not a day I know: today, fri, 2026-09-20";
  const allDay = values.all_day === true;
  const s = allDay ? 0 : parseTime(String(values.start ?? ""));
  const e = allDay ? 0 : parseTime(String(values.end ?? ""));
  if (s === undefined) errors.start = "A time like 14:30 or 2pm";
  if (e === undefined) errors.end = "A time like 15:30 or 3pm";
  let start = 0;
  let end = 0;
  if (day !== undefined && s !== undefined && e !== undefined) {
    if (allDay) {
      start = day;
      const last = String(values.end ?? "").trim();
      const lastDay = last && parseTime(last) === undefined ? parseDay(last, now) : undefined;
      end = lastDay !== undefined && lastDay >= day ? lastDay + DAY : day + DAY;
    } else {
      start = day + s * 60_000;
      end = day + e * 60_000;
      if (end <= start) end += DAY;
    }
  }
  if (Object.keys(errors).length) return { form: await form(values, errors) };
  const calendarId = typeof values.calendar === "string" && values.calendar ? values.calendar : undefined;
  const location = String(values.location ?? "").trim() || undefined;
  const notes = String(values.notes ?? "").trim() || undefined;
  try {
    await calendar.create({ title, start, end, all_day: allDay, calendar: calendarId, location, notes });
  } catch (e) {
    return { form: await form(values, { title: e instanceof Error ? e.message : String(e) }) };
  }
  return { keep: true, toast: { title: "Added", message: allDay ? `${title}, ${dayNameYear(start)}` : `${title}, ${dayName(start)} ${timeRange({ start, end, all_day: false })}`, style: "success" } };
}

/** The event behind a row id, from the listing or fetched again after a restart. */
async function find(id: string): Promise<CalendarEvent | undefined> {
  const have = table.get(id);
  if (have) return have;
  const at = Number(id.slice(id.lastIndexOf("@") + 1));
  if (!Number.isFinite(at)) return;
  const es = await calendar.events(at - 1, at + 1);
  const e = es.find((e) => rowId(e) === id);
  if (e) table.set(id, e);
  return e;
}

async function pickEvent(e: CalendarEvent, action?: string): Promise<Effect> {
  switch (action ?? actions(e)[0]?.id) {
    case "join": return { open: e.conference_url! };
    case "copy_link": return { copy: e.conference_url! };
    case "copy_details": return { copy: details(e) };
    case "delete":
      try { await calendar.delete(e.id, e.occurrence); } catch (err) { return failed("delete the event", err); }
      table.delete(rowId(e));
      return { keep: true, toast: { title: "Deleted", message: e.title, style: "success" } };
    case "open":
    default:
      try { await calendar.open(e.id, e.occurrence); } catch (err) { return failed("open the event", err); }
      return { hide: true };
  }
}

/** The calendar filters, read once at load: `PaletteMeta.filters` is static. A missing permission leaves "All" alone until the next host start. */
async function loadFilters(): Promise<{ id: string; title: string }[]> {
  const all = [{ id: "all", title: "All calendars" }];
  try {
    if ((await calendar.permission()) !== "granted") return all;
    const s = settings.get<Settings>(EXTENSION);
    const ids = await chosenIds(s, false);
    const cals = (await calendars()).filter((c) => !ids || ids.includes(c.id));
    return [...all, ...cals.map((c) => ({ id: c.id, title: c.title }))];
  } catch (e) {
    console.error(`calendar: filters: ${e instanceof Error ? e.message : e}`);
    return all;
  }
}

export default {
  palettes: {
    schedule: {
      title: "My Schedule",
      icon: ICON,
      live: true,
      ttl: 60,
      placeholder: "Search your events",
      filters: await loadFilters(),
      list: async (_query, ctx): Promise<Item[]> => {
        let status: CalendarStatus | null;
        try { status = await calendar.permission(); } catch { status = null; }
        if (status !== "granted") return statusRows(status);
        const s = settings.get<Settings>();
        const now = Date.now();
        const days = Math.max(1, Math.round(Number(s.days) || 7));
        const from = startOfDay(now);
        const to = addDays(now, days);
        let events: CalendarEvent[];
        try {
          const chosen = ctx?.filter && ctx.filter !== "all" ? [ctx.filter] : await chosenIds(s, !!ctx?.refresh);
          events = await calendar.events(from, to, chosen);
        } catch (e) {
          return [{ id: HINT, name: "Could not read the calendar", subtitle: e instanceof Error ? e.message : String(e), icon: ICON, actions: [] }, newRow];
        }
        table.clear();
        let tagged = false;
        const rows = upcoming(events, now, s.hide_declined !== false).map((e) => {
          const tag = !tagged && !e.all_day && soonTag(e, now) !== undefined;
          if (tag) tagged = true;
          return row(e, now, tag);
        });
        return [...rows, newRow];
      },
      pick: async (id, action, ctx): Promise<Effect | void> => {
        if (id === HINT) return;
        if (id === GRANT) {
          if (action === "settings") {
            try { await calendar.openSettings(); } catch (e) { return failed("open System Settings", e); }
            return { hide: true };
          }
          let status: CalendarStatus;
          try { status = await calendar.request(); } catch (e) { return failed("ask for calendar access", e); }
          if (status === "granted") { calendarCache = undefined; return { keep: true, toast: { title: "Calendar access granted", style: "success" } }; }
          return { keep: true, toast: { title: "Calendar access not granted yet", message: status === "not_determined" ? "Answer the system prompt, then open My Schedule again" : "Switch pal on under Privacy & Security > Calendars" } };
        }
        if (id === NEW) {
          if (action === "create" && ctx?.values) return create(ctx.values);
          return { form: await form() };
        }
        let e: CalendarEvent | undefined;
        try { e = await find(id); } catch (err) { return failed("read the event", err); }
        if (!e) return { keep: true, toast: { title: "Event not found", message: "It may have been moved or deleted; the list is fresh now", style: "failure" } };
        return pickEvent(e, action);
      },
      detail: async (id): Promise<Detail | void> => {
        if (id === HINT || id === GRANT || id === NEW) return;
        let e: CalendarEvent | undefined;
        try { e = await find(id); } catch { return; }
        if (!e) return;
        const metadata: Metadata[] = [
          { label: "When", value: e.all_day ? `${dayNameYear(e.start)} (${timeRange(e).toLowerCase()})` : `${dayNameYear(e.start)}, ${timeRange(e)}` },
          { label: "Calendar", tags: [{ text: e.calendar.source ? `${e.calendar.title} (${e.calendar.source})` : e.calendar.title }] },
        ];
        if (e.location) metadata.push({ label: "Location", value: e.location });
        if (e.conference_url) metadata.push({ label: "Call", link: { text: e.conference_url.replace(/^https?:\/\//, "").slice(0, 60), href: e.conference_url } });
        else if (e.url) metadata.push({ label: "Link", link: { text: e.url.replace(/^https?:\/\//, "").slice(0, 60), href: e.url } });
        if (e.organizer) metadata.push({ label: "Organizer", value: e.organizer });
        if (e.attendees.length) metadata.push({ label: `Attendees (${e.attendees.length})`, tags: e.attendees.slice(0, 12).map((a) => ({ text: a.me ? `${a.name} (you)` : a.name, color: STATUS_COLOR[a.status] })) });
        if (e.my_status) metadata.push({ label: "Your reply", tags: [{ text: e.my_status, color: STATUS_COLOR[e.my_status] }] });
        if (e.recurring) metadata.push({ label: "Repeats", value: "yes" });
        return { markdown: e.notes ? e.notes : `# ${e.title || "(no title)"}`, metadata };
      },
    },
  },
} satisfies Extension;
