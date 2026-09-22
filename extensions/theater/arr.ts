// Radarr, Sonarr and Lidarr share one API family (Servarr): the queue with
// its tracked state, the calendar, wanted, history, a lookup that adds
// with the default profile and root folder, the health warnings, and the
// ImportListSync command (per list, which sidesteps the Trakt list's
// hardcoded 12 h refresh interval). One `App` row per app says where the
// nouns differ: what a queue record hangs off, the id field, the web
// routes.
import { ago, bytes, dayName, dayNameYear, hint, tinted, toast, truncate, type Action, type Ctx, type Detail, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, eta, GLYPH, parseClock, pct, type ServiceId, type Tag } from "./http.ts";
import { dateOf, guard, pickHint, setupRow } from "./rows.ts";

export type ArrId = "radarr" | "sonarr" | "lidarr";
export type App = { id: ArrId; api: string; noun: string; nouns: string; title: string };
export const APPS: Record<ArrId, App> = {
  radarr: { id: "radarr", api: "/api/v3", noun: "movie", nouns: "movies", title: "Radarr" },
  sonarr: { id: "sonarr", api: "/api/v3", noun: "series", nouns: "series", title: "Sonarr" },
  lidarr: { id: "lidarr", api: "/api/v1", noun: "artist", nouns: "artists", title: "Lidarr" },
};

type Movie = { id?: number; title: string; year?: number; tmdbId: number; overview?: string; hasFile?: boolean; monitored?: boolean; images?: { coverType: string; remoteUrl?: string; url?: string }[]; ratings?: { tmdb?: { value: number } }; inCinemas?: string; digitalRelease?: string; physicalRelease?: string; status?: string; runtime?: number };
type Series = { id?: number; title: string; year?: number; tvdbId: number; titleSlug?: string; overview?: string; status?: string; network?: string; images?: Movie["images"]; seasons?: unknown[]; ratings?: { value?: number } };
type Episode = { id: number; seriesId: number; seasonNumber: number; episodeNumber: number; title: string; airDateUtc?: string; hasFile?: boolean; overview?: string; series?: Series };
type Artist = { id?: number; artistName: string; foreignArtistId: string; overview?: string; disambiguation?: string; artistType?: string; images?: Movie["images"]; ratings?: { value?: number } };
type Album = { id: number; title: string; artistId: number; releaseDate?: string; albumType?: string; artist?: Artist; monitored?: boolean; overview?: string };
export type QueueRecord = {
  id: number; title: string; status: string; trackedDownloadStatus?: "ok" | "warning" | "error"; trackedDownloadState?: string; statusMessages?: { title?: string; messages?: string[] }[]; errorMessage?: string;
  size: number; sizeleft: number; timeleft?: string; estimatedCompletionTime?: string; protocol?: string; downloadClient?: string; indexer?: string;
  movieId?: number; movie?: Movie; seriesId?: number; episodeId?: number; series?: Series; episode?: Episode; artistId?: number; albumId?: number; artist?: Artist; album?: Album;
};
type HistoryRecord = { id: number; eventType: string; sourceTitle: string; date: string; quality?: { quality?: { name?: string } }; data?: Record<string, string>; movie?: Movie; series?: Series; episode?: Episode; artist?: Artist; album?: Album };
type Health = { source: string; type: "ok" | "notice" | "warning" | "error"; message: string; wikiUrl?: string };
type Page<T> = { totalRecords: number; records: T[] };

const A = (id: ArrId) => APPS[id];
export const arrUrl = (id: ArrId) => conf(id).url;
const path = (id: ArrId, p: string) => `${A(id).api}${p}`;
const get = <T>(id: ArrId, p: string, query: Record<string, string | number | boolean | undefined> = {}) => api<T>(id, path(id, p), { query });
const includes = (id: ArrId) => id === "radarr" ? { includeMovie: true } : id === "sonarr" ? { includeSeries: true, includeEpisode: true } : { includeArtist: true, includeAlbum: true };

