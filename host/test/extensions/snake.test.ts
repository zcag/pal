// Snake II: the rules (game.ts), the phone around them (phone.ts) and the
// pixels (lcd.ts) against the real Nokia 3310 firmware. The numbers in the
// first tests are the firmware's (the spec's, and what the emulator showed);
// the replays then play 123 runs recorded from the firmware in the DCT3
// emulator (snake-emulator.fixture.json: menus, every level and maze, bonus
// creatures, the collision grace, pauses, deaths, top scores, held keys)
// and compare every frame, the buzzer and the backlight. Last, the extension
// over the wire: a view palette whose body is its surface page.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CELLS, GRACE, MAZES, STARTS, STEP, W, cell, newGame, nextSeed, placeFood, step, steer, walls, type Dir, type Event, type Game, type Key } from "../../../extensions/snake/game.ts";
import { blank, drawGame, frame } from "../../../extensions/snake/lcd.ts";
import { advance, boot, gone, isMemory, memory, menuItems, press, type Phone } from "../../../extensions/snake/phone.ts";
import { hz, TONES } from "../../../extensions/snake/tones.ts";
import type { View } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";
import { replay, type Run } from "./snake-replay.ts";

const RUNS: Record<string, Run> = JSON.parse(readFileSync(`${import.meta.dir}/snake-emulator.fixture.json`, "utf8")).runs;

/** A game in play at `level`, and the seed it leaves. */
function play(level = 1, maze = 0, seed = 1) {
  const r = { seed };
  const g = newGame(level, maze, r, 0);
  return { g, r };
}
/** The game's steps until `n` have been taken (each at its due time), keys pressed before them. */
function run(g: Game, r: { seed: number }, n: number, keys: Record<number, Key> = {}): Event[] {
  const ev: Event[] = [];
  for (let i = 0; i < n; i++) {
    if (keys[i]) steer(g, keys[i]);
    if (!step(g, r, ev)) break;
  }
  return ev;
}
const headXY = (g: Game) => [g.snake[0].c % W, Math.floor(g.snake[0].c / W)];

