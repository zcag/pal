// The bar popover as a tree (`View` in `@zcag/pal`), pure: index.ts builds
// the state from the CLI's files and the popover's own cursor, the fixture
// renders made-up states through the same function. One card per timer
// (most urgent first, as the CLI ranks them): the name and when it lands
// on the left, the time left large on the right, a thin bar under them in
// the strip's colour (blue, amber past two thirds, red past 90 %, grey
// while paused, red and full once landed). The card the keys act on wears
// the accent ring; a click on a card moves the ring there. A row of key
// hints closes the tree. With the field open (`n`, or at once with no
// timer) the search row is the field, the tree shows what to type and the
// last durations used as tiles that start one on a click. A pomodoro
// session (pomodoro.ts) marks its timer's card with the phase and the
// round; `p` starts one, `s` skips to the next phase.
import type { Action, TagColor, View, ViewNode } from "@zcag/pal";
import { phaseWord, type Session } from "./pomodoro.ts";

export type State = "running" | "paused" | "done";
export type Timer = { id: string; name: string; total: number; deadline: number; left: number; state: State; fired: number; auto: boolean };
/** What the popover draws: the timers, the card the keys are on, whether the field is open, the durations last used (for the tiles), the clock, the pomodoro session and today's finished rounds. */
export type PopoverState = { timers: Timer[]; cursor?: string; field: boolean; recent: string[]; now: number; pomodoro?: Pick<Session, "timerId" | "round" | "of" | "phase">; today?: number };

/** The popover's content width: 420 less the view's padding (3 steps a side). */
export const COMPACT_W = 396;
/** The card's inner width: less its own padding (3 steps a side). */
const CARD_W = COMPACT_W - 24;
/** The time-left column: `1:02:34` in xl tabular figures fits. */
const TIME_W = 92;
const NAME_W = CARD_W - TIME_W - 8;
/** Durations offered on the tiles until any were used. */
export const DEFAULT_RECENT = ["5m", "25m", "1h"];
export const MAX_RECENT = 4;

type Text = Extract<ViewNode, { type: "text" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;
const text = (value: string, extra: Partial<Text> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });
const keycap = (keys: string, action?: string): ViewNode => ({ type: "keycap", keys, ...(action && { action }) });
const hint = (keys: string[], what: string, action?: string): ViewNode[] => [...keys.map((k) => keycap(k, action)), text(what, { style: "muted", size: "xs" })];

/** 754 -> 12:34, 3754 -> 1:02:34, as the CLI prints it. */
export const fmt = (s: number): string => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

/** Seconds left as the CLI counts them: to the deadline, the frozen `left`, or none. */
export const secsLeft = (t: Timer, now: number) => (t.state === "running" ? Math.max(0, t.deadline - now) : t.state === "paused" ? t.left : 0);
/** How far along, 0..1; a landed timer is full. */
export const progressOf = (t: Timer, now: number) => (t.state === "done" ? 1 : t.total > 0 ? Math.min(1, Math.max(0, (t.total - secsLeft(t, now)) / t.total)) : 0);
/** The strip's colour rule, shared with the bar item: blue, amber past two thirds, red past 90 %, grey while paused, red once landed. */
export const colorOf = (t: Timer, now: number): TagColor => (t.state === "done" ? "red" : t.state === "paused" ? "grey" : progressOf(t, now) > 0.9 ? "red" : progressOf(t, now) > 0.66 ? "amber" : "blue");

