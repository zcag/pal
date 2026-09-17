// The bar popover as a pure `View`: current conditions at the top,
// then the forecast Open-Meteo returns in the same request. The hourly
// strip starts at `current.time` by matching it against `hourly.time`,
// not by assuming midnight plus the user's local hour. Forecast fields
// are all optional because the real service and the tests may omit them;
// missing arrays simply remove that section and leave the current card.
import { POPOVER_W, clock, column, dayName, keyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";

export type Place = { name: string; latitude: number; longitude: number; country?: string; country_code?: string; admin1?: string; admin2?: string; population?: number; postcodes?: string[] };
export type Current = { temperature_2m: number; apparent_temperature?: number; relative_humidity_2m?: number; wind_speed_10m?: number; weather_code: number; precipitation?: number; is_day?: number; time?: string };
export type Hourly = { time?: unknown[]; temperature_2m?: unknown[]; weather_code?: unknown[]; precipitation_probability?: unknown[] };
export type Daily = { time?: unknown[]; weather_code?: unknown[]; temperature_2m_max?: unknown[]; temperature_2m_min?: unknown[]; precipitation_probability_max?: unknown[]; sunrise?: unknown[]; sunset?: unknown[] };
export type Reading = { place: Place; current: Current; unit: string; windUnit: string; hourly?: Hourly; daily?: Daily };

export const LOOK: Record<number, [string, string, "muted" | "amber" | "blue" | "teal" | "red"]> = {
  0: ["Clear", "󰖙", "amber"], 1: ["Mostly clear", "󰖕", "amber"], 2: ["Partly cloudy", "󰖕", "amber"], 3: ["Overcast", "󰖐", "muted"],
  45: ["Fog", "󰖝", "teal"], 48: ["Rime fog", "󰖝", "teal"], 51: ["Light drizzle", "󰖗", "blue"], 53: ["Drizzle", "󰖗", "blue"], 55: ["Heavy drizzle", "󰖖", "blue"],
  61: ["Light rain", "󰖗", "blue"], 63: ["Rain", "󰖗", "blue"], 65: ["Heavy rain", "󰖖", "blue"], 71: ["Light snow", "󰖑", "blue"], 73: ["Snow", "󰖑", "blue"], 75: ["Heavy snow", "󰖑", "blue"],
  80: ["Rain showers", "󰖗", "blue"], 81: ["Rain showers", "󰖗", "blue"], 82: ["Violent showers", "󰖖", "red"], 95: ["Thunderstorm", "󰖘", "red"], 96: ["Thunderstorm with hail", "󰖘", "red"], 99: ["Thunderstorm with hail", "󰖘", "red"],
};

/**
 * `Space` steps the 4 px grid, so a `gap`/`padding` of n is 4n px. The
 * popover's own padding is 3 and each sunken card's is its own, and both
 * have to come off before the columns are shared out — forget the outer
 * one and eight hourly columns overflow the popover by a whole column.
 */
const SPACE = 4, OUTER_PAD = 3 * SPACE, STRIP_PAD = 2 * SPACE, ROWS_PAD = 1 * SPACE;
/** What a sunken card has to lay out in, at each of the two paddings used here. */
const STRIP_W = POPOVER_W - 2 * OUTER_PAD - 2 * STRIP_PAD;
const ROWS_W = POPOVER_W - 2 * OUTER_PAD - 2 * ROWS_PAD;
/**
 * Eight hours, not twelve: the strip has 356 px and a column needs its
 * temperature ("−12.5°C" at the worst) to fit, which is about 40 px.
 * Eight gives 41, twelve would give 26 and clip every reading.
 */
const HOUR_COUNT = 8;
const HOURLY_W = Math.floor((STRIP_W - (HOUR_COUNT - 1) * SPACE) / HOUR_COUNT);
/** A forecast row: the day, the glyph, the two temperatures, the chance of rain, three gaps of two steps between. */
const GLYPH_W = 24, TEMP_W = 96, PRECIP_W = 44;
const DAY_W = ROWS_W - GLYPH_W - TEMP_W - PRECIP_W - 3 * 2 * SPACE;
const DAY_COUNT = 4;
/** Below this the chance of rain is not worth the ink. */
const PRECIP_MIN = 20;

const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const string = (value: unknown) => typeof value === "string" && value ? value : undefined;
/** Case- and diacritic-insensitive, so a typed "Turkiye" still meets "Türkiye". */
export const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export const label = (r: Reading) => LOOK[r.current.weather_code] ?? ["Weather", "󰖐", "muted"] as const;
export const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
/** "London, Ontario, Canada": enough to see which of the same-named places answered. */
export const placeLabel = (p: Place) => [p.name, p.admin1 && fold(p.admin1) !== fold(p.name) ? p.admin1 : undefined, p.country].filter(Boolean).join(", ");

/** Open-Meteo answers in the place's own time with no offset, so `2026-09-17T09:00` parses as local and the SDK's own formatters read it straight. */
const hourKey = (value: string) => value.slice(0, 13);
const weekday = (value: string, i: number) => i === 0 ? "Today" : dayName(`${value}T12:00:00`);

function startHour(r: Reading): number {
  const times = r.hourly?.time ?? [];
  if (!times.length) return -1;
  const now = r.current.time;
  if (!now) return 0;
  const key = hourKey(now);
  const exact = times.findIndex((t) => string(t)?.slice(0, 13) === key);
  if (exact >= 0) return exact;
  return times.findIndex((t) => {
    const s = string(t);
    return !!s && hourKey(s) > key;
  });
}

function hourly(r: Reading): ViewNode[] {
  const h = r.hourly;
  const start = startHour(r);
  if (!h || start < 0) return [];
  const cols: ViewNode[] = [];
  for (let i = start; i < (h.time?.length ?? 0) && cols.length < HOUR_COUNT; i++) {
    const time = string(h.time?.[i]); if (!time) continue;
    const temp = number(h.temperature_2m?.[i]);
    const code = number(h.weather_code?.[i]);
    const rain = number(h.precipitation_probability?.[i]);
    const [, glyph] = code === undefined ? ["Weather", "󰖐"] : LOOK[code] ?? ["Weather", "󰖐"];
    cols.push(column([
      text(clock(time), { size: "xs", color: "muted", align: "center", width: HOURLY_W }),
      text(glyph, { style: "glyph", size: "md", align: "center", width: HOURLY_W }),
      text(temp === undefined ? "—" : `${fmt(temp)}${r.unit}`, { style: "number", size: "sm", align: "center", width: HOURLY_W }),
      text(rain !== undefined && rain >= PRECIP_MIN ? `${fmt(rain)}%` : "", { size: "xs", color: "blue", align: "center", width: HOURLY_W }),
    ], { key: `h-${time}`, gap: 0 }));
  }
  if (!cols.length) return [];
  return [column([text("Next hours", { size: "xs", weight: "semibold", color: "muted" }), row(cols, { key: "hourly-strip", gap: 1, surface: "sunken", radius: true, padding: 2 })], { key: "hourly", gap: 1 })];
}

function daily(r: Reading): ViewNode[] {
  const d = r.daily;
  if (!d?.time?.length) return [];
  const rows: ViewNode[] = [];
  for (let i = 0; i < d.time.length && rows.length < DAY_COUNT; i++) {
    const day = string(d.time[i]); if (!day) continue;
    const hi = number(d.temperature_2m_max?.[i]);
    const lo = number(d.temperature_2m_min?.[i]);
    const rain = number(d.precipitation_probability_max?.[i]);
    const code = number(d.weather_code?.[i]);
    const [, glyph] = code === undefined ? ["Weather", "󰖐"] : LOOK[code] ?? ["Weather", "󰖐"];
    rows.push(row([
      text(weekday(day, i), { size: "sm", weight: "semibold", width: DAY_W }),
      text(glyph, { style: "glyph", size: "md", align: "center", width: GLYPH_W }),
      text(hi === undefined || lo === undefined ? "—" : `${fmt(hi)} / ${fmt(lo)}${r.unit}`, { style: "number", size: "sm", width: TEMP_W }),
      text(rain === undefined ? "" : `${fmt(rain)}%`, { size: "xs", color: rain !== undefined && rain >= PRECIP_MIN ? "blue" : "muted", align: "end", width: PRECIP_W }),
    ], { key: `d-${day}`, gap: 2, minHeight: 26 }));
  }
  if (!rows.length) return [];
  return [column([text("Forecast", { size: "xs", weight: "semibold", color: "muted" }), column(rows, { key: "daily-rows", gap: 0, surface: "sunken", radius: true, padding: 1 })], { key: "daily", gap: 1 })];
}

function sun(r: Reading): ViewNode[] {
  const rise = string(r.daily?.sunrise?.[0]);
  const set = string(r.daily?.sunset?.[0]);
  if (!rise && !set) return [];
  return [row([
    text("Sun", { size: "xs", weight: "semibold", color: "muted" }),
    ...(rise ? [text(`Rise ${clock(rise)}`, { size: "xs", color: "muted" })] : []),
    ...(set ? [text(`Set ${clock(set)}`, { size: "xs", color: "muted" })] : []),
  ], { key: "sun", gap: 2, minHeight: 20 })];
}

function stats(r: Reading): ViewNode[] {
  const items = [
    ["Feels like", r.current.apparent_temperature === undefined ? undefined : `${fmt(r.current.apparent_temperature)}${r.unit}`],
    ["Humidity", r.current.relative_humidity_2m === undefined ? undefined : `${fmt(r.current.relative_humidity_2m)}%`],
    ["Wind", r.current.wind_speed_10m === undefined ? undefined : `${fmt(r.current.wind_speed_10m)} ${r.windUnit}`],
    ["Rain", r.current.precipitation ? `${fmt(r.current.precipitation)} mm` : undefined],
  ].filter((x): x is [string, string] => !!x[1]);
  if (!items.length) return [];
  return [row(items.map(([name, value]) => column([text(name, { key: `${name}-label`, style: "muted", size: "xs" }), text(value, { key: `${name}-value`, style: "number", size: "sm" })], { key: name, surface: "sunken", radius: true, padding: 2, gap: 0, grow: true })), { key: "stats", gap: 2 })];
}

function hints(): ViewNode {
  return row([...keyHint("o", "map", { action: "map" }), ...keyHint("r", "refresh", { action: "refresh" })], { key: "hints", gap: 1, minHeight: 22 });
}

const actions = (): Action[] => [
  { id: "map", title: "Open map", shortcut: "o" },
  { id: "refresh", title: "Refresh", shortcut: "r" },
];

export function render(r: Reading): View {
  const [condition, glyph] = label(r);
  return {
    title: placeLabel(r.place),
    id: "weather",
    keys: "actions",
    actions: actions(),
    tree: column([
      row([text(glyph, { key: "glyph", style: "glyph", size: "xl" }), column([text(`${fmt(r.current.temperature_2m)}${r.unit}`, { key: "temp", style: "number", size: "xl" }), text(condition, { key: "condition", style: "muted", size: "sm" })], { key: "reading", gap: 0, grow: true })], { key: "now", gap: 3 }),
      ...stats(r),
      ...hourly(r),
      ...daily(r),
      ...sun(r),
      hints(),
    ], { key: "weather", padding: 3, gap: 3 }),
  };
}
