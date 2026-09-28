// Writes app/src/gallery/shots/yahtzee.json: the store screenshots'
// fixture. Each palette is a card as the page finds it in storage: a game
// from game.ts played by a plain strategy (keep the most common face,
// throw the rest, score the box that adds most) on seeded dice, searched
// seed by seed until the round on the table is the one the shot wants:
// three fours kept after the first throw, a full house after the third,
// a second Yahtzee that has to go in a straight as a Joker, the last box
// filled. The view (the boxes cmd+k lists, the title) is the extension's
// own for that state, through the host harness. No shot throws: a throw's
// tumble is the page's own Math.random, so every die in a picture is one
// the stored state already holds. `make shots EXT=yahtzee`.
import { Host, stored } from "../../host/test/harness.ts";
import { pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { ROLLS, apply, bestOption, counts, isJoker, isOpen, isYahtzee, newGame, options, type Rng, type State } from "./game.ts";
import manifest from "./pal.json" with { type: "json" };

/** Eleven games before this one. */
const RECORD = { games: 11, sum: 2_387, best: 268 };

/** The face to keep: the most common, the higher on a tie. */
const keep = (dice: number[]) => { const c = counts(dice); let f = 6; for (let d = 5; d >= 1; d--) if (c[d] > c[f]) f = d; return f; };
/** Throws the round's dice up to `rolls` times, keeping the most common face between throws (or stopping on `stop`). */
function throwRound(st: State, rng: Rng, rolls = ROLLS, stop = (_: State) => false): State {
  st = apply(st, { type: "roll" }, rng);
  while (st.rolls < rolls && !stop(st)) {
    const f = keep(st.dice);
    st.dice.forEach((d, i) => { if ((d === f) !== st.held[i]) st = apply(st, { type: "hold", die: i }); });
    st = apply(st, { type: "roll" }, rng);
  }
  return st;
}
/** `n` whole rounds on `rng`: thrown, then scored where they add most. */
function rounds(st: State, n: number, rng: Rng): State {
  for (let r = 0; r < n; r++) { const t = throwRound(st, rng); st = apply(t, { type: "score", category: bestOption(t)! }, rng); }
  return st;
}
/** Plays `n` rounds so `ok` holds for each prefix seed, then throws the next round (on another seed) until `want`; the first pair of seeds that does. */
function find(n: number, ok: (st: State) => boolean, round: (st: State, rng: Rng) => State, want: (st: State) => boolean): State {
  for (let a = 1; a < 400; a++) {
    const played = rounds(newGame(RECORD), n, seeded(a));
    if (!ok(played)) continue;
    for (let b = 1; b < 400; b++) {
      const st = round(played, seeded(1000 + b));
      if (want(st)) return st;
    }
  }
  throw new Error("yahtzee: no game for the shot");
}

// Round 8: the first throw showed three fours, and they are kept; every open box says what it would score.
const fours = find(7, () => true, (st, rng) => {
  const t = apply(st, { type: "roll" }, rng);
  return t.dice.reduce((s, d, i) => (d === 4 ? apply(s, { type: "hold", die: i }) : s), t);
}, (st) => counts(st.dice)[4] === 3 && isOpen(st, "fours"));
// Round 10, out of throws: a full house on the table, the cursor on the box that adds most.
const house = find(9, (st) => isOpen(st, "full-house"), (st, rng) => throwRound(st, rng), (st) => st.rolls === ROLLS && bestOption(st) === "full-house");
// Round 11: the Yahtzee box already holds 50, its upper box is filled, a straight is open: the new one is a Joker, and +100.
const joker = find(10, (st) => st.scores.yahtzee === 50 && isOpen(st, "large-straight"),
  (st, rng) => throwRound(st, rng, ROLLS, (s) => isYahtzee(s.dice)), (st) => isJoker(st) && options(st)["large-straight"] === 40);
// The last box filled: the final score over the record.
const over = (() => { for (let a = 1; a < 400; a++) { const st = rounds(newGame(RECORD), 13, seeded(a)); if (st.ended?.best && st.ended.total < 300) return st; } throw new Error("yahtzee: no best game"); })();

pinClock();
const host = await Host.bundled();
try {
  const palette = async (state: State) => {
    stored.set("yahtzee\0state", state);
    const view = await host.request("view", { extension: "yahtzee", palette: "yahtzee" });
    return { title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { state } } };
  };
  writeFixture("yahtzee", {
    palettes: { roll: await palette(fours), choose: await palette(house), joker: await palette(joker), over: await palette(over) },
    shots: {
      "1-roll": { palette: "roll", keys: ["wait:1500"], caption: "Mid-round: three fours kept, each open box showing what it would score" },
      "2-choose": { palette: "choose", keys: ["wait:1500"], caption: "Out of throws: the cursor on the card, the dice it counts ringed, the total showing what it adds" },
      "3-yahtzee": { palette: "joker", keys: ["wait:1200", ...(joker.rolls < ROLLS ? ["down", "wait:500"] : [])], caption: "A second Yahtzee: 100 more, and as a Joker it fills a straight" },
      "4-over": { palette: "over", keys: ["wait:1500"], caption: "Game over: the final score with the best and the average" },
    },
  });
  console.log(`yahtzee: fours ${fours.dice}, house ${house.dice}, joker ${joker.dice} (${joker.rolls} throws, best ${bestOption(joker)}), over ${over.ended?.total}`);
} finally {
  host.kill();
}
