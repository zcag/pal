// bun scripts/bosstime.ts [nights] [shrine]: seconds each boss lives from
// spawn to its fall, for runs that meet it, stepping the bot frame by frame.
import { choose, resume, step } from "../game/sim/index.ts";
import { drive, night, pickChoice } from "../game/bot.ts";
const n = Number(process.argv[2] ?? 12), shrine = process.argv[3] === "shrine";
const more = shrine ? { bonus: { might: 0.15, maxHp: 20, recovery: 0.3, armor: 1, luck: 0.1, growth: 0.06 }, rerolls: 2 } : {};
const lives: Record<string, number[]> = {}, escaped: Record<string, number> = {};
for (let seed = 1; seed <= n; seed++) {
  const s = night(seed, "kaze", more);
  const born = new Map<string, number>();
  while ((s.phase === "play" || s.phase === "levelup" || s.phase === "chest") && s.t < 1200) {
    if (s.phase === "levelup") choose(s, pickChoice(s));
    else if (s.phase === "chest") resume(s);
    else {
      step(s, drive(s));
      for (const e of s.enemies) if (e.boss && !born.has(e.boss)) born.set(e.boss, s.t);
      for (const [k, t] of born) if (t >= 0 && !s.enemies.some((e) => e.boss === k)) { (lives[k] ??= []).push(s.t - t); born.set(k, -1); }
    }
    s.events.length = 0;
  }
  for (const [k, t] of born) if (t >= 0) escaped[k] = (escaped[k] ?? 0) + 1;
}
const fmt = (xs: number[]) => (xs.length ? `${xs.length} kills, median ${Math.round(xs.sort((a, b) => a - b)[xs.length >> 1])}s (min ${Math.round(xs[0])}, max ${Math.round(xs[xs.length - 1])})` : "never killed");
for (const k of ["frog", "tanuki", "yurei", "tengu", "samurai", "oni"]) console.log(`${k.padEnd(8)} ${fmt(lives[k] ?? [])}; alive at death ${escaped[k] ?? 0}`);
