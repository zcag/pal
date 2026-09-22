// Jellyfin: Continue Watching and Latest with posters, a title search
// with a detail pane, Now Playing (the sessions), and the actions on an
// item: open in the web UI, play on a signed-in device (a picker), mark
// played or unplayed, favourite. One API key (server-wide) plus the user
// whose watched state the rows show (`jellyfin_user`, else the first).
import { ago, hint, tinted, toast, truncate, type Action, type Ctx, type Detail, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH, jellyfinUser, pct, runtime } from "./http.ts";
import { dateOf, guard, pickHint, setupRow } from "./rows.ts";

export type JfItem = {
  Id: string; Name: string; Type: string; ServerId?: string; SeriesName?: string; SeriesId?: string; SeasonName?: string; IndexNumber?: number; ParentIndexNumber?: number;
  ProductionYear?: number; Overview?: string; RunTimeTicks?: number; CommunityRating?: number; OfficialRating?: string; Genres?: string[]; Album?: string; AlbumArtist?: string; Artists?: string[];
  ImageTags?: { Primary?: string; Thumb?: string }; ParentThumbItemId?: string; AlbumId?: string; PremiereDate?: string; DateCreated?: string; Status?: string; ChildCount?: number;
  UserData?: { Played?: boolean; PlaybackPositionTicks?: number; PlayCount?: number; IsFavorite?: boolean; UnplayedItemCount?: number; LastPlayedDate?: string };
};
export type JfSession = { Id: string; UserName?: string; DeviceName?: string; Client?: string; LastActivityDate?: string; SupportsRemoteControl?: boolean; NowPlayingItem?: JfItem; PlayState?: { PositionTicks?: number; IsPaused?: boolean; PlayMethod?: string } };
type JfUser = { Id: string; Name: string; Policy?: { IsAdministrator?: boolean } };

const FIELDS = "Overview,Genres,DateCreated,ProductionYear";
const POSTER_H = 60;

export const webUrl = (id: string) => `${conf("jellyfin").url}/web/#/details?id=${id}`;
export const jfHome = () => `${conf("jellyfin").url}/web/`;

/** The user the rows are about: the setting by name, else the first administrator, else the first user. */
export async function userId(): Promise<string> {
  return cached("jellyfin:user", 3600_000, false, async () => {
    const users = await api<JfUser[]>("jellyfin", "/Users");
    const want = jellyfinUser().toLowerCase();
    const u = (want && users.find((x) => x.Name.toLowerCase() === want)) || users.find((x) => x.Policy?.IsAdministrator) || users[0];
    if (!u) throw new Error("Jellyfin has no users");
    return u.Id;
  });
}

export const info = () => api<{ ServerName: string; Version: string; Id: string }>("jellyfin", "/System/Info/Public", { timeout: 3500 });
export const sessions = (refresh = false) => cached("jellyfin:sessions", 10_000, refresh, () => api<JfSession[]>("jellyfin", "/Sessions", { query: { activeWithinSeconds: 960 } }));
export const playing = async (refresh = false) => (await sessions(refresh)).filter((s) => s.NowPlayingItem);
export const resume = async (refresh = false) => cached("jellyfin:resume", 60_000, refresh, async () => (await api<{ Items: JfItem[] }>("jellyfin", "/UserItems/Resume", { query: { userId: await userId(), limit: 20, mediaTypes: "Video", fields: FIELDS } })).Items);
export const latest = async (refresh = false) => cached("jellyfin:latest", 60_000, refresh, async () => api<JfItem[]>("jellyfin", "/Items/Latest", { query: { userId: await userId(), limit: 24, includeItemTypes: "Movie,Series,Episode", fields: FIELDS } }));
export const search = async (q: string) => (await api<{ Items: JfItem[] }>("jellyfin", "/Items", { query: { userId: await userId(), searchTerm: q, recursive: true, includeItemTypes: "Movie,Series,Episode,MusicAlbum,Audio", limit: 30, fields: FIELDS } })).Items;
const item = async (id: string) => api<JfItem>("jellyfin", `/Items/${id}`, { query: { userId: await userId(), fields: FIELDS } });

export const setPlayed = async (id: string, played: boolean) => { await api("jellyfin", `/UserPlayedItems/${id}`, { method: played ? "POST" : "DELETE", query: { userId: await userId() } }); };
export const setFavorite = async (id: string, fav: boolean) => { await api("jellyfin", `/UserFavoriteItems/${id}`, { method: fav ? "POST" : "DELETE", query: { userId: await userId() } }); };
export const playOn = (session: string, itemId: string) => api("jellyfin", `/Sessions/${session}/Playing`, { method: "POST", query: { playCommand: "PlayNow", itemIds: itemId }, text: true });
export const control = (session: string, command: "PlayPause" | "Stop") => api("jellyfin", `/Sessions/${session}/Playing/${command}`, { method: "POST", text: true });

