// The pure side of Today and the `upcoming` bar item: an event's state
// against the clock (`in 12 min`, `now, 25 min left`, `over`), its
// duration, which event the strip speaks for, the escalation colour, and
// the strip's title. Nothing here touches the core; the tests import it.
import type { BarColor, BarItem, CalendarEvent } from "@zcag/pal";
import { addDays, clock, dayName, startOfDay, timeRange } from "./schedule.ts";
import type { Settings } from "./source.ts";
import { freshPopover, popover, type PopoverState } from "./view.ts";

const MIN = 60_000;
const H = 60 * MIN;
/** nf-md-calendar: the extension's glyph, the strip's icon. */
export const ICON = "\u{f00ed}";
export const ITEM = "upcoming";
export const TODAY = "today";
/** The strip's title keeps this much of the event's title; `MAX_BAR_TITLE` is 64 and the time part needs room. */
const BAR_TITLE_CHARS = 36;

export type State = { kind: "over" | "now" | "soon" | "later"; text: string };

/** `25 min`, `1 h`, `1 h 30 min`, whole hours up to two days (`25 h`), then `3 days`. */
export function span(ms: number): string {
  const mins = Math.max(0, Math.round(ms / MIN));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** The strip's form of `span`: `12m`, `1h 20m`, `3h`, `4d` past two days (a horizon that wide is the setting's ceiling). */
export function shortSpan(ms: number): string {
  const mins = Math.max(0, Math.round(ms / MIN));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

/** `30 min`, `1 h 30 min`; `all day` for an all-day event. */
export const duration = (e: Pick<CalendarEvent, "start" | "end" | "all_day">): string => (e.all_day ? "all day" : span(e.end - e.start));

/**
 * Where the event stands: `over` once it ended, `now, 25 min left` while
 * it runs, `in 12 min` (`in 2 h 5 min`) before it; an all-day event is
 * `today` while its day lasts, `tomorrow` the day before, `in N days`
 * further out. `later` past a day out (the text is the span still).
 */
export function state(e: Pick<CalendarEvent, "start" | "end" | "all_day">, now: number): State {
  if (e.end <= now) return { kind: "over", text: "over" };
  if (e.all_day) {
    if (e.start <= now) return { kind: "now", text: "today" };
    return { kind: "later", text: startOfDay(e.start) === addDays(now, 1) ? "tomorrow" : `in ${Math.round((startOfDay(e.start) - startOfDay(now)) / (24 * H))} days` };
  }
  if (e.start <= now) return { kind: "now", text: `now, ${span(e.end - now)} left` };
  const kind = e.start - now < 24 * H ? "soon" : "later";
  return { kind, text: `in ${span(e.start - now)}` };
}

/** The colour of a state's tag: green while it runs, blue before, grey after. */
export const stateColor = (s: State): "green" | "blue" | "grey" => (s.kind === "now" ? "green" : s.kind === "over" ? "grey" : "blue");

export type BarRules = { horizon_hours: number; warn_minutes: number; urgent_minutes: number; hide_declined: boolean; hide_all_day: boolean };

/**
 * The event the strip speaks for: the first (by start) that has not
 * ended, timed unless `hide_all_day` is off, not declined when
 * `hide_declined`, and starting inside `horizon_hours`; nothing when
 * the day is clear that far out. A running event counts: the strip says
 * `now` until it ends.
 */
export function nextEvent(events: CalendarEvent[], now: number, r: BarRules): CalendarEvent | undefined {
  const horizon = now + r.horizon_hours * H;
  return events
    .filter((e) => e.end > now && !(r.hide_all_day && e.all_day) && !(r.hide_declined && e.my_status === "declined"))
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .find((e) => e.start <= horizon);
}

/**
 * The escalation: `muted` far off, `amber` inside `warn_minutes`, `red`
 * inside `urgent_minutes` (both inclusive, so 15:00 to a 15-minute rule
 * is amber), `green` while the event runs. Minutes may be fractional;
 * the boundaries are exact.
 */
export function escalation(e: Pick<CalendarEvent, "start" | "end">, now: number, warn: number, urgent: number): BarColor {
  if (e.start <= now) return "green";
  const mins = (e.start - now) / MIN;
  if (mins <= urgent) return "red";
  if (mins <= warn) return "amber";
  return "muted";
}

/** `Standup in 12m`, `Standup now`, the title cut to fit the strip. */
export function barTitle(e: Pick<CalendarEvent, "title" | "start" | "end">, now: number): string {
  const title = (e.title || "(no title)").trim();
  const cut = title.length > BAR_TITLE_CHARS ? title.slice(0, BAR_TITLE_CHARS - 1).trimEnd() + "…" : title;
  return e.start <= now ? `${cut} now` : `${cut} in ${shortSpan(e.start - now)}`;
}

/** The day's events (local), in start order; `day` is any moment of it. */
export const onDay = (events: CalendarEvent[], day: number): CalendarEvent[] => {
  const from = startOfDay(day), to = addDays(day, 1);
  return events.filter((e) => e.start < to && e.end > from).sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
};

/** `Concert, Thu 17 Sep 19:00`: the words on the "Nothing else today" row for the next event after `now`. */
export function nextWords(e: CalendarEvent | undefined, now: number): string {
  if (!e) return "Nothing further in the days ahead";
  const day = startOfDay(e.start) === addDays(now, 1) ? "tomorrow" : dayName(e.start);
  return `Next: ${e.title || "(no title)"}, ${day}${e.all_day ? "" : ` ${clock(e.start)}`}`;
}

/**
 * The strip for `events` at `now` under the settings' rules, with the
 * popover (view.ts) over the same events as its menu; pure, so the tests
 * and the gallery fixture agree with it. `stale` is the error behind a
 * cache kept past a failed fetch (the strip muted, the popover says so).
 */
export function upcomingItem(events: CalendarEvent[], now: number, s: Settings, stale?: string | false, st: PopoverState = freshPopover()): BarItem {
  const rules = { horizon_hours: Number(s.horizon_hours) || 10, warn_minutes: Number(s.warn_minutes) || 15, urgent_minutes: Number(s.urgent_minutes) || 5, hide_declined: s.hide_declined !== false, hide_all_day: s.hide_all_day !== false };
  const e = nextEvent(events, now, rules);
  if (!e) return { hidden: true };
  const cal = e.calendar.title ? ` (${e.calendar.title})` : "";
  return {
    icon: ICON,
    title: barTitle(e, now),
    color: escalation(e, now, rules.warn_minutes, rules.urgent_minutes),
    badge: e.conference_url ? "dot" : undefined,
    stale: stale ? true : undefined,
    tooltip: `${e.title || "(no title)"}, ${timeRange(e)}${cal}${e.conference_url ? ", Enter joins" : ""}`,
    menu: { view: popover(events, now, rules.hide_declined, st, typeof stale === "string" ? stale : undefined) },
  };
}