export const status = (id: ArrId) => api<{ version: string; appName: string }>(id, path(id, "/system/status"), { timeout: 3500 });
export const healthOf = (id: ArrId, refresh = false) => cached(`${id}:health`, 60_000, refresh, () => get<Health[]>(id, "/health"));
export const queue = (id: ArrId, refresh = false) => cached(`${id}:queue`, 15_000, refresh, async () => (await get<Page<QueueRecord>>(id, "/queue", { pageSize: 60, includeUnknownMovieItems: id === "radarr" ? true : undefined, includeUnknownSeriesItems: id === "sonarr" ? true : undefined, includeUnknownArtistItems: id === "lidarr" ? true : undefined, ...includes(id) })).records);
export const calendar = (id: ArrId, refresh = false) => cached(`${id}:calendar`, 300_000, refresh, () => {
  const start = new Date(), end = new Date(Date.now() + 7 * 86400_000);
  return get<(Movie | Episode | Album)[]>(id, "/calendar", { start: start.toISOString(), end: end.toISOString(), ...(id === "sonarr" && { includeSeries: true }), ...(id === "lidarr" && { includeArtist: true }) });
});
export const wanted = (id: ArrId, refresh = false) => cached(`${id}:wanted`, 300_000, refresh, async () => (await get<Page<Movie | Episode | Album>>(id, "/wanted/missing", { pageSize: 40, sortDirection: "descending", sortKey: id === "radarr" ? "movieMetadata.sortTitle" : id === "sonarr" ? "episodes.airDateUtc" : "releaseDate", ...(id === "sonarr" && { includeSeries: true }), ...(id === "lidarr" && { includeArtist: true }) })));
export const history = (id: ArrId, refresh = false) => cached(`${id}:history`, 120_000, refresh, async () => (await get<Page<HistoryRecord>>(id, "/history", { pageSize: 40, sortKey: "date", sortDirection: "descending", ...includes(id) })).records);
export const lookup = (id: ArrId, term: string) => get<(Movie | Series | Artist)[]>(id, `/${A(id).noun}/lookup`, { term });
export const removeFromQueue = (id: ArrId, item: number) => api(id, path(id, `/queue/${item}`), { method: "DELETE", query: { removeFromClient: true, blocklist: false }, text: true });
export const command = (id: ArrId, body: Record<string, unknown>) => api(id, path(id, "/command"), { body });

/** Every enabled import list synced now, each by `definitionId` (the whole-app sync honours the list's own refresh interval, a single list's does not); the plain command when there is no list. */
export async function syncLists(id: ArrId): Promise<number> {
  const lists = await get<{ id: number; enabled: boolean; name: string }[]>(id, "/importlist").catch(() => []);
  const on = lists.filter((l) => l.enabled);
  if (!on.length) { await command(id, { name: "ImportListSync" }); return 0; }
  await Promise.all(on.map((l) => command(id, { name: "ImportListSync", definitionId: l.id })));
  return on.length;
}

/** The first quality profile, root folder (and Lidarr's metadata profile): what Add uses, as the app's own Add form defaults to. */
async function defaults(id: ArrId) {
  const [profiles, roots, metas] = await Promise.all([get<{ id: number; name: string }[]>(id, "/qualityprofile"), get<{ id: number; path: string }[]>(id, "/rootfolder"), id === "lidarr" ? get<{ id: number }[]>(id, "/metadataprofile") : Promise.resolve([])]);
  if (!profiles[0] || !roots[0]) throw new Error(`${A(id).title} has no quality profile or root folder yet`);
  return { profile: profiles[0], root: roots[0], meta: metas[0] };
}

