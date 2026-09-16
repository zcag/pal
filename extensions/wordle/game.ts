// The rules, pure: a `State` (the game and the stats) in, a `State` out.
// Six guesses of five letters; a submitted word must be in the allowed
// list, and in hard mode must keep every green letter in place and use
// every amber one. Marks are Wordle's: a letter in its place is correct, a
// letter elsewhere in the answer is present as many times as the answer
// has it beyond the correct ones (so a duplicate is not marked twice), the
// rest absent. A daily is seeded from the local date; a practice game is
// random. The stats count every finished game; the streak is consecutive
// wins, and a daily breaks it when a day was skipped.
import { ALLOWED, dailyAnswer, randomAnswer } from "./words.ts";

export type Settings = { daily: boolean; hard_mode: boolean };
export const DEFAULTS: Settings = { daily: true, hard_mode: false };

export const ROWS = 6;
export const COLS = 5;

export type Mark = "correct" | "present" | "absent";
export type Status = "play" | "won" | "lost";
export type Letter = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";
export const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("") as Letter[];
export type Action = Letter | "submit" | "delete" | "new" | "copy";

export type Game = {
  answer: string;
  guesses: string[];
  /** The day index of a daily (words.ts), null for a practice game. */
  day: number | null;
  /** Hard mode was on when the game started; it stays for the game. */
  hard: boolean;
  /** The letters typed on the current row. */
  input: string;
  status: Status;
};

export type Stats = {
  played: number;
  won: number;
  streak: number;
  /** The longest streak. */
  best: number;
  /** Wins by guess count, `dist[0]` for a first-guess win. */
  dist: number[];
  /** The last daily finished, for the streak's day check. */
  lastDay: number | null;
};

export type State = {
  game: Game;
  stats: Stats;
  /** A message for the message row, shown until the next key; `n` keys it apart from the last one so the same text fades in again. */
  notice?: { text: string; n: number };
};

export type Rng = () => number;

export const stats0 = (): Stats => ({ played: 0, won: 0, streak: 0, best: 0, dist: Array(ROWS).fill(0), lastDay: null });

export const newGame = (answer: string, day: number | null, s: Settings): Game => ({ answer, guesses: [], day, hard: s.hard_mode, input: "", status: "play" });
export const daily = (day: number, s: Settings): Game => newGame(dailyAnswer(day), day, s);
export const practice = (s: Settings, rng: Rng = Math.random): Game => newGame(randomAnswer(rng), null, s);

/** Wordle's marks: a second pass for the present letters, each drawn from what the correct ones left of the answer. */
export function mark(guess: string, answer: string): Mark[] {
  const out: Mark[] = Array(COLS).fill("absent");
  const left: Record<string, number> = {};
  for (let i = 0; i < COLS; i++) {
    if (guess[i] === answer[i]) out[i] = "correct";
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < COLS; i++) {
    if (out[i] === "correct" || !left[guess[i]]) continue;
    out[i] = "present";
    left[guess[i]]--;
  }
  return out;
}

const RANK: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };
/** The best mark each guessed letter has earned, for the keyboard. */
export function keyMarks(g: Game): Partial<Record<Letter, Mark>> {
  const out: Partial<Record<Letter, Mark>> = {};
  for (const w of g.guesses) {
    const m = mark(w, g.answer);
    for (let i = 0; i < COLS; i++) {
      const l = w[i] as Letter;
      if (!out[l] || RANK[m[i]] > RANK[out[l]!]) out[l] = m[i];
    }
  }
  return out;
}

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];
/** Hard mode: why `guess` ignores a hint from an earlier guess, or null when it honours them all. */
export function hardModeError(guess: string, g: Game): string | null {
  for (const w of g.guesses) {
    const m = mark(w, g.answer);
    for (let i = 0; i < COLS; i++) if (m[i] === "correct" && guess[i] !== w[i]) return `${ORDINAL[i]} letter must be ${w[i].toUpperCase()}`;
    const need: Record<string, number> = {};
    for (let i = 0; i < COLS; i++) if (m[i] !== "absent") need[w[i]] = (need[w[i]] ?? 0) + 1;
    for (const [l, n] of Object.entries(need)) if (guess.split("").filter((c) => c === l).length < n) return `Guess must contain ${l.toUpperCase()}`;
  }
  return null;
}

export const isValid = (word: string): boolean => ALLOWED.has(word);

/** Whether New game is on offer: a finished game, a practice game, or dailies off. */
export const canNew = (st: State, s: Settings): boolean => st.game.status !== "play" || st.game.day === null || !s.daily;

