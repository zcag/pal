// Writes app/src/gallery/shots/calendar.json and bar-calendar.json: the
// store screenshots' fixtures over one made-up week (the names are this
// file's) at the kit's clock, Wed 16 Sep 2026 14:32. The palettes are
// listed through the host harness against canned core/calendar.* replies,
// so the rows, the detail, the form and Quick Add are the extension's own;
// the bar item and its popover are `upcomingItem` and `popover` from
// today.ts and view.ts, at 14:32 and at the moments a state stands for,
// coloured by the manifest's rules as the core colours them.
// `make shots EXT=calendar`.
import type { BarItem, Calendar, CalendarEvent } from "@zcag/pal";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host } from "../../host/test/harness.ts";
import manifest from "./pal.json";
import type { Settings } from "./source.ts";
import { upcomingItem, type ItemSettings } from "./today.ts";
import { freshPopover } from "./view.ts";

/** A time on the fixture's day (16 Sep 2026), or `day` days after it. */
const at = (h: number, m = 0, day = 0) => new Date(2026, 8, 16 + day, h, m).getTime();

const WORK: Calendar = { id: "work", title: "Work", color: "#3B82F6", source: "iCloud", writable: true };
const TEAM: Calendar = { id: "team", title: "Team", color: "#8B5CF6", source: "Google", writable: true };
const HOME: Calendar = { id: "home", title: "Home", color: "#10B981", source: "iCloud", writable: true };
const HOL: Calendar = { id: "hol", title: "Holidays", color: "#F59E0B", source: "iCloud", writable: false };
const CALS = [WORK, TEAM, HOME, HOL];

const MEET = "https://meet.google.com/abc-defg-hij";
const ZOOM = "https://zoom.us/j/85712227948";
/** Attendees, the first being "you"; a trailing `?` is a tentative reply, `-` one not given yet. */
const who = (...names: string[]) => names.map((n, i) => ({ name: n.replace(/[?-]$/, ""), status: n.endsWith("?") ? "tentative" as const : n.endsWith("-") ? "pending" as const : "accepted" as const, me: i === 0 }));
const TEAM6 = who("Sam Ortega", "Mara Lind", "Tomas Ruiz", "Ada Chen", "Nia Okafor", "Leo Brandt?");
const ev = (id: string, title: string, start: number, end: number, calendar: Calendar, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, occurrence: null, title, start, end, all_day: false, location: null, notes: null, url: null, calendar, attendees: [], organizer: null, conference_url: null, recurring: false, my_status: null, ...extra,
});

// The day at 14:32: the morning's standup, review and lunch over, the weekly sync in thirteen minutes (a call), the retro and the dentist later; tomorrow and the week after.
const events: CalendarEvent[] = [
  ev("holiday", "Car-free day", at(0, 0, 6), at(0, 0, 7), HOL, { all_day: true }),
  ev("standup", "Daily standup", at(9, 30), at(9, 45), TEAM, { conference_url: ZOOM, attendees: TEAM6, recurring: true, occurrence: at(9, 30), my_status: "accepted" }),
  ev("design", "Design review: settings window", at(11), at(12), TEAM, { conference_url: ZOOM, location: "Room 4", organizer: "Mara Lind", attendees: who("Sam Ortega", "Mara Lind", "Tomas Ruiz?", "Ada Chen-"), my_status: "accepted" }),
  ev("lunch", "Lunch with Deniz", at(12, 30), at(13, 30), HOME, { location: "Moda" }),
  ev("sync", "Weekly sync", at(14, 45), at(15, 15), WORK, {
    conference_url: MEET, organizer: "Mara Lind", attendees: who("Sam Ortega", "Mara Lind"), recurring: true, occurrence: at(14, 45), my_status: "accepted",
    notes: "The week in one pass, then what is blocking.\n\n- Release 0.3: what is left on the board\n- The settings window review: the decisions from this morning\n- Hiring: two interviews next week",
  }),
  ev("retro", "Sprint retro", at(16), at(16, 45), TEAM, { conference_url: ZOOM, attendees: TEAM6, my_status: "accepted" }),
  ev("dentist", "Dentist", at(17, 30), at(18, 15), HOME, { location: "Kadıköy" }),
  ev("1on1", "1:1 with Mara", at(10, 0, 1), at(10, 30, 1), WORK, { conference_url: MEET, attendees: who("Sam Ortega", "Mara Lind"), my_status: "accepted" }),
  ev("release", "Release 0.3 planning", at(14, 0, 1), at(15, 0, 1), TEAM, { conference_url: ZOOM, attendees: who("Sam Ortega", "Mara Lind", "Tomas Ruiz", "Ada Chen", "Nia Okafor"), my_status: "tentative" }),
  ev("climb", "Climbing", at(19, 0, 1), at(20, 30, 1), HOME, { location: "Kozyatağı wall" }),
  ev("football", "Five-a-side", at(19, 0, 2), at(20, 0, 2), HOME, { location: "Moda pitch" }),
  ev("offsite", "Team offsite", at(0, 0, 2), at(0, 0, 4), TEAM, { all_day: true, attendees: TEAM6 }),
  ev("flight", "Flight to Berlin", at(7, 45, 9), at(10, 5, 9), HOME, { location: "IST" }),
];

