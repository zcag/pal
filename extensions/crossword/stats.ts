// The numbers the stats page shows, pure: the counts, the best, the
// average and the streak from what the account keeps (`Kept`, the synced
// summary; on a machine without an account, this one's log tallied), the
// recent average, the chart and the history from this machine's log.
//
// A solve with a reveal in it (`helped`) is counted as finished but never
// as a best or in the average; a replay (a puzzle solved before) is left
// out of the times altogether, since the answers were known.
//
// The stats are per source (the page shows one source's at a time; a solve
// without a source is Crosshare's, from before there were others). The
// streak is the source's daily in the source's own days: Crosshare's dates
// are UTC dates (its listing runs on UTC), the Turkish papers' Istanbul's.
// A day counts when that day's daily was solved, without a reveal, while it
// was still that day on that calendar. The streak runs back from today, or
// from yesterday while today's is not solved yet, so it does not read 0 all
// morning.
export type Solve = {
  id: string;
  /** The source (sources.ts); none is Crosshare. */
  source?: string;
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
/** A calendar: a moment's date on it. */
export type Day = (ms: number) => string;
/** The solves of one source. */
export const ofSource = (solves: Solve[], source: string) => solves.filter((s) => (s.source ?? "crosshare") === source);

/** The dailies solved on their own day without a reveal. */
export function onTheDay(solves: Solve[], day: Day = utcDay): Set<string> {
  return new Set(solves.flatMap((s) => (s.date && !s.helped && !s.replay && day(s.at) === s.date ? [s.date] : [])));
}

export const streaks = (solves: Solve[], now: number, day: Day = utcDay) => streakOf(onTheDay(solves, day), now, day);

/** The streak from the days a daily was solved on its day: back from today (or yesterday) on the source's calendar, and the longest run. */
export function streakOf(days: Set<string>, now: number, day: Day = utcDay): { streak: number; best: number } {
  let d = day(now);
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

const clean = (s: Solve) => !s.helped && !s.replay;

/**
 * A source's record as it syncs (index.ts: the `counts`, `best` and `days`
 * keys, merged by sum, min and union): first solves, clean ones, the clean
 * ones' total time, the fastest, and the dailies solved on their day. Two
 * machines' records add up with `plus`.
 */
export type Kept = { solved: number; clean: number; ms: number; best?: number; days: string[] };

/** A log's record, `day` the source's calendar. */
export function tally(solves: Solve[], day: Day = utcDay): Kept {
  const ms = solves.filter(clean).map((s) => s.ms);
  return {
    solved: solves.filter((s) => !s.replay).length, clean: ms.length, ms: ms.reduce((a, b) => a + b, 0),
    ...(ms.length > 0 && { best: Math.min(...ms) }), days: [...onTheDay(solves, day)],
  };
}

/** Two records as one: counts added, the faster best, the days of both. */
export function plus(a: Kept, b: Kept): Kept {
  const best = [a.best, b.best].filter((x): x is number => x !== undefined);
  return { solved: a.solved + b.solved, clean: a.clean + b.clean, ms: a.ms + b.ms, ...(best.length > 0 && { best: Math.min(...best) }), days: [...new Set([...a.days, ...b.days])] };
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

/** The page's numbers: the record's (`kept`, the log's own by default), and the recent average and the chart from the log. */
export function summary(solves: Solve[], now: number, day: Day = utcDay, kept: Kept = tally(solves, day), chart = 24): Summary {
  const good = solves.filter(clean).sort((a, b) => a.at - b.at);
  const ms = good.map((s) => s.ms);
  const days = new Set(kept.days);
  const { streak, best } = streakOf(days, now, day);
  return {
    solved: kept.solved,
    clean: kept.clean,
    best: kept.best,
    average: kept.clean ? Math.round(kept.ms / kept.clean) : undefined,
    recent: good.length >= 3 ? avg(ms.slice(-10)) : undefined,
    streak,
    bestStreak: best,
    today: days.has(day(now)),
    times: good.slice(-chart).map((s) => ({ ms: s.ms, at: s.at, title: s.title })),
  };
}

/** Is this solve a new best: a clean first solve faster than the record's best before it (on any machine of the account)? */
export const beats = (s: Solve, best: number | undefined): boolean => clean(s) && (best === undefined || s.ms < best);
