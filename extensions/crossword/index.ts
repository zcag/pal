// Crossword: Crosshare's mini crosswords in the panel. Enter on the row opens
// a view level whose body is the extension's own page (surface/): the grid,
// the clues, the clock. The page plays the solve with game.ts and hands
// every change here (`pal.send`), so the solve is on disk after each key
// and Escape anywhere loses nothing.
//
// This side is the puzzles and the record: it fetches from Crosshare only
// what is about to be played or listed and keeps it (crosshare.ts), keeps
// the solves and the log (store.ts), answers the page's lists (a month of
// daily minis, a page of the newest minis, the stats) and picks the next
// puzzle, which the page asks for early so it opens at once. The first
// open lands on the puzzle left half-done, else today's daily mini.
//
// While today's mini is unsolved, and only for someone who has solved one
// before, a quiet row in the root's Now section is the way back in.
import { effects, now, settings, view, type Action, type Effect, type Extension, type Item as Row, type View, type ViewPalette } from "@zcag/pal";
import * as crosshare from "./crosshare.ts";
import { progressOf, type Puzzle, type Saved } from "./game.ts";
import { isBest, summary, utcDay, type Solve, type Summary } from "./stats.ts";
import { load, save, type Data, type Meta } from "./store.ts";

const EXT = "crossword";
const PALETTE = "crossword";

type Config = { autocheck: boolean; suggest: boolean };
const config = (): Config => ({ autocheck: false, suggest: true, ...settings.get<Partial<Config>>() });

// ---- what the page gets -------------------------------------------------------------

export type State = "solved" | "helped" | "started" | "new";
export type Opened = {
  puzzle: Puzzle & { slug?: string; url: string };
  saved?: Saved;
  /** It is today's daily mini. */
  today: boolean;
};
/** A puzzle as a list shows it. */
export type Entry = crosshare.Listed & { state: State; ms?: number; filled?: number; total?: number; big?: boolean };
export type Offline = { error: string; opened: Entry[] };
export type MonthView = { year: number; month: number; today: string; days: Entry[]; error?: string };
export type NewestView = { page: number; items: Entry[]; more: boolean; error?: string };
export type StatsView = Summary & { history: (Solve & { state: State })[] };
export type SolvedReply = { best: boolean; first: boolean; stats: Summary };

function stateOf(d: Data, id: string): Pick<Entry, "state" | "ms" | "filled" | "total"> {
  const s = d.progress[id];
  if (!s) return { state: d.solves.some((x) => x.id === id) ? "solved" : "new" };
  const pr = progressOf(s);
  if (s.done) return { state: s.helped ? "helped" : "solved", ms: s.done.ms };
  return pr.filled ? { state: "started", filled: pr.filled, total: pr.total, ms: s.ms } : { state: "new" };
}
const entry = (d: Data, l: crosshare.Listed): Entry => ({ ...l, ...stateOf(d, l.id), ...(!crosshare.small(l) && { big: true }) });
/** Played means solved or started: Next never offers one of those. */
const played = (d: Data) => (id: string) => stateOf(d, id).state !== "new";

// ---- opening a puzzle ----------------------------------------------------------------

/** A puzzle for the page, its meta noted and made the one the next open resumes. */
async function opened(d: Data, id: string, meta: { date?: string; slug?: string } = {}): Promise<Opened> {
  const p = await crosshare.puzzle(id, meta);
  d.meta[id] = { title: p.title, author: p.author, w: p.w, h: p.h, ...(p.date && { date: p.date }) };
  d.last = id;
  await save();
  return { puzzle: { ...p, url: crosshare.pageUrl(id, p.slug) }, ...(d.progress[id] && { saved: d.progress[id] }), today: !!p.date && p.date === utcDay(now()) };
}

async function byDate(d: Data, date: string): Promise<Opened> {
  const days = await crosshare.month(Number(date.slice(0, 4)), Number(date.slice(5, 7)), now());
  const l = days.find((x) => x.date === date);
  if (!l) throw new Error(`No daily mini for ${date}`);
  return opened(d, l.id, { date: l.date, slug: l.slug });
}

/** What the first open shows: the puzzle left half-done, else today's daily mini. */
async function first(d: Data): Promise<Opened> {
  const last = d.last && d.progress[d.last];
  if (d.last && last && !last.done && progressOf(last).filled) return opened(d, d.last);
  const t = await crosshare.today(now());
  if (!t) throw new Error("Crosshare has no daily mini listed");
  return opened(d, t.id, { date: t.date, slug: t.slug });
}

