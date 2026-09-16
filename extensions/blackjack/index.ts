// Blackjack: a view palette. The table is a render tree (render.ts) built
// from a pure game state (game.ts); every key is a pick whose action id is
// the move, and the reply is the next tree. The state persists whole in
// the extension's storage after every move, so Escape mid-hand loses
// nothing and the bankroll and the record survive restarts.
import type { Extension } from "../../host/src/protocol.ts";
import { settings, storage } from "../../host/src/api.ts";
import { DEFAULTS, apply, isState, newGame, type Action, type Settings, type State } from "./game.ts";
import { render } from "./render.ts";

const KEY = "state";

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>() });

/** The stored state, or a fresh game when there is none (or one this version cannot read). */
async function load(s: Settings): Promise<State> {
  const stored = await storage.get<unknown>(KEY);
  return isState(stored) ? stored : newGame(s);
}

const move = (action?: string): Action | undefined => action as Action | undefined;

export default {
  palettes: {
    blackjack: {
      title: "Blackjack",
      icon: "🃏",
      view: async () => render(await load(current()), current()),
      pick: async (_id, action) => {
        const s = current();
        const before = await load(s);
        const m = move(action);
        const after = m ? apply(before, m, s) : before;
        if (after !== before) await storage.set(KEY, after);
        return { view: render(after, s) };
      },
    },
  },
} satisfies Extension;
