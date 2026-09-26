// Calendar over the system source: the pure helpers (schedule.ts,
// today.ts) by import, then the extension through the harness against
// canned core/calendar.* replies: My Schedule's sections, the now / in N
// min tag, accessories, actions by platform, the picks and what they ask
// the core, the calendar filter and setting, the lazy detail, the New
// event form and its submit, the permission rows; Today's rows and
// states, the "Nothing else today" row and tomorrow's section; the
// `upcoming` bar item, its escalation and horizon, the cache a minute
// tick reads and how long that render takes. The Google source is
// calendar-google.test.ts.
//
// The clock is pinned: `PAL_NOW` is the host's clock (the SDK's clock.ts)
// and `TZ` its zone, both passed through the harness, so the fixtures are
// fixed instants around Wed 16 Sep 2026 10:30 UTC and every `over`, `now`,
// `in 42 min`, tomorrow and horizon reads the same at any hour of any day.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { addDays, DAY, dayName, details, parseDay, parseTime, plusMinutes, section, soonTag, startOfDay, timeRange, upcoming } from "../../../extensions/calendar/schedule.ts";
import type { Settings } from "../../../extensions/calendar/source.ts";
import { barName, barWhen, callsNow, callWhen, eligible, escalation, nextEvent, nextWords, onDay, phaseOf, service, shortSpan, span, state, upcomingItem, type ItemSettings } from "../../../extensions/calendar/today.ts";
import { parseLength, parseQuick, type Quick } from "../../../extensions/calendar/quick.ts";
import { actions as popoverActions, focusable, freshPopover, listed, popover } from "../../../extensions/calendar/view.ts";
import type { BarItem, Calendar, CalendarEvent, Form, View, ViewNode } from "../../../sdk/src/index.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host } from "../harness.ts";

process.env.TZ = "UTC";
process.env.PAL_NOW = "2026-09-16T10:30:00";
const E = "calendar";
const P = "schedule";
const MAC = process.platform === "darwin";
const MIN = 60_000;
const H = 60 * MIN;

const cals: Calendar[] = [
  { id: "cal-work", title: "Work", color: "#1e4d8c", source: "Google", writable: true },
  { id: "cal-home", title: "Home", color: "#34aadc", source: "iCloud", writable: true },
  { id: "cal-hol", title: "Holidays", color: "#16a765", source: "Google", writable: false },
];
const ev = (id: string, title: string, start: number, end: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, occurrence: null, title, start, end, all_day: false, location: null, notes: null, url: null, calendar: cals[0], attendees: [], organizer: null, conference_url: null, recurring: false, my_status: null, ...extra,
});

// Fixtures around the pinned clock (Wed 16 Sep 2026 10:30): a running event, the next one, one tomorrow, one this week, one later, an all-day, a declined one, a past one.
const now = Date.parse(process.env.PAL_NOW);
const today = startOfDay(now);
const curStart = now - 10 * MIN;
const ZOOM = "https://serpapi.zoom.us/j/85712227948?pwd=abc";
const events: CalendarEvent[] = [
  ev("standup", "Standup", curStart, now + 20 * MIN, { occurrence: curStart, recurring: true, conference_url: ZOOM, location: ZOOM, attendees: [{ name: "Terry", status: "accepted", me: false }, { name: "Cagdas", status: "accepted", me: true }], organizer: "terry@serpapi.com", my_status: "accepted", notes: "Daily sync\n\n- items" }),
  ev("past", "Earlier today", today + 8 * H, today + 9 * H),
  ev("next", "Dentist", now + 42 * MIN, now + 72 * MIN, { calendar: cals[1], location: "Room 4" }),
  ev("declined", "Sales sync", now + 3 * H, now + 4 * H, { my_status: "declined", attendees: [{ name: "Bob", status: "accepted", me: false }, { name: "Cagdas", status: "declined", me: true }] }),
  ev("tmr", "Concert", addDays(now, 1) + 19 * H, addDays(now, 1) + 21 * H, { calendar: cals[1] }),
  ev("week", "Review", addDays(now, 4) + 10 * H, addDays(now, 4) + 11 * H, { url: "https://example.com/doc" }),
  ev("holiday", "Republic Day", addDays(now, 5), addDays(now, 6), { all_day: true, calendar: cals[2] }),
  ev("later", "Offsite", addDays(now, 10) + 9 * H, addDays(now, 12) + 17 * H),
];

let status = "granted";
const calls: { method: string; params: any }[] = [];
let host: Host;
const core = (list: CalendarEvent[] = events) => ({
  "calendar.permission": () => status,
  "calendar.request": () => { calls.push({ method: "request", params: null }); return status; },
  "calendar.open_settings": () => { calls.push({ method: "open_settings", params: null }); return null; },
  "calendar.calendars": () => cals,
  "calendar.events": (p: any) => { calls.push({ method: "events", params: p }); return list.filter((e) => e.end > p.from && e.start < p.to && (!p.calendars || p.calendars.includes(e.calendar.id))); },
  "calendar.create": (p: any) => { calls.push({ method: "create", params: p }); if (p.calendar === "cal-hol" || p.title === "boom") throw new Error("Holidays does not take new events"); return "new-id"; },
  "calendar.delete": (p: any) => { calls.push({ method: "delete", params: p }); return null; },
  "calendar.open": (p: any) => { calls.push({ method: "open", params: p }); return null; },
});
beforeAll(async () => { host = await Host.bundled({ core: core(), settings: { [E]: { settings: { days: 14 } } } }); });
afterAll(() => { host.kill(); delete process.env.PAL_NOW; });

const list = (ctx?: Parameters<Host["list"]>[3]) => host.list(E, P, "", ctx);
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick(E, P, id, action, ctx);
const last = () => calls[calls.length - 1];
const rid = (e: CalendarEvent) => `${e.id}@${e.start}`;

describe("schedule helpers", () => {
  const t0 = new Date(2026, 8, 16, 10, 0).getTime(); // Wed 16 Sep 2026 10:00 local
  test("sections by day", () => {
    expect(section(t0 + H, t0)).toBe("Today");
    expect(section(addDays(t0, 1), t0)).toBe("Tomorrow");
    expect(section(addDays(t0, 2), t0)).toBe("This week");
    expect(section(addDays(t0, 6) + 23 * H, t0)).toBe("This week");
    expect(section(addDays(t0, 7), t0)).toBe("Later");
  });
  test("time ranges", () => {
    expect(timeRange({ start: t0, end: t0 + 30 * MIN, all_day: false })).toBe("10:00 – 10:30");
    expect(timeRange({ start: t0, end: addDays(t0, 1) + 9 * H, all_day: false })).toBe("10:00 – Thu 17 Sep 09:00");
    expect(timeRange({ start: startOfDay(t0), end: addDays(t0, 1), all_day: true })).toBe("All day");
    expect(timeRange({ start: startOfDay(t0), end: addDays(t0, 3), all_day: true })).toBe("All day, until Fri 18 Sep");
  });
  test("the soon tag", () => {
    expect(soonTag({ start: t0 - MIN, end: t0 + MIN, all_day: false }, t0)).toBe("now");
    expect(soonTag({ start: t0 + 12 * MIN, end: t0 + H, all_day: false }, t0)).toBe("in 12 min");
    expect(soonTag({ start: t0 + 2 * H + 10 * MIN, end: t0 + 3 * H, all_day: false }, t0)).toBe("in 2 h");
    expect(soonTag({ start: t0 + 30 * H, end: t0 + 31 * H, all_day: false }, t0)).toBeUndefined();
    expect(soonTag({ start: startOfDay(t0), end: addDays(t0, 1), all_day: true }, t0)).toBeUndefined();
  });
  test("upcoming drops ended and declined, keeps order", () => {
    const a = ev("a", "A", t0 - 2 * H, t0 - H);
    const b = ev("b", "B", t0 + H, t0 + 2 * H);
    const c = ev("c", "C", t0 + 30 * MIN, t0 + H, { my_status: "declined" });
    expect(upcoming([a, b, c], t0, true).map((e) => e.id)).toEqual(["b"]);
    expect(upcoming([a, b, c], t0, false).map((e) => e.id)).toEqual(["c", "b"]);
  });
  test("details text", () => {
    expect(details(ev("x", "Dentist", t0, t0 + H, { location: "Room 4", conference_url: "https://zoom.us/j/1" }))).toBe("Dentist\nWed 16 Sep 2026, 10:00 – 11:00\nRoom 4\nhttps://zoom.us/j/1");
    expect(details(ev("y", "Trip", startOfDay(t0), addDays(t0, 3), { all_day: true }))).toBe("Trip\nWed 16 Sep 2026 – Fri 18 Sep 2026 (all day)");
  });
  test("parseDay: words, weekdays, numbers", () => {
    const d0 = startOfDay(t0);
    expect(parseDay("today", t0)).toBe(d0);
    expect(parseDay("", t0)).toBe(d0);
    expect(parseDay("Tomorrow", t0)).toBe(addDays(t0, 1));
    expect(parseDay("wed", t0)).toBe(d0); // today is Wednesday
    expect(parseDay("fri", t0)).toBe(addDays(t0, 2));
    expect(parseDay("monday", t0)).toBe(addDays(t0, 5));
    expect(parseDay("next wed", t0)).toBe(addDays(t0, 7));
    expect(parseDay("next fri", t0)).toBe(addDays(t0, 2));
    expect(parseDay("next week", t0)).toBe(addDays(t0, 7));
    expect(parseDay("2026-09-20", t0)).toBe(new Date(2026, 8, 20).getTime());
    expect(parseDay("20.9", t0)).toBe(new Date(2026, 8, 20).getTime());
    expect(parseDay("20/09/2027", t0)).toBe(new Date(2027, 8, 20).getTime());
    expect(parseDay("20 sep", t0)).toBe(new Date(2026, 8, 20).getTime());
    expect(parseDay("Sep 20th, 2026", t0)).toBe(new Date(2026, 8, 20).getTime());
    expect(parseDay("2026-02-30", t0)).toBeUndefined();
    expect(parseDay("someday", t0)).toBeUndefined();
  });
  test("parseTime and the form defaults", () => {
    expect(parseTime("14:30")).toBe(14 * 60 + 30);
    expect(parseTime("9")).toBe(9 * 60);
    expect(parseTime("2pm")).toBe(14 * 60);
    expect(parseTime("2:30 PM")).toBe(14 * 60 + 30);
    expect(parseTime("12am")).toBe(0);
    expect(parseTime("12 pm")).toBe(12 * 60);
    expect(parseTime("1430")).toBe(14 * 60 + 30);
    expect(parseTime("noon")).toBe(12 * 60);
    expect(parseTime("25:00")).toBeUndefined();
    expect(parseTime("13pm")).toBeUndefined();
    expect(parseTime("soon")).toBeUndefined();
    expect(plusMinutes("23:30", 60)).toBe("00:30");
    expect(plusMinutes("09:15", 45)).toBe("10:00");
  });
});

