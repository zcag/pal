// Writes app/src/gallery/shots/maps.json, the store screenshots' fixture:
// made-up home, work and saved places listed through the host harness,
// the autocomplete rows from a stand-in Places API. Nothing is the
// owner's. `make shots EXT=maps`.
import { pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
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
pinClock();
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
    // True colour: on the dark wallpaper the 256-colour quantisation tints the text green (it keeps the pins' green, not the greys).
    shots: {
      "1-places": { palette: "maps", keys: ["down"], caption: "Nothing typed: Home, Work, the commute both ways and the saved places" },
      "2-search": { palette: "maps", keys: ["wait:400", "type:kadıköy"], caption: "kadıköy typed: Search, directions from here, home and work, a saved place that matches" },
      "3-route": { palette: "maps", keys: ["wait:400", "type:home > work", "tab", "tab"], caption: "home > work: the route and its reverse, walking chosen as the mode" },
      "4-autocomplete": { palette: "maps", keys: ["wait:400", "type:Moda Sah", "wait:400", "down*4"], caption: "With a Places API key: predictions under the rows" },
      "5-actions": { palette: "maps", keys: ["wait:400", "type:kadıköy", "down*5", "cmd+k"], caption: "What a place can do: open, directions from here, from home, from work, copy the address or the link" },
    },
  };
  writeFixture("maps", await settle(fixture));
  console.log("wrote app/src/gallery/shots/maps.json");
} finally {
  host.kill();
  places.stop(true);
}
