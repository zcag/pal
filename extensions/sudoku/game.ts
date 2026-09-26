// A game as it stands, pure, shared by the page (which plays it) and the
// extension (which saves it and reads how far it got): the digits, the
// pencil marks, the clock, and every move as a function from one state to
// the next, so undo is keeping the old one. And the hint: what to look at,
// then why, then the move, in plain words (`hint`).
//
// Pencil marks come in two layers. Your own (`n`) are what you write. With
// auto notes on (a setting, not part of the game) every empty cell shows what
// still fits instead, less what you took out (`x`): the removals are kept,
// so a mark you ruled out stays out as the board changes, and turning auto
// notes off brings your own marks back untouched. `marks` is whichever layer
// is on show; every move takes `auto` and writes only that layer.
import { ALL, PEERS, UNITS, UNITS_OF, bit, candidates, colOf, conflicts, count, digitsOf, findStep, has, rowOf, type Step } from "./sudoku.ts";

export type Play = {
  /** Every cell's digit, the clues included; 0 is empty. */
  v: number[];
  /** Each cell's pencil marks, a 9-bit mask. */
  n: number[];
  /** With auto notes: the marks you took out of each cell. */
  x: number[];
  /** Cells that turned into notes by a second digit typed over the first: plain digits there toggle marks until the cell is cleared. */
  j: boolean[];
  /** Time so far. */
  ms: number;
  done?: { ms: number; at: number };
  /** Hints that gave something away (the reason or the move, not only where to look). */
  hints: number;
  /** Digits placed that were not the answer. */
  mistakes: number;
};

const zeros = () => new Array(81).fill(0);
export const newPlay = (givens: number[]): Play => ({ v: givens.slice(), n: zeros(), x: zeros(), j: new Array(81).fill(false), ms: 0, hints: 0, mistakes: 0 });
const with1 = <T>(xs: T[], i: number, x: T) => { const out = xs.slice(); out[i] = x; return out; };

/** The marks on show in every cell: your own, or with auto notes what still fits less what you took out. */
export function marks(p: Play, auto: boolean): number[] {
  if (!auto) return p.n.map((m, i) => (p.v[i] ? 0 : m));
  return candidates(p.v).map((m, i) => m & ~p.x[i]);
}
/** One cell's marks on show. */
const marksAt = (p: Play, cell: number, auto: boolean) => (p.v[cell] ? 0 : auto ? candidates(p.v)[cell] & ~p.x[cell] : p.n[cell]);

/**
 * A digit in a cell (over any digit there). Its pencil mark leaves every cell it
 * sees; the cell's own marks go. A digit that is not the answer counts as a mistake.
 */
export function place(p: Play, givens: number[], cell: number, d: number, solution?: number[]): Play {
  if (givens[cell] || p.done) return p;
  if (p.v[cell] === d) return p;
  const n = p.n.slice();
  n[cell] = 0;
  for (const j of PEERS[cell]) n[j] &= ~bit(d);
  return {
    ...p, v: with1(p.v, cell, d), n, x: with1(p.x, cell, 0), j: with1(p.j, cell, false),
    mistakes: p.mistakes + (solution && solution[cell] !== d ? 1 : 0),
  };
}

/** A pencil mark on or off (nothing on a cell with a digit). With auto notes only a digit that fits can show, so it only comes back after you took it out. */
export function toggleNote(p: Play, givens: number[], cell: number, d: number, auto = false): Play {
  if (givens[cell] || p.v[cell] || p.done) return p;
  if (auto && !has(candidates(p.v)[cell], d)) return p;
  const q = auto ? { ...p, x: with1(p.x, cell, p.x[cell] ^ bit(d)) } : { ...p, n: with1(p.n, cell, p.n[cell] ^ bit(d)) };
  return q.j[cell] && !marksAt(q, cell, auto) ? { ...q, j: with1(q.j, cell, false) } : q;
}

/**
 * A digit typed with no modifier. An empty cell takes it; a cell that became
 * notes (`j`) toggles it as a mark; the same digit again changes nothing. A
 * different digit over one you placed turns the cell into notes holding both,
 * so changing your mind never loses the first guess (⌫ then the digit
 * replaces it). With mistakes shown the answer is no secret, so a wrong digit
 * is simply replaced and a right one stays put.
 */
