// The Keep Awake bar popover as a tree (`View` in `@zcag/pal`), pure:
// index.ts builds the state from the run's record and the popover's own
// switches, the tests render made-up states through the same function.
// While a run is on: a card with what it is ("Awake until 14:30", "until
// turned off", "while Xcode runs"), the time left large on the right (or
// ∞), a bar for how far along it is. Under it the presets as tiles a
// click or a digit starts (a new end from now, on or off), the display
// switch (`d`: the run's, restarted with the other flag; the next run's
// while off), and the key hints. `u` opens the search row as a field for
// a duration or a time (`45m`, `14:30`, `forever`). Enter allows sleep
// while on and starts the default while off.
import { POPOVER_W, clock, column, keyHint as sdkKeyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";
import { fmtClock, summary, type Awake } from "./awake.ts";

/** What the popover draws: the run (or none), the clock, the presets as typed in the setting, the display switch, the default a bare Enter runs, whether the field is open, and whether the machine has the tool at all. */
export type PopoverState = { awake: Awake | null; now: number; presets: string[]; display: boolean; defaultFor: string; field: boolean; tool: boolean };

/** nf-md-coffee_outline, the row's glyph too; nf-md-monitor for the display. */
export const GLYPH = "\u{f06ca}";
export const DISPLAY_GLYPH = "\u{f0379}";
/** The popover's outer padding is 3 steps (12 px) a side; the card's another 3. */
const OUTER_PAD = 12, CARD_PAD = 12;
const INNER_W = POPOVER_W - 2 * OUTER_PAD;
const CARD_W = INNER_W - 2 * CARD_PAD;
/** The card's row: the glyph, the titles (what is left of the width), the time-left column (`12:40:12` in xl tabular figures fits), two gaps of 8 px. */
const GLYPH_W = 24, TIME_W = 104;
const TITLE_W = CARD_W - GLYPH_W - TIME_W - 2 * 8;
/** Five tiles of 56 beside a 64 px label with 4 px gaps is 364, inside the 372 the popover has. */
const TILE_W = 56, TILE_H = 28;
/** How many presets get a tile and a digit. */
export const MAX_PRESETS = 5;

const keyHint = (keys: string[], what: string, action?: string): ViewNode[] => sdkKeyHint(keys, what, { action });

/** A preset as the tile writes it: `forever` and its spellings as ∞, the rest as typed. */
export const presetLabel = (p: string): string => (/^(forever|inf|infinite|infinity|always|indefinitely|0|∞)$/i.test(p.trim()) ? "∞" : p.trim());

/** What Enter does while off: the default, said as the tile would. */
const defaultLabel = (s: PopoverState): string => (presetLabel(s.defaultFor) === "∞" ? "until turned off" : `for ${s.defaultFor}`);

function card(a: Awake, st: PopoverState): ViewNode {
  const left = a.until === null ? null : a.until - st.now;
  const title = a.app ? `Awake while ${a.app} runs` : a.until === null ? "Awake until turned off" : `Awake until ${clock(a.until)}`;
  const sub: ViewNode[] = [text(`since ${clock(a.started)}`, { style: "muted", size: "xs", key: "since" })];
  if (a.display) sub.push({ type: "badge", key: "display", text: "display too", color: "blue" });
  const kids: ViewNode[] = [
    row([
      text(GLYPH, { style: "glyph", size: "lg", key: "glyph", width: GLYPH_W }),
      column([
        text(title, { style: "title", width: TITLE_W, key: "title" }),
        row(sub, { key: "subrow", gap: 1, minHeight: 18 }),
      ], { key: "titles", gap: 0, grow: true }),
      text(left === null ? "∞" : fmtClock(left), { style: "number", size: "xl", width: TIME_W, align: "end", key: "left", ...(left !== null && left <= 60_000 && { color: "amber" as const }) }),
    ], { key: "head", gap: 2, align: "center" }),
  ];
  if (left !== null) kids.push({ type: "progress", key: "bar", value: Math.min(1, Math.max(0, (st.now - a.started) / Math.max(1, a.until! - a.started))), color: left <= 60_000 ? "amber" : "blue" });
  return column(kids, { key: "card", surface: "elevated", radius: true, padding: 3, gap: 2, transition: { enter: "fade", exit: "fade" } });
}

/** The presets as tiles: a click starts one (a new end from now, on or off), the digits do the same. */
function presets(st: PopoverState): ViewNode {
  const tiles = st.presets.slice(0, MAX_PRESETS).map((p, i) => ({ type: "tile", key: `p-${i}`, width: TILE_W, height: TILE_H, text: presetLabel(p), color: "neutral", fill: "solid", action: `preset:${i}` }) as ViewNode);
  return row([text(st.awake ? "Keep for" : "Awake for", { style: "muted", size: "xs", width: 64, weight: "semibold", key: "label" }), ...tiles], { key: "presets", gap: 1, minHeight: TILE_H });
}

/** The display switch: while on it restarts the run with the other flag; while off it is what the next run does. */
function displayRow(st: PopoverState): ViewNode {
  return row([
    text(DISPLAY_GLYPH, { style: "glyph", size: "sm", color: st.display ? undefined : "muted", key: "dg", width: 20 }),
    text(st.display ? "Display kept awake too" : "Display may sleep, the machine stays up", { style: "muted", size: "xs", key: "dt", width: INNER_W - 20 - 44 - 16 }),
    { type: "spacer" },
    { type: "switch", key: "display", on: st.display, action: "display", label: "Keep the display awake too" },
  ], { key: "display-row", gap: 1, align: "center", minHeight: 26 });
}

function hints(st: PopoverState): ViewNode {
  if (st.field) return row([...keyHint(["enter"], "start", "start"), ...keyHint(["escape"], "close", "cancel")], { key: "hints", gap: 1, minHeight: 22 });
  if (!st.tool) return row([{ type: "spacer" }, ...keyHint(["o"], "system", "open")], { key: "hints", gap: 1, minHeight: 22 });
  const n = Math.min(st.presets.length, MAX_PRESETS);
  return row([
    ...(st.awake ? keyHint(["enter"], "allow sleep", "sleep") : keyHint(["enter"], defaultLabel(st), "default")),
    ...(n ? keyHint([n > 1 ? `1…${n}` : "1"], "keep for") : []),
    ...keyHint(["d"], "display", "display"),
    ...keyHint(["u"], "until…", "until"),
    { type: "spacer" },
    ...keyHint(["o"], "system", "open"),
  ], { key: "hints", gap: 1, minHeight: 22 });
}

/** Every action the popover answers to; the first listed is Enter. */
export function actions(st: PopoverState): Action[] {
  const acts: Action[] = [];
  if (st.field) acts.push({ id: "start", title: "Keep awake" });
  else if (st.awake) acts.push({ id: "sleep", title: "Allow sleep", shortcut: "backspace" });
  else if (st.tool) acts.push({ id: "default", title: `Keep awake ${defaultLabel(st)}` });
  if (st.tool) {
    st.presets.slice(0, MAX_PRESETS).forEach((p, i) => acts.push({ id: `preset:${i}`, title: presetLabel(p) === "∞" ? "Keep awake until turned off" : `Keep awake for ${p.trim()}`, shortcut: String(i + 1) }));
    acts.push({ id: "display", title: st.display ? "Let the display sleep" : "Keep the display awake too", shortcut: "d" });
    if (!st.field) acts.push({ id: "until", title: "Until a time, or for a while…", shortcut: "u" });
    if (st.field) acts.push({ id: "cancel", title: "Close the field" });
  }
  acts.push({ id: "open", title: "System commands", shortcut: "o" });
  return acts;
}

export function render(st: PopoverState): View {
  const kids: ViewNode[] = [];
  if (!st.tool) kids.push(text("systemd-inhibit is not installed: keeping the machine awake needs systemd's inhibitor locks", { style: "muted", key: "none", width: INNER_W }));
  else if (st.awake) kids.push(card(st.awake, st));
  else kids.push(row([text(GLYPH, { style: "glyph", size: "sm", color: "muted", key: "g", width: 20 }), text("Not kept awake; the machine sleeps as usual", { style: "muted", key: "none", width: INNER_W - 24 })], { key: "off", gap: 1, align: "center", minHeight: 24 }));
  if (st.tool) {
    if (st.field) kids.push(text("A duration or a time: 45m, 2h, 14:30, 2pm, forever", { style: "muted", size: "xs", key: "help", width: INNER_W }));
    if (st.presets.length) kids.push(presets(st));
    kids.push(displayRow(st));
  }
  kids.push(hints(st));
  const tree = column(kids, { key: "popover", padding: 3, gap: 2 });
  const title = st.field ? "Keep awake for…" : st.awake ? summary(st.awake, st.now).replace(/^./, (c) => c.toUpperCase()) : "Keep Awake";
  return { tree, actions: actions(st), title, id: "awake", keys: "actions", ...(st.field && { input: { placeholder: "45m, 14:30, forever", submit: "start", cancel: "cancel" } }) };
}
