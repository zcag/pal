// The rules, pure: a `State` in, a `State` out, nothing else touched. The
// board is `w` by `h` cells, row-major. The mines are laid on the first
// open, never on the opened cell or its neighbours, so the first open is
// always safe and always opens an area. Opening a cell with no mine around
// opens its neighbours in turn (the flood); opening a number whose flags
// match it opens its other neighbours (the chord). The game is won when
// every safe cell is open (the mines left are flagged for you) and lost
// on the first mine opened. Every move is `apply(state, action, s, rng,
// now)`; a move the phase or the cell does not allow is a no-op, the same
// state back, which is what a key pressed a beat too late should be.
//
// The clock runs from the first open while the board is on screen: `since`
// is when the current run started, `ms` what the earlier runs added up to.
// The page (surface/main.ts) pauses it when the view leaves and resumes it
// when it is back, so time away is never counted; `seen` (the last move) is
// where a run the panel never closed (a crash, a quit) is cut off.
export type Level = "beginner" | "intermediate" | "expert";
export type Settings = { difficulty: Level };
export const DEFAULTS: Settings = { difficulty: "beginner" };

export const LEVELS: Record<Level, { title: string; w: number; h: number; mines: number }> = {
  beginner: { title: "Beginner", w: 9, h: 9, mines: 10 },
  intermediate: { title: "Intermediate", w: 16, h: 16, mines: 40 },
  expert: { title: "Expert", w: 30, h: 16, mines: 99 },
};
export const levelOf = (x: unknown): Level => (typeof x === "string" && x in LEVELS ? (x as Level) : DEFAULTS.difficulty);

export type Phase = "ready" | "play" | "won" | "lost";
export type Dir = "up" | "down" | "left" | "right";
export type Action = "open" | "flag" | Dir | "new";
export const DIRS: Dir[] = ["up", "down", "left", "right"];

export type Clock = { ms: number; since?: number; seen?: number };
/** Games finished at a level, and the fastest win in ms. */
export type Tally = { played: number; won: number; best?: number };

export type State = {
  level: Level;
  w: number;
  h: number;
  mines: number;
  /** Per cell; all false until the first open lays the mines. */
  mine: boolean[];
  open: boolean[];
  flag: boolean[];
  cursor: number;
  phase: Phase;
  /** The mine that went off. */
  hit?: number;
  clock: Clock;
  /** What the last open turned over, from where: the view ripples the reveal out from `at`. */
  last?: { at: number; opened: number[] };
  /** Counts up per board; keys one board's tiles apart from the last one's. */
  game: number;
  records: Record<Level, Tally>;
};

export type Rng = () => number;

const records0 = (): Record<Level, Tally> => ({ beginner: { played: 0, won: 0 }, intermediate: { played: 0, won: 0 }, expert: { played: 0, won: 0 } });

export function newGame(level: Level = DEFAULTS.difficulty, prev?: Pick<State, "records" | "game">): State {
  const { w, h, mines } = LEVELS[level];
  const n = w * h;
  const none = () => Array<boolean>(n).fill(false);
  return { level, w, h, mines, mine: none(), open: none(), flag: none(), cursor: Math.floor(h / 2) * w + Math.floor(w / 2), phase: "ready", clock: { ms: 0 }, game: (prev?.game ?? 0) + 1, records: prev?.records ?? records0() };
}

/** The up to eight cells around `i`. */
export function around(i: number, w: number, h: number): number[] {
  const r = Math.floor(i / w), c = i % w, out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if ((dr || dc) && rr >= 0 && rr < h && cc >= 0 && cc < w) out.push(rr * w + cc);
  }
  return out;
}

/** Mines around `i`: the number an open cell shows. */
export const count = (st: State, i: number): number => around(i, st.w, st.h).filter((j) => st.mine[j]).length;
export const flagsAround = (st: State, i: number): number => around(i, st.w, st.h).filter((j) => st.flag[j]).length;
/** The counter: mines less flags, below zero when there are too many flags. */
export const minesLeft = (st: State): number => st.mines - st.flag.filter(Boolean).length;
export const elapsed = (c: Clock, now: number): number => c.ms + (c.since === undefined ? 0 : Math.max(0, now - c.since));

