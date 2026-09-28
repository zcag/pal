// Writes app/src/gallery/shots/snake.json: the store screenshots' fixture.
// The page keeps the phone's memory in storage (the level, the maze, the top
// score, a paused game, rand()'s state), so each palette seeds one: a game
// from game.ts on the firmware's own rand() (seed 1, as at power-on), played
// by a plain steering loop (the shortest way to the food, else any way out)
// until the board is the one the shot wants, then left paused. The shots
// press what a player would: the splash runs out into the menu, Enter on
// Continue draws the paused game still and unlit (the phone waits for a key),
// or the Top score screen, shot once its cup has come to rest. The phone is
// deterministic and none of it is random. `make shots EXT=snake`.
import { Host } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { W, newGame, step, step1, walls, type Dir, type Game } from "./game.ts";
import type { Memory } from "./phone.ts";
import manifest from "./pal.json" with { type: "json" };

/** The cells the head can still reach from `c`, the body a wall (its tail too while it grows). */
function room(block: boolean[], c: number): number {
  const seen = new Set([c]), queue = [c];
  while (queue.length) {
    const c = queue.shift()!;
    for (const d of [0, 1, 2, 3] as Dir[]) {
      const n = step1(c, d);
      if (!block[n] && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen.size;
}

/** The first move of a shortest way from the head to the food (or the bonus) that leaves room for the snake; else the move with the most room. */
function towards(g: Game, pad: number): Dir {
  const block = walls(g.maze).slice();
  (g.grow ? g.snake : g.snake.slice(0, -1)).forEach((s) => (block[s.c] = true));
  const goal = new Set([g.food, ...(g.bonus ? [g.bonus.c, g.bonus.c + 1] : [])]);
  const head = g.snake[0].c, from = new Map<number, Dir>(), queue: number[] = [];
  const moves = ([0, 1, 2, 3] as Dir[]).filter((d) => d !== (g.dir + 2) % 4 && !block[step1(head, d)]);
  const roomy = moves.filter((d) => room(block, step1(head, d)) > g.snake.length + pad);
  for (const d of roomy) { from.set(step1(head, d), d); queue.push(step1(head, d)); }
  while (queue.length) {
    const c = queue.shift()!;
    if (goal.has(c)) return from.get(c)!;
    for (const d of [0, 1, 2, 3] as Dir[]) {
      const n = step1(c, d);
      if (block[n] || from.has(n) || n === head) continue;
      from.set(n, from.get(c)!);
      queue.push(n);
    }
  }
  return moves.sort((a, b) => room(block, step1(head, b)) - room(block, step1(head, a)))[0] ?? g.dir;
}

/** A game at `level` in `maze`, played from power-on until `want` (the steering's margin tried wider until one gets there); the memory the phone keeps with it paused. */
function play(level: number, maze: number, best: number, want: (g: Game) => boolean): Memory {
  for (let pad = 2; pad < 40; pad++) {
    const r = { seed: 1 };
    const g = newGame(level, maze, r, 0);
    for (let i = 0; i < 20_000; i++) {
      g.want = null;
      const d = towards(g, pad);
      if (d !== g.dir) g.want = d;
      if (!step(g, r, [])) break;
      if (want(g)) return { seed: r.seed, level, maze, best, game: g };
    }
  }
  throw new Error("snake: never reached the shot's board");
}

/** The body in one piece on the screen: no segment wraps round an edge (it may, but a picture of it reads as two snakes). */
const whole = (g: Game) => g.snake.every((s, i) => i === 0 || Math.abs((s.c % W) - (g.snake[i - 1].c % W)) + Math.abs(Math.floor(s.c / W) - Math.floor(g.snake[i - 1].c / W)) === 1);

const BEST = 1_287;
// Level 5, no maze: a long snake, a bonus creature just up with its countdown.
const bonus = play(5, 0, BEST, (g) => g.snake.length >= 18 && !!g.bonus && g.bonus.left >= 12 && whole(g));
// Maze 2 at level 5: the food swallowed rides down the body as bulges.
const maze = play(5, 2, BEST, (g) => g.snake.length >= 16 && g.snake.filter((s) => s.fat).length >= 2 && !g.bonus && whole(g));

pinClock();
const host = await Host.bundled();
try {
  const view = await host.request("view", { extension: "snake", palette: "snake" });
  const palette = (phone: Memory) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { phone }, settings: { tones: true, queue_turns: true } } });
  // The splash runs 334 units (2.7 s) into the menu, from when the page loaded (a second or two after the panel under load); Continue is its first row.
  const menu = ["wait:5500"];
  writeFixture("snake", {
    palettes: { bonus: palette(bonus), maze: palette(maze) },
    shots: {
      "1-play": { palette: "bonus", keys: [...menu, "enter", "wait:800"], caption: "Level 5, a bonus creature up with its countdown at the top right; unlit, as the phone keeps its backlight in play" },
      "2-menu": { palette: "bonus", keys: [...menu, "wait:300"], caption: "The Snake II menu, lit, as the phone draws it: Continue for the game left paused" },
      "3-maze": { palette: "maze", keys: [...menu, "enter", "wait:800"], caption: "Maze 2 at level 5: the bulges of the food swallowed ride down the body" },
      "4-topscore": { palette: "bonus", keys: [...menu, "down*4", "wait:300", "enter", "wait:4600"], caption: "The Top score screen, its coins fallen into the cup" },
    },
  });
  console.log(`snake: bonus game ${bonus.game!.snake.length} long, score ${bonus.game!.score}; maze game ${maze.game!.snake.length} long, ${maze.game!.snake.filter((s) => s.fat).length} bulges`);
} finally {
  host.kill();
}
