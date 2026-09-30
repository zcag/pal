// A player that needs no keyboard: it steers away from the crowd, the
// telegraphed rings and the shots coming at it, drifts to gems when it can,
// dashes out of a squeeze, and picks at level-ups like a player who plans
// evolutions. Good enough to say whether a night is winnable, too easy or
// over by minute four; not how a person plays.
import type { HeroKind } from "./content/heroes.ts";
import { choose, create, pairs, resume, step, type Choice, type Input, type Loadout, type State } from "./sim/index.ts";

export const loadout = (seed: number, hero: HeroKind = "kaze", more: Partial<Loadout> = {}): Loadout =>
  ({ hero, seed, bonus: {}, rerolls: 0, skips: 0, banishes: 0, omen: 0, locked: [], ...more });

/** Weapons that only hit what's close: a bot carrying mostly these fights up close, as a player would. */
const CLOSE = new Set(["katana", "bell", "spirit", "kusarigama", "rock", "caltrop"]);

export function drive(s: State): Input {
  const p = s.p;
  const close = s.weapons.filter((w) => CLOSE.has(w.kind)).length * 2 > s.weapons.length;
  const keep = close ? 26 : 60;
  let ax = 0, ay = 0, crowded = 0;
  const away = (x: number, y: number, w: number, r: number) => {
    const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
    if (d2 > r * r) return;
    const k = w / Math.max(d2, 16);
    ax += dx * k;
    ay += dy * k;
  };
  for (const e of s.enemies) {
    if (e.prop || e.under || e.hidden) continue;
    away(e.x, e.y, e.boss ? 8 : e.elite ? 3 : 1, e.boss ? 110 : keep);
    if (Math.hypot(p.x - e.x, p.y - e.y) < 22) crowded++;
  }
  for (const h of s.hazards) {
    if (h.done) continue;
    if (h.kind === "line") {
      // Step off the line: away from its nearest point.
      const lx = h.x2 - h.x, ly = h.y2 - h.y, l2 = lx * lx + ly * ly || 1;
      const k = Math.max(0, Math.min(1, ((p.x - h.x) * lx + (p.y - h.y) * ly) / l2));
      away(h.x + lx * k, h.y + ly * k, 40, h.r + 20);
    } else if (h.dmg > 0) away(h.x, h.y, 30, h.r + 14);
  }
  for (const f of s.foeShots) away(f.x, f.y, 6, 40);
  [ax, ay] = [ax - ay * 0.6, ay + ax * 0.6]; // sideways a little: circle the crowd, don't back into the next one
  const threat = Math.hypot(ax, ay);
  let best = Infinity, gx = 0, gy = 0;
  for (const o of [...s.gems, ...s.pickups]) {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const want = "kind" in o && o.kind === "chest" ? d / 3 : d;
    if (want < best) { best = want; gx = (o.x - p.x) / d; gy = (o.y - p.y) / d; }
  }
  if (best < Infinity) {
    const w = 0.035 / (1 + threat * 25);
    ax += gx * w;
    ay += gy * w;
  } else if (threat < 0.001) {
    ax = Math.cos(s.t / 3);
    ay = Math.sin(s.t / 3);
  }
  const l = Math.hypot(ax, ay) || 1;
  const inRing = s.hazards.some((h) => !h.done && h.dmg > 0 && h.delay - h.t < 0.25 && Math.hypot(p.x - h.x, p.y - h.y) < h.r + 6);
  return { x: ax / l, y: ay / l, dash: crowded >= (close ? 5 : 3) || inRing };
}

/** Level what it carries, weapons first, finish pairs; take new weapons while it has fewer than four. */
export function pickChoice(s: State): number {
  const score = (c: Choice) => {
    if (c.type === "weapon") return (c.level > 1 ? 3 : s.weapons.length < 4 ? 2.6 : 0.4) + (pairs(s, c) ? 1 : 0);
    if (c.type === "item") return (c.level > 1 ? 2 : 1) + (pairs(s, c) ? 2.5 : 0);
    return 0;
  };
  let best = 0;
  s.choices.forEach((c, i) => { if (score(c) > score(s.choices[best])) best = i; });
  return best;
}

/** Play a whole night; `each` sees the state once a simulated second. */
export function play(s: State, each?: (s: State) => void, limit = 1000) {
  let sec = 0;
  while ((s.phase === "play" || s.phase === "levelup" || s.phase === "chest") && s.t < limit) {
    if (s.phase === "levelup") choose(s, pickChoice(s));
    else if (s.phase === "chest") resume(s);
    else step(s, drive(s));
    s.events.length = 0;
    if (each && s.t >= sec) { sec++; each(s); }
  }
  return s;
}

export const night = (seed: number, hero: HeroKind = "kaze", more: Partial<Loadout> = {}) => create(loadout(seed, hero, more));
export const describe = (s: State) =>
  s.weapons.map((w) => `${w.kind}${w.evolved ? "*" : w.level}`).join(" ") + " | " + s.items.map((i) => `${i.kind}${i.level}`).join(" ");
