// Sudoku: puzzles made here, never fetched. Enter on the row opens a view
// level whose body is the extension's own page (surface/): the board, the
// number pad, the clock. The page plays the game with game.ts and hands
// every move here (`pal.send`), so the game is on disk after each one and
// Escape anywhere loses nothing.
//
// This side makes the puzzles (sudoku.ts: a daily per difficulty, the same
// for a given day, and a new one whenever asked), keeps the games and the
// log (store.ts), and answers the page's lists: a difficulty's dailies by
// month, every half-done game, a difficulty's stats. The first open lands
// on the game left half-done, else today's daily of the `difficulty`
// setting.
import { isoDay, now, settings, view, type Action, type Extension, type View, type ViewPalette } from "@zcag/pal";
import { progressOf, type Saved } from "./game.ts";
import { isBest, ofDiff, summary, type Solve, type Summary } from "./stats.ts";
import { load, save, type Data, type Meta } from "./store.ts";
import { DIFFS, generate, isDiff, toText, type Diff } from "./sudoku.ts";

const EXT = "sudoku";

export type Check = "conflicts" | "mistakes";
type Config = { difficulty: Diff; check: Check; clock: boolean; auto_notes: boolean };
const config = (): Config => {
  const c = settings.get<Partial<Config>>();
  return { difficulty: isDiff(c.difficulty) ? c.difficulty : "medium", check: c.check === "mistakes" ? "mistakes" : "conflicts", clock: c.clock !== false, auto_notes: c.auto_notes === true };
};

// ---- what the page gets ---------------------------------------------------------------

export type State = "solved" | "helped" | "started" | "new";
export type Opened = {
  id: string;
  diff: Diff;
  givens: string;
  /** The day, for a daily. */
  date?: string;
  /** It is today's daily. */
  today: boolean;
  saved?: Saved;
};
/** A puzzle as a list shows it. */
export type Entry = { id: string; diff: Diff; date?: string; state: State; ms?: number; filled?: number; total?: number };
/** A difficulty's dailies for a month; `first` the earliest month there is (YYYY-MM). */
export type MonthView = { diff: Diff; year: number; month: number; today: string; first: string; days: Entry[] };
export type StatsView = Summary & { diff: Diff; history: (Solve & { state: State })[] };
export type SolvedReply = { best: boolean; first: boolean; stats: Summary; next?: Diff };
/** Today's daily of each difficulty: done, started or not. */
export type TodayView = { today: string; days: Record<Diff, State> };

/** The earliest month the dailies go back to. */
const FIRST = "2025-01";

const dailyId = (date: string, diff: Diff) => `daily:${date}:${diff}`;
const today = () => isoDay(now());

function stateOf(d: Data, id: string): Pick<Entry, "state" | "ms" | "filled" | "total"> {
  const s = d.progress[id], m = d.meta[id];
  if (!s || !m) return { state: d.solves.some((x) => x.id === id) ? "solved" : "new" };
  if (s.done) return { state: s.hints ? "helped" : "solved", ms: s.done.ms };
  const pr = progressOf(s, m.givens);
  return pr.started ? { state: "started", filled: pr.filled, total: pr.total, ms: s.ms } : { state: "new" };
}
const entry = (d: Data, id: string, m: Pick<Meta, "diff" | "date">): Entry => ({ id, diff: m.diff, ...(m.date && { date: m.date }), ...stateOf(d, id) });

// ---- making and opening puzzles ------------------------------------------------------------

/** Between tries, a turn of the event loop, so a long search never holds the host. */
const pause = () => new Promise<void>((res) => setImmediate(res));

/** The puzzle behind an id: kept once made (a daily is made from its date, so it is the same anywhere). */
async function puzzle(d: Data, id: string): Promise<Meta | undefined> {
  if (d.meta[id]) return d.meta[id];
  const [kind, key, diff] = id.split(":");
  if (!isDiff(diff) || !/^(daily|new)$/.test(kind) || !key) return undefined;
  const made = await generate(`${kind}:${key}`, diff, pause);
  d.meta[id] = { diff, givens: toText(made.givens), ...(kind === "daily" && { date: key }) };
  return d.meta[id];
}

