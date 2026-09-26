// Sudoku: the solver, the generator and the grader (sudoku.ts), the moves,
// pencil marks, the saved form and the hint (game.ts), the stats and the
// streak (stats.ts), and the extension over the wire: today's daily,
// resuming, a new puzzle, the record, the lists. The clock is pinned
// (PAL_NOW); games go to a temp dir (PAL_SUDOKU_DIR). The page (surface/) is
// browser code and is not run here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyHint, clearNotes, decode, digitCounts, encode, erase, fillNotes, hint, newPlay, place, progressOf, toggleNote, unitsDone, wrongCells, type Play,
} from "../../../extensions/sudoku/game.ts";
import type { Entry, MonthView, Opened, SolvedReply, StatsView, TodayView } from "../../../extensions/sudoku/index.ts";
import { isBest, streaks, summary, type Solve } from "../../../extensions/sudoku/stats.ts";
import type { Data } from "../../../extensions/sudoku/store.ts";
import {
  DIFFS, PEERS, UNITS, apply, bit, candidates, conflicts, countSolutions, findStep, fromText, generate, grade, rng, solve, toText, type Diff,
} from "../../../extensions/sudoku/sudoku.ts";
import { Host } from "../harness.ts";

// A classic puzzle and its answer.
const P = fromText("530070000600195000098000060800060003400803001700020006060000280000419005000080079");
const A = fromText("534678912672195348198342567859761423426853791713924856961537284287419635345286179");
const made = new Map<Diff, Awaited<ReturnType<typeof generate>>>();
beforeAll(async () => { for (const d of DIFFS) made.set(d, await generate("test", d)); });

describe("the solver", () => {
  test("solves, counts one answer, and stops counting at the limit on an open grid", () => {
    expect(solve(P)).toEqual(A);
    expect(countSolutions(P)).toBe(1);
    expect(countSolutions(new Array(81).fill(0), 2)).toBe(2);
    const bad = P.slice(); bad[2] = 5; // two 5s in row 1
    expect(solve(bad)).toBeNull();
    expect(conflicts(bad)).toEqual(new Set([0, 2]));
  });
  test("the geometry: 27 units of 9, 20 peers a cell", () => {
    expect(UNITS.every((u) => u.length === 9 && new Set(u).size === 9)).toBe(true);
    expect(PEERS.every((p) => p.length === 20)).toBe(true);
    expect(UNITS[18 + 4]).toEqual([30, 31, 32, 39, 40, 41, 48, 49, 50]);
  });
});

describe("making puzzles", () => {
  test("the same seed makes the same puzzle; another seed another", async () => {
    const again = await generate("test", "medium");
    expect(toText(again.givens)).toBe(toText(made.get("medium")!.givens));
    expect(toText((await generate("other", "medium")).givens)).not.toBe(toText(again.givens));
    const r1 = rng("x"), r2 = rng("x");
    expect([r1(), r1()]).toEqual([r2(), r2()]);
  });
  test("every difficulty: one answer, the clues part of it, graded as asked", () => {
    for (const d of DIFFS) {
      const m = made.get(d)!;
      expect(countSolutions(m.givens)).toBe(1);
      expect(solve(m.givens)).toEqual(m.solution);
      expect(m.givens.every((g, i) => !g || g === m.solution[i])).toBe(true);
      expect(grade(m.givens).level).toBe(DIFFS.indexOf(d) + 1);
    }
    // An easy one keeps plenty of clues; an expert one is sparse.
    const clues = (d: Diff) => made.get(d)!.givens.filter(Boolean).length;
    expect(clues("easy")).toBeGreaterThanOrEqual(36);
    expect(clues("expert")).toBeLessThan(clues("easy"));
  });
  test("graded by technique: easy needs only singles you can spot, expert needs a fish or a wing", () => {
    for (const t of Object.keys(grade(made.get("easy")!.givens).used)) expect(["full-house", "hidden-single"]).toContain(t);
    expect(grade(made.get("medium")!.givens).used["naked-single"]).toBeGreaterThan(0);
    const expert = grade(made.get("expert")!.givens).used;
    expect(["x-wing", "swordfish", "xy-wing"].some((t) => (expert as Record<string, number>)[t])).toBe(true);
  });
  test("every step of a hand solve is true to the answer", () => {
    for (const d of ["hard", "expert"] as const) {
      const m = made.get(d)!, g = m.givens.slice(), cand = candidates(g);
      while (g.some((x) => !x)) {
        const s = findStep(g, cand)!;
        if (s.place) expect(m.solution[s.place.cell]).toBe(s.place.digit);
        for (const e of s.elim ?? []) expect(m.solution[e.cell]).not.toBe(e.digit);
        apply(g, cand, s);
      }
      expect(g).toEqual(m.solution);
    }
  });
  test("a board no technique here finishes grades 0", () => {
    // The empty grid has no deductions at all.
    expect(grade(new Array(81).fill(0)).level).toBe(0);
  });
});

