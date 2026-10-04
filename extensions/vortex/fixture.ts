// Writes app/src/gallery/shots/vortex.json: the store screenshots' fixture.
// Each palette seeds the page's storage: a save some sessions in, and for the
// in-game shots a scene (surface/main.ts `stage`): a run from a seed played
// forward by the bot, then shown live with the bot still steering, or ended
// there for the death card. Chance is seeded in the page (shots.mjs), so a
// picture is the same every run. `make shots EXT=vortex`.
import { Host } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { fresh, type Save, type Scene } from "./game/meta.ts";
import manifest from "./pal.json" with { type: "json" };

/** A save some sessions in: three stages cleared, a fourth on its way, a hyper begun. */
function lived(): Save {
  const s = fresh();
  s.boards = {
    pulse: { best: 74.38, tries: 61, time: 1420 },
    drift: { best: 63.05, tries: 88, time: 2210 },
    prism: { best: 61.7, tries: 104, time: 2650 },
    undertow: { best: 47.82, tries: 57, time: 1310 },
    "pulse+": { best: 33.4, tries: 23, time: 410 },
  };
  s.last = "undertow";
  return s;
}

const SCENES: Record<string, Scene> = {
  pulse: { screen: "run", board: "pulse", seed: 21, t: 24.4 },
  prism: { screen: "run", board: "prism", seed: 8, t: 33.2 },
  undertow: { screen: "run", board: "undertow", seed: 4, t: 46.1 },
  singularity: { screen: "run", board: "singularity+", seed: 13, t: 51.5 },
  over: { screen: "over", board: "undertow", seed: 2, t: 42.61 },
  title: { screen: "title", board: "undertow" },
};

pinClock();
const host = await Host.bundled({ only: ["vortex"] });
try {
  const view = await host.request("view", { extension: "vortex", palette: "vortex" });
  const palette = (scene: Scene) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { save: lived(), scene }, settings: {} } });
  const shots: Record<string, { palette: string; keys: string[]; caption: string }> = {
    "1-pulse": { palette: "pulse", keys: ["wait:1500"], caption: "Pulse, 27 seconds in: past Triangle, a run of gaps to read while the world turns" },
    "2-prism": { palette: "prism", keys: ["wait:1500"], caption: "Prism at Square: the centre changes shape between patterns and the colours never sit still" },
    "3-undertow": { palette: "undertow", keys: ["wait:1500"], caption: "Undertow's steep camera and half-time song, the moment a record falls: the time turns gold" },
    "4-singularity": { palette: "singularity", keys: ["wait:1500"], caption: "Singularity in hyper: the last stage, faster, in its other colours" },
    "5-over": { palette: "over", keys: ["wait:1800"], caption: "A death: the walls roll back, and the card says how close the record and the next rank were; Space is the next run" },
    "6-title": { palette: "title", keys: ["wait:1500"], caption: "The stages, each playing itself behind its card: your best, its rank and your tries" },
  };
  writeFixture("vortex", { palettes: Object.fromEntries(Object.keys(SCENES).map((k) => [k, palette(SCENES[k])])), shots });
  console.log("vortex: 6 shots planned");
} finally {
  host.kill();
}
