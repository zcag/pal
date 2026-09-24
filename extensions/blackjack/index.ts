// Blackjack: a view palette whose tree is one `surface`, the table page
// in surface/ (felt, the Kenney deck, chips; mouse and keys). The page
// plays: it applies the moves with game.ts, the same rules the host
// tests, and saves the state whole in the extension's storage after
// every move, so Escape mid-hand loses nothing and the bankroll and the
// record survive restarts. The extension's part is the view's actions
// (what cmd+k lists, the footer's first) and its title, pushed again
// whenever the page says it moved, since the legal moves change with
// the phase; a move picked from cmd+k goes to the page (`onAction`).
import { settings, storage, view, type Extension, type View, type ViewNode, type ViewPalette } from "@zcag/pal";
import { DEFAULTS, isState, newGame, type Settings, type State } from "./game.ts";
import { titleOf, viewActions } from "./moves.ts";

const KEY = "state";

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>() });

/** The stored state, or a fresh game when there is none (or one this version cannot read). */
async function load(s: Settings): Promise<State> {
  const stored = await storage.get<unknown>(KEY);
  return isState(stored) ? stored : newGame(s);
}

// `surface` is not in the SDK's ViewNode yet (the surface contract); the cast goes once it is.
const TABLE = { type: "surface", src: "surface/index.html", key: "table" } as unknown as ViewNode;

const table = (st: State, s: Settings): View => ({ tree: TABLE, actions: viewActions(st, s), title: titleOf(st, s) });

// `onMessage` is not on the SDK's Palette yet either; a variable, not a literal, keeps `satisfies` from calling it excess.
const blackjack: ViewPalette & { onMessage(msg: unknown): Promise<void> } = {
  title: "Blackjack",
  view: async () => table(await load(current()), current()),
  // A surface view's picks go to the page; nothing arrives here.
  pick: () => {},
  /** `{ moved: true }` after the page saved a move: the actions and the title follow the phase. */
  onMessage: async (msg) => {
    if ((msg as { moved?: boolean } | null)?.moved) await view.update(table(await load(current()), current()));
  },
};

export default { palettes: { blackjack } } satisfies Extension;