describe("the moves and pencil marks", () => {
  const empty = (i: number) => P.findIndex((d, k) => !d && k >= i);
  test("a digit clears its mark from every cell it sees and the cell's own marks; a clue never changes", () => {
    let p = newPlay(P);
    const a = empty(0), b = PEERS[a].find((j) => !P[j])!, far = P.findIndex((d, k) => !d && !PEERS[a].includes(k) && k !== a);
    for (const c of [a, b, far]) p = toggleNote(p, P, c, 4);
    p = toggleNote(p, P, a, 2);
    p = place(p, P, a, 4, A);
    expect(p.v[a]).toBe(4);
    expect(p.n[a]).toBe(0);
    expect(p.n[b]).toBe(0);
    expect(p.n[far]).toBe(bit(4));
    expect(place(p, P, 0, 9, A)).toBe(p); // 0 is a clue
    expect(toggleNote(p, P, a, 3)).toBe(p); // a cell with a digit takes no marks
  });
  test("a wrong digit counts as a mistake and shows among the wrong cells; erase takes the digit, then the marks", () => {
    const a = empty(0);
    let p = place(newPlay(P), P, a, A[a] === 1 ? 2 : 1, A);
    expect(p.mistakes).toBe(1);
    expect(wrongCells(p.v, P, A)).toEqual([a]);
    p = erase(p, P, a);
    expect(p.v[a]).toBe(0);
    p = erase(toggleNote(p, P, a, 5), P, a);
    expect(p.n[a]).toBe(0);
    expect(place(place(p, P, a, A[a], A), P, a, A[a], A).v[a]).toBe(A[a]); // the same digit again leaves it
  });
  test("fill writes what fits, keeps your own eliminations, and clear takes every mark", () => {
    const cand = candidates(P), a = empty(0);
    let p = fillNotes(newPlay(P));
    expect(p.n).toEqual(cand);
    expect(fillNotes(p)).toBe(p);
    const two = cand[a] & -cand[a];
    p = toggleNote(p, P, a, Math.log2(two) + 1); // take one mark out by hand
    expect(fillNotes(p).n[a]).toBe(cand[a] & ~two);
    expect(clearNotes(p).n.every((m) => m === 0)).toBe(true);
  });
  test("the units through a cell that are complete", () => {
    const v = A.slice(); v[0] = 0;
    // Cell 1: row 1 and the top-left box still miss cell 0; column 2 is complete.
    expect(unitsDone(v, 1)).toEqual([10]);
    expect(unitsDone(A, 1)).toEqual([0, 10, 18]);
    v[0] = 3; // a 3 twice in its row, column and box: none of them counts
    expect(unitsDone(v, 0)).toEqual([]);
  });
  test("saved and back, and how far it got", () => {
    const a = empty(0);
    const p: Play = { ...toggleNote(place(newPlay(P), P, a, A[a], A), P, empty(a + 1), 7), ms: 61_234, hints: 1 };
    const s = encode(p);
    expect(s.v).toHaveLength(81);
    expect(s.n).toHaveLength(162);
    expect(decode(s, P)).toEqual({ ...p, ms: 61_234 });
    expect(progressOf(s, toText(P))).toEqual({ filled: 1, total: P.filter((d) => !d).length, started: true });
    expect(progressOf(encode(toggleNote(newPlay(P), P, empty(0), 3)), toText(P))).toMatchObject({ filled: 0, started: true });
    expect(progressOf(encode(newPlay(P)), toText(P)).started).toBe(false);
    expect(digitCounts(A).slice(1)).toEqual(new Array(9).fill(9));
  });
});

