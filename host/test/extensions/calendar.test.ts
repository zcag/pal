// My Schedule: the pure helpers (schedule.ts) by import, then the
// extension through the harness against canned core/calendar.* replies:
// sections, the now / in N min tag, accessories, actions by platform, the
// picks and what they ask the core, the calendar filter and setting, the
// lazy detail, the New event form and its submit, and the permission rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { addDays, DAY, details, parseDay, parseTime, plusMinutes, section, soonTag, startOfDay, timeRange, upcoming } from "../../../extensions/calendar/schedule.ts";
import type { Calendar, CalendarEvent, Form } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

process.env.TZ = "UTC";
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

// Fixtures relative to the clock: a running event, the next one, one tomorrow, one this week, one later, an all-day, a declined one, a past one.
const now = Date.now();
const today = startOfDay(now);
const curStart = Math.max(now - 10 * MIN, today);
const ZOOM = "https://serpapi.zoom.us/j/85712227948?pwd=abc";
const events: CalendarEvent[] = [
  ev("standup", "Standup", curStart, now + 20 * MIN, { occurrence: curStart, recurring: true, conference_url: ZOOM, location: ZOOM, attendees: [{ name: "Terry", status: "accepted", me: false }, { name: "Cagdas", status: "accepted", me: true }], organizer: "terry@serpapi.com", my_status: "accepted", notes: "Daily sync\n\n- items" }),
  ev("past", "Earlier today", today, Math.min(today + 1, curStart)),
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
const core = () => ({
  "calendar.permission": () => status,
  "calendar.request": () => { calls.push({ method: "request", params: null }); return status; },
  "calendar.open_settings": () => { calls.push({ method: "open_settings", params: null }); return null; },
  "calendar.calendars": () => cals,
  "calendar.events": (p: any) => { calls.push({ method: "events", params: p }); return events.filter((e) => e.end > p.from && e.start < p.to && (!p.calendars || p.calendars.includes(e.calendar.id))); },
  "calendar.create": (p: any) => { calls.push({ method: "create", params: p }); if (p.calendar === "cal-hol") throw new Error("Holidays does not take new events"); return "new-id"; },
  "calendar.delete": (p: any) => { calls.push({ method: "delete", params: p }); return null; },
  "calendar.open": (p: any) => { calls.push({ method: "open", params: p }); return null; },
});
beforeAll(async () => { host = await Host.bundled({ core: core(), settings: { [E]: { settings: { days: 14 } } } }); });
afterAll(() => host.kill());

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
    expect(standup).toMatchObject({ name: "Standup", icon: "#1e4d8c", accessories: [{ tag: "now", color: "green" }, { text: "2 people" }, { tag: "Join", color: "green" }] });
    expect(standup.subtitle).toBe(`${timeRange(events[0])} · ${ZOOM}`);
    expect(standup.keywords).toContain("Work");
    // Only the first upcoming event carries a tag.
    expect(items[1]).toMatchObject({ name: "Dentist", icon: "#34aadc", subtitle: `${timeRange(events[2])} · Room 4`, accessories: [] });
    expect(items[4]).toMatchObject({ name: "Republic Day", subtitle: "All day", icon: "#16a765" });
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
      expect(items[0].actions![4].confirm).toMatch(/^Delete "Standup" on /);
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
      { label: "When", value: `${details(events[0]).split("\n")[1]}` },
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
    expect(plain.metadata![0]).toEqual({ label: "When", value: `${details(events[6]).split("\n")[1].replace(" (all day)", "")} (all day)` });
    expect(await host.detail(E, P, "new")).toEqual({});
  });

  test("New event: the form, a submit that creates, one that errs", async () => {
    const f = (await pick("new")).form as Form;
    expect(f.title).toBe("New event");
    expect(f.fields.map((x) => x.id)).toEqual(["title", "day", "start", "end", "all_day", "calendar", "location", "notes"]);
    const cal = f.fields.find((x) => x.id === "calendar") as Extract<Form["fields"][number], { kind: "select" }>;
    expect(cal.options.map((o) => o.id)).toEqual(["", "cal-work", "cal-home"]);
    expect(f.fields.find((x) => x.id === "day")).toMatchObject({ default: "today" });
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
      expect(none[0]).toMatchObject({ id: "hint", name: "No calendar on this machine", actions: [] });
      expect(await pick("hint")).toEqual({});
    } finally { status = "granted"; }
  });

  test("a core refusal on the listing is one hint row plus New event", async () => {
    const h2 = await Host.bundled({ core: { ...core(), "calendar.events": () => { throw new Error("calendar access denied: Privacy & Security > Calendars"); } } });
    try {
      const rows = await h2.list(E, P);
      expect(rows.map((r) => r.id)).toEqual(["hint", "new"]);
      expect(rows[0].subtitle).toBe("calendar access denied: Privacy & Security > Calendars");
    } finally { h2.kill(); }
  });
});
