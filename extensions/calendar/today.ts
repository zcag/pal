// The pure side of Today and the `upcoming` bar item: an event's state
// against the clock (`in 12 min`, `now, 25 min left`, `over`), its
// duration, which events the strip speaks for, the escalation colour, and
// the strip's title and time segments. Nothing here touches the core; the
// tests import it.
import { MAX_BAR_TITLE, type BarColor, type BarItem, type BarSegment, type CalendarEvent } from "@zcag/pal";
import { addDays, clock, dayName, startOfDay, timeRange } from "./schedule.ts";
import type { Settings } from "./source.ts";
import { freshPopover, popover, type PopoverState } from "./view.ts";

const MIN = 60_000;
const H = 60 * MIN;
/** nf-md-calendar: the extension's glyph, the strip's icon. */
export const ICON = "\u{f00ed}";
export const ITEM = "upcoming";
export const TODAY = "today";

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
type PresentationRules = BarRules & { near_minutes: number };

/** The strip's time-state vocabulary, also used by Settings' mock picker. */
export type UpcomingPhase = "far" | "near" | "warning" | "critical" | "running";

/**
 * The appearance Calendar wants for one time state. `size` maps to both
 * runtime font sizes; `position` moves the sketchybar item for this state.
 */
export type UpcomingPresentation = { phase: UpcomingPhase; color: BarColor; size?: number; position?: string };

const COLORS = new Set<BarColor>(["grey", "blue", "green", "amber", "red", "violet", "pink", "teal", "text", "muted", "accent", "destructive"]);
const number = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const size = (value: unknown) => { const n = number(value, 0); return n > 0 ? n : undefined; };
const position = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const color = (value: unknown, fallback: BarColor): BarColor => typeof value === "string" && COLORS.has(value as BarColor) ? value as BarColor : fallback;

/** Settings normalised once, so the root suggestion and the bar share every eligibility boundary. */
export function barRules(s: Settings): PresentationRules {
  return {
    horizon_hours: number(s.horizon_hours, 10),
    near_minutes: number(s.near_minutes, 60),
    warn_minutes: number(s.warn_minutes, 15),
    urgent_minutes: number(s.urgent_minutes, 5),
    hide_declined: s.hide_declined !== false,
    hide_all_day: s.hide_all_day !== false,
  };
}

/**
 * The events the strip may speak for, by start: not ended, timed unless
 * `hide_all_day` is off, not declined when `hide_declined`, starting
 * inside `horizon_hours`; empty when the day is clear that far out. A
 * running event counts: the strip says what is left of it until it ends.
 */
export function eligible(events: CalendarEvent[], now: number, r: BarRules): CalendarEvent[] {
  const horizon = now + r.horizon_hours * H;
  return events
    .filter((e) => e.end > now && e.start <= horizon && !(r.hide_all_day && e.all_day) && !(r.hide_declined && e.my_status === "declined"))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The event the strip speaks for first: a running one, else the next to start. What a click joins. */
export const nextEvent = (events: CalendarEvent[], now: number, r: BarRules): CalendarEvent | undefined => eligible(events, now, r)[0];

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

/**
 * The calendar's whole visual decision for an event. Defaults deliberately
 * match the existing item: muted until warning, amber, red, then green; no
 * dynamic size or placement until the bar can draw those fields.
 */
export function upcomingPresentation(e: Pick<CalendarEvent, "start" | "end">, now: number, s: Settings): UpcomingPresentation {
  const r = barRules(s);
  const mins = (e.start - now) / MIN;
  const phase: UpcomingPhase = e.start <= now ? "running" : mins <= r.urgent_minutes ? "critical" : mins <= r.warn_minutes ? "warning" : mins <= r.near_minutes ? "near" : "far";
  switch (phase) {
    case "far": return { phase, color: color(s.bar_far_color, "muted"), size: size(s.bar_far_size), position: position(s.bar_far_position) };
    case "near": return { phase, color: color(s.bar_near_color, "muted"), size: size(s.bar_near_size), position: position(s.bar_near_position) };
    case "warning": return { phase, color: color(s.bar_warning_color, "amber"), size: size(s.bar_attention_size), position: position(s.bar_attention_position) };
    case "critical": return { phase, color: color(s.bar_critical_color, "red"), size: size(s.bar_attention_size), position: position(s.bar_attention_position) };
    case "running": return { phase, color: color(s.bar_running_color, "green"), size: size(s.bar_attention_size), position: position(s.bar_attention_position) };
  }
}

/**
 * The strip's title: the event's name alone, cut only at the protocol's
 * ceiling. Each target clips it to its `max_chars`; the time rides in a
 * segment (`barWhen`) so a long name never eats it.
 */
export function barName(e: Pick<CalendarEvent, "title">): string {
  const title = (e.title || "(no title)").trim();
  return title.length > MAX_BAR_TITLE ? title.slice(0, MAX_BAR_TITLE - 1).trimEnd() + "…" : title;
}

/** The strip's time: `in 12m` before the event, `25m left` while it runs. */
export const barWhen = (e: Pick<CalendarEvent, "start" | "end">, now: number): string => (e.start <= now ? `${shortSpan(e.end - now)} left` : `in ${shortSpan(e.start - now)}`);

/** `Standup, 10:00 – 10:30 (Work)`: the tooltip's words for one event. */
const about = (e: CalendarEvent): string => `${e.title || "(no title)"}, ${timeRange(e)}${e.calendar.title ? ` (${e.calendar.title})` : ""}`;

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
 * The strip for `events` at `now` under the settings' rules: the name as
 * the title, the time as a `when` segment in the item's colour (`in 12m`,
 * `25m left`). While an event runs and another is due under the same
 * rules, a `next` segment follows in that event's own escalation colour,
 * `in 8m`, its name in the tooltip and the popover: the strip has one
 * name's width (`max_chars`) and segments are never clipped, so a second
 * name stays off it. The popover (view.ts) over the same events is the
 * menu; pure, so the tests and the gallery fixture agree with it. `stale`
 * is the error behind a cache kept past a failed fetch (the strip muted,
 * the popover says so).
 */
export function upcomingItem(events: CalendarEvent[], now: number, s: Settings, stale?: string | false, st: PopoverState = freshPopover()): BarItem {
  const rules = barRules(s);
  const list = eligible(events, now, rules);
  const e = list[0];
  if (!e) return { hidden: true };
  const next = e.start <= now ? list.find((x) => x.start > now) : undefined;
  const presentation = upcomingPresentation(e, now, s);
  const segments: BarSegment[] = [{ id: "when", text: barWhen(e, now) }];
  if (next) segments.push({ id: "next", text: barWhen(next, now), color: upcomingPresentation(next, now, s).color, tooltip: about(next) });
  return {
    icon: ICON,
    title: barName(e),
    segments,
    color: presentation.color,
    icon_size: presentation.size,
    label_size: presentation.size,
    position: presentation.position,
    badge: e.conference_url ? "dot" : undefined,
    stale: stale ? true : undefined,
    tooltip: `${about(e)}${e.conference_url ? ", Enter joins" : ""}${next ? `; then ${about(next)}` : ""}`,
    click: "open",
    menu: { view: popover(events, now, rules.hide_declined, st, typeof stale === "string" ? stale : undefined) },
  };
}
