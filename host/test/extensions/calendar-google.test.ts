// Calendar over the Google source: google.ts's pure parts by import (the
// accounts setting, a token command's output, the join link, HTML to
// text), then the extension through the harness against a local mock of
// the Calendar API v3 (calendar-google.fixture.json, shaped like the API,
// its times shifted so the fixture's 10:00 is the test's now) with two
// accounts whose token commands are scripts: one prints a bare token, the
// other the JSON an OAuth endpoint answers. Rows and actions per palette,
// the filter list, the detail's text, the bar item, the token cache and a
// 401 re-mint, one account failing and both failing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isConference, joinLink, links, parseAccounts, parseToken, text, toEvent } from "../../../extensions/calendar/google.ts";
import type { CalendarEvent } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";
import fixture from "./calendar-google.fixture.json" with { type: "json" };

const E = "calendar";
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

// The fixture is written for 2026-09-16 10:00, times in +00:00. Every time
// in it is shifted so the fixture's 10:00 is the test's start, and the
// host's zone is a fixed whole-hour offset (`Etc/GMT+8`, the only fixed
// form bun's ICU takes) chosen so the local clock reads 10:xx at that
// start: the fixture's hours land in the rows' local hours plus the
// start's minutes, whatever the hour the test runs at, and today is
// today. The test process keeps the system zone (bun ignores a `TZ` set
// at runtime), so `local` formats a moment as the host would.
const FIXTURE_NOW = Date.parse("2026-09-16T10:00:00Z");
const T0 = Date.now();
const shift = T0 - FIXTURE_NOW;
const offHours = 10 - new Date(T0).getUTCHours(); // local = UTC + offHours
process.env.TZ = `Etc/GMT${offHours > 0 ? "-" : "+"}${Math.abs(offHours)}`; // POSIX sign: Etc/GMT-3 is three hours ahead
const offMs = offHours * H;
const localMidnight = (t: number) => Math.floor((t + offMs) / DAY) * DAY - offMs;
const dayShift = Math.round((localMidnight(T0) - Date.UTC(2026, 8, 16)) / DAY);
/** `HH:MM` of a fixture time as the host's clock shows it. */
const local = (iso: string) => { const d = new Date(Date.parse(iso) + shift + offMs); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const at = (iso: string) => Date.parse(iso) + shift;
const shifted = (o: unknown): unknown => {
  if (Array.isArray(o)) return o.map(shifted);
  if (o && typeof o === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === "dateTime" && typeof v === "string") out[k] = new Date(Date.parse(v) + shift).toISOString().replace("Z", "+00:00");
      else if (k === "date" && typeof v === "string") out[k] = new Date(Date.parse(v) + dayShift * DAY).toISOString().slice(0, 10);
      else out[k] = shifted(v);
    }
    return out;
  }
  return o;
};
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });

let dir: string;
let personalToken = "tok-personal";
let workAway = false;
const seen: { path: string; auth: string | null; query: Record<string, string> }[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get("authorization");
    seen.push({ path: url.pathname, auth, query: Object.fromEntries(url.searchParams) });
    const account = auth === `Bearer ${personalToken}` ? "personal" : auth === "Bearer tok-work" ? "work" : undefined;
    if (!account) return json({ error: { code: 401, message: "Invalid Credentials" } }, { status: 401 });
    if (account === "work" && workAway) return json({ error: { code: 503, message: "Backend Error" } }, { status: 503 });
    if (url.pathname === "/users/me/calendarList") return json(fixture.calendarList[account]);
    if (url.pathname === "/calendars/primary/events") {
      if (url.searchParams.get("singleEvents") !== "true" || !url.searchParams.get("timeMin") || !url.searchParams.get("timeMax")) return json({ error: { code: 400, message: "bad query" } }, { status: 400 });
      return json(shifted(fixture.events[account]));
    }
    return json({ error: { code: 404, message: `no ${url.pathname}` } }, { status: 404 });
  },
});
const runs = (name: string) => { try { return readFileSync(join(dir, `${name}.runs`), "utf8").length; } catch { return 0; } };

