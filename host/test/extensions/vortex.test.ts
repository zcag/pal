import { expect, test } from "bun:test";
import { CLEAR, FEEL, RANKS, STAGES, sectionAt } from "../../../extensions/vortex/game/content.ts";
import { GRAZE, LEGS, PATTERN_IDS, chartSeed, create, inside, sectionOf, skipTo, step, travel, type State } from "../../../extensions/vortex/game/sim.ts";
import { decide, play, safest } from "../../../extensions/vortex/game/bot.ts";
import { BOARDS, MEDALS_TOTAL, Player, daily, dailyOpen, fresh, ghostOf, ghostStep, keyOf, load, medalCount, open, record, settle, skinOpen, type Keys } from "../../../extensions/vortex/game/meta.ts";

const TAU = Math.PI * 2;
const wall = (a0: number, a1: number, r: number, len: number) => ({ id: 0, a0, a1, r, len });
const ticks = (s: State, n: number, dir: -1 | 0 | 1 = 0) => { for (let i = 0; i < n && !s.dead; i++) step(s, { dir }); };
const run = (t: number, more: Partial<{ grazes: number; focused: boolean }> = {}) => ({ t, grazes: 0, focused: false, ...more });

test("a wall covers its side's angles across its band, and only there", () => {
  const w = wall(0, TAU / 6, 0.9, 0.3);
  expect(inside(w, TAU / 12)).toBe(true);
  expect(inside(w, -0.01)).toBe(false);
  expect(inside(w, TAU / 6 + 0.01)).toBe(false);
  expect(inside({ ...w, r: 1.05 }, TAU / 12)).toBe(false);
  // Near a corner the wall's straight edge is farther out along the orbit: it reaches you there later.
  expect(inside({ ...w, r: 0.95 }, 0.02)).toBe(false);
  expect(inside({ ...w, r: 0.95 }, TAU / 12)).toBe(true);
});

test("turning into a wall's side stops you flush against it; a wall reaching you ends the run, and is kept", () => {
  const s = create({ stage: "pulse", seed: 1 });
  s.rows = []; s.next = 1e9;
  s.a = 0.5;
  s.walls = [wall(0.8, 1.6, 0.8, 0.5)];
  ticks(s, 12, 1); // 50 ms: the wall is still across the orbit
  expect(s.dead).toBe(false);
  expect(s.a).toBeLessThan(0.8);
  expect(s.a).toBeGreaterThan(0.79);
  s.walls = [{ ...wall(0, 1, 1.05, 0.3), id: 7 }];
  ticks(s, 120);
  expect(s.dead).toBe(true);
  expect(s.killer?.id).toBe(7);
  expect(s.events.some((e) => e.type === "death")).toBe(true);
});

test("a stage is its chart: the same seed and keys give the same run", () => {
  const go = () => { const s = create({ stage: "prism", seed: chartSeed("prism", false) }); for (let i = 0; i < 240 * 8; i++) step(s, { dir: i % 400 < 200 ? 1 : -1 }); return s; };
  const a = go(), b = go();
  expect(a.t).toBe(b.t);
  expect(a.a).toBe(b.a);
  expect(a.walls).toEqual(b.walls);
  expect(chartSeed("prism", false)).not.toBe(chartSeed("prism", true));
  expect(chartSeed("prism", false)).not.toBe(chartSeed("drift", false));
});

test("walls never depend on the player: the chart is the same whatever you do", () => {
  const a = create({ stage: "drift", seed: 5 }), b = create({ stage: "drift", seed: 5 });
  a.immune = b.immune = true;
  for (let i = 0; i < 240 * 20; i++) { step(a, { dir: 1 }); step(b, { dir: i % 300 < 150 ? -1 : 0 }); }
  expect(a.walls.map((w) => [w.a0, w.r])).toEqual(b.walls.map((w) => [w.a0, w.r]));
});

test("walls appear at the edge, not mid-screen, and the first comes after a breath", () => {
  const s = create({ stage: "singularity", hyper: true, seed: 5 });
  let first = -1;
  while (s.t < 4 && !s.dead) {
    const before = s.walls.length;
    step(s, { dir: 0 });
    for (const w of s.walls.slice(before)) {
      expect(w.r).toBeGreaterThan(FEEL.spawn - 0.5);
      if (first < 0) first = s.t;
    }
  }
  expect(first).toBeGreaterThan(0.4);
});

test("ranks come at their seconds and tell the page", () => {
  const s = create({ stage: "pulse", seed: 3 });
  s.immune = true;
  const ranks: number[] = [];
  while (s.t < 61) { step(s, { dir: 0 }); for (const e of s.events) if (e.type === "rank") ranks.push(Math.round(s.t)); s.events.length = 0; }
  expect(ranks).toEqual(RANKS.slice(1).map((r) => r.at));
  expect(RANKS[RANKS.length - 1].at).toBe(CLEAR);
});

