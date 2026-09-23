// Calendar: My Schedule (the week), Today (the day, live) and the
// `upcoming` bar item, over one source and one cache (source.ts): the
// core's calendar capability (EventKit on macOS, khal on Linux) or Google
// Calendar per account through a token command (google.ts). Sections
// Today / Tomorrow / This week / Later in the week view; the current or
// next event carries the tag; a row joins its call, opens in Calendar (a
// browser link for a Google event), copies its details, or deletes it
// (the system source); New event is a form, and Quick Add (quick.ts) is
// one line, `standup tomorrow 10:00`, parsed as you type and created on
// Enter (a root query nothing matched offers it as a fallback row). The
// permission is the extension's own row while it is missing.
//
// The bar item: the next event as `Standup in 12m` (`now` while it runs),
// hidden when nothing starts inside `horizon_hours`, muted far off, amber
// inside `warn_minutes`, red inside `urgent_minutes`, a dot when there is
// a call to join. The core asks every five minutes and on wake, the
// network and the minute tick; a tick renders from the cache, the rest
// fetch. A click joins the next call (or opens Calendar); a hover peek
// opens the popover (view.ts): today's rows with the one running on a
// card, Join buttons, tomorrow folded; the keys walk the rows and Enter
// joins or opens; while it shows, a 30 s tick redraws it from the cache
// so `in 12 min` keeps counting. Every read of the time
// is the SDK's `now` (`PAL_NOW` pins it for the tests).
import { calendar, errorMessage, failed, hint, now as clock, settings, tinted, view as liveView, type Accessory, type Action, type BarCtx, type BarItem, type Calendar, type CalendarEvent, type CalendarStatus, type Ctx, type Detail, type Effect, type Extension, type Form, type Item, type Metadata } from "@zcag/pal";
import { parseQuick, type Quick } from "./quick.ts";
import { addDays, DAY, dayName, dayNameYear, details, nextQuarter, parseDay, parseTime, people, plusMinutes, section, soonTag, startOfDay, timeRange, upcoming } from "./schedule.ts";
import { active, cached, calendars, chosenIds, conf, EXTENSION, forget, load, log, permission, type Loaded, type Settings } from "./source.ts";
import { barRules, duration, ICON, ITEM, nextEvent, nextWords, onDay, state, stateColor, TODAY, upcomingItem, type ItemSettings } from "./today.ts";
import { focusable, freshPopover, listed, popover, rowId as viewRowId, words, type PopoverState } from "./view.ts";

/** nf-md-calendar_check for a Today row, tinted with the calendar's colour; nf-md-calendar_blank for a clear day. */
const ROW = "\u{f00ee}";
const CLEAR = "\u{f00ef}";
const NEW = "new";
const QUICK = "quick";
const GRANT = "grant";
const HINT = "hint:calendar";
const NOTHING = "nothing";
const MAC = process.platform === "darwin";
/** How old the cache may be for a palette show, and for a bar render on the minute tick. */
const PALETTE_AGE = 60_000;
const BAR_AGE = 5 * 60_000;

/** Row id to event, from the last listing; a pick after a restart refetches. */
const table = new Map<string, CalendarEvent>();

const rowId = (e: CalendarEvent) => `${e.id}@${e.start}`;
const STATUS_COLOR: Record<string, string> = { accepted: "green", declined: "red", tentative: "amber", pending: "grey", unknown: "grey" };
/** The rows are Google's (one source at a time): an event opens in the browser and cannot be deleted from here (the token may be read-only). */
const isGoogle = () => active() === "google";

settings.onChange(() => forget(), EXTENSION);

