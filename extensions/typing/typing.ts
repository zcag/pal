// The typing test, pure: the options, a run (the words, what was typed,
// the keystrokes with their times), the result and the records. The page
// (surface/) plays with these and the host tests them, so the numbers the
// page shows are the numbers the tests check. Types only from `@zcag/pal`:
// the page imports this file too.
//
// The measures are monkeytype's:
// - wpm: the characters of correctly typed words, and the space after each,
//   over five, per minute; a word left wrong counts nothing, the word in
//   progress counts while it is right so far.
// - raw: every character typed as it stands in the end, spaces included,
//   the same way; so raw is wpm with the mistakes put back.
// - accuracy: the keystrokes that were right when pressed, out of all of
//   them; a mistake fixed with Backspace still counts against it.
// - consistency: how steady the speed was second to second, 100 when every
//   second was as fast as the next: 100 × (1 − tanh(v + v³/3 + v⁵/5)), v the
//   coefficient of variation of the per-second raw speeds.
import type { Action } from "@zcag/pal";
import { generate } from "./words.ts";

export type Mode = "time" | "words" | "zen";
export const MODES: readonly Mode[] = ["time", "words", "zen"];
export const TIMES = [15, 30, 60, 120] as const;
export const COUNTS = [10, 25, 50, 100] as const;
export type Config = { mode: Mode; time: number; words: number; punctuation: boolean; numbers: boolean };
export const DEFAULTS: Config = { mode: "time", time: 30, words: 25, punctuation: false, numbers: false };

/** A stored config, each field checked on its own; the default for anything missing or unknown. */
export function configOf(x: unknown): Config {
  const o = (x && typeof x === "object" ? x : {}) as Partial<Config>;
  return {
    mode: MODES.includes(o.mode as Mode) ? (o.mode as Mode) : DEFAULTS.mode,
    time: (TIMES as readonly number[]).includes(o.time as number) ? (o.time as number) : DEFAULTS.time,
    words: (COUNTS as readonly number[]).includes(o.words as number) ? (o.words as number) : DEFAULTS.words,
    punctuation: typeof o.punctuation === "boolean" ? o.punctuation : DEFAULTS.punctuation,
    numbers: typeof o.numbers === "boolean" ? o.numbers : DEFAULTS.numbers,
  };
}

/** The test as the records file it: `time 30`, `words 25 punctuation numbers`, `zen` (no words to dress). */
export const modeKey = (c: Config): string => c.mode === "zen" ? "zen" : [c.mode, c.mode === "time" ? c.time : c.words, c.punctuation && "punctuation", c.numbers && "numbers"].filter(Boolean).join(" ");

/** The test in a few words for the title line and the result: `time 30`, `words 50 · punctuation · numbers`. */
export const label = (c: Config): string => keyLabel(modeKey(c));

// ---- the settings --------------------------------------------------------------------------------------------

/** The pace caret races the best, the average of the last ten or the last test of the same kind; or there is none. */
export const PACES = ["off", "pb", "average", "last"] as const;
export type Pace = (typeof PACES)[number];
/** Stop on error: a wrong letter is not taken (`letter`), or a wrong word cannot be left with space (`word`). */
export const STOPS = ["off", "letter", "word"] as const;
export type Stop = (typeof STOPS)[number];
export type Options = { pace: Pace; stop: Stop };

/** The extension's settings (`pace_caret`, `stop_on_error`), anything unknown off. */
export function optionsOf(s: unknown): Options {
  const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
  return {
    pace: PACES.includes(o.pace_caret as Pace) ? (o.pace_caret as Pace) : "off",
    stop: STOPS.includes(o.stop_on_error as Stop) ? (o.stop_on_error as Stop) : "off",
  };
}

export const PACE_TITLES: Record<Pace, string> = { off: "off", pb: "personal best", average: "average of last 10", last: "last test" };
export const STOP_TITLES: Record<Stop, string> = { off: "off", letter: "letter", word: "word" };

// ---- a run -------------------------------------------------------------------------------------------------

/** A keystroke: a character (`c`) or a space (`s`) at `t` ms from the first, right when pressed or not, and the correct characters so far after it (for the wpm line). */
export type Stroke = { t: number; k: "c" | "s"; ok: boolean; good: number };