test("every rank lands on a beat of its stage's song", () => {
  for (const st of STAGES) for (const r of RANKS) expect(((r.at * st.bpm) / 60) % 1).toBe(0);
});

test("a song's form: sections in order, then its loop for good; the written part ends near the clearing minute", () => {
  for (const st of STAGES) {
    const f = st.form, written = f.sections.slice(0, f.loop).reduce((a, x) => a + x.bars * 4, 0);
    expect(sectionAt(f, 0)).toMatchObject({ index: 0, n: 0, start: 0 });
    expect(sectionAt(f, written)).toMatchObject({ index: f.loop, start: written });
    const seconds = (written * 60) / st.bpm;
    expect(seconds).toBeGreaterThan(50);
    expect(seconds).toBeLessThan(66);
    // After the whole form, the loop again: never past the end.
    const all = f.sections.reduce((a, x) => a + x.bars * 4, 0);
    expect(sectionAt(f, all + 1).index).toBe(f.loop);
  }
});

test("the sim tells each section as it starts, and a drop's downbeat lands a slam", () => {
  const s = create({ stage: "pulse", seed: chartSeed("pulse", false) });
  s.immune = true;
  const kinds: string[] = [];
  while (s.t < 35) { step(s, { dir: 0 }); for (const e of s.events) if (e.type === "section") kinds.push(e.kind); s.events.length = 0; }
  expect(kinds.slice(0, 4)).toEqual(["intro", "build", "drop", "break"]);
  // The first drop's downbeat: a wall all round but one gap arrives on it.
  const drop = sectionAt(s.stage.form, 8 * 4).start * (60 / s.stage.bpm);
  const t = create({ stage: "pulse", seed: chartSeed("pulse", false) });
  t.immune = true;
  while (t.t < drop - 2) step(t, { dir: 0 });
  expect(t.rows.some((r) => Math.abs(r.at - drop) < 1e-6 && r.sides.length === t.n - 1)).toBe(true);
});

test("every pattern turns up in some stage", () => {
  const used = new Set(STAGES.flatMap((s) => Object.keys(s.patterns)));
  expect([...used].sort()).toEqual([...PATTERN_IDS].sort());
  expect(travel(6, 3)).toBeCloseTo(Math.PI / FEEL.turn, 9);
});

// A planning bot that sees what a player sees clears every board's chart: the patterns are passable at their speed.
for (const key of BOARDS) {
  test(`the bot clears the chart of ${key}`, () => {
    const hyper = key.endsWith("+"), stage = key.replace("+", "") as State["stage"]["id"];
    const s = play(create({ stage, hyper, seed: chartSeed(stage, hyper) }), CLEAR + 1);
    expect(s.dead).toBe(false);
  });
}

test("near misses: skimming a wall's edge as it passes counts once, keeping clear does not", () => {
  const s = create({ stage: "pulse", seed: 1 });
  s.rows = []; s.next = 1e9;
  s.a = 1.1 + GRAZE / 2;
  s.walls = [{ ...wall(0, 1.1, 1.6, 0.3), id: 1 }, { ...wall(2, 3, 1.6, 0.3), id: 2 }];
  const grazes: number[] = [];
  for (let i = 0; i < 240; i++) { step(s, { dir: 0 }); for (const e of s.events) if (e.type === "graze") grazes.push(e.edge); s.events.length = 0; }
  expect(s.dead).toBe(false);
  expect(grazes).toEqual([1.1]);
  expect(s.grazes).toBe(1);
});

test("endless runs the stages in turn on their bar lines, each a fresh minute", () => {
  const s = create({ stage: "pulse", seed: 9, endless: true });
  s.immune = true;
  const legs: string[] = [];
  while (s.t < 140) { step(s, { dir: 0 }); for (const e of s.events) if (e.type === "stage") legs.push(e.stage + (e.hyper ? "+" : "") + "@" + s.t.toFixed(2)); s.events.length = 0; }
  expect(legs.map((x) => x.split("@")[0])).toEqual(["drift", "prism"]);
  const pulseLen = (STAGES[0].form.sections.slice(0, STAGES[0].form.loop).reduce((a, x) => a + x.bars * 4, 0) * 60) / STAGES[0].bpm;
  expect(Number(legs[0].split("@")[1])).toBeCloseTo(pulseLen, 1);
  expect(sectionOf(s).kind).toBeDefined();
  expect(LEGS[LEGS.length - 1]).toEqual({ stage: "singularity", hyper: true });
});

