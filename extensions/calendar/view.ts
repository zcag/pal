// The `upcoming` bar item's popover as a render tree (`View` in
// `@zcag/pal`), pure: the gallery renders a fixture day with this same
// function. Today's events still to come as rows (the time column, the
// calendar's colour as a thin bar, the title over the place and the head
// count, the state at the right: `in 12 min`, `ends in 24 min` on the one
// running, which sits on an elevated card), all-day events as a badge
// row on top, a Join button on a row with a call, tomorrow folded under a
// header that opens on `t` or a click, a "Nothing today" card on a clear
// day, and the key hints at the bottom. The keys walk the rows with a
// ring (`selected`); Enter joins or opens the focused one. Every row and
// button carries `action`, so a click does what its key would.
import type { Action, CalendarEvent, HexColor, View, ViewNode } from "@zcag/pal";
import { addDays, clock, dayName, people, startOfDay, timeRange } from "./schedule.ts";
import { span } from "./today.ts";

/** What the popover's keys keep between trees: which row the ring is on, whether tomorrow is open. `google`/`mac` pick the "open" action's words. */
export type PopoverState = { cursor: number; expanded: boolean; google: boolean; mac: boolean };
export const freshPopover = (google = false, mac = process.platform === "darwin"): PopoverState => ({ cursor: 0, expanded: false, google, mac });

/** The popover's content width: 420 less the view's padding (3 steps a side). */
export const COMPACT_W = 396;
/** The row's parts: the time column, the colour bar, the state column at the right, the gaps between (2 steps each) and the row's own padding. */
const TIME_W = 40, BAR_W = 3, STATE_W = 82, GAP = 8, ROW_PAD = 8;
const TITLE_W = COMPACT_W - 2 * ROW_PAD - TIME_W - BAR_W - STATE_W - 3 * GAP;
const MIN = 60_000, H = 60 * MIN;

type Text = Extract<ViewNode, { type: "text" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;
const text = (value: string, extra: Partial<Text> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 0, ...extra, children });
const keycap = (keys: string): ViewNode => ({ type: "keycap", keys });
const hint = (keys: string[], what: string): ViewNode[] => [...keys.map(keycap), text(what, { style: "muted", size: "xs" })];

