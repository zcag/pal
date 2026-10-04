// Yahtzee: a view palette whose tree is one `surface`, the page in
// surface/ (the dice, the scorecard; mouse and keys). The page plays: it
// applies the moves with game.ts, the rules the host tests, and saves the
// game in the extension's storage after every move (progress.ts: the card
// stays here, the record syncs), so Escape mid-round loses nothing and
// the record (games, best, average) survives restarts; a finished card
// goes to the boards. The extension's part is the view's actions (cmd+k
// lists the boxes the dice may go in, ranked) and its title, pushed again
// whenever the page says it moved; an action picked from cmd+k goes to
// the page (`onAction`).
import { storage, view, type Extension, type View, type ViewNode, type ViewPalette } from "@zcag/pal";
import type { State } from "./game.ts";
import { titleOf, viewActions } from "./moves.ts";
import { KEYS, restore } from "./progress.ts";

const load = async (): Promise<State> => restore(Object.fromEntries(await Promise.all(KEYS.map(async (k) => [k, await storage.get<unknown>(k)]))));

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