export type Run = {
  cfg: Config;
  words: string[];
  /** What was typed for each word up to the current one. */
  typed: string[];
  /** The current word. */
  at: number;
  log: Stroke[];
  /** Words mode: the last word typed right, or a space on it. Zen: Enter. */
  over: boolean;
  stop: Stop;
};

/** More letters than the word has are shown, up to this many. */
export const MAX_EXTRA = 12;
/** A time test keeps this many words ahead of the one in progress. */
const AHEAD = 60;

/** A fresh run. Zen has no words to type: each word is what was typed, so it is always right. */
export function newRun(cfg: Config, rng: () => number = Math.random, words?: string[], stop: Stop = "off"): Run {
  if (cfg.mode === "zen") words = [""];
  else if (!words) {
    words = generate(cfg.mode === "words" ? cfg.words : AHEAD * 2, cfg, rng);
    // A words test ends a sentence with its last word.
    const last = words.length - 1;
    if (cfg.mode === "words" && cfg.punctuation && /[a-z]$/i.test(words[last])) words[last] += ".";
  }
  return { cfg, words: [...words], typed: [""], at: 0, log: [], over: false, stop };
}

/** A time test running low on words gets more; the new ones' count (to draw). */
export function refill(run: Run, rng: () => number = Math.random): number {
  if (run.cfg.mode !== "time" || run.words.length - run.at > AHEAD) return 0;
  const add = generate(AHEAD, run.cfg, rng, run.words);
  run.words.push(...add);
  return add.length;
}

export const input = (run: Run): string => run.typed[run.at] ?? "";
export const started = (run: Run): boolean => run.log.length > 0;

/** The correct characters so far: each word typed right and its space, and the current word while it is right. */
export function good(run: Run): number {
  let n = 0;
  for (let i = 0; i < run.at; i++) if (run.typed[i] === run.words[i]) n += run.words[i].length + 1;
  const cur = input(run);
  if (run.words[run.at]?.startsWith(cur)) n += cur.length;
  return n;
}

/**
 * A character typed at `t`. False when it is not taken: the run is over, or the word already has MAX_EXTRA extra
 * letters; `"blocked"` when stop on error refused a wrong letter (it still counts against accuracy).
 */
export function typeChar(run: Run, ch: string, t: number): boolean | "blocked" {
  const zen = run.cfg.mode === "zen";
  const word = run.words[run.at];
  const cur = input(run);
  if (run.over || (!zen && cur.length >= word.length + MAX_EXTRA)) return false;
  const ok = zen || word[cur.length] === ch;
  if (!ok && run.stop === "letter") {
    run.log.push({ t, k: "c", ok, good: good(run) });
    return "blocked";
  }
  run.typed[run.at] = cur + ch;
  if (zen) run.words[run.at] = cur + ch;
  run.log.push({ t, k: "c", ok, good: 0 });
  run.log[run.log.length - 1].good = good(run);
  if (run.cfg.mode === "words" && run.at === run.words.length - 1 && run.typed[run.at] === word) run.over = true;
  return true;
}

/**
 * A space at `t`: on to the next word (the rest of this one missed). Nothing at the start of a word; `"blocked"`
 * when stop on error by word keeps a wrong word (the space counts against accuracy).
 */
export function typeSpace(run: Run, t: number): boolean | "blocked" {
  const cur = input(run);
  if (run.over || !cur) return false;
  const ok = cur === run.words[run.at];
  if (!ok && run.stop === "word") {
    run.log.push({ t, k: "s", ok, good: good(run) });
    return "blocked";
  }
  if (run.cfg.mode === "zen") run.words.push("");
  if (run.cfg.mode === "words" && run.at === run.words.length - 1) {
    run.log.push({ t, k: "s", ok, good: good(run) });
    run.over = true;
    return true;
  }
  run.at++;
  run.typed[run.at] = "";
  run.log.push({ t, k: "s", ok, good: good(run) });
  return true;
}

/**
 * Backspace: one letter, or the whole word (`word`, alt or ctrl). At the start of a word it goes back into the one
 * before, only if that one was left wrong (a right word is done with). False when there is nothing to take.
 */
