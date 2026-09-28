// Writes app/src/gallery/shots/weather.json and bar-weather.json, the store
// screenshots' fixtures: the palette's rows and the bar item drawn through
// the host harness against a stand-in Open-Meteo (geocoder and forecast)
// answering a made-up mid-September afternoon in Istanbul: showers
// clearing to a mild evening, then a thunderstorm for the red state.
// `bun run extensions/weather/fixture.ts`, then `make shots EXT=weather`.
import { pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host } from "../../host/test/harness.ts";

pinClock();
const ISTANBUL = { name: "Istanbul", country: "Republic of Türkiye", country_code: "TR", admin1: "Istanbul", population: 15701602, latitude: 41.01, longitude: 28.98 };
const DAY = "2026-09-16";
const hours = Array.from({ length: 24 }, (_, i) => `${DAY}T${String(i).padStart(2, "0")}:00`);
/** A value per hour from a table of `hour: value`, each holding until the next. */
const by = (at: Record<number, number>) => hours.map((_, i) => at[Math.max(...Object.keys(at).map(Number).filter((h) => h <= i))]);
const daily = (codes: number[], rain: number[]) => ({
  time: ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"],
  weather_code: codes,
  temperature_2m_max: [22, 25, 26, 24, 21],
  temperature_2m_min: [18, 18, 19, 18, 17],
  precipitation_probability_max: rain,
  sunrise: ["2026-09-16T06:44", "2026-09-17T06:45"],
  sunset: ["2026-09-16T19:08", "2026-09-17T19:06"],
});
const UNITS = { temperature_2m: "°C", wind_speed_10m: "km/h" };
/** 14:30, a shower passing over: 21 degrees, clearing by five. */
const SHOWERS = {
  current: { time: `${DAY}T14:30`, temperature_2m: 21, apparent_temperature: 21, relative_humidity_2m: 78, wind_speed_10m: 17, weather_code: 80, precipitation: 0.6, is_day: 1 },
  current_units: UNITS,
  hourly: { time: hours, temperature_2m: by({ 0: 18, 8: 19, 11: 22, 14: 21, 16: 22, 18: 21, 19: 20, 20: 19 }), weather_code: by({ 0: 3, 13: 80, 16: 3, 17: 2, 19: 3 }), precipitation_probability: by({ 0: 10, 13: 70, 15: 55, 16: 25, 17: 10 }) },
  daily: daily([80, 2, 0, 3, 61], [70, 10, 0, 20, 60]),
};
/** The same afternoon with a thunderstorm on top of the city. */
const STORM = {
  current: { time: `${DAY}T14:30`, temperature_2m: 19, apparent_temperature: 18, relative_humidity_2m: 88, wind_speed_10m: 32, weather_code: 95, precipitation: 4.2, is_day: 1 },
  current_units: UNITS,
  hourly: { time: hours, temperature_2m: by({ 0: 18, 8: 19, 11: 22, 14: 19, 16: 20, 18: 19 }), weather_code: by({ 0: 3, 13: 95, 16: 80, 17: 61, 18: 3 }), precipitation_probability: by({ 0: 10, 13: 90, 15: 80, 16: 60, 17: 40, 18: 15 }) },
  daily: daily([95, 2, 0, 3, 61], [90, 10, 0, 20, 60]),
};

let forecast: object = SHOWERS;
const server = Bun.serve({ port: 0, fetch: (req) => Response.json(new URL(req.url).pathname.includes("search") ? { results: [ISTANBUL] } : forecast) });
process.env.PAL_WEATHER_GEOCODE = `${server.url}v1/search`;
process.env.PAL_WEATHER_FORECAST = `${server.url}v1/forecast`;
const host = await Host.bundled({ settings: { weather: { settings: { location: "Istanbul, Turkey" } } } });
try {
  /** The item as the strip gets it: no rule matches either reading (not quiet, inside 10 to 30), so the condition's own tint stands. */
  const face = async () => { const { states: _s, empty: _e, ...item } = await host.render("weather", "weather"); return item; };
  const item = await face();
  forecast = STORM;
  const storm = await face();
  forecast = SHOWERS;
  const hosts = { [server.url.href]: "https://api.open-meteo.com" };
  writeFixture("bar-weather", await settle({
    key: "weather/weather",
    title: "Weather",
    item,
    states: [{ id: "storm", item: storm }],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar only when the weather is worth a look: a shower passing, its glyph and the temperature in blue" },
      "menubar-storm": { target: "menubar", state: "storm", caption: "A thunderstorm turns it red" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the reading now, the next eight hours, four days of forecast, sunrise and sunset" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the weather glyph and the temperature" },
    },
  }, { hosts }));

  const p = host.loaded().find((l) => l.extension === "weather")!.palettes[0];
  writeFixture("weather", await settle({
    palettes: { weather: { title: p.title, live: p.live, icon: p.icon, items: await host.list("weather", "weather") } },
    shots: {
      "1-current": { palette: "weather", keys: [], caption: "The temperature and condition for the place you set, then feels-like, humidity and wind" },
      "2-actions": { palette: "weather", keys: ["cmd+k"], caption: "The current reading opens the place on a map" },
    },
  }, { hosts }));
  console.log("weather.json, bar-weather.json: showers over Istanbul at 21°C, a thunderstorm");
} finally {
  host.kill();
  server.stop(true);
}
