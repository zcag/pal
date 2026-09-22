// Jellyseerr (Overseerr's API): the requests with Approve and Decline,
// and Request a title, a TMDB search through the server whose Enter
// requests (4K when the server allows it). Titles come from
// `/movie/<tmdb>` and `/tv/<tmdb>`, cached an hour, since a request
// carries only ids; posters from TMDB's CDN.
import { ago, hint, toast, truncate, type Action, type Ctx, type Detail, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH, type Tag } from "./http.ts";
import { guard, pickHint, setupRow } from "./rows.ts";

export type SeerrMedia = { id: number; tmdbId: number; mediaType: "movie" | "tv"; status: number; status4k?: number; jellyfinMediaId?: string };
export type SeerrRequest = { id: number; status: number; type: "movie" | "tv"; is4k: boolean; createdAt: string; media: SeerrMedia; requestedBy: { displayName: string; email?: string }; seasons?: { seasonNumber: number }[] };
export type SeerrResult = { id: number; mediaType: "movie" | "tv" | "person"; title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string | null; overview?: string; voteAverage?: number; mediaInfo?: SeerrMedia };
type Title = { title: string; year?: string; posterPath?: string; overview?: string };

/** Request status (`status`) and media availability (`media.status`) as Jellyseerr numbers them. */
export const REQUEST_STATUS: Record<number, Tag> = { 1: { text: "pending", color: "amber" }, 2: { text: "approved", color: "blue" }, 3: { text: "declined", color: "red" }, 4: { text: "failed", color: "red" } };
export const MEDIA_STATUS: Record<number, Tag> = { 2: { text: "requested", color: "amber" }, 3: { text: "processing", color: "blue" }, 4: { text: "partly available", color: "teal" }, 5: { text: "available", color: "green" }, 6: { text: "deleted", color: "grey" } };
const POSTER = (path: string, w = 92) => `https://image.tmdb.org/t/p/w${w}${path}`;

export const seerrUrl = () => conf("seerr").url;
export const mediaUrl = (type: "movie" | "tv", tmdb: number) => `${seerrUrl()}/${type}/${tmdb}`;

export const status = () => api<{ version: string }>("seerr", "/api/v1/status", { timeout: 3500 });
export const settingsPublic = () => cached("seerr:public", 3600_000, false, () => api<{ movie4kEnabled?: boolean; series4kEnabled?: boolean }>("seerr", "/api/v1/settings/public"));
export const counts = () => api<{ pending: number; approved: number; available: number; processing: number; total: number }>("seerr", "/api/v1/request/count");
export const requests = (filter: string, refresh = false) => cached(`seerr:requests:${filter}`, 60_000, refresh, async () => (await api<{ results: SeerrRequest[] }>("seerr", "/api/v1/request", { query: { filter, take: 50, sort: "added" } })).results);
export const search = async (q: string) => (await api<{ results: SeerrResult[] }>("seerr", "/api/v1/search", { query: { query: q, page: 1 } })).results.filter((r) => r.mediaType !== "person");
export const approve = (id: number) => api("seerr", `/api/v1/request/${id}/approve`, { method: "POST" });
export const decline = (id: number) => api("seerr", `/api/v1/request/${id}/decline`, { method: "POST" });
export const request = (type: "movie" | "tv", tmdb: number, is4k: boolean) => api<SeerrRequest>("seerr", "/api/v1/request", { body: { mediaType: type, mediaId: tmdb, is4k, ...(type === "tv" && { seasons: "all" }) } });

/** A title by tmdb id, cached an hour: the request rows carry ids alone. */
export const titleOf = (type: "movie" | "tv", tmdb: number): Promise<Title> => cached(`seerr:title:${type}:${tmdb}`, 3600_000, false, async () => {
  const j = await api<{ title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string | null; overview?: string }>("seerr", `/api/v1/${type}/${tmdb}`);
  return { title: j.title ?? j.name ?? `TMDB ${tmdb}`, year: (j.releaseDate ?? j.firstAirDate ?? "").slice(0, 4) || undefined, posterPath: j.posterPath ?? undefined, overview: j.overview };
});

const table = new Map<number, SeerrRequest>();
const results = new Map<string, SeerrResult>();

