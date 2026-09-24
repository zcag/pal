// Yahtzee: a view palette whose tree is one `surface`, the page in
// surface/ (the dice, the scorecard; mouse and keys). The page plays: it
// applies the moves with game.ts, the rules the host tests, and saves the
// state whole in the extension's storage after every move, so Escape
// mid-round loses nothing and the record (games, best, average) survives
// restarts. The extension's part is the view's actions (cmd+k lists the
// boxes the dice may go in, ranked) and its title, pushed again whenever
// the page says it moved; an action picked from cmd+k goes to the page
// (`onAction`).
import { storage, view, type Extension, type View, type ViewNode, type ViewPalette } from "@zcag/pal";
import { isState, newGame, type State } from "./game.ts";
import { titleOf, viewActions } from "./moves.ts";

const KEY = "state";

async function load(): Promise<State> {
  const stored = await storage.get<unknown>(KEY);
  return isState(stored) ? stored : newGame();
}

const CARD: ViewNode = { type: "surface", src: "surface/index.html", key: "card" };

const card = (st: State): View => ({ tree: CARD, actions: viewActions(st), title: titleOf(st) });

const yahtzee: ViewPalette = {
  title: "Yahtzee",
  view: async () => card(await load()),
  // A surface view's picks go to the page; nothing arrives here.
  pick: () => {},
  /** `{ moved: true }` after the page saved a move: the actions and the title follow. */
  onMessage: async (msg) => {
    if ((msg as { moved?: boolean } | null)?.moved) await view.update(card(await load()));
  },
};

export default { palettes: { yahtzee } } satisfies Extension;
