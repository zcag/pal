// Writes app/src/gallery/shots/highway.json: the store screenshots' fixture.
// Each palette seeds the page's storage: a save a few hours in, and a scene
// (game/meta.ts `Scene`) that stages the garage, a run already going (played
// forward by the page's own driver, then shown live) or a run's end. Chance is
// seeded in the page (shots.mjs), so a picture is the same every run.
// `make shots EXT=highway`.
import { Host } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { fresh, type Save, type Scene } from "./game/meta.ts";
import manifest from "./pal.json" with { type: "json" };

/** A save a few hours in: some cash, a handful of cars with upgrades, level 14 (every mode and place open). */
function lived(): Save {
  const s = fresh();
  s.cash = 18400;
  const own = (id: string, paint: string, speed = 0, handling = 0, brakes = 0, nitro = 0) => { s.owned[id] = { upgrades: { speed, handling, brakes, nitro }, paint, paints: [paint] }; };
  own("compact-07", "#e8e6e0", 2, 1, 1);
  own("milano-95", "#c81d25", 3, 2, 2);
  own("thunderbolt-96", "#1b3f8f", 2, 3, 1);
  own("stinger-96", "#d6421a", 1, 1, 0);
  own("saba-v12-95", "#e85d04");
  s.car = "stinger-96";
  s.level = 14;
  s.xp = 1100;
  s.missions = [
    { kind: "misses", text: "Pass 22 cars closely in one run", target: 22, reward: { cash: 2050, xp: 500 } },
    { kind: "combo", text: "Reach a ×11 combo", target: 11, reward: { cash: 2050, xp: 500 } },
    { kind: "speed", text: "Reach 210 km/h", target: 210, reward: { cash: 2050, xp: 500 } },
  ];
  s.best = { endless: { score: 186420, distance: 14820, combo: 23, topSpeed: 281 }, twoway: { score: 98410, distance: 6210, combo: 12, topSpeed: 244 } };
  s.totals = { runs: 61, distance: 412000, misses: 2210, cash: 512000 };
  return s;
}

const SCENES: Record<string, Scene> = {
  run: { show: "run", location: "countryside", mode: "endless", car: "stinger-96", paint: "#d6421a", speed: 196, warm: 9 },
  garage: { show: "garage", location: "dusk", mode: "endless", car: "saba-v12-95", paint: "#e85d04" },
  night: { show: "run", location: "night", mode: "endless", car: "thunderbolt-96", paint: "#1b3f8f", speed: 172, warm: 8 },
  twoway: { show: "run", location: "midday", mode: "twoway", car: "milano-95", paint: "#c81d25", speed: 150, warm: 5 },
  results: { show: "results", location: "dusk", mode: "endless", car: "stinger-96", paint: "#d6421a", speed: 200, warm: 40, crash: { you: 214, them: 96, kind: "lct-3000-95", oncoming: false } },
};

pinClock();
const host = await Host.bundled();
try {
  const view = await host.request("view", { extension: "highway", palette: "highway" });
  const palette = (scene: Scene) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { save: lived(), scene }, settings: {} } });
  writeFixture("highway", {
    palettes: Object.fromEntries(Object.entries(SCENES).map(([k, s]) => [k, palette(s)])),
    shots: {
      "1-run": { palette: "run", keys: ["wait:30000"], caption: "196 km/h through countryside traffic in the Stinger '96, the drivers signalling and keeping their gaps" },
      "2-garage": { palette: "garage", keys: ["wait:30000"], caption: "The garage: choose, paint and upgrade your car, pick the mode and place; your level, the next unlock and three missions beside it" },
      "3-night": { palette: "night", keys: ["wait:30000"], caption: "A night run: headlights on the road, tail lamps ahead, brake lights when a driver slows" },
      "4-twoway": { palette: "twoway", keys: ["wait:30000"], caption: "Two-Way at high noon: the oncoming side pays three times, and touching it ends the run" },
      "5-results": { palette: "results", keys: ["wait:30000"], caption: "The end of a run: the pay counted up line by line, the XP toward your next level, and how far each mission got" },
    },
  });
  console.log("highway: 5 shots planned");
} finally {
  host.kill();
}
