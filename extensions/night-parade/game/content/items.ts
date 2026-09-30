// The sixteen items (passives): each raises one stat per level and is the
// key to one weapon's evolution (weapons.ts `evolveWith`). Icons are the
// pack's 24 px skill icons (Ui/Skill Icon), copied to assets/icons/.
import type { StatKey } from "./stats.ts";

export type ItemKind =
  | "kabuto" | "do" | "herbs" | "whetstone" | "incense" | "moon" | "tea" | "scroll"
  | "tailwind" | "waraji" | "lodestone" | "omamori" | "sun" | "maneki" | "mirror" | "mask";

export type ItemDef = { name: string; icon: string; stat: StatKey; per: number; max: number; blurb: string; lore: string };

export const ITEMS: Record<ItemKind, ItemDef> = {
  kabuto: { name: "Kabuto", icon: "Helmet", stat: "armor", per: 1, max: 5, blurb: "Armor +1: every hit hurts 1 less.", lore: "A lacquered helmet with a crescent crest." },
  do: { name: "Dō armor", icon: "Armor", stat: "maxHp", per: 20, max: 5, blurb: "Max health +20.", lore: "Plates of iron laced with silk." },
  herbs: { name: "Healing herbs", icon: "Heal", stat: "recovery", per: 0.2, max: 5, blurb: "Heal 0.2 health a second.", lore: "Mugwort and ginger, bound in a cloth." },
  whetstone: { name: "Whetstone", icon: "AttackUpgrade", stat: "might", per: 0.1, max: 5, blurb: "Might +10%: all damage.", lore: "Water-stone, fine grit. Everything cuts deeper." },
  incense: { name: "Incense", icon: "Mist", stat: "area", per: 0.1, max: 5, blurb: "Area +10%.", lore: "Temple smoke that spreads wider than it should." },
  moon: { name: "Moon charm", icon: "Moon", stat: "duration", per: 0.12, max: 5, blurb: "Duration +12%: effects last longer.", lore: "A silver crescent. Nights feel longer with it." },
  tea: { name: "Green tea", icon: "Potion", stat: "cooldown", per: 0.08, max: 5, blurb: "Cooldown −8%: attack more often.", lore: "Bitter and bright. Hands move quicker." },
  scroll: { name: "Scroll", icon: "Scroll", stat: "amount", per: 1, max: 2, blurb: "One more of every projectile.", lore: "A copying spell: one becomes two." },
  tailwind: { name: "Tailwind", icon: "Upgrade", stat: "speed", per: 0.12, max: 5, blurb: "Speed +12%: projectiles fly faster.", lore: "A kite's string, cut. The wind is yours." },
  waraji: { name: "Waraji", icon: "Boot", stat: "move", per: 5.28, max: 5, blurb: "Move speed +8%.", lore: "Straw sandals, worn soft." },
  lodestone: { name: "Lodestone ring", icon: "Ring", stat: "magnet", per: 12.6, max: 5, blurb: "Pickup reach +30%.", lore: "Iron filings would cling to it. So does luck." },
  omamori: { name: "Omamori", icon: "Amulet", stat: "luck", per: 0.1, max: 5, blurb: "Luck +10%: crits, bigger chests, a fourth choice.", lore: "A shrine charm. Don't open it." },
  sun: { name: "Rising sun", icon: "Sun", stat: "growth", per: 0.08, max: 5, blurb: "Experience +8%.", lore: "A promise of morning." },
  maneki: { name: "Maneki-neko", icon: "Money", stat: "greed", per: 0.15, max: 5, blurb: "Gold +15%.", lore: "The beckoning cat. It beckons coins." },
  mirror: { name: "Yata mirror", icon: "Counter", stat: "revival", per: 1, max: 1, blurb: "Come back once, at half health.", lore: "The sacred mirror. It shows you standing." },
  mask: { name: "Oni mask", icon: "Death", stat: "curse", per: 0.1, max: 5, blurb: "Curse +10%: more, tougher enemies; more experience.", lore: "Wear the face of the parade and it marches harder." },
};