let host: Host;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pal-gcal-"));
  writeFileSync(join(dir, "token.txt"), personalToken);
  // Bare token on stdout, a line of noise on stderr, one byte per run in a counter file.
  writeFileSync(join(dir, "tok-personal.sh"), `#!/bin/sh\nprintf x >> "${dir}/personal.runs"\necho "warning: nothing" >&2\ncat "${dir}/token.txt"\necho\n`);
  // The JSON an OAuth endpoint answers.
  writeFileSync(join(dir, "tok-work.sh"), `#!/bin/sh\nprintf x >> "${dir}/work.runs"\necho '{"access_token": "tok-work", "expires_in": 3385, "token_type": "Bearer"}'\n`);
  chmodSync(join(dir, "tok-personal.sh"), 0o755);
  chmodSync(join(dir, "tok-work.sh"), 0o755);
  process.env.PAL_GOOGLE_API = `http://127.0.0.1:${server.port}`;
  host = await Host.bundled({ settings: { [E]: { settings: { accounts: [`personal = ${join(dir, "tok-personal.sh")}`, { name: "work", token_command: join(dir, "tok-work.sh"), calendars: ["primary"] }] } } } });
});
afterAll(() => { host.kill(); server.stop(true); rmSync(dir, { recursive: true, force: true }); });

const rid = (id: string, iso: string) => `${id}@${at(iso)}`;