/** The poster: the item's own primary image, else its series' (an episode), else nothing. Jellyfin serves images without a key. */
export function poster(it: JfItem, h = POSTER_H): string | undefined {
  const base = conf("jellyfin").url;
  if (it.ImageTags?.Primary) return `${base}/Items/${it.Id}/Images/Primary?fillHeight=${h}&fillWidth=${Math.round(h * 2 / 3)}&quality=85&tag=${it.ImageTags.Primary}`;
  if (it.SeriesId) return `${base}/Items/${it.SeriesId}/Images/Primary?fillHeight=${h}&fillWidth=${Math.round(h * 2 / 3)}&quality=85`;
  if (it.AlbumId) return `${base}/Items/${it.AlbumId}/Images/Primary?fillHeight=${h}&fillWidth=${h}&quality=85`;
}

/** `S1E4` for an episode. */
const epCode = (it: JfItem) => it.ParentIndexNumber !== undefined && it.IndexNumber !== undefined ? `S${it.ParentIndexNumber}E${it.IndexNumber}` : "";
/** How far into it the user is, 0..1. */
export const progress = (it: JfItem) => it.RunTimeTicks && it.UserData?.PlaybackPositionTicks ? it.UserData.PlaybackPositionTicks / it.RunTimeTicks : 0;

/** The row's name: an episode leads with its series and code, the rest with the title. */
export const nameOf = (it: JfItem) => (it.Type === "Episode" ? `${[it.SeriesName, epCode(it)].filter(Boolean).join(" ")} · ${it.Name}` : it.Name);
/** The subtitle: what kind, the year, the runtime. */
function describe(it: JfItem): string {
  const parts: string[] = [];
  if (it.Type === "Episode") parts.push("Episode");
  else if (it.Type === "Audio") parts.push([it.AlbumArtist ?? it.Artists?.[0], it.Album].filter(Boolean).join(" · "));
  else if (it.Type === "MusicAlbum") parts.push(it.AlbumArtist ?? it.Artists?.[0] ?? "Album");
  else parts.push(it.Type === "Series" ? "Series" : "Movie");
  if (it.ProductionYear && it.Type !== "Episode") parts.push(String(it.ProductionYear));
  const rt = runtime(it.RunTimeTicks);
  if (rt && it.Type !== "Series") parts.push(rt);
  return parts.join(" · ");
}

const table = new Map<string, JfItem>();
const remember = (it: JfItem) => { table.set(it.Id, it); return it; };
const find = async (id: string) => table.get(id) ?? remember(await item(id));

const ITEM_ACTIONS: Action[] = [
  { id: "open", title: "Open in Jellyfin" },
  { id: "play", title: "Play on a device", shortcut: "cmd+enter" },
  { id: "played", title: "Mark played / unplayed", shortcut: "cmd+shift+p" },
  { id: "favourite", title: "Favourite / unfavourite", shortcut: "cmd+f" },
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
];

export function itemRow(it: JfItem, section?: string): Item {
  remember(it);
  const p = progress(it), ud = it.UserData;
  const played = ud?.Played, fav = ud?.IsFavorite;
  const image = poster(it);
  return {
    id: `item:${it.Id}`,
    name: nameOf(it),
    subtitle: describe(it),
    icon: image ? { image } : it.Type === "Audio" || it.Type === "MusicAlbum" ? GLYPH.song : GLYPH.jellyfin,
    keywords: [it.SeriesName ?? "", it.Type, ...(it.Genres ?? []), it.AlbumArtist ?? ""].filter(Boolean),
    ...(section && { section }),
    accessories: [
      ...(p > 0.01 && !played ? [{ text: pct(p) }] : []),
      ...(it.Type === "Series" && ud?.UnplayedItemCount ? [{ text: `${ud.UnplayedItemCount} unplayed` }] : []),
      ...(fav ? [{ tag: "favourite", color: "pink" }] : []),
      ...(played ? [{ tag: "played", color: "green" }] : []),
      ...(it.CommunityRating ? [{ text: `★ ${it.CommunityRating.toFixed(1)}` }] : []),
    ],
    actions: ITEM_ACTIONS,
  };
}