export async function add(id: ArrId, hit: Movie | Series | Artist, search: boolean): Promise<string> {
  const d = await defaults(id);
  const base = { qualityProfileId: d.profile.id, rootFolderPath: d.root.path, monitored: true };
  if (id === "radarr") { const m = hit as Movie; await api(id, path(id, "/movie"), { body: { ...base, title: m.title, tmdbId: m.tmdbId, year: m.year, minimumAvailability: "released", addOptions: { searchForMovie: search } } }); return m.title; }
  if (id === "sonarr") { const s = hit as Series; await api(id, path(id, "/series"), { body: { ...base, title: s.title, tvdbId: s.tvdbId, titleSlug: s.titleSlug, seasonFolder: true, seasons: s.seasons ?? [], addOptions: { searchForMissingEpisodes: search, monitor: "all" } } }); return s.title; }
  const a = hit as Artist;
  await api(id, path(id, "/artist"), { body: { ...base, artistName: a.artistName, foreignArtistId: a.foreignArtistId, metadataProfileId: d.meta?.id, addOptions: { searchForMissingAlbums: search, monitor: "all" } } });
  return a.artistName;
}

// ---- web routes ---------------------------------------------------------------------

const webOf = (id: ArrId, r: { movie?: Movie; series?: Series; artist?: Artist }): string => {
  const u = arrUrl(id);
  if (r.movie?.tmdbId) return `${u}/movie/${r.movie.tmdbId}`;
  if (r.series?.titleSlug) return `${u}/series/${r.series.titleSlug}`;
  if (r.artist?.foreignArtistId) return `${u}/artist/${r.artist.foreignArtistId}`;
  return `${u}/activity/queue`;
};
const posterOf = (r: { movie?: Movie; series?: Series; artist?: Artist } | Movie | Series | Artist): string | undefined => {
  const images = ("movie" in r && r.movie?.images) || ("series" in r && r.series?.images) || ("artist" in r && r.artist?.images) || ("images" in r ? r.images : undefined);
  return images?.find((i) => i.coverType === "poster")?.remoteUrl ?? images?.[0]?.remoteUrl;
};

// ---- queue ----------------------------------------------------------------------------

/** What the queue record is about, in words: the movie, `Series S1E4 Title`, `Artist · Album`. */
export function subjectOf(r: QueueRecord): string {
  if (r.movie) return `${r.movie.title}${r.movie.year ? ` (${r.movie.year})` : ""}`;
  if (r.series) return `${r.series.title}${r.episode ? ` S${r.episode.seasonNumber}E${r.episode.episodeNumber}${r.episode.title ? ` · ${r.episode.title}` : ""}` : ""}`;
  if (r.artist) return `${r.artist.artistName}${r.album ? ` · ${r.album.title}` : ""}`;
  return r.title;
}
/** The one line that says how it is going. */
export function stateOf(r: QueueRecord): Tag & { stuck: boolean; message?: string } {
  const msg = r.errorMessage ?? r.statusMessages?.flatMap((m) => m.messages ?? [])[0] ?? r.statusMessages?.[0]?.title;
  if (r.trackedDownloadStatus === "error") return { text: "error", color: "red", stuck: true, message: msg };
  if (r.trackedDownloadState === "importPending" || r.trackedDownloadState === "importBlocked") return { text: "needs a hand", color: "amber", stuck: true, message: msg ?? "Waiting for a manual import" };
  if (r.trackedDownloadState === "failedPending" || r.status === "failed") return { text: "failed", color: "red", stuck: true, message: msg };
  if (r.trackedDownloadStatus === "warning") return { text: "warning", color: "amber", stuck: true, message: msg };
  if (r.trackedDownloadState === "importing") return { text: "importing", color: "blue", stuck: false };
  if (r.status === "paused") return { text: "paused", color: "grey", stuck: false };
  if (r.status === "queued" || r.status === "delay") return { text: r.status, color: "grey", stuck: false };
  if (r.status === "completed") return { text: "done", color: "green", stuck: false };
  return { text: "downloading", color: "blue", stuck: false };
}
export const progressOf = (r: QueueRecord) => (r.size > 0 ? 1 - r.sizeleft / r.size : 0);

const queueTable = new Map<string, QueueRecord>();