describe("the rules", () => {
  test("the step times, level 1 to 9, in 8 ms units", () => {
    expect(STEP).toEqual([82, 60, 47, 37, 28, 22, 17, 13, 11]);
    expect(STEP.map((u) => u * 8)).toEqual([656, 480, 376, 296, 224, 176, 136, 104, 88]);
  });
  test("rand(): the power-on seed 1, and the first food of a power-on at (2, 5)", () => {
    expect(nextSeed(1)).toBe(39042);
    expect(nextSeed(39042)).toBe(419);
    const { g } = play();
    expect([g.food % W, Math.floor(g.food / W)]).toEqual([2, 5]);
  });
  test("the food sequence the firmware drew for level 1 on the same moves", () => {
    // The draws from seed 1, with nothing in the way: the first two foods of a power-on as the spec recorded them.
    const g: Game = { ...play().g, snake: [{ c: cell(19, 8), d: 1 }] };
    const r = { seed: 1 };
    const seen = [placeFood(g, r), placeFood(g, r), placeFood(g, r)].map((c) => [c % W, Math.floor(c / W)]);
    expect(seen).toEqual([[2, 5], [15, 2], [3, 6]]);
  });
  test("the start: 7 cells, head right, per maze", () => {
    expect(STARTS).toEqual([[5, 4], [5, 4], [1, 4], [1, 5], [5, 7], [5, 4]]);
    for (let m = 0; m <= 5; m++) {
      const { g } = play(1, m);
      expect(g.snake).toHaveLength(7);
      expect(headXY(g)).toEqual([STARTS[m][0] + 6, STARTS[m][1]]);
      expect(g.snake.every((s) => !walls(m)[s.c])).toBe(true);
    }
    expect(MAZES.slice(1).map((m) => m.join("").split("#").length - 1)).toEqual([54, 22, 29, 62, 58]);
  });
  test("the keys: a reversal is dropped, the same way cancels a turn, the last before the step wins", () => {
    let { g, r } = play();
    steer(g, "4");
    expect(g.want).toBeNull();
    steer(g, "8");
    steer(g, "6");
    expect(g.want).toBeNull();
    steer(g, "8");
    steer(g, "4");
    steer(g, "2");
    expect(g.want).toBe(0);
    // The diagonals take the part across the way the snake goes; * and # turn left and right; 5 and 0 do nothing.
    ({ g, r } = play());
    for (const [k, want] of [["1", 0], ["3", 0], ["7", 2], ["9", 2], ["*", 0], ["up", 0], ["#", 2], ["down", 2]] as [Key, Dir][]) {
      steer(g, k);
      expect(g.want).toBe(want);
    }
    steer(g, "5");
    steer(g, "0");
    expect(g.want).toBe(2);
    run(g, r, 1);
    expect(g.dir).toBe(2);
  });
  test("growing: the tail holds on the step after the eating one; the bulge rides with the cell", () => {
    const { g, r } = play();
    g.food = cell(12, 4);
    run(g, r, 1);
    expect(g.score).toBe(1);
    expect(g.snake).toHaveLength(7);
    expect(g.snake[0].fat).toBe(true);
    run(g, r, 1);
    expect(g.snake).toHaveLength(8);
    expect(g.snake[1].fat).toBe(true);
  });
  test("food is worth the level; a bonus comes every fifth food eaten with none on screen, worth 5L + 5 + 2t, and does not grow the snake", () => {
    const { g, r } = play(7);
    for (let i = 0; i < 5; i++) {
      g.food = step1Ahead(g);
      run(g, r, 1);
    }
    expect(g.score).toBe(35);
    expect(g.bonus?.left).toBe(20);
    run(g, r, 3);
    expect(g.bonus?.left).toBe(17);
    const len = g.snake.length;
    // The head into the bonus: 5 * 7 + 5 + 2 * 17.
    g.bonus!.c = step1Ahead(g);
    const before = g.score;
    run(g, r, 1);
    expect(g.score - before).toBe(74);
    expect(g.bonus).toBeNull();
    expect(g.snake.length).toBe(len);
  });
  test("a bonus lives 20 steps", () => {
    const { g, r } = play();
    g.bonus = { c: cell(0, 0), kind: 0, left: 20 };
    run(g, r, 19);
    expect(g.bonus.left).toBe(1);
    run(g, r, 1);
    expect(g.bonus).toBeNull();
  });
  test("the grace: a blocked step waits, a turn in it saves the snake, a reversal of the blocked turn does not", () => {
    // Up, left, then down: into the body.
    let { g, r } = play();
    run(g, r, 2, { 0: "2", 1: "4" });
    steer(g, "8");
    const ev: Event[] = [];
    const due = g.due;
    expect(step(g, r, ev)).toBe(true);
    expect(g.grace).toBe(true);
    expect(g.due).toBe(due + GRACE);
    steer(g, "4");
    expect(step(g, r, ev)).toBe(true);
    expect(g.grace).toBe(false);
    ({ g, r } = play());
    run(g, r, 2, { 0: "2", 1: "4" });
    steer(g, "8");
    step(g, r, []);
    steer(g, "2");
    expect(g.want).toBeNull();
    expect(step(g, r, ev)).toBe(false);
    expect(ev.at(-1)?.kind).toBe("die");
  });
  test("the tail's cell is free when the tail moves on", () => {
    const { g, r } = play();
    g.snake = [cell(1, 1), cell(2, 1), cell(2, 2), cell(1, 2)].map((c, i) => ({ c, d: ([3, 0, 1, 1] as const)[i] }));
    g.dir = 3;
    steer(g, "8");
    expect(run(g, r, 1).some((e) => e.kind === "die")).toBe(false);
    expect(g.grace).toBe(false);
  });
  test("the screen: score, frame, food, snake; 20 by 9 cells of 4 pixels", () => {
    const s = blank();
    drawGame(s, play().g);
    const row = (y: number) => Array.from(s.subarray(y * 84, y * 84 + 84)).map((v) => (v ? "#" : ".")).join("");
    expect(row(0).slice(0, 17)).toBe(".###.###.###.###.");
    expect(row(6)).toBe("#".repeat(84));
    expect(row(8)).toBe("#".repeat(84));
    expect(row(47)).toBe("#".repeat(84));
    expect(CELLS).toBe(180);
  });
  test("the tones: 13 MHz over the divider", () => {
    expect([4930, 29545, 22147, 14773].map((d) => Math.round(hz(d)))).toEqual([2637, 440, 587, 880]);
    expect(TONES.jingle.map((n) => n[2])).toEqual([22147, 22147, 22147, 14773, 22147, 14773]);
  });
});

/** The food one cell ahead of the head. */
function step1Ahead(g: Game) {
  const [x, y] = headXY(g);
  return cell((x + [0, 1, 0, -1][g.dir] + W) % W, (y + [-1, 0, 1, 0][g.dir] + 9) % 9);
}