const REQ_ACTIONS = (r: SeerrRequest): Action[] => [
  { id: "open", title: "Open in Jellyseerr" },
  ...(r.status === 1 ? [{ id: "approve", title: "Approve", shortcut: "cmd+enter" } as Action, { id: "decline", title: "Decline", shortcut: "cmd+shift+d", style: "destructive", confirm: "Decline this request?" } as Action] : []),
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
];

export async function requestRow(r: SeerrRequest, section?: string): Promise<Item> {
  table.set(r.id, r);
  const t = await titleOf(r.type, r.media.tmdbId).catch(() => ({ title: `TMDB ${r.media.tmdbId}` } as Title));
  const st = REQUEST_STATUS[r.status], ms = MEDIA_STATUS[r.is4k ? (r.media.status4k ?? 0) : r.media.status];
  return {
    id: `req:${r.id}`,
    name: t.year ? `${t.title} (${t.year})` : t.title,
    subtitle: [`${r.type === "tv" ? "Series" : "Movie"} requested by ${r.requestedBy.displayName}`, r.seasons?.length ? `${r.seasons.length} season${r.seasons.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "),
    icon: t.posterPath ? { image: POSTER(t.posterPath) } : GLYPH.seerr,
    keywords: [r.requestedBy.displayName, r.type, st?.text ?? ""].filter(Boolean),
    ...(section && { section }),
    accessories: [
      ...(r.is4k ? [{ tag: "4K", color: "violet" }] : []),
      ...(st ? [{ tag: st.text, color: st.color }] : []),
      ...(ms && r.status === 2 ? [{ tag: ms.text, color: ms.color }] : []),
      { date: r.createdAt },
    ],
    detail: { markdown: [t.posterPath ? `![poster](${POSTER(t.posterPath, 342)})` : "", t.overview ?? ""].filter(Boolean).join("\n\n"), metadata: [{ label: "Requested by", value: r.requestedBy.displayName }, { label: "When", value: ago(r.createdAt) }, { label: "Status", tags: [...(st ? [{ text: st.text, color: st.color }] : []), ...(ms ? [{ text: ms.text, color: ms.color }] : [])] }, { label: "Jellyseerr", link: { text: "Open", href: mediaUrl(r.type, r.media.tmdbId) } }] },
    actions: REQ_ACTIONS(r),
  };
}

export const FILTERS = [{ id: "all", title: "All" }, { id: "pending", title: "Pending" }, { id: "approved", title: "Approved" }, { id: "available", title: "Available" }];

export async function requestRows(filter: string | undefined, refresh: boolean): Promise<Item[]> {
  if (!configured("seerr")) return [];
  return guard(async () => {
    const f = filter && filter !== "all" ? filter : "all";
    const list = await requests(f, refresh);
    const pending = list.filter((r) => r.status === 1), rest = list.filter((r) => r.status !== 1);
    const rows = await Promise.all([...pending.map((r) => requestRow(r, "Pending")), ...rest.map((r) => requestRow(r, f === "all" ? "Earlier" : FILTERS.find((x) => x.id === f)?.title))]);
    if (!rows.length) rows.push(hint("empty", f === "all" ? "No requests" : `No ${f} requests`, "Request a title asks Jellyseerr for a movie or a series", { icon: GLYPH.seerr, actions: [{ id: "request", title: "Request a title" }] }));
    return rows;
  });
}

export function resultRow(r: SeerrResult, fourK: boolean): Item {
  const key = `${r.mediaType}:${r.id}`;
  results.set(key, r);
  const title = r.title ?? r.name ?? "?", year = (r.releaseDate ?? r.firstAirDate ?? "").slice(0, 4);
  const ms = r.mediaInfo ? MEDIA_STATUS[r.mediaInfo.status] : undefined;
  const already = r.mediaInfo && r.mediaInfo.status >= 2 && r.mediaInfo.status <= 5;
  return {
    id: `result:${key}`,
    name: year ? `${title} (${year})` : title,
    subtitle: r.overview ? truncate(r.overview, 100) : r.mediaType === "tv" ? "Series" : "Movie",
    icon: r.posterPath ? { image: POSTER(r.posterPath) } : GLYPH.seerr,
    keywords: [r.mediaType === "tv" ? "series" : "movie"],
    section: r.mediaType === "tv" ? "Series" : "Movies",
    accessories: [...(ms ? [{ tag: ms.text, color: ms.color }] : []), ...(r.voteAverage ? [{ text: `★ ${r.voteAverage.toFixed(1)}` }] : [])],
    detail: { markdown: [r.posterPath ? `![poster](${POSTER(r.posterPath, 342)})` : "", r.overview ?? "_No overview._"].filter(Boolean).join("\n\n"), metadata: [{ label: "Type", value: r.mediaType === "tv" ? "Series" : "Movie" }, ...(year ? [{ label: "Year", value: year }] : []), ...(ms ? [{ label: "Status", tags: [{ text: ms.text, color: ms.color }] }] : []), { label: "TMDB", link: { text: String(r.id), href: `https://www.themoviedb.org/${r.mediaType}/${r.id}` } }] },
    actions: [
      ...(already ? [{ id: "open", title: "Open in Jellyseerr" } as Action, { id: "request", title: "Request again", confirm: `Request ${title} again?` } as Action] : [{ id: "request", title: "Request", confirm: `Request ${title}${year ? ` (${year})` : ""} on Jellyseerr?` } as Action]),
      ...(fourK ? [{ id: "request4k", title: "Request in 4K", shortcut: "cmd+enter", confirm: `Request ${title} in 4K?` } as Action] : []),
      ...(already ? [] : [{ id: "open", title: "Open in Jellyseerr", shortcut: "cmd+o" } as Action]),
      { id: "tmdb", title: "Copy TMDB link", shortcut: "cmd+c" },
    ],
  };
}

export async function searchRows(q: string): Promise<Item[]> {
  if (!configured("seerr")) return [setupRow("seerr")];
  if (q.trim().length < 2) return [hint("search", "Request a title", "Type a movie or a series; Enter asks Jellyseerr for it", { icon: GLYPH.seerr })];
  return guard(async () => {
    const [hits, pub] = await Promise.all([search(q.trim()), settingsPublic().catch(() => ({} as Awaited<ReturnType<typeof settingsPublic>>))]);
    const rows = hits.map((r) => resultRow(r, r.mediaType === "movie" ? !!pub.movie4kEnabled : !!pub.series4kEnabled));
    return rows.length ? rows : [hint("none", "Nothing on TMDB", `No movie or series matches “${q.trim()}”`, { icon: GLYPH.seerr })];
  });
}

export async function pick(id: string, action?: string, _ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return id === "hint:empty" && action === "request" ? { push: { extension: "theater", palette: "seerr-request" } } : pickHint(id);
  if (id.startsWith("req:")) {
    const r = table.get(Number(id.slice(4))) ?? (await requests("all", true)).find((x) => x.id === Number(id.slice(4)));
    if (!r) throw new Error(`no request ${id}`);
    const url = mediaUrl(r.type, r.media.tmdbId);
    switch (action) {
      case "copy": return { copy: url };
      case "approve": try { await approve(r.id); } catch (e) { return toast("Could not approve", String((e as Error).message), "failure"); } table.set(r.id, { ...r, status: 2 }); return toast("Approved", await titleOf(r.type, r.media.tmdbId).then((t) => t.title).catch(() => undefined));
      case "decline": try { await decline(r.id); } catch (e) { return toast("Could not decline", String((e as Error).message), "failure"); } table.set(r.id, { ...r, status: 3 }); return toast("Declined");
      default: return { open: url };
    }
  }
  if (id.startsWith("result:")) {
    const r = results.get(id.slice(7));
    if (!r || r.mediaType === "person") throw new Error(`no result ${id}`);
    const title = r.title ?? r.name ?? "";
    switch (action) {
      case "tmdb": return { copy: `https://www.themoviedb.org/${r.mediaType}/${r.id}` };
      case "open": return { open: mediaUrl(r.mediaType, r.id) };
      default: {
        try { await request(r.mediaType, r.id, action === "request4k"); } catch (e) { return toast("Could not request", String((e as Error).message), "failure"); }
        return { hud: `Requested ${truncate(title, 40)}${action === "request4k" ? " in 4K" : ""}` };
      }
    }
  }
}

export const detail = async (id: string): Promise<Detail | void> => { const r = id.startsWith("result:") ? results.get(id.slice(7)) : undefined; return r ? resultRow(r, false).detail : undefined; };

export async function health() {
  const [s, c] = await Promise.all([status(), counts().catch(() => undefined)]);
  return { version: s.version, note: c ? (c.pending ? `${c.pending} pending` : `${c.total} requests, none pending`) : "", url: seerrUrl() };
}
