// Snake II as the Nokia 3310 (firmware v6.07) plays it: the rules, pure and
// deterministic. Every fact here was read off the real firmware running in
// a DCT3 emulator (docs in README.md, "How it was measured"); the replays in
// host/test/extensions/snake.test.ts feed the emulator's recorded key
// presses through this file and compare every frame.
//
// Time is in the firmware's game unit `u` (8 ms on a real phone): a step is
// STEP[level - 1] units. A key is a key-down at a time; it reaches the game
// LATENCY units later (the keypad scan), which is why a key pressed within
// about 18 ms of a step waits for the next one.
//
// Only the last valid key before a step counts; the snake turns at most
// once per step; a key opposite to the direction it last moved is dropped
// (not queued); a key in the direction it is going cancels a pending turn.
// A blocked step takes its turn without moving and is tried again GRACE
// later: a key in between is judged against that turn.
//
// EXTRA, not the firmware: with `queue` on (the `queue_turns` setting, on
// by default; off in the replays, which stay firmware-exact) a quick second
// key the firmware would lose waits one step instead. See `steer`.
//
// The board is 20 by 9 cells, row-major (`c = y * 20 + x`), and wraps at
// every edge a maze leaves open.

export const W = 20, H = 9, CELLS = W * H;
/** Step time per level 1..9, in units. */
export const STEP = [82, 60, 47, 37, 28, 22, 17, 13, 11];
/**
 * From a blocked step to its re-check, at every level: the firmware's 11-unit wait plus its timer's slack, as the
 * emulator's frames and death tones place it (12.45 at level 1, about 11.8 at level 9; this value keeps every
 * recorded save and crash at both).
 */
export const GRACE = 12.3;
/** Keypad scan: a key-down reaches the game this many units later (a key 25 ms before a step makes it, 15 ms does not). */
export const LATENCY = 2.3;
/** A bonus creature's countdown, shown on the step it appears. */
export const BONUS_LIFE = 20;
/** Every how many foods a bonus creature comes, counting only the foods eaten while none is on screen. */
export const BONUS_EVERY = 5;

/** 0 up, 1 right, 2 down, 3 left: clockwise, so +1 turns right. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
export const opposite = (d: Dir) => ((d + 2) % 4) as Dir;

/** The phone's keys: the digits, `*`, `#`, the scroll keys, the left soft key (`menu`: Menu, Select, OK, More) and C. */
export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "*" | "#" | "up" | "down" | "menu" | "c";

// ---- the random numbers --------------------------------------------------------------------------------

/** The firmware's rand(): a power-on seed of 1, never reseeded; each call returns the next seed. */
export const nextSeed = (seed: number) => (seed * 0x625f + 0x3623) % 0xfff1;

// ---- mazes ---------------------------------------------------------------------------------------------

/** The five mazes, `#` a wall; "No maze" is none. */
export const MAZES: string[][] = [
  [],
  ["####################", "#..................#", "#..................#", "#..................#", "#..................#", "#..................#", "#..................#", "#..................#", "####################"],
  ["##................##", "#..................#", "....................", "........#####.......", "....................", "........#####.......", "....................", "#..................#", "##................##"],
  ["........#...........", "........#...........", "........#..#########", "........#...........", "........#...#.......", "............#.......", "##########..#.......", "............#.......", "............#......."],
  ["####################", "#..................#", "#......#.....#.....#", "#......#.....#.....#", ".......#.....#......", "#......#.....#.....#", "#......#.....#.....#", "#..................#", "####################"],
  ["###..############...", "#.......#...........", "........#...........", "#########..#########", "....................", "....................", "####################", "...........#........", "...........#........"],
];
/** Where the 7-cell snake starts (its tail cell; it runs right to the head) per maze. */
export const STARTS: [number, number][] = [[5, 4], [5, 4], [1, 4], [1, 5], [5, 7], [5, 4]];
export const START_LEN = 7;

