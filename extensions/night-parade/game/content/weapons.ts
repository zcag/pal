// The sixteen weapons: what each is for, its numbers at level 1, what every
// later level adds (the level-up card reads these), and its evolution. How
// each one fires is sim/weapons.ts; the numbers are here so the whole table
// can be tuned in one place against scripts/dps.ts.
import type { ItemKind } from "./items.ts";

export type WeaponKind =
  | "shuriken" | "kunai" | "katana" | "naginata" | "kusarigama" | "yumi" | "fire" | "thunder"
  | "spirit" | "bell" | "rock" | "ice" | "geyser" | "caltrop" | "fan" | "vines";

/**
 * A weapon's numbers. What each means depends on the weapon (a katana's
 * `area` scales its cut, a bell's its aura), but the player's stats apply
 * the same way to all: might to dmg, area to area, speed to speed, duration
 * to dur, amount to amount, cooldown to cd.
 */
export type WStats = {
  dmg: number; cd: number; area: number; speed: number; dur: number; amount: number;
  pierce: number; kb: number; crit: number;
  /** A control weapon's strength: ice's freeze chance, a geyser's stun seconds, vines' root seconds. */
  effect: number;
};
/** One level's change: numbers added to the weapon's, and the card's words when numbers don't say it. */
export type Level = Partial<WStats> & { text?: string };

export type Role = "aimed" | "facing" | "around" | "field" | "random" | "control";

export type WeaponDef = {
  name: string; icon: string; roles: Role[];
  /** What the level-up card says for a new one. */
  blurb: string;
  /** What one of it is called on a card ("+1 kunai"). */
  noun: string;
  base: WStats;
  /** Levels 2 to 8. */
  levels: Level[];
  evolveWith: ItemKind; evolved: string; evolvedBlurb: string;
  /** Changes on evolving, added to the level-8 numbers. */
  evo: Partial<WStats>;
  /** Locked until this unlock (unlocks.ts) is earned; open from the start without. */
  unlock?: string;
};

const W = (d: Partial<WStats>): WStats => ({ dmg: 0, cd: 1, area: 1, speed: 1, dur: 1, amount: 1, pierce: 1, kb: 1, crit: 0.05, effect: 0, ...d });

