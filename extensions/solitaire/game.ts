// Klondike, the rules, pure: a `State` in, a `State` out, nothing else
// touched. Seven tableau piles dealt one to seven with the last card face
// up, the rest a stock turned one or three at a time onto the waste and
// turned back over when it runs out (as often as you like), four
// foundations built up by suit from the ace. Moves: the waste's top card to
// a tableau pile or a foundation, a face-up run from one tableau pile to
// another (down by one, alternating colours, a king on an empty pile), a
// tableau card to its foundation and back. A pile's newly exposed card
// turns over by itself.
//
// The keys drive a cursor over the thirteen piles, so the table plays
// one-handed: `select` (Enter) picks up the card or run under the cursor
// and, pressed again, drops it where the cursor is; pressed again on the
// pile it came from, it sends the card where it goes (a foundation, else
// the first tableau pile that takes it). Every move keeps the table before
// it, so `undo` steps back as far as `UNDO`.
import { RANKS, SUITS, SUIT_GLYPH, isRed, rankOf, suitOf, type Card } from "../blackjack/cards.ts";

export type Settings = { draw: "1" | "3" };
export const DEFAULTS: Settings = { draw: "1" };

/** Face-down cards under face-up ones; the last of `up` is the pile's exposed card. */
export type Pile = { down: Card[]; up: Card[] };

/** The cards and what undo puts back with them: the move count, and the cursor on the pile the move took from. */
export type Table = { stock: Card[]; waste: Card[]; foundations: Card[][]; tableau: Pile[]; moves: number; cursor: number };

export type Stats = { played: number; won: number };

export type State = Table & {
  /** Cards a draw turns, fixed per deal: a settings change applies from the next one. */
  draw: 1 | 3;
  /** How many face-up cards the cursor takes from a tableau pile, counted up from the exposed one. */
  depth: number;
  /** Picked up, not yet dropped: the top `count` cards of pile `from`. */
  held?: { from: number; count: number };
  history: Table[];
  /** A move was made this deal: the game counts as played, and its clock runs. */
  started: boolean;
  /** Milliseconds played; the extension adds the time the table is open. */
  elapsed: number;
  won: boolean;
  /** What the last key could not do ("7♥ can't go on 9♠"), until the next key. */
  note?: string;
  /** The cards the last move turned from the stock, which the view flips in. */
  drawn: Card[];
  /** Counts deals up; keys one deal's cards apart from the last one's. */
  game: number;
  stats: Stats;
};

export type Action = "select" | "left" | "right" | "up" | "down" | "draw" | "undo" | "new" | "finish";

export type Rng = () => number;

/** The piles by index: the stock, the waste, the foundations in `SUITS` order, the tableau left to right. */
export const STOCK = 0, WASTE = 1, PILES = 13;
export const F = (i: number) => 2 + i;
export const T = (i: number) => 6 + i;
export const isFoundation = (p: number) => p >= 2 && p < 6;
export const isTableau = (p: number) => p >= 6 && p < PILES;

/** Moves undo can take back. */
export const UNDO = 100;

export const rank = (c: Card) => RANKS.indexOf(rankOf(c)) + 1;
/** `10♥`: how a card is named in a note or a title. */
export const name = (c: Card) => `${rankOf(c)}${SUIT_GLYPH[suitOf(c)]}`;
const home = (c: Card) => F(SUITS.indexOf(suitOf(c)));

export function deck(rng: Rng = Math.random): Card[] {
  const cards: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) cards.push(`${r}${s}`);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** A deal, row by row as by hand: pile i gets i + 1 cards, the last face up; the 24 left are the stock. The record carries over from `prev`. */
export function newGame(s: Settings = DEFAULTS, rng: Rng = Math.random, prev?: Pick<State, "stats" | "game">): State {
  const cards = deck(rng);
  const tableau: Pile[] = Array.from({ length: 7 }, () => ({ down: [], up: [] }));
  for (let row = 0; row < 7; row++) for (let i = row; i < 7; i++) (i === row ? tableau[i].up : tableau[i].down).push(cards.pop()!);
  return {
    stock: cards, waste: [], foundations: [[], [], [], []], tableau, moves: 0, cursor: STOCK,
    draw: s.draw === "3" ? 3 : 1, depth: 1, history: [], started: false, elapsed: 0, won: false, drawn: [],
    game: (prev?.game ?? 0) + 1, stats: prev ? { ...prev.stats } : { played: 0, won: 0 },
  };
}

/** Every card is face up and nothing is left to draw: the rest plays itself out (`finishStep`). */
export const canFinish = (st: State) => !st.won && !st.held && !st.stock.length && !st.waste.length && st.tableau.every((p) => !p.down.length);

/** The clock runs from the first move to the win. */
export const running = (st: State) => st.started && !st.won;

