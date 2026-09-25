// The phone around the game: Snake II's screens and menus as the 3310 runs
// them, pure and deterministic like game.ts. `press(ph, key, t)` is a key-down
// at time t (units), `advance(ph, t)` runs the clock to t, `frame(ph)` (lcd.ts)
// is what the screen shows. Everything below was read off the firmware in the
// emulator; the delays are the firmware's own (a menu redraws about 70 ms after
// a key, the first step comes one step after the game appears).
//
// Snake II is entered from the Games list (opening the view): the splash, then
// its menu. Leaving it (C on its menu, a digit on any of its screens, which on
// the phone opens the dialer) is `screen.id === "gone"`: the page closes the
// view. A paused game survives that, as it does on the phone (Continue is there
// when Snake II is entered again), and so do the level, the maze and the top
// score (the phone keeps them in its memory).
import { STEP, LATENCY, newGame, steer, step, type Event, type Game, type Key } from "./game.ts";

/** A three-row list: the selected item and the item on the top row; both wrap. */
export type List = { sel: number; top: number };

export type Screen =
  | { id: "splash"; at: number }
  | { id: "menu" }
  | { id: "level"; bars: number }
  | { id: "mazes"; list: List }
  | { id: "note"; maze: number; at: number }
  | { id: "top"; at: number }
  | { id: "instr"; page: number }
  | { id: "play" }
  /** Continue chosen: the game drawn still until a key. */
  | { id: "frozen" }
  /** The snake died at `at` (the grace's re-check): the blink, then the fireworks on a new top score. */
  | { id: "dying"; at: number; best: boolean }
  /** "Game over!" and the score ("TOP SCORE:" on a new one) from `at`. */
  | { id: "over"; at: number; best: boolean }
  | { id: "gone" };

export type Sound = { t: number; kind: "eat" | "die" | "jingle" };

export type Phone = {
  t: number;
  /** rand()'s state: 1 at power-on, never reseeded. */
  seed: number;
  level: number;
  maze: number;
  best: number;
  screen: Screen;
  /** The Snake II menu's list; with a paused game it has Continue first. */
  list: List;
  /** The game in play, paused (the menu offers Continue) or dying. */
  game: Game | null;
  /** Keys taking effect at `at` (the keypad scan after the key-down), their screen drawn at `draw`. */
  keys: { at: number; k: Key; draw: number }[];
  /** What the screen still shows while the firmware redraws after a key, until `until`. */
  hold: { until: number; screen: Screen; list: List; game: Game | null } | null;
  /** The backlight, lit by a key outside play; the last time something kept it on, and the origin of its checks. */
  light: boolean;
  lit: number;
  lightGrid: number;
  sounds: Sound[];
  /** EXTRA, not the firmware: steer with game.ts's turn queue (the `queue_turns` setting; the page sets it). */
  queue: boolean;
};

// ---- the clock, in units ---------------------------------------------------------------------------------

/** The splash's frames (bitmaps.ts `splash`) run this long, then the menu. */
export const SPLASH = 334;
/** "Maze N selected" shows this long. */
export const NOTE = 189;
/** The top score screen goes back to the menu on its own after this. */
export const TOP = 754;
/** The death: the snake blinks off, on, ... nine phases of 31 from 3 after the re-check. */
export const BLINK_AT = 1.7, BLINK = 31, BLINKS = 9;
/** Not a new top score: "Game over!" after the last blink, then the menu. */
export const OVER_AT = 267.2, OVER_FOR = 379.5;
/** A new top score: the fireworks (bitmaps.ts `fireworks`), then "Game over! TOP SCORE:". */
export const FIREWORKS_AT = 274.2, TOPTEXT_AT = 642.7, JINGLE_AT = 264.2;
/** The backlight is checked every 256 units (about 2 s) and goes off at the first check 1770 (about 14 s) after the last redraw a key or a timeout made. */
export const LIGHT_TICK = 256, LIGHT_QUIET = 1770;
/** From a key-down to its screen, per screen it lands on. */
const DRAW = { menu: 10, level: 9, bars: 6, list: 8, note: 8, top: 8, instr: 15, instrBack: 25, game: 6, pause: 11, frozen: 6, gone: 6, splash: 15, splashGone: 20 };

export const MENU = ["New game", "Level", "Mazes", "Top score", "Instructions"];
export const menuItems = (ph: Phone) => (ph.game && ph.screen.id !== "gone" ? ["Continue", ...MENU] : MENU);
export const MAZE_NAMES = ["No maze", "Maze 1", "Maze 2", "Maze 3", "Maze 4", "Maze 5"];