export const WEAPONS: Record<WeaponKind, WeaponDef> = {
  shuriken: {
    name: "Shuriken", icon: "Shuriken", roles: ["aimed"], noun: "shuriken",
    blurb: "Thrown at the nearest enemies, passing through a few.",
    base: W({ dmg: 10, cd: 0.95, speed: 170, dur: 1.2, amount: 2, pierce: 2, kb: 1 }),
    levels: [{ amount: 1 }, { dmg: 3 }, { pierce: 1 }, { amount: 1 }, { dmg: 4 }, { pierce: 1, cd: -0.1 }, { dmg: 4 }],
    evolveWith: "scroll", evolved: "Storm of Stars", evolvedBlurb: "Homing stars that pass through a crowd and come back to you.",
    evo: { dmg: -4, pierce: 2 },
  },
  kunai: {
    name: "Kunai", icon: "Kunai", roles: ["facing"], noun: "kunai",
    blurb: "A fast volley the way you face.",
    base: W({ dmg: 9, cd: 0.5, speed: 300, dur: 0.8, amount: 1, pierce: 2, kb: 0.6 }),
    levels: [{ amount: 1 }, { dmg: 2 }, { amount: 1 }, { dmg: 2 }, { amount: 1 }, { dmg: 2 }, { pierce: 1 }],
    evolveWith: "waraji", evolved: "Thousand Blades", evolvedBlurb: "A constant stream of blades, doubled while you move.",
    evo: { dmg: 6, pierce: 2, cd: -0.38 }, // a stream: 0.12 s between blades
  },
  katana: {
    name: "Katana", icon: "Cut", roles: ["around"], noun: "cut",
    blurb: "A wide cut in front of you, hitting everything in the arc.",
    base: W({ dmg: 11, cd: 1.3, kb: 1.4 }),
    levels: [{ text: "Cuts behind you too" }, { dmg: 4 }, { area: 0.15 }, { cd: -0.15 }, { dmg: 4 }, { area: 0.15 }, { dmg: 6 }],
    evolveWith: "moon", evolved: "Crescent Moon", evolvedBlurb: "A full circle of two blades every swing, and they can crit.",
    evo: { dmg: -11, crit: 0.2 },
  },
  naginata: {
    name: "Naginata", icon: "MagicWeapon", roles: ["facing", "control"], noun: "thrust",
    blurb: "A long thrust that pierces a whole line and knocks it back hard.",
    base: W({ dmg: 13, cd: 1.8, kb: 3, pierce: 999 }),
    levels: [{ dmg: 6 }, { area: 0.25, text: "Reaches further" }, { text: "Thrusts behind you too" }, { dmg: 6 }, { cd: -0.3 }, { area: 0.25, text: "Reaches further" }, { dmg: 10 }],
    evolveWith: "whetstone", evolved: "Dragon's Spine", evolvedBlurb: "Thrusts four ways at once, each with a shockwave that runs the length of the screen.",
    evo: { dmg: 2 },
  },
  kusarigama: {
    name: "Kusarigama", icon: "Hook", roles: ["around"], noun: "sickle",
    blurb: "A sickle on a chain sweeps a circle around you, never stopping.",
    base: W({ dmg: 8, cd: 0.5, speed: 2.4, amount: 1, kb: 1.2 }),
    levels: [{ area: 0.2 }, { dmg: 3 }, { amount: 1 }, { speed: 0.3, text: "Spins faster" }, { dmg: 3 }, { area: 0.2 }, { dmg: 5 }],
    evolveWith: "mask", evolved: "Shinigami's Wheel", evolvedBlurb: "Three scythes swing in and out; anything under a tenth of its health is cut down outright.",
    evo: { amount: 1, dmg: 12 },
    unlock: "kusarigama",
  },
  yumi: {
    name: "Yumi", icon: "Arrow", roles: ["aimed"], noun: "arrow",
    blurb: "A heavy arrow at the toughest enemy in range. Crits often.",
    base: W({ dmg: 26, cd: 2.0, speed: 380, dur: 1, amount: 1, pierce: 2, kb: 1.5, crit: 0.25 }),
    levels: [{ dmg: 6 }, { amount: 1 }, { pierce: 1 }, { cd: -0.3 }, { dmg: 8 }, { amount: 1 }, { crit: 0.25 }],
    evolveWith: "tailwind", evolved: "Hachiman's Bow", evolvedBlurb: "Every arrow crits, and splits into three on its first hit.",
    evo: { crit: 1, dmg: -4 },
    unlock: "yumi",
  },
  fire: {
    name: "Fire talisman", icon: "Fireball", roles: ["random"], noun: "fireball",
    blurb: "A fireball that bursts where it lands.",
    base: W({ dmg: 16, cd: 2.3, speed: 150, amount: 1, kb: 2 }),
    levels: [{ amount: 1 }, { dmg: 4 }, { area: 0.15 }, { amount: 1 }, { cd: -0.3 }, { dmg: 5 }, { area: 0.15 }],
    evolveWith: "incense", evolved: "Kitsune-bi", evolvedBlurb: "Every burst leaves foxfire burning on the ground.",
    evo: { dmg: -6 },
  },
  thunder: {
    name: "Thunder", icon: "BookThunder", roles: ["random"], noun: "strike",
    blurb: "Strikes enemies around you from above.",
    base: W({ dmg: 22, cd: 2.6, amount: 1, crit: 0.1, kb: 0 }),
    levels: [{ amount: 1 }, { dmg: 5 }, { cd: -0.3 }, { amount: 1 }, { dmg: 5 }, { amount: 1 }, { dmg: 7 }],
    evolveWith: "omamori", evolved: "Raijin's Drums", evolvedBlurb: "Each strike chains to three more, and strikes crit more.",
    evo: { crit: 0.1, dmg: -17 },
  },
  spirit: {
    name: "Spirit wisps", icon: "OrbLight", roles: ["around"], noun: "spirit",
    blurb: "Spirits circle you for a few seconds, hitting what they touch, then rest.",
    base: W({ dmg: 8, cd: 2.2, dur: 3, amount: 2, speed: 3.2, kb: 0.8 }),
    levels: [{ amount: 1 }, { dmg: 3 }, { dur: 1, text: "Stays out longer" }, { amount: 1 }, { area: 0.2 }, { amount: 1 }, { dmg: 5 }],
    evolveWith: "herbs", evolved: "Hitodama", evolvedBlurb: "Two rings that never rest; now and then a hit heals you.",
    evo: { dmg: -9 },
  },
  bell: {
    name: "Temple bell", icon: "Sing", roles: ["around", "control"], noun: "chant",
    blurb: "A chant rings around you: steady damage and a gentle push.",
    base: W({ dmg: 5, cd: 0.7, kb: 0.8, crit: 0 }),
    levels: [{ area: 0.15 }, { dmg: 2 }, { cd: -0.1 }, { area: 0.15 }, { dmg: 2 }, { area: 0.15 }, { dmg: 3 }],
    evolveWith: "do", evolved: "Great Bell", evolvedBlurb: "Every few seconds a gong wave rolls out and stuns; its damage grows with your max health.",
    evo: { dmg: -6, cd: 0.5 },
  },
  rock: {
    name: "Rock spikes", icon: "RockSpike", roles: ["around"], noun: "spike",
    blurb: "Spikes burst up in a ring around you.",
    base: W({ dmg: 20, cd: 3.2, amount: 6, kb: 2 }),
    levels: [{ amount: 2 }, { dmg: 8 }, { area: 0.2 }, { amount: 2 }, { cd: -0.4 }, { dmg: 10 }, { amount: 2 }],
    evolveWith: "kabuto", evolved: "Earthquake", evolvedBlurb: "Three rings ripple outward, and the ground shakes and stuns.",
    evo: { dmg: -10 },
  },
  ice: {
    name: "Ice talisman", icon: "BookIce", roles: ["aimed", "control"], noun: "shard",
    blurb: "A fan of ice shards that slows what it hits, and sometimes freezes it.",
    base: W({ dmg: 10, cd: 1.2, speed: 200, dur: 0.8, amount: 3, pierce: 2, kb: 0.4, effect: 0.08 }),
    levels: [{ amount: 1 }, { effect: 0.08, text: "Freezes more often" }, { dmg: 5 }, { amount: 2 }, { pierce: 1 }, { dmg: 5 }, { effect: 0.1, text: "Freezes more often" }],
    evolveWith: "tea", evolved: "Blizzard", evolvedBlurb: "Every 8 seconds the whole screen freezes for 2.",
    evo: { dmg: 26, amount: 2, cd: 0.72 }, // heavier casts, each fifth one a blizzard
    unlock: "ice",
  },
  geyser: {
    name: "Water geyser", icon: "WaterCanon", roles: ["random", "control"], noun: "geyser",
    blurb: "Geysers burst under the thickest crowds and stun them.",
    base: W({ dmg: 11, cd: 2.6, amount: 1, kb: 0, effect: 0.6 }),
    levels: [{ amount: 1 }, { dmg: 5 }, { area: 0.2 }, { amount: 1 }, { cd: -0.4 }, { dmg: 4 }, { dmg: 2 }],
    evolveWith: "lodestone", evolved: "Whirlpool", evolvedBlurb: "Geysers become whirlpools that drag enemies in and grind them down.",
    evo: { dmg: -12 },
    unlock: "geyser",
  },
  caltrop: {
    name: "Caltrops", icon: "Explosion", roles: ["field"], noun: "caltrop",
    blurb: "Dropped behind you as you run; whatever steps on them bleeds.",
    base: W({ dmg: 6, cd: 1.6, dur: 4, kb: 0, crit: 0 }),
    levels: [{ dmg: 3 }, { dur: 2, text: "Last longer" }, { cd: -0.2 }, { text: "Bombs join in" }, { dmg: 4 }, { area: 0.25 }, { cd: -0.2 }],
    evolveWith: "maneki", evolved: "Festival Crackers", evolvedBlurb: "Strings of firecrackers; what they kill drops extra gold.",
    evo: { dmg: 6 },
  },
  fan: {
    name: "Tengu fan", icon: "BookWind", roles: ["facing", "control"], noun: "gust",
    blurb: "A gust the way you face that passes through and pushes everything back.",
    base: W({ dmg: 7, cd: 1.7, speed: 140, dur: 0.9, pierce: 999, kb: 5 }),
    levels: [{ dmg: 4 }, { area: 0.2 }, { text: "A gust behind you too" }, { kb: 2, text: "Pushes harder" }, { dmg: 5 }, { area: 0.2 }, { cd: -0.35 }],
    evolveWith: "mirror", evolved: "Tengu Tempest", evolvedBlurb: "A tornado wanders around you, pulling enemies in and shredding their shots.",
    evo: { dmg: -8 },
    unlock: "fan",
  },
  vines: {
    name: "Vines", icon: "BookPlant", roles: ["field", "control"], noun: "vine",
    blurb: "Vines burst along a line toward the crowd, rooting what they catch.",
    base: W({ dmg: 11, cd: 2.2, amount: 1, kb: 0, effect: 1 }),
    levels: [{ text: "Longer vines" }, { dmg: 5 }, { amount: 1 }, { effect: 0.5, text: "Roots longer" }, { dmg: 5 }, { amount: 1 }, { text: "Longer vines" }],
    evolveWith: "sun", evolved: "Sacred Grove", evolvedBlurb: "Bamboo erupts in rings spreading out from you, rooting everything.",
    evo: { dmg: 6 },
    unlock: "vines",
  },
};

