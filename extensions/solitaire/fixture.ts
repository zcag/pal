// Writes app/src/gallery/shots/solitaire.json: the store screenshots'
// fixture, a fresh deal as the opening tree and the trees a key brings (a
// game some way in, a run carried to the pile it goes on, a won table),
// rendered by render.ts from a seeded deal played forward by a greedy hand,
// so the shots show a real game without playing one.
// `bun run extensions/solitaire/fixture.ts`, then
// `node app/scripts/shots.mjs solitaire`.
import { writeFileSync } from "node:fs";
import { RANKS, SUITS, type Card } from "../blackjack/cards.ts";
import { T, WASTE, isFoundation, isTableau, move, newGame, quickTarget, turn, type State } from "./game.ts";
import { render } from "./render.ts";

/** A seeded shuffle: the same deal every run. */
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
/** The twelfth deal, four of the eleven before it won. */
const deal = newGame({ draw: "1" }, seeded(3), { stats: { played: 11, won: 4 }, game: 11 });

type Play = { from: number; count: number; to: number };
/** The greedy hand's next play: the waste, then each pile's deepest run that goes somewhere; none means draw. */
function play(st: State): Play | undefined {
  for (const from of [WASTE, ...[0, 1, 2, 3, 4, 5, 6].map(T)]) {
    const up = from === WASTE ? 1 : st.tableau[from - 6].up.length;
    // A pile's whole run moves only when that uncovers something (or it goes home), else it only shuffles kings about.
    const bare = from !== WASTE && !st.tableau[from - 6].down.length;
    for (let count = up; count >= 1; count--) {
      const to = quickTarget(st, from, count);
      if (to !== undefined && (isFoundation(to) || !(bare && count === up))) return { from, count, to };
    }
  }
  return undefined;
}

// Forty plays in; `carry` is the last run of two or more cards that moved pile to pile on the way, just before it moved.
let mid = deal, carry: { st: State; p: Play } | undefined;
for (let i = 0; i < 40; i++) {
  const p = play(mid);
  if (p && isTableau(p.from) && isTableau(p.to) && p.count > 1) carry = { st: mid, p };
  mid = p ? move(mid, p.from, p.count, p.to) : turn(mid);
}
if (!carry) throw new Error("the fixture's game carried no run");
mid = { ...mid, elapsed: 204_000 };
const carried: State = { ...carry.st, held: { from: carry.p.from, count: carry.p.count }, cursor: carry.p.to, elapsed: 118_000 };

const won: State = {
  ...mid, stock: [], waste: [], tableau: mid.tableau.map(() => ({ down: [], up: [] })),
  foundations: SUITS.map((s) => RANKS.map((r) => `${r}${s}` as Card)), won: true, moves: 131, elapsed: 391_000, stats: { played: 12, won: 5 },
};

const fixture = {
  palettes: { solitaire: { title: "Solitaire", icon: { tile: { glyph: "\u{f18af}", bg: "green" } }, view: "view", tree: render(deal) } },
  effects: {
    "solitaire/view:down": { view: render(mid) },
    "solitaire/view:right": { view: render(carried) },
    "solitaire/view:select": { view: render(won) },
  },
  shots: {
    "1-deal": { palette: "solitaire", keys: ["wait:900"] },
    "2-game": { palette: "solitaire", keys: ["wait:400", "down", "wait:900"] },
    "3-moving": { palette: "solitaire", keys: ["wait:400", "right", "wait:900"] },
    "4-won": { palette: "solitaire", keys: ["wait:400", "enter", "wait:700"] },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/solitaire.json", import.meta.url), JSON.stringify(fixture) + "\n");
console.log(`mid: ${mid.moves} moves, ${mid.foundations.flat().length} home; carried: ${render(carried).title}`);