export function itemDetail(it: JfItem): Detail {
  const p = progress(it), ud = it.UserData;
  const image = poster(it, 240);
  const md = [image ? `![poster](${image})` : "", it.Overview ?? "_No overview._"].filter(Boolean).join("\n\n");
  return {
    markdown: md,
    metadata: [
      { label: "Type", value: it.Type === "Episode" ? `Episode · ${[it.SeriesName, epCode(it)].filter(Boolean).join(" ")}` : it.Type },
      ...(it.ProductionYear ? [{ label: "Year", value: String(it.ProductionYear) }] : []),
      ...(it.RunTimeTicks && it.Type !== "Series" ? [{ label: "Runtime", value: runtime(it.RunTimeTicks) }] : []),
      ...(it.CommunityRating ? [{ label: "Rating", value: `★ ${it.CommunityRating.toFixed(1)}${it.OfficialRating ? ` · ${it.OfficialRating}` : ""}` }] : it.OfficialRating ? [{ label: "Rated", value: it.OfficialRating }] : []),
      ...(it.Genres?.length ? [{ label: "Genres", value: it.Genres.join(", ") }] : []),
      { label: "Watched", value: ud?.Played ? `Yes${ud.LastPlayedDate ? `, ${ago(ud.LastPlayedDate)}` : ""}` : p > 0.01 ? `${pct(p)} in` : "No", ...(ud?.IsFavorite && { tags: [{ text: "favourite", color: "pink" }] }) },
      ...(it.DateCreated ? [{ label: "Added", value: ago(it.DateCreated) }] : []),
      { label: "Jellyfin", link: { text: "Open", href: webUrl(it.Id) } },
    ],
  };
}

export async function detail(id: string): Promise<Detail | void> {
  if (!id.startsWith("item:")) return;
  try { return itemDetail(await find(id.slice(5))); } catch { return; }
}

/** Continue Watching, then Latest; a favourite or a played item says so on the row. */
export async function homeRows(refresh: boolean): Promise<Item[]> {
  if (!configured("jellyfin")) return [];
  return guard(async () => {
    const [cont, late] = await Promise.all([resume(refresh), latest(refresh)]);
    const seen = new Set<string>();
    const rows: Item[] = [];
    for (const it of cont) { seen.add(it.Id); rows.push(itemRow(it, "Continue Watching")); }
    for (const it of late) if (!seen.has(it.Id)) { seen.add(it.Id); rows.push({ ...itemRow(it, "Latest"), accessories: [...(itemRow(it).accessories ?? []), ...dateOf(it.DateCreated)] }); }
    if (!rows.length) rows.push(hint("empty", "Nothing to continue and nothing new", "Jellyfin's libraries have no recent additions for this user", { icon: GLYPH.jellyfin }));
    return rows;
  });
}

export async function searchRows(q: string): Promise<Item[]> {
  if (!configured("jellyfin")) return [setupRow("jellyfin")];
  if (q.trim().length < 2) return [hint("search", "Search Jellyfin", "Movies, series, episodes, albums and songs by title", { icon: GLYPH.jellyfin })];
  return guard(async () => {
    const hits = await search(q.trim());
    const order = ["Movie", "Series", "Episode", "MusicAlbum", "Audio"];
    const rows = hits.slice().sort((a, b) => order.indexOf(a.Type) - order.indexOf(b.Type)).map((it) => itemRow(it, it.Type === "Movie" ? "Movies" : it.Type === "Series" ? "Series" : it.Type === "Episode" ? "Episodes" : "Music"));
    return rows.length ? rows : [hint("none", "Nothing found", `No item in the library matches “${q.trim()}”; Request a title asks Jellyseerr for it`, { icon: GLYPH.jellyfin, actions: [{ id: "request", title: "Request a title" }] })];
  });
}

/** One row per session that plays something: user, device, the item, the position. */
export function sessionRow(s: JfSession, section?: string): Item {
  const it = s.NowPlayingItem!;
  remember(it);
  const pos = it.RunTimeTicks && s.PlayState?.PositionTicks ? s.PlayState.PositionTicks / it.RunTimeTicks : 0;
  const image = poster(it);
  return {
    id: `session:${s.Id}`,
    name: nameOf(it),
    subtitle: [s.UserName, [s.DeviceName, s.Client].filter(Boolean).join(" · ")].filter(Boolean).join(" on "),
    icon: image ? { image } : tinted(GLYPH.play, "violet"),
    keywords: [s.UserName ?? "", s.DeviceName ?? "", it.SeriesName ?? ""].filter(Boolean),
    ...(section && { section }),
    accessories: [
      ...(s.PlayState?.IsPaused ? [{ tag: "paused", color: "amber" }] : [{ tag: "playing", color: "green" }]),
      ...(s.PlayState?.PlayMethod && s.PlayState.PlayMethod !== "DirectPlay" ? [{ tag: s.PlayState.PlayMethod.toLowerCase(), color: "grey" }] : []),
      { text: pct(pos) },
    ],
    actions: [
      { id: "open", title: "Open the item in Jellyfin" },
      { id: "playpause", title: s.PlayState?.IsPaused ? "Resume" : "Pause", shortcut: "cmd+enter" },
      { id: "stop", title: "Stop playback", shortcut: "cmd+shift+s", style: "destructive", confirm: `Stop playback on ${s.DeviceName ?? "the device"}?` },
    ],
  };
}