/** The permission's own rows: the ask, the pane, or the missing backend. */
function statusRows(status: CalendarStatus | null): Item[] {
  switch (status) {
    case "not_determined":
      return [{ id: GRANT, name: "Grant calendar access", subtitle: "pal lists your events once macOS allows it; Enter shows the system prompt", icon: "\u{f033e}", actions: [{ id: GRANT, title: "Grant access" }] }];
    case "denied":
    case "restricted":
      return [{ id: GRANT, name: status === "denied" ? "Calendar access denied" : "Calendar access restricted", subtitle: "Switch pal on under Privacy & Security > Calendars", icon: "\u{f033e}", actions: [{ id: "settings", title: "Open System Settings" }] }];
    default:
      return [hintRow("No calendar on this machine", MAC ? "EventKit did not answer; or add a Google account under Settings › Extensions › Calendar" : "Install khal, or add a Google account under Settings › Extensions › Calendar")];
  }
}

const hintRow = (name: string, subtitle: string): Item => hint(HINT, name, subtitle, { icon: ICON });

function actions(e: CalendarEvent): Action[] {
  const out: Action[] = [];
  const google = isGoogle();
  if (e.conference_url) out.push({ id: "join", title: "Join call" });
  if (google) out.push({ id: "open", title: "Open in Google Calendar" });
  else if (MAC) out.push({ id: "open", title: "Open in Calendar" });
  if (e.conference_url) out.push({ id: "copy_link", title: "Copy conference link", shortcut: "cmd+shift+c" });
  out.push({ id: "copy_details", title: "Copy event details", shortcut: "cmd+c" });
  if (MAC && !google) out.push({ id: "delete", title: e.recurring ? "Delete this occurrence" : "Delete event", shortcut: "ctrl+x", style: "destructive", confirm: `Delete "${e.title}"${e.recurring ? " on " + dayName(e.start) : ""}?` });
  return out;
}

const replyTag = (e: CalendarEvent): Accessory[] => (e.my_status === "declined" ? [{ tag: "declined", color: "red" }] : e.my_status === "tentative" ? [{ tag: "maybe", color: "amber" }] : []);

function row(e: CalendarEvent, now: number, tagged: boolean): Item {
  const id = rowId(e);
  table.set(id, e);
  const tag = tagged ? soonTag(e, now) : undefined;
  const accessories: Item["accessories"] = [];
  if (tag) accessories.push({ tag, color: tag === "now" ? "green" : "blue" });
  accessories.push(...replyTag(e));
  const n = people(e.attendees.length);
  if (n) accessories.push({ text: n });
  if (e.conference_url) accessories.push({ tag: "Join", color: "green" });
  return {
    id,
    name: e.title || "(no title)",
    subtitle: [timeRange(e), e.location].filter(Boolean).join(" · "),
    icon: rowIcon(e),
    section: section(e.start, now),
    keywords: [e.calendar.title, ...(e.location ? [e.location] : []), section(e.start, now).toLowerCase(), dayName(e.start)],
    accessories,
    actions: actions(e),
  };
}

/** The row's glyph in the calendar's colour (a hex the source gave), else plain: one shape for My Schedule, Today and Quick Add. */
const rowIcon = (e: Pick<CalendarEvent, "calendar">) => { const c = e.calendar.color; return c && /^#[0-9a-f]{6}$/i.test(c) ? tinted(ROW, c as `#${string}`) : ROW; };

/** A Today row: the time and how long, the state as the first tag, the calendar's colour on the glyph. */
function todayRow(e: CalendarEvent, now: number, sec: string): Item {
  const id = rowId(e);
  table.set(id, e);
  const s = state(e, now);
  const accessories: Item["accessories"] = [{ tag: s.text, color: stateColor(s) }, ...replyTag(e)];
  const n = people(e.attendees.length);
  if (n) accessories.push({ text: n });
  if (e.conference_url) accessories.push({ tag: "Join", color: "green" });
  return {
    id,
    name: e.title || "(no title)",
    subtitle: [e.all_day ? "All day" : `${timeRange(e)} · ${duration(e)}`, e.location].filter(Boolean).join(" · "),
    icon: rowIcon(e),
    section: sec,
    keywords: [e.calendar.title, ...(e.location ? [e.location] : []), s.kind, sec.toLowerCase()],
    accessories,
    actions: actions(e),
  };
}

const newRow: Item = { id: NEW, name: "New event", subtitle: "Title, day, time and calendar in a form", icon: "\u{f0415}", keywords: ["add", "create"], actions: [{ id: NEW, title: "New event" }] };

async function form(values: Record<string, string | boolean> = {}, errors?: Record<string, string>): Promise<Form> {
  let cals: Calendar[] = [];
  try { cals = (await calendars()).filter((c) => c.writable); } catch { /* the backend's default calendar then */ }
  const now = clock();
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
  const now = clock();
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
    return await add({ title, start, end, allDay, calendar: calendarId, location, notes });
  } catch (e) {
    return { form: await form(values, { title: errorMessage(e) }) };
  }
}