// ---- the palettes, through the host ---------------------------------------------

const core = {
  "calendar.permission": () => "granted",
  "calendar.calendars": () => CALS,
  "calendar.events": (p: { from: number; to: number; calendars?: string[] }) => events.filter((e) => e.end > p.from && e.start < p.to && (!p.calendars || p.calendars.includes(e.calendar.id))),
};
pinClock();
const host = await Host.bundled({ core, settings: { calendar: { settings: { source: "system", days: 10 } } } });
const QUICK = "haircut sat 11:00 for 45m at Moda @ home";
let panel;
try {
  const meta = Object.fromEntries(host.loaded().find((l) => l.extension === "calendar")!.palettes.map((p) => [p.name, p]));
  const palette = (key: string) => ({ title: meta[key].title, icon: meta[key].icon, placeholder: meta[key].placeholder });
  const schedule = await host.list("calendar", "schedule", "");
  const today = await host.list("calendar", "today", "");
  const details: Record<string, unknown> = {};
  for (const r of schedule) if (r.id.includes("@")) details[r.id] = await host.detail("calendar", "schedule", r.id);
  const form = await host.pick("calendar", "schedule", "new");
  panel = {
    palettes: {
      schedule: { ...palette("schedule"), live: true, filters: meta.schedule.filters, items: schedule, details },
      today: { ...palette("today"), live: true, items: today, details: Object.fromEntries(today.filter((r) => details[r.id]).map((r) => [r.id, details[r.id]])) },
      quick: { ...palette("quick"), input: true, byQuery: { "": await host.list("calendar", "quick", ""), [QUICK]: await host.list("calendar", "quick", QUICK) } },
    },
    effects: { "schedule/new": form },
    shots: {
      "1-schedule": { palette: "schedule", keys: [], caption: "What is left of today and the days after, the next event tagged with how soon, calls tagged Join" },
      "2-detail": { palette: "schedule", keys: ["cmd+i", "wait:400"], caption: "The detail pane: the notes as markdown, when, the call, the organizer, the attendees with their replies" },
      "3-new": { palette: "schedule", keys: ["type:new event", "enter", "wait:300"], caption: "New event: a title, a day in words, the times from the next quarter hour, the calendar" },
      "4-today": { palette: "today", keys: [], caption: "Today: the whole day in order, what is over greyed, the rest with how long until it starts" },
      "5-quick": { palette: "quick", keys: [`type:${QUICK}`, "wait:300"], caption: "Quick Add: a line typed, the event read back with its day, time, place and calendar before Enter adds it" },
    },
  };
} finally {
  host.kill();
}
writeFixture("calendar", panel);

// ---- the bar item ---------------------------------------------------------------

const settings: Settings & ItemSettings = { source: "system", accounts: [], calendars: [], days: 10, hide_declined: true, hide_all_day: true, horizon_hours: 10, near_minutes: 60, warn_minutes: 15, urgent_minutes: 5, default_length: 30, call_lead: 5 };
/** The core's part: the manifest's rule for the item's `calendar.phase` sets its colour. */
const ruled = (item: BarItem): BarItem => {
  const phase = (item.states as { phase?: string } | undefined)?.phase;
  const rule = manifest.bar.upcoming.rules.find((r) => r.when === `calendar.phase == '${phase}'`);
  return rule ? { ...item, color: rule.color as BarItem["color"] } : item;
};
const itemAt = (t: number, st = freshPopover(false, true)) => ruled(upcomingItem(events, t, settings, undefined, st));
const item = itemAt(NOW);
/** A state patches over `item`: what the item at that moment leaves out (the call's dot) goes as null, not inherited. */
const state = (id: string, t: number, st?: ReturnType<typeof freshPopover>) => {
  const s = Object.fromEntries(Object.entries(itemAt(t, st)).filter(([, v]) => v !== undefined));
  return { id, item: { ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).map(([k]) => [k, null])), ...s } };
};

const bar = {
  key: "calendar/upcoming",
  title: manifest.bar.upcoming.title,
  item,
  states: [
    // 14:41: the sync four minutes out.
    state("urgent", at(14, 41)),
    // 14:51: the sync running, the retro next.
    state("now", at(14, 51)),
    // 17:00: the dentist is what is left; tomorrow unfolded, the ring on its first row.
    state("tomorrow", at(17), { ...freshPopover(false, true), expanded: true, cursor: 1 }),
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: the next event and how long until it, the glyph amber inside fifteen minutes, a dot for a call to join" },
    "menubar-urgent": { target: "menubar", state: "urgent", caption: "Inside five minutes the glyph turns red" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the day: what is still to come with the time, the place and the people, Join on the calls, tomorrow folded under its header" },
    "popover-now": { target: "menubar", popover: true, state: "now", caption: "While a call runs its row sits on a card with what is left of it, the strip green; Enter joins" },
    "popover-tomorrow": { target: "menubar", popover: true, state: "tomorrow", caption: "Late in the day: what is left, and t opens tomorrow in the same shape; the arrows walk the rows" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the same item, amber with the call's dot" },
  },
};
writeFixture("bar-calendar", bar);
console.log(`${events.length} events; the strip says ${item.title} ${item.segments?.map((s) => s.text).join(" ")}`);
