// Audiobookshelf: continue listening with the progress, what was added
// lately across every library, a search over books, podcasts and
// authors; covers through the item's cover route with the session's
// token. Enter opens the item in the web app; Mark finished sets the
// progress.
import { ago, hint, toast, type Ctx, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH, imageUrl } from "./http.ts";
import { guard, pickHint, setupRow } from "./rows.ts";

type Library = { id: string; name: string; mediaType: "book" | "podcast" };
export type LibraryItem = { id: string; libraryId: string; mediaType: "book" | "podcast"; addedAt: number; media: { metadata: { title?: string; authorName?: string; author?: string; narratorName?: string; seriesName?: string; publishedYear?: string; description?: string }; duration?: number; numTracks?: number; numEpisodes?: number } };
type Progress = { id: string; libraryItemId: string; episodeId?: string; progress: number; isFinished: boolean; lastUpdate: number; currentTime?: number; duration?: number };

export const absUrl = () => conf("abs").url;
export const itemUrl = (id: string) => `${absUrl()}/item/${id}`;
export const libraries = () => cached("abs:libraries", 3600_000, false, async () => (await api<{ libraries: Library[] }>("abs", "/api/libraries")).libraries);
export const me = (refresh = false) => cached("abs:me", 30_000, refresh, () => api<{ username: string; mediaProgress: Progress[] }>("abs", "/api/me"));
export const inProgress = (refresh = false) => cached("abs:progress", 60_000, refresh, async () => (await api<{ libraryItems: LibraryItem[] }>("abs", "/api/me/items-in-progress", { query: { limit: 20 } })).libraryItems);
export const recent = (lib: string, refresh = false) => cached(`abs:recent:${lib}`, 300_000, refresh, async () => (await api<{ results: LibraryItem[] }>("abs", `/api/libraries/${lib}/items`, { query: { sort: "addedAt", desc: 1, limit: 12 } })).results);
export const search = async (lib: string, q: string) => api<{ book?: { libraryItem: LibraryItem }[]; podcast?: { libraryItem: LibraryItem }[]; authors?: { id: string; name: string; numBooks?: number }[] }>("abs", `/api/libraries/${lib}/search`, { query: { q, limit: 12 } });
export const finish = (itemId: string) => api("abs", `/api/me/progress/${itemId}`, { method: "PATCH", body: { isFinished: true }, text: true });
export const cover = (id: string, w = 60) => imageUrl("abs", `/api/items/${id}/cover`, { width: w });
export const version = () => api<{ serverVersion?: string }>("abs", "/status", { timeout: 3500 });

