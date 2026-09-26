// Crossword: daily crosswords in the panel, Crosshare's English minis and the
// Turkish papers' kare bulmaca (HaberTürk, Cumhuriyet, Sabah). Enter on the
// row opens a view level whose body is the extension's own page (surface/):
// the grid, the clues, the clock. The page plays the solve with game.ts and
// hands every change here (`pal.send`), so the solve is on disk after each
// key and Escape anywhere loses nothing.
//
// This side is the puzzles and the record: it fetches only what is about to
// be played or listed and keeps it (sources.ts, cache.ts), keeps the solves
// and the log (store.ts), answers the page's lists (a source's month, a page
// of Crosshare's newest minis, a source's stats) and picks the next puzzle
// from the same source, which the page asks for early so it opens at once.
// The first open lands on the puzzle left half-done, else today's puzzle of
// the `source` setting.
//
// While that source's puzzle of the day is unsolved, and only for someone
// who has solved one before, a quiet row in the root's Now section is the
// way back in.
import { effects, now, settings, view, type Action, type Effect, type Extension, type Item as Row, type View, type ViewPalette } from "@zcag/pal";
import * as crosshare from "./crosshare.ts";
import { progressOf, type Puzzle, type Saved } from "./game.ts";
import { ORDER, SOURCES, next, sourceId, sourceOf, today, type Listed, type Source, type SourceId } from "./sources.ts";
import { isBest, ofSource, summary, type Solve, type Summary } from "./stats.ts";
import { load, save, type Data, type Meta } from "./store.ts";

const EXT = "crossword";
const PALETTE = "crossword";

type Config = { autocheck: boolean; suggest: boolean; source: SourceId };
const config = (): Config => {
  const c = { autocheck: false, suggest: true, ...settings.get<Partial<Config>>() };
  return { ...c, source: sourceId(c.source) };
};

// ---- what the page gets -------------------------------------------------------------

export type State = "solved" | "helped" | "started" | "new";
export type Opened = {
  puzzle: Puzzle;
  saved?: Saved;
  /** It is its source's puzzle of the day. */
  today: boolean;
  /** Its source's name, for the credit. */
  credit: string;
};
/** A puzzle as a list shows it. */
export type Entry = Listed & { state: State; ms?: number; filled?: number; total?: number; big?: boolean };
/** A puzzle that could not be opened: why, whose (`source`, the name), and what plays without the network. */
export type Offline = { error: string; source: string; opened: Entry[] };
/** `first` and `last`: the months the source has (YYYY-MM), for the calendar's arrows. */
export type MonthView = { source: SourceId; year: number; month: number; today: string; first: string; last: string; days: Entry[]; error?: string };
export type NewestView = { page: number; items: Entry[]; more: boolean; error?: string };
export type StatsView = Summary & { source: SourceId; history: (Solve & { state: State })[] };
export type SolvedReply = { best: boolean; first: boolean; stats: Summary };
/** The sources the page offers, in order, and the one it opens on. */
export type SourcesView = { sources: { id: SourceId; title: string; lang?: "tr"; archive: boolean }[]; source: SourceId };

function stateOf(d: Data, id: string): Pick<Entry, "state" | "ms" | "filled" | "total"> {
  const s = d.progress[id];
  if (!s) return { state: d.solves.some((x) => x.id === id) ? "solved" : "new" };
  const pr = progressOf(s);
  if (s.done) return { state: s.helped ? "helped" : "solved", ms: s.done.ms };
  return pr.filled ? { state: "started", filled: pr.filled, total: pr.total, ms: s.ms } : { state: "new" };
}
const entry = (d: Data, l: Listed): Entry => ({ ...l, ...stateOf(d, l.id), ...(SOURCES[l.source].fits?.(l) === false && { big: true }) });
/** Days a source listed but had no puzzle for (HaberTürk lists every day by its date): Next passes them by. */
const missing = new Set<string>();
const isMissing = (e: unknown) => /no .*puzzle|not found/i.test((e as Error).message);
/** Played means solved or started: Next never offers one of those, nor a day with no puzzle. */
const played = (d: Data) => (id: string) => missing.has(id) || stateOf(d, id).state !== "new";

// ---- opening a puzzle ----------------------------------------------------------------

/** A puzzle for the page, its meta noted and made the one the next open resumes. */
async function opened(d: Data, id: string, meta: { date?: string; slug?: string } = {}): Promise<Opened> {
  const src = sourceOf(id);
  const p = await src.puzzle(id, meta);
  d.meta[id] = { title: p.title, author: p.author, w: p.w, h: p.h, ...(p.date && { date: p.date }), ...(meta.slug && { slug: meta.slug }) };
  d.last = id;
  await save();
  return { puzzle: p, ...(d.progress[id] && { saved: d.progress[id] }), today: !!p.date && p.date === src.day(now()), credit: src.title };
}

async function byDate(d: Data, src: Source, date: string): Promise<Opened> {
  const days = await src.month(Number(date.slice(0, 4)), Number(date.slice(5, 7)), now());
  const l = days.find((x) => x.date === date);
  if (!l) throw new Error(`No ${src.title} puzzle for ${date}`);
  return opened(d, l.id, { date: l.date, slug: l.slug });
}