/**
 * `mines` mines on cells picked uniformly, never on `safe` or around it;
 * on a board too full for that (never at the three levels), only `safe`
 * itself is spared.
 */
export function layMines(w: number, h: number, mines: number, safe: number, rng: Rng): boolean[] {
  const spared = new Set([safe, ...around(safe, w, h)]);
  let free = Array.from({ length: w * h }, (_, i) => i).filter((i) => !spared.has(i));
  if (free.length < mines) free = Array.from({ length: w * h }, (_, i) => i).filter((i) => i !== safe);
  const mine = Array<boolean>(w * h).fill(false);
  // A partial Fisher-Yates: the first `mines` places of a shuffle.
  for (let k = 0; k < Math.min(mines, free.length); k++) {
    const j = k + Math.min(free.length - k - 1, Math.floor(rng() * (free.length - k)));
    [free[k], free[j]] = [free[j], free[k]];
    mine[free[k]] = true;
  }
  return mine;
}

/** The cursor put on cell `i`, where a pointer clicked: a no-op off the board, on the cursor already, or once the game is over. */
export function pointAt(st: State, i: number): State {
  if (st.phase === "won" || st.phase === "lost" || !Number.isInteger(i) || i < 0 || i >= st.w * st.h || i === st.cursor) return st;
  return { ...st, cursor: i };
}

/** The difficulty setting on this board: a game in play keeps its level and plays out first, any other board takes it as a new one. */
export const adopt = (st: State, level: Level): State => (st.phase === "play" || st.level === level ? st : newGame(level, st));

/** Rings from cell `from` to cell `i` (0 on the cell itself): how far a ripple has travelled. */
export const rings = (st: Pick<State, "w">, i: number, from: number): number =>
  Math.max(Math.abs(Math.floor(i / st.w) - Math.floor(from / st.w)), Math.abs((i % st.w) - (from % st.w)));

/** `0:07`, `12:34`: minutes and seconds, the minutes as many as it takes. */
export const clockText = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The view's title line: what to do, the mines left, or how it ended. */
export function status(st: State): string {
  if (st.phase === "won") return `Cleared in ${clockText(st.clock.ms)}${st.records[st.level].best === st.clock.ms ? ", a new best" : ""}`;
  if (st.phase === "lost") return "Boom";
  if (st.phase === "ready") return "Open any cell";
  const left = minesLeft(st);
  return `${left} mine${left === 1 ? "" : "s"} left`;
}

/** Legal actions now, in the order the view lists them (first is Enter). */
export function actions(st: State): Action[] {
  return st.phase === "won" || st.phase === "lost" ? ["new"] : ["open", "flag", ...DIRS, "new"];
}

/** Whether Enter on the cursor is a chord: an open number with as many flags around it. */
export const isChord = (st: State, i = st.cursor): boolean => st.open[i] && count(st, i) > 0 && flagsAround(st, i) === count(st, i);

const clone = (st: State): State => ({ ...st, mine: [...st.mine], open: [...st.open], flag: [...st.flag], clock: { ...st.clock }, records: { ...st.records, [st.level]: { ...st.records[st.level] } } });

function step(st: State, dir: Dir): number {
  const r = Math.floor(st.cursor / st.w), c = st.cursor % st.w;
  const [rr, cc] = dir === "up" ? [r - 1, c] : dir === "down" ? [r + 1, c] : dir === "left" ? [r, c - 1] : [r, c + 1];
  return rr < 0 || rr >= st.h || cc < 0 || cc >= st.w ? st.cursor : rr * st.w + cc;
}