export function queueRow(id: ArrId, r: QueueRecord, section = "Queue"): Item {
  queueTable.set(`${id}:${r.id}`, r);
  const st = stateOf(r), p = progressOf(r), left = parseClock(r.timeleft);
  const image = posterOf(r);
  return {
    id: `queue:${id}:${r.id}`,
    name: subjectOf(r),
    subtitle: [truncate(r.title, 70), st.message ? truncate(st.message, 80) : ""].filter(Boolean).join(" · "),
    icon: image ? { image } : GLYPH[id],
    keywords: [r.protocol ?? "", r.downloadClient ?? "", st.text],
    section,
    accessories: [
      { tag: st.text, color: st.color },
      ...(r.protocol ? [{ text: r.protocol }] : []),
      { text: p > 0 && p < 1 ? pct(p) : bytes(r.size) },
      ...(left && p < 1 ? [{ text: eta(left) }] : []),
    ],
    detail: { markdown: [image ? `![poster](${image})` : "", `**${subjectOf(r)}**`, r.title, ...(st.message ? [`> ${st.message}`] : []), ...(r.statusMessages?.flatMap((m) => (m.messages ?? []).map((x) => `- ${x}`)) ?? [])].filter(Boolean).join("\n\n"), metadata: [{ label: "State", tags: [{ text: st.text, color: st.color }] }, { label: "Progress", value: `${pct(p)} of ${bytes(r.size)}` }, ...(left ? [{ label: "Time left", value: eta(left) }] : []), ...(r.downloadClient ? [{ label: "Client", value: `${r.downloadClient}${r.protocol ? ` (${r.protocol})` : ""}` }] : []), ...(r.indexer ? [{ label: "Indexer", value: r.indexer }] : [])] },
    actions: [
      { id: "open", title: `Open in ${A(id).title}` },
      { id: "remove", title: "Remove from queue", shortcut: "cmd+backspace", style: "destructive", confirm: `Remove ${truncate(subjectOf(r), 40)} from the queue and the download client? It is not blocklisted.` },
      { id: "copy", title: "Copy release title", shortcut: "cmd+c" },
    ],
  };
}

// ---- calendar, wanted, history -----------------------------------------------------

const upcoming = (id: ArrId, x: Movie | Episode | Album): Item => {
  if (id === "radarr") {
    const m = x as Movie;
    const when = m.digitalRelease ?? m.physicalRelease ?? m.inCinemas;
    return { id: `cal:radarr:${m.id ?? m.tmdbId}`, name: `${m.title}${m.year ? ` (${m.year})` : ""}`, subtitle: when ? `${m.digitalRelease === when ? "Digital" : m.physicalRelease === when ? "Disc" : "Cinemas"} ${dayName(new Date(when).getTime())}` : "Upcoming", icon: posterOf(m) ? { image: posterOf(m)! } : GLYPH.calendar, section: "Next 7 days", accessories: m.hasFile ? [{ tag: "have", color: "green" }] : [], actions: [{ id: "open", title: "Open in Radarr" }], url: `${arrUrl("radarr")}/movie/${m.tmdbId}` };
  }
  if (id === "sonarr") {
    const e = x as Episode;
    return { id: `cal:sonarr:${e.id}`, name: `${e.series?.title ?? ""} S${e.seasonNumber}E${e.episodeNumber}${e.title ? ` · ${e.title}` : ""}`, subtitle: e.airDateUtc ? `Airs ${dayName(new Date(e.airDateUtc).getTime())}${e.series?.network ? ` on ${e.series.network}` : ""}` : "Upcoming", icon: e.series && posterOf(e.series) ? { image: posterOf(e.series)! } : GLYPH.calendar, section: "Next 7 days", accessories: e.hasFile ? [{ tag: "have", color: "green" }] : [], actions: [{ id: "open", title: "Open in Sonarr" }], url: e.series?.titleSlug ? `${arrUrl("sonarr")}/series/${e.series.titleSlug}` : arrUrl("sonarr") };
  }
  const a = x as Album;
  return { id: `cal:lidarr:${a.id}`, name: `${a.artist?.artistName ?? ""} · ${a.title}`, subtitle: a.releaseDate ? `${a.albumType ?? "Album"} out ${dayName(new Date(a.releaseDate).getTime())}` : "Upcoming", icon: GLYPH.album, section: "Next 7 days", actions: [{ id: "open", title: "Open in Lidarr" }], url: a.artist?.foreignArtistId ? `${arrUrl("lidarr")}/artist/${a.artist.foreignArtistId}` : arrUrl("lidarr") };
};