export function backspace(run: Run, word = false): boolean {
  if (run.over) return false;
  let cur = input(run);
  if (!cur) {
    const prev = run.at - 1;
    // Zen's words are always right; going back into one is just editing.
    if (prev < 0 || (run.typed[prev] === run.words[prev] && run.cfg.mode !== "zen")) return false;
    run.typed.length = run.at;
    if (run.cfg.mode === "zen") run.words.length = run.at;
    run.at = prev;
    cur = run.typed[prev];
    if (!word) return true;
  }
  run.typed[run.at] = word ? "" : cur.slice(0, -1);
  if (run.cfg.mode === "zen") run.words[run.at] = run.typed[run.at];
  return true;
}

/** Zen ends when you say so (Enter); nothing typed, nothing to end. */
export function endZen(run: Run): boolean {
  if (run.cfg.mode !== "zen" || run.over || !run.log.length) return false;
  run.over = true;
  return true;
}

// ---- the pace caret ------------------------------------------------------------------------------------------

/** The speed the pace caret keeps for a test of this kind, if there is one to race. */
export function paceWpm(rec: Records, key: string, pace: Pace): number | undefined {
  if (pace === "off" || key === "zen") return undefined;
  if (pace === "pb") return rec.best[key]?.wpm;
  const xs = rec.history.filter((p) => p.key === key);
  if (!xs.length) return undefined;
  return pace === "last" ? xs[xs.length - 1].wpm : recent(rec, key).wpm;
}

/**
 * Where a typist at `wpm` would be after `ms`, typing every word right: the word, the letter in it (its length is
 * the space after it) and how far through that letter, 0 to 1. At the end of the words it stays after the last.
 */
export function paceAt(words: readonly string[], wpm: number, ms: number): { word: number; letter: number; frac: number } {
  let chars = (wpm * 5 * ms) / 60000;
  for (let i = 0; i < words.length; i++) {
    const n = words[i].length + (i < words.length - 1 ? 1 : 0);
    if (chars < n) return { word: i, letter: Math.floor(chars), frac: chars - Math.floor(chars) };
    chars -= n;
  }
  const last = words.length - 1;
  return { word: last, letter: words[last]?.length ?? 0, frac: 0 };
}

/** Whether word `i` was left wrong: typed and moved past, not as it is. */
export const missed = (run: Run, i: number): boolean => i < run.at && run.typed[i] !== run.words[i];

// ---- the result --------------------------------------------------------------------------------------------

/** One second of the test: the wpm up to its end, its own raw speed, the mistakes made in it. */
export type Sample = { wpm: number; raw: number; errors: number };

export type Result = {
  /** When it was taken, epoch ms. */
  at: number;
  key: string;
  wpm: number;
  raw: number;
  /** 0 to 100. */
  acc: number;
  consistency: number;
  /** Correct, incorrect, extra, missed letters. */
  chars: [number, number, number, number];
  secs: number;
  samples: Sample[];
  /** Why it does not count, if it does not. */
  invalid?: string;
};

const perMin = (chars: number, secs: number) => (secs > 0 ? (chars / 5) * (60 / secs) : 0);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Accuracy below this and the test does not count: keys mashed are not a speed. */
export const MIN_ACC = 75;

