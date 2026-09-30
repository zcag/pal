// The shape of the night: who walks in each minute, how thick the crowd is,
// and the scripted beats (docs/design.md, "The night"). sim/spawn.ts plays
// it.
import type { BossKind } from "./bosses.ts";
import type { EnemyKind } from "./enemies.ts";

/** The mix for each minute, as [kind, weight]. */
export const CROWD: [EnemyKind, number][][] = [
  [["slime", 3], ["bat", 2]],
  [["slime", 2], ["bat", 2], ["larva", 2]],
  [["larva", 2], ["mushroom", 2], ["snake", 1]],
  [["mushroom", 2], ["snake", 2], ["tanuki", 1], ["kappa", 1], ["larva", 1]],
  [["tanuki", 1], ["mole", 2], ["kappa", 2], ["lantern", 2]],
  [["lantern", 2], ["skull", 2], ["kappa", 1], ["mole", 1]],
  [["skull", 2], ["owl", 2], ["skeleton", 2]],
  [["owl", 1], ["spirit", 2], ["eye", 1], ["skeleton", 2], ["skull", 1]],
  [["spirit", 2], ["eye", 2], ["bamboo", 1], ["octopus", 1]],
  [["eye", 1], ["octopus", 2], ["bamboo", 2], ["cyclops", 1]],
  [["cyclops", 2], ["imp", 2], ["octopus", 1], ["skeleton", 1]],
  [["imp", 2], ["onibi", 1], ["cyclops", 2], ["skeleton", 1]],
  [["onibi", 1], ["beast", 2], ["imp", 1], ["cyclops", 1], ["skeleton", 1]],
  [["beast", 2], ["dragon", 2], ["panda", 1], ["onibi", 1]],
  [["dragon", 2], ["panda", 2], ["onibi", 2], ["imp", 1]],
];

/** How thick the crowd is at minute m: at least `min` alive, `batch` more every `every` s, health times `hp`. */
export const pressure = (m: number) => ({
  // An extra crowd in the first minutes (14 more at the start, gone by 5:00) so the night opens with pressure.
  min: Math.round(20 + 9 * m + 0.05 * m * m + Math.max(0, 14 - 2.8 * m)),
  every: Math.max(0.4, 1.0 - 0.04 * m),
  batch: 1 + Math.floor(m / 4),
  hp: 1 + 0.18 * m + 0.008 * m * m,
});

export const MAX_ENEMIES = 400;

export type EliteTrait = "swift" | "hulking" | "shielded" | "splitting" | "burning";
export const ELITE_TRAITS: Record<EliteTrait, { name: string; tint: string }> = {
  swift: { name: "Swift", tint: "#6ec3ff" },
  hulking: { name: "Hulking", tint: "#b07bff" },
  shielded: { name: "Shielded", tint: "#ffd166" },
  splitting: { name: "Splitting", tint: "#7ee08a" },
  burning: { name: "Burning", tint: "#ff7a4a" },
};

export type StageEvent =
  | { at: number; kind: "swarm"; enemy: EnemyKind; count: number; text: string }
  | { at: number; kind: "procession"; enemy: EnemyKind; count: number; text: string; reward: boolean }
  | { at: number; kind: "ring"; enemy: EnemyKind; count: number; text: string }
  | { at: number; kind: "rise"; enemy: EnemyKind; count: number; text: string }
  | { at: number; kind: "stampede"; enemy: EnemyKind; count: number; text: string }
  | { at: number; kind: "surge"; enemy: EnemyKind; count: number; text: string; dur: number }
  | { at: number; kind: "bloodmoon"; dur: number; text: string }
  | { at: number; kind: "drums"; text: string }
  | { at: number; kind: "boss"; boss: BossKind };

export const EVENTS: StageEvent[] = [
  { at: 60, kind: "swarm", enemy: "bat", count: 40, text: "Bats in the rafters" },
  { at: 150, kind: "boss", boss: "frog" },
  { at: 210, kind: "procession", enemy: "lantern", count: 16, text: "The lantern procession", reward: true },
  { at: 255, kind: "ring", enemy: "mushroom", count: 24, text: "A ring of mushrooms" },
  { at: 300, kind: "boss", boss: "tanuki" },
  { at: 360, kind: "rise", enemy: "skeleton", count: 10, text: "The restless dead" },
  { at: 450, kind: "boss", boss: "yurei" },
  { at: 510, kind: "surge", enemy: "spirit", count: 40, text: "Spirit storm", dur: 30 },
  { at: 555, kind: "stampede", enemy: "skull", count: 36, text: "Skull stampede" },
  { at: 600, kind: "boss", boss: "tengu" },
  { at: 660, kind: "bloodmoon", dur: 30, text: "Blood moon" },
  { at: 750, kind: "boss", boss: "samurai" },
  { at: 810, kind: "procession", enemy: "imp", count: 22, text: "The oni procession", reward: true },
  { at: 885, kind: "drums", text: "The drums" },
  { at: 900, kind: "boss", boss: "oni" },
];

/** The three acts, for the banner and the music. */
export const ACTS = [
  { at: 0, name: "Dusk", sub: "Act I" },
  { at: 300, name: "Midnight", sub: "Act II" },
  { at: 600, name: "The Hour of the Ox", sub: "Act III" },
];
export const actAt = (t: number) => (t >= 600 ? 2 : t >= 300 ? 1 : 0);