describe("quick add grammar", () => {
  // Wed 16 Sep 2026 10:30 (the pinned clock, UTC): today is the 16th, `fri` the 18th, `next tue` the 22nd.
  const at = (d: number, h: number, m = 0) => addDays(now, d - 16) + h * H + m * MIN;
  const q = (line: string, cals: string[] = ["Work", "Home"], len = 30) => parseQuick(line, now, len, cals) as Quick;
  const problem = (line: string) => (parseQuick(line, now) as { problem: string }).problem;

  test("lengths: minutes, hours, both, words", () => {
    expect(parseLength("45m")).toBe(45);
    expect(parseLength("1h")).toBe(60);
    expect(parseLength("1h30m")).toBe(90);
    expect(parseLength("2 hours")).toBe(120);
    expect(parseLength("90 min")).toBe(90);
    expect(parseLength("1.5h")).toBe(90);
    expect(parseLength("soon")).toBeUndefined();
    expect(parseLength("0m")).toBeUndefined();
  });

  test("a title, a day and a time: the default length; a range; the day words schedule.ts knows", () => {
    expect(q("standup tomorrow 10:00")).toMatchObject({ title: "standup", day: at(17, 0), start: at(17, 10), end: at(17, 10, 30), allDay: false, assumedDay: false });
    expect(q("dentist fri 2pm-3pm")).toMatchObject({ title: "dentist", start: at(18, 14), end: at(18, 15) });
    expect(q("review next tue 14:00 to 15:30")).toMatchObject({ title: "review", start: at(22, 14), end: at(22, 15, 30) });
    expect(q("trip 2026-09-20 9am")).toMatchObject({ title: "trip", start: at(20, 9) });
    expect(q("x on monday noon")).toMatchObject({ title: "x", start: at(21, 12), end: at(21, 12, 30) });
    expect(q("team sync 9-10am")).toMatchObject({ title: "team sync", start: at(17, 9), end: at(17, 10), assumedDay: true });
    expect(q("standup tomorrow 10:00", [], 45)).toMatchObject({ end: at(17, 10, 45) });
  });

  test("no day: today, or tomorrow once the time has passed; no time: all day; for, at and @ come off the end in any order", () => {
    expect(q("call mum 5pm")).toMatchObject({ title: "call mum", start: at(16, 17), assumedDay: true });
    expect(q("call mum 9am")).toMatchObject({ title: "call mum", start: at(17, 9), assumedDay: true });
    expect(q("lunch with ali 12:30 for 45m")).toMatchObject({ title: "lunch with ali", start: at(16, 12, 30), end: at(16, 13, 15) });
    expect(q("retro next tue 15:00 at Room 4")).toMatchObject({ title: "retro", start: at(22, 15), location: "Room 4" });
    expect(q("birthday 20 sep all day")).toMatchObject({ title: "birthday", day: at(20, 0), start: at(20, 0), end: at(21, 0), allDay: true });
    expect(q("walk")).toMatchObject({ title: "walk", allDay: true, day: today, assumedDay: true });
    expect(q("coffee with 2 people 3pm")).toMatchObject({ title: "coffee with 2 people", start: at(16, 15) });
    expect(q("late 23:00-00:30")).toMatchObject({ start: at(16, 23), end: at(17, 0, 30) });
  });

  test("the calendar: @ anywhere, in only when a calendar starts with the word (an in in a title stays), two words when they name one", () => {
    expect(q("1:1 mon 9am in Work")).toMatchObject({ title: "1:1", calendar: "Work", start: at(21, 9) });
    expect(q("review @ Work 14:00 to 15:30")).toMatchObject({ title: "review", calendar: "Work" });
    expect(q("@home gym 7am")).toMatchObject({ title: "gym", calendar: "home" });
    expect(q("lunch in town 1pm")).toMatchObject({ title: "lunch in town", calendar: undefined });
    expect(q("check in 3pm")).toMatchObject({ title: "check in" });
    expect(q("planning in Work Stuff tue 3pm", ["Work Stuff"])).toMatchObject({ title: "planning", calendar: "Work Stuff" });
  });

  test("what cannot be read: an empty line, a line that is only a day", () => {
    expect(problem("")).toBe("Type an event: standup tomorrow 10:00");
    expect(problem("   ")).toBe("Type an event: standup tomorrow 10:00");
    expect(problem("tomorrow 10:00")).toBe("A title first: dentist fri 2pm");
  });
});

