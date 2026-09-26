// The puzzle itself, pure, shared by the extension (which makes puzzles)
// and the page (which asks it for hints): the solver, the generator and
// the grader.
//
// A grid is 81 numbers, row by row, 0 for an empty cell. Candidates are
// 9-bit masks (bit d-1 set: d still fits).
//
// Making a puzzle: a full grid filled at random, then clues taken away in
// pairs mirrored through the centre (the classic look) while the answer
// stays unique (`countSolutions` stops at 2). The puzzle is then solved
// the way a person would (`findStep`: the simplest technique that makes
// progress, again and again) and graded by the hardest technique it
// needed. A grade that is not the one asked for, or a puzzle no technique
// here can finish, is thrown away and another made:
//
//   Easy    singles you can spot without notes (a row, column or box with
//           one place left for a digit)
//   Medium  needs a naked single (a cell with one digit left), which
//           takes pencil marks or a careful eye
//   Hard    needs locked candidates or a pair or triple
//   Expert  needs an X-wing, a swordfish or an XY-wing
//
// Everything random comes from a seeded generator, so a date and a
// difficulty always make the same daily puzzle.

export type Diff = "easy" | "medium" | "hard" | "expert";
export const DIFFS: Diff[] = ["easy", "medium", "hard", "expert"];
export const DIFF_TITLE: Record<Diff, string> = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };
export const isDiff = (x: unknown): x is Diff => typeof x === "string" && (DIFFS as string[]).includes(x);
const LEVEL: Record<Diff, number> = { easy: 1, medium: 2, hard: 3, expert: 4 };
/** Fewest clues a dig may leave per difficulty: an easy puzzle keeps plenty. */
const MIN_CLUES: Record<Diff, number> = { easy: 36, medium: 28, hard: 17, expert: 17 };
/** Steps of locked candidates or harder a hard or expert puzzle must need. */
const TRICKY: Partial<Record<Diff, number>> = { hard: 2, expert: 3 };

// ---- geometry ------------------------------------------------------------------------

export const rowOf = (i: number) => (i / 9) | 0;
export const colOf = (i: number) => i % 9;
export const boxOf = (i: number) => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** The 27 units: rows 0-8, columns 9-17, boxes 18-26. */
export const UNITS: number[][] = [
  ...range(9).map((r) => range(9).map((c) => r * 9 + c)),
  ...range(9).map((c) => range(9).map((r) => r * 9 + c)),
  ...range(9).map((b) => range(9).map((k) => (((b / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + (b % 3) * 3 + (k % 3))),
];
/** Each cell's row, column and box unit. */
export const UNITS_OF: number[][] = range(81).map((i) => [rowOf(i), 9 + colOf(i), 18 + boxOf(i)]);
/** The 20 cells that share a unit with each cell. */
export const PEERS: number[][] = range(81).map((i) => [...new Set(UNITS_OF[i].flatMap((u) => UNITS[u]))].filter((j) => j !== i));
const sees = (a: number, b: number) => a !== b && (rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b));

export const ALL = 0x1ff;
export const bit = (d: number) => 1 << (d - 1);
export const has = (m: number, d: number) => (m & bit(d)) !== 0;
export const count = (m: number) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
export const digitsOf = (m: number) => { const out: number[] = []; for (let d = 1; d <= 9; d++) if (m & bit(d)) out.push(d); return out; };
const only = (m: number) => 31 - Math.clz32(m) + 1;

/** What still fits in each empty cell (0 for a filled one). */
export function candidates(g: number[]): number[] {
  return g.map((v, i) => {
    if (v) return 0;
    let m = ALL;
    for (const j of PEERS[i]) if (g[j]) m &= ~bit(g[j]);
    return m;
  });
}

/** Cells whose digit repeats in a row, column or box. */
export function conflicts(g: number[]): Set<number> {
  const out = new Set<number>();
  for (const u of UNITS) {
    const seen = new Map<number, number>();
    for (const i of u) {
      if (!g[i]) continue;
      const j = seen.get(g[i]);
      if (j !== undefined) { out.add(i); out.add(j); } else seen.set(g[i], i);
    }
  }
  return out;
}

// ---- random ------------------------------------------------------------------------------

export type Rng = () => number;
/** A seeded generator (sfc32 seeded by cyrb128 of the string): the same seed, the same numbers. */
export function rng(seed: string): Rng {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  let a = (h1 ^ h2 ^ h3 ^ h4) >>> 0, b = (h2 ^ h1) >>> 0, c = (h3 ^ h1) >>> 0, d = (h4 ^ h1) >>> 0;
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], r: Rng): T[] {
  for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  return xs;
}

// ---- the solver ------------------------------------------------------------------------------

/**
 * Backtracking on bitmasks, the cell with the fewest options first. Counts solutions up to
 * `limit`; the first one found lands in `out`. With `r`, digits are tried in a random order
 * (how a full grid is made).
 */
function search(g: number[], limit: number, out?: number[], r?: Rng): number {
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = bit(g[i]);
    if ((rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]) & b) return 0;
    rows[rowOf(i)] |= b; cols[colOf(i)] |= b; boxes[boxOf(i)] |= b;
  }
  const cells = g.slice();
  let found = 0;
  const go = (): boolean => {
    let best = -1, bestM = 0, bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (cells[i]) continue;
      const m = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = count(m);
      if (n < bestN) { best = i; bestM = m; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { if (!found && out) out.splice(0, 81, ...cells); return ++found >= limit; }
    if (!bestN) return false;
    const ds = digitsOf(bestM);
    if (r) shuffle(ds, r);
    const ro = rowOf(best), co = colOf(best), bo = boxOf(best);
    for (const d of ds) {
      const b = bit(d);
      cells[best] = d; rows[ro] |= b; cols[co] |= b; boxes[bo] |= b;
      const stop = go();
      cells[best] = 0; rows[ro] &= ~b; cols[co] &= ~b; boxes[bo] &= ~b;
      if (stop) return true;
    }
    return false;
  };
  go();
  return found;
}

