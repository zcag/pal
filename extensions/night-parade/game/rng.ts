// A seeded random stream (mulberry32): the whole run replays from its seed,
// which is what lets the bot and the tests play the same night twice.
export type Rng = { s: number };

export const rng = (seed: number): Rng => ({ s: seed >>> 0 });

/** The next number in [0, 1). */
export function next(r: Rng): number {
  let t = (r.s = (r.s + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (r: Rng, a: number, b: number) => a + next(r) * (b - a);
export const int = (r: Rng, n: number) => Math.floor(next(r) * n);
export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];
export const chance = (r: Rng, p: number) => next(r) < p;