describe("today helpers", () => {
  const t0 = new Date(2026, 8, 16, 10, 0).getTime();
  const rules = { horizon_hours: 10, warn_minutes: 15, urgent_minutes: 5, hide_declined: true, hide_all_day: true };
  test("spans", () => {
    expect(span(25 * MIN)).toBe("25 min");
    expect(span(H)).toBe("1 h");
    expect(span(90 * MIN)).toBe("1 h 30 min");
    expect(span(25 * H + 20 * MIN)).toBe("25 h");
    expect(span(2 * DAY)).toBe("2 days");
    expect(shortSpan(12 * MIN)).toBe("12m");
    expect(shortSpan(80 * MIN)).toBe("1h 20m");
    expect(shortSpan(3 * H)).toBe("3h");
    expect(shortSpan(-MIN)).toBe("0m");
    expect(shortSpan(114 * H + 3 * MIN)).toBe("4d");
  });
  test("state against the clock", () => {
    expect(state({ start: t0 - H, end: t0 - MIN, all_day: false }, t0)).toEqual({ kind: "over", text: "over" });
    expect(state({ start: t0 - 5 * MIN, end: t0 + 25 * MIN, all_day: false }, t0)).toEqual({ kind: "now", text: "now, 25 min left" });
    expect(state({ start: t0 + 12 * MIN, end: t0 + H, all_day: false }, t0)).toEqual({ kind: "soon", text: "in 12 min" });
    expect(state({ start: t0 + 2 * H + 5 * MIN, end: t0 + 3 * H, all_day: false }, t0)).toEqual({ kind: "soon", text: "in 2 h 5 min" });
    expect(state({ start: t0 + 30 * H, end: t0 + 31 * H, all_day: false }, t0)).toEqual({ kind: "later", text: "in 30 h" });
    expect(state({ start: t0 + 3 * DAY, end: t0 + 3 * DAY + H, all_day: false }, t0)).toEqual({ kind: "later", text: "in 3 days" });
    expect(state({ start: startOfDay(t0), end: addDays(t0, 1), all_day: true }, t0)).toEqual({ kind: "now", text: "today" });
    expect(state({ start: addDays(t0, 1), end: addDays(t0, 2), all_day: true }, t0)).toEqual({ kind: "later", text: "tomorrow" });
    expect(state({ start: addDays(t0, 3), end: addDays(t0, 4), all_day: true }, t0)).toEqual({ kind: "later", text: "in 3 days" });
  });
  test("escalation at the boundaries, inclusive", () => {
    const at = (mins: number) => escalation({ start: t0 + mins * MIN, end: t0 + (mins + 30) * MIN }, t0, 15, 5);
    expect(at(600)).toBe("muted");
    expect(at(15.01)).toBe("muted");
    expect(at(15)).toBe("amber");
    expect(at(5.01)).toBe("amber");
    expect(at(5)).toBe("red");
    expect(at(0.5)).toBe("red");
    expect(at(0)).toBe("green");
    expect(at(-10)).toBe("green");
    expect(escalation({ start: t0 + 3 * MIN, end: t0 + H }, t0, 30, 0)).toBe("amber"); // urgent 0: red only at the start
  });
  test("the strip's title is the name alone, cut only at the protocol's ceiling; the time is its own text", () => {
    expect(barName({ title: "Standup" })).toBe("Standup");
    expect(barName({ title: "" })).toBe("(no title)");
    expect(barName({ title: "  Standup " })).toBe("Standup");
    // Clipping to the bar's width is the target's job (`max_chars`): a 52-char name goes out whole.
    expect(barName({ title: "A very long meeting title that goes on and on and on" })).toBe("A very long meeting title that goes on and on and on");
    const long = barName({ title: "x".repeat(70) });
    expect(long).toBe("x".repeat(63) + "…");
    expect(long.length).toBe(64);
    expect(barWhen({ start: t0 + 12 * MIN, end: t0 + H }, t0)).toBe("in 12m");
    expect(barWhen({ start: t0 + 2 * H, end: t0 + 3 * H }, t0)).toBe("in 2h");
    expect(barWhen({ start: t0 - MIN, end: t0 + 25 * MIN }, t0)).toBe("25m left");
    expect(barWhen({ start: t0, end: t0 + 90 * MIN }, t0)).toBe("1h 30m left");
  });
  test("the event the strip speaks for: running first, then the next timed one inside the horizon", () => {
    const running = ev("r", "Running", t0 - 10 * MIN, t0 + 20 * MIN);
    const allDay = ev("a", "Holiday", startOfDay(t0), addDays(t0, 1), { all_day: true });
    const declined = ev("d", "Declined", t0 + 30 * MIN, t0 + H, { my_status: "declined" });
    const next = ev("n", "Next", t0 + 2 * H, t0 + 3 * H);
    const far = ev("f", "Far", t0 + 11 * H, t0 + 12 * H);
    const past = ev("p", "Past", t0 - 2 * H, t0 - H);
    expect(nextEvent([far, next, past, declined, allDay, running], t0, rules)?.id).toBe("r");
    expect(nextEvent([far, next, past, declined, allDay], t0, rules)?.id).toBe("n");
    expect(nextEvent([far, next, past, declined, allDay], t0, { ...rules, hide_declined: false })?.id).toBe("d");
    expect(nextEvent([far, allDay], t0, { ...rules, hide_all_day: false })?.id).toBe("a");
    expect(nextEvent([far, past], t0, rules)).toBeUndefined();
    expect(nextEvent([far], t0, { ...rules, horizon_hours: 11 })?.id).toBe("f");
    expect(nextEvent([ev("x", "Exactly", t0 + 10 * H, t0 + 11 * H)], t0, rules)?.id).toBe("x");
    // The whole list the strip may draw from, in start order: the running one, then what is inside the horizon.
    expect(eligible([far, next, past, declined, allDay, running], t0, rules).map((e) => e.id)).toEqual(["r", "n"]);
    expect(eligible([far, past], t0, rules)).toEqual([]);
  });
  test("the day's events and the next event's words", () => {
    const a = ev("a", "A", t0 + H, t0 + 2 * H), b = ev("b", "B", addDays(t0, 1) + H, addDays(t0, 1) + 2 * H), c = ev("c", "C", t0 - 3 * H, t0 - 2 * H);
    expect(onDay([b, a, c], t0).map((e) => e.id)).toEqual(["c", "a"]);
    expect(onDay([b, a, c], addDays(t0, 1)).map((e) => e.id)).toEqual(["b"]);
    expect(nextWords(b, t0)).toBe("Next: B, tomorrow 01:00");
    expect(nextWords(ev("d", "D", addDays(t0, 3) + 9 * H, addDays(t0, 3) + 10 * H), t0)).toBe("Next: D, Sat 19 Sep 09:00");
    expect(nextWords(ev("e", "E", addDays(t0, 3), addDays(t0, 4), { all_day: true }), t0)).toBe("Next: E, Sat 19 Sep");
    expect(nextWords(undefined, t0)).toBe("Nothing further in the days ahead");
  });
  test("the root's call rows: from the lead until ten minutes in (or the end), calls only, soonest first, the words moving with the clock", () => {
    const MEET = "https://meet.google.com/abc-defg-hij";
    const call = ev("c", "Standup", t0 + 5 * MIN, t0 + 35 * MIN, { conference_url: ZOOM });
    const short = ev("s", "Check-in", t0 + 5 * MIN, t0 + 12 * MIN, { conference_url: MEET });
    const plain = ev("p", "Dentist", t0 + 2 * MIN, t0 + H);
    const declined = ev("d", "Sales sync", t0 + 3 * MIN, t0 + H, { conference_url: ZOOM, my_status: "declined" });
    const allDay = ev("a", "Offsite", startOfDay(t0), addDays(t0, 1), { all_day: true, conference_url: ZOOM });
    const ids = (at: number, lead = 5, hide = true) => callsNow([call, short, plain, declined, allDay], at, lead, hide).map((e) => e.id);
    // The window opens exactly `lead` before the start; nothing a second earlier.
    expect(ids(t0 - 1000)).toEqual([]);
    expect(ids(t0)).toEqual(["s", "c"]);
    expect(ids(t0, 5, false)).toEqual(["d", "s", "c"]);
    expect(ids(t0 - 5 * MIN, 10)).toEqual(["s", "c"]);
    // It closes ten minutes in, or at the end when that is sooner.
    expect(ids(t0 + 12 * MIN)).toEqual(["c"]);
    expect(ids(t0 + 15 * MIN - 1000)).toEqual(["c"]);
    expect(ids(t0 + 15 * MIN)).toEqual([]);
    // Two that overlap: the one that started first leads.
    const later = ev("l", "Design review", t0 + 8 * MIN, t0 + H, { conference_url: MEET });
    expect(callsNow([later, call], t0 + 6 * MIN, 5, true).map((e) => e.id)).toEqual(["c", "l"]);
    // The words at one clock and the next: rounded up before the start, down after.
    const at = (m: number) => callWhen(call, t0 + m * MIN);
    expect([at(0), at(2), at(2.5), at(4), at(4.9), at(5), at(5.9), at(6), at(9)]).toEqual(["starts in 5 min", "starts in 3 min", "starts in 3 min", "starts in 1 min", "starts in 1 min", "started just now", "started just now", "started 1 min ago", "started 4 min ago"]);
    expect([ZOOM, MEET, "https://teams.microsoft.com/l/meetup-join/x", "https://acme.webex.com/meet/x", "https://whereby.com/acme", "nope"].map(service)).toEqual(["Zoom", "Meet", "Teams", "Webex", "whereby.com", "call"]);
  });
  test("upcomingItem: hidden, the name as the title with the time as a segment, the colours, the dot, stale", () => {
    const s: Settings & Partial<ItemSettings> = { source: "auto", accounts: [], calendars: [], days: 7, hide_declined: true, hide_all_day: true, horizon_hours: 10, warn_minutes: 15, urgent_minutes: 5, default_length: 30, call_lead: 5 };
    expect(upcomingItem([], t0, s)).toEqual({ hidden: true, states: { phase: "none", minutes: null, call: false } });
    const soon = ev("s", "Standup", t0 + 12 * MIN, t0 + 42 * MIN, { conference_url: ZOOM, calendar: cals[0] });
    const item = upcomingItem([soon], t0, s);
    // The `when` segment has no colour of its own: on either target it takes the item's, so it reads amber here.
    expect(item).toMatchObject({ title: "Standup", segments: [{ id: "when", text: "in 12m" }], badge: "dot", tooltip: `Standup, ${timeRange(soon)} (Work), Enter joins`, click: "open", menu: { view: { id: "upcoming", keys: "actions" } }, states: { phase: "warning", minutes: 12, call: true } });
    expect(item.segments![0].color).toBeUndefined();
    expect(item.stale).toBeUndefined();
    const long = ev("l", "A very long meeting title that goes on and on and on", t0 + 3 * H, t0 + 4 * H);
    expect(upcomingItem([long], t0, s)).toMatchObject({ title: "A very long meeting title that goes on and on and on", segments: [{ id: "when", text: "in 3h" }], states: { phase: "far" } });
    expect((upcomingItem([long], t0, s) as BarItem).badge).toBeUndefined();
    expect(upcomingItem([soon], t0 + 8 * MIN, s)).toMatchObject({ title: "Standup", segments: [{ id: "when", text: "in 4m" }], states: { phase: "critical" } });
    expect(upcomingItem([soon], t0 + 20 * MIN, s, "archer is away")).toMatchObject({ title: "Standup", segments: [{ id: "when", text: "22m left" }], states: { phase: "running" }, stale: true });
    expect(JSON.stringify((upcomingItem([soon], t0 + 20 * MIN, s, "archer is away").menu as { view: View }).view.tree)).toContain("showing the last events read");
    expect(upcomingItem([soon], t0, { ...s, warn_minutes: 10 })).toMatchObject({ states: { phase: "near" } });
  });

  test("upcomingItem while an event runs: what is left, and the next one due as a second segment in its own colour with its name in the tooltip", () => {
    const s: Settings & Partial<ItemSettings> = { source: "auto", accounts: [], calendars: [], days: 7, hide_declined: true, hide_all_day: true, horizon_hours: 10, warn_minutes: 15, urgent_minutes: 5, default_length: 30, call_lead: 5 };
    const cur = ev("c", "Weekly sync", t0 - 18 * MIN, t0 + 12 * MIN, { conference_url: ZOOM, calendar: cals[0] });
    const review = ev("r", "Design review", t0 + 20 * MIN, t0 + 80 * MIN, { calendar: cals[1] });
    // Alone: the name, `12m left` in the running colour, no second segment.
    expect(upcomingItem([cur], t0, s)).toMatchObject({ title: "Weekly sync", segments: [{ id: "when", text: "12m left" }], states: { phase: "running" }, badge: "dot", tooltip: `Weekly sync, ${timeRange(cur)} (Work), Enter joins` });
    // The next due inside the horizon: `in 20m`, muted past the warning, its words after `; then` in the tooltip.
    const both = upcomingItem([review, cur], t0, s);
    expect(both).toMatchObject({ title: "Weekly sync", states: { phase: "running" }, badge: "dot", tooltip: `Weekly sync, ${timeRange(cur)} (Work), Enter joins; then Design review, ${timeRange(review)} (Home)` });
    expect(both.segments).toEqual([{ id: "when", text: "12m left" }, { id: "next", text: "in 20m", color: "muted", tooltip: `Design review, ${timeRange(review)} (Home)` }]);
    // Eight minutes on: `4m left`, the review inside the warning, amber; inside the urgent, red.
    expect(upcomingItem([review, cur], t0 + 8 * MIN, s).segments).toEqual([{ id: "when", text: "4m left" }, { id: "next", text: "in 12m", color: "amber", tooltip: `Design review, ${timeRange(review)} (Home)` }]);
    expect(upcomingItem([review, cur], t0 + 8 * MIN, { ...s, urgent_minutes: 12 }).segments![1].color).toBe("red");
    // The next follows the strip's own rules: outside the horizon, declined or all-day it is not there; a second running event is not "next" either.
    expect(upcomingItem([review, cur], t0, { ...s, horizon_hours: 0.25 }).segments).toHaveLength(1);
    expect(upcomingItem([{ ...review, my_status: "declined" }, cur], t0, s).segments).toHaveLength(1);
    expect(upcomingItem([ev("a", "Holiday", startOfDay(t0), addDays(t0, 1), { all_day: true }), cur], t0, s).segments).toHaveLength(1);
    expect(upcomingItem([ev("o", "Overlap", t0 - 5 * MIN, t0 + 30 * MIN), cur], t0, s).segments).toHaveLength(1);
    // Before the current starts nothing is "next": one segment, `in 3m`.
    expect(upcomingItem([review, cur], t0 - 21 * MIN, s).segments).toEqual([{ id: "when", text: "in 3m" }]);
  });

  test("the phase is the item's state; the colour is the manifest's rules', not the render's", () => {
    const s: Settings & ItemSettings = { source: "auto", accounts: [], calendars: [], days: 7, hide_declined: true, hide_all_day: true, horizon_hours: 10, near_minutes: 60, warn_minutes: 15, urgent_minutes: 5, default_length: 30, call_lead: 5 };
    const at = (minutes: number) => ev(`at-${minutes}`, "Review", t0 + minutes * MIN, t0 + (minutes + 30) * MIN);
    expect([120, 45, 12, 4, -1].map((m) => phaseOf(at(m), t0, s))).toEqual(["far", "near", "warning", "critical", "running"]);
    const item = upcomingItem([at(12)], t0, s);
    expect(item.states).toEqual({ phase: "warning", minutes: 12, call: false });
    expect(item.color).toBeUndefined();
    expect(item.icon_size).toBeUndefined();
    expect(upcomingItem([], t0, s)).toEqual({ hidden: true, states: { phase: "none", minutes: null, call: false } });
    expect(upcomingItem([at(-1)], t0, s).states).toMatchObject({ phase: "running", minutes: -1 });
  });

  /** Every node of a tree, depth first. */
  const nodes = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(nodes) : [])];
  const texts = (v: View) => nodes(v.tree).filter((n) => n.type === "text").map((n) => (n as { value: string }).value);

  test("the popover: today's rows still to come with the running one on a card and Join, all-day as badges, tomorrow folded then open, the ring on the cursor, the key hints", () => {
    const running = ev("run", "Standup", t0 - 10 * MIN, t0 + 20 * MIN, { conference_url: ZOOM, attendees: [{ name: "Terry", status: "accepted", me: false }, { name: "Cagdas", status: "accepted", me: true }] });
    const gone = ev("gone", "Earlier", t0 - 3 * H, t0 - 2 * H);
    const next = ev("next", "Dentist", t0 + 42 * MIN, t0 + 72 * MIN, { calendar: cals[1], location: "Room 4" });
    const declined = ev("dec", "Sales", t0 + 3 * H, t0 + 4 * H, { my_status: "declined" });
    const allDay = ev("hol", "Republic Day", startOfDay(t0), addDays(t0, 1), { all_day: true, calendar: cals[2] });
    const tmr1 = ev("t1", "1:1 with Mara", addDays(t0, 1) + 10 * H, addDays(t0, 1) + 10.5 * H, { conference_url: "https://meet.google.com/abc-defg-hij" });
    const tmr2 = ev("t2", "Planning", addDays(t0, 1) + 14 * H, addDays(t0, 1) + 15 * H);
    const all = [tmr2, declined, allDay, next, gone, running, tmr1];
    const l = listed(all, t0, true);
    expect(l.today.map((e) => e.id)).toEqual(["run", "next"]);
    expect(l.allDay.map((e) => e.id)).toEqual(["hol"]);
    expect(l.tomorrow.map((e) => e.id)).toEqual(["t1", "t2"]);
    expect(listed(all, t0, false).today.map((e) => e.id)).toEqual(["run", "next", "dec"]);
    const st = freshPopover(false, true);
    const v = checkView(popover(all, t0, true, st));
    expect(v).toMatchObject({ id: "upcoming", keys: "actions", title: `Today · ${dayName(t0)}` });
    const ns = nodes(v.tree);
    const card = ns.find((n) => n.key === `run@${running.start}`)!;
    expect(card).toMatchObject({ type: "stack", surface: "elevated", selected: true, action: `focus:run@${running.start}` });
    const dentist = ns.find((n) => n.key === `next@${next.start}`)!;
    expect(dentist.type === "stack" && dentist.surface).toBeUndefined();
    expect((dentist as { selected?: true }).selected).toBeUndefined();
    const t = texts(v);
    expect(t).toContain("ends in 20 min");
    expect(t).toContain("in 42 min");
    expect(t).toContain("Room 4 · Home");
    expect(t).toContain("2 people · Work");
    expect(t).not.toContain("Earlier");
    expect(t).not.toContain("Sales");
    expect(ns.find((n) => n.type === "badge" && n.text === "Republic Day")).toBeTruthy();
    // The Join button on the running row is solid, and clicks to the row's join action; the tomorrow rows are not drawn while folded.
    expect(ns.find((n) => n.type === "tile" && n.text === "Join")).toMatchObject({ color: "green", fill: "solid", action: `join:run@${running.start}` });
    expect(t).toContain("2 events · " + dayName(addDays(t0, 1)));
    expect(t).not.toContain("1:1 with Mara");
    expect(ns.find((n) => n.key === "tomorrow-head")).toMatchObject({ action: "tomorrow" });
    // The calendar's colour is the thin bar.
    expect(ns.filter((n) => n.type === "tile" && n.width === 3).map((n) => (n as { color: string }).color)).toEqual(["#1e4d8c", "#34aadc"]);
    const acts = v.actions.map((a) => a.id);
    expect(v.actions[0]).toEqual({ id: "primary", title: "Join call" });
    expect(acts.slice(0, 7)).toEqual(["primary", "join-next", "tomorrow", "open-calendar", "refresh", "copy", "copy-link"]);
    expect(acts).not.toContain(`join:t1@${tmr1.start}`);
    expect(v.actions.find((a) => a.id === "down")).toMatchObject({ shortcut: "down", hidden: true });
    // Open: the ring moves on to tomorrow's rows, which say the day and time.
    const open = checkView(popover(all, t0, true, { ...st, expanded: true, cursor: 2 }));
    expect(focusable(l, { ...st, expanded: true }).map((e) => e.id)).toEqual(["run", "next", "t1", "t2"]);
    expect(nodes(open.tree).find((n) => n.key === `t1@${tmr1.start}`)).toMatchObject({ selected: true });
    expect(open.actions.map((a) => a.id)).toContain(`join:t1@${tmr1.start}`);
    expect(texts(open)).toContain("1:1 with Mara");
    expect(texts(open)).not.toContain("tomorrow 10:00");
    expect(open.actions[0]).toEqual({ id: "primary", title: "Join call" });
    expect(popoverActions(l, { ...st, expanded: true, cursor: 3 })[0]).toEqual({ id: "primary", title: "Open in Calendar" });
    expect(popoverActions(l, { ...st, google: true, expanded: true, cursor: 3 })[0]).toEqual({ id: "primary", title: "Open in Google Calendar" });
    // A clear day: the card names the next event; no ring, Enter opens the calendar.
    const clear = checkView(popover([gone, tmr1], t0, true, { ...st, expanded: true }));
    expect(texts(clear)).toContain("Nothing today");
    expect(texts(clear)).toContain("Next: 1:1 with Mara, tomorrow 10:00");
    // Tomorrow open on a clear day: the ring is on its first row, so Enter joins that call; folded, Enter opens the calendar.
    expect(clear.actions[0]).toEqual({ id: "primary", title: "Join call" });
    expect(checkView(popover([gone, tmr1], t0, true, st)).actions[0]).toEqual({ id: "open-calendar", title: "Open Calendar" });
    expect(texts(checkView(popover([gone], t0, true, st)))).toContain("Nothing further in the days ahead");
    expect(texts(checkView(popover([allDay], t0, true, st)))).toContain("Nothing else today");
    // The all-day line is one row and cannot wrap: long titles are cut, and past three the rest is a count.
    const many = [1, 2, 3, 4, 5].map((i) => ev(`ad${i}`, `An all-day event with a very long title ${i}`, startOfDay(t0), addDays(t0, 1), { all_day: true }));
    const ad = nodes(checkView(popover(many, t0, true, st)).tree).filter((n) => n.type === "badge").map((n) => (n as { text: string }).text);
    expect(ad).toEqual(["An all-day event …", "An all-day event …", "An all-day event …", "+2"]);
    // The hints follow what there is.
    const hints = (x: View) => nodes(x.tree).filter((n) => n.type === "keycap").map((n) => (n as { keys: string }).keys);
    expect(hints(v)).toEqual(["t", "enter", "j", "t", "o", "r", "cmd+c"]);
    expect(hints(clear)).toEqual(["t", "enter", "j", "t", "o", "r", "cmd+c"]);
  });
});

