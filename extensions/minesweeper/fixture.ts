// Writes app/src/gallery/shots/minesweeper.json: the store screenshots'
// fixture. The palette is the extension's own view (the surface node and
// the actions ⌘K lists, through the host harness); the page's storage is
// seeded with boards from game.ts: the first open on a seeded field, then
// played forward by a plain solver (a number with its mines flagged opens
// around, a number with as many closed cells as mines left flags them) to
// the moment a shot wants. The mines are laid before the page opens, so
// the page never draws its own; the won and lost shots press the last key
// themselves and wait until the confetti and the blast have settled.
// `make shots EXT=minesweeper`.
import { Host } from "../../host/test/harness.ts";
import { NOW, pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { apply, around, count, isChord, newGame, type Level, type State } from "./game.ts";
import manifest from "./pal.json" with { type: "json" };

/** A record at each level, so the header has a best and a won count. */
const RECORDS: State["records"] = {
  beginner: { played: 31, won: 22, best: 19_000 },
  intermediate: { played: 14, won: 6, best: 118_000 },
  expert: { played: 5, won: 1, best: 402_000 },
};

let clock = NOW;
const at = (st: State, i: number, a: "open" | "flag", level: Level) => apply({ ...st, cursor: i }, a, { difficulty: level }, () => 0, (clock += 1400));

/** The next sure move, or none: a satisfied number opens around, a number with only its mines left closed flags one. */
function sure(st: State): { i: number; a: "open" | "flag" } | undefined {
  for (let i = 0; i < st.w * st.h; i++) {
    const n = st.open[i] && !st.mine[i] ? count(st, i) : 0;
    if (!n) continue;
    const near = around(i, st.w, st.h), closed = near.filter((j) => !st.open[j] && !st.flag[j]), flags = near.filter((j) => st.flag[j]).length;
    if (!closed.length) continue;
    if (flags === n) return { i, a: "open" };
    if (n - flags === closed.length) return { i: closed[0], a: "flag" };
  }
  return undefined;
}

const safeLeft = (st: State) => st.open.filter((o, i) => !o && !st.mine[i]).length;

/** A board at `level` from `seed`: the first open in the middle, then sure moves while `more` says so; undefined when the solver runs out first. */
function play(level: Level, seed: number, more: (st: State) => boolean): State | undefined {
  clock = NOW - 600_000;
  let st = newGame(level, { records: structuredClone(RECORDS), game: 40 });
  st = apply(st, "open", { difficulty: level }, seeded(seed), (clock += 1000));
  while (st.phase === "play" && more(st)) {
    const m = sure(st);
    if (!m) return undefined;
    st = at(st, m.i, m.a, level);
  }
  return st.phase === "play" ? st : undefined;
}
function find(level: Level, more: (st: State) => boolean, ok: (st: State) => boolean = () => true): State {
  for (let seed = 1; seed < 2000; seed++) {
    const st = play(level, seed, more);
    if (st && ok(st)) return st;
  }
  throw new Error(`minesweeper: no ${level} board`);
}
/** How much of the safe ground is open. */
const cleared = (st: State) => 1 - safeLeft(st) / (st.w * st.h - st.mines);
/** The clock as a board saved mid-game has it: stopped at the last move, the run so far in `ms`. */
const saved = (st: State, ms: number): State => ({ ...st, clock: { ms }, last: undefined });

// Mid-game on beginner: half the ground open, the cursor on a closed cell beside the open ground.
const mid = find("beginner", (st) => cleared(st) < 0.5, (st) => cleared(st) < 0.7 && st.flag.some(Boolean));
const edge = mid.open.findIndex((o, i) => !o && !mid.flag[i] && around(i, mid.w, mid.h).some((j) => mid.open[j]));
const board = saved({ ...mid, cursor: edge }, 42_300);

// One safe cell from clearing it: the cursor on it, Enter wins (the flags plant, confetti, a new best).
const last = find("beginner", (st) => safeLeft(st) > 1, (st) => safeLeft(st) === 1);
const nearWin = saved({ ...last, cursor: last.open.findIndex((o, i) => !o && !last.mine[i]) }, 15_300);

// Intermediate, a third open, one flag in the wrong place and the cursor on a mine nothing gave away: Enter sets it off.
const lostFrom = find("intermediate", (st) => cleared(st) < 0.35);
const wrong = lostFrom.open.findIndex((o, i) => !o && !lostFrom.flag[i] && !lostFrom.mine[i] && around(i, lostFrom.w, lostFrom.h).some((j) => lostFrom.open[j]));
const hidden = lostFrom.mine.findIndex((m, i) => m && !lostFrom.flag[i] && around(i, lostFrom.w, lostFrom.h).some((j) => lostFrom.open[j]));
const nearLoss = saved({ ...lostFrom, flag: lostFrom.flag.map((f, i) => f || i === wrong), cursor: hidden }, 96_300);

// Expert mid-game, the cursor on a 2 with both its mines flagged and closed cells still around it: Enter opens them.
const exp = find("expert", (st) => cleared(st) < 0.3, (st) => st.open.some((_, i) => count(st, i) === 2 && isChord(st, i) && around(i, st.w, st.h).some((j) => !st.open[j] && !st.flag[j])));
const two = exp.open.findIndex((_, i) => count(exp, i) === 2 && isChord(exp, i) && around(i, exp.w, exp.h).some((j) => !exp.open[j] && !exp.flag[j]));
const expert = saved({ ...exp, cursor: two }, 187_300);

pinClock();
const host = await Host.bundled();
try {
  const view = await host.request("view", { extension: "minesweeper", palette: "minesweeper" });
  const palette = (state: State) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { state }, settings: { difficulty: state.level, clock: true } } });
  writeFixture("minesweeper", {
    palettes: { board: palette(board), win: palette(nearWin), loss: palette(nearLoss), expert: palette(expert) },
    shots: {
      "1-board": { palette: "board", keys: ["wait:1200"], caption: "Mid-game on beginner: the mine counter, the face and the clock, the best time and the won count, the keys under the board" },
      "2-won": { palette: "win", keys: ["wait:1000", "enter", "wait:3200"], caption: "Cleared: the mines left are flagged, the time, a new best" },
      "3-lost": { palette: "loss", keys: ["wait:1000", "enter", "wait:2600"], caption: "A mine went off on intermediate: every mine shows, a wrong flag is crossed out" },
      "4-expert": { palette: "expert", keys: ["wait:1200"], caption: "Expert, 30 by 16 with 99 mines, scaled to the panel; Enter on the satisfied 2 opens around it" },
    },
  });
  console.log(`minesweeper: mid ${Math.round(cleared(mid) * 100)}%, expert ${Math.round(cleared(exp) * 100)}%`);
} finally {
  host.kill();
}
