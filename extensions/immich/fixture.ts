// Writes app/src/gallery/shots/immich.json, the store screenshots' fixture:
// the grids and lists through the host harness against the Immich mock
// (host/test/extensions/immich-mock.ts), whose pictures are generated.
// Nothing is the owner's. `bun run extensions/immich/fixture.ts`, then
// `node app/scripts/shots.mjs immich`.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, stored } from "../../host/test/harness.ts";
import { startMock } from "../../host/test/extensions/immich-mock.ts";
import type { Item } from "../../sdk/src/protocol.ts";

const { server, base } = startMock();
const cache = mkdtempSync(join(tmpdir(), "pal-immich-fixture-"));
process.env.PAL_IMMICH_CACHE = cache;
process.env.PAL_NOW = "2026-09-22T10:00:00";
stored.clear();
const host = await Host.bundled({ settings: { immich: { settings: { url: base, api_key: "admin", web_url: "https://photos.example.com" } } } });
try {
  const l = host.loaded().find((l) => l.extension === "immich")!;
  const [grid, albums, people, memories] = l.palettes;
  // The pane's picture is the core's file route over the cache, which the gallery cannot serve: the tile's own data url stands in.
  const inline = (rows: Item[]) => rows.map((r) => ({ ...r, detail: r.detail && { ...r.detail, markdown: (r.icon as { image?: string })?.image ? `![](${(r.icon as { image: string }).image})` : undefined } }));
  const recent = inline(await host.list("immich", "immich", ""));
  const receipt = inline(await host.list("immich", "immich", "receipt"));
  const albumRows = await host.list("immich", "albums");
  const peopleRows = await host.list("immich", "people");
  const memoryRows = await host.list("immich", "memories");
  host.changeSettings("immich", { settings: { url: "", api_key: "" } });
  await Bun.sleep(50);
  const setup = await host.list("immich", "immich", "");
  const meta = { icon: grid.icon, input: true, view: "grid", columns: grid.columns, placeholder: grid.placeholder, showDetail: true, filters: grid.filters };
  const list = (p: typeof albums, items: Item[]) => ({ title: p.title, icon: p.icon, placeholder: p.placeholder, live: p.live, items });
  const fixture = {
    palettes: {
      immich: { title: grid.title, ...meta, byQuery: { "": recent, receipt } },
      albums: list(albums, albumRows),
      people: list(people, peopleRows),
      memories: list(memories, memoryRows),
      setup: { title: grid.title, ...meta, showDetail: false, byQuery: { "": setup } },
    },
    shots: {
      "1-recent": { palette: "immich", keys: [] },
      "2-search": { palette: "immich", keys: ["type:receipt", "wait:400", "right"] },
      "3-actions": { palette: "immich", keys: ["type:receipt", "wait:400", "cmd+k"] },
      "4-albums": { palette: "albums", keys: ["down"] },
      "5-people": { palette: "people", keys: [] },
      "6-memories": { palette: "memories", keys: [] },
      "7-setup": { palette: "setup", keys: [] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/immich.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/immich.json");
} finally {
  host.kill();
  server.stop(true);
  rmSync(cache, { recursive: true, force: true });
}
