// The rules, pure: a puzzle's geometry and what each key does to a solve in
// progress. The page (surface/main.ts) runs these on every key, the host
// tests them, and the host reads `status` and `decode` for its rows.
//
// A `Puzzle` is the grid as the source gives it: the answer per cell ("" a
// block), the clues by number, the circles and bars. `gridOf` numbers it the
// standard way (a cell starts an across word when the cell before it is a
// block, a bar or the edge and the one after is not) and hangs the clues on
// the words it finds, so a source's own numbering never has to be trusted.
//
// A `Play` is one solve: the letters, the marks a check or a reveal left,
// the cursor and its direction, and the time. Navigation follows the NYT
// app: typing fills and moves to the next empty square of the word (a full
// word typed over moves square by square), and a finished word jumps to the
// next clue with a gap; Backspace clears the square, or steps back and
// clears when it is already empty; an arrow along the direction moves (over
// blocks), across it turns first; Tab walks the clues, skipping full ones.
export type Dir = "across" | "down";

export type Puzzle = {
  /** The source's id (Crosshare's puzzle id). */
  id: string;
  title: string;
  /** The constructor, as the source credits them. */
  author: string;
  /** The constructor's note, shown once the puzzle is solved (it can give an answer away). */
  note?: string;
  copyright?: string;
  /** YYYY-MM-DD for a daily mini: the day it was the daily. */
  date?: string;
  w: number;
  h: number;
  /** The answer per cell, row-major, upper case; "" is a block. */
  solution: string[];
  clues: { across: Record<number, string>; down: Record<number, string> };
  circles?: number[];
  /** Cells with a bar on their right side, and on their bottom side (a barred grid). */
  bars?: { right: number[]; below: number[] };
};

export type Word = { dir: Dir; n: number; cells: number[]; clue: string };

export type Grid = {
  p: Puzzle;
  /** Every word, across by number then down by number: the order Tab walks. */
  words: Word[];
  /** The word (index into `words`) each cell is part of, per direction; -1 for none. */
  across: number[];
  down: number[];
  /** The number printed in each cell, 0 for none. */
  numbers: number[];
};

export const isBlock = (p: Puzzle, i: number) => !p.solution[i];

export function gridOf(p: Puzzle): Grid {
  const n = p.w * p.h;
  const right = new Set(p.bars?.right), below = new Set(p.bars?.below);
  const open = (r: number, c: number) => r >= 0 && c >= 0 && r < p.h && c < p.w && !isBlock(p, r * p.w + c);
  // A bar on a cell's right (below) side ends the word there.
  const joinedRight = (r: number, c: number) => open(r, c) && open(r, c + 1) && !right.has(r * p.w + c);
  const joinedBelow = (r: number, c: number) => open(r, c) && open(r + 1, c) && !below.has(r * p.w + c);
  const numbers = Array<number>(n).fill(0);
  const across = Array<number>(n).fill(-1), down = Array<number>(n).fill(-1);
  const acrossWords: Word[] = [], downWords: Word[] = [];
  let next = 1;
  for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) {
    if (!open(r, c)) continue;
    const a = !joinedRight(r, c - 1) && joinedRight(r, c);
    const d = !joinedBelow(r - 1, c) && joinedBelow(r, c);
    if (!a && !d) continue;
    const num = next++;
    numbers[r * p.w + c] = num;
    if (a) {
      const cells = [r * p.w + c];
      for (let cc = c; joinedRight(r, cc); cc++) cells.push(r * p.w + cc + 1);
      acrossWords.push({ dir: "across", n: num, cells, clue: p.clues.across[num] ?? "" });
    }
    if (d) {
      const cells = [r * p.w + c];
      for (let rr = r; joinedBelow(rr, c); rr++) cells.push((rr + 1) * p.w + c);
      downWords.push({ dir: "down", n: num, cells, clue: p.clues.down[num] ?? "" });
    }
  }
  const words = [...acrossWords, ...downWords];
  words.forEach((w, wi) => w.cells.forEach((i) => ((w.dir === "across" ? across : down)[i] = wi)));
  return { p, words, across, down, numbers };
}

// ---- a solve -------------------------------------------------------------------

