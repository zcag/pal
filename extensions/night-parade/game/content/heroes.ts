// The six heroes: a sprite, a starting weapon, and a trait that nudges the
// build. Stat traits are plain numbers; the two behavioural ones (Kaze's
// smoke, Ennen's healing, Raiden's crit push) are flags sim reads.
import type { Stats } from "./stats.ts";
import type { WeaponKind } from "./weapons.ts";

export type HeroKind = "kaze" | "tomoe" | "seimei" | "ennen" | "raiden" | "hayate";

export type HeroDef = {
  name: string; title: string; sprite: string; weapon: WeaponKind;
  trait: string; traitText: string; stats: Partial<Stats>;
  /** Locked until this unlock (unlocks.ts) is earned; open from the start without. */
  unlock?: string;
};

export const HEROES: Record<HeroKind, HeroDef> = {
  kaze: {
    name: "Kaze", title: "Ninja", sprite: "hero-kaze", weapon: "shuriken",
    trait: "Shadowstep", traitText: "Your dash comes back 40% faster and leaves a puff of smoke that hurts.",
    stats: { dash: 0.4 },
  },
  tomoe: {
    name: "Tomoe", title: "Samurai", sprite: "hero-tomoe", weapon: "katana",
    trait: "Iron will", traitText: "+2 armor and +30 max health: she can stand in the crowd her katana needs.",
    stats: { armor: 2, maxHp: 30 },
  },
  seimei: {
    name: "Seimei", title: "Onmyōji", sprite: "hero-seimei", weapon: "fire",
    trait: "Five elements", traitText: "+15% area and duration; 10 less max health.",
    stats: { area: 0.15, duration: 0.15, maxHp: -10 },
    unlock: "seimei",
  },
  ennen: {
    name: "Ennen", title: "Monk", sprite: "hero-ennen", weapon: "bell",
    trait: "Serenity", traitText: "Heal 0.4 health a second; every 100 enemies you defeat heals 10 more.",
    stats: { recovery: 0.4 },
    unlock: "ennen",
  },
  raiden: {
    name: "Raiden", title: "Thunder ninja", sprite: "hero-raiden", weapon: "thunder",
    trait: "Storm-born", traitText: "+10% crit chance, and your crits knock enemies back.",
    stats: { luck: 0.1 },
    unlock: "raiden",
  },
  hayate: {
    name: "Hayate", title: "Tengu", sprite: "hero-hayate", weapon: "fan",
    trait: "Wind-walker", traitText: "+15% move speed and +50% pickup reach.",
    stats: { move: 9.9, magnet: 18 },
    unlock: "hayate",
  },
};