const wallCache: boolean[][] = [];
export function walls(maze: number): boolean[] {
  return (wallCache[maze] ??= Array.from({ length: CELLS }, (_, c) => MAZES[maze][Math.floor(c / W)]?.[c % W] === "#"));
}
export const cell = (x: number, y: number) => y * W + x;
export const step1 = (c: number, d: Dir) => cell((c % W + DX[d] + W) % W, (Math.floor(c / W) + DY[d] + H) % H);

// ---- the game ------------------------------------------------------------------------------------------

/** A snake cell: where, the direction the head moved to enter it, and whether food went down there (the bulge). */
export type Seg = { c: number; d: Dir; fat?: boolean };
export type Bonus = { c: number; kind: number; left: number };

export type Game = {
  level: number;
  maze: number;
  /** Head first. */
  snake: Seg[];
  /** The direction of the last move, and the turn waiting for the next step (null: none). */
  dir: Dir;
  want: Dir | null;
  /** EXTRA, not the firmware: the second turn a `queue` steer keeps for the step after `want`'s. */
  next?: Dir | null;
  food: number;
  bonus: Bonus | null;
  /** Foods eaten while no bonus creature was on screen (the count the next creature waits for). */
  eaten: number;
  score: number;
  /** Steps the tail still holds. */
  grow: number;
  /** When the next step (or the grace's re-check) is due. */
  due: number;
  /** A blocked step is waiting out the grace. */
  grace: boolean;
  /** The snake hit something (the game stays for its blink, and for Continue when paused then). */
  dead?: boolean;
};

/** A thing that happened, for the page to sound or show. */
export type Event = { t: number; kind: "eat" | "die" };

function occupied(g: Game): boolean[] {
  const occ = walls(g.maze).slice();
  for (const s of g.snake) occ[s.c] = true;
  return occ;
}

/** rand() once, advancing the seed held in `rng`. */
type Rng = { seed: number };
const rand = (r: Rng) => (r.seed = nextSeed(r.seed));

/** The food: up to 100 draws of `x = rand() % 20, y = rand() % 9`, never on the snake or a wall, nor in a bonus's row or columns; then the first free cell. */
export function placeFood(g: Game, r: Rng): number {
  const occ = occupied(g);
  const b = g.bonus;
  for (let i = 0; i < 100; i++) {
    const x = rand(r) % W, y = rand(r) % H;
    if (occ[cell(x, y)]) continue;
    if (b && (y === Math.floor(b.c / W) || x === b.c % W || x === b.c % W + 1)) continue;
    return cell(x, y);
  }
  // The firmware's fallback scans for a free cell (0x27181A); never reached in play.
  const free = occ.findIndex((o, c) => !o && c !== g.food);
  return free;
}

/**
 * The bonus creature (0x2719EC): `rand() % 50` first (a 2 by 2 creature's branch, never seen), then up to 100 draws of
 * `x = rand() % 19, y = rand() % 9`, two free cells outside the food's row and columns, then `rand() % 6` for which
 * creature (lcd.ts CREATURES), drawn whether a place was found or not.
 */
export function placeBonus(g: Game, r: Rng): Bonus | null {
  rand(r);
  const occ = occupied(g);
  const fx = g.food % W, fy = Math.floor(g.food / W);
  let at = -1;
  for (let i = 0; i < 100 && at < 0; i++) {
    const x = rand(r) % (W - 1), y = rand(r) % H;
    if (occ[cell(x, y)] || occ[cell(x + 1, y)]) continue;
    if (g.food >= 0 && (y === fy || x === fx || x + 1 === fx)) continue;
    at = cell(x, y);
  }
  const kind = rand(r) % 6;
  return at < 0 ? null : { c: at, kind, left: BONUS_LIFE };
}

