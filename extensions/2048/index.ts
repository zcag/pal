// 2048: a view palette. The board is a render tree (render.ts) built from
// a pure game state (game.ts); every key is a pick whose action id is the
// move, and the reply is the next tree. The state persists in the
// extension's storage after every move, so Escape mid-game loses nothing
// and the best score survives restarts.
//
// Storage is split so a pal account can merge it (`sync` in pal.json): the
// board in play (`game`, the newest wins), the best score and the highest
// tile (`best`, `top`, the larger wins) and the games started (`games`,
// counted on every machine). Each pick reads them afresh, so a value sync
// brought in is what the next move builds on. A store from before the
// split (one `state` blob) is taken apart on the first read.
//
// A game's score and its highest tile go to the leaderboards when it ends:
// no move left, or New game over a game with a score.
import { account, leaderboard, settings, storage, type Extension } from "@zcag/pal";
import { DEFAULTS, apply, isState, maxTile, newGame, phase, type Action, type Settings, type State } from "./game.ts";
import { render } from "./render.ts";

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>() });

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** The board without what is stored on its own. */
const gameOf = ({ best: _b, games: _g, ...game }: State) => game;

/** The stored state, or a fresh game when there is none (or one this version cannot read). */
export async function load(): Promise<State> {
  let [game, best, games, top] = await Promise.all([storage.get<unknown>("game"), storage.get<unknown>("best"), storage.get<unknown>("games"), storage.get<unknown>("top")]);
  const legacy = await storage.get<unknown>("state");
  if (legacy !== null) {
    // Before the split: one blob with the best score and the game count in it.
    if (isState(legacy)) {
      game ??= gameOf(legacy);
      best = Math.max(num(best), legacy.best);
      games = num(games) || legacy.games;
      top = Math.max(num(top), maxTile(legacy.board));
      await Promise.all([storage.set("game", game), storage.set("best", best), storage.set("games", games), storage.set("top", top)]);
    }
    await storage.remove("state");
  }
  const st = { ...(game as State), best: num(best), games: num(games) };
  if (isState(st)) return st;
  const fresh = newGame({ best: num(best), games: num(games), seq: 1 });
  await Promise.all([storage.set("game", gameOf(fresh)), storage.set("games", fresh.games)]);
  return fresh;
}

/** Writes what changed from `before` to `after`. */
async function save(before: State, after: State) {
  await storage.set("game", gameOf(after));
  if (after.best > before.best) await storage.set("best", after.best);
  if (after.games !== before.games) await storage.set("games", after.games);
  const top = maxTile(after.board);
  if (top > maxTile(before.board) && top > num(await storage.get("top"))) await storage.set("top", top);
}

/** A game that ended (no move left) or was left for a new one with a score on it: its score and highest tile, else null. */
export function finished(before: State, after: State, action?: string): { score: number; tile: number } | null {
  const ended = phase(after) === "over" && phase(before) !== "over";
  const left = action === "new" && phase(before) !== "over" && before.score > 0;
  return ended ? { score: after.score, tile: maxTile(after.board) } : left ? { score: before.score, tile: maxTile(before.board) } : null;
}

/** Posted in the background: the reply never waits on the network, and a post that fails (offline is queued by the core) costs nothing. */
function post(f: { score: number; tile: number }) {
  void leaderboard.post("score", f.score).catch(() => {});
  void leaderboard.post("tile", f.tile).catch(() => {});
}

/** Signed out, as the core says; unknown (no account support) counts as signed in, so the hint stays away. */
const signedOut = () => account.get().then((a) => a?.signedIn === false, () => false);

export default {
  palettes: {
    "2048": {
      title: "2048",
      view: async () => {
        const st = await load();
        return render(st, current(), phase(st) === "over" && (await signedOut()));
      },
      pick: async (_id, action) => {
        const s = current();
        if (action === "signin") {
          await account.signIn();
          return { view: render(await load(), s, false) };
        }
        const before = await load();
        const after = action ? apply(before, action as Action, s) : before;
        if (after !== before) await save(before, after);
        const f = finished(before, after, action);
        if (f) post(f);
        return { view: render(after, s, phase(after) === "over" && (await signedOut())) };
      },
    },
  },
} satisfies Extension;
