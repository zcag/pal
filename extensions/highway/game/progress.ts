// What you work toward between runs (DESIGN.md, "Progression"): a driver level
// that grows with how well you drive and opens modes, places and paints as it
// goes, and three missions, each a run away, their targets growing with you.
import type { Score } from "./score.ts";

export const MAX_LEVEL = 40;

/** XP from one level to the next: 300 for the first (a run), then a curve fitted in scripts/economy.ts so
 *  a regular player reaches level 5 in about 20 minutes, 10 in 1.5 h, 15 in 4 h, 25 in 16 h; 40 is the long tail. */
export const xpFor = (level: number) => Math.round((2000 * Math.pow(1.135, level - 1) * (1 - 0.85 * Math.pow(0.65, level - 1))) / 50) * 50;
/** XP a run's score is worth: a good first run (about 25,000 points) is most of level 2. */
export const xpOfPoints = (points: number) => Math.round(points / 80);

/** What a level opens. A level with nothing listed still pays its cash. */
export type Unlock = { kind: "mode" | "place" | "paints"; id: string; name: string };
export const UNLOCKS: Record<number, Unlock[]> = {
  2: [{ kind: "mode", id: "twoway", name: "Two-Way" }],
  3: [{ kind: "place", id: "midday", name: "High Noon" }],
  5: [{ kind: "mode", id: "time", name: "Time Attack" }],
  6: [{ kind: "place", id: "dusk", name: "Golden Hour" }],
  8: [{ kind: "place", id: "overcast", name: "Grey Day" }],
  10: [{ kind: "mode", id: "trap", name: "Speed Trap" }],
  12: [{ kind: "place", id: "night", name: "Night Run" }],
  15: [{ kind: "paints", id: "metallic", name: "Metallic paints" }],
  20: [{ kind: "paints", id: "matte", name: "Matte paints" }],
  25: [{ kind: "paints", id: "deep", name: "Deep paints" }],
};
/** Cash a level pays on reaching it. */
export const levelCash = (level: number) => 150 * level;

/** Everything opened at or below a level. */
export function unlocked(level: number) {
  return Object.entries(UNLOCKS).filter(([l]) => +l <= level).flatMap(([, u]) => u);
}
/** The next level that opens something, and what. */
export function nextUnlock(level: number): { level: number; unlocks: Unlock[] } | null {
  const l = Object.keys(UNLOCKS).map(Number).sort((a, b) => a - b).find((x) => x > level);
  return l ? { level: l, unlocks: UNLOCKS[l] } : null;
}

/** Add XP: how many levels it climbed, and the level and XP after. */
export function gainXp(level: number, xp: number, add: number) {
  let ups = 0;
  xp += add;
  while (level < MAX_LEVEL && xp >= xpFor(level)) { xp -= xpFor(level); level++; ups++; }
  if (level >= MAX_LEVEL) xp = 0;
  return { level, xp, ups };
}

// ---------------------------------------------------------------- missions

/** What a run did that a mission can ask about. */
export type RunStats = { misses: number; paint: number; bestCombo: number; distance: number; doubles: number; oncomingTime: number; topSpeed: number; points: number; nitroUses: number; mode: string };
export const statsOf = (s: Score, mode: string): RunStats => ({
  misses: s.misses, paint: s.graded["Paint trader"], bestCombo: s.bestCombo, distance: s.distance, doubles: s.doubles,
  oncomingTime: s.oncomingTime, topSpeed: s.topSpeed, points: s.points, nitroUses: s.nitroUses, mode,
});

type Template = { kind: string; text: (n: number) => string; target: (tier: number, top: number) => number; value: (r: RunStats) => number; mode?: string; minLevel?: number };
const TEMPLATES: Template[] = [
  { kind: "misses", text: (n) => `Pass ${n} cars closely in one run`, target: (t) => 6 + 4 * t, value: (r) => r.misses },
  { kind: "combo", text: (n) => `Reach a ×${n} combo`, target: (t) => 3 + 2 * t, value: (r) => r.bestCombo },
  { kind: "distance", text: (n) => `Drive ${n} km in one run`, target: (t) => 2 + 1.5 * t, value: (r) => r.distance / 1000 },
  { kind: "paint", text: (n) => `${n} paint trader${n === 1 ? "" : "s"} in one run`, target: (t) => 1 + t, value: (r) => r.paint },
  { kind: "doubles", text: (n) => (n === 1 ? "Thread a gap between two cars" : `Thread the gap ${n} times in one run`), target: (t) => 1 + Math.floor(t / 2), value: (r) => r.doubles, minLevel: 2 },
  { kind: "speed", text: (n) => `Reach ${n} km/h`, target: (t, top) => Math.min(Math.round(top * 0.98 / 5) * 5, 150 + 15 * t), value: (r) => r.topSpeed },
  { kind: "points", text: (n) => `Score ${n.toLocaleString("en-US")} in one run`, target: (t) => Math.round((15000 * Math.pow(1.6, t)) / 1000) * 1000, value: (r) => r.points },
  { kind: "nitro", text: (n) => (n === 1 ? "Light the nitro in a run" : `Light the nitro ${n} times in one run`), target: (t) => 1 + t, value: (r) => r.nitroUses },
  { kind: "oncoming", text: (n) => `${n} s in the oncoming lane in one Two-Way run`, target: (t) => 10 + 8 * t, value: (r) => (r.mode === "twoway" ? r.oncomingTime : 0), minLevel: 2 },
];

export type Mission = { kind: string; text: string; target: number; reward: { cash: number; xp: number } };

/** How hard missions are at a level: 0 at the start, rising slowly. */
const tierOf = (level: number) => Math.min(8, Math.floor((level - 1) / 3));

/** A new mission unlike the ones held, sized to the level and the car's top speed. */
export function newMission(level: number, topSpeed: number, held: Mission[], rnd: () => number): Mission {
  const pool = TEMPLATES.filter((t) => (t.minLevel ?? 1) <= level && !held.some((m) => m.kind === t.kind));
  const t = pool[Math.floor(rnd() * pool.length)];
  const tier = tierOf(level);
  const target = Math.round(t.target(tier, topSpeed) * 10) / 10;
  const scale = 1 + tier * 0.6;
  return { kind: t.kind, text: t.text(target), target, reward: { cash: Math.round((600 * scale) / 50) * 50, xp: Math.round((150 * scale) / 50) * 50 } };
}

/** How far a run took a mission (0..1); 1 is done. */
export function progressOf(m: Mission, r: RunStats) {
  const t = TEMPLATES.find((x) => x.kind === m.kind);
  return t ? Math.min(1, t.value(r) / m.target) : 0;
}