/** The one write: the event created, the cache dropped, the toast; throws what the source said. */
async function add(e: { title: string; start: number; end: number; allDay: boolean; calendar?: string; location?: string; notes?: string }): Promise<Effect> {
  await calendar.create({ title: e.title, start: e.start, end: e.end, all_day: e.allDay, calendar: e.calendar, location: e.location, notes: e.notes });
  forget();
  return { keep: true, toast: { title: "Added", message: e.allDay ? `${e.title}, ${dayNameYear(e.start)}` : `${e.title}, ${dayName(e.start)} ${timeRange({ start: e.start, end: e.end, all_day: false })}`, style: "success" } };
}

// ---- quick add ----------------------------------------------------------------------

/** The last parse per line, for the pick (the row's id is the line). */
const quick = new Map<string, Quick & { calendarId?: string }>();

/** The writable calendars, or none when the source cannot say. */
async function writable(): Promise<Calendar[]> {
  try { return (await calendars()).filter((c) => c.writable); } catch { return []; }
}

/** `Tomorrow 10:00 to 10:30`, `Fri 18 Sep, all day`, `Today 17:00 to 17:30 (the time has passed, so tomorrow)`. */
function quickWhen(q: Quick, now: number): string {
  const today = startOfDay(now);
  const dayWord = q.day === today ? "Today" : q.day === addDays(now, 1) ? "Tomorrow" : dayName(q.day);
  return q.allDay ? `${dayWord}, all day` : `${dayWord} ${timeRange({ start: q.start, end: q.end, all_day: false }).replace(" – ", " to ")}`;
}

/**
 * Quick Add's one row: the line parsed as you type, the calendar named
 * matched by prefix against the writable ones, a hint row when the line
 * cannot be read yet. Enter on the row creates the event.
 */
async function quickRows(query = ""): Promise<Item[]> {
  const status = await permission();
  if (status !== "granted") return statusRows(status);
  const now = clock();
  const cals = await writable();
  const q = parseQuick(query, now, Number(conf().default_length) || 30, cals.map((c) => c.title));
  if ("problem" in q) return [query.trim() ? hintRow("Not an event yet", q.problem) : hintRow("Type an event", "standup tomorrow 10:00, dentist fri 2pm-3pm, lunch 12:30 for 45m at Rest, retro next tue 3pm @ Work, birthday 20 sep")];
  const cal = q.calendar ? cals.find((c) => c.title.toLowerCase().startsWith(q.calendar!.toLowerCase())) : undefined;
  quick.clear();
  quick.set(query, { ...q, calendarId: cal?.id });
  const where = [quickWhen(q, now), q.location, cal ? `${cal.title} calendar` : q.calendar ? `no calendar named ${q.calendar}, so the default` : undefined].filter(Boolean).join(" · ");
  const color = cal?.color && /^#[0-9a-f]{6}$/i.test(cal.color) ? (cal.color as `#${string}`) : undefined;
  return [{
    id: query,
    name: q.title,
    subtitle: where,
    icon: color ? tinted(ROW, color) : "\u{f0415}",
    accessories: [...(q.allDay ? [{ tag: "all day" }] : []), ...(q.assumedDay && !q.allDay && q.day !== startOfDay(now) ? [{ tag: "tomorrow", color: "amber" }] : []), { date: q.start }],
    actions: [{ id: "add", title: "Add event" }],
  }];
}

