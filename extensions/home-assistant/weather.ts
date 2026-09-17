// The weather bar's pure half: Home Assistant states in, a compact weather
// model and declarative popover out. Keeping this separate from index.ts lets
// the REST client stay the sole IO boundary and makes condition/threshold
// behaviour straightforward to test.
import type { BarColor, View, ViewNode } from "@zcag/pal";
import type { State } from "./ha.ts";

export type WeatherSettings = {
  temperature_entity?: string;
  weather_entity?: string;
  temperature_low?: number;
  temperature_high?: number;
  notable_conditions?: unknown[];
};

export type Weather = {
  temperature: number;
  unit: string;
  condition: string;
  conditionLabel: string;
  glyph: string;
  conditionColor: BarColor;
  feelsLike?: string;
  humidity?: string;
  wind?: string;
  updated: string;
};

export const DEFAULT_TEMPERATURE_ENTITY = "sensor.outdoor_temperature";
export const DEFAULT_WEATHER_ENTITY = "weather.forecast_home";
export const DEFAULT_LOW = 10;
export const DEFAULT_HIGH = 30;
export const DEFAULT_NOTABLE = ["rainy", "pouring", "lightning", "lightning-rainy", "snowy", "snowy-rainy", "fog", "windy", "windy-variant", "hail", "exceptional"];

type Look = { glyph: string; color: BarColor };
const LOOK: Record<string, Look> = {
  sunny: { glyph: "󰖙", color: "amber" }, clear: { glyph: "󰖙", color: "amber" }, "clear-night": { glyph: "󰖔", color: "muted" },
  partlycloudy: { glyph: "󰖕", color: "amber" }, cloudy: { glyph: "󰖐", color: "muted" },
  rainy: { glyph: "󰖗", color: "blue" }, pouring: { glyph: "󰖖", color: "blue" },
  lightning: { glyph: "󰖘", color: "red" }, "lightning-rainy": { glyph: "󰖘", color: "red" },
  snowy: { glyph: "󰖑", color: "blue" }, "snowy-rainy": { glyph: "󰖑", color: "blue" },
  fog: { glyph: "󰖝", color: "teal" }, windy: { glyph: "󰖓", color: "teal" }, "windy-variant": { glyph: "󰖓", color: "teal" },
  hail: { glyph: "󰖒", color: "red" }, exceptional: { glyph: "󰖒", color: "red" },
};
const UNKNOWN: Look = { glyph: "󰖐", color: "muted" };

const str = (v: unknown): string | undefined => typeof v === "string" && v.trim() ? v.trim() : undefined;
const number = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clean = (v: string) => v.replace(/[_-]/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
const shown = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");

/** Entity ids as configured, or undefined when the weather item is deliberately disabled. */
export function weatherEntities(s: WeatherSettings) {
  const temperature = s.temperature_entity?.trim() ?? DEFAULT_TEMPERATURE_ENTITY;
  const weather = s.weather_entity?.trim() ?? DEFAULT_WEATHER_ENTITY;
  return temperature && weather ? { temperature, weather } : undefined;
}

/** Normalise HA's current weather state; attributes vary a little by integration. */
export function weatherOf(temperature: State, report: State): Weather | undefined {
  const value = number(temperature.state);
  if (value === undefined || ["unknown", "unavailable"].includes(temperature.state)) return;
  const unit = str(temperature.attributes.unit_of_measurement) ?? str(report.attributes.temperature_unit) ?? "°";
  const condition = report.state.trim().toLowerCase();
  const look = LOOK[condition] ?? UNKNOWN;
  const weatherTemp = number(report.attributes.temperature);
  const feels = number(report.attributes.apparent_temperature);
  const humidity = number(report.attributes.humidity);
  const wind = number(report.attributes.wind_speed);
  const windUnit = str(report.attributes.wind_speed_unit);
  return {
    temperature: value,
    unit,
    condition,
    conditionLabel: clean(condition || "unknown"),
    glyph: look.glyph,
    conditionColor: look.color,
    ...(feels !== undefined ? { feelsLike: `${shown(feels)}${unit}` } : weatherTemp !== undefined ? { feelsLike: `${shown(weatherTemp)}${unit}` } : {}),
    ...(humidity !== undefined ? { humidity: `${shown(humidity)}%` } : {}),
    ...(wind !== undefined ? { wind: `${shown(wind)}${windUnit ? ` ${windUnit}` : ""}` } : {}),
    updated: report.last_updated || temperature.last_updated,
  };
}

/** Weather needs a bar slot only for an actual condition or a temperature outside its comfort band. */
export function notable(weather: Weather, s: WeatherSettings) {
  const low = Number.isFinite(Number(s.temperature_low)) ? Number(s.temperature_low) : DEFAULT_LOW;
  const high = Number.isFinite(Number(s.temperature_high)) ? Number(s.temperature_high) : DEFAULT_HIGH;
  const conditions = (Array.isArray(s.notable_conditions) ? s.notable_conditions : DEFAULT_NOTABLE)
    .map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return weather.temperature < low || weather.temperature > high || conditions.includes(weather.condition);
}

/** A temperature threshold is more important than an ordinary condition tint. */
export function colorOf(weather: Weather, s: WeatherSettings): BarColor {
  const low = Number.isFinite(Number(s.temperature_low)) ? Number(s.temperature_low) : DEFAULT_LOW;
  const high = Number.isFinite(Number(s.temperature_high)) ? Number(s.temperature_high) : DEFAULT_HIGH;
  return weather.temperature < low ? "blue" : weather.temperature > high ? "red" : weather.conditionColor;
}

const stat = (label: string, value: string | undefined, key: string): ViewNode | undefined => value ? {
  type: "stack", direction: "column", key, surface: "sunken", radius: true, padding: 2, gap: 0, grow: true,
  children: [{ type: "text", key: `${key}-label`, value: label, style: "muted", size: "xs" }, { type: "text", key: `${key}-value`, value, style: "number", size: "md" }],
} : undefined;

/** The small bar popover: temperature leads; the three useful current measurements remain scannable. */
export function weatherView(weather: Weather, color: BarColor, updated: string): View {
  const stats = [stat("Feels like", weather.feelsLike, "feels"), stat("Humidity", weather.humidity, "humidity"), stat("Wind", weather.wind, "wind")].filter((x): x is ViewNode => !!x);
  return {
    title: "Weather now",
    id: "weather",
    keys: "actions",
    actions: [{ id: "open_ha", title: "Open in Home Assistant", shortcut: "o" }],
    tree: {
      type: "stack", direction: "column", key: "weather", padding: 3, gap: 3,
      children: [
        { type: "stack", direction: "row", key: "now", align: "center", gap: 3, children: [
          { type: "text", key: "glyph", value: weather.glyph, style: "glyph", size: "xl", color: color === "red" ? "destructive" : color === "amber" ? "amber" : color === "blue" ? "blue" : color === "teal" ? "teal" : "muted" },
          { type: "stack", direction: "column", key: "reading", gap: 0, grow: true, children: [
            { type: "text", key: "temperature", value: `${shown(weather.temperature)}${weather.unit}`, style: "number", size: "xl" },
            { type: "text", key: "condition", value: weather.conditionLabel, style: "muted", size: "sm" },
          ] },
        ] },
        ...(stats.length ? [{ type: "stack", direction: "row", key: "stats", gap: 2, children: stats } as ViewNode] : []),
        { type: "text", key: "updated", value: `Updated ${updated}`, style: "muted", size: "xs" },
      ],
    },
  };
}