/** What the first open shows: the puzzle left half-done, else today's of the default source. */
async function first(d: Data): Promise<Opened> {
  const last = d.last && d.progress[d.last];
  if (d.last && last && !last.done && progressOf(last).filled) return opened(d, d.last, { date: d.meta[d.last]?.date, slug: d.meta[d.last]?.slug });
  const src = SOURCES[config().source];
  const t = await today(src, now());
  if (!t) throw new Error(`${src.title} has no puzzle listed`);
  try { return await opened(d, t.id, { date: t.date, slug: t.slug }); }
  catch (e) {
    // Today's not up yet (HaberTürk lists a day by its date): the latest day that has one, played or not.
    if (!isMissing(e)) throw e;
    missing.add(t.id);
    const earlier = (await src.month(Number(t.date!.slice(0, 4)), Number(t.date!.slice(5, 7)), now())).filter((l) => l.date! < t.date!).slice(0, 3);
    for (const l of earlier) {
      try { return await opened(d, l.id, { date: l.date, slug: l.slug }); }
      catch (e2) { if (!isMissing(e2)) throw e2; missing.add(l.id); }
    }
    throw e;
  }
}

/** Puzzles opened before, most recently touched first. */
function recent(d: Data, keep: (id: string) => boolean = () => true, limit = Infinity): Entry[] {
  const touched = (id: string) => d.progress[id]?.touched ?? 0;
  return Object.entries(d.meta).filter(([id]) => keep(id)).sort(([a], [b]) => touched(b) - touched(a)).slice(0, limit)
    .map(([id, m]: [string, Meta]) => entry(d, { id, source: sourceOf(id).id, title: m.title, author: m.author, w: m.w, h: m.h, ...(m.date && { date: m.date }), ...(m.slug && { slug: m.slug }) }));
}
/** What plays without the network: the last 30 opened. */
const openedBefore = (d: Data) => recent(d, undefined, 30);
/** Every puzzle left half-done, from any source: Browse's In progress. */
const inProgress = (d: Data) => recent(d, (id) => stateOf(d, id).state === "started");

const offline = (d: Data, e: unknown, src: Source): Offline => ({ error: (e as Error).message || String(e), source: src.title, opened: openedBefore(d) });

/** The next puzzle for each open one, looked up early (`prefetch`) so Next opens at once. */
const prefetched = new Map<string, Listed>();
async function nextAfter(d: Data, from?: string, source?: SourceId): Promise<Listed | undefined> {
  const early = from ? prefetched.get(from) : undefined;
  if (early && !played(d)(early.id)) return early;
  const src = from ? sourceOf(from) : SOURCES[source ?? config().source];
  const m = from ? d.meta[from] : undefined;
  return next(src, from ? { id: from, date: m?.date } : undefined, played(d), now());
}

// ---- the record -------------------------------------------------------------------------

const statsOf = (d: Data, source: SourceId) => summary(ofSource(d.solves, source), now(), SOURCES[source].day);

async function record(d: Data, id: string, s: Saved): Promise<SolvedReply> {
  const m = d.meta[id], source = sourceOf(id).id;
  const firstTime = !d.solves.some((x) => x.id === id);
  const solve: Solve = {
    id, title: m?.title ?? "", author: m?.author ?? "", at: now(), ms: s.done?.ms ?? s.ms,
    ...(source !== "crosshare" && { source }), ...(m?.date && { date: m.date }), ...(s.helped && { helped: true }), ...(s.checked && { checked: true }), ...(!firstTime && { replay: true }), ...(m && { size: `${m.w}×${m.h}` }),
  };
  d.solves.push(solve);
  await save();
  return { best: isBest(ofSource(d.solves, source), solve), first: firstTime, stats: statsOf(d, source) };
}

function statsView(d: Data, source: SourceId): StatsView {
  const history = ofSource(d.solves, source).slice(-60).reverse().map((s) => ({ ...s, state: (s.helped ? "helped" : "solved") as State }));
  return { ...statsOf(d, source), source, history };
}

// ---- the page's calls --------------------------------------------------------------------

type Msg =
  | { op: "open"; id?: string; date?: string; source?: string }
  | { op: "next"; from?: string; source?: string }
  | { op: "prefetch"; from: string }
  | { op: "save"; id: string; play: Saved }
  | { op: "solved"; id: string; play: Saved }
  | { op: "restart"; id: string }
  | { op: "month"; source?: string; year?: number; month?: number }
  | { op: "newest"; page?: number }
  | { op: "progress" }
  | { op: "stats"; source?: string }
  | { op: "sources" }
  | { op: "site"; id: string }
  | { op: "autocheck"; on: boolean };

