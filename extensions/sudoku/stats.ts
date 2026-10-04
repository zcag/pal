// The numbers the stats page shows, pure, one difficulty at a time: the
// counts, the best, the average and the streak from what the account keeps
// (`Kept`, the synced summary; on a machine without an account, this one's
// log tallied), the recent average, the chart and the history from this
// machine's log of solves.
//
// A solve with a hint in it counts as solved, and for the streak, but never
// as a best or in the average; a replay (a puzzle solved before) is left
// out of the times altogether, since the answer was known.
//
// The streak is the difficulty's daily: a day counts when that day's
// puzzle was solved while it was still that day (your local calendar). It
// runs back from today, or from yesterday while today's is not solved
// yet, so it does not read 0 all morning.
import { isoDay as localDay } from "@zcag/pal";
import type { Diff } from "./sudoku.ts";

export type Solve = {
  id: string;
  diff: Diff;
  /** The daily's date (YYYY-MM-DD) when it was one. */
  date?: string;
  /** When it was solved, unix ms. */
  at: number;
  ms: number;
  hints?: number;
  mistakes?: number;
  replay?: boolean;
};

const DAY = 86_400_000;
const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
export const ofDiff = (solves: Solve[], diff: Diff) => solves.filter((s) => s.diff === diff);
const clean = (s: Solve) => !s.hints && !s.replay;

/** The dailies solved on their own day. */
export const onTheDay = (solves: Solve[]) => new Set(solves.flatMap((s) => (s.date && !s.replay && localDay(s.at) === s.date ? [s.date] : [])));

export const streaks = (solves: Solve[], now: number) => streakOf(onTheDay(solves), now);

/** The streak from the days a daily was solved on its day: back from today (or yesterday), and the longest run. */
export function streakOf(days: Set<string>, now: number): { streak: number; best: number } {
  let d = localDay(now);
  if (!days.has(d)) d = dayBefore(d);
  let streak = 0;
  while (days.has(d)) { streak++; d = dayBefore(d); }
  let best = 0, run = 0, prev = "";
  for (const day of [...days].sort()) {
    run = prev && dayBefore(day) === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { streak, best: Math.max(best, streak) };
}

/**
 * A difficulty's record as it syncs (index.ts: the `counts`, `best` and
 * `days` keys, merged by sum, min and union): first solves, clean ones,
 * flawless ones, the clean ones' total time, the fastest, and the dailies
 * solved on their day. Two machines' records add up with `plus`.
 */
export type Kept = { solved: number; clean: number; flawless: number; ms: number; best?: number; days: string[] };

/** A log's record. */
export function tally(solves: Solve[]): Kept {
  const good = solves.filter(clean);
  const ms = good.map((s) => s.ms);
  return {
    solved: solves.filter((s) => !s.replay).length, clean: good.length, flawless: good.filter((s) => !s.mistakes).length,
    ms: ms.reduce((a, b) => a + b, 0), ...(ms.length > 0 && { best: Math.min(...ms) }), days: [...onTheDay(solves)],
  };
}

/** Two records as one: counts added, the faster best, the days of both. */
export function plus(a: Kept, b: Kept): Kept {
  const best = [a.best, b.best].filter((x): x is number => x !== undefined);
  return {
    solved: a.solved + b.solved, clean: a.clean + b.clean, flawless: a.flawless + b.flawless, ms: a.ms + b.ms,
    ...(best.length > 0 && { best: Math.min(...best) }), days: [...new Set([...a.days, ...b.days])],
  };
}

export type Summary = {
  solved: number;
  /** Solved without a hint. */
  clean: number;
  /** Solved without a hint or a mistake. */
  flawless: number;
  best?: number;
  average?: number;
  /** The average of the last ten clean solves. */
  recent?: number;
  streak: number;
  bestStreak: number;
  /** Today's daily is solved. */
  today: boolean;
  /** The last clean solve times, oldest first, for the chart. */
  times: { ms: number; at: number }[];
};

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);

/** The page's numbers: the record's (`kept`, the log's own by default), and the recent average and the chart from the log. */
export function summary(solves: Solve[], now: number, kept: Kept = tally(solves), chart = 24): Summary {
  const good = solves.filter(clean).sort((a, b) => a.at - b.at);
  const ms = good.map((s) => s.ms);
  const days = new Set(kept.days);
  const { streak, best } = streakOf(days, now);
  return {
    solved: kept.solved,
    clean: kept.clean,
    flawless: kept.flawless,
    best: kept.best,
    average: kept.clean ? Math.round(kept.ms / kept.clean) : undefined,
    recent: good.length >= 3 ? avg(ms.slice(-10)) : undefined,
    streak,
    bestStreak: best,
    today: days.has(localDay(now)),
    times: good.slice(-chart).map((s) => ({ ms: s.ms, at: s.at })),
  };
}

/** Is this solve a new best: a clean first solve faster than the record's best before it (on any machine of the account)? */
export const beats = (s: Solve, best: number | undefined): boolean => clean(s) && (best === undefined || s.ms < best);
