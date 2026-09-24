// Minesweeper: a view palette. The board is a render tree (render.ts)
// built from a pure game state (game.ts); every key is a pick whose action
// id is the move, and the reply is the next tree. The state persists whole
// in the extension's storage after every move, so Escape mid-game loses
// nothing and the records survive restarts.
//
// The clock counts only while the board is on screen: `view.onShown`
// resumes it and pushes the tree once a second so the time moves,
// `view.onHidden` pauses it and stops the pushes. A run the panel never
// ended (a crash, a quit) is cut off at the last move on the next open.
import { now, settings, storage, view, type Extension } from "@zcag/pal";
import { DEFAULTS, apply, isState, levelOf, newGame, pause, resume, settle, type Action, type Settings, type State } from "./game.ts";
import { render } from "./render.ts";

const EXTENSION = "minesweeper";
const PALETTE = "minesweeper";
const KEY = "state";
/** The clock's push while a game runs on screen; a test sets it short. */
const TICK_MS = Number(process.env.PAL_MINESWEEPER_TICK_MS) || 1000;

const current = (): Settings => ({ ...DEFAULTS, ...settings.get<Partial<Settings>>(EXTENSION) });

/** The stored state, or a fresh board when there is none (or one this version cannot read). */
async function load(s: Settings): Promise<State> {
  const stored = await storage.get<unknown>(KEY, EXTENSION);
  return isState(stored) ? stored : newGame(levelOf(s.difficulty));
}
const save = (st: State) => storage.set(KEY, st, EXTENSION);

/** One read-change-write at a time: the clock's resume on show must not write over a move made meanwhile, nor a move over it. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = queue.then(f, f);
  queue = run.catch(() => {});
  return run;
}

/** Opening the board: a stale run is cut off, and a board with nothing open yet (or a finished one) takes the difficulty setting. */
async function open(): Promise<State> {
  const s = current();
  const before = await load(s);
  let st = settle(before);
  const level = levelOf(s.difficulty);
  if (st.phase !== "play" && st.level !== level) st = newGame(level, st);
  if (st !== before) await save(st);
  return st;
}

let tick: ReturnType<typeof setInterval> | undefined;
const stopTick = () => { clearInterval(tick); tick = undefined; };

view.onShown(async (ev) => {
  if (ev.palette !== PALETTE) return;
  await serial(async () => {
    const st = await load(current());
    const run = resume(st, now());
    if (run !== st) await save(run);
  });
  tick ??= setInterval(async () => {
    const st = await load(current());
    if (st.phase === "play") await view.update(render(st, now()), { extension: EXTENSION, palette: PALETTE }).catch((e) => console.error(`minesweeper: push: ${e}`));
  }, TICK_MS);
}, EXTENSION);

view.onHidden(async (ev) => {
  if (ev.palette !== PALETTE) return;
  stopTick();
  await serial(async () => {
    const st = await load(current());
    const held = pause(st, now());
    if (held !== st) await save(held);
  });
}, EXTENSION);

export default {
  palettes: {
    minesweeper: {
      title: "Minesweeper",
      view: async () => render(await serial(open), now()),
      pick: (_id, action) => serial(async () => {
        const s = current();
        const before = await load(s);
        const after = action ? apply(before, action as Action, s, Math.random, now()) : before;
        if (after !== before) await save(after);
        return { view: render(after, now()) };
      }),
    },
  },
  dispose: () => stopTick(),
} satisfies Extension;
