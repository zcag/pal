// Iconify over its public API (api.iconify.design, `PAL_ICONIFY_API` for
// the tests): every set Iconify hosts (Material Design Icons, Tabler,
// Lucide, Phosphor, Simple Icons, ...), searched by name, each hit drawn
// from its SVG body. Two calls per search: `/search?query=` answers the
// icon names and the sets they belong to, then `/<prefix>.json?icons=`
// one call per set answers the bodies. The pure part (the row's SVG, the
// data url, the file name) is exported for the tests; `search` and
// `fetchSet` are the network.
import { errorMessage, hint, home, settings, type Action, type Ctx, type Effect, type Item } from "@zcag/pal";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** `[extensions.icons]`, defaults in pal.json. */
export type Settings = { sets: string[]; save_to: string };

export const API = process.env.PAL_ICONIFY_API ?? "https://api.iconify.design";
const SITE = "https://icon-sets.iconify.design";
/** Hits per search (the API caps at 999; a grid past this is noise). */
export const LIMIT = 64;
/** Keystrokes closer than this share one search. */
const DEBOUNCE_MS = 250;
const FETCH_MS = 6000;
/**
 * Iconify draws in `currentColor`; a row icon has no colour of its own to
 * inherit (the `{ image }` is a picture, not a glyph), so the SVG on the
 * tile is filled with a mid grey that reads on both the light and the dark
 * panel. The copied SVG keeps `currentColor`.
 */
const TILE_INK = "#888888";

/** One icon as `/<prefix>.json` answers it: the inner SVG at a `left top width height` box. */
type IconBody = { body: string; width?: number; height?: number; left?: number; top?: number; rotate?: number; hFlip?: boolean; vFlip?: boolean };
type SetAnswer = { prefix: string; icons: Record<string, IconBody>; width?: number; height?: number; not_found?: string[] };
type SearchAnswer = { icons: string[]; total?: number; collections?: Record<string, { name?: string }> };

export type Hit = { id: string; prefix: string; name: string; set: string; svg: string };

class IconifyError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

/** A whole SVG from a body: the box the set declares, the icon's own sizes over it. */
export function svgOf(icon: IconBody, set: { width?: number; height?: number }): string {
  const w = icon.width ?? set.width ?? 16, h = icon.height ?? set.height ?? 16;
  const l = icon.left ?? 0, t = icon.top ?? 0;
  const flips = [icon.hFlip && `scale(-1 1) translate(${-w - 2 * l} 0)`, icon.vFlip && `scale(1 -1) translate(0 ${-h - 2 * t})`, icon.rotate && `rotate(${icon.rotate * 90} ${l + w / 2} ${t + h / 2})`].filter(Boolean);
  const body = flips.length ? `<g transform="${flips.join(" ")}">${icon.body}</g>` : icon.body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${l} ${t} ${w} ${h}">${body}</svg>`;
}

/** The SVG as a `data:` url; `ink` replaces `currentColor` (the tile), none keeps it (Copy as data URL). */
export const dataUrl = (svg: string, ink?: string) => `data:image/svg+xml;utf8,${encodeURIComponent(ink ? svg.replace(/currentColor/g, ink) : svg)}`;

/** `mdi-home.svg`: the prefix and the name, the set's separator turned into a dash. */
export const fileName = (id: string) => `${id.replace(/[^a-z0-9-]+/gi, "-")}.svg`;

/** A network answer as JSON, or an `IconifyError` naming why not. */
async function getJson<T>(url: string): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) }); }
  catch (e) { throw new IconifyError((e as Error)?.name === "TimeoutError" ? `Iconify did not answer within ${FETCH_MS / 1000} s` : `Iconify did not answer: ${errorMessage(e)}`); }
  if (r.status === 429) throw new IconifyError("Iconify is rate limiting this machine; try again in a moment", 429);
  if (!r.ok) throw new IconifyError(`Iconify answered ${r.status}`, r.status);
  return (await r.json()) as T;
}

/** The bodies of `names` in `prefix`, cached per icon for the process. */
const bodies = new Map<string, string>();
async function fetchSet(prefix: string, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const want = names.filter((n) => { const svg = bodies.get(`${prefix}:${n}`); if (svg) out.set(n, svg); return !svg; });
  if (want.length) {
    const a = await getJson<SetAnswer>(`${API}/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(want.join(","))}`);
    for (const [n, icon] of Object.entries(a.icons ?? {})) { const svg = svgOf(icon, a); bodies.set(`${prefix}:${n}`, svg); out.set(n, svg); }
  }
  return out;
}

