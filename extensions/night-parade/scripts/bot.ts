// bun scripts/bot.ts [hero] [seed ...]: the bot plays a night per seed and
// prints each minute and how it ended.
import { describe, night, play } from "../game/bot.ts";
import type { HeroKind } from "../game/content/heroes.ts";
import { clock } from "../game/sim/index.ts";

const args = process.argv.slice(2);
const hero = (isNaN(Number(args[0])) && args[0] ? args.shift() : "kaze") as HeroKind;
const seeds = args.map(Number);
const quiet = process.env.QUIET === "1";
for (const seed of seeds.length ? seeds : [1, 2, 3]) {
  const s = night(seed, hero);
  const t0 = performance.now();
  play(s, (s) => {
    if (quiet || Math.round(s.t) % 60 !== 0) return;
    const alive = s.enemies.filter((e) => !e.prop).length;
    console.log(`${clock(s.t).padStart(5)}  lv ${String(s.p.level).padStart(2)}  hp ${String(Math.round(s.p.hp)).padStart(3)}  foes ${String(alive).padStart(3)}  kills ${String(s.p.kills).padStart(5)}  ${describe(s)}`);
  });
  const ms = performance.now() - t0;
  const dmg = s.weapons.map((w) => `${w.kind} ${Math.round(w.dmg / 1000)}k`).join(", ");
  console.log(`${hero} seed ${seed}: ${s.phase} at ${clock(s.t)}, level ${s.p.level}, ${s.p.kills} kills, ${Math.round(s.p.gold)} gold, bosses ${s.tally.bosses.join(" ") || "none"}; ${(ms / s.steps * 1000).toFixed(0)} µs a step\n  damage: ${dmg}`);
}
