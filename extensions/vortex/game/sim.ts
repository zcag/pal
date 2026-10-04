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
// Choreography. A stage's song has a form (content.ts): intro, build, drop,
// break. The walls follow it: plain patterns in an intro, tightening ones in
// a build, the stage's whole repertoire in a drop, whose first downbeat lands
// a slam (a wall all round but one gap), room to breathe in a break. Shapes
// change and the world reverses on bar lines. With the same seed every run of
// a stage is the same chart, which is what makes a ghost of your best exact.
//
// Endless: the stages in turn, each for its written minute, then their hypers;
// the beat grid and the sections restart at each change (`base`).
import { FEEL, HYPER, RANKS, STAGES, rankAt, sectionAt, type PatternId, type SectionKind, type Stage, type StageId } from "./content.ts";

export const DT = 1 / 240;
const TAU = Math.PI * 2;
/** How near a wall's edge (rad) counts as skimming it as it passes. */
export const GRAZE = 0.06;

export type Wall = {
  id: number; a0: number; a1: number; r: number; len: number;
  /** Nearest the player came to it while it crossed the orbit (rad), and which edge. */
  near?: number; edge?: number;
};
export type Ev =
  | { type: "rank"; rank: number }
  | { type: "flip"; surge: boolean }
  | { type: "morph"; n: number }
  | { type: "pattern"; id: PatternId }
  | { type: "section"; kind: SectionKind; energy: number; n: number; beats: number }
  | { type: "graze"; close: number; edge: number }
  | { type: "stage"; stage: StageId; hyper: boolean }
  | { type: "death" };

export type Opts = { stage: StageId; hyper?: boolean; seed: number; endless?: boolean };
export type Input = { dir: -1 | 0 | 1; focus?: boolean };

type Row = { at: number; sides: number[]; thick: number; n: number };

export type State = {
  stage: Stage; hyper: boolean; seed: number; rng: number;
  t: number; dead: boolean;
  /** The player's angle, and which way it last turned (the page leans it). */
  a: number; dir: number;
  /** The centre's sides now and before the last change, and when it changed. */
  n: number; nFrom: number; morphAt: number;
  walls: Wall[]; ids: number;
  /** Rows planned, by arrival time. */
  rows: Row[];
  /** When the next pattern's first row arrives. */
  next: number;
  last: PatternId | "";
  /** The world's turn (drawn only): angle, speed, which way, the next reversal, a surge's end. */
  rot: number; spin: number; way: 1 | -1; flipAt: number; surgeTo: number;
  rank: number;
  /** Where this stage's beat grid and song began (endless moves it on), and the section counted. */
  base: number; section: number;
  endless: boolean; leg: number;
  /** For medals: near misses, and whether Shift was ever held. */
  grazes: number; focused: boolean;
  /** No walls stop or end you (a practice run fast-forwarding to its start). */
  immune: boolean;
  /** The wall that ended the run. */
  killer: Wall | null;
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
const int = (s: State, lo: number, hi: number) => lo + Math.floor(rand(s) * (hi - lo + 1));
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** A stage's chart: the same seed every run, so its walls are learnable and a ghost is exact. */
export const chartSeed = (stage: StageId, hyper: boolean) => [...stage].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), hyper ? 0x9e3779b9 : 0x811c9dc5) >>> 0;
/** Endless runs the stages in order, then their hypers, the last hyper for good. */
export const LEGS = [...STAGES.map((x) => ({ stage: x.id, hyper: false })), ...STAGES.map((x) => ({ stage: x.id, hyper: true }))];

// ---- the stage's dials over a run ---------------------------------------------------------------------------------------

