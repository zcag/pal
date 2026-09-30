// bun scripts/dps.ts: each weapon alone, benchmarked. The player stands at
// the origin facing the nearest enemy (a player aims facing weapons with their
// feet), with no items, as Kaze with no shrine. Three scenarios:
//   static:  60 unkillable dummies standing in a ring 20 to 150 px out, you still
//   moving:  60 unkillable dummies walking at you from 150 px at 30 px/s while you
//            circle slowly (60 px out, 40 px/s), as a player keeps moving
//   crowd:   the same with weak enemies (health grows with the level), kills a second
// At levels 1, 4 and 8, and evolved (its item held at level 1). Prints damage a
// second for static and moving, kills a second for the crowd, and each weapon's
// score (the mean of static and moving: the sparse crowd and the thick one)
// against the median (docs/design.md, "Tuning targets").
import { WEAPONS, WEAPON_MAX, type WeaponKind } from "../game/content/weapons.ts";
import { loadout } from "../game/bot.ts";
import { DT, addWeapon, create, hash, restat, spawnAt, type Enemy, type State } from "../game/sim/core.ts";
import { stepEnemies } from "../game/sim/enemies.ts";
import { fireAll, stepShots, stepZones } from "../game/sim/weapons.ts";

type Scene = "static" | "moving" | "crowd";
const N = 60, SECONDS = 30;

function dummy(s: State, scene: Scene, hp: number): Enemy {
  const a = Math.random() * Math.PI * 2;
  const r = scene === "static" ? Math.sqrt(20 * 20 + Math.random() * (150 * 150 - 20 * 20)) : 150; // even by area
  const e = spawnAt(s, "larva", s.p.x + Math.cos(a) * r, s.p.y + Math.sin(a) * r, 1);
  Object.assign(e, { hp, max: hp, dmg: 0, speed: scene === "static" ? 0 : 30 });
  return e;
}

export function bench(kind: WeaponKind, level: number, evolved: boolean, scene: Scene, seed = 7) {
  const s = create(loadout(seed, "kaze"));
  s.weapons = [];
  const w = addWeapon(s, kind);
  w.level = level;
  if (evolved) { s.items.push({ kind: WEAPONS[kind].evolveWith, level: 1 }); w.evolved = true; }
  restat(s);
  const orig = Math.random;
  let r = seed;
  Math.random = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296); // the dummies' spots, the same each run
  // The crowd's health is what enemies have around the time you reach the level: minute 0, 2, 4, and 8 for an evolution.
  const hp = scene === "crowd" ? (evolved ? 150 : level >= 8 ? 40 : level >= 4 ? 16 : 8) : 1e12;
  for (let i = 0; i < N; i++) dummy(s, scene, hp);
  const steps = SECONDS / DT;
  for (let i = 0; i < steps; i++) {
    s.t += DT;
    s.steps++;
    if (scene !== "static") { const a = (s.t * 40) / 60; s.p.x = Math.cos(a) * 60; s.p.y = Math.sin(a) * 60; }
    // Face the nearest enemy, as a player aiming with their feet would.
    let best: Enemy | undefined, bd = Infinity;
    const { x: px, y: py } = s.p;
    for (const e of s.enemies) { const d = Math.hypot(e.x - px, e.y - py); if (!e.dead && d < bd) { bd = d; best = e; } }
    if (best) {
      const d = Math.hypot(best.x - px, best.y - py) || 1;
      s.p.face = { x: (best.x - px) / d, y: (best.y - py) / d };
      s.p.side = best.x < px ? -1 : 1;
    }
    let g = hash(s.enemies);
    if (scene !== "static") stepEnemies(s, g, DT);
    g = hash(s.enemies);
    fireAll(s, g, DT);
    stepShots(s, g, DT);
    stepZones(s, g, DT);
    // Keep the crowd: the dead, the pushed-away and (walking in) the arrived come back at the ring.
    s.enemies = s.enemies.filter((e) => { const d = Math.hypot(e.x - s.p.x, e.y - s.p.y); return !e.dead && d < 175 && (scene === "static" || d > 8); });
    while (s.enemies.length < N) dummy(s, scene, hp);
    s.events.length = 0; s.fx.length = 0; s.nums.length = 0; s.gems.length = 0; s.pickups.length = 0;
  }
  Math.random = orig;
  return { dps: w.dmg / s.t, kps: s.p.kills / s.t };
}

if (import.meta.main) {
  const kinds = Object.keys(WEAPONS) as WeaponKind[];
  const rows = kinds.map((k) => {
    const cell = (l: number, evo: boolean) => ({ st: bench(k, l, evo, "static").dps, mv: bench(k, l, evo, "moving").dps, kps: bench(k, l, evo, "crowd").kps });
    return { k, l1: cell(1, false), l4: cell(4, false), l8: cell(WEAPON_MAX, false), evo: cell(WEAPON_MAX, true) };
  });
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  const sc = (x: { st: number; mv: number }) => (x.st + x.mv) / 2;
  const m8 = med(rows.map((r) => sc(r.l8))), m1 = med(rows.map((r) => sc(r.l1)));
  const f = (x: number) => x.toFixed(0).padStart(5);
  console.log("weapon        |  L1 st   mv  k/s |  L4 st   mv  k/s |  L8 st   mv  k/s | evo st   mv  k/s | L8/med  evo/L8  L1/med");
  for (const r of rows) {
    const best8 = sc(r.l8), bestE = sc(r.evo), best1 = sc(r.l1);
    const c = (x: { st: number; mv: number; kps: number }) => `${f(x.st)}${f(x.mv)}${x.kps.toFixed(1).padStart(5)}`;
    const ctrl = WEAPONS[r.k].roles.includes("control") ? "*" : " ";
    console.log(`${(r.k + ctrl).padEnd(13)} |${c(r.l1)} |${c(r.l4)} |${c(r.l8)} |${c(r.evo)} |  ${(best8 / m8).toFixed(2)}    ${(bestE / best8).toFixed(2)}    ${(best1 / m1).toFixed(2)}`);
  }
  console.log(`\nmedian score (mean of static and moving DPS): level 1 ${m1.toFixed(0)}, level 8 ${m8.toFixed(0)}   (* control weapon; evolved runs hold its item at level 1)`);
}
