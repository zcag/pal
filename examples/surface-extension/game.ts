// The rules, pure: shared by the page (surface/main.ts imports this file,
// served transpiled) and by whatever the extension or its tests check.

export const W = 7, H = 5;
export type Pos = { x: number; y: number };
export type Dir = "up" | "down" | "left" | "right";

const STEP: Record<Dir, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** One step, stopping at the walls. */
export const move = (p: Pos, d: Dir): Pos => ({ x: Math.min(W - 1, Math.max(0, p.x + STEP[d].x)), y: Math.min(H - 1, Math.max(0, p.y + STEP[d].y)) });

export const centre = (): Pos => ({ x: Math.floor(W / 2), y: Math.floor(H / 2) });

/** A goal somewhere other than `p`, from `r` in 0..1. */
export const goal = (p: Pos, r: number): Pos => {
  const i = (Math.floor(r * (W * H - 1)) + p.y * W + p.x + 1) % (W * H);
  return { x: i % W, y: Math.floor(i / W) };
};
