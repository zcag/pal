// The rules, pure: a `State` and a move in, a `State` out. Solo Yahtzee:
// 13 rounds, up to 3 rolls a round with any dice held between them, then
// one of the 13 boxes filled (a zero if the dice do not fit). The upper
// section pays 35 more at 63; every further Yahtzee pays 100 while the
// Yahtzee box holds 50, and plays as a Joker (Hasbro's rules): its number's
// upper box if open, else any open lower box at full value (a full house,
// straights), else an upper box for 0. A move that does not apply returns
// the same state, which is what a key pressed a beat late should do. The
// dice come from an injected `rng`, so the tests roll what they need.

export const UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
export const LOWER = ["three-kind", "four-kind", "full-house", "small-straight", "large-straight", "yahtzee", "chance"] as const;
export type Category = (typeof UPPER)[number] | (typeof LOWER)[number];
export const CATEGORIES: Category[] = [...UPPER, ...LOWER];

export const LABELS: Record<Category, string> = {
  ones: "Ones", twos: "Twos", threes: "Threes", fours: "Fours", fives: "Fives", sixes: "Sixes",
  "three-kind": "3 of a kind", "four-kind": "4 of a kind", "full-house": "Full house",
  "small-straight": "Small straight", "large-straight": "Large straight", yahtzee: "Yahtzee", chance: "Chance",
};

/** The boxes that pay a fixed amount, which a Joker scores in full. */
export const FIXED: Partial<Record<Category, number>> = { "full-house": 25, "small-straight": 30, "large-straight": 40, yahtzee: 50 };
export const BONUS_AT = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;
export const ROLLS = 3;
export const ROUNDS = CATEGORIES.length;

/** Games finished: how many, their scores' sum (for the average) and the best. */
export type Tally = { games: number; sum: number; best: number };

export type State = {
  v: 1;
  /** Five faces, 1 to 6; all 0 before the round's first roll. */
  dice: number[];
  held: boolean[];
  /** Rolls made this round, 0 to 3. */
  rolls: number;
  scores: Partial<{ [C in Category]: number }>;
  /** Yahtzee bonuses earned, 100 each. */
  bonuses: number;
  record: Tally;
  /** Set when the last box is filled: the final score, and whether it beat an earlier game's best. */
  ended?: { total: number; best: boolean };
};

export type Move = { type: "roll" } | { type: "hold"; die: number } | { type: "score"; category: Category } | { type: "new" };

export type Rng = () => number;

const blank = () => [0, 0, 0, 0, 0];

export const newGame = (record: Tally = { games: 0, sum: 0, best: 0 }): State =>
  ({ v: 1, dice: blank(), held: [false, false, false, false, false], rolls: 0, scores: {}, bonuses: 0, record });

/** How many of each face: `counts(d)[5]` is the number of fives. */
export function counts(dice: number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}
const sum = (dice: number[]) => dice.reduce((a, b) => a + b, 0);
const run = (dice: number[], len: number) => {
  const c = counts(dice);
  for (let lo = 1; lo + len - 1 <= 6; lo++) if ([...Array(len).keys()].every((k) => c[lo + k] > 0)) return true;
  return false;
};
export const isYahtzee = (dice: number[]) => dice[0] > 0 && dice.every((d) => d === dice[0]);

/** What the dice score in a box by its own rule, Joker aside. */
export function score(cat: Category, dice: number[]): number {
  const c = counts(dice);
  const most = Math.max(...c);
  const up = UPPER.indexOf(cat as (typeof UPPER)[number]);
  if (up >= 0) return (up + 1) * c[up + 1];
  switch (cat) {
    case "three-kind": return most >= 3 ? sum(dice) : 0;
    case "four-kind": return most >= 4 ? sum(dice) : 0;
    case "full-house": return c.includes(3) && c.includes(2) ? 25 : 0;
    case "small-straight": return run(dice, 4) ? 30 : 0;
    case "large-straight": return run(dice, 5) ? 40 : 0;
    case "yahtzee": return most === 5 ? 50 : 0;
    default: return sum(dice);
  }
}

/** The dice a category's score is made of (the page rings them while its row is picked): the face's dice, the kind, one die per step of the run, else all five. */
export function counted(cat: Category, dice: number[]): boolean[] {
  const c = counts(dice);
  const up = UPPER.indexOf(cat as (typeof UPPER)[number]);
  if (up >= 0) return dice.map((d) => d === up + 1);
  if (cat === "three-kind" || cat === "four-kind") {
    const face = c.indexOf(Math.max(...c));
    return dice.map((d) => d === face);
  }
  if (cat === "small-straight" || cat === "large-straight") {
    const len = cat === "small-straight" ? 4 : 5;
    for (let lo = 7 - len; lo >= 1; lo--) {
      if (![...Array(len).keys()].every((k) => c[lo + k] > 0)) continue;
      const seen = new Set<number>();
      return dice.map((d) => d >= lo && d < lo + len && !seen.has(d) && !!seen.add(d));
    }
  }
  return dice.map(() => true);
}

