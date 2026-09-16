// 2048: a view palette. The board is a render tree (render.ts) built from
// a pure game state (game.ts); every key is a pick whose action id is the
// move, and the reply is the next tree. The state persists whole in the
// extension's storage after every move, so Escape mid-game loses nothing
// and the best score survives restarts.
import { settings, storage, type Extension } from "@zcag/pal";
import { DEFAULTS, apply, isState, newGame, type Action, type Settings, type State } from "./game.ts";
import { render } from "./render.ts";

const KEY = "state";

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>() });

/** The stored state, or a fresh game when there is none (or one this version cannot read). */
async function load(): Promise<State> {
  const stored = await storage.get<unknown>(KEY);
  if (isState(stored)) return stored;
  const st = newGame();
  await storage.set(KEY, st);
  return st;
}

export default {
  palettes: {
    "2048": {
      title: "2048",
      view: async () => render(await load(), current()),
      pick: async (_id, action) => {
        const s = current();
        const before = await load();
        const after = action ? apply(before, action as Action, s) : before;
        if (after !== before) await storage.set(KEY, after);
        return { view: render(after, s) };
      },
    },
  },
} satisfies Extension;
