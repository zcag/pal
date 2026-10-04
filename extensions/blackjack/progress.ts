// What of a table is kept where (pal.json `sync`, docs/extensions.md
// "Syncing storage"). The shoe and the hand on the felt are this machine's
// (`state`, local: 312 cards dealt mid-hand mean nothing on another one).
// The chips are the player's, wherever they sit down: `winnings`, the
// bankroll less what the game started with, is a `sum`, so a night up
// $500 on the laptop and one down $200 on the desk, both played before
// they synced, leave the game $300 up, the way two tables drawing on one
// pocket would (`latest` would drop one night, per-device would split the
// wallet in two). It is the winnings and not the bankroll that adds up:
// two machines that each opened a fresh $1,000 table would otherwise sum
// to $2,000 the first time they synced. The record is a sum of its counts
// too, and the bests (`peak`, `longest`) only grow, by `max`. `state`
// still carries a bankroll and a record: they are what a store from
// before the split reads (`restore` migrates it), and the keys overrule
// them once those exist. Pure, so the page and the extension read
// a table the same way and the host tests it.
import { DEFAULTS, isState, newGame, type Rng, type Settings, type State, type Stats } from "./game.ts";

/** Every storage key the game writes, as pal.json's `sync` lists them. */
export const KEYS = ["state", "winnings", "stats", "peak", "longest"] as const;
export type Key = (typeof KEYS)[number];
export type Saved = Partial<Record<Key, unknown>>;

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStats = (x: unknown): x is Stats => !!x && typeof x === "object" && (["hands", "wins", "losses", "pushes", "blackjacks", "net"] as const).every((k) => num((x as Stats)[k]));

/** The table from what storage holds: the local hand, the synced chips and record over it; a fresh game when there is no hand. */
export function restore(v: Saved, s: Settings = DEFAULTS, rng?: Rng): State {
  const st = isState(v.state) ? v.state : newGame(s, rng);
  // A game from before `start` was kept: the setting now is the best guess.
  const start = st.start ?? s.starting_bankroll;
  return {
    ...st,
    streak: st.streak ?? 0,
    start,
    bankroll: num(v.winnings) ? start + v.winnings : st.bankroll,
    stats: isStats(v.stats) ? v.stats : st.stats,
  };
}

/** Only a game started at the default bankroll counts for the board: $1M of starting chips is not a run of luck. */
export const counts = (st: State) => st.start === DEFAULTS.starting_bankroll;

/** The keys to write after a move: those whose value moved since `saved` (the bests only when beaten). */
export function changes(st: State, saved: Saved): Saved {
  const out: Saved = { state: st };
  const winnings = st.bankroll - (st.start ?? DEFAULTS.starting_bankroll);
  if (winnings !== saved.winnings) out.winnings = winnings;
  if (JSON.stringify(st.stats) !== JSON.stringify(saved.stats)) out.stats = st.stats;
  const peak = num(saved.peak) ? saved.peak : 0, longest = num(saved.longest) ? saved.longest : 0;
  if (counts(st) && st.bankroll > peak && st.bankroll > DEFAULTS.starting_bankroll) out.peak = st.bankroll;
  if ((st.streak ?? 0) > longest) out.longest = st.streak;
  return out;
}

/** The boards a set of changes posts to: a new best bankroll, a longer streak. */
export const scores = (ch: Saved): [board: string, value: number][] => [
  ...(num(ch.peak) ? [["bankroll", ch.peak] as [string, number]] : []),
  ...(num(ch.longest) ? [["streak", ch.longest] as [string, number]] : []),
];