export function enter(p: Play, givens: number[], cell: number, d: number, solution: number[], o: { auto?: boolean; mistakes?: boolean } = {}): Play {
  if (givens[cell] || p.done) return p;
  const was = p.v[cell];
  if (!was) return p.j[cell] && marksAt(p, cell, !!o.auto) ? toggleNote(p, givens, cell, d, o.auto) : place(p, givens, cell, d, solution);
  if (was === d) return p;
  if (o.mistakes) return was === solution[cell] ? p : place(p, givens, cell, d, solution);
  const both = bit(was) | bit(d);
  return {
    ...p, v: with1(p.v, cell, 0), j: with1(p.j, cell, true),
    ...(o.auto ? { x: with1(p.x, cell, ALL & ~both) } : { n: with1(p.n, cell, both) }),
  };
}

/** The cell's digit out, or with none its marks (with auto notes: what you took out comes back). */
export function erase(p: Play, givens: number[], cell: number, auto = false): Play {
  if (givens[cell] || p.done) return p;
  const j = with1(p.j, cell, false);
  if (p.v[cell]) return { ...p, v: with1(p.v, cell, 0), j };
  if (auto) return p.x[cell] ? { ...p, x: with1(p.x, cell, 0), j } : p;
  return p.n[cell] ? { ...p, n: with1(p.n, cell, 0), j } : p;
}

/** Every empty cell's marks: what fits there. Marks already written are only trimmed, so your own eliminations stay. */
export function fillNotes(p: Play): Play {
  const cand = candidates(p.v);
  const n = p.n.map((m, i) => (p.v[i] ? 0 : m ? m & cand[i] : cand[i]));
  return n.every((m, i) => m === p.n[i]) ? p : { ...p, n };
}

export const clearNotes = (p: Play): Play => (p.n.some(Boolean) ? { ...p, n: zeros(), j: p.j.map(() => false) } : p);

export const isFull = (v: number[]) => v.every(Boolean);
export const isSolved = (v: number[], solution: number[]) => v.every((d, i) => d === solution[i]);

/** The units through a cell that are full with no digit twice: the ones to celebrate. */
export const unitsDone = (v: number[], cell: number): number[] =>
  UNITS_OF[cell].filter((u) => UNITS[u].every((i) => v[i]) && new Set(UNITS[u].map((i) => v[i])).size === 9);

/** How many of each digit are on the board (index 1-9). */
export function digitCounts(v: number[]): number[] {
  const out = new Array(10).fill(0);
  for (const d of v) out[d]++;
  return out;
}

/** Cells with a digit that is not the answer (the clues never are). */
export const wrongCells = (v: number[], givens: number[], solution: number[]) => v.flatMap((d, i) => (d && !givens[i] && d !== solution[i] ? [i] : []));

// ---- saved -----------------------------------------------------------------------------

/**
 * A game as it is kept: the digits as 81 characters, the marks as two base-32 characters a cell;
 * the auto-notes removals the same way and the cells turned into notes as their indexes, only when there are any.
 */
export type Saved = { v: string; n: string; x?: string; j?: number[]; ms: number; done?: { ms: number; at: number }; hints?: number; mistakes?: number };

const masks = (ms: number[]) => ms.map((m) => m.toString(32).padStart(2, "0")).join("");
const unmask = (s: string | undefined) => zeros().map((_, i) => (parseInt(s?.slice(i * 2, i * 2 + 2) ?? "", 32) || 0) & ALL);

export function encode(p: Play): Saved {
  const j = p.j.flatMap((on, i) => (on && !p.v[i] ? [i] : []));
  return {
    v: p.v.join(""), n: masks(p.n), ...(p.x.some(Boolean) && { x: masks(p.x) }), ...(j.length && { j }), ms: Math.round(p.ms),
    ...(p.done && { done: p.done }), ...(p.hints && { hints: p.hints }), ...(p.mistakes && { mistakes: p.mistakes }),
  };
}
export function decode(s: Saved, givens: number[]): Play {
  const v = givens.map((g, i) => g || Number(s.v?.[i]) || 0);
  const j = new Array(81).fill(false);
  for (const i of s.j ?? []) if (i >= 0 && i < 81 && !v[i]) j[i] = true;
  return { v, n: unmask(s.n), x: unmask(s.x), j, ms: s.ms || 0, ...(s.done && { done: s.done }), hints: s.hints ?? 0, mistakes: s.mistakes ?? 0 };
}

/** How far a saved game got: digits you placed of the cells there were to fill, and whether anything (a digit, a pencil mark, a mark taken out) was put down at all. */
export function progressOf(s: Saved, givens: string): { filled: number; total: number; started: boolean } {
  let filled = 0, total = 0;
  for (let i = 0; i < 81; i++) {
    if (givens[i] !== "0") continue;
    total++;
    if (s.v?.[i] && s.v[i] !== "0") filled++;
  }
  // A board of pencil marks only is a game under way too: resumed first and listed as in progress.
  return { filled, total, started: filled > 0 || /[^0]/.test(s.n ?? "") || /[^0]/.test(s.x ?? "") };
}

