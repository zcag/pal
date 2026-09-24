// Solitaire: a view palette. The table is a render tree (render.ts) built
// from a pure game state (game.ts); every key is a pick whose action id is
// the move, and the reply is the next tree. The state persists whole in
// the extension's storage after every move, so Escape mid-game loses
// nothing and the record survives restarts.
//
// Two things run on their own while the table is open, both pushing the
// tree (`view.update`): the clock, once a second, and the auto-finish,
// which sends the last cards home one at a time once every card is face
// up. The clock counts only while the level is shown: the time from the
// level coming up (or the last move) is added at each move and when it
// goes away. Every read-change-write of the state goes through `serial`,
// so a key and a finishing step never write over each other.
import { settings, storage, view, type Extension } from "@zcag/pal";
import { DEFAULTS, apply, canFinish, finishStep, isState, newGame, running, type Action, type Settings, type State } from "./game.ts";
import { render } from "./render.ts";

const EXTENSION = "solitaire";
const PALETTE = "solitaire";
const KEY = "state";
/** Between two cards of the auto-finish; the tests set it short. */
const FINISH_MS = Number(process.env.PAL_SOLITAIRE_FINISH_MS) || 120;
const TICK_MS = Number(process.env.PAL_SOLITAIRE_TICK_MS) || 1000;

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>(EXTENSION) });

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const p = chain.then(f);
  chain = p.catch(() => {});
  return p;
};

/** The stored state, or a fresh game when there is none (or one this version cannot read). */
async function load(): Promise<State> {
  const stored = await storage.get<unknown>(KEY, EXTENSION);
  return isState(stored) ? stored : newGame(current());
}

/** When the clock last started: the level shown, or the last move since; unset while it is hidden. */
let since: number | undefined;
/** The state with the time since `since` in it, for the view. */
const timed = (st: State): State => (since !== undefined && running(st) ? { ...st, elapsed: st.elapsed + Date.now() - since } : st);
/** The same, to be stored: the clock restarts from now. */
const fold = (st: State): State => {
  const t = timed(st);
  if (since !== undefined) since = Date.now();
  return t;
};

const push = (st: State) => view.update(render(timed(st)), { palette: PALETTE, extension: EXTENSION }).catch(() => {});

/** The auto-finish's next step, while one is under way. */
let finishing: ReturnType<typeof setTimeout> | undefined;
/** The auto-finish: one card home per step, each pushed, until the game is won (or Enter finished it at once). */
function finish() {
  if (finishing) return;
  const next = () => (finishing = setTimeout(async () => {
    const st = await serial(async () => {
      const before = await load();
      if (!canFinish(before)) return undefined;
      const after = finishStep(fold(before));
      await storage.set(KEY, after, EXTENSION);
      return after;
    }).catch(() => undefined);
    if (!st) { finishing = undefined; return; }
    await push(st);
    next();
  }, FINISH_MS));
  next();
}

let tick: ReturnType<typeof setInterval> | undefined;
view.onShown((ev) => {
  if (ev.palette !== PALETTE) return;
  since = Date.now();
  tick ??= setInterval(async () => {
    const st = await load();
    if (running(st) && !canFinish(st)) await push(st);
  }, TICK_MS);
}, EXTENSION);
view.onHidden((ev) => {
  if (ev.palette !== PALETTE) return;
  clearInterval(tick);
  tick = undefined;
  serial(async () => {
    const st = fold(await load());
    since = undefined;
    await storage.set(KEY, st, EXTENSION);
  }).catch(() => {});
}, EXTENSION);

export default {
  palettes: {
    solitaire: {
      title: "Solitaire",
      view: async () => {
        const st = await load();
        if (canFinish(st)) finish();
        return render(timed(st));
      },
      pick: async (_id, action) =>
        serial(async () => {
          const before = fold(await load());
          const after = action ? apply(before, action as Action, current()) : before;
          await storage.set(KEY, after, EXTENSION);
          if (canFinish(after)) finish();
          return { view: render(after) };
        }),
    },
  },
  dispose: () => {
    clearInterval(tick);
    clearTimeout(finishing);
  },
} satisfies Extension;
