// Weather is its own small surface: a named place resolves through Open-Meteo,
// then current conditions answer the bar and palette. No Home Assistant account,
// device permission or token is involved.
import { errorMessage, hint, settings, type BarItem, type Effect, type Extension, type Item, type View, type ViewNode } from "@zcag/pal";

type Settings = { location: string; low: number; high: number; notable_conditions: unknown[] };
type Place = { name: string; latitude: number; longitude: number; country?: string; country_code?: string; admin1?: string; admin2?: string; population?: number; postcodes?: string[] };
type Current = { temperature_2m: number; apparent_temperature?: number; relative_humidity_2m?: number; wind_speed_10m?: number; weather_code: number; precipitation?: number; is_day?: number; time?: string };
type Reading = { place: Place; current: Current; unit: string; windUnit: string };
const GEOCODE = () => process.env.PAL_WEATHER_GEOCODE ?? "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = () => process.env.PAL_WEATHER_FORECAST ?? "https://api.open-meteo.com/v1/forecast";
const placeCache = new Map<string, Place>();

const LOOK: Record<number, [string, string, "muted" | "amber" | "blue" | "teal" | "red"]> = {
  0: ["Clear", "󰖙", "amber"], 1: ["Mostly clear", "󰖕", "amber"], 2: ["Partly cloudy", "󰖕", "amber"], 3: ["Overcast", "󰖐", "muted"],
  45: ["Fog", "󰖝", "teal"], 48: ["Rime fog", "󰖝", "teal"], 51: ["Light drizzle", "󰖗", "blue"], 53: ["Drizzle", "󰖗", "blue"], 55: ["Heavy drizzle", "󰖖", "blue"],
  61: ["Light rain", "󰖗", "blue"], 63: ["Rain", "󰖗", "blue"], 65: ["Heavy rain", "󰖖", "blue"], 71: ["Light snow", "󰖑", "blue"], 73: ["Snow", "󰖑", "blue"], 75: ["Heavy snow", "󰖑", "blue"],
  80: ["Rain showers", "󰖗", "blue"], 81: ["Rain showers", "󰖗", "blue"], 82: ["Violent showers", "󰖖", "red"], 95: ["Thunderstorm", "󰖘", "red"], 96: ["Thunderstorm with hail", "󰖘", "red"], 99: ["Thunderstorm with hail", "󰖘", "red"],
};
const quietCodes = new Set([0, 1, 2, 3]);
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const label = (r: Reading) => LOOK[r.current.weather_code] ?? ["Weather", "󰖐", "muted"] as const;
const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
/** Case- and diacritic-insensitive, so a typed "Turkiye" still meets "Türkiye". */
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
/** "London, Ontario, Canada": enough to see which of the same-named places answered. */
const placeLabel = (p: Place) => [p.name, p.admin1 && fold(p.admin1) !== fold(p.name) ? p.admin1 : undefined, p.country].filter(Boolean).join(", ");

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
  url.searchParams.set("timezone", "auto");
  const data = await json<{ current?: Current; current_units?: Record<string, string> }>(url);
  if (!data.current || number(data.current.temperature_2m) === undefined || number(data.current.weather_code) === undefined) throw new Error("Weather service returned no current conditions");
  return { place: p, current: data.current, unit: data.current_units?.temperature_2m ?? "°C", windUnit: data.current_units?.wind_speed_10m ?? "km/h" };
}
function isNotable(r: Reading): boolean {
  const s = settings.get<Settings>(); const low = Number(s.low) || 10, high = Number(s.high) || 30;
  const custom = (Array.isArray(s.notable_conditions) ? s.notable_conditions : []).map(Number);
  return r.current.temperature_2m < low || r.current.temperature_2m > high || !quietCodes.has(r.current.weather_code) || custom.includes(r.current.weather_code);
}
function tint(r: Reading): "muted" | "amber" | "blue" | "teal" | "red" {
  const s = settings.get<Settings>(); if (r.current.temperature_2m < (Number(s.low) || 10)) return "blue"; if (r.current.temperature_2m > (Number(s.high) || 30)) return "red"; return label(r)[2];
}
function view(r: Reading): View {
  const [condition, glyph] = label(r); const stats = [["Feels like", r.current.apparent_temperature === undefined ? undefined : `${fmt(r.current.apparent_temperature)}${r.unit}`], ["Humidity", r.current.relative_humidity_2m === undefined ? undefined : `${fmt(r.current.relative_humidity_2m)}%`], ["Wind", r.current.wind_speed_10m === undefined ? undefined : `${fmt(r.current.wind_speed_10m)} ${r.windUnit}`], ["Rain", r.current.precipitation ? `${fmt(r.current.precipitation)} mm` : undefined]].filter((x): x is [string, string] => !!x[1]);
  return { title: placeLabel(r.place), id: "weather", keys: "actions", actions: [{ id: "map", title: "Open map", shortcut: "o" }], tree: { type: "stack", direction: "column", key: "weather", padding: 3, gap: 3, children: [
    { type: "stack", direction: "row", key: "now", align: "center", gap: 3, children: [{ type: "text", key: "glyph", value: glyph, style: "glyph", size: "xl" }, { type: "stack", direction: "column", key: "reading", gap: 0, grow: true, children: [{ type: "text", key: "temp", value: `${fmt(r.current.temperature_2m)}${r.unit}`, style: "number", size: "xl" }, { type: "text", key: "condition", value: condition, style: "muted", size: "sm" }] }] },
    ...(stats.length ? [{ type: "stack", direction: "row", key: "stats", gap: 2, children: stats.map(([name, value]) => ({ type: "stack" as const, direction: "column" as const, key: name, surface: "sunken" as const, radius: true, padding: 2, gap: 0, grow: true, children: [{ type: "text" as const, key: `${name}-label`, value: name, style: "muted" as const, size: "xs" as const }, { type: "text" as const, key: `${name}-value`, value, style: "number" as const, size: "sm" as const }] })) } as ViewNode] : []),
  ] } };
}
async function bar(): Promise<BarItem> {
  try { const r = await read(); if (!r || !isNotable(r)) return { hidden: true }; const [condition, glyph] = label(r); return { icon: glyph, title: `${fmt(r.current.temperature_2m)}${r.unit}`, color: tint(r), tooltip: `${condition} in ${r.place.name}`, menu: { view: view(r) } }; }
  catch (e) { const message = errorMessage(e); return { icon: "󰖪", title: "Weather", color: "red", stale: true, tooltip: message }; }
}
async function rows(): Promise<Item[]> {
  try { const r = await read(); if (!r) return [hint("setup", "Choose a location", "Set a city or postal code under Settings › Extensions › Weather.", { icon: "󰖙" })]; const [condition, glyph] = label(r); return [{ id: "current", name: `${fmt(r.current.temperature_2m)}${r.unit}`, subtitle: `${condition} · ${placeLabel(r.place)}`, icon: glyph, actions: [{ id: "map", title: "Open map" }] }, ...[["feels", "Feels like", r.current.apparent_temperature === undefined ? undefined : `${fmt(r.current.apparent_temperature)}${r.unit}`], ["humidity", "Humidity", r.current.relative_humidity_2m === undefined ? undefined : `${fmt(r.current.relative_humidity_2m)}%`], ["wind", "Wind", r.current.wind_speed_10m === undefined ? undefined : `${fmt(r.current.wind_speed_10m)} ${r.windUnit}`]].filter((x): x is [string, string, string] => !!x[2]).map(([id, name, value]) => ({ id, name: value, subtitle: name, icon: glyph, actions: [] }))]; } catch (e) { return [hint("error", "Weather unavailable", errorMessage(e), { icon: "󰖪" })]; }
}
async function openMap(): Promise<Effect | void> { const r = await read(); if (r) return { open: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.place.latitude},${r.place.longitude}`)}` }; }

export default { palettes: { weather: { title: "Weather", live: true, list: rows, pick: (_id, action) => action === "map" ? openMap() : undefined } }, bar: { weather: { render: bar, onAction: (action) => action === "map" ? openMap() : undefined } } } satisfies Extension;
