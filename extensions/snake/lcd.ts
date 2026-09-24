// The 84 by 48 one-bit screen, drawn as the phone draws it: `Lcd` is one
// byte per pixel (1 dark), row-major. The in-game sprites are the
// firmware's 4 by 4 cell patterns (hex, rows top first, the high bit the
// left pixel); every screen outside the game is composed from bitmaps cut
// out of the firmware's own frames (bitmaps.ts).
import { CELLS, W, step1, walls, type Dir, type Game } from "./game.ts";
import { cup, digits, fireworks, gameover, instructions, labels, level, notes, small, soft, splash, tick, topgameover, topscore, type Bitmap } from "./bitmaps.ts";
import { BLINK, BLINK_AT, BLINKS, FIREWORKS_AT, MAZE_NAMES, menuItems, type List, type Phone } from "./phone.ts";

export const LCD_W = 84, LCD_H = 48;
export type Lcd = Uint8Array;
export const blank = (): Lcd => new Uint8Array(LCD_W * LCD_H);

export function set(s: Lcd, x: number, y: number, on = 1) {
  if (x >= 0 && x < LCD_W && y >= 0 && y < LCD_H) s[y * LCD_W + x] = on;
}
export function rect(s: Lcd, x0: number, y0: number, x1: number, y1: number, on = 1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(s, x, y, on);
}
/** A 4-wide pattern: `rows` nibbles, top first. */
function nibbles(s: Lcd, x: number, y: number, hex: number, rows = 4) {
  for (let r = 0; r < rows; r++) {
    const n = (hex >> (4 * (rows - 1 - r))) & 15;
    for (let b = 0; b < 4; b++) if (n & (8 >> b)) set(s, x + b, y + r);
  }
}

// ---- the game's sprites ------------------------------------------------------------------------------------

/** By direction: up, right, down, left. */
const HEAD = [0x066a, 0x86e0, 0xa660, 0x1670];
const MOUTH = [0x096a, 0xa4c2, 0xa690, 0x5234];
const BODY = [0x6246, 0x0db0, 0x6426, 0x0bd0];
const TAIL = [0x6622, 0x03f0, 0x2266, 0x0cf0];
/** A straight cell with food in it: up and left one, right and down the other. */
const FAT = [0x6bd6, 0x6db6, 0x6db6, 0x6bd6];
/** Corners by the two sides they join, as a bit set: 1 top, 2 right, 4 bottom, 8 left. */
const CORNER: Record<number, [number, number]> = { 9: [0x6ac0, 0xeac0], 3: [0x6530, 0x7530], 12: [0x0ca6, 0x0cae], 6: [0x0356, 0x0357] };
const FOOD = 0x4a40;
/** The six bonus creatures, 8 by 4 (the left cell's pattern, then the right's), in the firmware's table order (0x326628): a bonus is `rand() % 6` into it. */
const CREATURES: [number, number][] = [
  [0xcc30, 0x4efa], [0x09b7, 0xcaef], [0x3fba, 0xcfd5], [0x35f3, 0x0aec], [0x5bf2, 0x4ef4], [0x08f5, 0x00f5],
];
/** The 3 by 5 score digits, rows top first. */
const DIGITS = ["####.##.##.####", ".#.##..#..#..#.", "###..#####..###", "###..####..####", "#.##.####..#..#", "####..###..####", "####..####.####", "###..#.#..#..#.", "####.#####.####", "####.####..####"];

function digit(s: Lcd, x: number, y: number, n: number) {
  const g = DIGITS[n];
  for (let i = 0; i < 15; i++) if (g[i] === "#") set(s, x + (i % 3), y + Math.floor(i / 3));
}
const cellXY = (c: number): [number, number] => [2 + 4 * (c % W), 10 + 4 * Math.floor(c / W)];
const side = (d: Dir) => 1 << d;

/** The walls: 2-pixel lines through each wall cell's middle, joined to the wall cells beside it (not across the wrap). */
function drawWalls(s: Lcd, maze: number) {
  const wall = walls(maze);
  for (let c = 0; c < CELLS; c++) {
    if (!wall[c]) continue;
    const [x, y] = cellXY(c);
    const cx = c % W, cy = Math.floor(c / W);
    rect(s, x + 1, y + 1, x + 2, y + 2);
    if (cx < W - 1 && wall[c + 1]) rect(s, x + 3, y + 1, x + 4, y + 2);
    if (cy < 8 && wall[c + W]) rect(s, x + 1, y + 3, x + 2, y + 4);
  }
}

/** The play screen: the score, a bonus's creature and countdown, the frame, the maze, the food, the bonus and the snake (`shown` false: blinked off). */
export function drawGame(s: Lcd, g: Game, shown = true) {
  const sc = String(Math.min(g.score, 9999)).padStart(4, "0");
  for (let i = 0; i < 4; i++) digit(s, 1 + 4 * i, 0, Number(sc[i]));
  if (g.bonus) {
    const [l, r] = CREATURES[g.bonus.kind];
    nibbles(s, 66, 1, l);
    nibbles(s, 70, 1, r);
    digit(s, 76, 0, Math.floor(g.bonus.left / 10));
    digit(s, 80, 0, g.bonus.left % 10);
  }
  rect(s, 0, 6, 83, 6);
  rect(s, 0, 8, 83, 8);
  rect(s, 0, 47, 83, 47);
  rect(s, 0, 9, 0, 46);
  rect(s, 83, 9, 83, 46);
  drawWalls(s, g.maze);
  if (g.food >= 0) nibbles(s, ...cellXY(g.food), FOOD);
  if (g.bonus) {
    const [l, r] = CREATURES[g.bonus.kind];
    nibbles(s, ...cellXY(g.bonus.c), l);
    nibbles(s, ...cellXY(g.bonus.c + 1), r);
  }
  if (shown) drawSnake(s, g);
}