describe("the hint", () => {
  test("a wrong digit comes first, pointing at the clash", () => {
    const a = P.findIndex((d) => !d); // row 1: 5 3 . . 7
    const p = place(newPlay(P), P, a, 5, A);
    const h = hint(P, p, A);
    expect(h).toMatchObject({ kind: "wrong", cell: a, digit: 5, sources: [0], act: "Erase it" });
    expect(h.why).toBe("This 5 is wrong: there's another 5 in its row.");
    expect(applyHint(p, P, h, A).v[a]).toBe(0);
  });
  test("on a fresh board, where to look, then the plain reason, then the move", () => {
    const p = newPlay(P), h = hint(P, p, A);
    expect(h.kind).toBe("step");
    expect(h.look).toMatch(/^Look at /);
    expect(h.cell).toBeDefined();
    expect(A[h.cell!]).toBe(h.digit!);
    if (h.step!.tech === "hidden-single") expect(h.why).toMatch(/^Only this cell in .* can take a \d/);
    const q = applyHint(p, P, h, A);
    expect(q.v[h.cell!]).toBe(h.digit!);
  });
  test("an elimination hint writes the marks in and takes the ruled-out ones away", () => {
    // Walk a hard puzzle by hand until the next step is an elimination.
    const m = made.get("hard")!;
    let p = newPlay(m.givens), h = hint(m.givens, p, m.solution);
    for (let k = 0; k < 81 && h.step?.place; k++) { p = applyHint(p, m.givens, h, m.solution); h = hint(m.givens, p, m.solution); }
    expect(h.step?.elim?.length).toBeGreaterThan(0);
    expect(h.act).toBe("Update notes");
    const q = applyHint(p, m.givens, h, m.solution);
    for (const e of h.step!.elim!) { expect(q.n[e.cell] & bit(e.digit)).toBe(0); expect(q.n[e.cell]).not.toBe(0); }
  });
});

describe("the stats", () => {
  const T = Date.parse("2026-09-25T10:00:00");
  const s = (date: string, ms: number, extra: Partial<Solve> = {}): Solve => ({ id: `daily:${date}:medium`, diff: "medium", date, at: Date.parse(`${date}T20:00:00`), ms, ...extra });
  test("the streak runs back from today (or yesterday), a hint does not break it, a late solve does", () => {
    const xs = [s("2026-09-22", 300_000), s("2026-09-23", 200_000, { hints: 2 }), s("2026-09-24", 250_000)];
    expect(streaks(xs, T)).toEqual({ streak: 3, best: 3 });
    const late = { ...s("2026-09-21", 1000), at: Date.parse("2026-09-24T09:00:00") };
    expect(streaks([late, ...xs], T).streak).toBe(3);
  });
  test("best and average only from clean first solves; a new best", () => {
    const xs = [s("2026-09-23", 200_000, { hints: 1 }), s("2026-09-24", 250_000), s("2026-09-25", 240_000, { at: T })];
    const sum = summary(xs, T);
    expect(sum).toMatchObject({ solved: 3, clean: 2, best: 240_000, average: 245_000, today: true });
    expect(isBest(xs, xs[2])).toBe(true);
    expect(isBest(xs, xs[0])).toBe(false);
  });
});

