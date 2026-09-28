// Writes app/src/gallery/shots/blackjack.json: the store screenshots'
// fixture. Each palette is a table as the page finds it in storage: a
// state from game.ts over a shoe from a seeded shuffle, picked (seed by
// seed) so the hand plays out as the shot wants: a natural on the deal,
// a pair of eights split against a six, a stand the dealer then busts on.
// The view (its actions and title follow the phase) is the extension's own
// for that state, through the host harness. Each shot opens on the state
// it shows rather than playing into it: the gallery cannot run the
// extension, so the view's actions would stay the ones before the move
// (`pal.send({ moved })` is what refreshes them in pal). Every card is in
// the stored shoe, so the page draws nothing at random.
// `make shots EXT=blackjack`.
import { Host, stored } from "../../host/test/harness.ts";
import { pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { DEFAULTS, apply, isBust, newGame, rankOf, total, value, type State } from "./game.ts";
import manifest from "./pal.json" with { type: "json" };

const s = DEFAULTS;
/** An evening at the table so far: the bankroll up a little, a record under it. */
const at = (seed: number, bet: number): State => ({
  ...newGame(s, seeded(seed)), bet, bankroll: 1_385, handNo: 58,
  stats: { hands: 57, wins: 27, losses: 25, pushes: 5, blackjacks: 3, net: 385 },
});

/** The first seed whose deal (at `bet`) satisfies `ok`; the state before the deal and after it. */
function find(bet: number, ok: (dealt: State) => boolean): { before: State; dealt: State } {
  for (let seed = 1; seed < 5000; seed++) {
    const before = at(seed, bet), dealt = apply(before, "deal", s);
    if (ok(dealt)) return { before, dealt };
  }
  throw new Error("blackjack: no shoe for the shot");
}

// A natural on $50, the dealer showing no ace or ten (no peek).
const natural = find(50, (d) => d.phase === "settled" && d.hands[0].outcome === "blackjack" && !["A", "10", "J", "Q", "K"].includes(rankOf(d.dealer[0])));
// A pair of eights against a six, split: hand 1 in play with its second card, the hole card still down.
const split = find(25, (d) => d.phase === "play" && d.hands[0].cards.every((c) => rankOf(c) === "8") && rankOf(d.dealer[0]) === "6"
  && (() => { const p = apply(d, "split", s); return p.phase === "play" && p.active === 0 && total(p.hands[0].cards) >= 15; })());
const splitPlay = apply(split.dealt, "split", s);
// A hard fifteen against a six, stood on: the dealer draws and busts.
const bust = find(40, (d) => d.phase === "play" && total(d.hands[0].cards) === 15 && !value(d.hands[0].cards).soft && rankOf(d.dealer[0]) === "6"
  && (() => { const e = apply(d, "stand", s); return isBust(e.dealer) && e.dealer.length >= 3; })());

pinClock();
const host = await Host.bundled();
try {
  const palette = async (state: State) => {
    stored.set("blackjack\0state", state);
    const view = await host.request("view", { extension: "blackjack", palette: "blackjack" });
    return { title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { state }, settings: { ...s } } };
  };
  writeFixture("blackjack", {
    palettes: { natural: await palette(natural.dealt), split: await palette(splitPlay), bust: await palette(apply(bust.dealt, "stand", s)), bet: await palette(at(7, 50)) },
    shots: {
      "1-blackjack": { palette: "natural", keys: ["wait:1800"], caption: "A blackjack: 3:2 on the $50 bet, the winnings stacked beside it" },
      "2-hand": { palette: "split", keys: ["wait:1500"], caption: "Mid-hand after a split: hand 1 is being played, the hole card is face down" },
      "3-settled": { palette: "bust", keys: ["wait:1800"], caption: "Settled: the dealer drew and bust, the winnings stacked on the bet, the bankroll moved" },
      "4-bet": { palette: "bet", keys: ["wait:1000", "up", "wait:200", "up", "wait:900"], caption: "Placing a bet: the chips on the felt, up and down move it by the minimum, Enter deals" },
    },
  });
  console.log(`blackjack: natural ${natural.dealt.hands[0].cards}, split ${splitPlay.hands.map((h) => h.cards).join(" | ")} vs ${split.dealt.dealer[0]}, bust ${bust.dealt.hands[0].cards} vs ${bust.dealt.dealer[0]}`);
} finally {
  host.kill();
}
