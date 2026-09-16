// Writes app/src/gallery/shots/blackjack.json: the store screenshots'
// fixture, a bet prompt as the opening tree and the trees a key brings (a
// deal that lands a pair, its split, a stand the dealer busts on),
// rendered by render.ts from rigged shoes so the shots show what a hand
// looks like without playing one. `bun run extensions/blackjack/fixture.ts`,
// then `node app/scripts/shots.mjs blackjack`.
import { writeFileSync } from "node:fs";
import type { Card } from "./cards.ts";
import { DEFAULTS, apply, newGame, type State } from "./game.ts";
import { render } from "./render.ts";

/** A game twelve hands in, a bet of $25 on the table. */
const base: State = { ...newGame(DEFAULTS, () => 0.5), bet: 25, bankroll: 1085, stats: { hands: 12, wins: 7, losses: 5, pushes: 0, blackjacks: 1, net: 85 } };
/** A shoe of `left` cards that deals `order` next (a draw pops from the end). */
const rig = (st: State, order: Card[], left: number): State => ({ ...st, shoe: [...st.shoe.slice(0, left - order.length), ...[...order].reverse()] });

// Enter deals a pair of eights against a king; P splits it and each half draws.
const pair = apply(rig(base, ["8S", "KH", "8D", "7C", "3S", "5S"], 207), "deal");
const split = apply(pair, "split");
// S stands on 19 against a nine showing; the dealer turns a six and busts on a king.
const stand = apply(apply(rig(base, ["10S", "9H", "9D", "6C", "KS"], 205), "deal"), "stand");
if (stand.hands[0].outcome !== "win") throw new Error("the fixture's dealer did not bust");

const fixture = {
  palettes: { blackjack: { title: "Blackjack", icon: "🃏", view: "view", tree: render(base, DEFAULTS) } },
  effects: {
    "blackjack/view:deal": { view: render(pair, DEFAULTS) },
    "blackjack/view:split": { view: render(split, DEFAULTS) },
    "blackjack/view:stand": { view: render(stand, DEFAULTS) },
  },
  shots: {
    "1-bet": { palette: "blackjack", keys: ["wait:400"] },
    "2-hand": { palette: "blackjack", keys: ["wait:400", "enter", "wait:500", "p", "wait:900"] },
    "3-settled": { palette: "blackjack", keys: ["wait:400", "enter", "wait:500", "s", "wait:1200"] },
    "4-moves": { palette: "blackjack", keys: ["wait:400", "enter", "wait:700", "cmd+k"] },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/blackjack.json", import.meta.url), JSON.stringify(fixture) + "\n");
console.log(`pair: ${pair.hands[0].cards.join(" ")}, split: ${split.hands.map((h) => h.cards.join(" ")).join(" | ")}, stand: ${render(stand, DEFAULTS).title}`);
