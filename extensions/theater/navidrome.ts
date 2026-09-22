// Navidrome over the Subsonic API (`/rest/<call>.view`, a salted token
// per request): what plays now, the albums added lately, a search over
// artists, albums and songs with cover art, star and unstar. Enter opens
// Navidrome's web app on the album or artist.
import { ago, hint, toast, type Ctx, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH, imageUrl } from "./http.ts";
import { guard, pickHint, setupRow } from "./rows.ts";

export type Artist = { id: string; name: string; albumCount?: number; coverArt?: string; starred?: string };
export type Album = { id: string; name: string; artist?: string; artistId?: string; coverArt?: string; songCount?: number; duration?: number; year?: number; genre?: string; created?: string; starred?: string };
export type Song = { id: string; title: string; artist?: string; artistId?: string; album?: string; albumId?: string; coverArt?: string; duration?: number; year?: number; starred?: string; track?: number };
type NowPlaying = Song & { username?: string; playerName?: string; minutesAgo?: number };

const call = <T>(name: string, query: Record<string, string | number | undefined> = {}) => api<T>("navidrome", `/rest/${name}.view`, { query });

export const navUrl = () => conf("navidrome").url;
export const ping = () => call<{ serverVersion?: string }>("ping", {});
export const nowPlaying = (refresh = false) => cached("navidrome:now", 15_000, refresh, async () => { const r = await call<{ nowPlaying?: { entry?: NowPlaying[] } }>("getNowPlaying"); return r.nowPlaying?.entry ?? []; });
export const newest = (refresh = false) => cached("navidrome:newest", 300_000, refresh, async () => (await call<{ albumList2?: { album?: Album[] } }>("getAlbumList2", { type: "newest", size: 24 })).albumList2?.album ?? []);
export const search3 = async (q: string) => (await call<{ searchResult3?: { artist?: Artist[]; album?: Album[]; song?: Song[] } }>("search3", { query: q, artistCount: 8, albumCount: 12, songCount: 15 })).searchResult3 ?? {};
export const star = (id: string, on: boolean) => call(on ? "star" : "unstar", { id });
export const cover = (id: string | undefined, size = 60) => (id ? imageUrl("navidrome", "/rest/getCoverArt.view", { id, size }) : Promise.resolve(undefined));

export const albumUrl = (id: string) => `${navUrl()}/app/#/album/${id}/show`;
export const artistUrl = (id: string) => `${navUrl()}/app/#/artist/${id}/show`;
const dur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

type Held = { kind: "artist" | "album" | "song"; starred: boolean; url: string; name: string };
const held = new Map<string, Held>();
const STAR = (starred: boolean) => ({ id: "star", title: starred ? "Unstar" : "Star", shortcut: "cmd+s" });
const COPY = { id: "copy", title: "Copy link", shortcut: "cmd+c" };