export function newGame(level: number, maze: number, r: Rng, t: number): Game {
  const [x0, y0] = STARTS[maze];
  const snake: Seg[] = [];
  for (let i = START_LEN - 1; i >= 0; i--) snake.push({ c: cell(x0 + i, y0), d: 1 });
  const g: Game = { level, maze, snake, dir: 1, want: null, food: -1, bonus: null, eaten: 0, score: 0, grow: 0, due: t + STEP[level - 1], grace: false };
  g.food = placeFood(g, r);
  return g;
}

/** A key during play, as it reaches the game: sets or cancels the turn for the next step. */
export function steer(g: Game, k: Key, queue = false) {
  const d = g.dir;
  let to: Dir | null = null;
  switch (k) {
    case "2": to = 0; break;
    case "6": to = 1; break;
    case "8": to = 2; break;
    case "4": to = 3; break;
    // The diagonals take the part across the way the snake goes.
    case "1": to = d % 2 ? 0 : 3; break;
    case "3": to = d % 2 ? 0 : 1; break;
    case "7": to = d % 2 ? 2 : 3; break;
    case "9": to = d % 2 ? 2 : 1; break;
    case "*": case "up": to = ((d + 3) % 4) as Dir; break;
    case "#": case "down": to = ((d + 1) % 4) as Dir; break;
    default: return;
  }
  // EXTRA, not the firmware: with a turn pending, the key the firmware would drop (a reversal of the way the snake
  // last moved) or treat as cancelling the turn (the way it is going) waits for the step after, when it is a turn from
  // the pending one: moving right, up then left turns up, then left. The firmware loses the left (spec §6, i2 and i4).
  if (queue && g.want !== null && (to === opposite(d) || to === d) && to !== opposite(g.want)) {
    g.next = to;
    return;
  }
  if (to === opposite(d)) return;
  g.want = to === d ? null : to;
  g.next = null;
}

/** Whether the head may enter `c` on this step: not a wall, not the body, except the tail's cell when the tail moves on. */
function blocked(g: Game, c: number): boolean {
  if (walls(g.maze)[c]) return true;
  const n = g.snake.length;
  for (let i = 0; i < n; i++) if (g.snake[i].c === c) return !(i === n - 1 && g.grow === 0);
  return false;
}

/** The step (or the grace's re-check) due at `g.due`. Returns false when the snake died. */
export function step(g: Game, r: Rng, ev: Event[]): boolean {
  const t = g.due;
  const d = g.want ?? g.dir;
  const head = g.snake[0].c;
  const next = step1(head, d);
  if (blocked(g, next)) {
    if (!g.grace) {
      // The turn is taken though the snake stays: a key in the grace is judged against it (reversing it is dropped).
      g.dir = d;
      g.want = g.next ?? null; // EXTRA: a queued turn (`steer`); null on the firmware's path
      g.next = null;
      g.grace = true;
      g.due = t + GRACE;
      return true;
    }
    ev.push({ t, kind: "die" });
    return false;
  }
  g.grace = false;
  g.dir = d;
  g.want = g.next ?? null; // EXTRA: a queued turn (`steer`); null on the firmware's path
  g.next = null;
  g.snake.unshift({ c: next, d });
  if (g.grow > 0) g.grow--;
  else g.snake.pop();
  const b = g.bonus;
  if (b && (next === b.c || next === b.c + 1)) {
    g.score += 5 * g.level + 5 + 2 * b.left;
    g.bonus = null;
    // Swallowed: the bulge, though the snake does not grow.
    g.snake[0].fat = true;
    ev.push({ t, kind: "eat" });
  } else if (b) {
    if (--b.left === 0) g.bonus = null;
  }
  if (next === g.food) {
    g.score += g.level;
    g.grow++;
    g.snake[0].fat = true;
    ev.push({ t, kind: "eat" });
    g.food = placeFood(g, r);
    if (!g.bonus && ++g.eaten % BONUS_EVERY === 0) g.bonus = placeBonus(g, r);
  }
  g.due = t + STEP[g.level - 1];
  return true;
}
