// Writes app/src/gallery/shots/gifs.json, the store screenshots' fixture:
// the grid listed through the host harness against the Giphy mock
// (host/test/extensions/gifs-mock.ts), whose "GIFs" are generated
// pictures, with a favourites list of two. Nothing is the owner's; the
// detail pane's preview, which the mock serves, is inlined by `settle`.
// `bun run extensions/gifs/fixture.ts`, then `node app/scripts/shots.mjs gifs`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host, stored } from "../../host/test/harness.ts";
import { startMock } from "../../host/test/extensions/gifs-mock.ts";

const { server, base } = startMock();
const cache = mkdtempSync(join(tmpdir(), "pal-gifs-fixture-"));
process.env.PAL_GIFS_GIPHY = base;
process.env.PAL_GIFS_CACHE = cache;
stored.clear();
pinClock();
const host = await Host.bundled({ settings: { gifs: { settings: { giphy_api_key: "good" } } } });
try {
  const l = host.loaded().find((l) => l.extension === "gifs")!;
  const [gifs, favourites] = l.palettes;
  const trending = await host.list("gifs", "gifs", "");
  const cat = await host.list("gifs", "gifs", "cat");
  await host.pick("gifs", "gifs", cat[0].id, "fav");
  await host.pick("gifs", "gifs", trending[2].id, "fav");
  const favs = await host.list("gifs", "favourites");
  // Another filter too: the listing cache is keyed on the filter and the query, not the key (as gifs.test.ts does).
  host.changeSettings("gifs", { settings: { giphy_api_key: "", content_filter: "high" } });
  const noKey = await host.list("gifs", "gifs", "");
  const meta = { icon: gifs.icon, input: true, view: "grid", columns: gifs.columns, placeholder: gifs.placeholder };
  const fixture = {
    palettes: {
      gifs: { title: gifs.title, ...meta, byQuery: { "": trending, cat } },
      favourites: { title: favourites.title, icon: favourites.icon, view: "grid", live: true, columns: favourites.columns, placeholder: favourites.placeholder, items: favs },
      nokey: { title: gifs.title, ...meta, byQuery: { "": noKey } },
    },
    shots: {
      "1-trending": { palette: "gifs", keys: ["right*2"], caption: "Nothing typed: Giphy's trending GIFs as a grid" },
      "2-search": { palette: "gifs", keys: ["type:cat", "wait:400", "cmd+i"], caption: "Typing cat: the matches, and the detail pane with the preview, its size and its page" },
      "3-actions": { palette: "gifs", keys: ["type:cat", "wait:400", "cmd+k"], caption: "What a GIF can do: copy the file, copy the url, open, save, favourite" },
      "4-favourites": { palette: "favourites", keys: ["right"], caption: "Favourite GIFs: the ones cmd+f kept, and a tile to clear them" },
      "5-no-key": { palette: "nokey", keys: [], caption: "Without a key: one row saying where to get one" },
    },
  };
  writeFixture("gifs", await settle(fixture, { hosts: { [base]: "https://media.giphy.example" } }));
  console.log("wrote app/src/gallery/shots/gifs.json");
} finally {
  host.kill();
  server.stop(true);
  rmSync(cache, { recursive: true, force: true });
}