async function opened(d: Data, id: string): Promise<Opened | null> {
  const m = await puzzle(d, id);
  if (!m) return null;
  d.last = id;
  await save();
  return { id, diff: m.diff, givens: m.givens, ...(m.date && { date: m.date }), today: m.date === today(), ...(d.progress[id] && { saved: d.progress[id] }) };
}

/** A new puzzle's id: a fresh seed. */
const freshId = (diff: Diff) => `new:${now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}:${diff}`;

/** The first open: the game left half-done, else today's daily of the setting's difficulty. */
async function first(d: Data): Promise<Opened | null> {
  const last = d.last && d.progress[d.last];
  if (d.last && last && !last.done && d.meta[d.last] && progressOf(last, d.meta[d.last].givens).started) return opened(d, d.last);
  return opened(d, dailyId(today(), config().difficulty));
}

/** Every game left half-done, the last played first. */
const inProgress = (d: Data): Entry[] => Object.entries(d.meta)
  .filter(([id]) => stateOf(d, id).state === "started")
  .sort(([a], [b]) => (d.progress[b]?.touched ?? 0) - (d.progress[a]?.touched ?? 0))
  .map(([id, m]) => entry(d, id, m));

function todayView(d: Data): TodayView {
  const t = today();
  return { today: t, days: Object.fromEntries(DIFFS.map((x) => [x, stateOf(d, dailyId(t, x)).state])) as Record<Diff, State> };
}

/** New puzzles never played are not worth keeping. */
function prune(d: Data) {
  for (const id of Object.keys(d.meta)) if (id.startsWith("new:") && id !== d.last && !d.progress[id] && !d.solves.some((s) => s.id === id)) delete d.meta[id];
}

// ---- the record --------------------------------------------------------------------------

const statsOf = (d: Data, diff: Diff) => summary(ofDiff(d.solves, diff), now());

async function record(d: Data, id: string, s: Saved): Promise<SolvedReply> {
  const m = d.meta[id];
  const firstTime = !d.solves.some((x) => x.id === id);
  const solve: Solve = {
    id, diff: m.diff, at: now(), ms: s.done?.ms ?? s.ms,
    ...(m.date && { date: m.date }), ...(s.hints && { hints: s.hints }), ...(s.mistakes && { mistakes: s.mistakes }), ...(!firstTime && { replay: true }),
  };
  d.solves.push(solve);
  await save();
  // What to play next: today's next unsolved daily, the harder ones first.
  const t = todayView(d), at = DIFFS.indexOf(m.diff);
  const next = [...DIFFS.slice(at + 1), ...DIFFS.slice(0, at)].find((x) => t.days[x] !== "solved" && t.days[x] !== "helped");
  return { best: isBest(ofDiff(d.solves, m.diff), solve), first: firstTime, stats: statsOf(d, m.diff), ...(next && { next }) };
}

function statsView(d: Data, diff: Diff): StatsView {
  const history = ofDiff(d.solves, diff).slice(-60).reverse().map((s) => ({ ...s, state: (s.hints ? "helped" : "solved") as State }));
  return { ...statsOf(d, diff), diff, history };
}

// ---- the page's calls ------------------------------------------------------------------------

type Msg =
  | { op: "open"; id?: string; date?: string; diff?: string }
  | { op: "new"; diff?: string }
  | { op: "save"; id: string; play: Saved }
  | { op: "solved"; id: string; play: Saved }
  | { op: "restart"; id: string }
  | { op: "month"; diff?: string; year?: number; month?: number }
  | { op: "progress" }
  | { op: "today" }
  | { op: "stats"; diff?: string }
  | { op: "check"; mode: Check }
  | { op: "clock"; on: boolean }
  | { op: "auto"; on: boolean };