/** Legal keys now, in the order the view lists them (first is Enter). */
export function actions(st: State): Action[] {
  if (st.won) return ["new"];
  if (canFinish(st)) return ["finish", "new"];
  const a: Action[] = ["select", "left", "right", "up", "down", "draw"];
  if (st.held || st.history.length) a.push("undo");
  return [...a, "new"];
}

/** The cards a pick-up at `p` takes: the top of the waste or a foundation, the `depth` last face-up cards of a tableau pile. */
export function run(st: State, p: number, depth = 1): Card[] {
  if (p === WASTE) return st.waste.slice(-1);
  if (isFoundation(p)) return st.foundations[p - 2].slice(-1);
  if (isTableau(p)) return st.tableau[p - 6].up.slice(-depth);
  return [];
}

/** Why `cards` cannot go on pile `to`, or nothing when they can. A foundation takes a card on its suit's, whichever one the cursor is on. */
export function refusal(st: State, cards: Card[], to: number): string | undefined {
  const c = cards[0];
  if (isFoundation(to)) {
    if (cards.length > 1) return "One card at a time goes to a foundation";
    const f = st.foundations[home(c) - 2];
    return rank(c) === f.length + 1 ? undefined : `The ${SUIT_GLYPH[suitOf(c)]} foundation needs ${name(`${RANKS[f.length]}${suitOf(c)}`)}`;
  }
  if (isTableau(to)) {
    const top = st.tableau[to - 6].up.at(-1);
    if (!top) return rankOf(c) === "K" ? undefined : "Only a king goes on an empty pile";
    return isRed(top) !== isRed(c) && rank(top) === rank(c) + 1 ? undefined : `${name(c)} can't go on ${name(top)}`;
  }
  return "Cards go on a foundation or a tableau pile";
}

/**
 * Where Enter on the pile the cards came from sends them: the card's
 * foundation, else the first tableau pile that takes the run. A king that
 * is a whole pile already does not move to another empty one.
 */
export function quickTarget(st: State, from: number, count: number): number | undefined {
  const cards = run(st, from, count);
  if (!cards.length) return undefined;
  if (count === 1 && !refusal(st, cards, home(cards[0]))) return home(cards[0]);
  const whole = isTableau(from) && !st.tableau[from - 6].down.length && count === st.tableau[from - 6].up.length;
  for (let i = 0; i < 7; i++) {
    if (T(i) === from || (whole && !st.tableau[i].up.length)) continue;
    if (!refusal(st, cards, T(i))) return T(i);
  }
  return undefined;
}

const clone = (st: State): State => ({
  ...st, stock: [...st.stock], waste: [...st.waste], foundations: st.foundations.map((f) => [...f]),
  tableau: st.tableau.map((p) => ({ down: [...p.down], up: [...p.up] })), drawn: [], note: undefined, stats: { ...st.stats },
});

/** A copy to change, with the table as it was pushed on the history (the cursor on `at`, where undo puts the cards back). */
function begin(state: State, at: number): State {
  const st = clone(state);
  const { stock, waste, foundations, tableau, moves } = state;
  st.history = [...state.history, { stock, waste, foundations, tableau, moves, cursor: at }].slice(-UNDO);
  st.held = undefined;
  return st;
}

/** After a move: counted, the first of the deal starts the game, the last card home wins it. */
function done(st: State): State {
  st.moves++;
  if (!st.started) { st.started = true; st.stats.played++; }
  if (st.foundations.every((f) => f.length === 13)) { st.won = true; st.stats.won++; }
  return settle(st);
}

/** Moves `count` cards from `from` to `to` (legal: see `refusal`); the pile left turns its next card over. */
export function move(state: State, from: number, count: number, to: number): State {
  const st = begin(state, from);
  const src = from === WASTE ? st.waste : isFoundation(from) ? st.foundations[from - 2] : st.tableau[from - 6].up;
  const cards = src.splice(src.length - count, count);
  (isFoundation(to) ? st.foundations[home(cards[0]) - 2] : st.tableau[to - 6].up).push(...cards);
  if (isTableau(from)) {
    const p = st.tableau[from - 6];
    if (!p.up.length && p.down.length) p.up.push(p.down.pop()!);
  }
  return done(st);
}

/** Turns `draw` cards from the stock onto the waste, or the waste back over when the stock is out. */
export function turn(state: State): State {
  if (!state.stock.length && !state.waste.length) return { ...state, held: undefined, note: "Nothing left to draw" };
  const st = begin(state, STOCK);
  if (!st.stock.length) {
    st.stock = st.waste.reverse();
    st.waste = [];
  } else {
    for (let i = 0; i < st.draw && st.stock.length; i++) st.drawn.push(st.stock.pop()!);
    st.waste.push(...st.drawn);
  }
  return done(st);
}

