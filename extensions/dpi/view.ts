// The trees (`View` in `@zcag/pal`), pure: the bar popover (the status
// card with the facts, the test's rows once `t` ran it, the key hints)
// and the test level (a header summarising both halves, a row per url
// with its code, time and role, a cursor the arrows move). index.ts
// hands them the status and the run; the tests render made-up ones.
import { POPOVER_W, column, keyHint, row, text, type Action, type TagColor, type View, type ViewNode } from "@zcag/pal";
import { factLines, nextWord, summary as statusLine, type State, type Status } from "./status.ts";
import { codeColor, fmtMs, hostOf, summary as testSummary, type Result, type Run } from "./test.ts";

/** nf-md-shield_check (on), shield_half_full (partial), shield_outline (off, the empty shape), shield_off_outline (no tool). */
export const GLYPH: Record<State | "none", string> = { on: "\u{f0565}", partial: "\u{f0780}", off: "\u{f0499}", none: "\u{f099c}" };
export const STATE_COLOR: Record<State, TagColor> = { on: "green", partial: "amber", off: "grey" };
export const STATE_WORD: Record<State, string> = { on: "Bypass on", partial: "Bypass partly on", off: "Bypass off" };

/** What the popover draws: the status (`null` with `error` saying why there is none), a test run when `t` started one, and whether this is a Mac (the log key). */
export type PopoverState = { status: Status | null; error?: string; test?: Run; mac: boolean };
/** What the test level draws: the run and the row the keys are on. */
export type TestState = { run: Run; cursor: number };

const OUTER_PAD = 12, CARD_PAD = 12, GLYPH_W = 24, LABEL_W = 64, TIME_W = 44;
const INNER_W = POPOVER_W - 2 * OUTER_PAD;
const CARD_W = INNER_W - 2 * CARD_PAD;

/** The glyph in the state's colour (the theme's ink while off). */
const shield = (state: State | "none", size: "sm" | "lg", key: string): ViewNode => text(GLYPH[state], { style: "glyph", size, key, width: GLYPH_W, ...(state === "on" || state === "partial" ? { color: STATE_COLOR[state] } : { color: "muted" }) });

function card(st: Status): ViewNode {
  const facts = factLines(st).map(([label, value]) => row([text(label, { style: "muted", size: "xs", width: LABEL_W, key: "l" }), text(value, { style: "mono", size: "xs", key: `v-${value}`, minWidth: 0, transition: { enter: "fade", exit: "none" } })], { key: `f-${label}`, gap: 2, minHeight: 18 }));
  return column([
    row([
      shield(st.state, "lg", "glyph"),
      column([text(STATE_WORD[st.state], { style: "title", key: "title", width: CARD_W - GLYPH_W - 8 }), text(statusLine(st), { style: "muted", size: "xs", key: `sub-${st.state}`, width: CARD_W - GLYPH_W - 8, transition: { enter: "fade", exit: "none" } })], { key: "titles", gap: 0, grow: true }),
    ], { key: "head", gap: 2, align: "center" }),
    column(facts, { key: "facts", gap: 0 }),
  ], { key: "card", surface: "elevated", radius: true, padding: 3, gap: 2 });
}

/** One url's row: the host, the role, the code as a badge in its colour (grey and `…` while pending), the time. In the popover the url is the host alone; the level has room for the whole url under it. */
export function resultRow(r: Result, i: number, o: { focused?: boolean; action?: string; compact?: boolean }): ViewNode {
  const name = o.compact ? [text(hostOf(r.url), { size: "sm", weight: o.focused ? "semibold" : "medium", minWidth: 0 })] : [text(hostOf(r.url), { size: "md", weight: o.focused ? "semibold" : "medium", minWidth: 0 }), text(r.url, { size: "xs", color: "muted", style: "mono", minWidth: 0 })];
  return row([
    column(name, { key: "t", gap: 0, grow: true }),
    { type: "badge", key: "role", text: r.role, color: r.role === "blocked" ? "violet" : "teal" },
    { type: "badge", key: `code-${r.code ?? "pending"}`, text: r.code ?? "…", color: codeColor(r.code), transition: { enter: "pop", exit: "none" } },
    text(r.ms === undefined ? "" : fmtMs(r.ms), { style: "mono", size: "xs", color: "muted", width: TIME_W, align: "end", key: `ms-${r.ms ?? "p"}` }),
  ], { key: `r-${i}`, gap: 2, padding: 1, minHeight: o.compact ? 26 : 40, radius: true, ...(o.action && { action: o.action }), ...(o.focused && { selected: true }), transition: { enter: "fade", exit: "fade" } });
}