describe("the extension", () => {
  let host: Host;
  let dir: string;
  const env = { PAL_NOW: process.env.PAL_NOW, PAL_SUDOKU_DIR: process.env.PAL_SUDOKU_DIR };
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pal-sudoku-"));
    Object.assign(process.env, { PAL_NOW: "2026-09-25T10:00:00", PAL_SUDOKU_DIR: dir });
    host = await Host.bundled();
  });
  afterAll(async () => {
    await host?.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(dir, { recursive: true, force: true });
  });
  const send = <T>(msg: unknown, args?: unknown) => host.surfaceSend("sudoku", "sudoku", msg, args) as Promise<T>;
  const saved = () => JSON.parse(readFileSync(join(dir, "progress.json"), "utf8")) as Data;

  test("the view is one surface with its actions", async () => {
    const v = await host.request<{ tree: unknown; actions: { id: string; shortcut?: unknown }[] }>("view", { extension: "sudoku", palette: "sudoku" });
    expect(v.tree).toEqual({ type: "surface", src: "surface/index.html" });
    expect(v.actions.slice(0, 3).map((a) => [a.id, a.shortcut])).toEqual([["hint", "i"], ["notes", "n"], ["fill", "a"]]);
  });

  test("the first open is today's medium daily, made from the date, the same every time", async () => {
    const o = await send<Opened>({ op: "open" });
    expect(o).toMatchObject({ id: "daily:2026-09-25:medium", diff: "medium", date: "2026-09-25", today: true });
    expect(o.givens).toBe(toText((await generate("daily:2026-09-25", "medium")).givens));
    expect(grade(fromText(o.givens)).level).toBe(2);
    expect((await send<Opened>({ op: "open", date: "2026-09-25", diff: "hard" })).id).toBe("daily:2026-09-25:hard");
  });

  test("a move is saved; the next open resumes the half-done game", async () => {
    const o = await send<Opened>({ op: "open", id: "daily:2026-09-25:medium" });
    const g = fromText(o.givens), a = solve(g)!, at = g.findIndex((d) => !d);
    const play = encode({ ...place(newPlay(g), g, at, a[at], a), ms: 5000 });
    await send({ op: "save", id: o.id, play });
    expect(saved().progress[o.id]).toMatchObject({ v: play.v, ms: 5000 });
    await send({ op: "open", date: "2026-09-24", diff: "easy" }); // look at another, untouched
    const back = await send<Opened>({ op: "open" });
    expect(back.id).toBe(o.id);
    expect(back.saved?.v).toBe(play.v);
    const progress = await send<Entry[]>({ op: "progress" });
    expect(progress.map((e) => e.id)).toEqual([o.id]);
    expect(progress[0]).toMatchObject({ state: "started", filled: 1, diff: "medium", date: "2026-09-25" });
  });

  test("a new puzzle with only pencil marks is resumed and listed too", async () => {
    const n = await send<Opened>({ op: "new", diff: "hard" });
    const g = fromText(n.givens);
    const play = encode({ ...toggleNote(newPlay(g), g, g.findIndex((d) => !d), 4), ms: 9000 });
    await send({ op: "save", id: n.id, play });
    const back = await send<Opened>({ op: "open" });
    expect(back.id).toBe(n.id);
    expect(back.saved?.n).toBe(play.n);
    expect((await send<Entry[]>({ op: "progress" })).map((e) => e.id)).toContain(n.id);
  });

  test("a new puzzle of any difficulty, kept once made", async () => {
    const n = await send<Opened>({ op: "new", diff: "expert" });
    expect(n.id).toMatch(/^new:\w+:expert$/);
    expect(n.today).toBe(false);
    expect(grade(fromText(n.givens)).level).toBe(4);
    expect(saved().meta[n.id].givens).toBe(n.givens);
    expect((await send<Opened>({ op: "open", id: n.id })).givens).toBe(n.givens);
  });

  test("solved: recorded, a best, the streak, and today's next daily to play", async () => {
    const o = await send<Opened>({ op: "open", id: "daily:2026-09-25:medium" });
    const a = solve(fromText(o.givens))!;
    const r = await send<SolvedReply>({ op: "solved", id: o.id, play: { v: a.join(""), n: "", ms: 190_000, done: { ms: 190_000, at: Date.now() } } });
    expect(r).toMatchObject({ best: true, first: true, next: "hard", stats: { solved: 1, streak: 1, today: true, best: 190_000 } });
    expect(saved().solves[0]).toMatchObject({ id: o.id, diff: "medium", date: "2026-09-25", ms: 190_000 });
    const t = await send<TodayView>({ op: "today" });
    expect(t).toEqual({ today: "2026-09-25", days: { easy: "new", medium: "solved", hard: "new", expert: "new" } });
    const st = await send<StatsView>({ op: "stats", diff: "medium" });
    expect(st.history).toHaveLength(1);
    expect((await send<StatsView>({ op: "stats", diff: "hard" })).solved).toBe(0);
    // Solved, the first open is today's daily again, done.
    expect((await send<Opened>({ op: "open" })).saved?.done).toBeDefined();
  });

  test("a month of dailies, today's marked, none after today", async () => {
    const m = await send<MonthView>({ op: "month", diff: "medium" });
    expect(m).toMatchObject({ year: 2026, month: 9, today: "2026-09-25" });
    expect(m.days).toHaveLength(25);
    expect(m.days[24]).toMatchObject({ date: "2026-09-25", state: "solved" });
    expect((await send<MonthView>({ op: "month", diff: "medium", year: 2026, month: 8 })).days).toHaveLength(31);
  });

  test("the checking mode is a setting the page can flip", async () => {
    expect(await send<{ check: string }>({ op: "check", mode: "mistakes" })).toEqual({ check: "mistakes" });
    expect(await send<{ check: string }>({ op: "check", mode: "conflicts" })).toEqual({ check: "conflicts" });
  });
});