function drawSnake(s: Lcd, g: Game) {
  const sn = g.snake, n = sn.length;
  for (let i = n - 1; i >= 0; i--) {
    const seg = sn[i];
    const [x, y] = cellXY(seg.c);
    let pat: number;
    if (i === 0) {
      const ahead = step1(seg.c, seg.d);
      const b = g.bonus;
      pat = (ahead === g.food || (b && (ahead === b.c || ahead === b.c + 1)) ? MOUTH : HEAD)[seg.d];
    } else if (i === n - 1) pat = TAIL[sn[i - 1].d];
    else {
      const out = sn[i - 1].d;
      if (out === seg.d) pat = seg.fat ? FAT[out] : BODY[out];
      else pat = CORNER[side(((seg.d + 2) % 4) as Dir) | side(out)][seg.fat ? 1 : 0];
    }
    nibbles(s, x, y, pat);
  }
}

// ---- everything else: the firmware's bitmaps -------------------------------------------------------------

const bitsCache = new Map<string, Uint8Array>();
function bits(b64: string): Uint8Array {
  let b = bitsCache.get(b64);
  if (!b) bitsCache.set(b64, (b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  return b;
}
/** A bitmap's dark pixels onto the screen, at its own place or at (x, y). */
function blit(s: Lcd, [bx, by, w, h, b64]: Bitmap, x = bx, y = by) {
  const b = bits(b64);
  for (let i = 0; i < w * h; i++) if (b[i >> 3] & (0x80 >> (i & 7))) set(s, x + (i % w), y + Math.floor(i / w));
}
function invert(s: Lcd, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s[y * LCD_W + x] ^= 1;
}
/** The frame of an animation `since` units in: [start, bitmap] pairs in order. */
const frameAt = (clip: [number, Bitmap][], since: number) => clip.reduce((cur, f) => (f[0] <= since ? f : cur), clip[0])[1];

/** A number in the large digits, from x 0. */
function big(s: Lcd, n: number, y: number) {
  String(n).split("").forEach((d, i) => blit(s, [0, 0, 7, 11, digits[Number(d)]], 8 * i, y));
}

/** A three-row list with the phone's chrome: the path top right, the selected row inverted, the scroll bar, the soft key. */
function list(s: Lcd, items: string[], l: List, path: string, key: string) {
  const n = items.length;
  let x = 84;
  for (const c of [...path].reverse()) {
    const w = c === "-" ? 2 : 5;
    blit(s, [0, 0, w, 6, small[c]], (x -= w + 1), 0);
  }
  for (let r = 0; r < 3; r++) {
    const i = (l.top + r) % n, y = 7 + 10 * r;
    blit(s, [0, 0, 78, 10, labels[items[i]]], 0, y);
    if (i === l.sel) invert(s, 0, y, 77, y + 9);
  }
  // The bar: a line with a 7-row thumb bulging right, its top 23 rows apart from first to last.
  const ty = 7 + Math.floor((l.sel * 23) / (n - 1));
  for (let y = 7; y <= 36; y++) set(s, 81, y, y > ty && y < ty + 6 ? 0 : 1);
  set(s, 82, ty);
  set(s, 82, ty + 6);
  for (let y = ty + 1; y < ty + 6; y++) set(s, 83, y);
  blit(s, soft[key]);
}

/** What the screen shows at `ph.t`. */
export function frame(ph: Phone): Lcd {
  if (ph.hold && ph.t < ph.hold.until) ph = { ...ph, ...ph.hold, hold: null };
  const s = blank(), sc = ph.screen, t = ph.t;
  switch (sc.id) {
    case "splash":
      blit(s, frameAt(splash.slice(0, -1), t - sc.at));
      break;
    case "menu":
      list(s, menuItems(ph), ph.list, `8-1-${ph.list.sel + 1}`, "Select");
      break;
    case "mazes":
      list(s, MAZE_NAMES, sc.list, `8-1-${menuItems(ph).indexOf("Mazes") + 1}-${sc.list.sel + 1}`, "OK");
      break;
    case "level":
      blit(s, level);
      for (let i = 1; i < sc.bars; i++) rect(s, 5 + 8 * i, 29 - 2 * i, 8 + 8 * i, 34);
      break;
    case "note":
      blit(s, notes[sc.maze]);
      blit(s, frameAt(tick, t - sc.at));
      break;
    case "top":
      blit(s, topscore);
      big(s, ph.best, 18);
      blit(s, frameAt(cup, t - sc.at));
      break;
    case "instr":
      blit(s, instructions[sc.page]);
      break;
    case "play":
    case "frozen":
      drawGame(s, ph.game!);
      break;
    case "dying": {
      const since = t - sc.at;
      if (sc.best && since >= FIREWORKS_AT) blit(s, frameAt(fireworks, since - FIREWORKS_AT));
      else {
        const phase = Math.floor((since - BLINK_AT) / BLINK);
        drawGame(s, ph.game!, since < BLINK_AT || (phase < BLINKS && phase % 2 === 1));
      }
      break;
    }
    case "over":
      blit(s, sc.best ? topgameover : gameover);
      big(s, ph.game?.score ?? 0, 33);
      break;
  }
  return s;
}
