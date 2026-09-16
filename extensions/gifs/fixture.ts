// Writes app/src/gallery/shots/gifs.json, the store screenshots' fixture:
// the grid listed through the host harness against the Tenor mock
// (host/test/extensions/gifs-mock.ts), whose "GIFs" are generated
// pictures, with a favourites list of two. Nothing is the owner's.
// `bun run extensions/gifs/fixture.ts`, then `node app/scripts/shots.mjs gifs`.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, stored } from "../../host/test/harness.ts";
import { startMock } from "../../host/test/extensions/gifs-mock.ts";
import type { Item } from "../../sdk/src/protocol.ts";

const { server, base } = startMock();
const cache = mkdtempSync(join(tmpdir(), "pal-gifs-fixture-"));
process.env.PAL_GIFS_TENOR = base;
process.env.PAL_GIFS_CACHE = cache;
stored.clear();
const host = await Host.bundled({ settings: { gifs: { settings: { tenor_api_key: "good" } } } });
try {
  const l = host.loaded().find((l) => l.extension === "gifs")!;
  const [gifs, favourites] = l.palettes;
  // The detail pane's picture is the preview's url, which the mock serves; for the shot it is the tile's own data url.
  const inline = (rows: Item[]) => rows.map((r) => ({ ...r, detail: r.detail && { ...r.detail, markdown: r.detail.markdown!.replace(/!\[\]\([^)]*\)/, `![](${(r.icon as { image: string }).image})`) } }));
  const trending = inline(await host.list("gifs", "gifs", ""));
  const cat = inline(await host.list("gifs", "gifs", "cat"));
  await host.pick("gifs", "gifs", cat[0].id, "fav");
  await host.pick("gifs", "gifs", trending[2].id, "fav");
  const favs = inline(await host.list("gifs", "favourites"));
  host.changeSettings("gifs", { settings: { tenor_api_key: "" } });
  const noKey = await host.list("gifs", "gifs", "");
  const meta = { icon: gifs.icon, input: true, view: "grid", columns: gifs.columns, placeholder: gifs.placeholder };
  const fixture = {
    palettes: {
      gifs: { title: gifs.title, ...meta, byQuery: { "": trending, cat } },
      favourites: { title: favourites.title, icon: favourites.icon, view: "grid", live: true, columns: favourites.columns, placeholder: favourites.placeholder, items: favs },
      nokey: { title: gifs.title, ...meta, byQuery: { "": noKey } },
    },
    shots: {
      "1-trending": { palette: "gifs", keys: ["right*2"] },
      "2-search": { palette: "gifs", keys: ["type:cat", "wait:400", "cmd+i"] },
      "3-actions": { palette: "gifs", keys: ["type:cat", "wait:400", "cmd+k"] },
      "4-favourites": { palette: "favourites", keys: ["right"] },
      "5-no-key": { palette: "nokey", keys: [] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/gifs.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/gifs.json");
} finally {
  host.kill();
  server.stop(true);
  rmSync(cache, { recursive: true, force: true });
}
