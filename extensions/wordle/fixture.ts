// Writes app/src/gallery/shots/wordle.json: the store screenshots' fixture,
// a daily in progress as the opening tree (three guesses in, two letters
// typed), a bad word's notice and the solved board
// with the stats, each its own palette, rendered by render.ts from rigged states so the shots
// show what a game looks like without playing one. `bun run
// extensions/wordle/fixture.ts`, then `node app/scripts/shots.mjs wordle`.
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { DEFAULTS, apply, type State } from "./game.ts";
import { render } from "./render.ts";
import { dayOf } from "./words.ts";

pinClock();
/** The strip's day: puzzle #259. */
const TODAY = dayOf(new Date(NOW));
const stats = { played: 41, won: 38, streak: 12, best: 19, dist: [1, 6, 14, 11, 5, 1], lastDay: TODAY - 1 };
/** The twelve dailies before today, won: the streak the stats show. */
const days = { won: Array.from({ length: 12 }, (_, i) => TODAY - 12 + i), lost: [] };
const mid: State = { game: { answer: "crane", guesses: ["slate", "trace", "brace"], day: TODAY, hard: false, input: "cr", status: "play" }, stats, days };
const typed: State = { ...mid, game: { ...mid.game, input: "crane" } };
const bad = apply({ ...mid, game: { ...mid.game, input: "crxne" } }, "submit", DEFAULTS, TODAY);
const solved = apply(typed, "submit", DEFAULTS, TODAY);
if (solved.game.status !== "won") throw new Error("the fixture's answer did not solve");
// Each shot opens on its own tree rather than keys through effects: a view pick in the gallery is lost to a reload now and then.
const fixture = {
  palettes: {
    wordle: { title: "Wordle", icon: "🟩", view: "view", tree: render(mid, DEFAULTS, TODAY) },
    notice: { title: "Wordle", icon: "🟩", view: "view", tree: render(bad, DEFAULTS, TODAY) },
    solved: { title: "Wordle", icon: "🟩", view: "view", tree: render(solved, DEFAULTS, TODAY) },
  },
  shots: {
    "1-game": { palette: "wordle", keys: ["wait:1500"], caption: "The daily, three guesses in and two letters typed: the keyboard shows what the guesses found" },
    "2-notice": { palette: "notice", keys: ["wait:1500"], caption: "A word that is not in the list: a notice under the title, and the row stays for editing" },
    "3-solved": { palette: "solved", keys: ["wait:2000"], caption: "Solved in four: the praise, the stats and the guess distribution, C copies the grid" },
  },
};
writeFixture("wordle", fixture);
console.log(`bad notice: ${bad.notice?.text}, solved in ${solved.game.guesses.length}`);