/** Mark bits: a check found the letter wrong (the slash, until it changes); the letter was revealed; a check found it right. */
export const WRONG = 1, REVEALED = 2, RIGHT = 4;

export type Play = {
  fill: string[];
  mark: number[];
  at: number;
  dir: Dir;
  /** Time spent solving, ms, up to the last save; the page adds the running stretch. */
  ms: number;
  /** A reveal was used: the solve counts, but not for the best time or the streak. */
  helped: boolean;
  /** A check (or autocheck) was used. */
  checked: boolean;
  /** Set when it was solved: the time it took and when (unix ms). */
  done?: { ms: number; at: number };
};

export const locked = (st: Play, i: number) => (st.mark[i] & (REVEALED | RIGHT)) !== 0;
const wordAt = (g: Grid, i: number, dir: Dir) => (dir === "across" ? g.across : g.down)[i];
const other = (d: Dir): Dir => (d === "across" ? "down" : "across");

export function newPlay(g: Grid): Play {
  const n = g.p.w * g.p.h;
  const first = g.words[0];
  return { fill: Array(n).fill(""), mark: Array(n).fill(0), at: first ? first.cells[0] : 0, dir: first?.dir ?? "across", ms: 0, helped: false, checked: false };
}

/** The word under the cursor, in the cursor's direction (a cell with only the other direction's word switches to it). */
export function current(g: Grid, st: Play): Word | undefined {
  const w = wordAt(g, st.at, st.dir);
  return g.words[w >= 0 ? w : wordAt(g, st.at, other(st.dir))];
}
/** The crossing word through the cursor, if any. */
export function crossing(g: Grid, st: Play): Word | undefined {
  const cur = current(g, st);
  if (!cur) return undefined;
  return g.words[wordAt(g, st.at, other(cur.dir))];
}

const empty = (st: Play, i: number) => !st.fill[i];
export const isFull = (g: Grid, st: Play) => g.p.solution.every((s, i) => !s || !!st.fill[i]);
export const isRight = (g: Grid, st: Play, i: number) => st.fill[i] === g.p.solution[i];
export const isSolved = (g: Grid, st: Play) => g.p.solution.every((s, i) => !s || st.fill[i] === s);
/** Where the solve stands: solved, full but wrong somewhere ("not quite"), or still open. */
export const status = (g: Grid, st: Play): "solved" | "wrong" | "open" => (st.done || isSolved(g, st) ? "solved" : isFull(g, st) ? "wrong" : "open");
export const wordFull = (st: Play, w: Word) => w.cells.every((i) => !empty(st, i));

/** The cursor on `i`, keeping the direction when the cell has a word that way. */
export function select(g: Grid, st: Play, i: number, dir: Dir = st.dir): Play {
  if (i < 0 || i >= g.p.solution.length || isBlock(g.p, i)) return st;
  const d = wordAt(g, i, dir) >= 0 || wordAt(g, i, other(dir)) < 0 ? dir : other(dir);
  return i === st.at && d === st.dir ? st : { ...st, at: i, dir: d };
}

/** Space, or a click on the cursor's square: the other direction, when the square has a word that way. */
export function toggle(g: Grid, st: Play): Play {
  return wordAt(g, st.at, other(st.dir)) >= 0 ? { ...st, dir: other(st.dir) } : st;
}

/** A click: on the cursor's square it turns, elsewhere it moves there. */
export const click = (g: Grid, st: Play, i: number): Play => (i === st.at ? toggle(g, st) : select(g, st, i));

export type Arrow = "up" | "down" | "left" | "right";
/** An arrow along the direction moves one square (over blocks, stopping at the edge); across it, it turns first. */
export function arrow(g: Grid, st: Play, key: Arrow): Play {
  const axis: Dir = key === "left" || key === "right" ? "across" : "down";
  if (axis !== st.dir && wordAt(g, st.at, axis) >= 0) return { ...st, dir: axis };
  const { w, h } = g.p;
  const [dr, dc] = key === "up" ? [-1, 0] : key === "down" ? [1, 0] : key === "left" ? [0, -1] : [0, 1];
  let r = Math.floor(st.at / w) + dr, c = (st.at % w) + dc;
  while (r >= 0 && c >= 0 && r < h && c < w) {
    const i = r * w + c;
    if (!isBlock(g.p, i)) return select(g, st, i, axis);
    r += dr;
    c += dc;
  }
  return st;
}