const wantedRow = (id: ArrId, x: Movie | Episode | Album): Item => {
  const search: Action = { id: "search", title: "Search now" }, open: Action = { id: "open", title: `Open in ${A(id).title}`, shortcut: "cmd+enter" };
  if (id === "radarr") {
    const m = x as Movie;
    return { id: `wanted:radarr:${m.id}`, name: `${m.title}${m.year ? ` (${m.year})` : ""}`, subtitle: [m.status, m.digitalRelease ? `digital ${dayNameYear(new Date(m.digitalRelease).getTime())}` : ""].filter(Boolean).join(" · "), icon: posterOf(m) ? { image: posterOf(m)! } : GLYPH.radarr, keywords: ["missing"], accessories: m.monitored === false ? [{ tag: "unmonitored", color: "grey" }] : [], detail: { markdown: m.overview }, actions: [search, open], url: `${arrUrl("radarr")}/movie/${m.tmdbId}` };
  }
  if (id === "sonarr") {
    const e = x as Episode;
    return { id: `wanted:sonarr:${e.id}`, name: `${e.series?.title ?? ""} S${e.seasonNumber}E${e.episodeNumber}${e.title ? ` · ${e.title}` : ""}`, subtitle: e.airDateUtc ? `Aired ${dayNameYear(new Date(e.airDateUtc).getTime())}` : "", icon: e.series && posterOf(e.series) ? { image: posterOf(e.series)! } : GLYPH.sonarr, keywords: ["missing", e.series?.title ?? ""], accessories: dateOf(e.airDateUtc), detail: { markdown: e.overview }, actions: [search, open], url: e.series?.titleSlug ? `${arrUrl("sonarr")}/series/${e.series.titleSlug}` : arrUrl("sonarr") };
  }
  const a = x as Album;
  return { id: `wanted:lidarr:${a.id}`, name: `${a.artist?.artistName ?? ""} · ${a.title}`, subtitle: [a.albumType, a.releaseDate ? dayNameYear(new Date(a.releaseDate).getTime()) : ""].filter(Boolean).join(" · "), icon: GLYPH.album, keywords: ["missing"], accessories: dateOf(a.releaseDate), actions: [search, open], url: a.artist?.foreignArtistId ? `${arrUrl("lidarr")}/artist/${a.artist.foreignArtistId}` : arrUrl("lidarr") };
};

const EVENT: Record<string, Tag> = { downloadImported: { text: "imported", color: "green" }, trackFileRetagged: { text: "retagged", color: "grey" }, grabbed: { text: "grabbed", color: "blue" }, downloadFolderImported: { text: "imported", color: "green" }, downloadFailed: { text: "failed", color: "red" }, downloadIgnored: { text: "ignored", color: "grey" }, movieFileDeleted: { text: "deleted", color: "grey" }, episodeFileDeleted: { text: "deleted", color: "grey" }, trackFileDeleted: { text: "deleted", color: "grey" }, movieFileRenamed: { text: "renamed", color: "grey" }, episodeFileRenamed: { text: "renamed", color: "grey" }, trackFileImported: { text: "imported", color: "green" }, albumImportIncomplete: { text: "incomplete", color: "amber" }, movieFolderImported: { text: "imported", color: "green" }, seriesFolderImported: { text: "imported", color: "green" } };