export const beat = (s: State) => 60 / s.stage.bpm;
/** Seconds into this stage (a run, or an endless leg). */
const local = (s: State, t = s.t) => t - s.base;
export function speed(s: State, t = s.t) {
  const u = local(s, t), ramp = Math.min(u, 60) * FEEL.rampTo60 + Math.max(0, u - 60) * FEEL.rampAfter;
  return s.stage.speed * (s.hyper ? HYPER.speed : 1) * (1 + ramp);
}
/** The song's section at a time. */
export const sectionOf = (s: State, t = s.t) => sectionAt(s.stage.form, Math.max(0, local(s, t)) / beat(s));
const margin = (s: State, kind: SectionKind = sectionOf(s, s.next).kind) =>
  s.stage.margin * (s.hyper ? HYPER.margin : 1) * (local(s) > 60 ? 0.9 : 1) * (kind === "break" || kind === "intro" ? 1.3 : 1);
const spinOf = (s: State) => s.stage.rot * (s.hyper ? HYPER.rot : 1) * (1 + local(s) * FEEL.spinRamp);
/** Run-time of the bar line at or after t. */
const barAfter = (s: State, t: number) => { const bar = beat(s) * 4; return s.base + Math.ceil((t - s.base) / bar - 1e-6) * bar; };

// ---- start ----------------------------------------------------------------------------------------------------------

export function create(o: Opts): State {
  const stage = STAGES.find((x) => x.id === o.stage)!;
  const s: State = {
    stage, hyper: !!o.hyper, seed: o.seed >>> 0, rng: o.seed >>> 0,
    t: 0, dead: false, a: 0, dir: 0,
    n: stage.sides[0], nFrom: stage.sides[0], morphAt: -9,
    walls: [], ids: 0, rows: [], next: 0, last: "",
    rot: 0, spin: 0, way: 1, flipAt: 0, surgeTo: 0, rank: 0,
    base: 0, section: -1, endless: !!o.endless, leg: 0,
    grazes: 0, focused: false, immune: false, killer: null, events: [],
  };
  s.a = (Math.floor(rand(s) * s.n) + 0.5) * (TAU / s.n);
  s.rot = rand(s) * TAU;
  s.way = rand(s) < 0.5 ? 1 : -1;
  s.spin = s.way * spinOf(s);
  s.flipAt = nextFlip(s);
  // The first row comes in from the edge after a breath.
  s.next = snap(s, (FEEL.spawn - FEEL.orbit) / speed(s) + 0.6);
  return s;
}

/** Up to the next sixteenth note of this stage's beat. */
const snap = (s: State, t: number) => { const g = beat(s) / 4; return s.base + Math.ceil((t - s.base) / g - 1e-6) * g; };
/** The next reversal: on a bar line some bars on. */
const nextFlip = (s: State) => barAfter(s, s.t + s.stage.flip[0] + rand(s) * (s.stage.flip[1] - s.stage.flip[0]));

// ---- a tick ---------------------------------------------------------------------------------------------------------

export function step(s: State, inp: Input) {
  if (s.dead) return;
  s.t += DT;
  if (s.endless) leg(s);
  sections(s);
  turnWorld(s);
  move(s, inp);
  const v = speed(s);
  for (const w of s.walls) w.r -= v * DT;
  passing(s);
  s.walls = s.walls.filter((w) => w.r + w.len > 0);
  plan(s);
  spawn(s, v);
  if (!s.immune) {
    const k = s.walls.find((w) => inside(w, s.a));
    if (k) { s.dead = true; s.killer = { ...k }; s.events.push({ type: "death" }); return; }
  }
  const r = rankAt(s.endless ? s.t : local(s));
  if (r > s.rank) { s.rank = r; s.events.push({ type: "rank", rank: r }); }
}

/** Whether a point on the orbit at angle `a` is inside a wall. */
export function inside(w: Wall, a: number, orbit = FEEL.orbit) {
  const d = mod(a - w.a0, TAU), span = w.a1 - w.a0;
  if (d > span) return false;
  const x = orbit * Math.cos(d - span / 2);
  return x >= w.r && x <= w.r + w.len;
}
export const blocked = (s: State, a: number) => !s.immune && s.walls.some((w) => inside(w, a));

