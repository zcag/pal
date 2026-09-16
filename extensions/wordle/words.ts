// The word lists (answers.txt, allowed.txt; build.ts says where they come
// from) and the day's pick. Both files are inlined by the bundle, so
// nothing is read at runtime. The daily answer walks the sorted answers in
// a fixed stride, a permutation when the stride and the count are coprime
// (the test checks), so consecutive days are far apart in the alphabet and
// no answer repeats before every one has come up.
import allowedText from "./allowed.txt";
import answersText from "./answers.txt";

export const ANSWERS: readonly string[] = answersText.trim().split("\n");
/** Every word a guess may be, the answers included. */
export const ALLOWED: ReadonlySet<string> = new Set([...allowedText.trim().split("\n"), ...ANSWERS]);

/** Day 0 of the dailies: 2026-01-01, in the local calendar. */
export const EPOCH = Date.UTC(2026, 0, 1);
/** The day index of a local date: puzzle `#(day + 1)`. */
export const dayOf = (d: Date = new Date()): number => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000);

/** Coprime to the answer count (a prime that does not divide it); must not change once shipped, or every day's word would. */
export const STRIDE = 1103;
export const dailyAnswer = (day: number): string => {
  const n = ANSWERS.length;
  return ANSWERS[(((day * STRIDE) % n) + n) % n];
};
export const randomAnswer = (rng: () => number = Math.random): string => ANSWERS[Math.min(ANSWERS.length - 1, Math.floor(rng() * ANSWERS.length))];