/** The first empty square of word `wi` (its first square when it is full), with the direction set to the word's. */
function enterWord(g: Grid, st: Play, wi: number): Play {
  const w = g.words[wi];
  return { ...st, at: w.cells.find((i) => empty(st, i)) ?? w.cells[0], dir: w.dir };
}

/** Tab (1) and Shift-Tab (-1): the next clue in order, across then down, skipping full ones while any has a gap. */
export function nextWord(g: Grid, st: Play, step: 1 | -1 = 1): Play {
  const n = g.words.length;
  if (!n) return st;
  const cur = current(g, st);
  const from = cur ? g.words.indexOf(cur) : -1;
  const gaps = !isFull(g, st);
  for (let k = 1; k <= n; k++) {
    const wi = (((from + step * k) % n) + n) % n;
    if (!gaps || !wordFull(st, g.words[wi])) return enterWord(g, st, wi);
  }
  return st;
}

/** A click on a clue: its word, at its first empty square. */
export const selectWord = (g: Grid, st: Play, wi: number): Play => (g.words[wi] ? enterWord(g, st, wi) : st);

/** Where the cursor goes after a letter lands on `at` in word `w`; `wasFull`: the word had no gap before the key. */
function advance(g: Grid, st: Play, w: Word, wasFull: boolean): Play {
  const k = w.cells.indexOf(st.at);
  if (wasFull) {
    // Typing over a full word: square by square, then on to the next clue.
    if (k < w.cells.length - 1) return { ...st, at: w.cells[k + 1] };
    return isFull(g, st) ? st : nextWord(g, st);
  }
  const after = w.cells.slice(k + 1).find((i) => empty(st, i));
  if (after !== undefined) return { ...st, at: after };
  const before = w.cells.slice(0, k).find((i) => empty(st, i));
  if (before !== undefined) return { ...st, at: before };
  // The word is done: the next clue with a gap, or stay on the last square when the grid is full.
  return isFull(g, st) ? st : nextWord(g, st);
}

/** A letter (or digit) typed at the cursor. On a revealed or checked-right square it only moves on. */
export function type(g: Grid, st: Play, ch: string, autocheck = false): Play {
  const w = current(g, st);
  if (!w || st.done) return st;
  const letter = ch.toUpperCase();
  const wasFull = wordFull(st, w);
  let next: Play = { ...st, dir: w.dir };
  if (!locked(st, st.at)) {
    const fill = st.fill.slice(), mark = st.mark.slice();
    fill[st.at] = letter;
    mark[st.at] &= ~WRONG;
    if (autocheck && letter !== g.p.solution[st.at]) mark[st.at] |= WRONG;
    next = { ...next, fill, mark, checked: st.checked || autocheck };
  }
  return advance(g, next, w, wasFull);
}

/** Clears square `i` unless it is locked. */
function clearAt(st: Play, i: number): Play {
  if (locked(st, i) || (empty(st, i) && !st.mark[i])) return st;
  const fill = st.fill.slice(), mark = st.mark.slice();
  fill[i] = "";
  mark[i] &= ~WRONG;
  return { ...st, fill, mark };
}

/** Backspace: clears the square; on an empty one, steps back (into the previous clue from a word's first square) and clears that. */
export function backspace(g: Grid, st: Play): Play {
  const w = current(g, st);
  if (!w || st.done) return st;
  if (!empty(st, st.at) && !locked(st, st.at)) return clearAt({ ...st, dir: w.dir }, st.at);
  const k = w.cells.indexOf(st.at);
  let to: Play;
  if (k > 0) to = { ...st, at: w.cells[k - 1], dir: w.dir };
  else {
    const n = g.words.length, prev = g.words[(g.words.indexOf(w) - 1 + n) % n];
    to = { ...st, at: prev.cells[prev.cells.length - 1], dir: prev.dir };
  }
  return clearAt(to, to.at);
}

/** Delete: clears the square and stays. */
export const del = (_g: Grid, st: Play): Play => (st.done ? st : clearAt(st, st.at));

export type Scope = "square" | "word" | "puzzle";
const cellsOf = (g: Grid, st: Play, scope: Scope): number[] =>
  scope === "square" ? [st.at] : scope === "word" ? current(g, st)?.cells ?? [] : g.p.solution.flatMap((s, i) => (s ? [i] : []));