function move(s: State, inp: Input) {
  s.dir = inp.dir;
  if (inp.focus) s.focused = true;
  if (!inp.dir) return;
  const to = s.a + inp.dir * (inp.focus ? FEEL.focus : FEEL.turn) * DT;
  if (!blocked(s, to)) { s.a = mod(to, TAU); return; }
  // Into a wall's side: go as far as it lets you, so you sit flush against it.
  let lo = 0, hi = 1;
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (blocked(s, s.a + (to - s.a) * m)) hi = m; else lo = m; }
  s.a = mod(s.a + (to - s.a) * lo, TAU);
}

/** Near misses: how close you came to each wall while it crossed the orbit, told once it has gone by. */
function passing(s: State) {
  for (const w of s.walls) {
    const span = w.a1 - w.a0, low = FEEL.orbit * Math.cos(span / 2);
    if (w.r > FEEL.orbit) continue;
    if (w.r + w.len >= low) {
      const d = mod(s.a - w.a0, TAU);
      if (d <= span) continue;
      const before = TAU - d, after = d - span, gap = Math.min(before, after);
      if (w.near === undefined || gap < w.near) { w.near = gap; w.edge = before < after ? w.a0 : w.a1; }
    } else if (w.near !== undefined && w.near >= 0) {
      if (w.near < GRAZE && !s.immune) { s.grazes++; s.events.push({ type: "graze", close: 1 - w.near / GRAZE, edge: w.edge! }); }
      w.near = -1;
    }
  }
}

function sections(s: State) {
  const sec = sectionOf(s);
  if (sec.n === s.section) return;
  s.section = sec.n;
  s.events.push({ type: "section", kind: sec.kind, energy: sec.energy, n: sec.n, beats: sec.len });
  // A drop throws the world into a surge.
  if (sec.kind === "drop" && s.stage.surge > 0) s.surgeTo = s.t + beat(s) * 4;
}

/** Endless: past a stage's written minute, the next stage takes over on the bar line. */
function leg(s: State) {
  const form = s.stage.form, written = form.sections.slice(0, form.loop).reduce((a, x) => a + x.bars * 4, 0) * beat(s);
  if (local(s) < written || s.leg >= LEGS.length - 1) return;
  const next = LEGS[++s.leg];
  s.base += written;
  s.stage = STAGES.find((x) => x.id === next.stage)!;
  s.hyper = next.hyper;
  s.section = -1;
  if (!s.stage.sides.includes(s.n)) { s.nFrom = s.n; s.n = s.stage.sides[0]; s.morphAt = s.t; }
  s.flipAt = nextFlip(s);
  // Rows already planned keep their times; the next pattern waits for the new grid.
  s.next = Math.max(snap(s, s.next), s.t + 0.3);
  s.events.push({ type: "stage", stage: s.stage.id, hyper: s.hyper });
}

function turnWorld(s: State) {
  if (s.t >= s.flipAt) {
    s.way = s.way === 1 ? -1 : 1;
    const surge = rand(s) < s.stage.surge;
    if (surge) s.surgeTo = s.t + beat(s) * 2;
    s.flipAt = nextFlip(s);
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
      s.walls.push({ id: ++s.ids, a0: k * side, a1: (k + 1) * side, r: FEEL.orbit + v * (row.at - s.t), len: row.thick * v });
    }
  }
}

/** Plays a run forward to `t` with no walls in the way (a practice start); the walls are the chart's, whatever you did. */
export function skipTo(s: State, t: number) {
  s.immune = true;
  while (s.t < t) step(s, { dir: 0 });
  s.immune = false;
  s.events.length = 0;
  for (const w of s.walls) w.near = -1;
}

// ---- patterns -------------------------------------------------------------------------------------------------------

