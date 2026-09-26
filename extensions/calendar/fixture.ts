// Writes app/src/gallery/shots/bar-calendar.json: the store screenshots'
// fixture for the `upcoming` bar item. A made-up day (the names are this
// file's) at a fixed clock, drawn through the same `upcomingItem` and
// `popover` the extension uses, so the shots show what the popover draws.
// `bun run extensions/calendar/fixture.ts`, then
// `node app/scripts/shots.mjs bar calendar`.
import { writeFileSync } from "node:fs";
import type { Calendar, CalendarEvent } from "@zcag/pal";
import type { Settings } from "./source.ts";
import { upcomingItem, type ItemSettings } from "./today.ts";
import { freshPopover, popover } from "./view.ts";

/** Wed 16 Sep 2026, 10:00 local: the sync starts in twelve minutes. */
const NOW = new Date(2026, 8, 16, 10, 0).getTime();
const at = (h: number, m = 0, day = 0) => new Date(2026, 8, 16 + day, h, m).getTime();

const WORK: Calendar = { id: "work", title: "Work", color: "#3B82F6", source: "Google", writable: true };
const TEAM: Calendar = { id: "team", title: "Team", color: "#8B5CF6", source: "Google", writable: true };
const HOME: Calendar = { id: "home", title: "Home", color: "#10B981", source: "iCloud", writable: true };
const HOL: Calendar = { id: "hol", title: "Holidays", color: "#F59E0B", source: "iCloud", writable: false };

const MEET = "https://meet.google.com/abc-defg-hij";
const ZOOM = "https://zoom.us/j/85712227948";
const who = (...names: string[]) => names.map((name, i) => ({ name, status: "accepted" as const, me: i === 0 }));
const ev = (id: string, title: string, start: number, end: number, calendar: Calendar, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, occurrence: null, title, start, end, all_day: false, location: null, notes: null, url: null, calendar, attendees: [], organizer: null, conference_url: null, recurring: false, my_status: null, ...extra,
});

const events: CalendarEvent[] = [
  ev("morning", "Inbox and coffee", at(9), at(9, 45), HOME),
  ev("sync", "Weekly sync", at(10, 12), at(10, 42), WORK, { conference_url: MEET, attendees: who("Cagdas", "Mara Lind"), recurring: true, occurrence: at(10, 12) }),
  ev("design", "Design review: settings window", at(11), at(12), TEAM, { conference_url: ZOOM, location: "Room 4", attendees: who("Cagdas", "Mara Lind", "Tomas Ruiz", "Ada Chen") }),
  ev("lunch", "Lunch with Deniz", at(12, 30), at(13, 30), HOME, { location: "Kadıköy" }),
  ev("dentist", "Dentist", at(15, 30), at(16, 15), HOME, { location: "Kadıköy" }),
  ev("focus", "Focus: release notes", at(16, 30), at(18), WORK, { my_status: "tentative" }),
  ev("cycle", "Car-free day", at(0, 0), at(0, 0, 1), HOL, { all_day: true }),
  ev("1on1", "1:1 with Mara", at(10, 0, 1), at(10, 30, 1), WORK, { conference_url: MEET, attendees: who("Cagdas", "Mara Lind") }),
  ev("release", "Release 0.3 planning", at(14, 0, 1), at(15, 0, 1), TEAM, { conference_url: ZOOM, attendees: who("Cagdas", "Mara Lind", "Tomas Ruiz", "Ada Chen", "Sam Oduya") }),
  ev("gym", "Climbing", at(19, 0, 1), at(20, 30, 1), HOME),
];

const settings: Settings & ItemSettings = { source: "auto", accounts: [], calendars: [], days: 7, hide_declined: true, hide_all_day: true, horizon_hours: 10, near_minutes: 60, warn_minutes: 15, urgent_minutes: 5, default_length: 30, call_lead: 5 };
const st = freshPopover(false, true);
const item = upcomingItem(events, NOW, settings, undefined, st);
const running = upcomingItem(events, at(10, 18), settings, undefined, st);
// Two minutes left of the sync, the review twenty out: both on the strip.
const ending = upcomingItem(events, at(10, 40), settings, undefined, st);

const bar = {
  key: "calendar/upcoming",
  title: "Upcoming",
  item,
  states: [
    { id: "far", item: { title: "Design review: settings window", segments: [{ id: "when", text: "in 3h" }], color: "muted", badge: null, tooltip: "Design review: settings window, 11:00 – 12:00 (Team)" } },
    { id: "urgent", item: { title: "Weekly sync", segments: [{ id: "when", text: "in 4m" }], color: "red", tooltip: "Weekly sync, 10:12 – 10:42 (Work), Enter joins" } },
    // The sync running: its row on a card with `ends in`, the Join solid.
    { id: "now", item: { title: "Weekly sync", segments: [{ id: "when", text: "24m left" }], color: "green", tooltip: "Weekly sync, 10:12 – 10:42 (Work), Enter joins", menu: running.menu } },
    { id: "now-next", item: { title: "Weekly sync", segments: ending.segments, color: "green", tooltip: ending.tooltip, menu: ending.menu } },
    { id: "stale", item: { stale: true, tooltip: "Weekly sync, 10:12 – 10:42 (Work), Enter joins (stale)" } },
    // Late in the day, tomorrow unfolded, the ring on its first row.
    { id: "tomorrow", item: { title: "Dentist", segments: [{ id: "when", text: "in 30m" }], color: "muted", badge: null, tooltip: "Dentist, 15:30 – 16:15 (Home)", menu: { view: popover(events, at(15), true, { ...st, expanded: true, cursor: 2 }) } } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the next event and how long until it, amber inside fifteen minutes, a dot for a call to join" },
    "bar-menubar-light": { target: "menubar", theme: "light", state: "urgent", caption: "Inside five minutes the item turns red" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the day: what is still to come with the time, the place and the people, Join on the calls, tomorrow folded under its header" },
    "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, state: "now", caption: "While a call runs its row sits on a card with what is left of it; Enter joins" },
    "bar-menubar-popover-tomorrow": { target: "menubar", theme: "light", popover: true, state: "tomorrow", caption: "Late in the day: what is left, and t opens tomorrow in the same shape; the arrows walk the rows" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", state: "far", caption: "On sketchybar, hours out: muted, the strip's own text; hidden when nothing starts within ten hours" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-calendar.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log(`${events.length} events, the strip says ${item.title} ${item.segments?.map((s) => s.text).join(" ")}`);