/** What the phone keeps between visits (its memory): kept in the extension's storage by the page. */
export type Memory = Pick<Phone, "seed" | "level" | "maze" | "best" | "game">;
export const memory = ({ seed, level, maze, best, game }: Phone): Memory => ({ seed, level, maze, best, game });
/** A stored memory, or undefined for anything this version cannot read. */
export function isMemory(x: unknown): x is Memory {
  const m = x as Memory;
  const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  return !!m && typeof m === "object" && int(m.seed, 0, 0xfff0) && int(m.level, 1, 9) && int(m.maze, 0, 5) && int(m.best, 0, 1e9)
    && (m.game === null || (typeof m.game === "object" && Array.isArray(m.game.snake) && m.game.snake.length > 0));
}

/** A phone with Snake II just entered (the splash): at power-on, or with the memory kept from before. */
export function boot(t: number, saved: Partial<Memory> = {}): Phone {
  return {
    t, seed: saved.seed ?? 1, level: saved.level ?? 1, maze: saved.maze ?? 0, best: saved.best ?? 0,
    screen: { id: "splash", at: t }, list: { sel: 0, top: 0 }, game: saved.game ?? null,
    keys: [], hold: null, light: true, lit: t, lightGrid: t, sounds: [], queue: false,
  };
}

/** A held scroll key repeats outside play: the first repeat this long after the key-down, then every REPEAT_EVERY. */
export const REPEAT_FIRST = 101, REPEAT_EVERY = 62;
export const repeats = (ph: Phone, k: Key) => (k === "up" || k === "down") && !["play", "frozen", "dying", "gone"].includes(ph.screen.id);

/** Snake II has left the screen: C on its menu or a digit (the dialer), once the firmware has redrawn. */
export const gone = (ph: Phone) => ph.screen.id === "gone" && !(ph.hold && ph.t < ph.hold.until);

/** Snake II entered again from the Games list after leaving it: the splash, then its menu (with Continue for a paused game). */
export function enter(ph: Phone, t: number) {
  advance(ph, t);
  Object.assign(ph, { screen: { id: "splash", at: t }, list: { sel: 0, top: 0 }, keys: [], hold: null });
  lightUp(ph, t);
}

// ---- lists ---------------------------------------------------------------------------------------------

const visible = (l: List, n: number) => (l.sel - l.top + n) % n < 3;
function down(l: List, n: number): List {
  const sel = (l.sel + 1) % n;
  return { sel, top: visible({ sel, top: l.top }, n) ? l.top : (sel - 2 + n) % n };
}
function up(l: List, n: number): List {
  const sel = (l.sel - 1 + n) % n;
  return { sel, top: visible({ sel, top: l.top }, n) ? l.top : sel };
}
/** Back on the first item with the rows scrolled on (as the top score screen leaves it). */
const first = (l: List, n: number): List => (visible({ sel: 0, top: l.top }, n) ? { sel: 0, top: l.top } : { sel: 0, top: (n - 2) % n });

// ---- keys ----------------------------------------------------------------------------------------------

