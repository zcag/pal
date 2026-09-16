// The rules, pure: a `State` in, a `State` out. The board is sixteen cells
// row-major, each empty or a tile with a stable id (what the view keys on)
// and a value. A move slides every line toward the edge, merging equal
// neighbours once per move (the merged tile is a new tile, so 4 4 8 moved
// left gives 8 8, never 16), then spawns a 2 (nine in ten) or a 4 on a free
// cell. A move that changes nothing is a no-op and spawns nothing. The game
// is won at the first 2048 (Continue keeps playing) and over when no move
// can change the board. One move of undo, when the setting allows.
export type Settings = { undo: boolean };
export const DEFAULTS: Settings = { undo: true };

export const SIZE = 4;
export const TARGET = 2048;

export type Tile = { id: number; v: number };
/** Sixteen cells, row-major; `null` is empty. */
export type Board = (Tile | null)[];
export type Dir = "up" | "down" | "left" | "right";
/** A direction (the arrows and hjkl both send it, render.ts), `continue` closes the won banner, `undo` takes one move back. */
export type Action = Dir | "new" | "undo" | "continue";
export type Phase = "play" | "won" | "over";

/** What the last move did, for the view's transitions: tiles that slid, tiles born of a merge, the spawned one. */
export type Last = { dir: Dir; moved: number[]; merged: number[]; spawned: number[] };
export type Snapshot = { board: Board; score: number; moves: number; won: boolean };

export type State = {
  board: Board;
  score: number;
  /** Best score across games; survives New game. */
  best: number;
  moves: number;
  /** Next tile id. */
  seq: number;
  /** A 2048 tile has been made this game. */
  won: boolean;
  /** Continue was chosen after 2048. */
  kept: boolean;
  /** Games started, best included. */
  games: number;
  last?: Last;
  /** The board before the last move, for undo. */
  prev?: Snapshot;
};

export type Rng = () => number;

export const DIRS: Dir[] = ["up", "down", "left", "right"];
export const dirOf = (a: Action): Dir | undefined => DIRS.find((d) => d === a);

export const cells = (b: Board): Tile[] => b.filter((t): t is Tile => !!t);
export const maxTile = (b: Board): number => cells(b).reduce((m, t) => Math.max(m, t.v), 0);

/** Any empty cell, or two equal neighbours. */
export function canMove(b: Board): boolean {
  for (let i = 0; i < b.length; i++) {
    const t = b[i];
    if (!t) return true;
    const r = Math.floor(i / SIZE), c = i % SIZE;
    if (c + 1 < SIZE && b[i + 1]?.v === t.v) return true;
    if (r + 1 < SIZE && b[i + SIZE]?.v === t.v) return true;
  }
  return false;
}

export const phase = (st: State): Phase => (!canMove(st.board) ? "over" : st.won && !st.kept ? "won" : "play");

/** A 2 nine times in ten, else a 4, on a free cell picked uniformly; the board is changed in place. */
export function spawn(b: Board, seq: number, rng: Rng): Tile | null {
  const free = b.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
  if (!free.length) return null;
  const at = free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
  const t = { id: seq, v: rng() < 0.9 ? 2 : 4 };
  b[at] = t;
  return t;
}

export function newGame(prev?: Pick<State, "best" | "games" | "seq">, rng: Rng = Math.random): State {
  const board: Board = Array(SIZE * SIZE).fill(null);
  let seq = prev?.seq ?? 1;
  spawn(board, seq++, rng);
  spawn(board, seq++, rng);
  return { board, score: 0, best: prev?.best ?? 0, moves: 0, seq, won: false, kept: false, games: (prev?.games ?? 0) + 1 };
}

