// The run: a player on a circle round the centre, walls closing in on it, the
// world turning. Pure and seeded (no DOM, no clock): `step` moves it one tick,
// so the page, the bot, the tests and the screenshots all play the same game.
//
// Geometry. Angles are world radians; the world's turn (`rot`) is only how it
// is drawn, so it never moves anything. A wall covers one side of the polygon
// the centre had when it appeared: the angles a0..a1 and, along that side's
// normal, the apothem band r..r+len. The player is a point on the circle of
// radius FEEL.orbit; it is inside a wall when its angle is in the wall's and
// its distance along the wall's normal is in the band. Walls close in at the
// stage's speed; turning into a wall stops you at its edge, a wall reaching
// you ends the run.
//
// Rhythm. Patterns are rows of walls with times in seconds of *arrival* at
// the player. Every row's spacing is worked out from the move it asks for
// (how many sides the gap jumps, at the turning speed) plus the stage's
// margin, so a pattern is fair by construction; arrivals snap to the music's
// sixteenth notes, so the walls land on the beat.
import { FEEL, HYPER, RANKS, STAGES, rankAt, type PatternId, type Stage, type StageId } from "./content.ts";

export const DT = 1 / 240;
const TAU = Math.PI * 2;

export type Wall = { a0: number; a1: number; r: number; len: number };
export type Ev =
  | { type: "rank"; rank: number }
  | { type: "flip"; surge: boolean }
  | { type: "morph"; n: number }
  | { type: "pattern"; id: PatternId }
  | { type: "death" };

export type Opts = { stage: StageId; hyper?: boolean; seed: number };
export type Input = { dir: -1 | 0 | 1; focus?: boolean };

type Row = { at: number; sides: number[]; thick: number; n: number };

export type State = {
  stage: Stage; hyper: boolean; seed: number; rng: number;
  t: number; dead: boolean;
  /** The player's angle, and which way it last turned (the page leans it). */
  a: number; dir: number;
  /** The centre's sides now and before the last change, and when it changed. */
  n: number; nFrom: number; morphAt: number;
  walls: Wall[];
  /** Rows planned, by arrival time. */
  rows: Row[];
  /** When the next pattern's first row arrives. */
  next: number;
  last: PatternId | "";
  /** The world's turn (drawn only): angle, speed, which way, the next reversal, a surge's end. */
  rot: number; spin: number; way: 1 | -1; flipAt: number; surgeTo: number;
  rank: number;
  events: Ev[];
};

// ---- chance ---------------------------------------------------------------------------------------------------------

/** mulberry32 on the state's own number, so a state copied is a run copied. */
export function rand(s: { rng: number }) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (s: State, lo: number, hi: number) => lo + rand(s) * (hi - lo);
const int = (s: State, lo: number, hi: number) => lo + Math.floor(rand(s) * (hi - lo + 1));
const mod = (x: number, m: number) => ((x % m) + m) % m;

// ---- the stage's dials over a run ---------------------------------------------------------------------------------------

export const beat = (s: State) => 60 / s.stage.bpm;
export function speed(s: State, t = s.t) {
  const ramp = Math.min(t, 60) * FEEL.rampTo60 + Math.max(0, t - 60) * FEEL.rampAfter;
  return s.stage.speed * (s.hyper ? HYPER.speed : 1) * (1 + ramp);
}
const margin = (s: State) => s.stage.margin * (s.hyper ? HYPER.margin : 1) * (s.t > 60 ? 0.9 : 1);
const spinOf = (s: State) => s.stage.rot * (s.hyper ? HYPER.rot : 1) * (1 + s.t * FEEL.spinRamp);

// ---- start ----------------------------------------------------------------------------------------------------------

