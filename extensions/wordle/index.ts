// Wordle: a view palette. The board is a render tree (render.ts) built from
// a pure game state (game.ts); every key is a pick whose action id is the
// letter or the move, and the reply is the next tree. The game and the
// stats persist in the extension's storage after every change, so Escape
// mid-game loses nothing and the streak survives restarts. Opening the
// palette on a new day starts that day's puzzle (`daily` setting).
import { settings, storage, type Effect, type Extension } from "@zcag/pal";
import { DEFAULTS, apply, daily, isState, practice, share, stats0, sync, type Action, type Settings, type State } from "./game.ts";
import { render } from "./render.ts";
import { dayOf } from "./words.ts";

const GAME = "game";
const STATS = "stats";

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>() });

/** What the storage holds, as it is (`stored`), and brought to today (`st`): a fresh game when there is none (or one this version cannot read), a new day's daily. */
async function load(s: Settings, today: number): Promise<{ stored: State; st: State }> {
  const [game, stats] = await Promise.all([storage.get<unknown>(GAME), storage.get<unknown>(STATS)]);
  const stored = { game, stats: stats ?? stats0() } as State;
  const st: State = isState(stored) ? stored : { game: s.daily ? daily(today, s) : practice(s), stats: stats0() };
  return { stored, st: sync(st, s, today) };
}

/** Writes what changed since `before`, by identity: the rules make a new game or stats object when they touch one. */
async function save(before: State, after: State) {
  if (after.game !== before.game) await storage.set(GAME, after.game);
  if (after.stats !== before.stats) await storage.set(STATS, after.stats);
}

export default {
  palettes: {
    wordle: {
      title: "Wordle",
      view: async () => {
        const s = current(), today = dayOf();
        const { stored, st } = await load(s, today);
        await save(stored, st);
        return render(st, s, today);
      },
      pick: async (_id, action): Promise<Effect> => {
        const s = current(), today = dayOf();
        const { stored, st: before } = await load(s, today);
        const move = action as Action | undefined;
        if (move === "copy" && before.game.status !== "play") {
          const text = share(before.game);
          return { copy: text, toast: { title: "Copied", message: text.split("\n")[0] }, view: render(before, s, today) };
        }
        const after = move ? apply(before, move, s, today) : before;
        await save(stored, after);
        return { view: render(after, s, today) };
      },
    },
  },
} satisfies Extension;