test("a practice start: the chart played to its rank, then a safe place to stand", () => {
  const s = create({ stage: "drift", seed: chartSeed("drift", false) });
  skipTo(s, 30);
  expect(s.t).toBeGreaterThanOrEqual(30);
  expect(s.dead).toBe(false);
  s.a = safest(s);
  for (let i = 0; i < 120; i++) step(s, decide(s));
  expect(s.dead).toBe(false);
});

test("keys record run-length and play back tick for tick: a ghost runs exactly as its run did", () => {
  const s = create({ stage: "prism", seed: chartSeed("prism", false) });
  const keys: Keys = [], trace: number[] = [];
  while (!s.dead && s.t < 20) { const i = decide(s); record(keys, i); step(s, i); trace.push(s.a); }
  expect(keys.length).toBeLessThan(trace.length);
  const save = fresh();
  settle(save, "prism", { ...run(s.t), keys });
  const g = ghostOf(save, "prism")!;
  const back: number[] = [];
  while (g.state.t < s.t - 1e-9) { ghostStep(g); back.push(g.state.a); }
  expect(back).toEqual(trace.slice(0, back.length));
  expect(back.length).toBe(trace.length);
  const p = new Player([2, 2, 1, 4]);
  expect([p.next(), p.next(), p.next()]).toEqual([{ dir: 1, focus: false }, { dir: 1, focus: false }, { dir: 0, focus: true }]);
});

test("a stage opens when the one before is cleared, its hyper when it is; endless and the daily with the first clear", () => {
  const s = fresh();
  expect(BOARDS.filter((k) => open(s, k))).toEqual(["pulse"]);
  expect(dailyOpen(s)).toBe(false);
  let o = settle(s, "pulse", run(31.2));
  expect(o).toMatchObject({ record: true, prev: 0, rank: 3, opened: [] });
  o = settle(s, "pulse", run(61));
  expect(o.opened).toEqual(["drift", "pulse+", "endless", "daily"]);
  expect(s.boards.pulse).toMatchObject({ best: 61, tries: 2, time: 92.2 });
  o = settle(s, "pulse", run(12));
  expect(o).toMatchObject({ record: false, prev: 61, opened: [] });
  expect(open(s, keyOf("prism", false))).toBe(false);
});

test("medals: each once, for what the run did; looks open by the medals counted", () => {
  const s = fresh();
  expect(settle(s, "drift", run(65, { focused: true, grazes: 3 })).medals).toEqual(["clear"]);
  expect(settle(s, "drift", run(70, { grazes: 22 })).medals).toEqual(["steady", "hairline"]);
  expect(settle(s, "drift", run(95, { grazes: 30 })).medals).toEqual(["marathon"]);
  expect(settle(s, "drift", run(99)).medals).toEqual([]);
  expect(medalCount(s)).toBe(4);
  expect(skinOpen(s, "arrow")).toBe(true);
  expect(skinOpen(s, "diamond")).toBe(false);
  expect(settle(s, "endless", run(250)).medals).toEqual(["tour", "voyage"]);
  expect(settle(s, "pulse", run(80), { practice: true })).toMatchObject({ practice: true, medals: [], record: false });
  expect(s.boards.pulse).toBeUndefined();
  expect(MEDALS_TOTAL).toBe(51);
});

test("the daily is the same board and seed all day, kept apart from the stages' bests", () => {
  const a = daily(new Date(2026, 9, 4, 8)), b = daily(new Date(2026, 9, 4, 23)), c = daily(new Date(2026, 9, 5, 1));
  expect(a).toEqual(b);
  expect(c.day).not.toBe(a.day);
  expect(c.stage).not.toBe(a.stage);
  const s = fresh();
  settle(s, "pulse", run(20), { day: a.day });
  settle(s, "pulse", run(14), { day: a.day });
  expect(s.daily).toEqual({ day: a.day, best: 20, tries: 2 });
  expect(s.boards.pulse).toBeUndefined();
  settle(s, "pulse", run(5), { day: c.day });
  expect(s.daily).toEqual({ day: c.day, best: 5, tries: 1 });
});

test("a stored save loads, and anything unknown starts fresh", () => {
  const s = fresh();
  settle(s, "drift", { ...run(40), keys: [3, 1] });
  expect(load(JSON.parse(JSON.stringify(s)))).toEqual(s);
  expect(load(null)).toEqual(fresh());
  expect(load({ v: 9, boards: { pulse: { best: 9 } } })).toEqual(fresh());
  expect(load({ v: 1, muted: true })).toMatchObject({ daily: fresh().daily, skin: "dart", ghost: true, ghosts: {} });
});