describe("EXTRA, not the firmware: queue_turns", () => {
  // Moving right from the start: 2 then 4 within one step.
  const quick = (queue: boolean, first: Key, second: Key, dir: Dir = 1) => {
    const { g, r } = play();
    g.dir = dir;
    steer(g, first, queue);
    steer(g, second, queue);
    const ev: Event[] = [];
    step(g, r, ev);
    const after1 = g.dir;
    step(g, r, ev);
    return [after1, g.dir];
  };
  test("off, the firmware: up then left while moving right turns up and loses the left", () => {
    expect(quick(false, "2", "4")).toEqual([0, 0]);
  });
  test("on: up then left while moving right turns up, then left on the next step", () => {
    expect(quick(true, "2", "4")).toEqual([0, 3]);
  });
  test("on: up then left while moving left (the firmware's cancel) turns up, then left", () => {
    expect(quick(false, "2", "4", 3)).toEqual([3, 3]);
    expect(quick(true, "2", "4", 3)).toEqual([0, 3]);
  });
  test("on, what the firmware keeps is unchanged: down then up turns up; a key across the way it moves replaces the pending turn", () => {
    expect(quick(true, "8", "2")).toEqual([0, 0]);
    const { g } = play();
    steer(g, "2", true);
    steer(g, "8", true);
    expect([g.want, g.next ?? null]).toEqual([2, null]);
  });
});

describe("the phone", () => {
  const at = (ph: Phone, keys: [Key, number][]) => {
    for (const [k, t] of keys) press(ph, k, t);
  };
  test("the splash, then the menu; Continue after a pause; the menu's list wraps", () => {
    const ph = boot(0);
    advance(ph, 400);
    expect(ph.screen.id).toBe("menu");
    expect(menuItems(ph)).toEqual(["New game", "Level", "Mazes", "Top score", "Instructions"]);
    at(ph, [["menu", 410], ["c", 500]]);
    advance(ph, 520);
    expect(menuItems(ph)[0]).toBe("Continue");
    at(ph, [["up", 530]]);
    advance(ph, 540);
    expect(ph.list).toEqual({ sel: 5, top: 5 });
  });
  test("a digit on a menu leaves Snake II (the phone's dialer), once the screen has redrawn", () => {
    const ph = boot(0);
    advance(ph, 400);
    press(ph, "5", 400);
    advance(ph, 403);
    expect(gone(ph)).toBe(false);
    advance(ph, 410);
    expect(gone(ph)).toBe(true);
  });
  test("the memory: what is kept, and what a stored one must look like", () => {
    const ph = boot(0, { level: 5, maze: 2, best: 186, seed: 419 });
    expect(memory(ph)).toEqual({ seed: 419, level: 5, maze: 2, best: 186, game: null });
    expect(isMemory(memory(ph))).toBe(true);
    expect(isMemory({ ...memory(ph), level: 10 })).toBe(false);
    expect(isMemory(null)).toBe(false);
  });
  test("the frame is the hold while the firmware redraws", () => {
    const ph = boot(0);
    advance(ph, 400);
    const menu = frame(ph);
    press(ph, "down", 400);
    advance(ph, 405);
    expect(frame(ph)).toEqual(menu);
    advance(ph, 411);
    expect(frame(ph)).not.toEqual(menu);
  });
});

describe("the firmware's runs, frame by frame", () => {
  // Each run's frames in order, each gap between two frames within 11 units (the emulator's own jitter on a long
  // snake's blink, one tick of its OS clock, is up to 10), the tones in order, the backlight's switches in order.
  const names = Object.keys(RUNS);
  test(`${names.length} runs`, () => {
    expect(names.length).toBeGreaterThanOrEqual(120);
  });
  for (const name of names) {
    test(name, () => {
      const r = replay(RUNS[name]);
      if (r.mismatch >= 0) throw new Error(`${name}: ${r.diff}`);
      expect(r.frames).toBeGreaterThan(5);
      expect(r.gap).toBeLessThan(11);
      if (r.left) expect(Math.abs(r.left[0] - r.left[1])).toBeLessThan(10);
      expect(r.sounds.model).toEqual(r.sounds.emu);
      expect(r.sounds.dt).toBeLessThan(10);
      expect(r.light.model).toEqual(r.light.emu);
      expect(r.light.dt).toBeLessThan(10);
    });
  }
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette whose body is the surface page, the tones action for cmd+k", async () => {
    const l = host.loaded().find((l) => l.extension === "snake")!;
    expect(l.palettes.map((p) => [p.name, p.view])).toEqual([["snake", "view"]]);
    const v = await host.request<View>("view", { extension: "snake", palette: "snake" });
    expect(v.tree as unknown).toEqual({ type: "surface", src: "surface/index.html" });
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual([["tones", "cmd+t"]]);
  });
  test("a power-on once per host; the tones setting written", async () => {
    const send = (msg: unknown) => host.surfaceSend("snake", "snake", msg);
    expect(await send({ boot: true })).toEqual({ powerOn: true });
    expect(await send({ boot: true })).toEqual({ powerOn: false });
    expect(await send({ tones: false })).toEqual({ tones: false });
  });
});