describe("google helpers", () => {
  test("parseAccounts: strings and tables, names, blanks", () => {
    expect(parseAccounts(["work = gcloud auth print-access-token", " ", "ssh archer curl -s 'http://127.0.0.1:8776/token?aud=calendar'", { name: "x", token_command: "cat t", calendars: ["primary", "team@group.calendar.google.com", ""] }, { token_command: "" }, 3])).toEqual([
      { name: "work", token_command: "gcloud auth print-access-token", calendars: ["primary"] },
      { name: "google3", token_command: "ssh archer curl -s 'http://127.0.0.1:8776/token?aud=calendar'", calendars: ["primary"] },
      { name: "x", token_command: "cat t", calendars: ["primary", "team@group.calendar.google.com"] },
    ]);
    expect(parseAccounts(undefined)).toEqual([]);
    expect(parseAccounts(["cmd"])[0].name).toBe("google");
  });
  test("parseToken: a bare line, JSON with expires_in or expiry, nothing", () => {
    const now = 1_000_000;
    expect(parseToken("ya29.abc\n", now)).toEqual({ token: "ya29.abc", until: now + 29 * MIN });
    expect(parseToken("\n  ya29.abc  \nignored", now)).toEqual({ token: "ya29.abc", until: now + 29 * MIN });
    expect(parseToken('{"access_token":"t","expires_in":3385}', now)).toEqual({ token: "t", until: now + 3385_000 - MIN });
    expect(parseToken('{"access_token":"t","expires_in":"600"}', now)).toEqual({ token: "t", until: now + 600_000 - MIN });
    expect(parseToken('{"token":"t","expiry":"2026-09-16T12:00:00Z"}', now)).toEqual({ token: "t", until: Date.parse("2026-09-16T12:00:00Z") - MIN });
    expect(parseToken('{"access_token":"t"}', now)).toEqual({ token: "t", until: now + 29 * MIN });
    expect(parseToken("", now)).toBeUndefined();
    expect(parseToken('{"nope":1}', now)).toBeUndefined();
    expect(parseToken("{broken", now)).toBeUndefined();
  });
  test("joinLink: the video entry point first, hangoutLink, then the location and the description", () => {
    expect(joinLink({ conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "more", uri: "https://applications.zoom.us/addon/x" }, { entryPointType: "video", uri: "https://zoom.us/j/1" }] }, hangoutLink: "https://meet.google.com/aaa-bbbb-ccc" })).toBe("https://zoom.us/j/1");
    expect(joinLink({ conferenceData: { entryPoints: [{ entryPointType: "more", uri: "https://applications.zoom.us/addon/x" }] } })).toBe("https://applications.zoom.us/addon/x");
    expect(joinLink({ hangoutLink: "https://meet.google.com/aaa-bbbb-ccc", location: "https://zoom.us/j/2" })).toBe("https://meet.google.com/aaa-bbbb-ccc");
    expect(joinLink({ location: "https://zoom.us/j/2", description: "https://meet.google.com/x-y-z" })).toBe("https://zoom.us/j/2");
    expect(joinLink({ location: "Room 4", description: "Agenda: https://docs.example.com/x then <a href=\"https://teams.microsoft.com/l/meetup-join/19%3ax/0?context=y\">Teams</a>." })).toBe("https://teams.microsoft.com/l/meetup-join/19%3ax/0?context=y");
    expect(joinLink({ description: "See https://zoom.us/pricing and https://meet.google.com/new" })).toBeNull();
    expect(joinLink({})).toBeNull();
  });
  test("links and isConference: unwrapping, trailing punctuation, the provider rule", () => {
    expect(links("go to https://zoom.us/j/1?pwd=a&amp;b=2. Or (https://meet.google.com/x-y-z), and http://")).toEqual(["https://zoom.us/j/1?pwd=a&b=2", "https://meet.google.com/x-y-z"]);
    expect(links("https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2Fabc&data=x")).toEqual(["https://teams.microsoft.com/l/meetup-join/abc"]);
    for (const ok of ["https://zoom.us/j/1", "https://us02web.zoom.us/w/2", "https://meet.google.com/abc-defg-hij", "https://teams.microsoft.com/l/meetup-join/x", "https://teams.live.com/meet/1", "https://example.webex.com/meet/joe", "https://meet.jit.si/room", "https://whereby.com/room", "https://meet.goto.com/123"]) expect(isConference(ok)).toBe(true);
    for (const no of ["https://zoom.us/pricing", "https://meet.google.com/", "https://meet.google.com/new", "https://example.webex.com/signin", "https://docs.google.com/x", "https://teams.microsoft.com/", "nope"]) expect(isConference(no)).toBe(false);
  });
  test("text: HTML to text, plain text left alone", () => {
    expect(text("<p>Walk through.</p><ul><li>One</li><li>Two</li></ul><p>Notes: <a href=\"https://x\">doc</a> &amp; agenda</p>")).toBe("Walk through.\n- One\n- Two\nNotes: doc & agenda");
    expect(text("line one<br>line two<br/>\n\n\n\nthree")).toBe("line one\nline two\n\nthree");
    expect(text("a &amp; b\r\nc")).toBe("a & b\nc");
  });
  test("toEvent: the core's shape, all-day as local midnights, cancelled dropped", () => {
    const cal = { id: "p:primary", title: "Personal", color: "#9fe1e7", source: "p", writable: true };
    const e = toEvent(fixture.events.personal.items[0] as any, "p", cal)!;
    expect(e).toMatchObject({ id: "p:standup_20260916T093000Z", occurrence: Date.parse("2026-09-16T09:30:00Z"), recurring: true, title: "Daily standup", start: Date.parse("2026-09-16T09:30:00Z"), end: Date.parse("2026-09-16T09:45:00Z"), all_day: false, location: null, notes: null, url: "https://www.google.com/calendar/event?eid=c3RhbmR1cA", calendar: cal, organizer: "Mara Lind", conference_url: "https://us02web.zoom.us/j/85712227948?pwd=abc", my_status: "accepted" });
    expect(e.attendees).toEqual([{ name: "Mara Lind", status: "accepted", me: false }, { name: "someone@gmail.com", status: "accepted", me: true }]);
    const allDay = toEvent(fixture.events.personal.items[6] as any, "p", cal)!;
    expect(allDay).toMatchObject({ all_day: true, start: new Date(2026, 8, 18).getTime(), end: new Date(2026, 8, 20).getTime(), attendees: [], my_status: null, conference_url: null });
    expect(toEvent(fixture.events.personal.items[3] as any, "p", cal)).toBeUndefined();
    expect(toEvent({ id: "x", summary: "no times" }, "p", cal)).toBeUndefined();
  });
});

