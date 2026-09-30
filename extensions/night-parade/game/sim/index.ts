// A night, stepped: `create` a run from a loadout, `step` it at a fixed dt
// with the held keys, answer its cards with `choose`, `reroll`, `skip`,
// `banish` and `resume`. No DOM and no clock of its own: the page drives it
// at 60 steps a second, the bot and the tests as fast as they like, and the
// seed replays a run exactly. The page drains `events` for sound, music,
// banners and screen effects; `fx` and `nums` are for the eye only.
import { DT, hash, type State } from "./core.ts";
import { stepBosses } from "./bosses.ts";
import { stepEnemies, stepFoeShots, stepHazards } from "./enemies.ts";
import { collect, levelUp, move, type Input } from "./progress.ts";
import { settleGroups, spawn } from "./spawn.ts";
import { fireAll, stepShots, stepZones } from "./weapons.ts";

export function step(s: State, input: Input, dt = DT) {
  if (s.phase !== "play") return;
  s.t += dt;
  s.steps++;
  move(s, input, dt);
  spawn(s, dt);
  let g = hash(s.enemies);
  stepEnemies(s, g, dt);
  stepBosses(s, dt);
  g = hash(s.enemies);
  fireAll(s, g, dt);
  stepShots(s, g, dt);
  stepZones(s, g, dt);
  stepFoeShots(s, dt);
  stepHazards(s, dt);
  stepBosses(s, 0); // a boss that just fell gets its ending before it's swept away
  settleGroups(s);
  collect(s, dt);
  for (const f of s.fx) f.t += dt;
  s.fx = s.fx.filter((f) => f.t < f.dur);
  for (const n of s.nums) n.t += dt;
  s.nums = s.nums.filter((n) => n.t < 0.7);
  s.enemies = s.enemies.filter((e) => !e.dead);
  if (s.phase === "play" && s.pending > 0) levelUp(s);
}

export { DT, create, restat, type Choice, type Enemy, type Loadout, type State, type Weapon } from "./core.ts";
export { banish, choose, offers, pairs, reroll, resume, skip, type Input } from "./progress.ts";
export { sickles, spirits } from "./weapons.ts";

export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