// ---- names --------------------------------------------------------------------------------

const BOXES = ["top-left", "top", "top-right", "left", "middle", "right", "bottom-left", "bottom", "bottom-right"];
/** "row 4", "column 7", "the top-left box". */
export const unitName = (u: number) => (u < 9 ? `row ${u + 1}` : u < 18 ? `column ${u - 8}` : `the ${BOXES[u - 18]} box`);
const kindOf = (u: number) => (u < 9 ? "row" : u < 18 ? "column" : "box");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** "2 and 5", "1, 4 and 8". */
const and = (xs: (string | number)[], word = "and") => (xs.length < 2 ? String(xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${word} ${xs[xs.length - 1]}`);
const plural = (d: number) => `${d}s`;
/** "rows 2 and 6", "columns 1, 4 and 8". */
const linesName = (ls: number[]) => (ls[0] < 9 ? `rows ${and(ls.map((l) => l + 1))}` : `columns ${and(ls.map((l) => l - 8))}`);

// ---- the hint -----------------------------------------------------------------------------------

/**
 * One hint, in three presses: `look` says where (the `area` lit), `why` gives the reason with
 * the digit (the `cells` it is about marked, the `sources` whose digits explain it), and the third
 * press makes the move (`applyHint`).
 */
export type Hint = {
  kind: "wrong" | "step" | "reveal";
  /** The cell it points at, when there is one. */
  cell?: number;
  digit?: number;
  step?: Step;
  area: number[];
  cells: number[];
  sources: number[];
  look: string;
  why: string;
  /** The button that makes the move: "Place 7", "Erase it", "Update notes". */
  act: string;
};

/** For each other empty cell of the unit, a digit d it sees, preferring one outside the unit: why d fits nowhere else. */
function blockers(v: number[], unit: number[], at: number, d: number): number[] | null {
  const out = new Set<number>();
  for (const i of unit) {
    if (i === at || v[i]) continue;
    const by = PEERS[i].find((j) => v[j] === d);
    if (by === undefined) return null;
    out.add(by);
  }
  return [...out];
}

/**
 * The next hint for the board as it is. A wrong digit comes first. Otherwise the simplest
 * deduction left, found on the candidates (your own marks where you wrote any, as long as they
 * keep the answer); with none, the answer for the cell with the fewest options.
 */
export function hint(givens: number[], p: Play, solution: number[], auto = false): Hint {
  const clash = conflicts(p.v);
  const wrong = wrongCells(p.v, givens, solution).sort((a, b) => Number(clash.has(b)) - Number(clash.has(a)))[0];
  if (wrong !== undefined) {
    const d = p.v[wrong];
    const u = UNITS_OF[wrong].find((k) => UNITS[k].some((i) => i !== wrong && p.v[i] === d));
    const twin = u === undefined ? undefined : UNITS[u].find((i) => i !== wrong && p.v[i] === d);
    return {
      kind: "wrong", cell: wrong, digit: d, area: UNITS[UNITS_OF[wrong][0]], cells: [wrong], sources: twin === undefined ? [] : [twin],
      look: `A digit in ${unitName(UNITS_OF[wrong][0])} isn't right.`,
      why: u === undefined ? `This ${d} doesn't belong here.` : `This ${d} is wrong: there's another ${d} in its ${kindOf(u)}.`,
      act: "Erase it",
    };
  }
  const legal = candidates(p.v), mine = marks(p, auto);
  const cand = legal.map((m, i) => (mine[i] & m && has(mine[i] & m, solution[i]) ? mine[i] & m : m));
  const s = findStep(p.v, cand);
  if (!s) {
    const cell = p.v.map((d, i) => (d ? 99 : count(legal[i]))).reduce((best, n, i, xs) => (n < xs[best] ? i : best), 0);
    const d = solution[cell];
    return { kind: "reveal", cell, digit: d, area: [cell], cells: [cell], sources: [], look: "Try this cell.", why: `This cell is a ${d}.`, act: `Place ${d}` };
  }
  const d = s.digits[0];
  const base = { kind: "step" as const, step: s, cells: s.cells, sources: [] as number[] };
  switch (s.tech) {
    case "full-house": {
      const u = s.unit!;
      return { ...base, cell: s.place!.cell, digit: d, area: UNITS[u], look: `Look at ${unitName(u)}.`, why: `${cap(unitName(u))} has one empty cell left, and ${d} is the digit it's missing.`, act: `Place ${d}` };
    }
    case "hidden-single": {
      const u = s.unit!, at = s.place!.cell, by = blockers(p.v, UNITS[u], at, d);
      return {
        ...base, cell: at, digit: d, area: UNITS[u], sources: by ?? [], look: `Look at ${unitName(u)}.`,
        why: by ? `Only this cell in ${unitName(u)} can take a ${d}: every other empty cell sees a ${d} already.` : `In ${unitName(u)}, ${d} fits only in this cell.`,
        act: `Place ${d}`,
      };
    }
    case "naked-single": {
      const at = s.place!.cell, others = digitsOf(ALL & ~bit(d));
      const pure = count(legal[at]) === 1;
      const sources = pure ? others.map((x) => PEERS[at].find((j) => p.v[j] === x)!).filter((j) => j !== undefined) : [];
      return {
        ...base, cell: at, digit: d, area: [...new Set(UNITS_OF[at].flatMap((u) => UNITS[u]))], sources, look: "Look at this cell.",
        why: pure ? `Only ${d} fits here: ${and(others)} are all in its row, column or box.` : `Only ${d} is left for this cell.`,
        act: `Place ${d}`,
      };
    }
    case "pointing": case "claiming": {
      const from = s.unit!, to = s.lines![0];
      return {
        ...base, area: UNITS[from], look: `Look at the ${plural(d)} in ${unitName(from)}.`,
        why: `In ${unitName(from)}, ${d} can only go in these cells, all inside ${unitName(to)}. So the rest of ${unitName(to)} can't be ${d}.`,
        act: "Update notes",
      };
    }
    case "naked-pair": case "naked-triple": {
      const u = s.unit!, n = s.cells.length === 2 ? "two" : "three";
      return {
        ...base, area: UNITS[u], look: `Look at ${unitName(u)}.`,
        why: `These ${n} cells in ${unitName(u)} can only be ${and(s.digits, "or")}${n === "three" ? " between them" : ""}. So no other cell in the ${kindOf(u)} can be ${and(s.digits, "or")}.`,
        act: "Update notes",
      };
    }
    case "hidden-pair": case "hidden-triple": {
      const u = s.unit!, n = s.cells.length === 2 ? "two" : "three";
      return {
        ...base, area: UNITS[u], look: `Look at ${unitName(u)}.`,
        why: `In ${unitName(u)}, ${and(s.digits)} fit only in these ${n} cells. So those cells can't hold anything else.`,
        act: "Update notes",
      };
    }
    case "x-wing": case "swordfish": {
      const ls = s.lines!, rows = ls[0] < 9, cross = [...new Set(s.cells.map((i) => (rows ? 9 + colOf(i) : rowOf(i))))].sort((a, b) => a - b);
      return {
        ...base, area: ls.flatMap((l) => UNITS[l]), look: `Look at the ${plural(d)} in ${linesName(ls)}.`,
        why: `In ${linesName(ls)}, ${d} fits only within ${linesName(cross)}. Each of those ${rows ? "rows" : "columns"} needs its ${d} there, so the rest of ${linesName(cross)} can't be ${d}.`,
        act: "Update notes",
      };
    }
    case "xy-wing": {
      const [x, y] = digitsOf(cand[s.cells[0]]), z = s.digits[2];
      return {
        ...base, cell: s.cells[0], area: s.cells, look: "Look at these three cells.",
        why: `The ringed cell is ${x} or ${y}, and each of the other two holds ${z} with one of those. Whichever it is, one of the two is ${z}, so a cell that sees both of them can't be ${z}.`,
        act: "Update notes",
      };
    }
  }
}

/** The hint's move: its digit placed, the wrong digit erased, or the marks updated (written in first where a cell had none; with auto notes, taken out). */
export function applyHint(p: Play, givens: number[], h: Hint, solution: number[], auto = false): Play {
  if (h.kind === "wrong") return erase(p, givens, h.cell!);
  if (h.digit !== undefined && h.cell !== undefined && (h.kind === "reveal" || h.step?.place)) return place(p, givens, h.cell, h.digit, solution);
  if (auto) {
    const x = p.x.slice();
    for (const e of h.step?.elim ?? []) x[e.cell] |= bit(e.digit);
    return { ...p, x };
  }
  const legal = candidates(p.v), n = p.n.slice();
  for (const e of h.step?.elim ?? []) {
    if (!n[e.cell]) n[e.cell] = legal[e.cell];
    n[e.cell] &= ~bit(e.digit);
  }
  return { ...p, n };
}

/** 4:07, or 1:02:09 past the hour. */
export const clockText = (ms: number) => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
