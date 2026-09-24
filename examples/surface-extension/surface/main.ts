// The page: draws the board and takes the keys; the rules are ../game.ts,
// the best run is the extension's (pal.send, surface.post).
import type { SurfaceKit } from "@zcag/pal";
import { centre, goal, H, move, W, type Dir, type Pos } from "../game.ts";

declare const pal: SurfaceKit;

const board = document.getElementById("board")!;
board.style.gridTemplateColumns = `repeat(${W}, auto)`;
const cells = Array.from({ length: W * H }, () => board.appendChild(document.createElement("div")));
let dot: Pos = centre(), ring = goal(dot, Math.random()), steps = 0, best: number | null = null;

const draw = () => {
  cells.forEach((c, i) => { c.className = `cell${i === dot.y * W + dot.x ? " dot" : ""}${i === ring.y * W + ring.x ? " goal" : ""}`; });
  pal.title(`Steps ${steps}${best === null ? "" : ` · best ${best}`}`);
};

const KEYS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
window.addEventListener("keydown", async (e) => {
  const d = KEYS[e.key];
  if (!d) return;
  e.preventDefault();
  dot = move(dot, d);
  steps++;
  if (dot.x === ring.x && dot.y === ring.y) {
    best = ((await pal.send({ reached: steps })) as { best: number }).best;
    ring = goal(dot, Math.random());
    steps = 0;
  }
  draw();
});

pal.on((m) => { if ("best" in m) { best = m.best; draw(); } });
pal.onAction(async (id) => {
  if (id === "centre") { dot = centre(); steps = 0; }
  if (id === "reset") best = ((await pal.send({ reset: true })) as { best: null }).best;
  draw();
});

draw();
pal.ready();