/** The header: the summary badge and where the requests went. */
function header(run: Run, key: string): ViewNode {
  const s = testSummary(run.results);
  return row([
    { type: "badge", key: `s-${s.text}`, text: s.text, color: s.color, transition: { enter: "fade", exit: "none" } },
    { type: "spacer" },
    text(run.proxy ? `via socks5://${run.proxy}` : "direct", { style: "muted", size: "xs", key: "via" }),
  ], { key, gap: 2, minHeight: 22 });
}

function popoverHints(st: PopoverState): ViewNode {
  if (!st.status) return row([{ type: "spacer" }, ...keyHint("o", "palette", { action: "open" })], { key: "hints", gap: 1, minHeight: 22 });
  return row([
    ...keyHint("enter", `turn ${nextWord(st.status.state)}`, { action: "toggle" }),
    ...(st.status.state === "partial" ? keyHint("r", "repair", { action: "repair" }) : []),
    ...keyHint("t", "test", { action: "test" }),
    ...keyHint("c", "copy", { action: "copy" }),
    ...(st.mac ? keyHint("l", "log", { action: "log" }) : []),
    { type: "spacer" },
    ...keyHint("o", "palette", { action: "open" }),
  ], { key: "hints", gap: 1, minHeight: 22 });
}

/** Every action the popover answers to; the first listed is Enter. */
export function popoverActions(st: PopoverState): Action[] {
  const acts: Action[] = [];
  if (st.status) {
    const word = nextWord(st.status.state);
    acts.push({ id: "toggle", title: `Turn ${word} bypass` });
    acts.push({ id: "test", title: st.test && !st.test.endedAt ? "Test again" : "Test the bypass", shortcut: "t" });
    acts.push({ id: "repair", title: "Repair: off, then on", shortcut: "r" });
    acts.push({ id: "copy", title: "Copy the status", shortcut: "c" });
    if (st.mac) acts.push({ id: "log", title: "Open the log", shortcut: "l" });
  }
  acts.push({ id: "open", title: "Open the DPI Bypass palette", shortcut: "o" });
  return acts;
}

/** The bar popover: the card, the test's rows while a run is up, the hints. Without a status, the reason and the way to the palette. */
export function renderPopover(st: PopoverState): View {
  const kids: ViewNode[] = [];
  if (st.status) kids.push(card(st.status));
  else kids.push(row([shield("none", "sm", "g"), text(st.error ?? "dpi is not installed", { style: "muted", key: "none", width: INNER_W - GLYPH_W - 8 })], { key: "off", gap: 1, align: "center", minHeight: 24 }));
  if (st.test) kids.push(column([header(st.test, "th"), ...st.test.results.map((r, i) => resultRow(r, i, { compact: true }))], { key: "test", gap: 0 }));
  kids.push(popoverHints(st));
  const title = st.status ? STATE_WORD[st.status.state] : "DPI Bypass";
  return { tree: column(kids, { key: "popover", padding: 3, gap: 2 }), actions: popoverActions(st), title, id: "bypass", keys: "actions" };
}

function testHints(): ViewNode {
  return row([
    ...keyHint("enter", "open", { action: "open" }),
    ...keyHint("c", "copy line", { action: "copy" }),
    ...keyHint("cmd+c", "copy all", { action: "copy-all" }),
    ...keyHint("cmd+r", "run again", { action: "rerun" }),
    { type: "spacer" },
    ...keyHint(["up", "down"], "move"),
  ], { key: "hints", gap: 1, minHeight: 22 });
}

/** Every action the test level answers to; the first listed is Enter. */
export function testActions(st: TestState): Action[] {
  const cur = st.run.results[st.cursor];
  return [
    { id: "open", title: cur ? `Open ${hostOf(cur.url)}` : "Open" },
    { id: "copy", title: "Copy the line", shortcut: "c" },
    { id: "copy-all", title: "Copy the report", shortcut: "cmd+c" },
    { id: "rerun", title: "Run the test again", shortcut: "cmd+r" },
    { id: "down", title: "Next", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous", shortcut: ["up", "k"], hidden: true },
    ...st.run.results.map((r, i): Action => ({ id: `focus:${i}`, title: `Focus ${hostOf(r.url)}`, hidden: true })),
  ];
}

/** The test level: the header, a row per url arriving as its curl lands, the hints. */
export function renderTest(st: TestState): View {
  const rows = st.run.results.map((r, i) => resultRow(r, i, { focused: i === st.cursor, action: `focus:${i}` }));
  const empty = st.run.results.length ? [] : [text("No urls to test: fill test_urls in Settings › Extensions › DPI Bypass", { style: "muted", key: "empty" })];
  const tree = column([header(st.run, "head"), ...empty, column(rows, { key: "rows", gap: 0 }), testHints()], { key: "test", padding: 3, gap: 2 });
  const s = testSummary(st.run.results);
  return { tree, actions: testActions(st), title: st.run.endedAt ? s.text : "Testing the bypass…", id: "test", keys: "actions" };
}