const DIGITS = new Set<Key>(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#"]);

/** A key-down at `t`: it acts after the keypad scan, and what it changes shows once the firmware has redrawn. */
export function press(ph: Phone, k: Key, t: number) {
  advance(ph, t);
  const s = ph.screen;
  if (s.id === "gone") return;
  const draw = t + delay(ph, k);
  if (s.id !== "play" && s.id !== "frozen" && s.id !== "dying") lightUp(ph, draw);
  ph.keys.push({ at: t + LATENCY, k, draw });
}

/** When a key's screen shows, by what it does from the screen it was pressed on. */
function delay(ph: Phone, k: Key): number {
  const s = ph.screen;
  const menuKey = k === "menu" || k === "c";
  if (s.id === "splash") return k === "menu" ? DRAW.splash : DRAW.splashGone;
  if (DIGITS.has(k) && s.id !== "play" && s.id !== "frozen" && s.id !== "dying" && s.id !== "over") return DRAW.gone;
  switch (s.id) {
    case "play": return menuKey ? DRAW.pause : LATENCY;
    case "frozen": return LATENCY;
    case "menu": {
      if (k !== "menu") return k === "c" ? DRAW.gone * 2 : DRAW.menu;
      const item = menuItems(ph)[ph.list.sel];
      return item === "Continue" ? DRAW.frozen : item === "New game" ? DRAW.game : item === "Level" ? DRAW.level : item === "Instructions" ? DRAW.instr : DRAW.list;
    }
    case "level": return menuKey ? DRAW.level : DRAW.bars;
    case "mazes": return DRAW.list;
    case "instr": return k === "c" ? DRAW.pause : k === "up" && s.page === 0 ? DRAW.instrBack : DRAW.instr;
    case "top": return DRAW.top;
    case "dying": case "over": return DRAW.pause;
    default: return DRAW.menu;
  }
}

function lightUp(ph: Phone, t: number) {
  ph.light = true;
  ph.lit = t;
}

/** A key taking effect. */
function apply(ph: Phone, k: Key, t: number) {
  const s = ph.screen;
  const digit = DIGITS.has(k);
  switch (s.id) {
    case "splash":
      if (digit) return leave(ph);
      if (k === "c") return leave(ph);
      if (k === "menu") return toMenu(ph);
      return;
    case "menu": {
      const items = menuItems(ph), n = items.length;
      if (digit) return leave(ph);
      if (k === "down") ph.list = down(ph.list, n);
      else if (k === "up") ph.list = up(ph.list, n);
      else if (k === "c") leave(ph);
      else if (k === "menu") open(ph, items[ph.list.sel], t);
      return;
    }
    case "level":
      if (digit) return leave(ph);
      if (k === "up") s.bars = Math.min(9, s.bars + 1);
      else if (k === "down") s.bars = Math.max(1, s.bars - 1);
      else if (k === "menu") {
        // A new level ends a paused game (the same one kept does not).
        if (s.bars !== ph.level) ph.game = null;
        ph.level = s.bars;
        ph.screen = { id: "menu" };
      }
      else if (k === "c") ph.screen = { id: "menu" };
      return;
    case "mazes":
      if (digit) return leave(ph);
      if (k === "down") s.list = down(s.list, 6);
      else if (k === "up") s.list = up(s.list, 6);
      else if (k === "menu") {
        // A maze chosen ends a paused game (Continue goes; the menu keeps its place by number).
        ph.maze = s.list.sel;
        ph.game = null;
        ph.screen = { id: "note", maze: s.list.sel, at: t };
      }
      else if (k === "c") ph.screen = { id: "menu" };
      return;
    case "note":
      if (digit) return leave(ph);
      if (k === "menu" || k === "c") ph.screen = { id: "menu" };
      // The scroll keys wait for the menu the note goes back to.
      else if (k === "up" || k === "down") ph.keys.push({ at: s.at + NOTE + 0.01, k, draw: s.at + NOTE + DRAW.menu - LATENCY });
      return;
    case "top":
      if (digit) return leave(ph);
      ph.screen = { id: "menu" };
      ph.list = first(ph.list, menuItems(ph).length);
      return;
    case "instr":
      if (digit) return leave(ph);
      if (k === "menu" || k === "down") s.page = (s.page + 1) % 4;
      else if (k === "up") s.page = (s.page + 3) % 4;
      else if (k === "c") ph.screen = { id: "menu" };
      return;
    case "play":
      if (k === "menu" || k === "c") return pause(ph, t);
      steer(ph.game!, k, ph.queue);
      return;
    case "frozen": {
      const g = ph.game!;
      // A game paused as it died goes on to "Game over!".
      if (g.dead) return over(ph, t, false);
      ph.screen = { id: "play" };
      if (k !== "menu" && k !== "c") steer(g, k, ph.queue);
      g.due = t + STEP[g.level - 1];
      return;
    }
    case "dying":
      // During the blink the menu keys pause as in play; the fireworks they cut short.
      if (k !== "menu" && k !== "c") return;
      if (t - s.at < BLINK_AT + BLINK * BLINKS) return pause(ph, t);
      lightUp(ph, t);
      return endGame(ph);
    case "over":
      if (k === "menu" || k === "c") endGame(ph);
      return;
  }
}

function leave(ph: Phone) {
  ph.screen = { id: "gone" };
}
function toMenu(ph: Phone) {
  ph.screen = { id: "menu" };
  ph.list = { sel: 0, top: 0 };
}
function pause(ph: Phone, t: number) {
  ph.screen = { id: "menu" };
  ph.list = { sel: 0, top: 0 };
  lightUp(ph, t);
}
function endGame(ph: Phone) {
  ph.game = null;
  toMenu(ph);
}

function open(ph: Phone, item: string, t: number) {
  switch (item) {
    case "Continue":
      ph.screen = { id: "frozen" };
      ph.light = false;
      return;
    case "New game": {
      const r = { seed: ph.seed };
      ph.game = newGame(ph.level, ph.maze, r, t);
      ph.seed = r.seed;
      ph.game.due = t + STEP[ph.level - 1] + 2;
      ph.screen = { id: "play" };
      ph.light = false;
      return;
    }
    case "Level": ph.screen = { id: "level", bars: ph.level }; return;
    case "Mazes": ph.screen = { id: "mazes", list: { sel: ph.maze, top: ph.maze } }; return;
    case "Top score": ph.screen = { id: "top", at: t }; return;
    case "Instructions": ph.screen = { id: "instr", page: 0 }; return;
  }
}

// ---- the clock -----------------------------------------------------------------------------------------

/** The next time something happens on its own, after `ph.t`. */
function nextAt(ph: Phone): number {
  const s = ph.screen;
  let at = Infinity;
  for (const k of ph.keys) at = Math.min(at, k.at);
  if (s.id === "play") at = Math.min(at, ph.game!.due);
  else if (s.id === "splash") at = Math.min(at, s.at + SPLASH);
  else if (s.id === "note") at = Math.min(at, s.at + NOTE);
  else if (s.id === "top") at = Math.min(at, s.at + TOP);
  else if (s.id === "dying") at = Math.min(at, s.at + (s.best ? TOPTEXT_AT : OVER_AT), s.best && !ph.light && ph.t < s.at + JINGLE_AT ? s.at + JINGLE_AT : Infinity);
  else if (s.id === "over") at = Math.min(at, s.at + OVER_FOR);
  if (ph.light) at = Math.min(at, lightOff(ph));
  return at;
}
function lightOff(ph: Phone): number {
  return ph.lightGrid + Math.ceil((ph.lit + LIGHT_QUIET - ph.lightGrid) / LIGHT_TICK) * LIGHT_TICK;
}

/** Run the clock to `t` (never back): keys land, steps step, screens time out. */
export function advance(ph: Phone, t: number) {
  if (t < ph.t) return;
  for (;;) {
    const at = nextAt(ph);
    if (at > t) break;
    ph.t = at;
    const s = ph.screen;
    const i = ph.keys.findIndex((k) => k.at === at);
    if (i >= 0) {
      const [{ k, draw }] = ph.keys.splice(i, 1);
      const before = { screen: structuredClone(ph.screen), list: ph.list, game: structuredClone(ph.game) };
      apply(ph, k, at);
      const changed = JSON.stringify(before) !== JSON.stringify({ screen: ph.screen, list: ph.list, game: ph.game });
      if (changed && draw > at && !(ph.hold && ph.hold.until > at)) ph.hold = { until: draw, ...before };
      continue;
    }
    if (ph.light && at === lightOff(ph)) { ph.light = false; continue; }
    // A new top score lights the screen with its jingle.
    if (s.id === "dying" && s.best && at === s.at + JINGLE_AT) { lightUp(ph, at); continue; }
    switch (s.id) {
      case "play": {
        const g = ph.game!;
        const ev: Event[] = [];
        const r = { seed: ph.seed };
        const alive = step(g, r, ev);
        ph.seed = r.seed;
        for (const e of ev) ph.sounds.push({ t: e.t, kind: e.kind });
        if (!alive) die(ph, at);
        break;
      }
      case "splash": toMenu(ph); lightUp(ph, at); break;
      case "note": ph.screen = { id: "menu" }; break;
      case "top": ph.screen = { id: "menu" }; ph.list = first(ph.list, menuItems(ph).length); break;
      case "dying": over(ph, at, s.best); break;
      case "over": endGame(ph); break;
    }
  }
  ph.t = t;
}

function die(ph: Phone, t: number) {
  const g = ph.game!;
  g.dead = true;
  const best = g.score > ph.best;
  if (best) ph.best = g.score;
  ph.screen = { id: "dying", at: t, best };
  if (best) ph.sounds.push({ t: t + JINGLE_AT, kind: "jingle" });
}
function over(ph: Phone, t: number, best: boolean) {
  ph.screen = { id: "over", at: t, best };
  if (best) ph.sounds.push({ t: t - 3, kind: "jingle" });
  lightUp(ph, t - 3);
}
