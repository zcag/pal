// Maps: an input palette over Google Maps (or Apple Maps) urls, no key
// needed. Typed text gets a Search row, Directions rows from the current
// location, home and work (the travel mode is the filter), the saved
// places that match, and, with a Places API key, autocomplete rows as you
// type. `home > work`, `here -> Kadıköy`, `istanbul to ankara` is a route
// with both ends. Nothing typed: home, work, the commute, the saved
// places. `maps:` or `go:` before a query answers inline at the root.
import { errorMessage, hint, settings, toast, type Action, type Ctx, type Effect, type Extension, type Item } from "@zcag/pal";
import { APP_NAME, directionsUrl, matches, MODES, parse, parsePlaces, resolveEnd, searchUrl, webUrl, type App, type Mode } from "./maps.ts";

/** `[extensions.maps]`, defaults in pal.json. */
type Settings = { app: App; home: string; work: string; places: string[]; api_key: string };

/** Material Design glyphs from the bundled Nerd Font; the tile's green tints them. */
const GLYPH = {
  search: "\u{f0984}", // md-map_search
  pin: "\u{f034e}", // md-map_marker
  directions: "\u{f01d0}", // md-directions
  home: "\u{f02dc}", // md-home
  work: "\u{f00d6}", // md-briefcase
  here: "\u{f01a4}", // md-crosshairs_gps
  route: "\u{f0390}", // md-navigation
  alert: "\u{f05d6}", // md-alert_circle_outline
  wait: "\u{f051f}", // md-timer_sand
};

const OPEN: Action = { id: "open", title: "Open" };
const DIRECTIONS: Action = { id: "directions", title: "Directions from here" };
const FROM_HOME: Action = { id: "from_home", title: "Directions from home", shortcut: "cmd+h" };
const FROM_WORK: Action = { id: "from_work", title: "Directions from work", shortcut: "cmd+w" };
const COPY_ADDRESS: Action = { id: "copy_address", title: "Copy address", shortcut: "cmd+c" };
const COPY_LINK: Action = { id: "copy_link", title: "Copy link", shortcut: "cmd+l" };
const OTHER_APP: Action = { id: "other", title: "Open in the other app", shortcut: "cmd+shift+o" };

const DEBOUNCE_MS = 250;
const PLACES = process.env.PAL_MAPS_PLACES ?? "https://places.googleapis.com";
const FETCH_MS = 4000;
const S = () => settings.get<Settings>();
const modeOf = (ctx?: Ctx): Mode => MODES.map((m) => m.id).find((id) => id === ctx?.filter) ?? "driving";

/** What a row stands for: a place (searched, saved or predicted) or a route; `pick` builds the url from it. */
type Held = { kind: "place"; query: string; address: string; placeId?: string } | { kind: "route"; from?: string; to: string };
const held = new Map<string, Held>();

// ---- Places API (New) autocomplete -----------------------------------------------------

type Prediction = { placeId: string; text: string; main: string; secondary: string };
type Suggestion = { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } };

/** `places:autocomplete`'s suggestions as predictions; anything without a place id is dropped. */
export function parsePredictions(reply: unknown): Prediction[] {
  const s = (reply as { suggestions?: Suggestion[] })?.suggestions;
  if (!Array.isArray(s)) return [];
  return s.flatMap((x) => {
    const p = x.placePrediction;
    if (!p?.placeId) return [];
    const text = p.text?.text ?? "";
    return [{ placeId: p.placeId, text, main: p.structuredFormat?.mainText?.text ?? text, secondary: p.structuredFormat?.secondaryText?.text ?? "" }];
  });
}