describe("calendar extension", () => {
  test("meta: live with a ttl, a filter per calendar read at load", () => {
    const p = host.loaded().find((l) => l.extension === E)!.palettes.find((p) => p.name === P)!;
    expect(p).toMatchObject({ title: "My Schedule", live: true, input: false, ttl: 60, detail: "lazy" });
    expect(p.filters).toEqual([{ id: "all", title: "All calendars" }, { id: "cal-work", title: "Work" }, { id: "cal-home", title: "Home" }, { id: "cal-hol", title: "Holidays" }]);
  });

  test("rows: sections in time order, the running event tagged now, declined hidden, the ended one gone, New event last", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual([rid(events[0]), rid(events[2]), rid(events[4]), rid(events[5]), rid(events[6]), rid(events[7]), "new"]);
    expect(items.map((i) => i.section)).toEqual(["Today", "Today", "Tomorrow", "This week", "This week", "Later", undefined]);
    expect(last().params).toEqual({ from: today, to: addDays(now, 14), calendars: undefined });
    const standup = items[0];
    expect(standup).toMatchObject({ name: "Standup", icon: { glyph: "\u{f00ee}", color: "#1e4d8c" }, accessories: [{ tag: "now", color: "green" }, { text: "2 people" }, { tag: "Join", color: "green" }] });
    expect(standup.subtitle).toBe(`10:20 – 10:50 · ${ZOOM}`);
    expect(standup.keywords).toContain("Work");
    // Only the first upcoming event carries a tag.
    expect(items[1]).toMatchObject({ name: "Dentist", icon: { glyph: "\u{f00ee}", color: "#34aadc" }, subtitle: "11:12 – 11:42 · Room 4", accessories: [] });
    expect(items[4]).toMatchObject({ name: "Republic Day", subtitle: "All day", icon: { glyph: "\u{f00ee}", color: "#16a765" } });
    expect(items[6]).toMatchObject({ id: "new", name: "New event" });
  });

  test("actions by link and platform", async () => {
    const items = await list();
    const withCall = items[0].actions!.map((a) => a.id);
    const without = items[1].actions!.map((a) => a.id);
    if (MAC) {
      expect(withCall).toEqual(["join", "open", "copy_link", "copy_details", "delete"]);
      expect(without).toEqual(["open", "copy_details", "delete"]);
      expect(items[0].actions![4]).toMatchObject({ title: "Delete this occurrence", style: "destructive", shortcut: "ctrl+x" });
      expect(items[0].actions![4].confirm).toBe('Delete "Standup" on Wed 16 Sep?');
      expect(items[1].actions![2].title).toBe("Delete event");
    } else {
      expect(withCall).toEqual(["join", "copy_link", "copy_details"]);
      expect(without).toEqual(["copy_details"]);
    }
  });

  test("hide_declined off lists the declined event with a tag", async () => {
    host.changeSettings(E, { settings: { days: 14, hide_declined: false } });
    await Bun.sleep(50);
    const items = await list();
    const declined = items.find((i) => i.id === rid(events[3]))!;
    expect(declined).toMatchObject({ name: "Sales sync", accessories: [{ tag: "declined", color: "red" }, { text: "2 people" }] });
    host.changeSettings(E, { settings: { days: 14 } });
    await Bun.sleep(50);
  });

  test("picks: join, copy link, copy details, open, delete with the occurrence", async () => {
    await list();
    const s = rid(events[0]);
    expect(await pick(s)).toEqual({ open: ZOOM });
    expect(await pick(s, "join")).toEqual({ open: ZOOM });
    expect(await pick(s, "copy_link")).toEqual({ copy: ZOOM });
    expect(await pick(s, "copy_details")).toEqual({ copy: details(events[0]) });
    if (MAC) {
      expect(await pick(rid(events[2]))).toEqual({ hide: true });
      expect(last()).toEqual({ method: "open", params: { id: "next", occurrence: null } });
      expect(await pick(s, "delete")).toEqual({ keep: true, toast: { title: "Deleted", message: "Standup", style: "success" } });
      expect(last()).toEqual({ method: "delete", params: { id: "standup", occurrence: curStart } });
    } else {
      expect(await pick(rid(events[2]))).toEqual({ copy: details(events[2]) });
    }
  });

  test("a row id the listing does not have is fetched again; a gone one is a toast", async () => {
    await list();
    const h2 = await Host.bundled({ core: core() });
    try {
      expect(await h2.pick(E, P, rid(events[0]), "copy_link")).toEqual({ copy: ZOOM });
      expect(await h2.pick(E, P, "ghost@123", "copy_link")).toMatchObject({ keep: true, toast: { title: "Event not found", style: "failure" } });
    } finally { h2.kill(); }
  });

  test("the calendar filter and the calendars setting narrow the core call", async () => {
    const items = await list({ filter: "cal-home" });
    expect(last().params.calendars).toEqual(["cal-home"]);
    expect(items.map((i) => i.name)).toEqual(["Dentist", "Concert", "New event"]);
    const h2 = await Host.bundled({ core: core(), settings: { [E]: { settings: { calendars: ["work", "Holidays", "nope"] } } } });
    try {
      const rows = await h2.list(E, P);
      expect(last().params).toMatchObject({ calendars: ["cal-work", "cal-hol"], to: addDays(now, 7) });
      expect(rows.map((i) => i.name)).toEqual(["Standup", "Review", "Republic Day", "New event"]);
      expect(h2.loaded().find((l) => l.extension === E)!.palettes[0].filters!.map((f) => f.id)).toEqual(["all", "cal-work", "cal-hol"]);
    } finally { h2.kill(); }
  });

  test("lazy detail: notes as markdown, when, calendar, call, organizer, attendees with their replies", async () => {
    await list();
    const d = await host.detail(E, P, rid(events[0]));
    expect(d.markdown).toBe("Daily sync\n\n- items");
    expect(d.metadata).toEqual([
      { label: "When", value: "Wed 16 Sep 2026, 10:20 – 10:50 (30 min)" },
      { label: "Calendar", tags: [{ text: "Work (Google)" }] },
      { label: "Location", value: ZOOM },
      { label: "Call", link: { text: ZOOM.replace("https://", "").slice(0, 60), href: ZOOM } },
      { label: "Organizer", value: "terry@serpapi.com" },
      { label: "Attendees (2)", tags: [{ text: "Terry", color: "green" }, { text: "Cagdas (you)", color: "green" }] },
      { label: "Your reply", tags: [{ text: "accepted", color: "green" }] },
      { label: "Repeats", value: "yes" },
    ]);
    const plain = await host.detail(E, P, rid(events[6]));
    expect(plain.markdown).toBe("# Republic Day");
    expect(plain.metadata![0]).toEqual({ label: "When", value: "Mon 21 Sep 2026 (all day)" });
    expect(await host.detail(E, P, "new")).toEqual({});
  });

  test("Quick Add: the row reads the line back (day, time, calendar, place), hints until it can, Enter creates through the same write; a pick after a relist parses again", async () => {
    const Q = "quick";
    expect(await host.list(E, Q, "")).toEqual([{ id: "hint:calendar", name: "Type an event", subtitle: expect.stringContaining("standup tomorrow 10:00"), icon: expect.any(String), actions: [] }]);
    expect(await host.list(E, Q, "tomorrow")).toEqual([expect.objectContaining({ id: "hint:calendar", name: "Not an event yet", subtitle: "A title first: dentist fri 2pm" })]);
    const line = "dentist fri 2pm-3pm at Room 4 @ home";
    const rows = await host.list(E, Q, line);
    expect(rows).toEqual([{ id: line, name: "dentist", subtitle: "Fri 18 Sep 14:00 to 15:00 · Room 4 · Home calendar", icon: { glyph: "\u{f00ee}", color: "#34aadc" }, accessories: [{ date: addDays(now, 2) + 14 * H }], actions: [{ id: "add", title: "Add event" }] }]);
    expect((await host.list(E, Q, "walk"))[0]).toMatchObject({ name: "walk", subtitle: "Today, all day", icon: "\u{f0415}", accessories: [{ tag: "all day" }, { date: today }] });
    expect((await host.list(E, Q, "call mum 9am"))[0]).toMatchObject({ subtitle: "Tomorrow 09:00 to 09:30", accessories: [{ tag: "tomorrow", color: "amber" }, { date: addDays(now, 1) + 9 * H }] });
    expect((await host.list(E, Q, "sync 3pm @ nope"))[0].subtitle).toBe("Today 15:00 to 15:30 · no calendar named nope, so the default");
    // Enter on the row: the event through calendar.create, the toast, the palette kept.
    const n = calls.length;
    await host.list(E, Q, line);
    expect(await host.pick(E, Q, line, "add")).toEqual({ keep: true, toast: { title: "Added", message: "dentist, Fri 18 Sep 14:00 – 15:00", style: "success" } });
    expect(last()).toEqual({ method: "create", params: { title: "dentist", start: addDays(now, 2) + 14 * H, end: addDays(now, 2) + 15 * H, all_day: false, calendar: "cal-home", location: "Room 4", notes: undefined } });
    expect(calls.length).toBe(n + 1);
    // A pick for a line the last listing did not parse (a restart, the fallback row): parsed again.
    expect(await host.pick(E, Q, "trip 20 sep", "add")).toMatchObject({ keep: true, toast: { title: "Added", message: "trip, Sun 20 Sep 2026" } });
    expect(last().params).toMatchObject({ title: "trip", all_day: true, start: addDays(now, 4), end: addDays(now, 5) });
    // The source's refusal is a toast, not a form.
    expect(await host.pick(E, Q, "boom sat", "add")).toEqual({ keep: true, toast: { title: "Could not add the event", message: "Holidays does not take new events", style: "failure" } });
    expect(await host.pick(E, Q, "", "add")).toMatchObject({ keep: true, toast: { title: "Not an event yet", style: "failure" } });
    expect(await host.pick(E, Q, "hint:calendar")).toEqual({});
    // Without the permission the palette shows the permission row like the others.
    status = "not_determined";
    expect((await host.list(E, Q, "x 3pm"))[0]).toMatchObject({ id: "grant", name: "Grant calendar access" });
    status = "granted";
  });

  test("New event: the form, a submit that creates, one that errs", async () => {
    const f = (await pick("new")).form as Form;
    expect(f.title).toBe("New event");
    expect(f.fields.map((x) => x.id)).toEqual(["title", "day", "start", "end", "all_day", "calendar", "location", "notes"]);
    const cal = f.fields.find((x) => x.id === "calendar") as Extract<Form["fields"][number], { kind: "select" }>;
    expect(cal.options.map((o) => o.id)).toEqual(["", "cal-work", "cal-home"]);
    expect(f.fields.find((x) => x.id === "day")).toMatchObject({ default: "today" });
    // The next quarter hour after the clock, an hour long.
    expect(f.fields.find((x) => x.id === "start")).toMatchObject({ default: "10:45" });
    expect(f.fields.find((x) => x.id === "end")).toMatchObject({ default: "11:45" });
    const day = new Date(2026, 8, 20).getTime();
    const ok = await pick("new", "create", { values: { title: " Dentist ", day: "2026-09-20", start: "2pm", end: "15:30", all_day: false, calendar: "cal-home", location: "Room 1", notes: "bring card" } });
    expect(ok).toEqual({ keep: true, toast: { title: "Added", message: "Dentist, Sun 20 Sep 14:00 – 15:30", style: "success" } });
    expect(last()).toEqual({ method: "create", params: { title: "Dentist", start: day + 14 * H, end: day + 15 * H + 30 * MIN, all_day: false, calendar: "cal-home", location: "Room 1", notes: "bring card" } });
    // All day over three days, the default calendar, an end before the start wraps to the next day.
    const allDay = await pick("new", "create", { values: { title: "Trip", day: "20 sep 2026", start: "", end: "22.9.2026", all_day: true, calendar: "" } });
    expect(allDay).toMatchObject({ keep: true, toast: { title: "Added", message: "Trip, Sun 20 Sep 2026" } });
    expect(last().params).toEqual({ title: "Trip", start: day, end: day + 3 * DAY, all_day: true, calendar: undefined, location: undefined, notes: undefined });
    await pick("new", "create", { values: { title: "Late", day: "2026-09-20", start: "23:00", end: "00:30", all_day: false } });
    expect(last().params).toMatchObject({ start: day + 23 * H, end: day + DAY + 30 * MIN });
    const bad = (await pick("new", "create", { values: { title: "", day: "someday", start: "soon", end: "15:30", all_day: false } })).form as Form;
    expect(bad.errors).toEqual({ title: "Give the event a title", day: "Not a day I know: today, fri, 2026-09-20", start: "A time like 14:30 or 2pm" });
    expect(bad.fields.find((x) => x.id === "day")).toMatchObject({ default: "someday" });
    const refused = (await pick("new", "create", { values: { title: "Holiday", day: "today", start: "10:00", end: "11:00", all_day: false, calendar: "cal-hol" } })).form as Form;
    expect(refused.errors).toEqual({ title: "Holidays does not take new events" });
    expect(last().params).toMatchObject({ title: "Holiday", start: today + 10 * H, end: today + 11 * H });
  });

  test("permission rows: the ask, the pane, the missing backend", async () => {
    status = "not_determined";
    try {
      const rows = await list();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "grant", name: "Grant calendar access", actions: [{ id: "grant", title: "Grant access" }] });
      expect(await pick("grant")).toMatchObject({ keep: true, toast: { title: "Calendar access not granted yet" } });
      expect(last().method).toBe("request");
      status = "granted";
      expect(await pick("grant")).toEqual({ keep: true, toast: { title: "Calendar access granted", style: "success" } });
      status = "denied";
      const denied = await list();
      expect(denied[0]).toMatchObject({ name: "Calendar access denied", actions: [{ id: "settings", title: "Open System Settings" }] });
      expect(await pick("grant", "settings")).toEqual({ hide: true });
      expect(last().method).toBe("open_settings");
      status = "unavailable";
      const none = await list();
      expect(none[0]).toMatchObject({ id: "hint:calendar", name: "No calendar on this machine", actions: [] });
      expect(await pick("hint:calendar")).toEqual({});
    } finally { status = "granted"; }
  });

  test("a core refusal on the listing is one hint row plus New event", async () => {
    const h2 = await Host.bundled({ core: { ...core(), "calendar.events": () => { throw new Error("calendar access denied: Privacy & Security > Calendars"); } } });
    try {
      const rows = await h2.list(E, P);
      expect(rows.map((r) => r.id)).toEqual(["hint:calendar", "new"]);
      expect(rows[0].subtitle).toBe("calendar access denied: Privacy & Security > Calendars");
    } finally { h2.kill(); }
  });
});