/** One line slid toward index 0: merged pairs become new tiles (ids from `seq` up), `moved` are the survivors whose index changed. */
export function slideLine(line: (Tile | null)[], seq: number): { out: (Tile | null)[]; moved: number[]; merged: number[]; gained: number; seq: number } {
  const tiles = line.filter((t): t is Tile => !!t);
  const out: (Tile | null)[] = [];
  const moved: number[] = [], merged: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (i + 1 < tiles.length && tiles[i + 1].v === t.v) {
      const m = { id: seq++, v: t.v * 2 };
      out.push(m);
      merged.push(m.id);
      gained += m.v;
      i++;
    } else {
      if (line.indexOf(t) !== out.length) moved.push(t.id);
      out.push(t);
    }
  }
  while (out.length < line.length) out.push(null);
  return { out, moved, merged, gained, seq };
}

/** Cell indices of each line in slide order for a direction: `left` is each row as it is, `right` each row reversed, and so on. */
const lines = (dir: Dir): number[][] => {
  const out: number[][] = [];
  for (let a = 0; a < SIZE; a++) {
    const idx: number[] = [];
    for (let b = 0; b < SIZE; b++) idx.push(dir === "left" || dir === "right" ? a * SIZE + b : b * SIZE + a);
    out.push(dir === "right" || dir === "down" ? idx.reverse() : idx);
  }
  return out;
};

/** The board after sliding `dir`, or `null` when nothing would change. */
export function slide(b: Board, dir: Dir, seq: number): { board: Board; moved: number[]; merged: number[]; gained: number; seq: number } | null {
  const board: Board = [...b];
  const moved: number[] = [], merged: number[] = [];
  let gained = 0, changed = false;
  for (const idx of lines(dir)) {
    const r = slideLine(idx.map((i) => b[i]), seq);
    seq = r.seq;
    moved.push(...r.moved);
    merged.push(...r.merged);
    gained += r.gained;
    idx.forEach((i, k) => { if (board[i] !== r.out[k]) changed = true; board[i] = r.out[k]; });
  }
  return changed ? { board, moved, merged, gained, seq } : null;
}

/** Legal actions now, in the order the view lists them (first is Enter). */
export function actions(st: State, s: Settings = DEFAULTS): Action[] {
  const undo: Action[] = st.prev && s.undo ? ["undo"] : [];
  switch (phase(st)) {
    case "play": return ["new", ...DIRS, ...undo];
    case "won": return ["continue", "new", ...undo];
    case "over": return ["new", ...undo];
  }
}

export function apply(state: State, action: Action, s: Settings = DEFAULTS, rng: Rng = Math.random): State {
  if (!actions(state, s).includes(action)) return state;
  const st: State = { ...state, board: [...state.board] };
  switch (action) {
    case "new": return newGame(st, rng);
    case "continue": st.kept = true; return st;
    case "undo": {
      const p = st.prev!;
      return { ...st, board: p.board, score: p.score, moves: p.moves, won: p.won, prev: undefined, last: undefined };
    }
    default: {
      const dir = dirOf(action)!;
      const r = slide(st.board, dir, st.seq);
      if (!r) return state;
      if (s.undo) st.prev = { board: state.board, score: state.score, moves: state.moves, won: state.won };
      else st.prev = undefined;
      st.board = r.board;
      st.seq = r.seq;
      st.score += r.gained;
      st.best = Math.max(st.best, st.score);
      st.moves++;
      const born = spawn(st.board, st.seq++, rng);
      st.won = st.won || maxTile(st.board) >= TARGET;
      st.last = { dir, moved: r.moved, merged: r.merged, spawned: born ? [born.id] : [] };
      return st;
    }
  }
}

/** Whether `x` is a state this version can play on; a store from another version starts over. */
export function isState(x: unknown): x is State {
  const s = x as State;
  return !!s && typeof s === "object" && Array.isArray(s.board) && s.board.length === SIZE * SIZE
    && s.board.every((t) => t === null || (!!t && typeof t.id === "number" && typeof t.v === "number"))
    && typeof s.score === "number" && typeof s.best === "number" && typeof s.moves === "number" && typeof s.seq === "number";
}
