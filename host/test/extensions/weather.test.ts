import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

const server = Bun.serve({ port: 0, fetch(req) { const path = new URL(req.url).pathname; if (path.includes("search")) return Response.json({ results: [{ name: "Istanbul", country: "Turkey", latitude: 41.01, longitude: 28.98 }] }); return Response.json({ current: { temperature_2m: 14, apparent_temperature: 12, relative_humidity_2m: 82, wind_speed_10m: 18, weather_code: 63, precipitation: 1.2 }, current_units: { temperature_2m: "°C", wind_speed_10m: "km/h" } }); } });
let host: Host;
beforeAll(async () => { process.env.PAL_WEATHER_GEOCODE = `http://127.0.0.1:${server.port}/v1/search`; process.env.PAL_WEATHER_FORECAST = `http://127.0.0.1:${server.port}/v1/forecast`; host = await Host.bundled({ settings: { weather: { settings: { location: "Istanbul, Turkey", low: 10, high: 30, notable_conditions: [] } } } }); });
afterAll(() => { host.kill(); server.stop(true); delete process.env.PAL_WEATHER_GEOCODE; delete process.env.PAL_WEATHER_FORECAST; });
describe("weather", () => {
  test("a notable condition has an independent condition-led bar and compact palette", async () => {
    expect(await host.render("weather", "weather")).toMatchObject({ icon: "󰖗", title: "14°C", color: "blue", tooltip: "Rain in Istanbul" });
    expect((await host.list("weather", "weather")).map((x) => x.name)).toEqual(["14°C", "12°C", "82%", "18 km/h"]);
  });
  test("an empty location stays quiet and the manifest provides settings previews", async () => {
    host.changeSettings("weather", { settings: { location: "", low: 10, high: 30, notable_conditions: [] } });
    expect(await host.render("weather", "weather")).toEqual({ hidden: true });
    expect(host.loaded().find((x) => x.extension === "weather")!.bar[0].mocks?.quiet.item).toEqual({ hidden: true });
  });
});