/** One search: the names, then the bodies one call per set, in the API's order; cached per query and set list. */
const searches = new Map<string, Hit[]>();
export async function search(query: string, sets: string[]): Promise<Hit[]> {
  const key = `${sets.join(",")}\0${query}`;
  const hit = searches.get(key);
  if (hit) return hit;
  const prefixes = sets.length ? `&prefixes=${encodeURIComponent(sets.join(","))}` : "";
  const a = await getJson<SearchAnswer>(`${API}/search?query=${encodeURIComponent(query)}&limit=${LIMIT}${prefixes}`);
  const byPrefix = new Map<string, string[]>();
  for (const id of a.icons ?? []) { const i = id.indexOf(":"); if (i > 0) (byPrefix.get(id.slice(0, i)) ?? byPrefix.set(id.slice(0, i), []).get(id.slice(0, i))!).push(id.slice(i + 1)); }
  const svgs = new Map<string, Map<string, string>>();
  await Promise.all([...byPrefix].map(async ([p, names]) => svgs.set(p, await fetchSet(p, names))));
  const hits: Hit[] = [];
  for (const id of a.icons ?? []) {
    const i = id.indexOf(":");
    const prefix = id.slice(0, i), name = id.slice(i + 1);
    const svg = svgs.get(prefix)?.get(name);
    if (svg) hits.push({ id, prefix, name, set: a.collections?.[prefix]?.name ?? prefix, svg });
  }
  searches.set(key, hits);
  return hits;
}

// ---- the palette ------------------------------------------------------------

/** nf-md-magnify, nf-md-alert: the hint rows. */
const GLYPH = { search: "\u{f0349}", warn: "\u{f0026}" };

export const ACTIONS: Action[] = [
  { id: "svg", title: "Copy SVG" },
  { id: "name", title: "Copy name" },
  { id: "data", title: "Copy as data URL", shortcut: "cmd+shift+d" },
  { id: "open", title: "Open on Iconify", shortcut: "cmd+o" },
  { id: "save", title: "Save SVG…", shortcut: "cmd+s" },
];

const row = (h: Hit): Item => ({ id: h.id, name: h.name, subtitle: h.set, icon: { image: dataUrl(h.svg, TILE_INK) }, keywords: [h.id, h.prefix], section: h.set });

// The listing waits DEBOUNCE_MS per query so a word typed at speed is one
// search; a call the next keystroke overtook answers that newer query's
// rows (the panel drops the older reply), never a stale search's.
let newest: { q: string; rows: Promise<Item[]> } | undefined;
const conf = () => settings.get<Settings>("icons");

async function rowsFor(q: string): Promise<Item[]> {
  try {
    const hits = await search(q, conf().sets.map((s) => s.trim()).filter(Boolean));
    return hits.length ? hits.map(row) : [hint("none", `No icons for “${q}”`, "Another word; the sets setting narrows the search to mdi, tabler, lucide and the like", { icon: GLYPH.search })];
  } catch (e) {
    const msg = e instanceof IconifyError ? e.message : `Iconify did not answer: ${errorMessage(e)}`;
    return [hint("fail", msg, "cmd+r tries again; the sets setting narrows the search", { icon: GLYPH.warn })];
  }
}

export async function list(query = "", ctx?: Ctx): Promise<Item[]> {
  const q = query.trim();
  // Nothing typed is nothing listed: the search row's placeholder says what to type, and a hint tile in a grid has no room for a sentence.
  if (!q) return [];
  if (ctx?.refresh) searches.clear();
  if (newest?.q === q && !ctx?.refresh) return newest.rows;
  const mine: typeof newest = { q, rows: Bun.sleep(DEBOUNCE_MS).then(() => (newest === mine ? rowsFor(q) : newest!.rows)) };
  newest = mine;
  return mine.rows;
}

/** The hit a pick names: from the searches made this run (a pick after a restart is a toast). */
const hitOf = (id: string): Hit | undefined => { for (const hits of searches.values()) { const h = hits.find((x) => x.id === id); if (h) return h; } };

export async function pick(id: string, action?: string): Promise<Effect> {
  if (id.startsWith("hint:")) return { keep: true };
  const h = hitOf(id);
  if (!h) return { toast: { title: "Search again first", message: `${id} is not in this run's results`, style: "failure" } };
  switch (action) {
    case "name": return { copy: h.id };
    case "data": return { copy: dataUrl(h.svg) };
    case "open": return { open: `${SITE}/${h.prefix}/${h.name}/` };
    case "save": {
      const dir = home(conf().save_to || "~/Downloads");
      await mkdir(dir, { recursive: true });
      let path = join(dir, fileName(h.id));
      for (let n = 2; await stat(path).then(() => true, () => false); n++) path = join(dir, fileName(`${h.id}-${n}`));
      await writeFile(path, h.svg + "\n");
      return { hud: `Saved ${path.replace(home("~"), "~")}` };
    }
    default: return { copy: h.svg };
  }
}
