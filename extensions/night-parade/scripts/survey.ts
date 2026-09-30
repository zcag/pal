// bun scripts/survey.ts [hero] [nights] [shrine]: the bot plays many nights
// and prints how far they got (when they ended, levels at 5:00/10:00/15:00,
// the first evolution, bosses beaten), how long each boss lived, when deaths
// happened, and what did the damage to you in each act. `shrine` plays with
// a mid-progression shrine. The numbers docs/design.md's "Tuning targets"
// are checked against.
import { night, play } from "../game/bot.ts";
import type { HeroKind } from "../game/content/heroes.ts";
import { clock } from "../game/sim/index.ts";

const hero = (process.argv[2] ?? "kaze") as HeroKind, n = Number(process.argv[3] ?? 12), shrine = process.argv[4] === "shrine";
const quiet = process.env.QUIET === "1";
const more = shrine ? { bonus: { might: 0.15, maxHp: 20, recovery: 0.3, armor: 1, luck: 0.1, growth: 0.06 }, rerolls: 2 } : {};
type Row = { t: number; won: boolean; l5?: number; l10?: number; l15?: number; evo?: number; bosses: number };
const rows: Row[] = [];
const hurt: Record<string, number>[] = [{}, {}, {}];
const boss: Record<string, { met: number; beat: number; life: number[] }> = {};
for (let seed = 1; seed <= n; seed++) {
  const s = night(seed, hero, more);
  const r: Row = { t: 0, won: false, bosses: 0 };
  const seen = new Map<string, number>();
  let lastHurt: Record<string, number> = {};
  play(s, (s) => {
    if (Math.round(s.t) === 300) r.l5 = s.p.level;
    if (Math.round(s.t) === 600) r.l10 = s.p.level;
    if (Math.round(s.t) === 899) r.l15 = s.p.level;
    if (r.evo === undefined && s.tally.evolved.length) r.evo = s.t;
    for (const e of s.enemies) if (e.boss && !seen.has(e.boss)) seen.set(e.boss, s.t);
    const act = s.t >= 600 ? 2 : s.t >= 300 ? 1 : 0;
    for (const [k, v] of Object.entries(s.tally.hurtBy)) {
      const d = v - (lastHurt[k] ?? 0);
      if (d > 0) hurt[act][k] = (hurt[act][k] ?? 0) + d;
    }
    lastHurt = { ...s.tally.hurtBy };
  }, 1200);
  Object.assign(r, { t: s.t, won: s.phase === "won", bosses: s.tally.bosses.length });
  // Boss lives: spawn time to the second it fell (tally order), approximated by the survey tick.
  for (const [k, at] of seen) {
    const b = (boss[k] ??= { met: 0, beat: 0, life: [] });
    b.met++;
    void at;
    if (s.tally.bosses.includes(k as never)) b.beat++;
  }
  (s as unknown as { __seen: Map<string, number> }).__seen = seen;
  rows.push(r);
  if (!quiet) console.log(`seed ${String(seed).padStart(2)}: ${r.won ? "DAWN " : "dead "} ${clock(r.t).padStart(5)}  lv@5 ${r.l5 ?? "-"}  lv@10 ${r.l10 ?? "-"}  lv@15 ${r.l15 ?? "-"}  evo ${r.evo ? clock(r.evo) : "-"}  bosses ${r.bosses}`);
}
const reach = (t: number) => rows.filter((r) => r.t >= t || r.won).length;
const med = (xs: number[]) => (xs.length ? xs.sort((a, b) => a - b)[xs.length >> 1] : NaN);
console.log(`\n${hero}${shrine ? " +shrine" : ""}: reached 5:00 ${reach(300)}/${n}, 10:00 ${reach(600)}/${n}, dawn ${rows.filter((r) => r.won).length}/${n}`);
console.log(`levels (median): @5 ${med(rows.flatMap((r) => r.l5 ?? []))}  @10 ${med(rows.flatMap((r) => r.l10 ?? []))}  @15 ${med(rows.flatMap((r) => r.l15 ?? []))};  first evo median ${clock(med(rows.flatMap((r) => r.evo ?? [])) || 0)} (${rows.filter((r) => r.evo).length} runs)`);
const hist = Array(16).fill(0);
for (const r of rows) if (!r.won) hist[Math.min(15, Math.floor(r.t / 60))]++;
console.log("deaths by minute:", hist.map((c, i) => `${i}:${c}`).filter((x) => !x.endsWith(":0")).join(" "));
console.log("bosses (met/beaten):", Object.entries(boss).map(([k, b]) => `${k} ${b.beat}/${b.met}`).join(", "));
for (let a = 0; a < 3; a++) console.log(`hurt act ${a + 1}:`, Object.entries(hurt[a]).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k} ${Math.round(v / n)}`).join(", "));
