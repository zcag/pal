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
    pulse: { best: 74.38, tries: 61, time: 1420, medals: ["clear", "steady", "hairline"] },
    drift: { best: 63.05, tries: 88, time: 2210, medals: ["clear", "hairline"] },
    prism: { best: 61.7, tries: 104, time: 2650, medals: ["clear"] },
    undertow: { best: 47.82, tries: 57, time: 1310 },
    "pulse+": { best: 33.4, tries: 23, time: 410 },
  };
  s.last = "undertow";
  s.skin = "arrow";
  return s;
}

const SCENES: Record<string, Scene> = {
  pulse: { screen: "run", board: "pulse", t: 24.4 },
  undertow: { screen: "run", board: "undertow", t: 46.1 },
  singularity: { screen: "run", board: "singularity+", t: 51.5 },
  over: { screen: "over", board: "drift", t: 42.61 },
  title: { screen: "title", board: "undertow" },
  look: { screen: "look", board: "undertow" },
};

pinClock();
const host = await Host.bundled({ only: ["vortex"] });
try {
  const view = await host.request("view", { extension: "vortex", palette: "vortex" });
  const palette = (scene: Scene) => ({ title: manifest.title, icon: manifest.icon, view: "view", tree: view, surface: { storage: { save: lived(), scene }, settings: {} } });
  const shots: Record<string, { palette: string; keys: string[]; caption: string }> = {
    "1-pulse": { palette: "pulse", keys: ["wait:1500"], caption: "Pulse: a neon grid far below, walls that read at a glance, and you, racing a minute against the song" },
    "2-undertow": { palette: "undertow", keys: ["wait:1500"], caption: "Undertow: caustics and bubbles under a half-time song, the moment a record falls" },
    "3-singularity": { palette: "singularity", keys: ["wait:1500"], caption: "Singularity in hyper: a black hole at the centre, the last stage, faster" },
    "4-over": { palette: "over", keys: ["wait:1700"], caption: "A death replays slowly with the wall that got you outlined; the card says how close the record and the next rank were" },
    "5-title": { palette: "title", keys: ["wait:1500"], caption: "The stages, each playing itself behind its card: your best, its rank, your medals, practice from a rank you reached" },
    "6-look": { palette: "look", keys: ["wait:900"], caption: "Medals open new shapes and trails for the player; the ghost of your best run, on or off" },
  };
  writeFixture("vortex", { palettes: Object.fromEntries(Object.keys(SCENES).map((k) => [k, palette(SCENES[k])])), shots });
  console.log("vortex: 6 shots planned");
} finally {
  host.kill();
}
