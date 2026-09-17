import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

// Open-Meteo's geocoder searches one bare place name and answers nothing at all
// for "Istanbul, Turkey", so the fake matches the same way: anything looser here
// would pass while the real service returns an empty body.
const INDEX: Record<string, any[]> = {
  istanbul: [{ name: "Istanbul", country: "Republic of Türkiye", country_code: "TR", admin1: "Istanbul", population: 15701602, latitude: 41.01, longitude: 28.98 }],
  london: [
    { name: "London", country: "United Kingdom", country_code: "GB", admin1: "England", population: 8961989, latitude: 51.51, longitude: -0.13 },
    { name: "London", country: "Canada", country_code: "CA", admin1: "Ontario", population: 422324, latitude: 42.98, longitude: -81.23 },
  ],
};
const server = Bun.serve({ port: 0, fetch(req) {
  const url = new URL(req.url);
  if (url.pathname.includes("search")) { const hit = INDEX[(url.searchParams.get("name") ?? "").toLowerCase()]; return Response.json(hit ? { results: hit } : {}); }
  return Response.json({ current: { temperature_2m: 14, apparent_temperature: 12, relative_humidity_2m: 82, wind_speed_10m: 18, weather_code: 63, precipitation: 1.2 }, current_units: { temperature_2m: "°C", wind_speed_10m: "km/h" } });
} });
const configured = (location: string) => ({ settings: { location, low: 10, high: 30, notable_conditions: [] } });
let host: Host;
beforeAll(async () => { process.env.PAL_WEATHER_GEOCODE = `http://127.0.0.1:${server.port}/v1/search`; process.env.PAL_WEATHER_FORECAST = `http://127.0.0.1:${server.port}/v1/forecast`; host = await Host.bundled({ settings: { weather: configured("Istanbul, Turkey") } }); });
afterAll(() => { host.kill(); server.stop(true); delete process.env.PAL_WEATHER_GEOCODE; delete process.env.PAL_WEATHER_FORECAST; });
describe("weather", () => {
  test("a notable condition has an independent condition-led bar and compact palette", async () => {
    expect(await host.render("weather", "weather")).toMatchObject({ icon: "󰖗", title: "14°C", color: "blue", tooltip: "Rain in Istanbul" });
    expect((await host.list("weather", "weather")).map((x) => x.name)).toEqual(["14°C", "12°C", "82%", "18 km/h"]);
  });

  test("a country the geocoder cannot match still resolves the city it qualifies", async () => {
    // "Turkey" equals neither "Republic of Türkiye" nor "TR": the qualifier has to
    // rank the answers, never filter them, or this is the red unavailable state.
    const item = await host.render<any>("weather", "weather");
    expect(item.stale).toBeUndefined();
    expect(item.menu.view.title).toBe("Istanbul, Republic of Türkiye");
  });

  test("a qualifier chooses between same-named places, and population decides without one", async () => {
    host.changeSettings("weather", configured("London, Ontario"));
    expect((await host.render<any>("weather", "weather")).menu.view.title).toBe("London, Ontario, Canada");
    host.changeSettings("weather", configured("London"));
    expect((await host.render<any>("weather", "weather")).menu.view.title).toBe("London, England, United Kingdom");
  });

  test("a name that matches nothing is a visible failure naming what was searched", async () => {
    host.changeSettings("weather", configured("Nowhereville, Utah"));
    expect(await host.render("weather", "weather")).toMatchObject({ color: "red", stale: true, tooltip: "No place named “Nowhereville”" });
  });

  test("an empty location stays quiet and the manifest provides settings previews", async () => {
    host.changeSettings("weather", configured(""));
    expect(await host.render("weather", "weather")).toEqual({ hidden: true });
    expect(host.loaded().find((x) => x.extension === "weather")!.bar[0].mocks?.quiet.item).toEqual({ hidden: true });
  });
});