/** Plans the next pattern once its first row is about to show. */
function plan(s: State) {
  const lead = (FEEL.spawn - FEEL.orbit) / speed(s);
  if (s.t < s.next - lead - 0.05) return;
  const st = s.stage;
  let sec = sectionOf(s, s.next);
  // A drop starting within a bar: hold this pattern for it, and land a slam on its downbeat.
  const bar = beat(s) * 4, dropAt = s.base + sec.start * beat(s) + sec.len * beat(s);
  const after = sectionOf(s, dropAt + 1e-6);
  let slam = false;
  if (after.kind === "drop" && dropAt - s.next < bar && dropAt > s.next) { s.next = dropAt; sec = after; slam = true; }
  else if (sec.kind === "drop" && Math.abs(s.next - (s.base + sec.start * beat(s))) < 1e-6) slam = true;
  // Shapes change where the music changes: the first pattern of a section.
  const fresh = sec.n !== sectionOf(s, s.next - bar / 2).n;
  if (st.sides.length > 1 && local(s) > 3 && fresh && rand(s) < Math.min(1, st.morph * 2.2)) {
    const opts = st.sides.filter((x) => x !== s.n);
    s.nFrom = s.n; s.n = opts[int(s, 0, opts.length - 1)]; s.morphAt = s.t;
    s.events.push({ type: "morph", n: s.n });
  }
  const id: PatternId = slam ? "barrage" : pick(s, sec.kind);
  const c = ctx(s, sec.kind, sec.energy);
  const rows = slam ? c.lay([[0]], c.thin * 2.2) : PATTERNS[id](c);
  const shift = int(s, 0, s.n - 1), flip = rand(s) < 0.5;
  let end = s.next;
  for (const r of rows) {
    const at = snap(s, s.next + r.at);
    s.rows.push({ at, n: s.n, thick: r.thick, sides: r.sides.map((i) => mod((flip ? -i : i) + shift, s.n)) });
    end = Math.max(end, at + r.thick);
  }
  s.rows.sort((a, b) => a.at - b.at);
  // The next pattern may need a half turn from wherever this one left you; a break leaves room to breathe.
  const rest = sec.kind === "break" ? beat(s) * 2 : sec.kind === "intro" ? beat(s) : 0;
  s.next = snap(s, end + travel(s.n, Math.floor(s.n / 2)) + margin(s, sec.kind) + 0.08 + rest);
  s.last = id;
  s.events.push({ type: "pattern", id });
}

/** What a section deals: plain in an intro and a break, the tightening ones in a build, everything in a drop. */
const PLAIN: PatternId[] = ["barrage", "run", "alt"];
const BUILD: PatternId[] = ["spiral", "zigzag", "whirl", "run", "mirror"];
function pick(s: State, kind: SectionKind): PatternId {
  const ws = (Object.entries(s.stage.patterns) as [PatternId, number][]).filter(([id]) => id !== s.last);
  const pool = kind === "intro" || kind === "break" || local(s) < 6 ? ws.filter(([id]) => PLAIN.includes(id))
    : kind === "build" ? ws.filter(([id]) => BUILD.includes(id))
    : ws;
  const use = pool.length ? pool : ws;
  const total = use.reduce((a, [, w]) => a + w, 0);
  let x = rand(s) * total;
  for (const [id, w] of use) if ((x -= w) < 0) return id;
  return use[0][0];
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
  /** The spare time each row leaves, for this section. */
  m: number;
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

function ctx(s: State, kind: SectionKind, energy: number): Ctx {
  const n = s.n, m = margin(s, kind), b = beat(s);
  // How much a pattern lays: the section's energy, the run's length, hyper.
  const k = Math.min(1, energy * 0.7 + local(s) / 200) + (s.hyper ? 0.25 : 0);
  const thin = Math.max(0.09, b * 0.36), g = b / 4;
  const q = (t: number) => Math.ceil(t / g - 1e-6) * g;
  return {
    n, s, thin, q, m,
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
    const count = c.more(3, 6), step = c.q(c.thin + travel(c.n, 1) + c.m);
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
    const step = c.q(c.thin + travel(c.n, c.n - 2) + c.m);
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
