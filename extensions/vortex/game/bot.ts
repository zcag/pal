// A player that sees every wall on screen and plans: it plays behind the title,
// and the tests let it run each stage to show every pattern can be survived.
//
// It cuts the orbit into bins and looks ahead a second in steps. A bin at a
// step is blocked when a wall (moved on at its speed) covers it then. Working
// back from the last step, each bin learns how many steps you can last from
// there, reaching any bin within a step's turn that no wall stands between;
// then it turns toward the best bin it can reach in one step.
import { FEEL } from "./content.ts";
import { inside, speed, step, type Input, type State } from "./sim.ts";

const TAU = Math.PI * 2;
const B = 180, W = TAU / B;
const H = 1 / 30, STEPS = 33;
/** Bins a step's turn covers. It plans as if it turned slower than it does, so it sets off early; only when that finds no way through does it count on more, up to full speed. */
const SPEEDS = [0.65, 0.8, 0.9, 1].map((f) => Math.floor((FEEL.turn * f * H) / W));
/** Seconds of room it keeps from a wall's front and back. */
const PAD = 0.035;
/** How often it looks again. */
const EVERY = 1 / 120;

export function decide(s: State): Input {
  const v = speed(s), pad = v * PAD;
  const block = Array.from({ length: STEPS + 1 }, () => new Uint8Array(B));
  for (const w of s.walls) {
    const span = w.a1 - w.a0, low = FEEL.orbit * Math.cos(span / 2);
    const b0 = Math.floor(w.a0 / W), b1 = Math.ceil(w.a1 / W);
    for (let j = 0; j <= STEPS; j++) {
      const r = w.r - v * j * H;
      if (r > FEEL.orbit) continue;
      if (r + w.len < low) break;
      // Walls count as a little early and a little long: it moves in good time.
      const moved = { ...w, r: r - pad, len: w.len + pad * 2 };
      // A little wider than the wall: the bot stays off its edges.
      for (let b = b0 - 1; b <= b1; b++) {
        const k = ((b % B) + B) % B, a = (k + 0.5) * W;
        if (inside(moved, a) || inside(moved, a - W * 0.6) || inside(moved, a + W * 0.6)) block[j][k] = 1;
      }
    }
  }
  const here = Math.floor((((s.a % TAU) + TAU) % TAU) / W) % B;
  let way = route(block, here, SPEEDS[0]);
  for (let i = 1; i < SPEEDS.length && way.depth < STEPS; i++) way = route(block, here, SPEEDS[i]);
  let d = way.bin - here;
  if (d > B / 2) d -= B;
  if (d < -B / 2) d += B;
  return { dir: d > 0 ? 1 : d < 0 ? -1 : 0 };
}

/** Where to be a step from now, from how long each bin lasts, worked back from the horizon. */
function route(block: Uint8Array[], here: number, reach: number) {
  let next = new Int16Array(B).map((_, b) => (block[STEPS][b] ? STEPS - 1 : STEPS));
  let cur = new Int16Array(B);
  for (let j = STEPS - 1; j >= 1; j--) {
    for (let b = 0; b < B; b++) cur[b] = block[j][b] ? j - 1 : best(next, block[j], block[j + 1], b, reach).depth;
    [next, cur] = [cur, next];
  }
  return best(next, block[0], block[1], here, reach);
}

/** The deepest bin reachable from b within one step's turn, not crossing a blocked one; the nearest among equals. */
function best(depth: Int16Array, nowBlock: Uint8Array, thenBlock: Uint8Array, b: number, reach: number) {
  let top = depth[b], bin = b;
  for (const way of [1, -1]) {
    for (let i = 1; i <= reach; i++) {
      const k = (b + way * i + B) % B;
      if (nowBlock[k] || thenBlock[k]) break;
      if (depth[k] > top) { top = depth[k]; bin = k; }
    }
  }
  return { depth: top, bin };
}

/** Plays a run forward with the bot for `seconds` (or to its end); answers the state. */
export function play(s: State, seconds: number) {
  const end = s.t + seconds;
  let inp: Input = { dir: 0 }, t = -1;
  while (!s.dead && s.t < end) {
    if (s.t - t >= EVERY) { inp = decide(s); t = s.t; }
    step(s, inp);
    s.events.length = 0;
  }
  return s;
}
