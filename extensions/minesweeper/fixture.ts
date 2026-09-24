// Writes app/src/gallery/shots/minesweeper.json: the store screenshots'
// fixture, boards played by the rules from a seeded shuffle so the shots
// show a real game without playing one: a beginner board mid-game (Enter
// on it opens a mine), the same board one cell from cleared (Enter wins
// it), and an expert board mid-game. Each board is a palette of its own
// in the fixture, all titled Minesweeper.
// `bun run extensions/minesweeper/fixture.ts`, then `node app/scripts/shots.mjs minesweeper`.
import { writeFileSync } from "node:fs";
import { apply, around, newGame, type Level, type State } from "./game.ts";
import { render } from "./render.ts";
import manifest from "./pal.json";

/** A seeded LCG in place of Math.random, so the fixture is the same on every run. */
const lcg = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

/** A game opened at the centre, then the closed mines touching the open area flagged, `flags` of them. */
function played(level: Level, seed: number, flags: number, ms: number): State {
  let st = apply(newGame(level), "open", { difficulty: level }, lcg(seed), 0);
  const frontier = st.mine.flatMap((m, i) => (m && around(i, st.w, st.h).some((j) => st.open[j]) ? [i] : []));
  for (const i of frontier.slice(0, flags)) st = apply({ ...st, cursor: i }, "flag", undefined, undefined, 0);
  return { ...st, cursor: newGame(level).cursor, clock: { ms }, last: undefined };
}

const records = (best: Partial<Record<Level, number>>) => ({ beginner: { played: 14, won: 9, best: best.beginner }, intermediate: { played: 6, won: 2, best: 214_000 }, expert: { played: 3, won: 0, best: best.expert } });

// Beginner mid-game, one flag on a safe cell by the open area; the cursor sits on a closed mine next to the open area, so Enter loses.
const mid = { ...played("beginner", 32, 3, 47_000), records: records({ beginner: 38_000 }) };
const safe = mid.mine.flatMap((m, i) => (m || mid.open[i] ? [] : [i]));
const trap = mid.mine.findIndex((m, i) => m && !mid.flag[i] && around(i, mid.w, mid.h).some((j) => mid.open[j]));
const wrong = safe.find((i) => around(i, mid.w, mid.h).some((j) => mid.open[j]));
const beginner = { ...mid, cursor: trap, flag: mid.flag.map((f, i) => f || i === wrong) };
const lost = apply(beginner, "open", undefined, undefined, 0);

// The same board with every safe cell open but one, the cursor on it; Enter clears it in a new best.
const lastCell = safe[safe.length - 1];
const nearly: State = { ...mid, open: mid.open.map((o, i) => o || (!mid.mine[i] && i !== lastCell)), cursor: lastCell, clock: { ms: 71_000 }, records: records({ beginner: 84_000 }) };
const won = apply(nearly, "open", undefined, undefined, 0);
if (won.phase !== "won" || lost.phase !== "lost") throw new Error(`the fixture's boards did not end: ${won.phase}, ${lost.phase}`);

const expert = { ...played("expert", 56, 16, 95_000), records: records({ beginner: 38_000 }) };

const palette = (st: State) => ({ title: "Minesweeper", icon: manifest.icon, view: "view", tree: render(st, 0) });
const fixture = {
  palettes: { minesweeper: palette(beginner), "minesweeper-end": palette(nearly), "minesweeper-expert": palette(expert) },
  effects: {
    "minesweeper/view:open": { view: render(lost, 0) },
    "minesweeper-end/view:open": { view: render(won, 0) },
  },
  shots: {
    "1-board": { palette: "minesweeper", keys: ["wait:500"] },
    "2-won": { palette: "minesweeper-end", keys: ["wait:400", "enter", "wait:1200"] },
    "3-lost": { palette: "minesweeper", keys: ["wait:400", "enter", "wait:1200"] },
    "4-expert": { palette: "minesweeper-expert", keys: ["wait:500"] },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/minesweeper.json", import.meta.url), JSON.stringify(fixture) + "\n");
console.log(`beginner: ${mid.open.filter(Boolean).length} open, won in ${won.clock.ms} ms, lost on ${lost.hit}; expert: ${expert.open.filter(Boolean).length} open`);
