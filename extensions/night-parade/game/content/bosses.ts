// Three mini-bosses and three bosses. Their moves are sim/bosses.ts; here
// are the numbers, the sprites and the words.

export type BossKind = "frog" | "tanuki" | "yurei" | "tengu" | "samurai" | "oni";

export type BossDef = {
  name: string; title: string; at: number; hp: number; speed: number; dmg: number; r: number;
  /** Minor bosses are the mid-act ones: smaller, a silver chest. */
  minor: boolean;
  /** Sprite strips (frames are square at the strip's height unless given) and the zoom they're drawn at. */
  sprites: { idle: string; walk?: string; hit?: string; attack?: string; charge?: string; zoom: number };
  face: string;
  lore: string;
};

export const BOSSES: Record<BossKind, BossDef> = {
  frog: {
    name: "Giant Frog", title: "Ōgama of the well", at: 150, hp: 650, speed: 30, dmg: 18, r: 12, minor: true,
    sprites: { idle: "frog-idle", hit: "frog-hit", attack: "frog-jump", zoom: 1 }, face: "frog-face",
    lore: "It hops at you and lands with a shockwave. Get out of the ring.",
  },
  tanuki: {
    name: "The Tanuki", title: "Shapeshifter of the old road", at: 300, hp: 2000, speed: 36, dmg: 16, r: 16, minor: false,
    sprites: { idle: "tanuki-idle", attack: "tanuki-attack", charge: "tanuki-charge", zoom: 1 }, face: "tanuki-face",
    lore: "Rolls at you, leaves leaf decoys of itself, and turns to stone to slam the ground.",
  },
  yurei: {
    name: "Yūrei", title: "The drowned bride", at: 450, hp: 1300, speed: 28, dmg: 16, r: 14, minor: true,
    sprites: { idle: "yurei-idle", hit: "yurei-hit", zoom: 1 }, face: "yurei-face",
    lore: "Blinks around you and breathes slow rings of wisps.",
  },
  tengu: {
    name: "The Tengu", title: "Lord of the mountain crows", at: 600, hp: 3000, speed: 38, dmg: 15, r: 16, minor: false,
    sprites: { idle: "tengu-idle", walk: "tengu-walk", hit: "tengu-hit", attack: "tengu-attack", zoom: 1 }, face: "tengu-face",
    lore: "Vanishes and reappears beside you, fans rings of feathers, and calls its crows.",
  },
  samurai: {
    name: "Red Samurai", title: "The general who never came home", at: 750, hp: 3200, speed: 34, dmg: 16, r: 14, minor: true,
    sprites: { idle: "samurai-idle", walk: "samurai-walk", hit: "samurai-hit", zoom: 1 }, face: "samurai-face",
    lore: "Draws a line, then dashes down it. Don't stand on the line.",
  },
  oni: {
    name: "The Oni", title: "Head of the Night Parade", at: 900, hp: 5500, speed: 32, dmg: 20, r: 22, minor: false,
    sprites: { idle: "oni-idle", walk: "oni-walk", hit: "oni-hit", zoom: 2 }, face: "oni-face",
    lore: "Slams the ground, throws its club, and calls the parade to it. Beat it and dawn breaks.",
  },
};

export const NIGHT = 900;