export function create(o: Opts): State {
  const stage = STAGES.find((x) => x.id === o.stage)!;
  const s: State = {
    stage, hyper: !!o.hyper, seed: o.seed >>> 0, rng: o.seed >>> 0,
    t: 0, dead: false, a: 0, dir: 0,
    n: stage.sides[0], nFrom: stage.sides[0], morphAt: -9,
    walls: [], rows: [], next: 0, last: "",
    rot: 0, spin: 0, way: 1, flipAt: 0, surgeTo: 0, rank: 0, events: [],
  };
  s.a = (Math.floor(rand(s) * s.n) + 0.5) * (TAU / s.n);
  s.rot = rand(s) * TAU;
  s.way = rand(s) < 0.5 ? 1 : -1;
  s.spin = s.way * spinOf(s);
  s.flipAt = between(s, ...stage.flip);
  // The first row comes in from the edge after a breath.
  s.next = snap(s, (FEEL.spawn - FEEL.orbit) / speed(s) + 0.6);
  return s;
}

/** Up to the next sixteenth note of the run's own beat. */
const snap = (s: State, t: number) => { const g = beat(s) / 4; return Math.ceil(t / g - 1e-6) * g; };

// ---- a tick ---------------------------------------------------------------------------------------------------------

export function step(s: State, inp: Input) {
  if (s.dead) return;
  s.t += DT;
  turnWorld(s);
  move(s, inp);
  const v = speed(s);
  for (const w of s.walls) w.r -= v * DT;
  s.walls = s.walls.filter((w) => w.r + w.len > 0);
  plan(s);
  spawn(s, v);
  if (s.walls.some((w) => inside(w, s.a))) { s.dead = true; s.events.push({ type: "death" }); return; }
  const r = rankAt(s.t);
  if (r > s.rank) { s.rank = r; s.events.push({ type: "rank", rank: r }); }
}

/** Whether a point on the orbit at angle `a` is inside a wall. */
export function inside(w: Wall, a: number, orbit = FEEL.orbit) {
  const d = mod(a - w.a0, TAU), span = w.a1 - w.a0;
  if (d > span) return false;
  const x = orbit * Math.cos(d - span / 2);
  return x >= w.r && x <= w.r + w.len;
}
export const blocked = (s: State, a: number) => s.walls.some((w) => inside(w, a));

function move(s: State, inp: Input) {
  s.dir = inp.dir;
  if (!inp.dir) return;
  const to = s.a + inp.dir * (inp.focus ? FEEL.focus : FEEL.turn) * DT;
  if (!blocked(s, to)) { s.a = mod(to, TAU); return; }
  // Into a wall's side: go as far as it lets you, so you sit flush against it.
  let lo = 0, hi = 1;
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (blocked(s, s.a + (to - s.a) * m)) hi = m; else lo = m; }
  s.a = mod(s.a + (to - s.a) * lo, TAU);
}

function turnWorld(s: State) {
  if (s.t >= s.flipAt) {
    s.way = s.way === 1 ? -1 : 1;
    const surge = rand(s) < s.stage.surge;
    if (surge) s.surgeTo = s.t + beat(s) * 2;
    s.flipAt = s.t + between(s, ...s.stage.flip);
    s.events.push({ type: "flip", surge });
  }
  const want = s.way * spinOf(s) * (s.t < s.surgeTo ? 2.3 : 1);
  // A reversal snaps through zero quickly but not instantly: the eye follows it.
  s.spin += (want - s.spin) * Math.min(1, DT * 7);
  s.rot = mod(s.rot + s.spin * DT, TAU);
}

function spawn(s: State, v: number) {
  const lead = (FEEL.spawn - FEEL.orbit) / v;
  while (s.rows.length && s.rows[0].at - lead <= s.t) {
    const row = s.rows.shift()!;
    const side = TAU / row.n;
    for (const i of row.sides) {
      const k = mod(i, row.n);
      s.walls.push({ a0: k * side, a1: (k + 1) * side, r: FEEL.orbit + v * (row.at - s.t), len: row.thick * v });
    }
  }
}

// ---- patterns -------------------------------------------------------------------------------------------------------

