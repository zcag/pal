// Writes app/src/gallery/shots/theater.json and bar-theater.json: the
// store screenshots' fixture. The rows and the popovers come out of the
// real extension run through the host harness against the tests' mock
// stack (host/test/extensions/theater-mock.ts); nothing here is the
// owner's. `bun run extensions/theater/fixture.ts`, then
// `node app/scripts/shots.mjs theater` and `node app/scripts/shots.mjs bar theater`.
import { writeFileSync } from "node:fs";
import { BUNDLED, Host, stored } from "../../host/test/harness.ts";
import { SETTINGS, server } from "../../host/test/extensions/theater-mock.ts";
import manifest from "./pal.json" with { type: "json" };

for (const k of Object.keys(process.env)) if (k.startsWith("PAL_THEATER_")) delete process.env[k];
process.env.PAL_NOW = "2026-09-16T10:30:00";
stored.clear();
const icon = manifest.icon;
const host = await Host.bundled({ roots: [BUNDLED], settings: { theater: { settings: SETTINGS } }, timeout: 20000 });
try {
  const loaded = (await host.hello()).extensions.find((x) => x.name === "theater")!;
  const meta = (name: string) => loaded.palettes.find((p) => p.name === name)!;
  const list = (p: string, q?: string, ctx?: Record<string, unknown>) => host.list("theater", p, q, ctx as never);
  const pal = async (name: string, extra: Record<string, unknown> = {}) => { const m = meta(name); return { title: m.title, icon, placeholder: m.placeholder, live: m.live || undefined, items: await list(name), ...extra }; };
  const search = async (name: string, queries: string[]) => { const m = meta(name); const byQuery: Record<string, unknown> = {}; for (const q of ["", ...queries]) byQuery[q] = await list(name, q); return { title: m.title, icon, input: true, placeholder: m.placeholder, byQuery }; };
  const details: Record<string, unknown> = {};
  for (const r of await list("jellyfin-search", "totoro")) details[r.id] = await host.detail("theater", "jellyfin-search", r.id);
  const bars: Record<string, unknown> = {};
  for (const id of ["downloads", "playing", "requests", "queue"]) bars[id] = await host.render("theater", id, { reason: "cli" });
  const fixture = {
    palettes: {
      theater: await pal("theater"),
      jellyfin: await pal("jellyfin"),
      "jellyfin-search": { ...(await search("jellyfin-search", ["totoro"])), details },
      "seerr-requests": await pal("seerr-requests"),
      "seerr-request": await search("seerr-request", ["dune"]),
      sonarr: await pal("sonarr"),
      "radarr-add": await search("radarr-add", ["oppenheimer"]),
      downloads: await pal("downloads"),
      "prowlarr-search": await search("prowlarr-search", ["ubuntu"]),
      navidrome: await pal("navidrome"),
      bazarr: await pal("bazarr"),
    },
    effects: { "downloads/cmd:limit": await host.pick("theater", "downloads", "cmd:limit") },
    shots: {
      "1-theater": { palette: "theater", keys: ["down*3", "wait:300"] },
      "2-jellyfin": { palette: "jellyfin", keys: ["down", "cmd+i", "wait:300"] },
      "3-requests": { palette: "seerr-requests", keys: ["wait:300"] },
      "4-sonarr": { palette: "sonarr", keys: ["down*6", "wait:300"] },
      "5-downloads": { palette: "downloads", keys: ["down*2", "wait:300"] },
      "6-indexers": { palette: "prowlarr-search", keys: ["type:ubuntu", "wait:700"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/theater.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  const barFixture = {
    key: "theater/downloads",
    title: manifest.bar.downloads.title,
    item: bars.downloads,
    states: [{ id: "paused", item: { icon: "\u{f03e4}", title: "paused · 2", color: "amber", tooltip: "2 in the queue, paused" } }],
    shots: {
      "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the combined download speed and how many items are active" },
      "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
      "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the queue: every item with its progress bar, space pauses everything" },
      "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the speed and the count" },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/bar-theater.json", import.meta.url), JSON.stringify(barFixture, null, 2) + "\n");
  console.log(`${fixture.palettes.theater.items.length} service rows, ${fixture.palettes.downloads.items.length} download rows, bar title ${(bars.downloads as { title: string }).title}`);
} finally {
  await host.close();
  server.stop(true);
}