export async function artistRow(a: Artist, section = "Artists"): Promise<Item> {
  held.set(`artist:${a.id}`, { kind: "artist", starred: !!a.starred, url: artistUrl(a.id), name: a.name });
  const img = await cover(a.coverArt);
  return { id: `artist:${a.id}`, name: a.name, subtitle: a.albumCount ? `${a.albumCount} album${a.albumCount === 1 ? "" : "s"}` : "Artist", icon: img ? { image: img } : GLYPH.person, section, accessories: a.starred ? [{ tag: "starred", color: "amber" }] : [], actions: [{ id: "open", title: "Open in Navidrome" }, STAR(!!a.starred), COPY] };
}
export async function albumRow(a: Album, section = "Albums"): Promise<Item> {
  held.set(`album:${a.id}`, { kind: "album", starred: !!a.starred, url: albumUrl(a.id), name: a.name });
  const img = await cover(a.coverArt);
  return {
    id: `album:${a.id}`, name: a.name, subtitle: [a.artist, a.year, a.genre, a.songCount ? `${a.songCount} tracks` : ""].filter(Boolean).join(" · "), icon: img ? { image: img } : GLYPH.album, keywords: [a.artist ?? "", a.genre ?? ""].filter(Boolean), section,
    accessories: [...(a.starred ? [{ tag: "starred", color: "amber" }] : []), ...(a.created ? [{ date: a.created }] : [])],
    detail: { markdown: img ? `![cover](${await cover(a.coverArt, 300)})` : undefined, metadata: [{ label: "Artist", value: a.artist ?? "" }, ...(a.year ? [{ label: "Year", value: String(a.year) }] : []), ...(a.genre ? [{ label: "Genre", value: a.genre }] : []), ...(a.songCount ? [{ label: "Tracks", value: `${a.songCount}${a.duration ? ` · ${Math.round(a.duration / 60)} min` : ""}` }] : []), ...(a.created ? [{ label: "Added", value: ago(a.created) }] : [])] },
    actions: [{ id: "open", title: "Open in Navidrome" }, STAR(!!a.starred), COPY],
  };
}
export async function songRow(s: Song, section = "Songs"): Promise<Item> {
  const url = s.albumId ? albumUrl(s.albumId) : navUrl();
  held.set(`song:${s.id}`, { kind: "song", starred: !!s.starred, url, name: s.title });
  const img = await cover(s.coverArt);
  return { id: `song:${s.id}`, name: s.title, subtitle: [s.artist, s.album, dur(s.duration)].filter(Boolean).join(" · "), icon: img ? { image: img } : GLYPH.song, keywords: [s.artist ?? "", s.album ?? ""].filter(Boolean), section, accessories: s.starred ? [{ tag: "starred", color: "amber" }] : [], actions: [{ id: "open", title: "Open the album in Navidrome" }, STAR(!!s.starred), COPY] };
}

export async function homeRows(refresh: boolean): Promise<Item[]> {
  if (!configured("navidrome")) return [];
  return guard(async () => {
    const [now, albums] = await Promise.all([nowPlaying(refresh).catch(() => [] as NowPlaying[]), newest(refresh)]);
    const playing = await Promise.all(now.map(async (n) => ({ ...(await songRow(n, "Now playing")), subtitle: [n.username, n.playerName, n.minutesAgo !== undefined ? `${n.minutesAgo} min ago` : ""].filter(Boolean).join(" · ") + (n.artist ? ` · ${n.artist}` : "") })));
    const recent = await Promise.all(albums.map((a) => albumRow(a, "Recently added")));
    const rows = [...playing, ...recent];
    return rows.length ? rows : [hint("empty", "Nothing in Navidrome yet", "Music lands under its library folder; Navidrome rescans on its own", { icon: GLYPH.navidrome })];
  });
}

export async function searchRows(q: string): Promise<Item[]> {
  if (!configured("navidrome")) return [setupRow("navidrome")];
  if (q.trim().length < 2) return [hint("search", "Search Navidrome", "Artists, albums and songs", { icon: GLYPH.navidrome })];
  return guard(async () => {
    const r = await search3(q.trim());
    const rows = [...(await Promise.all((r.artist ?? []).map((a) => artistRow(a)))), ...(await Promise.all((r.album ?? []).map((a) => albumRow(a)))), ...(await Promise.all((r.song ?? []).map((s) => songRow(s))))];
    return rows.length ? rows : [hint("none", "Nothing found", `Navidrome has nothing for “${q.trim()}”`, { icon: GLYPH.navidrome })];
  });
}

export async function pick(id: string, action?: string, _ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  const h = held.get(id);
  if (!h) throw new Error(`no row ${id}`);
  switch (action) {
    case "copy": return { copy: h.url };
    case "star": {
      try { await star(id.slice(id.indexOf(":") + 1), !h.starred); } catch (e) { return toast("Could not star", String((e as Error).message), "failure"); }
      held.set(id, { ...h, starred: !h.starred });
      return toast(h.starred ? "Unstarred" : "Starred", h.name);
    }
    default: return { open: h.url };
  }
}

export async function health() {
  const [p, now] = await Promise.all([ping(), nowPlaying().catch(() => [] as NowPlaying[])]);
  return { version: (p.serverVersion ?? "").split(" ")[0] ?? "", note: now.length ? `${now.length} listening` : "nothing playing", url: navUrl() };
}
