// Kavita: continue reading (its On Deck) with the pages read, the series
// added lately, a search over series, collections and files; covers
// through the series cover route with the user's API key. Enter opens
// the series in the web reader.
import { ago, hint, type Ctx, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH, imageUrl } from "./http.ts";
import { guard, pickHint, setupRow } from "./rows.ts";

export type Series = { id: number; name: string; libraryId: number; libraryName?: string; pages: number; pagesRead?: number; format?: number; created?: string; lastChapterAdded?: string; latestReadDate?: string; wordCount?: number; avgHoursToRead?: number; userRating?: number };
type SearchResult = { series?: { seriesId: number; name: string; libraryId: number; libraryName?: string; format?: number }[]; collections?: { id: number; title: string }[]; files?: { id: number; filePath: string; format: number; pages?: number }[]; readingLists?: { id: number; title: string }[] };

/** Kavita's `MangaFormat`: what a series is made of. */
const FORMAT: Record<number, string> = { 0: "images", 1: "archive", 2: "unknown", 3: "epub", 4: "pdf" };
export const kavitaUrl = () => conf("kavita").url;
export const seriesUrl = (s: { id: number; libraryId: number }) => `${kavitaUrl()}/library/${s.libraryId}/series/${s.id}`;
export const version = () => api<{ kavitaVersion?: string }>("kavita", "/api/Server/server-info-slim", { timeout: 3500 }).catch(() => api<{ kavitaVersion?: string }>("kavita", "/api/Server/server-info", { timeout: 3500 }));
export const onDeck = (refresh = false) => cached("kavita:ondeck", 60_000, refresh, () => api<Series[]>("kavita", "/api/Series/on-deck", { method: "POST", query: { libraryId: 0, pageNumber: 1, pageSize: 20 }, body: {} }));
export const recent = (refresh = false) => cached("kavita:recent", 300_000, refresh, () => api<Series[]>("kavita", "/api/Series/recently-added-v2", { query: { pageNumber: 1, pageSize: 20 }, body: { id: 0, name: "", statements: [], combination: 1, sortOptions: { sortField: 1, isAscending: true }, limitTo: 0 } }));
export const search = (q: string) => api<SearchResult>("kavita", "/api/Search/search", { query: { queryString: q } });
export const cover = (seriesId: number) => imageUrl("kavita", "/api/image/series-cover", { seriesId });

const held = new Map<number, Series>();

export async function seriesRow(s: Series, section: string): Promise<Item> {
  held.set(s.id, s);
  const img = await cover(s.id);
  const read = s.pagesRead ?? 0, p = s.pages ? read / s.pages : 0;
  return {
    id: `series:${s.id}`,
    name: s.name,
    subtitle: [s.libraryName, FORMAT[s.format ?? 2], s.pages ? (read ? `page ${read} of ${s.pages}` : `${s.pages} pages`) : "", s.avgHoursToRead ? `~${Math.round(s.avgHoursToRead)} h` : ""].filter(Boolean).join(" · "),
    icon: img ? { image: img } : GLYPH.kavita,
    keywords: [s.libraryName ?? "", FORMAT[s.format ?? 2] ?? ""].filter(Boolean),
    section,
    accessories: [...(p > 0 && p < 1 ? [{ text: `${Math.round(p * 100)}%` }] : p >= 1 ? [{ tag: "read", color: "green" }] : []), ...(s.latestReadDate && !s.latestReadDate.startsWith("0001") ? [{ date: s.latestReadDate }] : s.created ? [{ date: s.created }] : [])],
    detail: { markdown: img ? `![cover](${img})` : undefined, metadata: [...(s.libraryName ? [{ label: "Library", value: s.libraryName }] : []), { label: "Format", value: FORMAT[s.format ?? 2] ?? "" }, { label: "Pages", value: read ? `${read} of ${s.pages} read` : String(s.pages) }, ...(s.wordCount ? [{ label: "Words", value: s.wordCount.toLocaleString("en") }] : []), ...(s.created ? [{ label: "Added", value: ago(s.created) }] : [])] },
    actions: [{ id: "open", title: "Open in Kavita" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }],
  };
}

export async function homeRows(refresh: boolean): Promise<Item[]> {
  if (!configured("kavita")) return [];
  return guard(async () => {
    const [deck, added] = await Promise.all([onDeck(refresh).catch(() => [] as Series[]), recent(refresh)]);
    const seen = new Set<number>();
    const rows: Item[] = [];
    for (const s of deck) { seen.add(s.id); rows.push(await seriesRow(s, "Continue reading")); }
    for (const s of added) if (!seen.has(s.id)) { seen.add(s.id); rows.push(await seriesRow(s, "Recently added")); }
    return rows.length ? rows : [hint("empty", "Nothing in Kavita yet", "A book must sit in its own folder under the library for Kavita to see it", { icon: GLYPH.kavita })];
  });
}

export async function searchRows(q: string): Promise<Item[]> {
  if (!configured("kavita")) return [setupRow("kavita")];
  if (q.trim().length < 2) return [hint("search", "Search Kavita", "Series, collections, reading lists and files", { icon: GLYPH.kavita })];
  return guard(async () => {
    const r = await search(q.trim());
    const rows: Item[] = [];
    for (const s of r.series ?? []) rows.push(await seriesRow({ id: s.seriesId, name: s.name, libraryId: s.libraryId, libraryName: s.libraryName, format: s.format, pages: 0 }, "Series"));
    for (const c of r.collections ?? []) rows.push({ id: `collection:${c.id}`, name: c.title, subtitle: "Collection", icon: GLYPH.kavita, section: "Collections", actions: [{ id: "open", title: "Open in Kavita" }] });
    for (const l of r.readingLists ?? []) rows.push({ id: `list:${l.id}`, name: l.title, subtitle: "Reading list", icon: GLYPH.kavita, section: "Reading lists", actions: [{ id: "open", title: "Open in Kavita" }] });
    for (const f of r.files ?? []) rows.push({ id: `file:${f.id}`, name: f.filePath.split("/").pop() ?? f.filePath, subtitle: [FORMAT[f.format], f.pages ? `${f.pages} pages` : ""].filter(Boolean).join(" · "), icon: GLYPH.kavita, section: "Files", actions: [{ id: "open", title: "Open Kavita" }] });
    return rows.length ? rows : [hint("none", "Nothing found", `Kavita has nothing for “${q.trim()}”`, { icon: GLYPH.kavita })];
  });
}

export async function pick(id: string, action?: string, _ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  const [kind, key] = id.split(":");
  const u = kavitaUrl();
  if (kind === "series") { const s = held.get(Number(key)); const url = s ? seriesUrl(s) : u; return action === "copy" ? { copy: url } : { open: url }; }
  if (kind === "collection") return { open: `${u}/collections/${key}` };
  if (kind === "list") return { open: `${u}/lists/${key}` };
  return { open: u };
}

export async function health() {
  const [v, deck] = await Promise.all([version().catch(() => ({ kavitaVersion: undefined })), onDeck().catch(() => [] as Series[])]);
  return { version: v.kavitaVersion ?? "", note: deck.length ? `${deck.length} on deck` : "nothing on deck", url: kavitaUrl() };
}