async function quickPick(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id === HINT || id === NOTHING) return;
  if (id === GRANT) return pick(id, action, ctx);
  // A pick after a restart or a relist: parse the line again.
  if (!quick.has(id)) await quickRows(id);
  const q = quick.get(id);
  if (!q) return { keep: true, toast: { title: "Not an event yet", message: "standup tomorrow 10:00", style: "failure" } };
  try { return await add({ title: q.title, start: q.start, end: q.end, allDay: q.allDay, calendar: q.calendarId, location: q.location }); }
  catch (e) { return failed("add the event", e); }
}

/** The event behind a row id, from the listing or fetched again after a restart. */
async function find(id: string): Promise<CalendarEvent | undefined> {
  const have = table.get(id);
  if (have) return have;
  const at = Number(id.slice(id.lastIndexOf("@") + 1));
  if (!Number.isFinite(at)) return;
  const es = active() === "google" ? (await load(startOfDay(at), addDays(at, 1), undefined, PALETTE_AGE)).events : await calendar.events(at - 1, at + 1);
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
      forget();
      return { keep: true, toast: { title: "Deleted", message: e.title, style: "success" } };
    case "open":
    default:
      if (isGoogle()) return e.url ? { open: e.url } : { copy: details(e) };
      try { await calendar.open(e.id, e.occurrence); } catch (err) { return failed("open the event", err); }
      return { hide: true };
  }
}

/** The calendar filters, read once at load: `PaletteMeta.filters` is static. A missing permission leaves "All" alone until the next host start. */
async function loadFilters(): Promise<{ id: string; title: string }[]> {
  const all = [{ id: "all", title: "All calendars" }];
  try {
    if ((await permission()) !== "granted") return all;
    const s = settings.get<Settings>(EXTENSION);
    const ids = await chosenIds(s, false);
    const cals = (await calendars()).filter((c) => !ids || ids.includes(c.id));
    return [...all, ...cals.map((c) => ({ id: c.id, title: c.source && active() === "google" ? `${c.title} (${c.source})` : c.title }))];
  } catch (e) {
    log(`filters: ${errorMessage(e)}`);
    return all;
  }
}

/** The window every reader shares: local midnight to `days` ahead (two at least, so Today has tomorrow). */
function window(s: Settings, now: number): { from: number; to: number } {
  const days = Math.max(2, Math.round(Number(s.days) || 7));
  return { from: startOfDay(now), to: addDays(now, days) };
}

/** The events for a palette: the permission rows, a hint row on a failure, else the rows; `stale` rides along. */
async function events(ctx: Ctx | undefined, maxAge: number, withNew = false): Promise<{ events: CalendarEvent[]; stale: boolean; error?: string } | { rows: Item[] }> {
  const status = await permission();
  if (status !== "granted") return { rows: statusRows(status) };
  const s = conf();
  const now = clock();
  const { from, to } = window(s, now);
  try {
    const chosen = ctx?.filter && ctx.filter !== "all" ? [ctx.filter] : await chosenIds(s, !!ctx?.refresh);
    const l = await load(from, to, chosen, ctx?.refresh ? 0 : maxAge);
    return { events: l.events, stale: l.stale, error: l.error };
  } catch (e) {
    return { rows: [hintRow("Could not read the calendar", errorMessage(e)), ...(withNew && active() === "system" ? [newRow] : [])] };
  }
}

async function scheduleRows(_query: string | undefined, ctx?: Ctx): Promise<Item[]> {
  const r = await events(ctx, PALETTE_AGE, true);
  if ("rows" in r) return r.rows;
  const s = conf();
  const now = clock();
  table.clear();
  let tagged = false;
  const rows = upcoming(r.events, now, s.hide_declined !== false).map((e) => {
    const tag = !tagged && !e.all_day && soonTag(e, now) !== undefined;
    if (tag) tagged = true;
    return row(e, now, tag);
  });
  return active() === "system" ? [...rows, newRow] : rows;
}

/**
 * Today's rows in time order, every state (`over`, `now`, `in 12 min`),
 * then tomorrow's under their own section once no timed event is left
 * today (from the bar, `args.rest`: the over ones dropped and tomorrow
 * always there, the strip's popover being about what is still to come).
 * A "Nothing else today" row names the next timed event's day when the
 * day is done, "Nothing today" when it never had one.
 */
