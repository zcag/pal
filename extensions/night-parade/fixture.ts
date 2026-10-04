// Writes app/src/gallery/shots/night-parade.json: the store screenshots'
// fixture. Each palette seeds the page's storage: a save that has seen some
// nights (gold, unlocked heroes, a codex), and for the in-game shots a scene
// (surface/main.ts `Scene`): a night from a seed with a build, played forward
// by the bot, then shown live with the bot still playing. Chance is seeded in
// the page (shots.mjs), so a picture is the same every run.
// `make shots EXT=night-parade`.
import { Host } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { fresh, type Save, type Scene } from "./game/meta.ts";
import manifest from "./pal.json" with { type: "json" };

/** A save a few nights in: some gold, three heroes open, a codex half filled. */
function lived(): Save {
  const s = fresh();
  s.gold = 1840;
  s.unlocked = ["seimei", "ennen", "yumi", "ice", "geyser"];
  s.shrine = { might: 2, maxHp: 1, greed: 2, reroll: 1 };
  s.spent = 1380;
  s.seen = {
    weapons: ["shuriken", "katana", "fire", "thunder", "spirit", "rock", "kunai", "caltrop"], items: ["scroll", "tea", "whetstone", "herbs", "incense", "moon"],
    evolved: ["shuriken"], enemies: { slime: 812, bat: 640, larva: 402, mushroom: 377, snake: 298, tanuki: 210, kappa: 164, mole: 120, lantern: 98, skull: 150, owl: 71, skeleton: 55 }, bosses: { frog: 5, tanuki: 3 },
  };
  s.best = { kaze: { t: 571, dawn: 0, level: 34, kills: 2310 }, tomoe: { t: 318, dawn: 0, level: 21, kills: 980 } };
  s.totals = { nights: 9, dawns: 0, kills: 11240, gold: 3220 };
  return s;
}

const SCENES: Record<string, Scene> = {
  night: {
    hero: "kaze", seed: 7, t: 455, play: 28, level: 31,
    weapons: [["shuriken", 7], ["katana", 6], ["thunder", 5], ["fire", 4], ["spirit", 4]], items: [["scroll", 2], ["tea", 2], ["whetstone", 2], ["incense", 1]],
  },
  tengu: {
    hero: "kaze", seed: 11, t: 596, play: 12, level: 38,
    weapons: [["shuriken", 8, true], ["katana", 8, true], ["thunder", 7], ["fire", 6], ["rock", 5], ["spirit", 5]], items: [["scroll", 2], ["moon", 3], ["tea", 3], ["whetstone", 3], ["incense", 2], ["herbs", 2]],
  },
  levelup: {
    hero: "tomoe", seed: 3, t: 190, play: 6, level: 13, card: "levelup",
    weapons: [["katana", 4], ["rock", 2]], items: [["moon", 1]],
  },
  evolve: {
    hero: "kaze", seed: 5, t: 420, play: 4, level: 27, card: "chest",
    weapons: [["shuriken", 8], ["thunder", 5], ["fire", 4]], items: [["scroll", 1], ["tea", 2], ["whetstone", 2]],
  },
};

pinClock();
const host = await Host.bundled();
try {
  const view = await host.request("view", { extension: "night-parade", palette: "night-parade" });
  const palette = (scene?: Scene) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { save: lived(), ...(scene && { scene }) }, settings: {} } });
  writeFixture("night-parade", {
    palettes: {
      night: palette(SCENES.night), tengu: palette(SCENES.tengu), levelup: palette(SCENES.levelup), evolve: palette(SCENES.evolve), home: palette(),
    },
    shots: {
      "1-night": { palette: "night", keys: ["wait:1600"], caption: "Midnight, 8:06 into the night: shuriken, katana, thunder, fire talisman and spirit wisps against the Act II crowd" },
      "2-tengu": { palette: "tengu", keys: ["wait:1400"], caption: "10:10, the Tengu arrives; Storm of Stars and Crescent Moon already evolved" },
      "3-levelup": { palette: "levelup", keys: ["wait:700"], caption: "A level-up: three choices with what each adds, the item that evolves a weapon you carry starred" },
      "4-evolve": { palette: "evolve", keys: ["wait:3900"], caption: "A golden chest: the shuriken with its Scroll evolves into Storm of Stars, and four more upgrades" },
      "5-title": { palette: "home", keys: ["wait:1500"], caption: "The title, with a night playing behind it" },
      "6-heroes": { palette: "home", keys: ["wait:1200", "enter", "wait:500"], caption: "Who walks tonight: six heroes, each with a starting weapon and a trait; four open up by playing" },
    },
  });
  console.log("night-parade: 6 shots planned");
} finally {
  host.kill();
}