export async function message(raw: unknown, ctx?: { args?: unknown }): Promise<unknown> {
  const m = raw as Msg;
  const d = await load();
  switch (m?.op) {
    case "open": {
      const args = ctx?.args as { date?: string; id?: string; source?: string } | undefined;
      // An id names the puzzle (its date, from a list, rides along); a date alone is that day's of the source.
      const id = m.id ?? (m.date ? undefined : args?.id), date = m.date ?? (id ? undefined : args?.date);
      const src = SOURCES[sourceId(m.source ?? args?.source ?? config().source)];
      try {
        return id ? await opened(d, id, { date: date ?? d.meta[id]?.date, slug: d.meta[id]?.slug }) : date ? await byDate(d, src, date) : await first(d);
      } catch (e) { return offline(d, e, id ? sourceOf(id) : src); }
    }
    case "next": {
      try {
        // A day listed without a puzzle is passed by: the next one after it.
        for (let k = 0; k < 8; k++) {
          const l = await nextAfter(d, m.from, m.source ? sourceId(m.source) : undefined);
          if (!l) return { none: true };
          try { return await opened(d, l.id, { date: l.date, slug: l.slug }); }
          catch (e) { if (!isMissing(e)) throw e; missing.add(l.id); }
        }
        return { none: true };
      } catch (e) { return offline(d, e, m.from ? sourceOf(m.from) : SOURCES[sourceId(m.source ?? config().source)]); }
    }
    case "prefetch": {
      // Quietly: the next puzzle found and its file fetched, so Next is instant.
      try {
        const l = await nextAfter(d, m.from);
        if (l) { prefetched.set(m.from, l); await SOURCES[l.source].puzzle(l.id, { date: l.date, slug: l.slug }).catch((e) => { if (isMissing(e)) { missing.add(l.id); prefetched.delete(m.from); } }); }
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
      const src = SOURCES[sourceId(m.source)], t = src.day(now());
      // Without a month asked for: the latest it has (today's, or an archive's last).
      const latest = src.last && src.last < t.slice(0, 7) ? src.last : t.slice(0, 7);
      const year = Number(m.year) || Number(latest.slice(0, 4)), month = Number(m.month) || Number(latest.slice(5, 7));
      const base = { source: src.id, year, month, today: t, first: src.first, last: src.last ?? t.slice(0, 7) };
      try { return { ...base, days: (await src.month(year, month, now())).map((l) => entry(d, l)) } satisfies MonthView; }
      catch (e) { return { ...base, days: [], error: (e as Error).message } satisfies MonthView; }
    }
    case "newest": {
      const page = Math.max(0, Math.min(9, Number(m.page) || 0));
      try { const r = await crosshare.newest(page, now()); return { page, items: r.items.map((l) => entry(d, l)), more: r.more && page < 9 } satisfies NewestView; }
      catch (e) { return { page, items: [], more: false, error: (e as Error).message } satisfies NewestView; }
    }
    case "progress": return inProgress(d);
    case "stats": return statsView(d, sourceId(m.source));
    case "sources": return { sources: ORDER.map((id) => ({ id, title: SOURCES[id].title, ...(SOURCES[id].lang && { lang: SOURCES[id].lang }), archive: !!SOURCES[id].last })), source: config().source } satisfies SourcesView;
    case "site": {
      if (!d.meta[m.id]) return null;
      const p = await sourceOf(m.id).puzzle(m.id, { date: d.meta[m.id].date, slug: d.meta[m.id].slug }).catch(() => undefined);
      if (p?.url) await effects.run({ open: p.url });
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
  { id: "clues", title: "Show every clue", shortcut: "cmd+l" },
  { id: "autocheck", title: c.autocheck ? "Turn autocheck off" : "Turn autocheck on" },
  { id: "pause", title: "Pause", shortcut: "cmd+p" },
  { id: "restart", title: "Start over" },
  { id: "site", title: "Open the puzzle's page", shortcut: "cmd+shift+o" },
  { id: "keys", title: "Every key" },
];

const screen = (): View => ({ title: "Crossword", tree: { type: "surface", src: "surface/index.html" }, actions: actions() });

/** The root's Now section: the default source's puzzle of the day while it is unsolved, for someone who has solved one before. */
async function suggest(): Promise<Row[]> {
  const c = config();
  if (!c.suggest) return [];
  const src = SOURCES[c.source];
  if (src.last) return []; // an archive has no puzzle of the day
  const d = await load();
  if (!d.solves.length) return [];
  const t = src.day(now());
  if (ofSource(d.solves, src.id).some((s) => s.date === t)) return [];
  const id = Object.keys(d.meta).find((k) => d.meta[k].date === t && sourceOf(k).id === src.id);
  if (id && d.progress[id]?.done) return [];
  const started = id && d.progress[id] && progressOf(d.progress[id]).filled > 0;
  const { streak } = statsOf(d, src.id);
  return [{
    id: "today", name: src.id === "crosshare" ? "Today's mini crossword" : `Today's ${src.title} kare bulmaca`,
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
  pick: (id): Effect | void => {
    if (id !== "today") return;
    const src = SOURCES[config().source];
    return { push: { extension: EXT, palette: PALETTE, args: { date: src.day(now()), source: src.id } } };
  },
  onMessage: message,
};

export default { palettes: { crossword } } satisfies Extension;