/** Plans the next pattern once its first row is about to show. */
function plan(s: State) {
  const lead = (FEEL.spawn - FEEL.orbit) / speed(s);
  if (s.t < s.next - lead - 0.05) return;
  const st = s.stage;
  if (st.sides.length > 1 && s.t > 3 && rand(s) < st.morph) {
    const opts = st.sides.filter((x) => x !== s.n);
    s.nFrom = s.n; s.n = opts[int(s, 0, opts.length - 1)]; s.morphAt = s.t;
    s.events.push({ type: "morph", n: s.n });
  }
  const id = pick(s);
  const rows = PATTERNS[id](ctx(s));
  const shift = int(s, 0, s.n - 1), flip = rand(s) < 0.5;
  let end = s.next;
  for (const r of rows) {
    const at = snap(s, s.next + r.at);
    s.rows.push({ at, n: s.n, thick: r.thick, sides: r.sides.map((i) => mod((flip ? -i : i) + shift, s.n)) });
    end = Math.max(end, at + r.thick);
  }
  s.rows.sort((a, b) => a.at - b.at);
  // The next pattern may need a half turn from wherever this one left you.
  s.next = snap(s, end + travel(s.n, Math.floor(s.n / 2)) + margin(s) + 0.08);
  s.last = id;
  s.events.push({ type: "pattern", id });
}

function pick(s: State): PatternId {
  const ws = Object.entries(s.stage.patterns) as [PatternId, number][];
  // Early on, only the plain ones: the first seconds teach the turn.
  const pool = ws.filter(([id]) => id !== s.last && (s.t > 6 || id === "barrage" || id === "run" || id === "alt"));
  const total = pool.reduce((a, [, w]) => a + w, 0);
  let x = rand(s) * total;
  for (const [id, w] of pool) if ((x -= w) < 0) return id;
  return pool[0][0];
}

/** The seconds to turn d sides of an n-gon at full speed. */
export const travel = (n: number, d: number) => (Math.abs(d) * TAU) / n / FEEL.turn;

type P = { at: number; sides: number[]; thick: number };
type Ctx = {
  n: number; s: State;
  /** Thickness of an ordinary row, seconds. */
  thin: number;
  /** Rows to lay, by intensity: grows with the run and in hyper. */
  more: (lo: number, hi: number) => number;
  /** Lays rows one after another, each spaced for the move from the previous gap. */
  lay: (gaps: number[][], thick?: number) => P[];
  /** Up to the sixteenth: spacings round up, so snapping never tightens a row. */
  q: (t: number) => number;
};

const all = (n: number) => Array.from({ length: n }, (_, i) => i);
const except = (n: number, ...gaps: number[]) => all(n).filter((i) => !gaps.some((g) => mod(g, n) === i));
/** Sides to turn from anywhere in one row's gap to the nearest gap of the next: wherever you were, there is time. */
function jump(n: number, from: number[], to: number[]) {
  let worst = 0;
  for (const a of from) {
    let best = n;
    for (const b of to) { const d = mod(b - a, n); best = Math.min(best, d, n - d); }
    worst = Math.max(worst, best);
  }
  return worst;
}

function ctx(s: State): Ctx {
  const n = s.n, m = margin(s), b = beat(s);
  const k = Math.min(1, s.t / 70) + (s.hyper ? 0.25 : 0);
  const thin = Math.max(0.09, b * 0.36), g = b / 4;
  const q = (t: number) => Math.ceil(t / g - 1e-6) * g;
  return {
    n, s, thin, q,
    more: (lo, hi) => Math.round(lo + (hi - lo) * Math.min(1, k * (0.6 + rand(s) * 0.6))),
    lay(gaps, thick = thin) {
      const rows: P[] = [];
      let at = 0;
      gaps.forEach((free, i) => {
        if (i) at += q(thick + travel(n, jump(n, gaps[i - 1], free)) + m);
        rows.push({ at, sides: except(n, ...free), thick });
      });
      return rows;
    },
  };
}