/** Check: every filled square in scope is marked wrong (a slash) or right (it locks). Empty squares are left alone. */
export function check(g: Grid, st: Play, scope: Scope): Play {
  if (st.done) return st;
  const mark = st.mark.slice();
  for (const i of cellsOf(g, st, scope)) {
    if (empty(st, i) || locked(st, i)) continue;
    mark[i] = isRight(g, st, i) ? (mark[i] & ~WRONG) | RIGHT : mark[i] | WRONG;
  }
  return { ...st, mark, checked: true };
}

/** Reveal: every square in scope not already right gets its answer, marked revealed; a right one locks as checked. */
export function reveal(g: Grid, st: Play, scope: Scope): Play {
  if (st.done) return st;
  const fill = st.fill.slice(), mark = st.mark.slice();
  let helped = st.helped;
  for (const i of cellsOf(g, st, scope)) {
    if (locked(st, i)) continue;
    if (isRight(g, st, i)) mark[i] = (mark[i] & ~WRONG) | RIGHT;
    else {
      fill[i] = g.p.solution[i];
      mark[i] = REVEALED;
      helped = true;
    }
  }
  return { ...st, fill, mark, helped };
}

/** Clear the word or the whole grid: every letter that is not locked, and the wrong marks. */
export function clear(g: Grid, st: Play, scope: "word" | "puzzle"): Play {
  if (st.done) return st;
  return cellsOf(g, st, scope).reduce(clearAt, st);
}

/** The squares in scope that are wrong right now (for the check's animation). */
export const wrongIn = (g: Grid, st: Play, scope: Scope) => cellsOf(g, st, scope).filter((i) => !empty(st, i) && !isRight(g, st, i));

// ---- time ---------------------------------------------------------------------

export const clockText = (ms: number) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// ---- saving -------------------------------------------------------------------
// A solve is stored compactly: the letters as one string ("." an empty
// square, "#" a block), the marks as digits, the cursor and the rest as is.

export type Saved = { fill: string; mark: string; at: number; dir: "a" | "d"; ms: number; helped?: boolean; checked?: boolean; done?: { ms: number; at: number } };

export function encode(st: Play, p: Puzzle): Saved {
  return {
    fill: st.fill.map((f, i) => (isBlock(p, i) ? "#" : f ? f[0] : ".")).join(""),
    mark: st.mark.join(""),
    at: st.at,
    dir: st.dir === "across" ? "a" : "d",
    ms: Math.round(st.ms),
    ...(st.helped && { helped: true }),
    ...(st.checked && { checked: true }),
    ...(st.done && { done: st.done }),
  };
}

/** A saved solve back on its grid; anything that does not fit the grid gives a fresh solve. */
export function decode(s: unknown, g: Grid): Play {
  const fresh = newPlay(g);
  const v = s as Partial<Saved> | null;
  const n = g.p.w * g.p.h;
  if (!v || typeof v.fill !== "string" || v.fill.length !== n) return fresh;
  const fill = [...v.fill].map((ch, i) => (isBlock(g.p, i) || ch === "." || ch === "#" ? "" : ch));
  const mark = typeof v.mark === "string" && v.mark.length === n ? [...v.mark].map((d) => Number(d) & 7) : fresh.mark;
  const at = Number.isInteger(v.at) && v.at! >= 0 && v.at! < n && !isBlock(g.p, v.at!) ? v.at! : fresh.at;
  const st: Play = { ...fresh, fill, mark, dir: v.dir === "d" ? "down" : "across", ms: Math.max(0, Number(v.ms) || 0), helped: !!v.helped, checked: !!v.checked, ...(v.done && { done: v.done }) };
  return select(g, { ...st, at: -1 }, at, st.dir);
}

/** How far a saved solve got: squares filled of all, and whether it is done. */
export function progressOf(s: Saved | undefined): { filled: number; total: number; done: boolean } {
  if (!s) return { filled: 0, total: 0, done: false };
  const cells = [...s.fill].filter((c) => c !== "#");
  return { filled: cells.filter((c) => c !== ".").length, total: cells.length, done: !!s.done };
}