export function apply(state: State, action: Action, s: Settings = DEFAULTS, rng: Rng = Math.random, now = Date.now()): State {
  if (!actions(state).includes(action)) return state;
  if (action === "new") {
    const fresh = newGame(levelOf(s.difficulty), state);
    // The cursor stays where it was on a board of the same size.
    return fresh.w === state.w && fresh.h === state.h ? { ...fresh, cursor: state.cursor } : fresh;
  }
  if (action !== "open" && action !== "flag") {
    const to = step(state, action);
    return to === state.cursor ? state : { ...state, cursor: to };
  }
  const i = state.cursor;
  if (action === "flag") {
    if (state.open[i]) return state;
    const st = clone(state);
    st.flag[i] = !st.flag[i];
    return touch(st, now);
  }
  if (state.flag[i] || (state.open[i] && !isChord(state, i))) return state;
  const st = clone(state);
  if (st.phase === "ready") {
    st.mine = layMines(st.w, st.h, st.mines, i, rng);
    st.phase = "play";
    st.clock = { ms: 0, since: now };
  }
  const opened = reveal(st, st.open[i] ? around(i, st.w, st.h) : [i]);
  if (!opened.length) return state;
  st.last = { at: i, opened };
  const boom = opened.find((j) => st.mine[j]);
  if (boom !== undefined) return finish(st, false, now, boom);
  if (st.open.every((o, j) => o || st.mine[j])) return finish(st, true, now);
  return touch(st, now);
}

/** Opens `from` and floods out of every cell with no mine around; answers the cells it opened, nearest first. Changes `st` in place. */
function reveal(st: State, from: number[]): number[] {
  const out: number[] = [];
  const queue = from.filter((j) => !st.open[j] && !st.flag[j]);
  queue.forEach((j) => { st.open[j] = true; });
  while (queue.length) {
    const j = queue.shift()!;
    out.push(j);
    if (st.mine[j] || count(st, j) > 0) continue;
    for (const k of around(j, st.w, st.h)) {
      if (st.open[k] || st.flag[k]) continue;
      st.open[k] = true;
      queue.push(k);
    }
  }
  return out;
}

/** A move in play: the clock runs from here if the view's resume never came (an older app), and the move is the last one seen. */
function touch(st: State, now: number): State {
  if (st.phase !== "play") return st;
  st.clock = { ...st.clock, since: st.clock.since ?? now, seen: now };
  return st;
}

/** Won or lost: the clock stops, the record moves, a win flags the mines left. */
function finish(st: State, won: boolean, now: number, hit?: number): State {
  st.phase = won ? "won" : "lost";
  st.hit = hit;
  st.clock = { ms: elapsed(st.clock, now) };
  const rec = st.records[st.level];
  rec.played++;
  if (won) {
    rec.won++;
    rec.best = Math.min(rec.best ?? Infinity, st.clock.ms);
    st.flag = st.mine.map((m) => m);
  }
  return st;
}

/** The view left: the run so far goes into `ms`. */
export function pause(st: State, now: number): State {
  if (st.phase !== "play" || st.clock.since === undefined) return st;
  return { ...st, clock: { ms: elapsed(st.clock, now), seen: st.clock.seen } };
}

/** The view is back: a run starts now. */
export function resume(st: State, now: number): State {
  if (st.phase !== "play" || st.clock.since !== undefined) return st;
  return { ...st, clock: { ...st.clock, since: now } };
}

/** On opening: a run still going is one the panel never ended (a crash, a quit), so it is cut off at the last move. */
export const settle = (st: State): State => pause(st, Math.max(st.clock.since ?? 0, st.clock.seen ?? 0));

/** Whether `x` is a state this version can play on; a store from another version starts over. */
export function isState(x: unknown): x is State {
  const s = x as State;
  const n = s && typeof s === "object" ? s.w * s.h : NaN;
  return !!s && typeof s === "object" && s.level in LEVELS && Number.isInteger(n) && n > 0
    && [s.mine, s.open, s.flag].every((a) => Array.isArray(a) && a.length === n)
    && ["ready", "play", "won", "lost"].includes(s.phase) && typeof s.cursor === "number" && s.cursor >= 0 && s.cursor < n
    && !!s.clock && typeof s.clock.ms === "number" && typeof s.game === "number" && !!s.records && Object.keys(LEVELS).every((l) => !!s.records[l as Level]);
}
