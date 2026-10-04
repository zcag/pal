// How long the planning bot lasts on every board, over a few seeds: a board
// it cannot survive has a pattern spaced too tight for the turn it asks.
// `bun extensions/vortex/scripts/survey.ts [seconds] [seeds]`
import { STAGES } from "../game/content.ts";
import { create } from "../game/sim.ts";
import { play } from "../game/bot.ts";

const secs = Number(process.argv[2] ?? 90), seeds = Number(process.argv[3] ?? 6);
for (const hyper of [false, true]) for (const st of STAGES) {
  const t0 = performance.now(), res: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) res.push(play(create({ stage: st.id, hyper, seed }), secs).t.toFixed(1).padStart(5));
  console.log(`${(st.id + (hyper ? "+" : "")).padEnd(13)} ${res.join(" ")}   ${((performance.now() - t0) / seeds).toFixed(0)} ms a run`);
}
