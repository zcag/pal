// The numbers the stats page shows, pure, from the log of solves.
//
// A solve with a reveal in it (`helped`) is counted as finished but never
// as a best or in the average; a replay (a puzzle solved before) is left
// out of the times altogether, since the answers were known.
//
// The streak is Crosshare's daily mini, in Crosshare's days: a daily's date
// is a UTC date (its listing runs on UTC), so a day counts when that day's
// daily was solved, without a reveal, while it was still that day in UTC.
// The streak runs back from today, or from yesterday while today's is not
// solved yet, so it does not read 0 all morning.
export type Solve = {
  id: string;
  title: string;
  author: string;
  /** The daily's date (YYYY-MM-DD) when it was a daily mini. */
  date?: string;
  /** When it was solved, unix ms. */
  at: number;
  ms: number;
  helped?: boolean;
  checked?: boolean;
  replay?: boolean;
  size?: string;
};

export const DAY = 86_400_000;
/** YYYY-MM-DD of a moment, in UTC. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayBefore = (d: string) => utcDay(Date.parse(`${d}T00:00:00Z`) - DAY);

/** The dailies solved on their own day without a reveal. */
export function onTheDay(solves: Solve[]): Set<string> {
  return new Set(solves.flatMap((s) => (s.date && !s.helped && !s.replay && utcDay(s.at) === s.date ? [s.date] : [])));
}

export function streaks(solves: Solve[], now: number): { streak: number; best: number } {
  const days = onTheDay(solves);
  let d = utcDay(now);
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
  /** Solved without a reveal. */
  clean: number;
  best?: number;
  average?: number;
  /** The average of the last ten clean solves. */
  recent?: number;
  streak: number;
  bestStreak: number;
  /** Today's daily is solved (on the day, clean). */
  today: boolean;
  /** The last clean solve times, oldest first, for the chart. */
  times: { ms: number; at: number; title: string }[];
};

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);

export function summary(solves: Solve[], now: number, chart = 24): Summary {
  const firsts = solves.filter((s) => !s.replay);
  const clean = firsts.filter((s) => !s.helped).sort((a, b) => a.at - b.at);
  const ms = clean.map((s) => s.ms);
  const { streak, best } = streaks(solves, now);
  return {
    solved: firsts.length,
    clean: clean.length,
    best: ms.length ? Math.min(...ms) : undefined,
    average: avg(ms),
    recent: clean.length >= 3 ? avg(ms.slice(-10)) : undefined,
    streak,
    bestStreak: best,
    today: onTheDay(solves).has(utcDay(now)),
    times: clean.slice(-chart).map((s) => ({ ms: s.ms, at: s.at, title: s.title })),
  };
}

/** Is this solve's time a new best (the fastest clean first solve so far, itself included)? */
export function isBest(solves: Solve[], s: Solve): boolean {
  if (s.helped || s.replay) return false;
  return solves.every((o) => o === s || o.helped || o.replay || o.ms > s.ms);
}