/** Whether New game would start today's daily: dailies on and today's not yet started or finished. */
export const nextIsDaily = (st: State, s: Settings, today: number): boolean => s.daily && st.stats.lastDay !== today && st.game.day !== today;
/** What New game starts: today's daily when it is on and not yet played, else a practice game. */
export const next = (st: State, s: Settings, today: number, rng: Rng = Math.random): Game => (nextIsDaily(st, s, today) ? daily(today, s) : practice(s, rng));

/** On opening: a new day's daily replaces a finished game or an old daily; a practice game in progress is kept. */
export function sync(st: State, s: Settings, today: number): State {
  const g = st.game;
  if (!s.daily || g.day === today || st.stats.lastDay === today) return st;
  if (g.status === "play" && g.day === null) return st;
  return { game: daily(today, s), stats: st.stats };
}

/** Legal actions now, in the order the view lists them (first is Enter). */
export function actions(st: State, s: Settings): Action[] {
  const g = st.game;
  if (g.status !== "play") return ["copy", ...(canNew(st, s) ? ["new" as const] : [])];
  return ["submit", "delete", ...(canNew(st, s) ? ["new" as const] : []), ...LETTERS];
}

function finish(st: State, status: Status): State {
  const g = { ...st.game, status };
  const stats = { ...st.stats, dist: [...st.stats.dist] };
  stats.played++;
  if (g.day !== null && stats.lastDay !== null && g.day - stats.lastDay > 1) stats.streak = 0;
  if (status === "won") {
    stats.won++;
    stats.dist[g.guesses.length - 1]++;
    stats.streak++;
    stats.best = Math.max(stats.best, stats.streak);
  } else stats.streak = 0;
  if (g.day !== null) stats.lastDay = g.day;
  return { game: g, stats };
}

export function apply(state: State, action: Action, s: Settings = DEFAULTS, today = 0, rng: Rng = Math.random): State {
  if (!actions(state, s).includes(action)) return state;
  const notice = (text: string): State => ({ ...state, notice: { text, n: (state.notice?.n ?? 0) + 1 } });
  const g = state.game;
  const st: State = { game: g, stats: state.stats };
  switch (action) {
    case "new": return { ...st, game: next(state, s, today, rng) };
    case "copy": return state;
    case "delete": return g.input ? { ...st, game: { ...g, input: g.input.slice(0, -1) } } : state;
    case "submit": {
      if (g.input.length < COLS) return notice("Not enough letters");
      if (!isValid(g.input)) return notice("Not in word list");
      const hard = g.hard ? hardModeError(g.input, g) : null;
      if (hard) return notice(hard);
      const after: State = { ...st, game: { ...g, guesses: [...g.guesses, g.input], input: "" } };
      if (g.input === g.answer) return finish(after, "won");
      if (after.game.guesses.length === ROWS) return finish(after, "lost");
      return after;
    }
    default:
      if (g.input.length >= COLS) return state;
      return { ...st, game: { ...g, input: g.input + action } };
  }
}

const SQUARE: Record<Mark, string> = { correct: "🟩", present: "🟨", absent: "⬜" };
/** The result as text for the clipboard: a heading and the emoji grid. */
export function share(g: Game): string {
  const head = `pal wordle ${g.day !== null ? `#${g.day + 1}` : "practice"} ${g.status === "won" ? g.guesses.length : "X"}/${ROWS}${g.hard ? "*" : ""}`;
  return [head, "", ...g.guesses.map((w) => mark(w, g.answer).map((m) => SQUARE[m]).join(""))].join("\n");
}

const isGame = (x: unknown): x is Game => {
  const g = x as Game;
  return !!g && typeof g === "object" && typeof g.answer === "string" && g.answer.length === COLS && Array.isArray(g.guesses) && (g.day === null || typeof g.day === "number")
    && typeof g.input === "string" && ["play", "won", "lost"].includes(g.status);
};
const isStats = (x: unknown): x is Stats => {
  const s = x as Stats;
  return !!s && typeof s === "object" && typeof s.played === "number" && typeof s.won === "number" && typeof s.streak === "number" && Array.isArray(s.dist) && s.dist.length === ROWS;
};
/** Whether `x` is a state this version can play on; a store from another version starts over. */
export function isState(x: unknown): x is State {
  const s = x as State;
  return !!s && typeof s === "object" && isGame(s.game) && isStats(s.stats);
}