describe("google source", () => {
  test("meta: the filter lists each account's calendars it reads, named by account", () => {
    const l = host.loaded().find((l) => l.extension === E)!;
    expect(l.palettes[0].filters).toEqual([{ id: "all", title: "All calendars" }, { id: "personal:primary", title: "Personal (personal)" }, { id: "work:primary", title: "someone@example.com (work)" }]);
    expect(runs("personal")).toBe(1);
    expect(runs("work")).toBe(1);
  });

  test("My Schedule: both accounts' rows in one order, Google's actions, no New event", async () => {
    const items = await host.list(E, "schedule");
    expect(items.map((i) => i.name)).toEqual(["Weekly sync", "Design review: settings window", "Dentist", "1:1 with Mara", "Team offsite"]);
    expect(items.map((i) => i.section)).toEqual(["Today", "Today", "Today", "Tomorrow", "This week"]);
    const sync = items[0];
    expect(sync).toMatchObject({ id: rid("work:sync", "2026-09-16T10:12:00Z"), icon: "#4986e7", accessories: [{ tag: "in 12 min", color: "blue" }, { text: "2 people" }, { tag: "Join", color: "green" }] });
    expect(sync.actions).toEqual([{ id: "join", title: "Join call" }, { id: "open", title: "Open in Google Calendar" }, { id: "copy_link", title: "Copy conference link", shortcut: "cmd+shift+c" }, { id: "copy_details", title: "Copy event details", shortcut: "cmd+c" }]);
    expect(items[2].actions!.map((a) => a.id)).toEqual(["open", "copy_details"]);
    expect(items[1]).toMatchObject({ icon: "#9fe1e7", subtitle: `${local("2026-09-16T11:00:00Z")} – ${local("2026-09-16T12:00:00Z")} · Room 4`, accessories: [{ tag: "maybe", color: "amber" }, { text: "4 people" }, { tag: "Join", color: "green" }] });
    // The token commands ran once per account for the filter list and once more is not needed: the events read reused the token.
    expect(runs("personal")).toBe(1);
    expect(runs("work")).toBe(1);
    expect(seen.filter((s) => s.path === "/calendars/primary/events").map((s) => s.query.singleEvents)).toEqual(["true", "true"]);
    expect(seen.find((s) => s.path === "/calendars/primary/events")!.query.fields).toContain("conferenceData(entryPoints(entryPointType,uri))");
  });

  test("picks: join from conferenceData, from hangoutLink, from a Teams link in the description; open is the browser", async () => {
    expect(await host.pick(E, "schedule", rid("work:sync", "2026-09-16T10:12:00Z"))).toEqual({ open: "https://example.zoom.us/j/99911122233?pwd=xyz" });
    expect(await host.pick(E, "schedule", rid("personal:design", "2026-09-16T11:00:00Z"), "join")).toEqual({ open: "https://meet.google.com/abc-defg-hij" });
    expect(await host.pick(E, "schedule", rid("personal:oneonone", "2026-09-17T10:00:00Z"), "copy_link")).toEqual({ copy: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d" });
    expect(await host.pick(E, "schedule", rid("personal:dentist", "2026-09-16T15:30:00Z"))).toEqual({ open: "https://www.google.com/calendar/event?eid=ZGVudGlzdA" });
    expect(await host.pick(E, "schedule", rid("personal:dentist", "2026-09-16T15:30:00Z"), "open")).toEqual({ open: "https://www.google.com/calendar/event?eid=ZGVudGlzdA" });
  });

  test("Today: the standup over, the sync in 12 min, the declined one hidden, tomorrow waiting; the detail's description as text", async () => {
    const rows = await host.list(E, "today");
    expect(rows.map((r) => [r.name, (r.accessories![0] as { tag: string }).tag])).toEqual([["Daily standup", "over"], ["Weekly sync", "in 12 min"], ["Design review: settings window", "in 1 h"], ["Dentist", "in 5 h 30 min"]]);
    expect(rows[1]).toMatchObject({ icon: { glyph: "\u{f00ee}", color: "#4986e7" }, subtitle: `${local("2026-09-16T10:12:00Z")} – ${local("2026-09-16T10:42:00Z")} · 30 min` });
    const d = await host.detail(E, "today", rid("personal:design", "2026-09-16T11:00:00Z"));
    expect(d.markdown).toBe("Walk through the six pages.\n- Overview first\n- One grouped table\nNotes: doc & agenda");
    expect(d.metadata).toEqual([
      { label: "When", value: expect.stringMatching(/, \d\d:\d\d – \d\d:\d\d \(1 h\)$/) },
      { label: "Calendar", tags: [{ text: "Personal (personal)" }] },
      { label: "Location", value: "Room 4" },
      { label: "Call", link: { text: "meet.google.com/abc-defg-hij", href: "https://meet.google.com/abc-defg-hij" } },
      { label: "Attendees (4)", tags: [{ text: "Mara Lind", color: "green" }, { text: "someone@gmail.com (you)", color: "amber" }, { text: "Tomas Ruiz", color: "grey" }, { text: "Ada Chen", color: "red" }] },
      { label: "Your reply", tags: [{ text: "tentative", color: "amber" }] },
    ]);
    const std = await host.detail(E, "today", rid("personal:standup_20260916T093000Z", "2026-09-16T09:30:00Z"));
    expect(std.metadata).toContainEqual({ label: "Repeats", value: "yes" });
    expect(std.metadata).toContainEqual({ label: "Organizer", value: "Mara Lind" });
  });

  test("the bar item: the sync in 12 minutes, amber with a dot; a minute tick reads the cache", async () => {
    const item = await host.render(E, "upcoming", { reason: "load" });
    expect(item).toMatchObject({ title: "Weekly sync in 12m", color: "amber", badge: "dot", tooltip: expect.stringContaining("Weekly sync, "), menu: { palette: "today", extension: "calendar", args: { rest: true } } });
    const n = seen.length;
    expect(await host.render(E, "upcoming", { reason: "minute" })).toEqual(item);
    expect(seen.length).toBe(n);
    expect(runs("personal")).toBe(1);
  });

  test("a 401 mints the token again, once", async () => {
    personalToken = "tok-personal-2";
    writeFileSync(join(dir, "token.txt"), personalToken);
    const before = runs("personal");
    const rows = await host.list(E, "today", "", { refresh: true });
    expect(rows.map((r) => r.name)).toContain("Design review: settings window");
    expect(runs("personal")).toBe(before + 1);
    expect(seen.slice(-4).some((s) => s.auth === "Bearer tok-personal")).toBe(true);
    expect(seen[seen.length - 1].auth).toBe("Bearer tok-personal-2");
  });

  test("one account away keeps the other's events; every account away is the hint row, and the bar keeps the last as stale", async () => {
    workAway = true;
    try {
      const rows = await host.list(E, "schedule", "", { refresh: true });
      expect(rows.map((r) => r.name)).toEqual(["Design review: settings window", "Dentist", "1:1 with Mara", "Team offsite"]);
      expect(host.stderr).toContain("calendar: work: 503 Backend Error");
      personalToken = "nope";
      const none = await host.list(E, "today", "", { refresh: true });
      expect(none[0]).toMatchObject({ id: "hint", name: "Showing the last events read", section: "Today" });
      expect(none[0].subtitle).toBe("personal: 401 Invalid Credentials; work: 503 Backend Error");
      expect(none.map((r) => r.name)).toContain("Design review: settings window");
      expect(await host.render(E, "upcoming", { reason: "every" })).toMatchObject({ title: "Design review: settings window in 1h", stale: true });
    } finally {
      workAway = false;
      personalToken = "tok-personal-2";
    }
  });

  test("source = system with accounts still listed goes to the core; auto without accounts too", async () => {
    const calls: string[] = [];
    const h2 = await Host.bundled({ core: { "calendar.permission": () => "granted", "calendar.calendars": () => [], "calendar.events": () => { calls.push("events"); return [] as CalendarEvent[]; } }, settings: { [E]: { settings: { source: "system", accounts: [`personal = ${join(dir, "tok-personal.sh")}`] } } } });
    try {
      const rows = await h2.list(E, "today");
      expect(rows[0]).toMatchObject({ id: "nothing", name: "Nothing today" });
      expect(calls).toEqual(["events"]);
      expect((await h2.list(E, "schedule")).map((r) => r.id)).toEqual(["new"]);
      expect(await h2.render(E, "upcoming", { reason: "load" })).toEqual({ hidden: true });
    } finally { h2.kill(); }
    const h3 = await Host.bundled({ core: { "calendar.permission": () => "unavailable" }, settings: { [E]: { settings: { source: "google", accounts: [] } } } });
    try {
      const rows = await h3.list(E, "today");
      expect(rows[0]).toMatchObject({ id: "hint", name: "Could not read the calendar", subtitle: "No Google account configured: add one under Settings > Calendar > Accounts" });
    } finally { h3.kill(); }
  });
});
