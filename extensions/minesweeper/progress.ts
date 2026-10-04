// What of the game is kept where (pal.json `sync`, docs/extensions.md
// "Syncing storage"). The board in play is this machine's (`state`,
// local). The games played and won per level sync as counts (`records`:
// two machines' games add up), and the fastest win per level only
// improves (`best-beginner`, ...: `min`, in ms), each a key of its own so
// a level with no win yet is simply absent rather than a hole in an
// object. `state` still carries the records with their bests, which is
// what a store from before the split reads (`restore` migrates it); the
// keys overrule it once they exist. Pure, so the page and the host tests
// read a game the same way.
import { DEFAULTS, LEVELS, isState, newGame, type Level, type State, type Tally } from "./game.ts";

const LEVEL_IDS = Object.keys(LEVELS) as Level[];
/** Every storage key the game writes, as pal.json's `sync` lists them. */
export const KEYS = ["state", "records", ...LEVEL_IDS.map((l) => `best-${l}` as const)] as const;
export type Key = (typeof KEYS)[number];
export type Saved = Partial<Record<Key, unknown>>;
type Counts = Record<Level, { played: number; won: number }>;

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isCounts = (x: unknown): x is Counts => !!x && typeof x === "object" && LEVEL_IDS.every((l) => num((x as Counts)[l]?.played) && num((x as Counts)[l]?.won));
const countsOf = (st: State): Counts => Object.fromEntries(LEVEL_IDS.map((l) => [l, { played: st.records[l].played, won: st.records[l].won }])) as Counts;

/** The game from what storage holds: the local board (or a fresh one at `level`) with the synced counts and bests over its records. */
export function restore(v: Saved, level: Level = DEFAULTS.difficulty): State {
  const st = isState(v.state) ? v.state : newGame(level);
  const counts = isCounts(v.records) ? v.records : undefined;
  const records = Object.fromEntries(LEVEL_IDS.map((l): [Level, Tally] => {
    const bests = [v[`best-${l}`], st.records[l].best].filter(num);
    const { played, won } = counts?.[l] ?? st.records[l];
    return [l, bests.length ? { played, won, best: Math.min(...bests) } : { played, won }];
  })) as Record<Level, Tally>;
  return { ...st, records };
}

/** The keys to write after a move: the board, the counts when they moved, a level's best when beaten. */
export function changes(st: State, saved: Saved): Saved {
  const out: Saved = { state: st };
  const counts = countsOf(st);
  if (JSON.stringify(counts) !== JSON.stringify(saved.records)) out.records = counts;
  for (const l of LEVEL_IDS) {
    const best = st.records[l].best, had = saved[`best-${l}`];
    if (best !== undefined && (!num(had) || best < had)) out[`best-${l}`] = best;
  }
  return out;
}

/** The boards a win goes to: its level's, and the Daily when it is today's board. Times in seconds. */
export function scores(st: State, today: string): [board: string, value: number][] {
  if (st.phase !== "won") return [];
  const secs = Math.round(st.clock.ms / 10) / 100;
  return [[st.level, secs], ...(st.daily === today ? [["daily", secs] as [string, number]] : [])];
}
