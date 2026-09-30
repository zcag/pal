// The parade: twenty-four kinds of enemy, each a 16 px sprite from the pack
// with a behaviour. Numbers are at minute 0; the stage scales health with
// the minute (stage.ts `pressure`).

export type EnemyKind =
  | "slime" | "slimelet" | "bat" | "larva" | "mushroom" | "snake" | "mole" | "tanuki" | "kappa" | "lantern"
  | "skull" | "owl" | "spirit" | "skeleton" | "eye" | "octopus" | "bamboo" | "cyclops"
  | "imp" | "onibi" | "beast" | "dragon" | "panda" | "crow" | "goldtanuki";

/**
 * chase: walks at you. weave: zigzags. lunge: shivers, then charges. shoot:
 * keeps its distance and fires. burrow: travels underground and surfaces
 * beside you. blink: fades out and reappears near you. flee: runs away.
 */
export type Gait = "chase" | "weave" | "lunge" | "shoot" | "burrow" | "blink" | "flee";

export type ShotKind = "water" | "bolt" | "ink" | "flame" | "feather" | "wisp" | "club";

export type EnemyDef = {
  name: string; sprite: string; hp: number; speed: number; dmg: number; xp: number; r: number; gait: Gait;
  /** Flyers draw above the crowd and cast a smaller shadow. */
  flies?: boolean;
  /** 0 is pushed like anything, 1 not at all. */
  steady?: number;
  shot?: { kind: ShotKind; every: number; speed: number; dmg: number; range: number };
  /** What happens when it dies: slimes split, onibi burst. */
  death?: "split" | "burst" | "spores";
  lore: string;
};

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  slime: { name: "Slime", sprite: "slime", hp: 7, speed: 30, dmg: 6, xp: 1, r: 6, gait: "chase", death: "split", lore: "Splits in two when cut. The halves are weaker and angrier." },
  slimelet: { name: "Slimelet", sprite: "slime2", hp: 3, speed: 34, dmg: 3, xp: 0.5, r: 4, gait: "chase", lore: "Half a slime, twice the hurry." },
  bat: { name: "Bat", sprite: "bat", hp: 4, speed: 48, dmg: 5, xp: 1, r: 5, gait: "weave", flies: true, lore: "Weaves as it flies. Comes in clouds." },
  larva: { name: "Larva", sprite: "larva", hp: 12, speed: 26, dmg: 6, xp: 1, r: 6, gait: "chase", lore: "Slow, soft, and never alone." },
  mushroom: { name: "Mushroom", sprite: "mushroom", hp: 16, speed: 29, dmg: 7, xp: 2, r: 6, gait: "chase", death: "spores", lore: "Walks in rings. Leaves spores when it bursts." },
  snake: { name: "Snake", sprite: "snake", hp: 13, speed: 42, dmg: 9, xp: 2, r: 5, gait: "lunge", lore: "Coils, shivers, strikes." },
  mole: { name: "Mole", sprite: "mole", hp: 20, speed: 46, dmg: 10, xp: 2, r: 6, gait: "burrow", lore: "Travels under the road. Watch for the earth heaving toward you." },
  tanuki: { name: "Tanuki", sprite: "racoon", hp: 22, speed: 36, dmg: 8, xp: 2, r: 6, gait: "weave", lore: "A trickster raccoon dog, running with the parade for the fun of it." },
  kappa: { name: "Kappa", sprite: "kappa", hp: 26, speed: 30, dmg: 8, xp: 3, r: 6, gait: "shoot", shot: { kind: "water", every: 2.8, speed: 90, dmg: 8, range: 110 }, lore: "River imp. Spits water from the dish on its head." },
  lantern: { name: "Chōchin-obake", sprite: "lantern", hp: 24, speed: 30, dmg: 10, xp: 3, r: 6, gait: "weave", flies: true, lore: "A paper lantern grown a tongue. The parade's own light." },
  skull: { name: "Skull", sprite: "skull", hp: 16, speed: 50, dmg: 13, xp: 1.5, r: 5, gait: "chase", flies: true, lore: "Fast, hollow, and in a hurry." },
  owl: { name: "Owl", sprite: "owl", hp: 28, speed: 48, dmg: 10, xp: 2, r: 6, gait: "lunge", flies: true, lore: "Watches, then swoops." },
  spirit: { name: "Spirit", sprite: "spirit", hp: 24, speed: 44, dmg: 9, xp: 2, r: 6, gait: "blink", flies: true, lore: "Fades out, and is beside you." },
  skeleton: { name: "Gashadokuro's kin", sprite: "skeleton", hp: 40, speed: 32, dmg: 13, xp: 2, r: 6, gait: "chase", lore: "The hungry dead, climbing out of old graves." },
  eye: { name: "Floating eye", sprite: "eye", hp: 34, speed: 36, dmg: 12, xp: 2, r: 6, gait: "shoot", flies: true, shot: { kind: "bolt", every: 2.3, speed: 105, dmg: 7, range: 130 }, lore: "Keeps its distance and stares bolts at you." },
  octopus: { name: "Octopus", sprite: "octopus", hp: 70, speed: 30, dmg: 14, xp: 3, r: 7, gait: "shoot", steady: 0.3, shot: { kind: "ink", every: 2.7, speed: 85, dmg: 8, range: 110 }, lore: "Its ink slows you to a crawl." },
  bamboo: { name: "Walking bamboo", sprite: "bamboo", hp: 90, speed: 24, dmg: 14, xp: 3, r: 7, gait: "chase", steady: 0.6, lore: "A grove that decided to walk. Hard to push." },
  cyclops: { name: "Hitotsume-kozō", sprite: "cyclops", hp: 100, speed: 32, dmg: 12, xp: 3, r: 7, gait: "chase", steady: 0.4, lore: "The one-eyed boy. Bigger than the stories say." },
  imp: { name: "Oni imp", sprite: "imp", hp: 70, speed: 44, dmg: 9, xp: 2, r: 6, gait: "lunge", lore: "Small oni, all horns and temper." },
  onibi: { name: "Onibi", sprite: "onibi", hp: 60, speed: 54, dmg: 10, xp: 2, r: 6, gait: "weave", flies: true, death: "burst", lore: "Demon fire. It bursts when it dies: step out of the ring." },
  beast: { name: "Beast", sprite: "beast", hp: 150, speed: 40, dmg: 12, xp: 3, r: 7, gait: "lunge", steady: 0.5, lore: "Something with too many teeth. Charges." },
  dragon: { name: "Young dragon", sprite: "dragon", hp: 140, speed: 38, dmg: 18, xp: 3, r: 7, gait: "shoot", flies: true, shot: { kind: "flame", every: 2.5, speed: 100, dmg: 8, range: 140 }, lore: "Small for a dragon. Breathes fire anyway." },
  panda: { name: "Panda", sprite: "panda", hp: 230, speed: 30, dmg: 12, xp: 4, r: 8, gait: "chase", steady: 0.7, lore: "Nobody knows why it joined. Nobody asks." },
  crow: { name: "Crow", sprite: "crow", hp: 30, speed: 66, dmg: 8, xp: 1, r: 5, gait: "weave", flies: true, lore: "The Tengu's messengers." },
  goldtanuki: { name: "Golden tanuki", sprite: "goldracoon", hp: 500, speed: 64, dmg: 0, xp: 20, r: 6, gait: "flee", steady: 0.8, lore: "Catch it before it gets away: it carries a fortune." },
};