export async function playingRows(refresh: boolean): Promise<Item[]> {
  if (!configured("jellyfin")) return [];
  return guard(async () => {
    const list = await playing(refresh);
    return list.length ? list.map((s) => sessionRow(s)) : [hint("idle", "Nothing playing", "No Jellyfin session is playing anything right now", { icon: GLYPH.jellyfin })];
  });
}

/** The picker Play on a device pushes: every session that takes remote control. */
export async function playRows(ctx?: Ctx): Promise<Item[]> {
  const args = ctx?.args as { item?: string; name?: string } | undefined;
  if (!args?.item) return [];
  return guard(async () => {
    const list = (await sessions(true)).filter((s) => s.SupportsRemoteControl !== false && s.DeviceName);
    if (!list.length) return [hint("none", "No device to play on", "A Jellyfin app has to be open and signed in somewhere (the TV, a phone, the web); this key's sessions are what shows here", { icon: GLYPH.cast })];
    return list.map((s): Item => ({
      id: `session:${s.Id}`,
      name: s.DeviceName ?? s.Client ?? s.Id,
      subtitle: [s.Client, s.UserName, s.NowPlayingItem ? `playing ${truncate(s.NowPlayingItem.Name, 30)}` : s.LastActivityDate ? `active ${ago(s.LastActivityDate)}` : ""].filter(Boolean).join(" · "),
      icon: tinted(GLYPH.cast, "violet"),
      accessories: s.NowPlayingItem ? [{ tag: "playing", color: "green" }] : [],
      actions: [{ id: "play", title: `Play ${truncate(args.name ?? "it", 30)} here` }],
    }));
  });
}

export async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) {
    if (id === "hint:none" && action === "request") return { push: { extension: "theater", palette: "seerr-request" } };
    return pickHint(id);
  }
  if (id.startsWith("session:")) {
    const sid = id.slice(8);
    const args = ctx?.args as { item?: string } | undefined;
    if (action === "play" || args?.item) {
      if (!args?.item) return;
      try { await playOn(sid, args.item); } catch (e) { return toast("Could not play", String((e as Error).message), "failure"); }
      return { hud: "Playing" };
    }
    const s = (await sessions()).find((x) => x.Id === sid);
    switch (action) {
      case "playpause": try { await control(sid, "PlayPause"); } catch (e) { return toast("Could not pause", String((e as Error).message), "failure"); } return toast(s?.PlayState?.IsPaused ? "Resumed" : "Paused");
      case "stop": try { await control(sid, "Stop"); } catch (e) { return toast("Could not stop", String((e as Error).message), "failure"); } return toast("Stopped");
      default: return { open: s?.NowPlayingItem ? webUrl(s.NowPlayingItem.Id) : jfHome() };
    }
  }
  if (!id.startsWith("item:")) return;
  const it = await find(id.slice(5));
  switch (action) {
    case "copy": return { copy: webUrl(it.Id) };
    case "play": return { push: { extension: "theater", palette: "jellyfin-play", args: { item: it.Id, name: it.Name }, title: `Play ${truncate(it.Name, 30)} on` } };
    case "played": {
      const to = !it.UserData?.Played;
      try { await setPlayed(it.Id, to); } catch (e) { return toast("Could not mark", String((e as Error).message), "failure"); }
      remember({ ...it, UserData: { ...it.UserData, Played: to, PlaybackPositionTicks: 0 } });
      return toast(to ? "Marked played" : "Marked unplayed", it.Name);
    }
    case "favourite": {
      const to = !it.UserData?.IsFavorite;
      try { await setFavorite(it.Id, to); } catch (e) { return toast("Could not favourite", String((e as Error).message), "failure"); }
      remember({ ...it, UserData: { ...it.UserData, IsFavorite: to } });
      return toast(to ? "Added to favourites" : "Removed from favourites", it.Name);
    }
    default: return { open: webUrl(it.Id) };
  }
}

/** For the Theater row: the version and how many sessions play. */
export async function health() {
  const [i, s] = await Promise.all([info(), playing().catch(() => [] as JfSession[])]);
  return { version: i.Version, note: s.length ? `${s.length} watching` : "nothing playing", url: jfHome() };
}