/** The puzzles opened before, most recently touched first: what plays without the network. */
function openedBefore(d: Data): Entry[] {
  const touched = (id: string) => d.progress[id]?.touched ?? 0;
  return Object.entries(d.meta).sort(([a], [b]) => touched(b) - touched(a)).slice(0, 30)
    .map(([id, m]: [string, Meta]) => entry(d, { id, title: m.title, author: m.author, w: m.w, h: m.h, ...(m.date && { date: m.date }) }));
}

const offline = (d: Data, e: unknown): Offline => ({ error: (e as Error).message || String(e), opened: openedBefore(d) });

/** The next puzzle for each open one, looked up early (`prefetch`) so Next opens at once. */
const prefetched = new Map<string, crosshare.Listed>();
async function nextAfter(d: Data, from?: string): Promise<crosshare.Listed | undefined> {
  const early = from ? prefetched.get(from) : undefined;
  if (early && !played(d)(early.id)) return early;
  const m = from ? d.meta[from] : undefined;
  return crosshare.next(from ? { id: from, date: m?.date } : undefined, played(d), now());
}

// ---- the record -------------------------------------------------------------------------

async function record(d: Data, id: string, s: Saved): Promise<SolvedReply> {
  const m = d.meta[id];
  const firstTime = !d.solves.some((x) => x.id === id);
  const solve: Solve = {
    id, title: m?.title ?? "", author: m?.author ?? "", at: now(), ms: s.done?.ms ?? s.ms,
    ...(m?.date && { date: m.date }), ...(s.helped && { helped: true }), ...(s.checked && { checked: true }), ...(!firstTime && { replay: true }), ...(m && { size: `${m.w}×${m.h}` }),
  };
  d.solves.push(solve);
  await save();
  return { best: isBest(d.solves, solve), first: firstTime, stats: summary(d.solves, now()) };
}

function statsView(d: Data): StatsView {
  const history = d.solves.slice(-60).reverse().map((s) => ({ ...s, state: (s.helped ? "helped" : "solved") as State }));
  return { ...summary(d.solves, now()), history };
}

// ---- the page's calls --------------------------------------------------------------------

type Msg =
  | { op: "open"; id?: string; date?: string }
  | { op: "next"; from?: string }
  | { op: "prefetch"; from: string }
  | { op: "save"; id: string; play: Saved }
  | { op: "solved"; id: string; play: Saved }
  | { op: "restart"; id: string }
  | { op: "month"; year?: number; month?: number }
  | { op: "newest"; page?: number }
  | { op: "stats" }
  | { op: "site"; id: string }
  | { op: "autocheck"; on: boolean };

export async function message(raw: unknown, ctx?: { args?: unknown }): Promise<unknown> {
  const m = raw as Msg;
  const d = await load();
  switch (m?.op) {
    case "open": {
      const args = ctx?.args as { date?: string; id?: string } | undefined;
      const date = m.date ?? (m.id ? undefined : args?.date), id = m.id ?? (date ? undefined : args?.id);
      try {
        return date ? await byDate(d, date) : id ? await opened(d, id, d.meta[id]?.date ? { date: d.meta[id].date } : {}) : await first(d);
      } catch (e) { return offline(d, e); }
    }
    case "next": {
      try {
        const l = await nextAfter(d, m.from);
        return l ? await opened(d, l.id, { date: l.date, slug: l.slug }) : { none: true };
      } catch (e) { return offline(d, e); }
    }
    case "prefetch": {
      // Quietly: the next puzzle found and its file fetched, so Next is instant.
      try {
        const l = await nextAfter(d, m.from);
        if (l) { prefetched.set(m.from, l); await crosshare.puzzle(l.id, { date: l.date, slug: l.slug }); }
      } catch { /* the page does not wait on this */ }
      return null;
    }
    case "save":
      if (!d.meta[m.id]) return null;
      d.progress[m.id] = { ...m.play, touched: now() };
      await save();
      return null;
    case "solved":
      if (!d.meta[m.id] || !m.play?.done) return null;
      d.progress[m.id] = { ...m.play, touched: now() };
      return record(d, m.id, m.play);
    case "restart":
      delete d.progress[m.id];
      await save();
      return null;
    case "month": {
      const t = utcDay(now());
      const year = Number(m.year) || Number(t.slice(0, 4)), month = Number(m.month) || Number(t.slice(5, 7));
      try { return { year, month, today: t, days: (await crosshare.month(year, month, now())).map((l) => entry(d, l)) } satisfies MonthView; }
      catch (e) { return { year, month, today: t, days: [], error: (e as Error).message } satisfies MonthView; }
    }
    case "newest": {
      const page = Math.max(0, Math.min(9, Number(m.page) || 0));
      try { const r = await crosshare.newest(page, now()); return { page, items: r.items.map((l) => entry(d, l)), more: r.more && page < 9 } satisfies NewestView; }
      catch (e) { return { page, items: [], more: false, error: (e as Error).message } satisfies NewestView; }
    }
    case "stats": return statsView(d);
    case "site": {
      const meta = d.meta[m.id];
      if (meta) await effects.run({ open: crosshare.pageUrl(m.id) });
      return null;
    }
    case "autocheck":
      await settings.set("autocheck", !!m.on, EXT);
      await view.update(screen()).catch(() => {});
      return { autocheck: !!m.on };
    default: throw new Error(`crossword: unknown call ${JSON.stringify(raw)}`);
  }
}

