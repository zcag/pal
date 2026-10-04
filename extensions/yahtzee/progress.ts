// What of the game is kept where (pal.json `sync`, docs/extensions.md
// "Syncing storage"). The card in play is this machine's (`state`, local:
// a round's dice and holds are one sitting's). The record syncs field by
// field (`record`): games and the points they added up to are counts, so
// two machines' games add up and the average stays true; the best only
// grows. `state` still carries the record, which is what a store from
// before the split reads (`restore` migrates it); the key overrules it
// once it exists. Pure, so the page, the extension and the host tests
// read a game the same way.
import { isState, newGame, type State, type Tally } from "./game.ts";

/** Every storage key the game writes, as pal.json's `sync` lists them. */
export const KEYS = ["state", "record"] as const;
export type Key = (typeof KEYS)[number];
export type Saved = Partial<Record<Key, unknown>>;

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isTally = (x: unknown): x is Tally => !!x && typeof x === "object" && num((x as Tally).games) && num((x as Tally).sum) && num((x as Tally).best);

/** The game from what storage holds: the local card (or a fresh one) with the synced record over it. */
export function restore(v: Saved): State {
  const st = isState(v.state) ? v.state : newGame();
  return isTally(v.record) ? { ...st, record: v.record } : st;
}

/** The keys to write after a move: the card, and the record when it moved. */
export function changes(st: State, saved: Saved): Saved {
  return JSON.stringify(st.record) === JSON.stringify(saved.record) ? { state: st } : { state: st, record: st.record };
}

/** The boards a finished card goes to: High score, and the Daily when it is today's dice. */
export const scores = (st: State, today: string): [board: string, value: number][] =>
  st.ended ? [["high", st.ended.total], ...(st.daily === today ? [["daily", st.ended.total] as [string, number]] : [])] : [];