describe("today palette and the upcoming bar item", () => {
  const T = "today";
  const eventsCalls = () => calls.filter((c) => c.method === "events").length;

  test("meta: Today is live, the bar item refreshes every five minutes and on the minute, wake and network", () => {
    const l = host.loaded().find((l) => l.extension === E)!;
    expect(l.palettes.map((p) => p.name)).toEqual(["schedule", "today", "quick"]);
    expect(l.palettes[2]).toMatchObject({ title: "Quick Add Event", input: true, placeholder: "standup tomorrow 10:00", fallback: "ask", fallbackTitle: "Add “{query}” to the calendar" });
    expect(l.palettes[1]).toMatchObject({ title: "Today", live: true, ttl: 60, detail: "lazy" });
    expect(l.bar).toHaveLength(1);
    expect(l.bar[0]).toMatchObject({
      id: "upcoming", title: "Upcoming", description: expect.any(String), refresh: { every: 300, on: ["minute", "wake", "network"] },
      keys: expect.arrayContaining([{ keys: "j", title: "Join the next call" }, { keys: "t", title: "Show or fold tomorrow" }]), source: true,
      mocks: {
        far: { title: "Starts in 3 hours", item: { title: "Project review", segments: [{ id: "when", text: "in 3h" }], color: "muted" } },
        near: { title: "Starts in 45 minutes", item: { title: "Project review", segments: [{ id: "when", text: "in 45m" }], color: "muted" } },
        warning: { title: "Starts in 12 minutes", item: { title: "Project review", segments: [{ id: "when", text: "in 12m" }], color: "amber" } },
        critical: { title: "Starts in 4 minutes", item: { title: "Project review", segments: [{ id: "when", text: "in 4m" }], color: "red" } },
        running: { title: "In progress, 25 minutes left", item: { title: "Project review", segments: [{ id: "when", text: "25m left" }], color: "green" } },
        "running-next": { title: "In progress, the next one in 8 minutes", item: { title: "Project review", segments: [{ id: "when", text: "12m left" }, { id: "next", text: "in 8m", color: "amber", tooltip: "Design sync, 11:00 – 11:30 (Team)" }], color: "green" } },
      },
    });
  });

  test("rows: the day in order with over, now and in N min, the duration, the tinted glyph; tomorrow waits", async () => {
    const items = await host.list(E, T);
    expect(items.map((i) => i.id)).toEqual([rid(events[1]), rid(events[0]), rid(events[2])]);
    expect(items.map((i) => i.section)).toEqual(["Today", "Today", "Today"]);
    expect(items[0]).toMatchObject({ name: "Earlier today", accessories: [{ tag: "over", color: "grey" }] });
    expect(items[0].subtitle).toBe("08:00 – 09:00 · 1 h");
    expect(items[1]).toMatchObject({ name: "Standup", icon: { glyph: "\u{f00ee}", color: "#1e4d8c" }, subtitle: `10:20 – 10:50 · 30 min · ${ZOOM}`, accessories: [{ tag: "now, 20 min left", color: "green" }, { text: "2 people" }, { tag: "Join", color: "green" }] });
    expect(items[2]).toMatchObject({ name: "Dentist", icon: { glyph: "\u{f00ee}", color: "#34aadc" }, subtitle: "11:12 – 11:42 · 30 min · Room 4", accessories: [{ tag: "in 42 min", color: "blue" }] });
    expect(items[2].keywords).toEqual(["Home", "Room 4", "soon", "today"]);
    expect(items[1].actions![0]).toEqual({ id: "join", title: "Join call" });
    // The popover's form drops what is over and adds tomorrow.
    const rest = await host.list(E, T, "", { args: { rest: true } });
    expect(rest.map((i) => [i.name, i.section])).toEqual([["Standup", "Today"], ["Dentist", "Today"], ["Concert", "Tomorrow"]]);
    expect(rest[2]).toMatchObject({ subtitle: "19:00 – 21:00 · 2 h", accessories: [{ tag: "in 32 h", color: "blue" }] });
  });

  test("the day done: Nothing else today names the next event's day, tomorrow's rows follow; a clear day says so", async () => {
    const done = [events[1], ev("gone", "Morning sync", today + 9 * H, today + 9 * H + 30 * MIN), events[4], events[5]];
    const h2 = await Host.bundled({ core: core(done) });
    try {
      const rows = await h2.list(E, T);
      expect(rows.map((i) => [i.id, i.section])).toEqual([[rid(events[1]), "Today"], [rid(done[1]), "Today"], ["nothing", "Today"], [rid(events[4]), "Tomorrow"]]);
      expect(rows[2]).toMatchObject({ name: "Nothing else today", subtitle: "Next: Concert, tomorrow 19:00", icon: "\u{f00ef}", actions: [] });
      expect(await h2.pick(E, T, "nothing")).toEqual({});
      expect(await h2.detail(E, T, "nothing")).toEqual({});
      // The strip: nothing inside ten hours.
      expect(await h2.render(E, "upcoming", { reason: "load" })).toEqual({ hidden: true, states: { phase: "none", minutes: null, call: false } });
      expect(await h2.render(E, "upcoming", { reason: "load" })).toEqual({ hidden: true, states: { phase: "none", minutes: null, call: false } });
    } finally { h2.kill(); }
    const h3 = await Host.bundled({ core: core([events[5]]) });
    try {
      const rows = await h3.list(E, T);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "nothing", name: "Nothing today", subtitle: "Next: Review, Sun 20 Sep 10:00" });
    } finally { h3.kill(); }
  });

  test("the bar item: the running call with what is left and the Dentist due after it, a dot, a minute tick from the cache in under 5 ms, the rest fetch", async () => {
    const first = await host.render(E, "upcoming", { reason: "load" });
    expect(first).toMatchObject({ icon: "\u{f00ed}", title: "Standup", states: { phase: "running" }, badge: "dot", click: "open", tooltip: "Standup, 10:20 – 10:50 (Work), Enter joins; then Dentist, 11:12 – 11:42 (Home)", menu: { view: { id: "upcoming", keys: "actions", title: "Today · Wed 16 Sep" } } });
    expect(first.segments).toEqual([{ id: "when", text: "20m left" }, { id: "next", text: "in 42m", color: "muted", tooltip: "Dentist, 11:12 – 11:42 (Home)" }]);
    expect(first.stale).toBeUndefined();
    const before = eventsCalls();
    const t = performance.now();
    const tick = await host.render(E, "upcoming", { reason: "minute" });
    const ms = performance.now() - t;
    expect(tick).toEqual(first);
    expect(eventsCalls()).toBe(before);
    console.log(`bar/render on a minute tick, round trip through the host: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
    await host.render(E, "upcoming", { reason: "wake" });
    expect(eventsCalls()).toBe(before + 1);
    await host.render(E, "upcoming", { reason: "every" });
    expect(eventsCalls()).toBe(before + 2);
  });

  test("the root's Now rows: a call about to start and one just begun, soonest first; Enter joins, ⌘C copies the link, the other action opens it; the lead is a setting; nothing with no call close", async () => {
    type Suggested = { extension: string; palette: string; items: { id: string; name: string; subtitle?: string; section?: string; icon?: unknown; accessories?: unknown; actions?: { id: string; title: string; shortcut?: string }[] }[] }[];
    const suggested = (h: Host) => h.request<Suggested>("suggest").then((r) => r.filter((s) => s.extension === E).flatMap((s) => s.items));
    // The shared day's only call started ten minutes ago: its row has gone.
    expect(await suggested(host)).toEqual([]);
    const MEET = "https://meet.google.com/abc-defg-hij";
    const soon = ev("soon", "Standup", now + 3 * MIN, now + 18 * MIN, { conference_url: ZOOM });
    const begun = ev("begun", "Design review", now - 4 * MIN, now + 56 * MIN, { conference_url: MEET, calendar: cals[1] });
    const calls2 = [soon, begun, ev("later", "Retro", now + 20 * MIN, now + H, { conference_url: ZOOM }), ev("plain", "Dentist", now + MIN, now + H), ev("no", "Sales sync", now + 2 * MIN, now + H, { conference_url: ZOOM, my_status: "declined" })];
    const h2 = await Host.bundled({ core: core(calls2) });
    try {
      const rows = await suggested(h2);
      expect(rows.map((r) => r.id)).toEqual([rid(begun), rid(soon)]);
      expect(rows[0]).toMatchObject({ name: "Design review", subtitle: "started 4 min ago · Meet · 10:26 – 11:26", section: "Now", icon: { glyph: "\u{f0567}", color: "#34aadc" }, accessories: [{ tag: "Join", color: "green" }] });
      expect(rows[1]).toMatchObject({ name: "Standup", subtitle: "starts in 3 min · Zoom · 10:33 – 10:48" });
      expect(rows[1].actions).toEqual([{ id: "join", title: "Join call" }, ...(MAC ? [{ id: "open", title: "Open in Calendar" }] : []), { id: "copy_link", title: "Copy call link", shortcut: "cmd+c" }]);
      // The rows are Today's: its pick joins, copies, opens.
      expect(await h2.pick(E, T, rows[1].id)).toEqual({ open: ZOOM });
      expect(await h2.pick(E, T, rows[0].id, "copy_link")).toEqual({ copy: MEET });
      // A lead of 25 minutes brings the Retro in too.
      h2.changeSettings(E, { settings: { call_lead: 25 } });
      let ids: string[] = [];
      for (let i = 0; i < 60 && ids.length < 3; i++) ids = (await suggested(h2)).map((r) => r.id);
      expect(ids).toEqual([rid(begun), rid(soon), rid(calls2[2])]);
    } finally { h2.kill(); }
  });

  test("a direct bar click joins the next call, or opens Calendar when it has none", async () => {
    const withCall = await Host.bundled({ core: core([events[0]]) });
    const withoutCall = await Host.bundled({ core: core([events[2]]) });
    try {
      await withCall.render(E, "upcoming", { reason: "load" });
      expect(await withCall.barOpen(E, "upcoming")).toEqual({ open: ZOOM, hud: "Standup, 10:20 – 10:50" });
      await withoutCall.render(E, "upcoming", { reason: "load" });
      expect(await withoutCall.barOpen(E, "upcoming")).toEqual(MAC ? { open: "/System/Applications/Calendar.app" } : { hide: true });
    } finally { withCall.kill(); withoutCall.kill(); }
  });

  test("the popover's keys through bar/action: arrows move the ring, t opens tomorrow, Enter joins or opens, a click on a row or its Join, copy, the calendar, refresh", async () => {
    const ctx = { reason: "open" as const, compact: true as const };
    const first = await host.render(E, "upcoming", ctx);
    const view = (r: { view?: View }) => checkView(r.view!);
    const sel = (v: View) => { const walk = (n: ViewNode): string | undefined => (n as { selected?: true }).selected ? n.key : n.type === "stack" ? n.children.map(walk).find(Boolean) : undefined; return walk(v.tree); };
    expect(sel((first.menu as { view: View }).view)).toBe(rid(events[0]));
    // Down to Dentist, Enter opens it in Calendar (macOS) with the occurrence, else copies; up again, Enter joins the standup.
    const down = view(await host.barAction(E, "upcoming", "down", ctx));
    expect(sel(down)).toBe(rid(events[2]));
    expect(down.actions[0].title).toBe(MAC ? "Open in Calendar" : "Copy event details");
    const open = await host.barAction(E, "upcoming", "primary", ctx);
    if (MAC) { expect(open).toEqual({ hide: true }); expect(last()).toEqual({ method: "open", params: { id: "next", occurrence: null } }); } else expect(open).toEqual({ copy: details(events[2]) });
    expect(await host.barAction(E, "upcoming", "copy", ctx)).toEqual({ copy: details(events[2]) });
    expect(await host.barAction(E, "upcoming", "copy-link", ctx)).toEqual({ keep: true });
    expect(sel(view(await host.barAction(E, "upcoming", "up", ctx)))).toBe(rid(events[0]));
    expect(await host.barAction(E, "upcoming", "primary", ctx)).toEqual({ open: ZOOM });
    expect(await host.barAction(E, "upcoming", "copy-link", ctx)).toEqual({ copy: ZOOM });
    expect(await host.barAction(E, "upcoming", "join-next", ctx)).toEqual({ open: ZOOM, hud: "Standup, 10:20 – 10:50" });
    // Tomorrow: folded at first, t opens it and the Concert row appears; a click on it focuses it; t folds it and the ring comes back today.
    expect(JSON.stringify(first.menu)).not.toContain("Concert");
    const opened = view(await host.barAction(E, "upcoming", "tomorrow", ctx));
    expect(JSON.stringify(opened.tree)).toContain("Concert");
    expect(sel(view(await host.barAction(E, "upcoming", `focus:${rid(events[4])}`, ctx)))).toBe(rid(events[4]));
    expect(sel(view(await host.barAction(E, "upcoming", "tomorrow", ctx)))).toBe(rid(events[2]));
    // The Join button on a row is that row's call whatever the ring is on.
    expect(await host.barAction(E, "upcoming", `join:${rid(events[0])}`, ctx)).toEqual({ open: ZOOM, hud: "Standup, 10:20 – 10:50" });
    expect(await host.barAction(E, "upcoming", `join:${rid(events[2])}`, ctx)).toEqual({ keep: true });
    // The calendar itself, and a refresh that forgets the cache (the next render fetches).
    expect(await host.barAction(E, "upcoming", "open-calendar", ctx)).toEqual(MAC ? { open: "/System/Applications/Calendar.app" } : { hide: true });
    const before = eventsCalls();
    expect(await host.barAction(E, "upcoming", "refresh", ctx)).toEqual({ keep: true, hud: "Refreshing" });
    await host.render(E, "upcoming", { reason: "minute" });
    expect(eventsCalls()).toBe(before + 1);
    // A click that opens the popover starts fresh: the ring on the first row, tomorrow folded.
    await host.barAction(E, "upcoming", "down", ctx);
    await host.barAction(E, "upcoming", "tomorrow", ctx);
    const again = (await host.render(E, "upcoming", ctx)).menu as { view: View };
    expect(sel(again.view)).toBe(rid(events[0]));
    expect(JSON.stringify(again.view.tree)).not.toContain("Concert");
  });

  test("the open popover is redrawn from the cache on a tick while it shows (30 s, 50 ms here), no fetch; nothing once it hid", async () => {
    process.env.PAL_CALENDAR_POPOVER_TICK_MS = "50";
    const h2 = await Host.bundled({ core: core() });
    try {
      await h2.render(E, "upcoming", { reason: "open", compact: true });
      const before = calls.filter((c) => c.method === "events").length;
      h2.viewShown(E, { bar: "upcoming" }, "upcoming", true);
      const u = await h2.nextViewUpdate(E, { bar: "upcoming" });
      expect(u).toMatchObject({ extension: E, bar: "upcoming", spec: { id: "upcoming", keys: "actions" } });
      expect(JSON.stringify(u.spec)).toContain("Standup");
      await h2.nextViewUpdate(E, { bar: "upcoming" });
      h2.viewHidden(E, { bar: "upcoming" }, "upcoming", true);
      await Bun.sleep(60);
      const n = h2.viewUpdates(E, { bar: "upcoming" }).length;
      await Bun.sleep(150);
      expect(h2.viewUpdates(E, { bar: "upcoming" }).length).toBe(n);
      expect(calls.filter((c) => c.method === "events").length).toBe(before);
    } finally { h2.kill(); delete process.env.PAL_CALENDAR_POPOVER_TICK_MS; }
  });

  test("the bar item: a failing source keeps the last events as stale, and is hidden with nothing cached", async () => {
    let fail = false;
    const table = core();
    const h2 = await Host.bundled({ core: { ...table, "calendar.events": (p: any) => { if (fail) throw new Error("archer is away"); return table["calendar.events"](p); } } });
    try {
      expect(await h2.render(E, "upcoming", { reason: "load" })).toMatchObject({ title: "Standup", segments: [{ text: "20m left" }, { text: "in 42m" }] });
      fail = true;
      expect(await h2.render(E, "upcoming", { reason: "every" })).toMatchObject({ title: "Standup", segments: [{ text: "20m left" }, { text: "in 42m" }], stale: true });
      const rows = await h2.list(E, T);
      expect(rows[0]).toMatchObject({ id: "hint:calendar", name: "Showing the last events read", subtitle: "archer is away", section: "Today" });
      expect(rows[1].name).toBe("Earlier today");
    } finally { h2.kill(); }
    const h3 = await Host.bundled({ core: { ...table, "calendar.events": () => { throw new Error("archer is away"); } } });
    try {
      await expect(h3.render(E, "upcoming", { reason: "load" })).rejects.toThrow("archer is away");
      expect((await h3.list(E, T)).map((r) => r.id)).toEqual(["hint:calendar"]);
    } finally { h3.kill(); }
  });

  test("the bar item hides without permission and honours the horizon and the phase boundaries", async () => {
    status = "not_determined";
    try { expect(await host.render(E, "upcoming", { reason: "load" })).toMatchObject({ hidden: true }); } finally { status = "granted"; }
    host.changeSettings(E, { settings: { days: 14, hide_declined: false } });
    await Bun.sleep(50);
    try {
      // With the running call gone from the fixture the next one is Dentist, 42 minutes out. The phase boundaries are the item's settings, through the render's ctx.
      const item = (settings: Partial<ItemSettings>) => ({ reason: "load", settings }) as const;
      const h2 = await Host.bundled({ core: core(events.slice(1)) });
      try {
        expect(await h2.render(E, "upcoming", item({ warn_minutes: 60, urgent_minutes: 45 }))).toMatchObject({ title: "Dentist", segments: [{ id: "when", text: "in 42m" }], states: { phase: "critical", minutes: 42 } });
        // The boundaries are inclusive: 42 minutes out is amber under warn 42 / urgent 41, red under urgent 42.
        expect(await h2.render(E, "upcoming", item({ warn_minutes: 42, urgent_minutes: 41 }))).toMatchObject({ title: "Dentist", segments: [{ id: "when", text: "in 42m" }], states: { phase: "warning" } });
        expect(await h2.render(E, "upcoming", item({ warn_minutes: 60, urgent_minutes: 42 }))).toMatchObject({ states: { phase: "critical" } });
      } finally { h2.kill(); }
      // The horizon is the extension's.
      const h3 = await Host.bundled({ core: core(events.slice(1)), settings: { [E]: { settings: { horizon_hours: 1 } } } });
      try {
        expect(await h3.render(E, "upcoming", { reason: "load" })).toMatchObject({ title: "Dentist", segments: [{ id: "when", text: "in 42m" }], states: { phase: "near" } });
        expect((await h3.render(E, "upcoming", { reason: "load" }) as BarItem).badge).toBeUndefined();
      } finally { h3.kill(); }
      // The horizon is inclusive too: the Concert tomorrow at 19:00 is 32 h 30 min out.
      const h6 = await Host.bundled({ core: core([events[4]]), settings: { [E]: { settings: { horizon_hours: 32.5 } } } });
      try { expect(await h6.render(E, "upcoming", { reason: "load" })).toMatchObject({ title: "Concert", segments: [{ id: "when", text: "in 32h 30m" }], states: { phase: "far" } }); } finally { h6.kill(); }
      const h7 = await Host.bundled({ core: core([events[4]]), settings: { [E]: { settings: { horizon_hours: 32 } } } });
      try { expect(await h7.render(E, "upcoming", { reason: "load" })).toMatchObject({ hidden: true, states: { phase: "none" } }); } finally { h7.kill(); }
    } finally {
      host.changeSettings(E, { settings: { days: 14 } });
      await Bun.sleep(50);
    }
  }, 20_000); // four hosts in a row: past bun's 5 s on marko
});