/** How many answers the grid has, counting no further than `limit`. */
export const countSolutions = (g: number[], limit = 2) => search(g, limit);
/** The answer, or null when there is none. */
export function solve(g: number[]): number[] | null {
  const out: number[] = [];
  return search(g, 1, out) ? out : null;
}

// ---- solving like a person ---------------------------------------------------------------------

export type Tech =
  | "full-house" | "hidden-single" | "naked-single"
  | "pointing" | "claiming" | "naked-pair" | "hidden-pair" | "naked-triple" | "hidden-triple"
  | "x-wing" | "swordfish" | "xy-wing";
export const TECH_LEVEL: Record<Tech, number> = {
  "full-house": 1, "hidden-single": 1, "naked-single": 2,
  pointing: 3, claiming: 3, "naked-pair": 3, "hidden-pair": 3, "naked-triple": 3, "hidden-triple": 3,
  "x-wing": 4, swordfish: 4, "xy-wing": 4,
};

/**
 * One deduction. `place` puts a digit in a cell; `elim` takes digits out of cells' candidates.
 * `unit` is where it happens (a unit index), `cells` the cells it is about (a pair, a wing, the
 * corners of an X-wing), `digits` its digits, `lines` a fish's base units.
 */
export type Step = {
  tech: Tech;
  place?: { cell: number; digit: number };
  elim?: { cell: number; digit: number }[];
  unit?: number;
  cells: number[];
  digits: number[];
  lines?: number[];
};

function* combos<T>(xs: T[], n: number, from = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === n) { yield acc.slice(); return; }
  for (let i = from; i <= xs.length - (n - acc.length); i++) { acc.push(xs[i]); yield* combos(xs, n, i + 1, acc); acc.pop(); }
}
const elimsOf = (cand: number[], cells: number[], mask: number) =>
  cells.flatMap((cell) => digitsOf(cand[cell] & mask).map((digit) => ({ cell, digit })));
/** Units in the order a person looks: boxes, then rows, then columns. */
const LOOK = [...range(9).map((b) => 18 + b), ...range(18)];