// ---- the view -------------------------------------------------------------------------------

/** ⌘K on the level: each goes to the page (`pal.onAction`), which has the solve; the page also takes the keys itself. */
export const actions = (c = config()): Action[] => [
  { id: "next", title: "Next puzzle", shortcut: "cmd+n" },
  { id: "browse", title: "Browse puzzles", shortcut: "cmd+o" },
  { id: "stats", title: "Stats", shortcut: "cmd+s" },
  { id: "check-word", title: "Check word", shortcut: "cmd+e" },
  { id: "check-square", title: "Check square", shortcut: "cmd+alt+e" },
  { id: "check-puzzle", title: "Check puzzle", shortcut: "cmd+shift+e" },
  { id: "reveal-square", title: "Reveal square", shortcut: "cmd+alt+u" },
  { id: "reveal-word", title: "Reveal word", shortcut: "cmd+u" },
  { id: "reveal-puzzle", title: "Reveal puzzle", shortcut: "cmd+shift+u" },
  { id: "clear-word", title: "Clear word", shortcut: "alt+backspace" },
  { id: "clear-puzzle", title: "Clear puzzle", shortcut: "cmd+alt+backspace" },
  { id: "autocheck", title: c.autocheck ? "Turn autocheck off" : "Turn autocheck on" },
  { id: "pause", title: "Pause", shortcut: "cmd+p" },
  { id: "restart", title: "Start over" },
  { id: "site", title: "Open on crosshare.org", shortcut: "cmd+shift+o" },
  { id: "keys", title: "Every key" },
];

const screen = (): View => ({ title: "Crossword", tree: { type: "surface", src: "surface/index.html" }, actions: actions() });

/** The root's Now section: today's mini while it is unsolved, for someone who has solved one before. */
async function suggest(): Promise<Row[]> {
  if (!config().suggest) return [];
  const d = await load();
  if (!d.solves.length) return [];
  const t = utcDay(now());
  if (d.solves.some((s) => s.date === t)) return [];
  const id = Object.entries(d.meta).find(([, m]) => m.date === t)?.[0];
  if (id && d.progress[id]?.done) return [];
  const started = id && d.progress[id] && progressOf(d.progress[id]).filled > 0;
  const { streak } = summary(d.solves, now());
  return [{
    id: "today", name: "Today's mini crossword",
    subtitle: [started ? "In progress" : "Not solved yet", streak ? `${streak}-day streak` : ""].filter(Boolean).join(" · "),
    icon: { tile: { glyph: "\u{f0139}", bg: "amber" } }, section: "Now",
    actions: [{ id: "play", title: "Play" }],
  }];
}

const crossword: ViewPalette = {
  title: "Crossword",
  suggest,
  view: () => screen(),
  // The Now row's pick; the view's own actions go to the page.
  pick: (id): Effect | void => (id === "today" ? { push: { extension: EXT, palette: PALETTE, args: { date: utcDay(now()) } } } : undefined),
  onMessage: message,
};

export default { palettes: { crossword } } satisfies Extension;
