// Writes app/src/gallery/shots/games.json, the store screenshots' fixture:
// the rows as index.ts lists them through the host harness, from the
// repo's own manifests (every bundled game with its tile and tagline, as a
// user with nothing from the store sees them). `bun run
// extensions/games/fixture.ts`, then `make shots EXT=games`.
import { readdirSync } from "node:fs";
import { BUNDLED, Host } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
const installed = readdirSync(BUNDLED, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ name: d.name, version: "0.1.0", root: BUNDLED, loaded: true, store: false, bundled: true }));
// Nothing on offer: the pictures show the games that come with pal.
const host = await Host.bundled({ core: { "extensions.list": () => installed, "store.state": () => ({ available: [] }) } });
try {
  const items = await host.list("games", "games");
  writeFixture("games", {
    palettes: { games: { title: manifest.title, icon: manifest.icon, live: true, items } },
    shots: {
      "1-list": { palette: "games", keys: [], caption: "Every game pal has, by name, each with its tile and what it is" },
      "2-search": { palette: "games", keys: ["type:daily"], caption: "Typing narrows the list, taglines included: daily finds the daily puzzles; Enter opens one" },
    },
  });
  console.log(`wrote app/src/gallery/shots/games.json: ${items.length} games`);
} finally {
  host.kill();
}