/** The run scored after `ms` of typing (the first keystroke to the last, or the whole time of a time test). */
export function result(run: Run, ms: number, now = Date.now()): Result {
  const secs = Math.max(ms, 1) / 1000;
  const chars: Result["chars"] = [0, 0, 0, 0];
  let typed = 0;
  const last = Math.min(run.at, run.words.length - 1);
  for (let i = 0; i <= last; i++) {
    const w = run.words[i], x = run.typed[i] ?? "";
    const done = i < run.at || run.over;
    typed += x.length + (i < run.at ? 1 : 0);
    for (let j = 0; j < Math.max(w.length, x.length); j++) {
      if (j >= x.length) { if (done) chars[3]++; } else if (j >= w.length) chars[2]++;
      else if (x[j] === w[j]) chars[0]++;
      else chars[1]++;
    }
  }
  const keys = run.log.length;
  const right = run.log.filter((s) => s.ok).length;
  const acc = keys ? (100 * right) / keys : 0;

  // Per second; a last part-second under half of one joins the second before.
  const n = Math.max(1, Math.round(secs));
  const bucket = (s: Stroke) => Math.min(n - 1, Math.floor(s.t / 1000));
  const buckets = Array.from({ length: n }, () => ({ keys: 0, errors: 0, good: 0 }));
  for (const s of run.log) {
    const b = buckets[bucket(s)];
    b.keys++;
    if (!s.ok) b.errors++;
    b.good = s.good;
  }
  let g = 0;
  const samples: Sample[] = buckets.map((b, i) => {
    const end = i === n - 1 ? secs : i + 1;
    if (b.keys) g = b.good;
    return { wpm: round2(perMin(g, end)), raw: round2(perMin(b.keys, end - i)), errors: b.errors };
  });
  const raws = samples.map((s) => s.raw);
  const mean = raws.reduce((a, b) => a + b, 0) / raws.length;
  const sd = Math.sqrt(raws.reduce((a, b) => a + (b - mean) ** 2, 0) / raws.length);
  const v = mean ? sd / mean : 1;
  const consistency = mean ? 100 * (1 - Math.tanh(v + v ** 3 / 3 + v ** 5 / 5)) : 0;

  const res: Result = {
    at: now, key: modeKey(run.cfg),
    wpm: round2(perMin(good(run), secs)), raw: round2(perMin(typed, secs)), acc: round2(acc), consistency: round2(consistency),
    chars, secs: round2(secs), samples,
  };
  if (acc < MIN_ACC) res.invalid = `accuracy under ${MIN_ACC}%`;
  else if (!good(run)) res.invalid = "nothing typed right";
  return res;
}

// ---- the records ---------------------------------------------------------------------------------------------

export type Best = Pick<Result, "wpm" | "raw" | "acc" | "consistency" | "at">;
/** A past test, without its seconds. */
export type Past = Pick<Result, "at" | "key" | "wpm" | "raw" | "acc" | "consistency" | "secs">;
export type Records = { best: Record<string, Best>; history: Past[]; tests: number; secs: number };
export const HISTORY = 1000;

export const noRecords = (): Records => ({ best: {}, history: [], tests: 0, secs: 0 });

export function recordsOf(x: unknown): Records {
  const o = x as Partial<Records> | null;
  if (!o || typeof o !== "object" || !o.best || typeof o.best !== "object" || !Array.isArray(o.history)) return noRecords();
  return { best: o.best, history: o.history, tests: Number(o.tests) || 0, secs: Number(o.secs) || 0 };
}

/** The records with a finished test in: the history, the totals, the best when it beats it. An invalid test changes nothing. */
export function file(rec: Records, res: Result): { records: Records; best: boolean; prev?: Best } {
  if (res.invalid) return { records: rec, best: false, prev: rec.best[res.key] };
  const prev = rec.best[res.key];
  const best = !prev || res.wpm > prev.wpm;
  const { at, key, wpm, raw, acc, consistency, secs } = res;
  return {
    records: {
      best: best ? { ...rec.best, [key]: { wpm, raw, acc, consistency, at } } : rec.best,
      history: [...rec.history, { at, key, wpm, raw, acc, consistency, secs }].slice(-HISTORY),
      tests: rec.tests + 1,
      secs: round2(rec.secs + secs),
    },
    best,
    prev,
  };
}

/** The mean wpm of the last `n` tests of this kind, and how many there were. */
export function recent(rec: Records, key: string, n = 10): { wpm: number; count: number } {
  const xs = rec.history.filter((p) => p.key === key).slice(-n);
  return { wpm: xs.length ? round2(xs.reduce((a, p) => a + p.wpm, 0) / xs.length) : 0, count: xs.length };
}

// ---- the stats ------------------------------------------------------------------------------------------------

/** A records key as words: `words 25 punctuation` → `words 25 · punctuation`. */
export function keyLabel(key: string): string {
  if (key === "zen") return key;
  const [mode, n, ...dress] = key.split(" ");
  return [`${mode} ${n}`, ...dress].join(" · ");
}