const PATTERNS: Record<PatternId, (c: Ctx) => P[]> = {
  /** One wall with a single gap. */
  barrage: (c) => c.lay([[0]], c.thin * 1.3),
  /** Gaps that jump around: read the next one while passing this. */
  run: (c) => {
    const gaps = [[0]];
    for (let i = c.more(2, 5); i > 0; i--) gaps.push([gaps[gaps.length - 1][0] + (rand(c.s) < 0.5 ? -1 : 1) * int(c.s, 1, Math.floor(c.n / 2))]);
    return c.lay(gaps);
  },
  /** Every other side, then the others. */
  alt: (c) => {
    const rows: P[] = [];
    const count = c.more(3, 6), step = c.q(c.thin + travel(c.n, 1) + margin(c.s));
    for (let i = 0; i < count; i++) {
      const sides = all(c.n).filter((x) => x % 2 === i % 2 && !(c.n % 2 && x === c.n - 1));
      rows.push({ at: i * step, sides, thick: c.thin });
    }
    return rows;
  },
  /** A gap that walks round one side at a time: turn with it. */
  spiral: (c) => {
    const way = rand(c.s) < 0.5 ? 1 : -1;
    return c.lay(Array.from({ length: c.more(c.n, c.n * 2) }, (_, i) => [i * way]), c.thin * 0.8);
  },
  /** The gap rocks between two neighbours. */
  zigzag: (c) => c.lay(Array.from({ length: c.more(4, 8) }, (_, i) => [i % 2]), c.thin * 0.85),
  /** A long wall you cannot cross, and gaps either side of it: go all the way round. */
  tunnel: (c) => {
    const rows = c.lay(Array.from({ length: c.more(2, 4) }, (_, i) => [i % 2 ? 1 : -1]));
    // Laid as if crossing the long wall were allowed; spread them for the long way round.
    const step = c.q(c.thin + travel(c.n, c.n - 2) + margin(c.s));
    rows.forEach((r, i) => (r.at = i * step));
    const last = rows[rows.length - 1];
    rows.push({ at: 0, sides: [0], thick: last.at + last.thick });
    return rows;
  },
  /** Two gaps, mirrored, closing in or opening out. */
  mirror: (c) => {
    const h = Math.floor(c.n / 2), gaps: number[][] = [];
    for (let i = 0; i <= Math.min(h, c.more(2, h)); i++) gaps.push([i, -i]);
    return c.lay(rand(c.s) < 0.5 ? gaps : gaps.reverse());
  },
  /** Loose walls, a few at a time, quick. */
  scatter: (c) => {
    const gaps: number[][] = [];
    for (let i = c.more(3, 6); i > 0; i--) {
      const walled = int(c.s, 2, c.n - 2), start = int(c.s, 0, c.n - 1);
      gaps.push(all(c.n).filter((x) => mod(x - start, c.n) >= walled).map((x) => x));
    }
    return c.lay(gaps, c.thin * 0.9);
  },
  /** Two long rails split the round in halves; the gaps dance inside one of them. */
  rails: (c) => {
    const h = Math.floor(c.n / 2), inside = all(c.n).filter((x) => x > 0 && x < h);
    const gaps: number[][] = [];
    for (let i = c.more(3, 6), g = 0; i > 0; i--, g = (g + int(c.s, 1, Math.max(1, inside.length - 1))) % inside.length) gaps.push([inside[g]]);
    const rows = c.lay(gaps, c.thin * 0.9);
    const last = rows[rows.length - 1], long = last.at + last.thick;
    rows.push({ at: 0, sides: [0], thick: long }, { at: 0, sides: [h], thick: long });
    return rows;
  },
  /** A wide gap spinning fast: keep turning, never stop. */
  whirl: (c) => {
    const way = rand(c.s) < 0.5 ? 1 : -1;
    return c.lay(Array.from({ length: c.more(c.n + 2, c.n * 3) }, (_, i) => [i * way, i * way + 1]), c.thin * 0.6);
  },
};

/** Elapsed, for the clock: seconds and hundredths. */
export const clock = (t: number) => `${Math.floor(t)}.${String(Math.floor((t % 1) * 100)).padStart(2, "0")}`;
export const rankName = (r: number) => RANKS[r].name;
export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];
