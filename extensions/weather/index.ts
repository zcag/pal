// Weather is its own small surface: a named place resolves through Open-Meteo,
// then current conditions answer the bar and palette. No Home Assistant account,
// device permission or token is involved.
import { errorMessage, hint, settings, type BarItem, type Effect, type Extension, type Item } from "@zcag/pal";
import { fmt, fold, label, placeLabel, render as renderPopover, type Current, type Place, type Reading } from "./view.ts";

/** `[extensions.weather]`, defaults in pal.json. */
type Settings = { location: string; low: number; high: number; notable_conditions: unknown[] };
const GEOCODE = () => process.env.PAL_WEATHER_GEOCODE ?? "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = () => process.env.PAL_WEATHER_FORECAST ?? "https://api.open-meteo.com/v1/forecast";
const placeCache = new Map<string, Place>();

const quietCodes = new Set([0, 1, 2, 3]);
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** The searched name is the first segment; the rest only rank the answers. */
export function parseLocation(raw: string): { name: string; qualifiers: string[] } {
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  return { name: parts[0] ?? "", qualifiers: parts.slice(1).map(fold) };
}
const score = (p: Place, qualifiers: string[]) => {
  const fields = [p.country, p.country_code, p.admin1, p.admin2, ...(p.postcodes ?? [])].filter((x): x is string => !!x).map(fold);
  return qualifiers.filter((q) => fields.some((f) => f === q || f.includes(q))).length;
};
/**
 * Open-Meteo's geocoder takes one bare place name, so "Istanbul, Turkey" matches
 * nothing at all. The qualifiers therefore rank the candidates instead of
 * filtering them: the index stores endonyms ("Republic of Türkiye") that a
 * written exonym ("Turkey") never equals, and hard-filtering on one would turn a
 * good answer into no answer. An unmatched qualifier falls through to population,
 * which is what a bare "Istanbul" should resolve to anyway. Equal on both, the
 * sort is stable and the service's own relevance order stands.
 */
export function pickPlace(results: Place[], qualifiers: string[]): Place | undefined {
  return results
    .map((place) => ({ place, rank: score(place, qualifiers) }))
    .sort((a, b) => b.rank - a.rank || (b.place.population ?? 0) - (a.place.population ?? 0))[0]?.place;
}

async function json<T>(url: URL): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${response.status} from ${url.hostname}`);
  return response.json() as Promise<T>;
}
async function place(query: string): Promise<Place | undefined> {
  const cached = placeCache.get(query); if (cached) return cached;
  const { name, qualifiers } = parseLocation(query); if (!name) return;
  const url = new URL(GEOCODE()); url.searchParams.set("name", name); url.searchParams.set("count", "10"); url.searchParams.set("language", "en");
  const found = pickPlace((await json<{ results?: Place[] }>(url)).results ?? [], qualifiers);
  if (found) placeCache.set(query, found);
  return found;
}
async function read(): Promise<Reading | undefined> {
  const s = settings.get<Settings>(); const query = s.location?.trim(); if (!query) return;
  const p = await place(query); if (!p) throw new Error(`No place named “${parseLocation(query).name}”`);
  const url = new URL(FORECAST());
  url.searchParams.set("latitude", String(p.latitude)); url.searchParams.set("longitude", String(p.longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,precipitation,is_day");
  url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  const data = await json<{ current?: Current; current_units?: Record<string, string>; hourly?: Reading["hourly"]; daily?: Reading["daily"] }>(url);
  if (!data.current || number(data.current.temperature_2m) === undefined || number(data.current.weather_code) === undefined) throw new Error("Weather service returned no current conditions");
  return { place: p, current: data.current, unit: data.current_units?.temperature_2m ?? "°C", windUnit: data.current_units?.wind_speed_10m ?? "km/h", hourly: data.hourly, daily: data.daily };
}
function isNotable(r: Reading): boolean {
  const s = settings.get<Settings>(); const low = Number(s.low) || 10, high = Number(s.high) || 30;
  const custom = (Array.isArray(s.notable_conditions) ? s.notable_conditions : []).map(Number);
  return r.current.temperature_2m < low || r.current.temperature_2m > high || !quietCodes.has(r.current.weather_code) || custom.includes(r.current.weather_code);
}
function tint(r: Reading): "muted" | "amber" | "blue" | "teal" | "red" {
  const s = settings.get<Settings>(); if (r.current.temperature_2m < (Number(s.low) || 10)) return "blue"; if (r.current.temperature_2m > (Number(s.high) || 30)) return "red"; return label(r)[2];
}
async function bar(): Promise<BarItem> {
  try {
    const r = await read(); if (!r) return { hidden: true };
    const [condition, glyph] = label(r);
    const item = { icon: glyph, title: `${fmt(r.current.temperature_2m)}${r.unit}`, tooltip: `${condition} in ${r.place.name}`, menu: { view: renderPopover(r) } };
    // Ordinary weather is hidden; the reading is the `empty` shape a `show = "always"` config keeps, muted, so the forecast stays a click away.
    return isNotable(r) ? { ...item, color: tint(r) } : { hidden: true, empty: item };
  }
  catch (e) { const message = errorMessage(e); return { icon: "󰖪", title: "Weather", color: "red", stale: true, tooltip: message }; }
}
async function rows(): Promise<Item[]> {
  try { const r = await read(); if (!r) return [hint("setup", "Choose a location", "Set a city or postal code under Settings › Extensions › Weather.", { icon: "󰖙" })]; const [condition, glyph] = label(r); return [{ id: "current", name: `${fmt(r.current.temperature_2m)}${r.unit}`, subtitle: `${condition} · ${placeLabel(r.place)}`, icon: glyph, actions: [{ id: "map", title: "Open map" }] }, ...[["feels", "Feels like", r.current.apparent_temperature === undefined ? undefined : `${fmt(r.current.apparent_temperature)}${r.unit}`], ["humidity", "Humidity", r.current.relative_humidity_2m === undefined ? undefined : `${fmt(r.current.relative_humidity_2m)}%`], ["wind", "Wind", r.current.wind_speed_10m === undefined ? undefined : `${fmt(r.current.wind_speed_10m)} ${r.windUnit}`]].filter((x): x is [string, string, string] => !!x[2]).map(([id, name, value]) => ({ id, name: value, subtitle: name, icon: glyph, actions: [] }))]; } catch (e) { return [hint("error", "Weather unavailable", errorMessage(e), { icon: "󰖪" })]; }
}
async function openMap(): Promise<Effect | void> { const r = await read(); if (r) return { open: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.place.latitude},${r.place.longitude}`)}` }; }
async function refreshPopover(): Promise<Effect> {
  try {
    const r = await read();
    return r ? { view: renderPopover(r), hud: "Refreshed" } : { keep: true, hud: "No location" };
  } catch (e) {
    return { keep: true, hud: errorMessage(e) };
  }
}

export default { palettes: { weather: { title: "Weather", live: true, list: rows, pick: (_id, action) => action === "map" ? openMap() : undefined } }, bar: { weather: { render: bar, onAction: (action) => action === "map" ? openMap() : action === "refresh" ? refreshPopover() : undefined } } } satisfies Extension;
