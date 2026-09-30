// What lies on the ground, what the shrine sells between nights, and what
// playing unlocks. The page keeps the save; `game/meta.ts` applies it.
import type { Stats } from "./stats.ts";

// ---- pickups ------------------------------------------------------------------------------------------------------

export type PickupKind =
  | "coin" | "pouch" | "bag" | "onigiri" | "feast" | "flute" | "hourglass" | "ofuda" | "gourd" | "chest";

export const PICKUPS: Record<Exclude<PickupKind, "chest">, { name: string; sprite: string; text: string }> = {
  coin: { name: "Coin", sprite: "coin", text: "1 gold." },
  pouch: { name: "Coin pouch", sprite: "pouch", text: "10 gold." },
  bag: { name: "Money bag", sprite: "bag", text: "25 gold." },
  onigiri: { name: "Onigiri", sprite: "onigiri", text: "Heals 30." },
  feast: { name: "Feast", sprite: "feast", text: "Heals everything." },
  flute: { name: "Shakuhachi", sprite: "flute", text: "Every gem on the road flies to you." },
  hourglass: { name: "Hourglass", sprite: "hourglass", text: "The parade stops for 6 seconds." },
  ofuda: { name: "Ofuda", sprite: "ofuda", text: "Purifies every enemy on screen." },
  gourd: { name: "Sake gourd", sprite: "gourd", text: "Nothing can hurt you for 8 seconds." },
};

/** What a broken jar or lantern leaves, as [kind, weight]. */
export const BREAK_DROPS: [PickupKind | "nothing", number][] = [
  ["coin", 30], ["pouch", 8], ["bag", 2], ["onigiri", 18], ["feast", 1.5], ["flute", 3], ["hourglass", 2], ["ofuda", 1.5], ["gourd", 1.5], ["nothing", 20],
];

export type ChestTier = 1 | 3 | 5;

// ---- the shrine ------------------------------------------------------------------------------------------------------

export type ShrineKind =
  | "might" | "armor" | "maxHp" | "recovery" | "cooldown" | "area" | "speed" | "duration" | "amount" | "move"
  | "magnet" | "luck" | "growth" | "greed" | "revival" | "reroll" | "skip" | "banish";

export type ShrineDef = { name: string; icon: string; ranks: number; cost: number; per: Partial<Stats>; text: string };

/** Each rank of each blessing; `per` is what one rank adds. Rerolls, skips and banishes are charges, not stats. */
export const SHRINE: Record<ShrineKind, ShrineDef> = {
  might: { name: "Might", icon: "AttackUpgrade", ranks: 5, cost: 200, per: { might: 0.05 }, text: "+5% damage a rank." },
  armor: { name: "Armor", icon: "Helmet", ranks: 3, cost: 600, per: { armor: 1 }, text: "+1 armor a rank." },
  maxHp: { name: "Max health", icon: "Armor", ranks: 3, cost: 200, per: { maxHp: 10 }, text: "+10 max health a rank." },
  recovery: { name: "Recovery", icon: "Heal", ranks: 5, cost: 200, per: { recovery: 0.1 }, text: "+0.1 health a second a rank." },
  cooldown: { name: "Cooldown", icon: "Potion", ranks: 2, cost: 900, per: { cooldown: 0.025 }, text: "−2.5% cooldown a rank." },
  area: { name: "Area", icon: "Mist", ranks: 2, cost: 300, per: { area: 0.05 }, text: "+5% area a rank." },
  speed: { name: "Speed", icon: "Upgrade", ranks: 2, cost: 300, per: { speed: 0.1 }, text: "+10% projectile speed a rank." },
  duration: { name: "Duration", icon: "Moon", ranks: 2, cost: 300, per: { duration: 0.15 }, text: "+15% duration a rank." },
  amount: { name: "Amount", icon: "Scroll", ranks: 1, cost: 5000, per: { amount: 1 }, text: "One more of every projectile." },
  move: { name: "Move speed", icon: "Boot", ranks: 2, cost: 300, per: { move: 3.3 }, text: "+5% move speed a rank." },
  magnet: { name: "Magnet", icon: "Ring", ranks: 2, cost: 300, per: { magnet: 9 }, text: "+25% pickup reach a rank." },
  luck: { name: "Luck", icon: "Amulet", ranks: 3, cost: 600, per: { luck: 0.1 }, text: "+10% luck a rank." },
  growth: { name: "Growth", icon: "Sun", ranks: 5, cost: 900, per: { growth: 0.03 }, text: "+3% experience a rank." },
  greed: { name: "Greed", icon: "Money", ranks: 5, cost: 200, per: { greed: 0.1 }, text: "+10% gold a rank." },
  revival: { name: "Revival", icon: "Counter", ranks: 1, cost: 10000, per: { revival: 1 }, text: "Come back once a night." },
  reroll: { name: "Reroll", icon: "Permutation", ranks: 5, cost: 500, per: {}, text: "One more reroll a night a rank." },
  skip: { name: "Skip", icon: "Downgrade", ranks: 5, cost: 200, per: {}, text: "One more skip a night a rank." },
  banish: { name: "Banish", icon: "Necromancy", ranks: 5, cost: 500, per: {}, text: "One more banish a night a rank." },
};

/** The next rank's price: dearer with every rank bought anywhere, as Vampire Survivors does. */
export const rankCost = (k: ShrineKind, owned: number, boughtTotal: number) =>
  Math.round(SHRINE[k].cost * (1 + owned) * (1 + 0.1 * boughtTotal));

// ---- unlocks ----------------------------------------------------------------------------------------------------------

export type UnlockKind = "seimei" | "ennen" | "raiden" | "hayate" | "kusarigama" | "yumi" | "ice" | "geyser" | "fan" | "vines" | "omens";

export const UNLOCKS: Record<UnlockKind, { name: string; how: string }> = {
  seimei: { name: "Seimei, onmyōji", how: "Evolve a weapon." },
  ennen: { name: "Ennen, monk", how: "Reach Midnight (5:00)." },
  raiden: { name: "Raiden, thunder ninja", how: "Defeat the Tengu." },
  hayate: { name: "Hayate, tengu", how: "See the dawn." },
  kusarigama: { name: "Kusarigama", how: "Defeat 1,000 enemies in one night." },
  yumi: { name: "Yumi", how: "Defeat the Tanuki." },
  ice: { name: "Ice talisman", how: "Survive 3 minutes without being hurt." },
  geyser: { name: "Water geyser", how: "Reach level 20." },
  fan: { name: "Tengu fan", how: "Pick up 5 specials in one night." },
  vines: { name: "Vines", how: "Break 30 jars and lanterns in one night." },
  omens: { name: "Omens", how: "See the dawn." },
};

/** Harder nights: each level makes the parade tougher and faster and pays more. */
export const OMEN_MAX = 5;
export const omen = (n: number) => ({ hp: 1 + 0.25 * n, speed: 1 + 0.06 * n, count: 1 + 0.1 * n, gold: 1 + 0.3 * n });