export const isOpen = (st: State, cat: Category) => st.scores[cat] === undefined;

/** A Yahtzee rolled with the Yahtzee box already filled (50 or a zero). */
export const isJoker = (st: State) => isYahtzee(st.dice) && !isOpen(st, "yahtzee");

/**
 * The boxes the dice may go in now and what each would score: every open
 * one normally; under a Joker only its upper box if open, else the open
 * lower boxes (the fixed ones at full value), else the open upper boxes
 * for 0. Empty before the round's first roll and once the game is over.
 */
export function options(st: State): Partial<{ [C in Category]: number }> {
  if (st.rolls === 0 || st.ended) return {};
  const open = CATEGORIES.filter((c) => isOpen(st, c));
  const out: Partial<{ [C in Category]: number }> = {};
  if (!isJoker(st)) {
    for (const c of open) out[c] = score(c, st.dice);
    return out;
  }
  const mine = UPPER[st.dice[0] - 1];
  if (isOpen(st, mine)) return { [mine]: score(mine, st.dice) };
  const lower = open.filter((c) => (LOWER as readonly string[]).includes(c));
  if (lower.length) for (const c of lower) out[c] = FIXED[c] ?? score(c, st.dice);
  else for (const c of open) out[c] = 0;
  return out;
}

export type Totals = { upper: number; upperBonus: number; lower: number; yahtzeeBonus: number; total: number };

export function totals(st: State): Totals {
  const of = (cats: readonly Category[]) => cats.reduce((a, c) => a + (st.scores[c] ?? 0), 0);
  const upper = of(UPPER);
  const upperBonus = upper >= BONUS_AT ? UPPER_BONUS : 0;
  const lower = of(LOWER);
  const yahtzeeBonus = st.bonuses * YAHTZEE_BONUS;
  return { upper, upperBonus, lower, yahtzeeBonus, total: upper + upperBonus + lower + yahtzeeBonus };
}

export const filled = (st: State) => CATEGORIES.filter((c) => !isOpen(st, c)).length;
/** The round being played, 1 to 13 (13 once over). */
export const round = (st: State) => Math.min(ROUNDS, filled(st) + 1);
/** Anything done since the last New game: what the confirm protects. */
export const started = (st: State) => !st.ended && (st.rolls > 0 || filled(st) > 0);

export function apply(st: State, m: Move, rng: Rng = Math.random): State {
  switch (m.type) {
    case "new": return newGame(st.record);
    case "roll": {
      if (st.ended || st.rolls >= ROLLS) return st;
      const dice = st.dice.map((d, i) => (st.rolls > 0 && st.held[i] ? d : 1 + Math.floor(rng() * 6)));
      return { ...st, dice, rolls: st.rolls + 1 };
    }
    case "hold": {
      if (st.ended || st.rolls === 0 || st.rolls >= ROLLS || !(m.die >= 0 && m.die < 5)) return st;
      return { ...st, held: st.held.map((h, i) => (i === m.die ? !h : h)) };
    }
    case "score": {
      const pts = options(st)[m.category];
      if (pts === undefined) return st;
      const bonus = isYahtzee(st.dice) && st.scores.yahtzee === 50 ? 1 : 0;
      const next: State = { ...st, dice: blank(), held: st.held.map(() => false), rolls: 0, scores: { ...st.scores, [m.category]: pts }, bonuses: st.bonuses + bonus };
      if (filled(next) < ROUNDS) return next;
      const total = totals(next).total;
      const r = st.record;
      return { ...next, record: { games: r.games + 1, sum: r.sum + total, best: Math.max(r.best, total) }, ended: { total, best: r.games > 0 && total > r.best } };
    }
  }
}

/** What filling a box adds to the total now, the upper bonus and a Yahtzee bonus included; undefined if the box is not an option. */
export function gain(st: State, cat: Category): number | undefined {
  if (options(st)[cat] === undefined) return undefined;
  const after = apply(st, { type: "score", category: cat });
  return totals(after).total - totals(st).total;
}

/** The option that adds the most now, the first in card order on a tie. */
export function bestOption(st: State): Category | undefined {
  let best: Category | undefined;
  for (const c of CATEGORIES) {
    const g = gain(st, c);
    if (g !== undefined && (best === undefined || g > gain(st, best)!)) best = c;
  }
  return best;
}

export const average = (r: Tally) => (r.games ? Math.round(r.sum / r.games) : 0);

const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);

/** A stored state this version can play; anything else starts a fresh game. */
export function isState(x: unknown): x is State {
  const s = x as State | null;
  if (!s || s.v !== 1 || !Array.isArray(s.dice) || s.dice.length !== 5 || !Array.isArray(s.held) || s.held.length !== 5) return false;
  if (!s.dice.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) || !isNum(s.rolls) || !isNum(s.bonuses)) return false;
  if (typeof s.scores !== "object" || !s.scores || !Object.entries(s.scores).every(([k, v]) => CATEGORIES.includes(k as Category) && isNum(v))) return false;
  const r = s.record;
  return !!r && isNum(r.games) && isNum(r.sum) && isNum(r.best);
}