const historyRow = (id: ArrId, h: HistoryRecord): Item => {
  const ev = EVENT[h.eventType] ?? { text: h.eventType, color: "grey" };
  const subject = subjectOf({ ...h, id: 0, title: h.sourceTitle, status: "", size: 0, sizeleft: 0 });
  return {
    id: `history:${id}:${h.id}`,
    name: subject || h.sourceTitle,
    subtitle: [truncate(h.sourceTitle, 70), h.quality?.quality?.name, h.data?.indexer ?? h.data?.downloadClient, h.data?.message ? truncate(h.data.message, 60) : ""].filter(Boolean).join(" · "),
    icon: GLYPH.history,
    keywords: [ev.text],
    accessories: [{ tag: ev.text, color: ev.color }, { date: h.date }],
    detail: { metadata: [{ label: "Event", tags: [{ text: ev.text, color: ev.color }] }, { label: "Release", value: h.sourceTitle }, ...(h.quality?.quality?.name ? [{ label: "Quality", value: h.quality.quality.name }] : []), { label: "When", value: ago(h.date) }, ...Object.entries(h.data ?? {}).filter(([k, v]) => v && ["indexer", "downloadClient", "message", "reason", "importedPath", "droppedPath"].includes(k)).map(([k, v]) => ({ label: k, value: truncate(v, 200) }))] },
    actions: [{ id: "open", title: `Open in ${A(id).title}` }],
    url: webOf(id, h),
  };
}

// ---- the palettes ---------------------------------------------------------------

/** The app's home palette: commands on top, health warnings, the queue, the next seven days. */
export async function homeRows(id: ArrId, refresh: boolean): Promise<Item[]> {
  if (!configured(id)) return [];
  const app = A(id);
  const commands: Item[] = [
    { id: `cmd:${id}:add`, name: id === "radarr" ? "Add a movie" : id === "sonarr" ? "Add a series" : "Add an artist", subtitle: `Look it up on ${app.title} and add it with the default profile`, icon: GLYPH.plus, keywords: ["new"], section: app.title, actions: [{ id: "run", title: "Add" }] },
    { id: `cmd:${id}:wanted`, name: id === "radarr" ? "Wanted movies" : id === "sonarr" ? "Wanted episodes" : "Wanted albums", subtitle: "Monitored, without a file", icon: GLYPH.eye, keywords: ["missing"], section: app.title, actions: [{ id: "run", title: "Open" }] },
    { id: `cmd:${id}:history`, name: `${app.title} history`, subtitle: "Grabbed, imported, failed", icon: GLYPH.history, section: app.title, actions: [{ id: "run", title: "Open" }] },
    ...(id !== "lidarr" ? [{ id: `cmd:${id}:sync`, name: "Sync watchlist now", subtitle: "Run every import list (Trakt) now, without waiting for its interval", icon: GLYPH.sync, keywords: ["trakt", "import"], section: app.title, actions: [{ id: "run", title: "Sync now" }] } as Item] : []),
    { id: `cmd:${id}:open`, name: `Open ${app.title}`, subtitle: arrUrl(id), icon: GLYPH.web, section: app.title, actions: [{ id: "run", title: "Open" }] },
  ];
  return guard(async () => {
    const [q, cal, health] = await Promise.all([queue(id, refresh), calendar(id, refresh).catch(() => []), healthOf(id, refresh).catch(() => [] as Health[])]);
    const warnings = health.filter((h) => h.type === "warning" || h.type === "error").map((h): Item => ({ id: `health:${id}:${h.source}`, name: h.message, subtitle: h.source, icon: tinted(GLYPH.alert, h.type === "error" ? "red" : "amber"), section: "Health", accessories: [{ tag: h.type, color: h.type === "error" ? "red" : "amber" }], actions: h.wikiUrl ? [{ id: "wiki", title: "What this means (wiki)" }] : [], url: h.wikiUrl }));
    const rows = [...commands, ...warnings, ...q.map((r) => queueRow(id, r)), ...cal.map((x) => upcoming(id, x))];
    if (!q.length) rows.splice(commands.length + warnings.length, 0, hint(`idle:${id}`, "The queue is empty", `${app.title} is not fetching or importing anything`, { icon: GLYPH[id], section: "Queue" }));
    return rows;
  });
}