export const rowId = (e: CalendarEvent) => `${e.id}@${e.start}`;
/** The calendar's colour as a hex the view may paint, else the accent-ish grey. */
const calColor = (e: CalendarEvent): HexColor => (e.calendar.color && /^#[0-9a-f]{6}$/i.test(e.calendar.color) ? (e.calendar.color as HexColor) : "#8a8f98");

/**
 * The rows the popover lists, in order: today's not yet over (the
 * strip's popover is about what is still to come), then tomorrow's when
 * the fold is open. All-day events are not rows (they are the badge line
 * on top). Declined ones are dropped when the setting says so.
 */
export function listed(events: CalendarEvent[], now: number, hideDeclined: boolean): { today: CalendarEvent[]; allDay: CalendarEvent[]; tomorrow: CalendarEvent[]; next?: CalendarEvent } {
  const keep = (e: CalendarEvent) => !(hideDeclined && e.my_status === "declined");
  const from = startOfDay(now), mid = addDays(now, 1), to = addDays(now, 2);
  const sorted = [...events].filter(keep).sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
  const today = sorted.filter((e) => !e.all_day && e.start < mid && e.end > now);
  const allDay = sorted.filter((e) => e.all_day && e.start < mid && e.end > from);
  const tomorrow = sorted.filter((e) => e.start >= mid && e.start < to && !(e.all_day && e.start < mid));
  const next = sorted.find((e) => e.start >= mid && !e.all_day);
  return { today, allDay, tomorrow, next };
}

/** The rows the ring can rest on: today's, then tomorrow's when open. */
export const focusable = (l: ReturnType<typeof listed>, st: PopoverState): CalendarEvent[] => (st.expanded ? [...l.today, ...l.tomorrow] : l.today);

/** `in 12 min`, `in 2 h 5 min`; `ends in 24 min` while it runs; blue inside the hour. */
function stateText(e: CalendarEvent, now: number): { text: string; color: "green" | "blue" | "muted" } {
  if (e.start <= now) return { text: `ends in ${span(e.end - now)}`, color: "green" };
  return { text: `in ${span(e.start - now)}`, color: e.start - now <= H ? "blue" : "muted" };
}

const sub = (e: CalendarEvent): string => [e.location?.replace(/^https?:\/\/\S+$/, "") || undefined, people(e.attendees.length), e.calendar.title].filter(Boolean).join(" · ");

/** One event as a row: the time column, the colour bar, the title and its line, the state and a Join button; the running one on a card. */
function eventRow(e: CalendarEvent, now: number, focused: boolean, tomorrow: boolean): ViewNode {
  const id = rowId(e);
  const running = !tomorrow && e.start <= now;
  const st = stateText(e, now);
  // Tomorrow's rows say their time in the time column already: the right column holds the Join button alone.
  const right: ViewNode[] = tomorrow ? [] : [text(st.text, { size: "xs", color: st.color, weight: running ? "semibold" : undefined, align: "end", width: STATE_W })];
  if (e.conference_url) right.push({ type: "tile", key: "join", width: 44, height: 22, text: "Join", color: "green", fill: running ? "solid" : "soft", action: `join:${id}` });
  const declined = e.my_status === "declined" ? [{ type: "badge" as const, key: "declined", text: "declined", color: "red" as const }] : e.my_status === "tentative" ? [{ type: "badge" as const, key: "maybe", text: "maybe", color: "amber" as const }] : [];
  return row(
    [
      column([text(clock(e.start), { style: "mono", size: "sm", weight: running ? "semibold" : "medium", width: TIME_W }), text(clock(e.end), { style: "mono", size: "xs", color: "faint", width: TIME_W })], { key: "time", gap: 0 }),
      { type: "tile", key: "bar", width: BAR_W, height: 30, color: calColor(e), fill: "solid" },
      column([row([text(e.title || "(no title)", { size: "md", weight: running || focused ? "semibold" : "medium", width: declined.length ? TITLE_W - 64 : TITLE_W }), ...declined], { key: "t", gap: 1 }), text(sub(e), { size: "xs", color: "muted", width: TITLE_W })], { key: "main", gap: 0, grow: true }),
      column(right, { key: "right", gap: 1, align: "end" }),
    ],
    { key: id, gap: 2, padding: 2, radius: true, surface: running ? "elevated" : undefined, action: `focus:${id}`, selected: focused || undefined, minHeight: 42, transition: { enter: "fade" } },
  );
}

/** Every action the popover answers to; the first listed is Enter. The per-row ones are hidden and reached by a click. */
export function actions(l: ReturnType<typeof listed>, st: PopoverState): Action[] {
  const rows = focusable(l, st);
  const cur = rows[Math.min(st.cursor, rows.length - 1)];
  const primary: Action = cur?.conference_url ? { id: "primary", title: "Join call" } : cur ? { id: "primary", title: st.google ? "Open in Google Calendar" : st.mac ? "Open in Calendar" : "Copy event details" } : { id: "open-calendar", title: st.google ? "Open Google Calendar" : "Open Calendar" };
  const out: Action[] = [primary];
  if (rows.some((e) => e.conference_url)) out.push({ id: "join-next", title: "Join the next call", shortcut: "j" });
  if (l.tomorrow.length) out.push({ id: "tomorrow", title: st.expanded ? "Fold tomorrow" : "Show tomorrow", shortcut: "t" });
  if (primary.id !== "open-calendar") out.push({ id: "open-calendar", title: st.google ? "Open Google Calendar" : "Open Calendar", shortcut: "o" });
  out.push({ id: "refresh", title: "Refresh", shortcut: "r" });
  if (cur) {
    out.push({ id: "copy", title: "Copy event details", shortcut: "cmd+c" });
    if (cur.conference_url) out.push({ id: "copy-link", title: "Copy conference link", shortcut: "cmd+shift+c" });
  }
  if (rows.length > 1) out.push({ id: "down", title: "Next row", shortcut: "down", hidden: true }, { id: "up", title: "Previous row", shortcut: "up", hidden: true });
  for (const e of rows) {
    out.push({ id: `focus:${rowId(e)}`, title: `Focus ${e.title || "(no title)"}`, hidden: true });
    if (e.conference_url) out.push({ id: `join:${rowId(e)}`, title: `Join ${e.title || "(no title)"}`, hidden: true });
  }
  return out;
}

/** The tree for `events` at `now`: pure, so the fixture and the tests draw the same popover the item does. `stale` is the error behind a cache kept past a failed fetch. */
export function popover(events: CalendarEvent[], now: number, hideDeclined: boolean, st: PopoverState, stale?: string): View {
  const l = listed(events, now, hideDeclined);
  const rows = focusable(l, st);
  const cursor = Math.max(0, Math.min(st.cursor, rows.length - 1));
  const kids: ViewNode[] = [];
  if (stale !== undefined) kids.push(row([{ type: "badge", text: "showing the last events read", color: "amber" }, text(stale, { size: "xs", color: "muted", width: 200 })], { key: "stale", gap: 2, minHeight: 20 }));
  // The day is the level's title; all-day events are a line of badges over the rows.
  if (l.allDay.length) kids.push(row([text("All day", { size: "xs", weight: "semibold", color: "muted", width: 48 }), ...l.allDay.map((e) => ({ type: "badge", key: rowId(e), text: e.title || "(no title)", color: "grey" }) as ViewNode)], { key: "all-day", gap: 1, minHeight: 22 }));
  if (l.today.length) kids.push(column(l.today.map((e, i) => eventRow(e, now, i === cursor, false)), { key: "today", gap: 0 }));
  else {
    const n = l.next;
    const when = n ? (startOfDay(n.start) === addDays(now, 1) ? `tomorrow ${clock(n.start)}` : `${dayName(n.start)} ${clock(n.start)}`) : undefined;
    kids.push(column([text(l.allDay.length ? "Nothing else today" : "Nothing today", { size: "lg", weight: "semibold", color: "muted" }), text(n ? `Next: ${n.title || "(no title)"}, ${when}` : "Nothing further in the days ahead", { size: "sm", color: "faint" })], { key: "clear", padding: 3, gap: 1, align: "center", surface: "sunken", radius: true }));
  }
  if (l.tomorrow.length) {
    const open = st.expanded;
    kids.push(row([text(open ? "▾" : "▸", { size: "xs", color: "faint", width: 12 }), text("Tomorrow", { size: "sm", weight: "semibold" }), text(`${l.tomorrow.length} ${l.tomorrow.length === 1 ? "event" : "events"} · ${dayName(addDays(now, 1))}`, { size: "xs", color: "muted" }), { type: "spacer" }, keycap("t")], { key: "tomorrow-head", gap: 1, padding: 2, radius: true, action: "tomorrow", minHeight: 28 }));
    if (open) kids.push(column(l.tomorrow.map((e, i) => eventRow(e, now, l.today.length + i === cursor, true)), { key: "tomorrow", gap: 0, transition: { enter: "fade" } }));
  }
  const hints: ViewNode[] = [];
  const cur = rows[cursor];
  if (cur) hints.push(...hint(["enter"], cur.conference_url ? "join" : "open"));
  if (rows.some((e) => e.conference_url)) hints.push(...hint(["j"], "next call"));
  if (l.tomorrow.length) hints.push(...hint(["t"], "tomorrow"));
  hints.push(...hint(["o"], "calendar"), ...hint(["r"], "refresh"), ...hint(["cmd+c"], "copy"));
  kids.push({ type: "divider", key: "hr" }, row(hints, { key: "hints", gap: 1, minHeight: 22 }));
  return { tree: column(kids, { key: "compact", padding: 3, gap: 2 }), actions: actions(l, st), title: `Today · ${dayName(now)}`, id: "upcoming", keys: "actions" };
}

/** The time range and the day, for a HUD: `Dentist, 15:30 – 16:15`. */
export const words = (e: CalendarEvent): string => `${e.title || "(no title)"}, ${timeRange(e)}`;
