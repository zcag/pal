import { expect, test } from "bun:test";
import { CLEAR, FEEL, RANKS, STAGES } from "../../../extensions/vortex/game/content.ts";
import { DT, PATTERN_IDS, create, inside, step, travel, type State } from "../../../extensions/vortex/game/sim.ts";
import { play } from "../../../extensions/vortex/game/bot.ts";
import { BOARDS, daily, dailyOpen, fresh, keyOf, load, open, settle } from "../../../extensions/vortex/game/meta.ts";

const TAU = Math.PI * 2;
const ticks = (s: State, n: number, dir: -1 | 0 | 1 = 0) => { for (let i = 0; i < n && !s.dead; i++) step(s, { dir }); };

test("a wall covers its side's angles across its band, and only there", () => {
  const w = { a0: 0, a1: TAU / 6, r: 0.9, len: 0.3 };
  expect(inside(w, TAU / 12)).toBe(true);
  expect(inside(w, -0.01)).toBe(false);
  expect(inside(w, TAU / 6 + 0.01)).toBe(false);
  expect(inside({ ...w, r: 1.05 }, TAU / 12)).toBe(false);
  // Near a corner the wall's straight edge is farther out along the orbit: it reaches you there later.
  expect(inside({ ...w, r: 0.95 }, 0.02)).toBe(false);
  expect(inside({ ...w, r: 0.95 }, TAU / 12)).toBe(true);
});

test("turning into a wall's side stops you flush against it; a wall reaching you ends the run", () => {
  const s = create({ stage: "pulse", seed: 1 });
  s.rows = []; s.next = 1e9;
  s.a = 0.5;
  s.walls = [{ a0: 0.8, a1: 1.6, r: 0.8, len: 0.5 }];
  ticks(s, 12, 1); // 50 ms: the wall is still across the orbit
  expect(s.dead).toBe(false);
  expect(s.a).toBeLessThan(0.8);
  expect(s.a).toBeGreaterThan(0.79);
  s.walls = [{ a0: 0, a1: 1, r: 1.05, len: 0.3 }];
  ticks(s, 120);
  expect(s.dead).toBe(true);
  expect(s.events.some((e) => e.type === "death")).toBe(true);
});

test("a run is its seed: the same seed and keys give the same run", () => {
  const go = () => { const s = create({ stage: "prism", seed: 42 }); for (let i = 0; i < 240 * 8; i++) step(s, { dir: i % 400 < 200 ? 1 : -1 }); return s; };
  const a = go(), b = go();
  expect(a.t).toBe(b.t);
  expect(a.a).toBe(b.a);
  expect(a.walls).toEqual(b.walls);
  expect(create({ stage: "prism", seed: 43 }).a === a.a && create({ stage: "prism", seed: 43 }).rot === create({ stage: "prism", seed: 42 }).rot).toBe(false);
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
  s.next = 1e9;
  const ranks: number[] = [];
  while (s.t < 61) { step(s, { dir: 0 }); for (const e of s.events) if (e.type === "rank") ranks.push(Math.round(s.t)); s.events.length = 0; }
  expect(ranks).toEqual(RANKS.slice(1).map((r) => r.at));
  expect(RANKS[RANKS.length - 1].at).toBe(CLEAR);
});

test("every rank lands on a beat of its stage's song", () => {
  for (const st of STAGES) for (const r of RANKS) expect(((r.at * st.bpm) / 60) % 1).toBe(0);
});

test("every pattern turns up in some stage, and every stage's patterns are known", () => {
  const used = new Set(STAGES.flatMap((s) => Object.keys(s.patterns)));
  expect([...used].sort()).toEqual([...PATTERN_IDS].sort());
});

test("rows of a pattern are spaced for the move they ask", () => {
  // Two C-shaped rows with opposite gaps on a hexagon: the second waits for the half turn.
  expect(travel(6, 3)).toBeCloseTo(Math.PI / FEEL.turn, 9);
  for (const st of STAGES) {
    const s = create({ stage: st.id, seed: 9 });
    while (s.t < 30 && !s.dead) { step(s, { dir: 0 }); s.events.length = 0; if (s.walls.length > 30) s.walls.length = 0; }
    const rows = [...s.rows].sort((a, b) => a.at - b.at);
    for (let i = 1; i < rows.length; i++) expect(rows[i].at - rows[i - 1].at).toBeGreaterThanOrEqual(0);
  }
});

// A planning bot that sees what a player sees survives every board: the patterns are passable at their speed.
for (const key of BOARDS) {
  test(`the bot lasts 25 s on ${key}`, () => {
    const hyper = key.endsWith("+");
    const s = play(create({ stage: key.replace("+", "") as State["stage"]["id"], hyper, seed: 11 }), 25);
    expect(s.dead).toBe(false);
    expect(s.t).toBeGreaterThan(25 - DT * 2);
  });
}

test("a stage opens when the one before is cleared, its hyper when it is; the daily with the first clear", () => {
  const s = fresh();
  expect(BOARDS.filter((k) => open(s, k))).toEqual(["pulse"]);
  expect(dailyOpen(s)).toBe(false);
  let o = settle(s, "pulse", 31.2);
  expect(o).toMatchObject({ record: true, prev: 0, rank: 3, opened: [] });
  o = settle(s, "pulse", 61);
  expect(o.opened).toEqual(["drift", "pulse+", "daily"]);
  expect(s.boards.pulse).toEqual({ best: 61, tries: 2, time: 92.2 });
  o = settle(s, "pulse", 12);
  expect(o).toMatchObject({ record: false, prev: 61, opened: [] });
  expect(s.last).toBe("pulse");
  expect(open(s, keyOf("prism", false))).toBe(false);
});

test("the daily is the same board and seed all day, kept apart from the stages' bests", () => {
  const a = daily(new Date(2026, 9, 4, 8)), b = daily(new Date(2026, 9, 4, 23)), c = daily(new Date(2026, 9, 5, 1));
  expect(a).toEqual(b);
  expect(c.day).not.toBe(a.day);
  expect(c.stage).not.toBe(a.stage);
  const s = fresh();
  settle(s, "pulse", 20, a.day);
  settle(s, "pulse", 14, a.day);
  expect(s.daily).toEqual({ day: a.day, best: 20, tries: 2 });
  expect(s.boards.pulse).toBeUndefined();
  settle(s, "pulse", 5, c.day);
  expect(s.daily).toEqual({ day: c.day, best: 5, tries: 1 });
});

test("a stored save loads, and anything unknown starts fresh", () => {
  const s = fresh();
  settle(s, "drift", 40);
  expect(load(JSON.parse(JSON.stringify(s)))).toEqual(s);
  expect(load(null)).toEqual(fresh());
  expect(load({ v: 9, boards: { pulse: { best: 9 } } })).toEqual(fresh());
  expect(load({ v: 1, muted: true }).daily).toEqual(fresh().daily);
});