async function todayRows(_query: string | undefined, ctx?: Ctx): Promise<Item[]> {
  const r = await events(ctx, PALETTE_AGE);
  if ("rows" in r) return r.rows;
  const s = conf();
  const now = clock();
  const rest = !!(ctx?.args && typeof ctx.args === "object" && (ctx.args as { rest?: boolean }).rest);
  const hideDeclined = s.hide_declined !== false;
  const keep = (e: CalendarEvent) => !(hideDeclined && e.my_status === "declined") && !(rest && e.end <= now);
  table.clear();
  const today = onDay(r.events, now).filter(keep);
  // An all-day event is not something else to attend: the day is done once the timed ones are.
  const left = today.filter((e) => e.end > now && !e.all_day);
  const rows: Item[] = today.map((e) => todayRow(e, now, "Today"));
  const tomorrow = onDay(r.events, addDays(now, 1)).filter(keep);
  if (!left.length) {
    const next = r.events.filter((e) => e.start >= addDays(now, 1) && !e.all_day && keep(e)).sort((a, b) => a.start - b.start)[0];
    rows.push({ id: NOTHING, name: today.length ? "Nothing else today" : "Nothing today", subtitle: nextWords(next, now), icon: CLEAR, section: "Today", keywords: ["free", "clear"], actions: [] });
  }
  if (!left.length || rest) rows.push(...tomorrow.map((e) => todayRow(e, now, "Tomorrow")));
  if (r.stale) rows.unshift({ ...hintRow("Showing the last events read", r.error ?? "The source did not answer"), section: "Today" });
  return rows;
}

/**
 * The empty root's "Now" row: the event the bar strip speaks for (the
 * current one, else the next inside `horizon_hours`, the strip's rules),
 * as a Today row with Join first when it has a call. From the cache when
 * it is under a minute old, so a show costs nothing; nothing without the
 * permission or with a clear day.
 */
async function suggest(): Promise<Item[]> {
  if ((await permission()) !== "granted") return [];
  const s = conf();
  const now = clock();
  const { from, to } = window(s, now);
  let l: Loaded;
  try { l = await load(from, to, await chosenIds(s, false), PALETTE_AGE); } catch { const c = cached(); if (!c) return []; l = { ...c, stale: true }; }
  const rules = barRules(s);
  const e = nextEvent(l.events, now, rules);
  return e ? [todayRow(e, now, "Now")] : [];
}

async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id === HINT || id === NOTHING) return;
  if (id === GRANT) {
    if (action === "settings") {
      try { await calendar.openSettings(); } catch (e) { return failed("open System Settings", e); }
      return { hide: true };
    }
    let status: CalendarStatus;
    try { status = await calendar.request(); } catch (e) { return failed("ask for calendar access", e); }
    if (status === "granted") { forget(); return { keep: true, toast: { title: "Calendar access granted", style: "success" } }; }
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
}

