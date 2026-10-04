// Wordle: a view palette. The board is a render tree (render.ts) built from
// a pure game state (game.ts); every key is a pick whose action id is the
// letter or the move, and the reply is the next tree. The game and the
// stats persist in the extension's storage after every change, so Escape
// mid-game loses nothing and the streak survives restarts. Opening the
// palette on a new day starts that day's puzzle (`daily` setting).
//
// Storage is shaped so a pal account can merge it (`sync` in pal.json):
// the game in play (`game`, the newest wins), the stats (`stats`: counts
// added up across machines, the longest streak the larger) and the dailies
// won and lost (`daily_won`, `daily_lost`: put together), which the streak
// is counted from. Each pick reads them afresh, so a value sync brought in
// is what the next key builds on. Stats from before (the streak as a
// number) are moved over on the first read (game.ts `fromStore`).
//
// A daily won goes on its puzzle's leaderboard (`daily/<number>`, fewest
// guesses first) and the longest streak on `streak`.
import { account, leaderboard, settings, storage, type Effect, type Extension } from "@zcag/pal";
import { DEFAULTS, apply, daily, fromStore, isState, practice, share, sync, toStore, type Action, type Settings, type State } from "./game.ts";
import { render } from "./render.ts";
import { dayOf } from "./words.ts";

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>() });

/** What the storage holds, as it is (`stored`), and brought to today (`st`): a fresh game when there is none (or one this version cannot read), a new day's daily. */
async function load(s: Settings, today: number): Promise<{ stored: State; st: State }> {
  const [game, stats, won, lost] = await Promise.all([storage.get<unknown>("game"), storage.get<unknown>("stats"), storage.get<unknown>("daily_won"), storage.get<unknown>("daily_lost")]);
  const read = fromStore(stats, won, lost);
  if (read.legacy) await Promise.all([storage.set("stats", toStore(read.stats)), storage.set("daily_won", read.days.won), storage.set("daily_lost", read.days.lost)]);
  const stored = { game, stats: read.stats, days: read.days } as State;
  const st: State = isState(stored) ? stored : { game: s.daily ? daily(today, s) : practice(s), stats: read.stats, days: read.days };
  return { stored, st: sync(st, s, today) };
}

/** Writes what changed since `before`, by identity: the rules make a new game, stats or days object when they touch one. */
async function save(before: State, after: State) {
  if (after.game !== before.game) await storage.set("game", after.game);
  if (after.stats !== before.stats) await storage.set("stats", toStore(after.stats));
  if (after.days.won !== before.days.won) await storage.set("daily_won", after.days.won);
  if (after.days.lost !== before.days.lost) await storage.set("daily_lost", after.days.lost);
}

/** A daily just won: its guesses on the puzzle's board, the longest streak on `streak`. In the background, so the reply never waits on the network. */
function post(before: State, after: State) {
  const g = after.game;
  if (g.day === null || g.status !== "won" || before.game.status !== "play") return;
  void leaderboard.post(`daily/${g.day + 1}`, g.guesses.length).catch(() => {});
  if (after.stats.best > 0) void leaderboard.post("streak", after.stats.best).catch(() => {});
}

/** Signed out, as the core says; unknown (no account support) counts as signed in, so the hint stays away. */
const signedOut = () => account.get().then((a) => a?.signedIn === false, () => false);
/** The sign-in hint: after a daily, while signed out. */
const offerSignIn = async (st: State) => st.game.day !== null && st.game.status !== "play" && (await signedOut());

export default {
  palettes: {
    wordle: {
      title: "Wordle",
      view: async () => {
        const s = current(), today = dayOf();
        const { stored, st } = await load(s, today);
        await save(stored, st);
        return render(st, s, today, await offerSignIn(st));
      },
      pick: async (_id, action): Promise<Effect> => {
        const s = current(), today = dayOf();
        const { stored, st: before } = await load(s, today);
        const move = action as Action | "signin" | undefined;
        if (move === "signin") {
          await account.signIn();
          return { view: render(before, s, today, false) };
        }
        if (move === "copy" && before.game.status !== "play") {
          const text = share(before.game);
          return { copy: text, toast: { title: "Copied", message: text.split("\n")[0] }, view: render(before, s, today, await offerSignIn(before)) };
        }
        const after = move ? apply(before, move, s, today) : before;
        await save(stored, after);
        post(before, after);
        return { view: render(after, s, today, await offerSignIn(after)) };
      },
    },
  },
} satisfies Extension;