/** One card of an auto-finish home: the lowest exposed one, so the foundations fill in order. */
export function finishStep(st: State): State {
  let best: number | undefined;
  st.tableau.forEach((p, i) => {
    const c = p.up.at(-1);
    if (c && !refusal(st, [c], home(c)) && (best === undefined || rank(c) < rank(st.tableau[best].up.at(-1)!))) best = i;
  });
  return best === undefined ? st : move(st, T(best), 1, home(st.tableau[best].up.at(-1)!));
}

/** Clamps the depth to the face-up cards under the cursor (one off a tableau pile, or while holding). */
function settle(st: State): State {
  const p = isTableau(st.cursor) ? st.tableau[st.cursor - 6] : undefined;
  st.depth = p && !st.held ? Math.max(1, Math.min(st.depth, p.up.length)) : 1;
  return st;
}

/** The piles the cursor stops at: all of them, or while cards are held those they can go on (a foundation only for one card) and the one they came from. */
function stops(st: State): number[] {
  const all = Array.from({ length: PILES }, (_, i) => i);
  const held = st.held;
  return held ? all.filter((p) => p === held.from || isTableau(p) || (isFoundation(p) && held.count === 1)) : all;
}

/** The top row above tableau column i (the waste spans two), and the column under each top-row pile. */
const ABOVE = [STOCK, WASTE, WASTE, F(0), F(1), F(2), F(3)];
const BELOW = [0, 1, 3, 4, 5, 6];

function step(st: State, dir: "left" | "right" | "up" | "down"): State {
  const at = st.cursor;
  if (dir === "left" || dir === "right") {
    const s = stops(st);
    const i = s.indexOf(at);
    return settle({ ...st, cursor: s[(i + (dir === "right" ? 1 : -1) + s.length) % s.length], depth: 1 });
  }
  if (!isTableau(at)) return dir === "down" ? settle({ ...st, cursor: T(BELOW[at]), depth: 1 }) : st;
  const up = st.tableau[at - 6].up.length;
  if (dir === "down") return st.depth > 1 && !st.held ? { ...st, depth: st.depth - 1 } : st;
  if (!st.held && st.depth < up) return { ...st, depth: st.depth + 1 };
  // Past the run, up is the row above; holding one card, the foundation it would go on.
  if (!st.held) return { ...st, cursor: ABOVE[at - 6], depth: 1 };
  const held = run(st, st.held.from, st.held.count);
  return held.length === 1 ? { ...st, cursor: home(held[0]) } : st;
}

/** Enter: draw on the stock, pick up, drop where the cursor is, or on the pile the cards came from, send them where they go. */
function select(st: State): State {
  if (!st.held) {
    if (st.cursor === STOCK) return turn(st);
    const cards = run(st, st.cursor, st.depth);
    return cards.length ? { ...st, held: { from: st.cursor, count: cards.length } } : { ...st, note: "Nothing to pick up here" };
  }
  const { from, count } = st.held;
  const cards = run(st, from, count);
  const to = st.cursor === from ? quickTarget(st, from, count) : st.cursor;
  if (to === undefined) return { ...st, held: undefined, note: `No move for ${name(cards[0])}` };
  const why = refusal(st, cards, to);
  return why ? { ...st, held: undefined, note: why } : move(st, from, count, to);
}

export function apply(state: State, action: Action, s: Settings = DEFAULTS, rng: Rng = Math.random): State {
  if (!actions(state).includes(action)) return state;
  // A key clears the last note, and the last draw's cards are already on the table.
  const st: State = { ...state, note: undefined, drawn: [] };
  switch (action) {
    case "new": return newGame(s, rng, st);
    case "select": return select(st);
    case "draw": return turn({ ...st, held: undefined });
    case "left": case "right": case "up": case "down": return step(st, action);
    case "undo": {
      if (st.held) return { ...st, held: undefined };
      const last = st.history.at(-1)!;
      return settle({ ...st, ...last, history: st.history.slice(0, -1), depth: 1 });
    }
    case "finish": {
      let next = st;
      while (canFinish(next)) {
        const after = finishStep(next);
        if (after === next) break;
        next = after;
      }
      return next;
    }
  }
}

/** Whether `x` is a state this version can play on; a store from another version starts over. */
export function isState(x: unknown): x is State {
  const s = x as State;
  return !!s && typeof s === "object" && Array.isArray(s.stock) && Array.isArray(s.waste) && Array.isArray(s.foundations) && s.foundations.length === 4
    && Array.isArray(s.tableau) && s.tableau.length === 7 && s.tableau.every((p) => Array.isArray(p?.down) && Array.isArray(p?.up))
    && Array.isArray(s.history) && typeof s.cursor === "number" && typeof s.moves === "number" && (s.draw === 1 || s.draw === 3) && !!s.stats && typeof s.game === "number";
}