export async function message(raw: unknown, ctx?: { args?: unknown }): Promise<unknown> {
  const m = raw as Msg;
  const d = await load();
  const diffOr = (x: unknown) => (isDiff(x) ? x : config().difficulty);
  switch (m?.op) {
    case "open": {
      const args = ctx?.args as { id?: string; date?: string; diff?: string } | undefined;
      const id = m.id ?? args?.id, date = m.date ?? args?.date;
      if (id) return opened(d, id);
      if (date && /^\d{4}-\d\d-\d\d$/.test(date) && date <= today()) return opened(d, dailyId(date, diffOr(m.diff ?? args?.diff)));
      prune(d);
      return first(d);
    }
    case "new": return opened(d, freshId(diffOr(m.diff)));
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
      const diff = diffOr(m.diff), t = today();
      const year = Number(m.year) || Number(t.slice(0, 4)), month = Number(m.month) || Number(t.slice(5, 7));
      const days: Entry[] = [];
      for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day++) {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (date > t) break;
        days.push(entry(d, dailyId(date, diff), { diff, date }));
      }
      return { diff, year, month, today: t, first: FIRST, days } satisfies MonthView;
    }
    case "progress": return inProgress(d);
    case "today": return todayView(d);
    case "stats": return statsView(d, diffOr(m.diff));
    case "check":
      await settings.set("check", m.mode === "mistakes" ? "mistakes" : "conflicts", EXT);
      await view.update(screen()).catch(() => {});
      return { check: config().check };
    case "clock":
      await settings.set("clock", !!m.on, EXT);
      await view.update(screen()).catch(() => {});
      return { clock: config().clock };
    case "auto":
      await settings.set("auto_notes", !!m.on, EXT);
      await view.update(screen()).catch(() => {});
      return { auto: config().auto_notes };
    default: throw new Error(`sudoku: unknown call ${JSON.stringify(raw)}`);
  }
}

// ---- the view -----------------------------------------------------------------------------------

/** ⌘K on the level: each goes to the page (`pal.onAction`), which has the game; the page also takes the keys itself. */
export const actions = (c = config()): Action[] => [
  { id: "hint", title: "Hint", shortcut: "i" },
  { id: "notes", title: "Pencil marks on or off", shortcut: "n" },
  { id: "auto", title: c.auto_notes ? "Turn auto notes off" : "Auto notes: every cell's notes kept for you", shortcut: "c" },
  { id: "pick", title: "Digit first: pick a digit, then click cells", shortcut: "d" },
  { id: "fill", title: "Fill in every pencil mark", shortcut: "a" },
  { id: "clear-notes", title: "Clear every pencil mark", shortcut: "shift+a" },
  { id: "undo", title: "Undo", shortcut: "cmd+z" },
  { id: "redo", title: "Redo", shortcut: "cmd+shift+z" },
  { id: "play", title: "New game or today's puzzle", shortcut: "cmd+n" },
  { id: "browse", title: "Browse the dailies", shortcut: "cmd+o" },
  { id: "stats", title: "Stats", shortcut: "cmd+s" },
  { id: "check", title: c.check === "mistakes" ? "Show only clashes, not mistakes" : "Show mistakes as you make them" },
  { id: "pause", title: "Pause", shortcut: "cmd+p" },
  { id: "clock", title: c.clock ? "Hide the clock" : "Show the clock", shortcut: "t" },
  { id: "restart", title: "Start over" },
  { id: "keys", title: "Every key" },
];

const screen = (): View => ({ title: "Sudoku", tree: { type: "surface", src: "surface/index.html" }, actions: actions() });

const sudoku: ViewPalette = {
  title: "Sudoku",
  view: () => screen(),
  pick: () => {},
  onMessage: message,
};

export default { palettes: { sudoku } } satisfies Extension;
