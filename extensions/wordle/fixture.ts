// Writes app/src/gallery/shots/wordle.json: the store screenshots' fixture,
// a daily in progress as the opening tree (three guesses in, two letters
// typed) and the trees a key brings (a bad word's notice, the solved board
// with the stats), rendered by render.ts from rigged states so the shots
// show what a game looks like without playing one. `bun run
// extensions/wordle/fixture.ts`, then `node app/scripts/shots.mjs wordle`.
import { writeFileSync } from "node:fs";
import { DEFAULTS, apply, type State } from "./game.ts";
import { render } from "./render.ts";

const TODAY = 258;
const stats = { played: 41, won: 38, streak: 12, best: 19, dist: [1, 6, 14, 11, 5, 1], lastDay: TODAY - 1 };
const mid: State = { game: { answer: "crane", guesses: ["slate", "trace", "brace"], day: TODAY, hard: false, input: "cr", status: "play" }, stats };
const typed: State = { ...mid, game: { ...mid.game, input: "crane" } };
const bad = apply({ ...mid, game: { ...mid.game, input: "crxne" } }, "submit", DEFAULTS, TODAY);
const solved = apply(typed, "submit", DEFAULTS, TODAY);
if (solved.game.status !== "won") throw new Error("the fixture's answer did not solve");
// The solved shot: `k` fills the row from the fixture, Enter submits it.
const fixture = {
  palettes: { wordle: { title: "Wordle", icon: "🟩", view: "view", tree: render(mid, DEFAULTS, TODAY) } },
  effects: {
    "wordle/view:x": { view: render(bad, DEFAULTS, TODAY) },
    "wordle/view:a": { view: render({ ...mid, game: { ...mid.game, input: "cra" } }, DEFAULTS, TODAY) },
    "wordle/view:n": { view: render({ ...mid, game: { ...mid.game, input: "cran" } }, DEFAULTS, TODAY) },
    "wordle/view:e": { view: render({ ...mid, game: { ...mid.game, input: "crane" } }, DEFAULTS, TODAY) },
    "wordle/view:submit": { view: render(apply({ ...mid, game: { ...mid.game, input: "crane" } }, "submit", DEFAULTS, TODAY), DEFAULTS, TODAY) },
  },
  shots: {
    "1-game": { palette: "wordle", keys: ["wait:400"] },
    "2-notice": { palette: "wordle", keys: ["wait:300", "x", "wait:600"] },
    "3-solved": { palette: "wordle", keys: ["wait:300", "a", "wait:200", "n", "wait:200", "e", "wait:300", "enter", "wait:1200"] },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/wordle.json", import.meta.url), JSON.stringify(fixture) + "\n");
console.log(`bad notice: ${bad.notice?.text}, solved in ${solved.game.guesses.length}`);