/** The kinds of test in the history, in the bar's order: time before words, short before long, plain before dressed. */
export function kinds(rec: Records): string[] {
  const rank = (k: string) => {
    const [mode, n] = k.split(" ");
    if (mode === "zen") return 1e6;
    return (mode === "time" ? 0 : 1000) + Number(n) + (k.includes("punctuation") ? 0.1 : 0) + (k.includes("numbers") ? 0.2 : 0);
  };
  return [...new Set(rec.history.map((p) => p.key))].sort((a, b) => rank(a) - rank(b));
}

export type Summary = { tests: number; secs: number; best: number; avg: number; avg10: number; acc: number; consistency: number };

/** The history in figures: all of it, or one kind (`key`). Counts and time are the whole record's when no kind is picked. */
export function summary(rec: Records, key?: string): Summary {
  const xs = key ? rec.history.filter((p) => p.key === key) : rec.history;
  const mean = (ys: Past[], f: (p: Past) => number) => (ys.length ? round2(ys.reduce((a, p) => a + f(p), 0) / ys.length) : 0);
  return {
    tests: key ? xs.length : rec.tests,
    secs: key ? round2(xs.reduce((a, p) => a + p.secs, 0)) : rec.secs,
    best: xs.reduce((a, p) => Math.max(a, p.wpm), 0),
    avg: mean(xs, (p) => p.wpm),
    avg10: mean(xs.slice(-10), (p) => p.wpm),
    acc: mean(xs, (p) => p.acc),
    consistency: mean(xs, (p) => p.consistency),
  };
}

/** The mean of each value and the `n - 1` before it (fewer at the start): the progress chart's trend line. */
export function rolling(xs: readonly number[], n = 10): number[] {
  let sum = 0;
  return xs.map((x, i) => {
    sum += x - (i >= n ? xs[i - n] : 0);
    return round2(sum / Math.min(i + 1, n));
  });
}

// ---- the view's actions and title ----------------------------------------------------------------------------

/** Every option as ⌘K lists it: a new test and the stats first, then the modes and lengths not in use, the toggles, and the settings' other values. */
export function viewActions(c: Config, o: Options = { pace: "off", stop: "off" }): Action[] {
  const out: Action[] = [{ id: "restart", title: "New test", shortcut: "tab" }, { id: "stats", title: "Stats and history" }];
  for (const t of TIMES) if (c.mode !== "time" || c.time !== t) out.push({ id: `time:${t}`, title: `Time: ${t} seconds` });
  for (const n of COUNTS) if (c.mode !== "words" || c.words !== n) out.push({ id: `words:${n}`, title: `Words: ${n}` });
  if (c.mode !== "zen") out.push({ id: "zen", title: "Zen: type freely, Enter to finish" });
  out.push({ id: "punctuation", title: c.punctuation ? "Punctuation off" : "Punctuation on" });
  out.push({ id: "numbers", title: c.numbers ? "Numbers off" : "Numbers on" });
  for (const p of PACES) if (p !== o.pace) out.push({ id: `pace:${p}`, title: `Pace caret: ${PACE_TITLES[p]}` });
  for (const x of STOPS) if (x !== o.stop) out.push({ id: `stop:${x}`, title: `Stop on error: ${STOP_TITLES[x]}` });
  return out;
}

/** An action id applied to the config; the same config for `restart` or an id it does not know. */
export function configure(c: Config, id: string): Config {
  const [what, arg] = id.split(":");
  const n = Number(arg);
  if (what === "time" && (TIMES as readonly number[]).includes(n)) return { ...c, mode: "time", time: n };
  if (what === "words" && (COUNTS as readonly number[]).includes(n)) return { ...c, mode: "words", words: n };
  if (what === "zen") return { ...c, mode: "zen" };
  if (what === "punctuation") return { ...c, punctuation: !c.punctuation };
  if (what === "numbers") return { ...c, numbers: !c.numbers };
  return c;
}

/** An action id as a settings write (`pace:pb` → `{ pace_caret: "pb" }`), if it is one. */
export function settingOf(id: string): Record<string, string> | undefined {
  const [what, arg] = id.split(":");
  if (what === "pace" && PACES.includes(arg as Pace)) return { pace_caret: arg };
  if (what === "stop" && STOPS.includes(arg as Stop)) return { stop_on_error: arg };
  return undefined;
}

export const titleOf = (c: Config): string => `Typing · ${label(c)}`;
