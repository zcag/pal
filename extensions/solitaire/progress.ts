// What of the game is kept where (pal.json `sync`, docs/extensions.md
// "Syncing storage"). The deal in play and its undo history are this
// machine's (`state`, local: a table mid-game, and up to a hundred tables
// of undo, is one sitting's). The record syncs as counts (`stats`: games
// played and won on two machines add up), and the bests per draw only
// improve (`fastest-1`, `fewest-3`: `min`). `state` still carries the
// record, which is what a store from before the split reads (`restore`
// migrates it); the key overrules it once it exists. Pure, so the page
// and the host tests read a game the same way.
import { DEFAULTS, isState, newGame, type Settings, type State, type Stats } from "./game.ts";

/** Every storage key the game writes, as pal.json's `sync` lists them. */
export const KEYS = ["state", "stats", "fastest-1", "fastest-3", "fewest-1", "fewest-3"] as const;
export type Key = (typeof KEYS)[number];
export type Saved = Partial<Record<Key, unknown>>;

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStats = (x: unknown): x is Stats => !!x && typeof x === "object" && num((x as Stats).played) && num((x as Stats).won);

/** The game from what storage holds: the local deal (or a fresh one) with the synced record over it. */
export function restore(v: Saved, s: Settings = DEFAULTS): State {
  const st: State = isState(v.state) ? { ...v.state, held: undefined, note: undefined, drawn: [] } : newGame(s);
  return isStats(v.stats) ? { ...st, stats: v.stats } : st;
}

/** The best time (ms) and fewest moves of a draw, as stored. */
export const bests = (v: Saved, draw: 1 | 3) => ({ time: num(v[`fastest-${draw}`]) ? (v[`fastest-${draw}`] as number) : undefined, moves: num(v[`fewest-${draw}`]) ? (v[`fewest-${draw}`] as number) : undefined });

/** The keys to write after a change: the deal, the record when it moved, a best a win beat. */
export function changes(st: State, saved: Saved): Saved {
  const out: Saved = { state: st };
  if (JSON.stringify(st.stats) !== JSON.stringify(saved.stats)) out.stats = st.stats;
  if (st.won) {
    const b = bests(saved, st.draw);
    if (b.time === undefined || st.elapsed < b.time) out[`fastest-${st.draw}`] = st.elapsed;
    if (b.moves === undefined || st.moves < b.moves) out[`fewest-${st.draw}`] = st.moves;
  }
  return out;
}

/** The boards a win goes to: time and moves at its draw, and the Daily when it is today's deal. Times in seconds. */
export function scores(st: State, today: string): [board: string, value: number][] {
  if (!st.won) return [];
  const secs = Math.round(st.elapsed / 10) / 100;
  return [[`fastest/${st.draw}`, secs], [`fewest/${st.draw}`, st.moves], ...(st.daily === today ? [["daily", secs] as [string, number]] : [])];
}