function fullHouse(g: number[], cand: number[]): Step | null {
  for (const u of LOOK) {
    const empty = UNITS[u].filter((i) => !g[i]);
    if (empty.length === 1 && count(cand[empty[0]]) === 1) {
      const digit = only(cand[empty[0]]);
      return { tech: "full-house", place: { cell: empty[0], digit }, unit: u, cells: empty, digits: [digit] };
    }
  }
  return null;
}
function hiddenSingle(g: number[], cand: number[]): Step | null {
  for (const u of LOOK) {
    for (let d = 1; d <= 9; d++) {
      let at = -1, n = 0;
      for (const i of UNITS[u]) if (!g[i] && has(cand[i], d)) { at = i; n++; }
      if (n === 1 && !UNITS[u].some((i) => g[i] === d)) return { tech: "hidden-single", place: { cell: at, digit: d }, unit: u, cells: [at], digits: [d] };
    }
  }
  return null;
}
function nakedSingle(g: number[], cand: number[]): Step | null {
  for (let i = 0; i < 81; i++) if (!g[i] && count(cand[i]) === 1) return { tech: "naked-single", place: { cell: i, digit: only(cand[i]) }, cells: [i], digits: [only(cand[i])] };
  return null;
}
/** Pointing: a digit's places in a box all on one line clear it from the rest of the line. Claiming: the other way round. */
function locked(g: number[], cand: number[]): Step | null {
  for (let b = 18; b < 27; b++) for (let d = 1; d <= 9; d++) {
    const at = UNITS[b].filter((i) => !g[i] && has(cand[i], d));
    if (at.length < 2) continue;
    for (const line of [rowOf(at[0]), 9 + colOf(at[0])]) {
      if (!at.every((i) => UNITS_OF[i].includes(line))) continue;
      const elim = elimsOf(cand, UNITS[line].filter((i) => !g[i] && boxOf(i) !== b - 18), bit(d));
      if (elim.length) return { tech: "pointing", elim, unit: b, cells: at, digits: [d], lines: [line] };
    }
  }
  for (let line = 0; line < 18; line++) for (let d = 1; d <= 9; d++) {
    const at = UNITS[line].filter((i) => !g[i] && has(cand[i], d));
    if (at.length < 2 || !at.every((i) => boxOf(i) === boxOf(at[0]))) continue;
    const box = 18 + boxOf(at[0]);
    const elim = elimsOf(cand, UNITS[box].filter((i) => !g[i] && !UNITS_OF[i].includes(line)), bit(d));
    if (elim.length) return { tech: "claiming", elim, unit: line, cells: at, digits: [d], lines: [box] };
  }
  return null;
}
function nakedSubset(g: number[], cand: number[], n: number): Step | null {
  for (const u of LOOK) {
    const open = UNITS[u].filter((i) => !g[i]);
    const small = open.filter((i) => count(cand[i]) >= 2 && count(cand[i]) <= n);
    for (const set of combos(small, n)) {
      const m = set.reduce((a, i) => a | cand[i], 0);
      if (count(m) !== n) continue;
      const elim = elimsOf(cand, open.filter((i) => !set.includes(i)), m);
      if (elim.length) return { tech: n === 2 ? "naked-pair" : "naked-triple", elim, unit: u, cells: set, digits: digitsOf(m) };
    }
  }
  return null;
}
function hiddenSubset(g: number[], cand: number[], n: number): Step | null {
  for (const u of LOOK) {
    const open = UNITS[u].filter((i) => !g[i]);
    const where = (d: number) => open.filter((i) => has(cand[i], d));
    const ds = range(9).map((k) => k + 1).filter((d) => { const w = where(d).length; return w >= 2 && w <= n; });
    for (const set of combos(ds, n)) {
      const cells = [...new Set(set.flatMap(where))];
      if (cells.length !== n) continue;
      const keep = set.reduce((a, d) => a | bit(d), 0);
      const elim = elimsOf(cand, cells, ALL & ~keep);
      if (elim.length) return { tech: n === 2 ? "hidden-pair" : "hidden-triple", elim, unit: u, cells, digits: set };
    }
  }
  return null;
}
/** X-wing (n = 2) and swordfish (n = 3), on rows and then on columns. */
function fish(g: number[], cand: number[], n: number): Step | null {
  for (const base of [0, 9]) {
    for (let d = 1; d <= 9; d++) {
      const lines = range(9).map((k) => base + k).filter((l) => { const c = UNITS[l].filter((i) => !g[i] && has(cand[i], d)).length; return c >= 2 && c <= n; });
      for (const set of combos(lines, n)) {
        const cells = set.flatMap((l) => UNITS[l].filter((i) => !g[i] && has(cand[i], d)));
        const crossing = [...new Set(cells.map((i) => (base ? rowOf(i) : 9 + colOf(i))))];
        if (crossing.length !== n) continue;
        const elim = elimsOf(cand, crossing.flatMap((c) => UNITS[c].filter((i) => !g[i] && !set.some((l) => UNITS_OF[i].includes(l)))), bit(d));
        if (elim.length) return { tech: n === 2 ? "x-wing" : "swordfish", elim, cells, digits: [d], lines: set };
      }
    }
  }
  return null;
}
/** A two-digit pivot (xy) seeing two-digit wings xz and yz: whichever the pivot is, a wing is z, so a cell seeing both wings is not z. */
function xyWing(g: number[], cand: number[]): Step | null {
  const pairs = range(81).filter((i) => !g[i] && count(cand[i]) === 2);
  for (const p of pairs) {
    const wings = pairs.filter((w) => sees(p, w) && count(cand[w] & cand[p]) === 1);
    for (const [a, b] of combos(wings, 2)) {
      const za = cand[a] & ~cand[p], zb = cand[b] & ~cand[p];
      if (za !== zb || (cand[a] & cand[p]) === (cand[b] & cand[p])) continue;
      const elim = elimsOf(cand, range(81).filter((i) => !g[i] && i !== p && sees(i, a) && sees(i, b)), za);
      if (elim.length) return { tech: "xy-wing", elim, cells: [p, a, b], digits: [...digitsOf(cand[p]), only(za)] };
    }
  }
  return null;
}

