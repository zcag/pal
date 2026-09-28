// Writes app/src/gallery/shots/sudoku.json: the store screenshots' fixture.
// The page asks the extension for everything (`pal.send`: the puzzle, the
// stats, today's dailies, the solve), so the fixture runs the extension in
// the host harness over a data file of its own (`PAL_SUDOKU_DIR`, a temp
// directory) and records its replies. The data: today's medium daily (made
// by sudoku.ts from its date, as the extension makes it) half solved by
// sudoku.ts's own deductions with a few pencil marks, and two months of
// solves behind it (dailies on their day at the evening, a streak running
// to yesterday). A second file has the same puzzle one digit from done, for
// the finish. `make shots EXT=sudoku`.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../../host/test/harness.ts";
import { NOW, pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { encode, newPlay, type Play } from "./game.ts";
import type { Solve } from "./stats.ts";
import type { Data } from "./store.ts";
import { DIFFS, apply, candidates, findStep, generate, solve, toText, type Diff } from "./sudoku.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
const DAY = 86_400_000;
const iso = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const TODAY = iso(NOW), ID = `daily:${TODAY}:medium`;

// Today's medium daily, as the extension makes it.
const made = await generate(`daily:${TODAY}`, "medium");
const givens = made.givens, solution = solve(givens)!;

/** The puzzle worked by the deductions a person makes, until `left` cells are empty; a few two- and three-way cells pencilled. */
function worked(left: number, pencil: number): Play {
  const g = givens.slice(), cand = candidates(g);
  while (g.filter((d) => !d).length > left) apply(g, cand, findStep(g, cand)!);
  const p = { ...newPlay(givens), v: g };
  const c = candidates(g), r = seeded(9);
  const two = c.flatMap((m, i) => (!g[i] && popcount(m) >= 2 && popcount(m) <= 3 ? [i] : [])).map((i) => [i, r()]).sort((x, y) => x[1] - y[1]).slice(0, pencil).map(([i]) => i);
  for (const i of two) p.n[i] = c[i];
  return p;
}
const popcount = (m: number) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

// Two months of solves: the medium daily most evenings (a streak of 11 to yesterday), the others now and then.
const r = seeded(4);
const solves: Solve[] = [];
for (let back = 60; back >= 1; back--) {
  const day = NOW - back * DAY, date = iso(day);
  const evening = new Date(day).setHours(20, 0, 0, 0) + Math.round(r() * 3 * 3_600_000);
  const plays: Diff[] = back <= 11 || r() < 0.7 ? ["medium"] : [];
  if (r() < 0.25) plays.push("easy");
  if (r() < 0.15) plays.push("hard");
  for (const diff of plays) {
    const base = { easy: 4.2, medium: 8.5, hard: 15, expert: 26 }[diff] * 60_000 * (0.9 + back / 200);
    const hints = r() < 0.08 ? 1 : 0, mistakes = r() < 0.2 ? 1 : 0;
    solves.push({ id: `daily:${date}:${diff}`, diff, date, at: evening + solves.length * 60_000, ms: Math.round(base * (0.8 + r() * 0.45)), ...(hints && { hints }), ...(mistakes && { mistakes }) });
  }
}

/** A data file with today's daily at `play`; the extension's replies to what the page asks, recorded. */
async function replies(play: Play, extra: { msg: Record<string, unknown> }[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "pal-sudoku-fixture-"));
  const data: Data = { v: 1, progress: { [ID]: { ...encode(play), touched: NOW - 20 * 60_000 } }, solves, meta: { [ID]: { diff: "medium", givens: toText(givens), date: TODAY } }, last: ID };
  writeFileSync(join(dir, "progress.json"), JSON.stringify(data));
  process.env.PAL_SUDOKU_DIR = dir;
  const host = await Host.bundled();
  try {
    const asks = [{ msg: { op: "open" } }, { msg: { op: "today" } }, ...DIFFS.map((diff) => ({ msg: { op: "stats", diff } })), ...extra];
    const send = [];
    for (const a of asks) send.push({ msg: a.msg, reply: await host.surfaceSend("sudoku", "sudoku", a.msg) });
    return { send, view: await host.request("view", { extension: "sudoku", palette: "sudoku" }) };
  } finally {
    host.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

const SETTINGS = { difficulty: "medium", check: "conflicts", clock: true, auto_notes: false };
const mid = { ...worked(34, 7), ms: 372_000 };
// One cell left: the page's cursor starts on it, and its digit finishes the puzzle (the clock is pinned, so the time is the saved one).
const last = { ...worked(1, 0), ms: 511_000 };
const cell = last.v.findIndex((d) => !d), digit = solution[cell];
const done = { ...last, v: last.v.map((d, i) => (i === cell ? digit : d)), done: { ms: last.ms, at: NOW } };

const a = await replies(mid), b = await replies(last, [{ msg: { op: "solved", id: ID, play: encode(done) } }]);
const palette = (x: typeof a) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: x.view, surface: { storage: {}, settings: SETTINGS, send: x.send } });
writeFixture("sudoku", {
  palettes: { play: palette(a), last: palette(b) },
  shots: {
    "1-solving": { palette: "play", keys: ["wait:1500", "left", "wait:500"], caption: "Today's medium, half solved: the digit in focus and its notes lit across the board, the pad's bars" },
    "2-hint": { palette: "play", keys: ["wait:1500", "i", "wait:700", "enter", "wait:900"], caption: "A hint: where to look first, then why, and the move on Enter" },
    "3-solved": { palette: "last", keys: ["wait:1500", String(digit), "wait:3200"], caption: "Solved: the time, the streak, Flawless, and today's next daily on Enter" },
    "4-new": { palette: "play", keys: ["wait:1500", "cmd+n", "wait:900"], caption: "⌘N: today's puzzle or a new one, per difficulty" },
    "5-stats": { palette: "play", keys: ["wait:1500", "cmd+s", "wait:1200"], caption: "Stats per difficulty: the best, the average, the streak and every solve" },
  },
});
console.log(`sudoku: ${TODAY} medium, ${mid.v.filter((d) => !d).length} left mid-game, finish on ${digit} at cell ${cell}, ${solves.length} solves`);