export async function wantedRows(id: ArrId, refresh: boolean): Promise<Item[]> {
  if (!configured(id)) return [];
  return guard(async () => {
    const w = await wanted(id, refresh);
    const rows = w.records.map((x) => wantedRow(id, x));
    return rows.length ? [...(w.totalRecords > rows.length ? [hint(`more:${id}`, `${w.totalRecords} wanted, the newest ${rows.length} here`, `The rest are on ${A(id).title}'s Wanted page`, { icon: GLYPH.eye, actions: [{ id: "open", title: "Open Wanted" }] })] : []), ...rows] : [hint(`none:${id}`, "Nothing wanted", `Every monitored ${A(id).noun} has its files`, { icon: GLYPH.check })];
  });
}

export async function historyRows(id: ArrId, refresh: boolean): Promise<Item[]> {
  if (!configured(id)) return [];
  return guard(async () => {
    const rows = (await history(id, refresh)).map((h) => historyRow(id, h));
    return rows.length ? rows : [hint(`none:${id}`, "No history yet", `${A(id).title} has not grabbed anything`, { icon: GLYPH.history })];
  });
}

const hits = new Map<string, Movie | Series | Artist>();

export async function lookupRows(id: ArrId, q: string): Promise<Item[]> {
  if (!configured(id)) return [setupRow(id)];
  const app = A(id);
  if (q.trim().length < 2) return [hint(`lookup:${id}`, `Add ${id === "radarr" ? "a movie" : id === "sonarr" ? "a series" : "an artist"}`, `Type a title; Enter adds it to ${app.title} with the default quality profile and root folder and searches`, { icon: GLYPH.plus })];
  return guard(async () => {
    const found = await lookup(id, q.trim());
    const rows = found.slice(0, 25).map((x): Item => {
      const key = id === "radarr" ? String((x as Movie).tmdbId) : id === "sonarr" ? String((x as Series).tvdbId) : (x as Artist).foreignArtistId;
      hits.set(`${id}:${key}`, x);
      const name = "artistName" in x ? x.artistName : x.title;
      const year = "year" in x && x.year ? ` (${x.year})` : "";
      const inLibrary = !!x.id;
      const image = posterOf(x);
      const sub = "artistName" in x ? [x.artistType, x.disambiguation].filter(Boolean).join(" · ") : "network" in x ? [x.network, x.status].filter(Boolean).join(" · ") : truncate((x as Movie).overview ?? "", 100);
      const ext = id === "radarr" ? `https://www.themoviedb.org/movie/${key}` : id === "sonarr" ? `https://thetvdb.com/dereferrer/series/${key}` : `https://musicbrainz.org/artist/${key}`;
      return {
        id: `hit:${id}:${key}`, name: `${name}${year}`, subtitle: sub || undefined, icon: image ? { image } : GLYPH[id], keywords: [app.noun],
        accessories: inLibrary ? [{ tag: "in library", color: "green" }] : [],
        detail: { markdown: [image ? `![poster](${image})` : "", x.overview ?? "_No overview._"].filter(Boolean).join("\n\n") },
        actions: inLibrary
          ? [{ id: "open", title: `Open in ${app.title}` }, { id: "ext", title: id === "radarr" ? "Open on TMDB" : id === "sonarr" ? "Open on TVDB" : "Open on MusicBrainz", shortcut: "cmd+o" }]
          : [{ id: "add", title: "Add and search", confirm: `Add ${name}${year} to ${app.title} with the default profile and start a search?` }, { id: "add-quiet", title: "Add without searching", shortcut: "cmd+enter", confirm: `Add ${name}${year} to ${app.title} without searching?` }, { id: "ext", title: id === "radarr" ? "Open on TMDB" : id === "sonarr" ? "Open on TVDB" : "Open on MusicBrainz", shortcut: "cmd+o" }],
        url: ext,
      };
    });
    return rows.length ? rows : [hint(`none:${id}`, "Nothing found", `${app.title} found no ${app.noun} for “${q.trim()}”`, { icon: GLYPH[id] })];
  });
}

