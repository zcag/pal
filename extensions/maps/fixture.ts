// Writes app/src/gallery/shots/maps.json, the store screenshots' fixture:
// made-up home, work and saved places listed through the host harness,
// the autocomplete rows from a stand-in Places API. Nothing is the
// owner's. `bun run extensions/maps/fixture.ts`, then
// `node app/scripts/shots.mjs maps`.
import { writeFileSync } from "node:fs";
import { Host } from "../../host/test/harness.ts";

const places = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const { input } = (await req.json()) as { input: string };
    const at = (main: string, secondary: string, id: string) => ({ placePrediction: { placeId: id, text: { text: `${main}, ${secondary}` }, structuredFormat: { mainText: { text: main }, secondaryText: { text: secondary } } } });
    return Response.json({ suggestions: [at(`${input}ili Parkı`, "Caferağa, Kadıköy/İstanbul", "ChIJ1"), at(`${input}ili Yürüyüş Yolu`, "Moda, Kadıköy/İstanbul", "ChIJ2"), at("Moda Sahil Cafe", "Moda Cd., Kadıköy/İstanbul", "ChIJ3")] });
  },
});
process.env.PAL_MAPS_PLACES = `http://127.0.0.1:${places.port}`;
const settings = { home: "Moda, Kadıköy, İstanbul", work: "Levent, Beşiktaş, İstanbul", places: ["Gym = Kadıköy Belediyesi Spor Salonu", "Airport = İstanbul Havalimanı", "Parents = Bornova, İzmir"] };
const host = await Host.bundled({ settings: { maps: { settings } } });
try {
  const meta = host.loaded().find((l) => l.extension === "maps")!.palettes[0];
  const byQuery: Record<string, unknown> = {
    "": await host.list("maps", "maps", ""),
    "kadıköy": await host.list("maps", "maps", "kadıköy"),
    "home > work": await host.list("maps", "maps", "home > work", { filter: "walking" }),
  };
  host.changeSettings("maps", { settings: { ...settings, api_key: "good" } });
  byQuery["Moda Sah"] = await host.list("maps", "maps", "Moda Sah");
  const fixture = {
    palettes: { maps: { title: meta.title, icon: meta.icon, input: true, placeholder: meta.placeholder, filters: meta.filters, byQuery } },
    shots: {
      "1-places": { palette: "maps", keys: ["down"] },
      "2-search": { palette: "maps", keys: ["type:kadıköy"] },
      "3-route": { palette: "maps", keys: ["type:home > work", "tab", "tab"] },
      "4-autocomplete": { palette: "maps", keys: ["type:Moda Sah", "wait:400", "down*4"] },
      "5-actions": { palette: "maps", keys: ["type:kadıköy", "down*5", "cmd+k"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/maps.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/maps.json");
} finally {
  host.kill();
  places.stop(true);
}
