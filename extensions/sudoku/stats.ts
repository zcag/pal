// The numbers the stats page shows, pure, from the log of solves, one
// difficulty at a time.
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

export function streaks(solves: Solve[], now: number): { streak: number; best: number } {
  const days = onTheDay(solves);
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

export function summary(solves: Solve[], now: number, chart = 24): Summary {
  const firsts = solves.filter((s) => !s.replay);
  const good = firsts.filter(clean).sort((a, b) => a.at - b.at);
  const ms = good.map((s) => s.ms);
  const { streak, best } = streaks(solves, now);
  return {
    solved: firsts.length,
    clean: good.length,
    flawless: good.filter((s) => !s.mistakes).length,
    best: ms.length ? Math.min(...ms) : undefined,
    average: avg(ms),
    recent: good.length >= 3 ? avg(ms.slice(-10)) : undefined,
    streak,
    bestStreak: best,
    today: onTheDay(solves).has(localDay(now)),
    times: good.slice(-chart).map((s) => ({ ms: s.ms, at: s.at })),
  };
}

/** Is this solve's time a new best (the fastest clean first solve so far, itself included)? */
export function isBest(solves: Solve[], s: Solve): boolean {
  if (!clean(s)) return false;
  return solves.every((o) => o === s || !clean(o) || o.ms > s.ms);
}