const predictions = new Map<string, Prediction[]>();
async function autocomplete(input: string, key: string): Promise<Prediction[]> {
  const hit = predictions.get(input);
  if (hit) return hit;
  const res = await fetch(`${PLACES}/v1/places:autocomplete`, { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": key }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(FETCH_MS) });
  if (!res.ok) throw new Error(res.status === 403 || res.status === 400 ? `Google refused the key (${res.status}): enable Places API (New) on its project` : `Places API answered ${res.status}`);
  const list = parsePredictions(await res.json());
  if (predictions.size > 200) predictions.clear();
  predictions.set(input, list);
  return list;
}

// ---- rows ---------------------------------------------------------------------------

const placeActions = (s: Settings): Action[] => [OPEN, DIRECTIONS, ...(s.home?.trim() ? [FROM_HOME] : []), ...(s.work?.trim() ? [FROM_WORK] : []), COPY_ADDRESS, COPY_LINK, OTHER_APP];

function placeRow(id: string, name: string, subtitle: string, h: Extract<Held, { kind: "place" }>, s: Settings, icon: string, keywords?: string[]): Item {
  held.set(id, h);
  return { id, name, subtitle, icon, keywords, actions: placeActions(s) };
}

/** A directions row; `name` for the standing ones ("Directions from home"), else the route itself is the name. */
function routeRow(id: string, from: string | undefined, to: string, mode: Mode, s: Settings, name?: string): Item {
  held.set(id, { kind: "route", from, to });
  const route = `${from ?? "current location"} → ${to}`;
  return { id, name: name ?? route, subtitle: `${name ? `${route} · ` : ""}${mode} · ${APP_NAME[s.app]}`, icon: name === undefined ? GLYPH.route : GLYPH.directions, actions: [{ id: "open", title: "Open directions" }, COPY_LINK, OTHER_APP] };
}

/** Home, work, the commute and the saved places: the rows for an empty query, and the saved ones filtered for a typed one. */
function savedRows(s: Settings, mode: Mode, q?: string): Item[] {
  const out: Item[] = [];
  const has = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase());
  const home = s.home?.trim(), work = s.work?.trim();
  if (home && has(`home ${home}`)) out.push(placeRow("home", "Home", home, { kind: "place", query: home, address: home }, s, GLYPH.home, ["home"]));
  if (work && has(`work ${work}`)) out.push(placeRow("work", "Work", work, { kind: "place", query: work, address: work }, s, GLYPH.work, ["work", "office"]));
  if (home && work && !q) { out.push(routeRow("commute", home, work, mode, s)); out.push(routeRow("commute-back", work, home, mode, s)); }
  for (const p of parsePlaces(s.places)) if (has(`${p.name} ${p.address}`)) out.push(placeRow(`place:${p.name}`, p.name, p.address, { kind: "place", query: p.address, address: p.address }, s, GLYPH.pin, [p.name]));
  return out;
}

let seq = 0;

async function list(query = "", ctx?: Ctx): Promise<Item[]> {
  const s = S();
  const p = parse(query, parsePlaces(s.places).map((x) => x.name));
  const mode = modeOf(ctx);
  if (ctx?.inline && !p.prefixed) return [];
  held.clear();
  if (!p.text) {
    const rows = savedRows(s, mode);
    if (!rows.length) return [hint("setup", "Type a place to search, or a route: home > work", "Set `home`, `work` and `places` under Settings › Extensions › Maps for rows here"), hint("root", "At the root, maps: or go: before the query", "go: coffee near me · maps: home > work")];
    return rows;
  }
  if (p.from && p.to) {
    const from = resolveEnd(p.from, s), to = resolveEnd(p.to, s);
    if (!to) return [hint("to", "A route needs a destination", "home > work · here -> Kadıköy", { icon: GLYPH.alert })];
    const rows = [routeRow("route", from, to, mode, s)];
    if (from) rows.push(routeRow("route-back", to, from, mode, s));
    return rows;
  }
  const q = p.text;
  const rows: Item[] = [
    placeRow("search", `Search ${q}`, `${APP_NAME[s.app]}`, { kind: "place", query: q, address: q }, s, GLYPH.search),
    routeRow("to", undefined, q, mode, s, "Directions from here"),
    ...(s.home?.trim() ? [routeRow("from-home", s.home.trim(), q, mode, s, "Directions from home")] : []),
    ...(s.work?.trim() ? [routeRow("from-work", s.work.trim(), q, mode, s, "Directions from work")] : []),
    ...savedRows(s, mode, q),
  ];
  if (s.api_key?.trim() && !ctx?.inline) {
    const my = ++seq;
    await Bun.sleep(DEBOUNCE_MS);
    if (my !== seq) return [...rows, hint("wait", "Looking up places…", q, { icon: GLYPH.wait })];
    try {
      const list = await autocomplete(q, s.api_key.trim());
      if (my !== seq) return [...rows, hint("wait", "Looking up places…", q, { icon: GLYPH.wait })];
      for (const pr of list) rows.push(placeRow(`pred:${pr.placeId}`, pr.main, pr.secondary, { kind: "place", query: pr.text, address: pr.text, placeId: pr.placeId }, s, GLYPH.pin));
    } catch (e) {
      console.error(`[maps] ${errorMessage(e)}`);
      rows.push(hint("failed", errorMessage(e), "Places autocomplete", { icon: GLYPH.alert }));
    }
  }
  return rows;
}

/** The url a row opens for an action, on `app`. */
function urlFor(h: Held, action: string | undefined, mode: Mode, s: Settings, app: App): string {
  if (h.kind === "route") return directionsUrl(h.to, h.from, mode, app);
  switch (action) {
    case "directions": return directionsUrl(h.address, undefined, mode, app);
    case "from_home": return directionsUrl(h.address, s.home.trim(), mode, app);
    case "from_work": return directionsUrl(h.address, s.work.trim(), mode, app);
    default: return searchUrl(h.query, app, h.placeId);
  }
}

async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect> {
  const h = held.get(id);
  if (!h) return toast("Row is gone", "The listing changed; pick again", "failure");
  const s = S();
  const mode = modeOf(ctx);
  if (action === "copy_address") return { copy: h.kind === "place" ? h.address : h.to };
  if (action === "copy_link") return { copy: webUrl(urlFor(h, undefined, mode, s, s.app)) };
  if (action === "other") return { open: urlFor(h, undefined, mode, s, s.app === "apple" ? "google" : "apple") };
  return { open: urlFor(h, action, mode, s, s.app) };
}

export default {
  palettes: {
    maps: {
      title: "Maps",
      input: true,
      // At the root: `go: coffee`, `maps: home > work` answer inline under a Maps section.
      match: matches,
      inline: true,
      placeholder: "A place, or a route: home > work",
      filters: MODES,
      list,
      pick,
    },
  },
} satisfies Extension;
