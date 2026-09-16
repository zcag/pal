// Writes app/src/gallery/shots/2048.json: the store screenshots' fixture, a
// mid-game board as the opening tree and the trees a key brings (a move
// that makes 2048, a move into game over), rendered by render.ts from
// rigged states so the shots show what a game looks like without playing
// one. `bun run extensions/2048/fixture.ts`, then `node app/scripts/shots.mjs 2048`.
import { writeFileSync } from "node:fs";
import { DEFAULTS, apply, type Board, type State } from "./game.ts";
import { render } from "./render.ts";

let id = 1;
const tiles = (vs: number[]): Board => vs.map((v) => (v ? { id: id++, v } : null));
const state = (vs: number[], extra: Partial<State> = {}): State => ({ board: tiles(vs), score: 0, best: 0, moves: 0, seq: 100, won: false, kept: false, games: 1, ...extra });

const rng = (() => { let i = 0; const seq = [0.3, 0.5, 0.7, 0.95, 0.1, 0.5]; return () => seq[i++ % seq.length]; })();

// Mid-game: a good board with an undo on hand.
const mid = state([
  512, 128, 32, 8,
  256, 64, 16, 2,
  4, 8, 4, 0,
  2, 0, 2, 0,
], { score: 6140, best: 12876, moves: 431, prev: { board: tiles([512, 128, 32, 8, 256, 64, 16, 2, 4, 8, 2, 2, 2, 0, 2, 0]), score: 6136, moves: 430, won: false } });
mid.last = { dir: "left", moved: [], merged: [mid.board[10]!.id], spawned: [] };

// One move from 2048: right merges the two 1024s.
const nearWon = state([
  1024, 1024, 64, 8,
  4, 256, 32, 2,
  2, 16, 8, 0,
  8, 2, 0, 0,
], { score: 19348, best: 19348, moves: 1102 });
const won = apply(nearWon, "right", DEFAULTS, rng);

// One move from the end: up merges the last pair and the spawn fills the board.
const nearOver = state([
  0, 4, 2, 8,
  2, 16, 4, 2,
  8, 2, 128, 64,
  2, 8, 16, 2,
], { score: 1560, best: 12876, moves: 214 });
const over = apply(nearOver, "up", DEFAULTS, () => 0.99);

const fixture = {
  palettes: { "2048": { title: "2048", icon: "🔢", view: "view", tree: render(mid, DEFAULTS) } },
  effects: {
    "2048/view:right": { view: render(won, DEFAULTS) },
    "2048/view:up": { view: render(over, DEFAULTS) },
  },
  shots: {
    "1-board": { palette: "2048", keys: ["wait:400"] },
    "2-won": { palette: "2048", keys: ["wait:300", "right", "wait:900"] },
    "3-over": { palette: "2048", keys: ["wait:300", "up", "wait:900"] },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/2048.json", import.meta.url), JSON.stringify(fixture) + "\n");
console.log(`won: ${won.won} (${won.board.filter((t) => t?.v === 2048).length} tile), over: ${over.board.every(Boolean)}`);