/** The simplest deduction that makes progress on this grid with these candidates, or null. */
export function findStep(g: number[], cand: number[]): Step | null {
  return fullHouse(g, cand) ?? hiddenSingle(g, cand) ?? nakedSingle(g, cand) ?? locked(g, cand)
    ?? nakedSubset(g, cand, 2) ?? hiddenSubset(g, cand, 2) ?? nakedSubset(g, cand, 3) ?? hiddenSubset(g, cand, 3)
    ?? fish(g, cand, 2) ?? xyWing(g, cand) ?? fish(g, cand, 3);
}

/** A step carried out on the grid and candidates (in place). */
export function apply(g: number[], cand: number[], s: Step) {
  if (s.place) {
    const { cell, digit } = s.place;
    g[cell] = digit;
    cand[cell] = 0;
    for (const j of PEERS[cell]) cand[j] &= ~bit(digit);
  }
  for (const e of s.elim ?? []) cand[e.cell] &= ~bit(e.digit);
}

/**
 * How hard the puzzle is to solve by hand: the hardest technique it needed (1 to 4, the
 * difficulties' order), 0 when these techniques cannot finish it; and how often each was used.
 */
export function grade(givens: number[]): { level: number; used: Partial<Record<Tech, number>> } {
  const g = givens.slice(), cand = candidates(g), used: Partial<Record<Tech, number>> = {};
  let level = 1;
  for (;;) {
    if (g.every(Boolean)) return { level, used };
    const s = findStep(g, cand);
    if (!s) return { level: 0, used };
    used[s.tech] = (used[s.tech] ?? 0) + 1;
    level = Math.max(level, TECH_LEVEL[s.tech]);
    apply(g, cand, s);
  }
}
export const diffOfLevel = (level: number): Diff | undefined => DIFFS[level - 1];

// ---- making puzzles ----------------------------------------------------------------------------

export type Made = { givens: number[]; solution: number[]; diff: Diff };

/** One try: a random full grid dug down to a unique puzzle, graded. */
export function attempt(r: Rng, diff: Diff): Made | null {
  const solution: number[] = [];
  search(new Array(81).fill(0), 1, solution, r);
  const g = solution.slice();
  let clues = 81;
  for (const i of shuffle(range(41), r)) {
    const j = 80 - i, lose = i === j ? 1 : 2;
    if (clues - lose < MIN_CLUES[diff]) continue;
    const a = g[i], b = g[j];
    g[i] = 0; g[j] = 0;
    if (countSolutions(g, 2) === 1) clues -= lose;
    else { g[i] = a; g[j] = b; }
  }
  const { level, used } = grade(g);
  if (level !== LEVEL[diff]) return null;
  // A hard or expert puzzle with a single tricky moment reads as a medium one: it needs a few.
  const tricky = Object.entries(used).reduce((n, [t, k]) => n + (TECH_LEVEL[t as Tech] >= 3 ? k! : 0), 0);
  return tricky >= (TRICKY[diff] ?? 0) ? { givens: g, solution, diff } : null;
}

/**
 * A puzzle of the difficulty from the seed. `pause` is awaited between tries so a long
 * search (an expert grid takes a few dozen) never holds the process for long.
 */
export async function generate(seed: string, diff: Diff, pause: () => Promise<void> = async () => {}): Promise<Made> {
  const r = rng(`${seed}:${diff}`);
  for (let k = 0; ; k++) {
    const made = attempt(r, diff);
    if (made) return made;
    if (k % 2 === 1) await pause();
  }
}

export const toText = (g: number[]) => g.join("");
export const fromText = (s: string) => [...s].slice(0, 81).map((c) => Number(c) || 0);