export const WEAPON_MAX = 8;

/** Your attacks break the enemy shots they touch (all but the Oni's club), so a screen full of bolts stays manageable. */
export const BREAK_SHOTS = true;

/** A weapon's own numbers at a level (before the player's stats). */
export function levelStats(k: WeaponKind, level: number, evolved: boolean): WStats {
  const d = WEAPONS[k], s = { ...d.base };
  const addIn = (l: Partial<WStats>) => { for (const key in l) if (key !== "text") (s as Record<string, number>)[key] += (l as Record<string, number>)[key]; };
  d.levels.slice(0, level - 1).forEach(addIn);
  if (evolved) addIn(d.evo);
  return s;
}

/** What a level's card says: its own words, or its numbers read out. */
export function levelText(k: WeaponKind, level: number): string {
  if (level <= 1) return WEAPONS[k].blurb;
  const l = WEAPONS[k].levels[level - 2], d = WEAPONS[k];
  if (l.text && Object.keys(l).length === 1) return l.text;
  const parts: string[] = [];
  if (l.text) parts.push(l.text);
  if (l.amount) parts.push(`+${l.amount} ${d.noun}`);
  if (l.dmg) parts.push(`Damage +${l.dmg}`);
  if (l.area && !l.text) parts.push(`Area +${Math.round(l.area * 100)}%`);
  if (l.pierce) parts.push(`Passes through +${l.pierce}`);
  if (l.cd) parts.push(`Cooldown −${Math.round((-l.cd / d.base.cd) * 100)}%`);
  if (l.speed && !l.text) parts.push(`Speed +${Math.round(l.speed * 100)}%`);
  if (l.dur && !l.text) parts.push(`Lasts longer`);
  if (l.crit) parts.push(`Crit chance +${Math.round(l.crit * 100)}%`);
  if (l.kb && !l.text) parts.push(`Pushes harder`);
  return parts.join(", ");
}
