// Writes app/src/gallery/shots/solitaire.json: the store screenshots'
// fixture. The palette is the extension's own view (the surface node and
// the actions ⌘K lists, through the host harness); the page's storage is
// seeded with states from game.ts: a deal from a seeded deck, then that
// deal played forward by a plain greedy player (foundations first, then a
// run that uncovers a card, then the waste, else a draw) to the moment it
// is about to carry a run of three, and on to the win. Nothing random
// runs in the page: a stored state is drawn as it is (no deal animation),
// and a stored win opens the won table without the bouncing cascade.
// `make shots EXT=solitaire`.
import { Host } from "../../host/test/harness.ts";
import { pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { DEFAULTS, F, SUITS, T, WASTE, isTableau, move, newGame, quickTarget, refusal, suitOf, turn, type State } from "./game.ts";
import manifest from "./pal.json" with { type: "json" };

/** The record before this deal: 9 won of 23. */
const PREV = { stats: { played: 23, won: 9 }, game: 23 };

/** One greedy move, or none when it is stuck: a card home, a run that uncovers a card (or a king off a pile), the waste's card onto a pile, a draw. */
function next(st: State): { from: number; count: number; to: number } | "draw" | undefined {
  const tops = [WASTE, ...st.tableau.map((_, i) => T(i))];
  for (const p of tops) {
    const c = p === WASTE ? st.waste.at(-1) : st.tableau[p - 6].up.at(-1);
    if (c && !refusal(st, [c], F(SUITS.indexOf(suitOf(c))))) return { from: p, count: 1, to: F(SUITS.indexOf(suitOf(c))) };
  }
  for (let i = 0; i < 7; i++) {
    const pile = st.tableau[i];
    if (!pile.up.length || !pile.down.length) continue;
    const to = quickTarget(st, T(i), pile.up.length);
    if (to !== undefined && isTableau(to)) return { from: T(i), count: pile.up.length, to };
  }
  if (st.waste.length) {
    const to = quickTarget(st, WASTE, 1);
    if (to !== undefined) return { from: WASTE, count: 1, to };
  }
  return st.stock.length || st.waste.length ? "draw" : undefined;
}

/** A seeded deal played greedily: the deal, the first run of three about to move past move 25 with the stock still in hand, and the win (or undefined when greedy loses it). */
function playthrough(seed: number) {
  const deal = newGame(DEFAULTS, seeded(seed), PREV);
  let st = deal, carry: State | undefined, idle = 0;
  while (!st.won && idle < 60) {
    const m = next(st);
    if (!m) return undefined;
    if (m === "draw") { st = turn(st); idle++; continue; }
    if (!carry && m.count >= 3 && st.moves >= 25 && st.stock.length >= 8) carry = { ...st, cursor: m.from, depth: m.count };
    st = move(st, m.from, m.count, m.to);
    idle = 0;
  }
  return st.won && carry ? { deal, carry, won: st } : undefined;
}

let seed = 1, game: ReturnType<typeof playthrough>;
while (!(game = playthrough(seed))) seed++;
// The clock: four minutes in when the run is carried; the win's time is fixed (the clock stops).
const carry = { ...game.carry, elapsed: 252_300, history: game.carry.history.slice(-20) };
const won = { ...game.won, elapsed: 468_000, history: [] };

pinClock();
const host = await Host.bundled();
try {
  const view = await host.request("view", { extension: "solitaire", palette: "solitaire" });
  const palette = (state: State) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { state }, settings: { draw: "1", clock: true } } });
  writeFixture("solitaire", {
    palettes: { deal: palette(game.deal), carry: palette(carry), won: palette(won) },
    shots: {
      "1-deal": { palette: "deal", keys: ["wait:1200"], caption: "A fresh deal: the cursor on the stock, the moves, the time and the record beside the table" },
      "2-game": { palette: "carry", keys: ["wait:1200"], caption: `${carry.moves} moves in: the cursor takes ${carry.depth} cards of a run, the title line names them` },
      "3-carry": { palette: "carry", keys: ["wait:1000", "enter", "wait:800"], caption: "Enter picks the run up: it lifts, and the pile it can go on lights up" },
      "4-won": { palette: "won", keys: ["wait:1200"], caption: "Won: every card home, the moves and the time, Enter deals again" },
    },
  });
  console.log(`solitaire: seed ${seed}, carry at move ${carry.moves} (pile ${carry.cursor - 5}, ${carry.depth} cards), won in ${won.moves}`);
} finally {
  host.kill();
}