async function detail(id: string): Promise<Detail | void> {
  if (id === HINT || id === GRANT || id === NEW || id === NOTHING) return;
  let e: CalendarEvent | undefined;
  try { e = await find(id); } catch { return; }
  if (!e) return;
  const metadata: Metadata[] = [
    { label: "When", value: e.all_day ? `${dayNameYear(e.start)} (${timeRange(e).toLowerCase()})` : `${dayNameYear(e.start)}, ${timeRange(e)} (${duration(e)})` },
    { label: "Calendar", tags: [{ text: e.calendar.source ? `${e.calendar.title} (${e.calendar.source})` : e.calendar.title }] },
  ];
  if (e.location) metadata.push({ label: "Location", value: e.location });
  if (e.conference_url) metadata.push({ label: "Call", link: { text: e.conference_url.replace(/^https?:\/\//, "").slice(0, 60), href: e.conference_url } });
  else if (e.url) metadata.push({ label: "Link", link: { text: /google\.com\/calendar/.test(e.url) ? "Open in Google Calendar" : e.url.replace(/^https?:\/\//, "").slice(0, 60), href: e.url } });
  if (e.organizer) metadata.push({ label: "Organizer", value: e.organizer });
  if (e.attendees.length) metadata.push({ label: `Attendees (${e.attendees.length})`, tags: e.attendees.slice(0, 12).map((a) => ({ text: a.me ? `${a.name} (you)` : a.name, color: STATUS_COLOR[a.status] })) });
  if (e.my_status) metadata.push({ label: "Your reply", tags: [{ text: e.my_status, color: STATUS_COLOR[e.my_status] }] });
  if (e.recurring) metadata.push({ label: "Repeats", value: "yes" });
  return { markdown: e.notes ? e.notes : `# ${e.title || "(no title)"}`, metadata };
}

// ---- the bar item ------------------------------------------------------------------

/**
 * A minute tick reads the cache (a render is then well under a
 * millisecond); every other reason (the five-minute timer, a wake, the
 * network back, a settings change, the CLI) fetches. Nothing to show
 * without permission or with no cache and a source that fails: the strip
 * has no room for a hint, the palette says why.
 */
async function renderUpcoming(ctx: BarCtx): Promise<BarItem> {
  if ((await permission()) !== "granted") return { hidden: true };
  const s = conf();
  const now = clock();
  const { from, to } = window(s, now);
  const maxAge = ctx.reason === "minute" ? BAR_AGE : 0;
  let l: Loaded;
  try { l = await load(from, to, await chosenIds(s, false), maxAge); } catch (e) {
    const c = cached();
    if (!c) throw e;
    l = { ...c, stale: true, error: errorMessage(e) };
  }
  // A hover peek starts its popover fresh: the ring on the first row, tomorrow folded (open when the day is clear).
  if (ctx.reason === "open") pop = freshPopover(isGoogle());
  pop.google = isGoogle();
  if (!listed(l.events, now, s.hide_declined !== false).today.length) pop.expanded = true;
  return upcomingItem(l.events, now, { ...s, ...(ctx.settings as ItemSettings) }, l.stale ? l.error ?? "The source did not answer" : undefined, pop);
}

/** A direct bar click: join the event it currently speaks for, else open the day's calendar. Its menu still serves hover peeks. */
async function openUpcoming(_ctx: BarCtx): Promise<Effect> {
  const now = clock();
  if ((await permission()) !== "granted") return calendarHome(now);
  const s = conf();
  const { from, to } = window(s, now);
  let l: Loaded;
  try { l = cached() ?? await load(from, to, await chosenIds(s, false), 0); } catch { return calendarHome(now); }
  const e = nextEvent(l.events, now, barRules(s));
  return e?.conference_url ? { open: e.conference_url, hud: words(e) } : calendarHome(now);
}

// ---- the popover ---------------------------------------------------------------------

/** The popover's keys' state, kept across trees while it shows; `google` follows the source. */
let pop: PopoverState = freshPopover(active() === "google");
let tick: ReturnType<typeof setInterval> | undefined;
/** How often the open popover is redrawn from the cache: the `in N min` texts move by the minute, so half of one keeps them honest (the tests shorten it). */
const POPOVER_TICK_MS = Number(process.env.PAL_CALENDAR_POPOVER_TICK_MS) || 30_000;

/** The popover's tree from the cache, no fetch: what the tick and every key answer with. */
function popoverView(now = clock()): ReturnType<typeof popover> | undefined {
  const c = cached();
  if (!c) return;
  const s = conf();
  return popover(c.events, now, s.hide_declined !== false, pop, c.stale ? c.error ?? "The source did not answer" : undefined);
}

function pushPopover() {
  const v = popoverView();
  if (v) liveView.update(v, { extension: EXTENSION, bar: ITEM }).catch((e) => log(`popover push: ${errorMessage(e)}`));
}

liveView.onShown((ev) => { if (ev.bar !== ITEM) return; if (tick) clearInterval(tick); tick = setInterval(pushPopover, POPOVER_TICK_MS); }, EXTENSION);
liveView.onHidden((ev) => { if (ev.bar !== ITEM || !tick) return; clearInterval(tick); tick = undefined; }, EXTENSION);

/** Where "Open Calendar" goes: the app on macOS, the day's page for a Google source. */
const calendarHome = (now: number): Effect => {
  if (isGoogle()) { const d = new Date(now); return { open: `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` }; }
  return MAC ? { open: "/System/Applications/Calendar.app" } : { hide: true };
};

/**
 * A key or a click in the popover. The rows are the cache's (a tree
 * always follows a cache), so nothing here fetches but `refresh`; a row
 * action goes through `pickEvent`, as from the palette.
 */
async function popoverAction(action: string, ctx: BarCtx): Promise<Effect | void> {
  const now = clock();
  const s = conf();
  const c = cached();
  const l = c ? listed(c.events, now, s.hide_declined !== false) : undefined;
  const rows = l ? focusable(l, pop) : [];
  const cur = rows[Math.max(0, Math.min(pop.cursor, rows.length - 1))];
  const redraw = (): Effect => { const v = popoverView(now); return v ? { view: v } : { keep: true }; };
  const byId = (id: string) => rows.find((e) => viewRowId(e) === id) ?? (l ? [...l.today, ...l.tomorrow].find((e) => viewRowId(e) === id) : undefined);
  switch (action) {
    case "refresh": forget(); return { keep: true, hud: "Refreshing" };
    case "open-calendar": return calendarHome(now);
    case "tomorrow": pop.expanded = !pop.expanded; if (!pop.expanded && l) pop.cursor = Math.min(pop.cursor, Math.max(0, l.today.length - 1)); return redraw();
    case "down": pop.cursor = Math.min(rows.length - 1, pop.cursor + 1); return redraw();
    case "up": pop.cursor = Math.max(0, pop.cursor - 1); return redraw();
    case "join-next": { const e = rows.find((e) => e.conference_url); return e ? { open: e.conference_url!, hud: words(e) } : { keep: true }; }
    case "primary": return cur ? pickEvent(cur, cur.conference_url ? "join" : isGoogle() || MAC ? "open" : "copy_details") : calendarHome(now);
    case "copy": return cur ? { copy: details(cur) } : { keep: true };
    case "copy-link": return cur?.conference_url ? { copy: cur.conference_url } : { keep: true };
  }
  if (action.startsWith("focus:")) { const i = rows.findIndex((e) => viewRowId(e) === action.slice(6)); if (i >= 0) pop.cursor = i; return redraw(); }
  if (action.startsWith("join:")) { const e = byId(action.slice(5)); return e?.conference_url ? { open: e.conference_url, hud: words(e) } : { keep: true }; }
  void ctx;
}

/**
 * Google is a token command per account (his is an ssh hop) and a network
 * read: with that source the first listing of a run waits for the first
 * panel show. The system source (EventKit, khal) is local and lists at
 * start as before. Read once at load; a source switched in the settings
 * takes effect at the next load of the extension. (`loadFilters` still
 * asks Google for the calendar names at load: the filters are static
 * meta.)
 */
const lazy = active() === "google";

export default {
  palettes: {
    schedule: {
      title: "My Schedule",
      live: true,
      lazy,
      placeholder: "Search your events",
      filters: await loadFilters(),
      list: scheduleRows,
      pick,
      detail,
    },
    [TODAY]: {
      title: "Today",
      live: true,
      lazy,
      placeholder: "Search today's events",
      list: todayRows,
      // The empty root's Now section: the current or next event, Join on Enter.
      suggest,
      pick,
      detail,
    },
    [QUICK]: {
      title: "Quick Add Event",
      input: true,
      placeholder: "standup tomorrow 10:00",
      // A root query nothing matched offers to add it.
      fallback: "Add “{query}” to the calendar",
      list: quickRows,
      pick: quickPick,
    },
  },
  bar: {
    [ITEM]: { render: renderUpcoming, onOpen: openUpcoming, onAction: popoverAction },
  },
  dispose: () => { if (tick) clearInterval(tick); tick = undefined; },
} satisfies Extension;