export const detail = async (id: string): Promise<Detail | void> => { const r = id.startsWith("queue:") ? queueTable.get(id.slice(6)) : undefined; return r ? queueRow(r.movie ? "radarr" : r.series ? "sonarr" : "lidarr", r).detail : undefined; };

export async function pick(id: string, action?: string, _ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) {
    const m = /^hint:more:(\w+)$/.exec(id);
    if (m && action === "open") return { open: `${arrUrl(m[1] as ArrId)}/wanted/missing` };
    return pickHint(id);
  }
  const [kind, appId, ...rest] = id.split(":");
  const app = appId as ArrId;
  const key = rest.join(":");
  switch (kind) {
    case "cmd": {
      if (key === "add") return { push: { extension: "theater", palette: `${app}-add` } };
      if (key === "wanted") return { push: { extension: "theater", palette: `${app}-wanted` } };
      if (key === "history") return { push: { extension: "theater", palette: `${app}-history` } };
      if (key === "open") return { open: arrUrl(app) };
      if (key === "sync") { try { const n = await syncLists(app); return toast("Syncing", n ? `${n} import list${n === 1 ? "" : "s"} on ${A(app).title}` : `${A(app).title} runs every list`); } catch (e) { return toast("Could not sync", String((e as Error).message), "failure"); } }
      return;
    }
    case "health": return { open: `${arrUrl(app)}/system/status` };
    case "queue": {
      const r = queueTable.get(`${app}:${key}`);
      if (action === "copy") return { copy: r?.title ?? "" };
      if (action === "remove") { try { await removeFromQueue(app, Number(key)); } catch (e) { return toast("Could not remove", String((e as Error).message), "failure"); } queueTable.delete(`${app}:${key}`); return toast("Removed from the queue", r ? truncate(subjectOf(r), 50) : undefined); }
      return { open: r ? webOf(app, r) : `${arrUrl(app)}/activity/queue` };
    }
    case "cal": case "history": return; // the row's url opens
    case "wanted": {
      if (action === "open" || action === undefined) return;
      const body = app === "radarr" ? { name: "MoviesSearch", movieIds: [Number(key)] } : app === "sonarr" ? { name: "EpisodeSearch", episodeIds: [Number(key)] } : { name: "AlbumSearch", albumIds: [Number(key)] };
      try { await command(app, body); } catch (e) { return toast("Could not search", String((e as Error).message), "failure"); }
      return toast("Searching", `${A(app).title} is looking for it now`);
    }
    case "hit": {
      const x = hits.get(`${app}:${key}`);
      if (!x) throw new Error(`no lookup hit ${id}`);
      if (action === "ext") return;
      if (action === "open") return { open: webOf(app, app === "radarr" ? { movie: x as Movie } : app === "sonarr" ? { series: x as Series } : { artist: x as Artist }) };
      try { const name = await add(app, x, action !== "add-quiet"); return { hud: `Added ${truncate(name, 40)} to ${A(app).title}` }; } catch (e) { return toast("Could not add", String((e as Error).message), "failure"); }
    }
  }
}

/** For the Theater row: the version, the queue count and any health warning. */
export async function health(id: ArrId) {
  const [s, q, h] = await Promise.all([status(id), queue(id).catch(() => [] as QueueRecord[]), healthOf(id).catch(() => [] as Health[])]);
  const warn = h.filter((x) => x.type === "warning" || x.type === "error").length;
  const stuck = q.filter((r) => stateOf(r).stuck).length;
  return { version: s.version, note: [q.length ? `${q.length} in queue${stuck ? `, ${stuck} stuck` : ""}` : "queue empty", warn ? `${warn} health warning${warn === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "), url: arrUrl(id), warn: warn > 0 || stuck > 0 };
}

export const isArr = (id: ServiceId): id is ArrId => id in APPS;
