// Writes app/src/gallery/shots/crossword.json: the store screenshots'
// fixture. The page asks the extension for everything (`pal.send`: the
// sources, the puzzle, the month, the stats, the solve), so the fixture runs
// the extension in the host harness over a data directory of its own
// (`PAL_CROSSWORD_DIR`, a temp directory) and records its replies. Nothing is
// fetched: the directory's cache already holds September's list of daily
// minis (invented titles and constructors) and today's puzzle (a hand-made
// mini from the crossword tests, never a Crosshare puzzle), and
// `PAL_CROSSWORD_URL` points at a closed port so a miss fails instead of
// going out. The record: most dailies since August solved on their day, a
// streak to yesterday. A second directory has today's mini one letter from
// done, for the finish. `make shots EXT=crossword`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../../host/test/harness.ts";
import { TALL } from "../../host/test/extensions/crossword-fixtures.ts";
import { NOW, pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { encode, gridOf, newPlay, select, type Play } from "./game.ts";
import { fromIpuz } from "./ipuz.ts";
import type { Listed } from "./sources.ts";
import type { Solve } from "./stats.ts";
import type { Data } from "./store.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
const DAY = 86_400_000;
const utc = (t: number) => new Date(t).toISOString().slice(0, 10);
const TODAY = utc(NOW);
const idOf = (date: string) => `mini${date.replaceAll("-", "")}`;
const ID = idOf(TODAY);

// September's daily minis, newest first, as the site lists them (invented names).
const TITLES = ["Standing Tall", "Kitchen Table", "Low Tide", "Night Shift", "Paper Trail", "Short Order", "Second Wind", "Loose Ends", "Head Start",
  "Fair Game", "Open Book", "Tall Tale", "Small Talk", "Cold Feet", "Fresh Start", "Side Step"];
const AUTHORS = ["Pat Quill", "Robin Vale", "Sam Okafor", "Lee Marsh", "Ada Wren", "Jo Bright"];
const month: Listed[] = Array.from({ length: 16 }, (_, k) => {
  const date = `2026-09-${String(16 - k).padStart(2, "0")}`;
  const title = k === 0 ? TALL.title! : TITLES[k];
  return { id: idOf(date), source: "crosshare", title, author: k === 0 ? TALL.author! : AUTHORS[k % AUTHORS.length], w: 5, h: 5, date, slug: title.toLowerCase().replaceAll(" ", "-") };
});

// The record: the daily most days since August, on its day in the evening (UTC), a streak of the last nine days.
const r = seeded(5);
const solves: Solve[] = [];
for (let back = 46; back >= 1; back--) {
  if (back > 9 && r() < 0.3) continue;
  const at = NOW - back * DAY + Math.round((r() - 0.5) * 3 * 3_600_000), date = utc(at);
  const k = 16 - Number(date.slice(8, 10));
  solves.push({ id: idOf(date), title: date.startsWith("2026-09") ? TITLES[k] : TITLES[back % TITLES.length], author: AUTHORS[back % AUTHORS.length], date, at, size: "5×5",
    ms: Math.round((95 + 50 * r() + back * 0.8) * 1000), ...(r() < 0.1 && { checked: true }) });
}

const puzzle = { ...fromIpuz(TALL, ID) }, g = gridOf(puzzle);
/** Today's mini with the squares `filled` says filled right, the cursor on `at` going `dir`. */
function solve(filled: (i: number) => boolean, at: number, dir: "across" | "down", ms: number): Play {
  const st = newPlay(g);
  return select(g, { ...st, fill: puzzle.solution.map((s, i) => (s && filled(i) ? s : "")), ms }, at, dir);
}
const firstOf = (dir: "across" | "down", n: number) => g.words.find((w) => w.dir === dir && w.n === n)!.cells;
// Mid-solve: the first two rows and 2-Down in, the cursor at the start of 6-Across.
const mid = solve((i) => i < 10 || firstOf("down", 2).includes(i), firstOf("across", 6)[0], "across", 64_000);
// One square left, the cursor on it: its letter finishes the grid.
const lastCell = firstOf("across", 8).at(-1)!;
const last = solve((i) => i !== lastCell, lastCell, "across", 83_000);
const done = { ...last, fill: puzzle.solution.slice(), done: { ms: 83_000, at: NOW } };

/** A data directory with today's mini at `play`; the extension's replies to what the page asks, recorded. */
async function replies(play: Play, extra: Record<string, unknown>[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "pal-crossword-fixture-"));
  mkdirSync(join(dir, "cache", "lists"), { recursive: true });
  mkdirSync(join(dir, "cache", "puzzles"), { recursive: true });
  writeFileSync(join(dir, "cache", "lists", "daily-2026-09.json"), JSON.stringify({ at: NOW, v: month }));
  writeFileSync(join(dir, "cache", "puzzles", `${ID}.json`), JSON.stringify({ raw: TALL, date: TODAY, slug: month[0].slug }));
  const data: Data = { v: 1, progress: { [ID]: { ...encode(play, puzzle), touched: NOW - 15 * 60_000 } }, solves, meta: { [ID]: { title: TALL.title!, author: TALL.author!, date: TODAY, slug: month[0].slug, w: 5, h: 5 } }, last: ID };
  writeFileSync(join(dir, "progress.json"), JSON.stringify(data));
  process.env.PAL_CROSSWORD_DIR = dir;
  process.env.PAL_CROSSWORD_URL = "http://127.0.0.1:9";
  const host = await Host.bundled();
  try {
    const asks = [{ op: "sources" }, { op: "stats", source: "crosshare" }, { op: "open" }, { op: "month", source: "crosshare", year: 2026, month: 9 }, { op: "progress" }, ...extra];
    const send = [];
    for (const msg of asks) send.push({ msg, reply: await host.surfaceSend("crossword", "crossword", msg) });
    return { send, view: await host.request("view", { extension: "crossword", palette: "crossword" }) };
  } finally {
    host.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

const a = await replies(mid), b = await replies(last, [{ op: "solved", id: ID, play: encode(done, puzzle) }]);
// The solve's reply is matched on the op alone: the page's play is this one, the clock pinned.
b.send.at(-1)!.msg = { op: "solved" };
const SETTINGS = { source: "crosshare", autocheck: false, suggest: true, clock: true };
const palette = (x: typeof a) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: x.view, surface: { storage: {}, settings: SETTINGS, send: x.send } });
writeFixture("crossword", {
  palettes: { play: palette(a), last: palette(b) },
  shots: {
    "1-solving": { palette: "play", keys: ["wait:1500", "type:o", "wait:600"], caption: "Today's mini mid-solve: the clue you are on above the lists, the crossing clue lit" },
    "2-solved": { palette: "last", keys: ["wait:1500", `type:${puzzle.solution[lastCell].toLowerCase()}`, "wait:2600"], caption: "Solved: the time, the best, the streak, Next puzzle on Enter" },
    "3-browse": { palette: "play", keys: ["wait:1500", "cmd+o", "wait:1000"], caption: "The daily minis month by month, solved and started marked" },
    "4-stats": { palette: "play", keys: ["wait:1500", "cmd+s", "wait:1000"], caption: "Stats: best and average, the streak, recent times" },
  },
});
const opened = a.send.find((s) => s.msg.op === "open")!.reply as { puzzle?: { title: string } };
console.log(`crossword: today ${ID} "${opened.puzzle?.title}", ${solves.length} solves, finish on ${puzzle.solution[lastCell]}`);