const held = new Map<string, LibraryItem>();
const hours = (s?: number) => (s ? (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`) : "");

export async function itemRow(it: LibraryItem, section: string, progress?: Progress): Promise<Item> {
  held.set(it.id, it);
  const m = it.media.metadata;
  const img = await cover(it.id);
  const p = progress && !progress.isFinished ? progress.progress : 0;
  return {
    id: `item:${it.id}`,
    name: m.title ?? "Untitled",
    subtitle: [m.authorName ?? m.author, m.seriesName, it.mediaType === "podcast" ? `${it.media.numEpisodes ?? 0} episodes` : hours(it.media.duration), p ? `${Math.round(p * 100)}%` : ""].filter(Boolean).join(" · "),
    icon: img ? { image: img } : GLYPH.abs,
    keywords: [m.authorName ?? "", m.narratorName ?? "", m.seriesName ?? "", it.mediaType].filter(Boolean),
    section,
    accessories: [...(p ? [{ text: `${Math.round(p * 100)}%` }] : []), ...(progress?.isFinished ? [{ tag: "finished", color: "green" }] : []), { date: progress?.lastUpdate ?? it.addedAt }],
    detail: {
      caption: [m.authorName ?? m.author, m.seriesName].filter(Boolean).join(" · ") || (it.mediaType === "podcast" ? "Podcast" : "Book"),
      title: m.title ?? "Untitled",
      chips: [...(it.mediaType === "podcast" ? [{ text: "podcast", color: "teal" as const }] : []), ...(progress?.isFinished ? [{ text: "finished", color: "green" as const }] : [])],
      stats: [...(p ? [{ value: `${Math.round(p * 100)}%`, label: "listened" }] : []), ...(it.media.duration ? [{ value: hours(it.media.duration), label: "length" }] : [])],
      markdown: [img ? `![cover](${await cover(it.id, 300)})` : "", m.description ?? ""].filter(Boolean).join("\n\n"),
      metadata: [...(m.narratorName ? [{ label: "Narrator", value: m.narratorName }] : []), ...(m.publishedYear ? [{ label: "Year", value: m.publishedYear }] : []), ...(progress && !progress.isFinished ? [{ label: "Last listened", value: ago(progress.lastUpdate) }] : []), { label: "Added", value: ago(it.addedAt) }],
    },
    // Every action also takes marked items (`multi`): each opened or marked finished (the question names none), the links one per line.
    actions: [{ id: "open", title: "Open in Audiobookshelf", multi: true }, ...(progress && !progress.isFinished ? [{ id: "finish", title: "Mark finished", shortcut: "cmd+shift+p", multi: true as const, confirm: "Mark finished?" }] : []), { id: "copy", title: "Copy link", shortcut: "cmd+c", multi: true }],
  };
}

export async function homeRows(refresh: boolean): Promise<Item[]> {
  if (!configured("abs")) return [];
  return guard(async () => {
    const [cont, user, libs] = await Promise.all([inProgress(refresh), me(refresh).catch(() => undefined), libraries()]);
    const prog = (id: string) => user?.mediaProgress.filter((p) => p.libraryItemId === id).sort((a, b) => b.lastUpdate - a.lastUpdate)[0];
    const rows = await Promise.all(cont.map((it) => itemRow(it, "Continue listening", prog(it.id))));
    const seen = new Set(cont.map((x) => x.id));
    for (const lib of libs) {
      const items = await recent(lib.id, refresh).catch(() => [] as LibraryItem[]);
      for (const it of items) if (!seen.has(it.id)) { seen.add(it.id); rows.push(await itemRow(it, `Recently added · ${lib.name}`, prog(it.id))); }
    }
    return rows.length ? rows : [hint("empty", "Nothing in Audiobookshelf yet", "Audiobooks and podcasts land under its library folders", { icon: GLYPH.abs })];
  });
}

export async function searchRows(q: string): Promise<Item[]> {
  if (!configured("abs")) return [setupRow("abs")];
  if (q.trim().length < 2) return [hint("search", "Search Audiobookshelf", "Books, podcasts and authors across every library", { icon: GLYPH.abs })];
  return guard(async () => {
    const libs = await libraries();
    const rows: Item[] = [];
    for (const lib of libs) {
      const r = await search(lib.id, q.trim()).catch(() => ({} as Awaited<ReturnType<typeof search>>));
      for (const b of [...(r.book ?? []), ...(r.podcast ?? [])]) rows.push(await itemRow(b.libraryItem, lib.name));
      for (const a of r.authors ?? []) rows.push({ id: `author:${lib.id}:${a.id}`, name: a.name, subtitle: a.numBooks ? `${a.numBooks} book${a.numBooks === 1 ? "" : "s"}` : "Author", icon: GLYPH.person, section: "Authors", actions: [{ id: "open", title: "Open in Audiobookshelf" }] });
    }
    return rows.length ? rows : [hint("none", "Nothing found", `Audiobookshelf has nothing for “${q.trim()}”`, { icon: GLYPH.abs })];
  });
}

export async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  if (id.startsWith("author:")) { const [, lib, a] = id.split(":"); return { open: `${absUrl()}/author/${a}?library=${lib}` }; }
  const key = id.slice(5), it = held.get(key);
  // The marked items (`ctx.ids`, `item:<id>`), else the one.
  const keys = (ctx?.ids ?? [id]).filter((x) => x.startsWith("item:")).map((x) => x.slice(5));
  switch (action) {
    case "copy": return { copy: keys.map(itemUrl).join("\n") };
    case "finish":
      try { for (const k of keys) await finish(k); } catch (e) { return toast("Could not mark", String((e as Error).message), "failure"); }
      return toast("Marked finished", keys.length > 1 ? `${keys.length} items` : it?.media.metadata.title);
    default: return { open: keys.length > 1 ? keys.map(itemUrl) : itemUrl(key) };
  }
}

export async function health() {
  const [v, cont] = await Promise.all([version(), inProgress().catch(() => [] as LibraryItem[])]);
  return { version: v.serverVersion ?? "", note: cont.length ? `${cont.length} in progress` : "nothing in progress", url: absUrl() };
}