const clock = (epoch: number) => new Date(epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The card the keys act on: the cursor's timer when it is still there, else the first. */
export const current = (st: PopoverState): Timer | undefined => st.timers.find((t) => t.id === st.cursor) ?? st.timers[0];

function card(t: Timer, st: PopoverState): ViewNode {
  const left = secsLeft(t, st.now);
  const color = colorOf(t, st.now);
  const selected = current(st)?.id === t.id;
  // Under the name: when it lands, how long ago it did (with a red tag), or a paused tag alone; the pomodoro's card leads with its phase.
  const p = st.pomodoro?.timerId === t.id ? st.pomodoro : undefined;
  const sub: ViewNode[] = t.state === "done"
    ? [text(`landed ${fmt(st.now - t.fired)} ago`, { style: "muted", size: "xs", key: "sub-done", transition: { enter: "fade", exit: "none" } }), { type: "badge", key: "done", text: "done", color: "red" }]
    : t.state === "paused" ? [{ type: "badge", key: "paused", text: "paused", color: "amber" }]
    : [text(`until ${clock(t.deadline)}`, { style: "muted", size: "xs", key: "sub-running", transition: { enter: "fade", exit: "none" } })];
  if (p) sub.unshift({ type: "badge", key: "phase", text: phaseWord(p.phase), color: p.phase === "work" ? "violet" : "green" });
  const big = t.state === "done" ? "0:00" : fmt(left);
  const kids: ViewNode[] = [
    row([
      column([
        text(t.name, { style: "title", width: NAME_W, key: "name" }),
        row(sub, { key: "subrow", gap: 1, minHeight: 18 }),
      ], { key: "titles", gap: 0, grow: true }),
      text(big, { style: "number", size: "xl", width: TIME_W, align: "end", color: t.state === "done" ? "destructive" : t.state === "paused" ? "muted" : undefined, key: "left" }),
    ], { key: "head", gap: 2, align: "center" }),
    { type: "progress", key: "bar", value: progressOf(t, st.now), color },
  ];
  return column(kids, { key: `t-${t.id}`, surface: "elevated", radius: true, padding: 3, gap: 2, action: `focus:${t.id}`, ...(selected && { selected: true }), transition: { enter: "fade", exit: "fade" } });
}

/** The durations on the tiles: the last used first, the defaults filling up behind them. */
export const tiles = (st: PopoverState): string[] => [...st.recent, ...DEFAULT_RECENT.filter((d) => !st.recent.includes(d))].slice(0, Math.max(MAX_RECENT, DEFAULT_RECENT.length));

/** With the field open: what to type, and the last durations as tiles that start one at once. */
function fieldHelp(st: PopoverState): ViewNode {
  const recent = tiles(st);
  return column([
    text("A duration, then a name: 25m tea, 90s, 1h30m, 2:30, or bare minutes", { style: "muted", size: "xs", key: "help", width: COMPACT_W - 8 }),
    row([text("Start", { style: "muted", size: "xs", width: 40, weight: "semibold" }), ...recent.map((d) => ({ type: "tile", key: `r-${d}`, width: 56, height: 28, text: d, color: "neutral", fill: "solid", action: `recent:${d}` }) as ViewNode)], { key: "recent", gap: 1, minHeight: 28 }),
  ], { key: "field", gap: 2, padding: 1 });
}

/** Two rows of key hints: the card's keys, then the popover's own (new, pomodoro or skip, all timers) with today's finished rounds at the far end. */
function hints(st: PopoverState): ViewNode[] {
  const t = current(st);
  // With the field open the bare keys type into it: only Enter and Escape apply.
  if (st.field) return [row([...hint(["enter"], "start", "start"), ...hint(["escape"], "close", "cancel")], { key: "hints", gap: 1, minHeight: 22 })];
  const card: ViewNode[] = [];
  if (t) {
    card.push(...hint(["space"], t.state === "done" ? "dismiss" : t.state === "paused" ? "resume" : "pause", "toggle"));
    if (t.state !== "done") card.push(...hint(["+"], "5 min", "add"));
    card.push(...hint(["backspace"], "stop", "stop"));
    if (st.timers.length > 1) card.push(...hint(["up", "down"], "pick"));
  }
  const own: ViewNode[] = [
    ...hint(["n"], "new", "new"),
    ...(st.pomodoro ? hint(["s"], "skip phase", "skip") : hint(["p"], "pomodoro", "pomodoro")),
    ...hint(["o"], "all timers", "open"),
    ...(st.today ? [{ type: "spacer" } as ViewNode, text(`${st.today} today`, { style: "muted", size: "xs", key: "today" })] : []),
  ];
  return [...(card.length ? [row(card, { key: "hints", gap: 1, minHeight: 22 })] : []), row(own, { key: "hints-own", gap: 1, minHeight: 22 })];
}

/** Every action the popover answers to; the first listed is Enter (Start while the field is open). */
export function actions(st: PopoverState): Action[] {
  const t = current(st);
  const acts: Action[] = [];
  if (st.field) acts.push({ id: "start", title: "Start" });
  if (t) {
    acts.push(t.state === "done" ? { id: "toggle", title: "Dismiss", shortcut: ["space", "d"] } : t.state === "paused" ? { id: "toggle", title: "Resume", shortcut: "space" } : { id: "toggle", title: "Pause", shortcut: "space" });
    if (t.state !== "done") acts.push({ id: "add", title: "Add 5 minutes", shortcut: ["+", "="] });
    acts.push({ id: "stop", title: "Stop", shortcut: "backspace", style: "destructive" });
  }
  if (!st.field) acts.push({ id: "new", title: "New timer", shortcut: "n" });
  if (!st.field) acts.push(...(st.pomodoro ? [{ id: "skip", title: "Skip to the next phase", shortcut: "s" }, { id: "stop-pomodoro", title: "Stop pomodoro", shortcut: "cmd+shift+d", style: "destructive" as const }] : [{ id: "pomodoro", title: "Start pomodoro", shortcut: "p" }]));
  acts.push({ id: "open", title: "All timers", shortcut: "o" });
  if (st.field) acts.push({ id: "cancel", title: "Close the field" });
  if (st.timers.length > 1) acts.push({ id: "up", title: "Previous timer", shortcut: "up", hidden: true }, { id: "down", title: "Next timer", shortcut: "down", hidden: true });
  for (const x of st.timers) acts.push({ id: `focus:${x.id}`, title: `Focus ${x.name}`, hidden: true });
  if (st.field) for (const d of tiles(st)) acts.push({ id: `recent:${d}`, title: `Start ${d}`, hidden: true });
  return acts;
}

export function render(st: PopoverState): View {
  const kids: ViewNode[] = st.timers.map((t) => card(t, st));
  if (!st.timers.length && !st.field) kids.push(text("No timers", { style: "muted", key: "none" }));
  if (st.field) kids.push(fieldHelp(st));
  kids.push(...hints(st));
  const tree = column(kids, { key: "popover", padding: 3, gap: 2 });
  const t = current(st);
  const title = st.field ? "New timer" : t ? `${st.timers.length} timer${st.timers.length === 1 ? "" : "s"}` : "Timers";
  return { tree, actions: actions(st), title, id: "timer", keys: "actions", ...(st.field && { input: { placeholder: "25m tea", submit: "start", cancel: "cancel" } }) };
}
