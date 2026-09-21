// The Spotify Web API: one `api()` call with the bearer from auth.ts,
// renewed once on a 401; a 429 remembered for its `Retry-After` and every
// call until then refused locally (`RateLimited`), so a burst of picks
// never digs the hole deeper; a network failure is `Offline`. The typed
// endpoints below normalise Spotify's objects to the few shapes the
// palettes draw (`Track`, `Artist`, `Album`, `Playlist`, `Show`, `Device`,
// `Player`). `PAL_SPOTIFY_API` points the tests at a mock.
import { errorMessage } from "@zcag/pal";
import { accessToken, NotSignedIn } from "./auth.ts";

export const API = (process.env.PAL_SPOTIFY_API || "https://api.spotify.com").replace(/\/+$/, "");
export const REQUEST_MS = 10_000;
/** A `Retry-After` up to this is waited out inside the call rather than surfaced. */
const WAIT_MS = 2000;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly reason?: string) { super(message); }
  /** No device has Spotify open, or the one that had went to sleep. */
  get noDevice() { return this.status === 404 && (this.reason === "NO_ACTIVE_DEVICE" || /device/i.test(this.message)); }
  get premium() { return this.status === 403 && (this.reason === "PREMIUM_REQUIRED" || /premium/i.test(this.message)); }
}
export class RateLimited extends Error {
  constructor(public readonly until: number) { super(`Spotify rate limit: try again in ${Math.max(1, Math.ceil((until - Date.now()) / 1000))} s`); }
}
export class Offline extends Error {
  constructor(cause: unknown) { super(`Spotify is unreachable (${errorMessage(cause)})`); }
}

/** When the last 429 said to come back; 0 when the way is clear. */
let limitedUntil = 0;

type Opts = { query?: Record<string, string | number | boolean | undefined>; body?: unknown; retried?: boolean };

/**
 * One request. `undefined` for a 204 (nothing playing, a command taken).
 * Throws `NotSignedIn`, `RateLimited`, `Offline` or `ApiError` (Spotify's
 * message and `reason`).
 */
export async function api<T = unknown>(method: string, path: string, opts: Opts = {}): Promise<T | undefined> {
  if (Date.now() < limitedUntil) throw new RateLimited(limitedUntil);
  const q: [string, string][] = Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]);
  const url = `${API}/v1${path}${q.length ? `?${new URLSearchParams(q)}` : ""}`;
  const token = await accessToken(opts.retried);
  let res: Response;
  try {
    res = await fetch(url, {
      method, signal: AbortSignal.timeout(REQUEST_MS),
      headers: { authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    throw new Offline(e);
  }
  if (res.status === 401 && !opts.retried) return api<T>(method, path, { ...opts, retried: true });
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after") ?? "1") || 1;
    if (after * 1000 <= WAIT_MS && !opts.retried) { await Bun.sleep(after * 1000); return api<T>(method, path, { ...opts, retried: true }); }
    limitedUntil = Date.now() + after * 1000;
    throw new RateLimited(limitedUntil);
  }
  if (res.status === 204 || res.status === 202) return undefined;
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (!res.ok) {
    if (res.status === 401) throw new NotSignedIn("signed_out");
    throw new ApiError(res.status, json?.error?.message || `${res.status} ${res.statusText}`, json?.error?.reason);
  }
  return json as T;
}

// ---- shapes -------------------------------------------------------------

export type Image = { url: string; width: number | null; height: number | null };
export type Track = {
  kind: "track" | "episode";
  id: string; uri: string; name: string; url: string;
  /** Artists joined with `, `; the show's name for an episode. */
  artist: string;
  album: string;
  /** Milliseconds. */
  duration: number;
  /** The 300 px cover (the middle of Spotify's three), and the 64 px one. */
  cover?: string; thumb?: string;
  explicit?: boolean;
};
export type Artist = { kind: "artist"; id: string; uri: string; name: string; url: string; cover?: string; thumb?: string; genres: string[]; followers: number };
export type Album = { kind: "album"; id: string; uri: string; name: string; url: string; artist: string; cover?: string; thumb?: string; year: string; tracks: number; type: string };
export type Playlist = { kind: "playlist"; id: string; uri: string; name: string; url: string; owner: string; ownerId: string; cover?: string; thumb?: string; tracks: number; description: string; collaborative: boolean };
export type Show = { kind: "show"; id: string; uri: string; name: string; url: string; publisher: string; cover?: string; thumb?: string };
export type Device = { id: string | null; name: string; type: string; active: boolean; volume: number | null; restricted: boolean; supportsVolume: boolean };
export type Player = {
  track?: Track;
  playing: boolean;
  /** Milliseconds into the track at `at`. */
  progress: number;
  /** Local ms when the state was read; the position ticks from it while playing. */
  at: number;
  shuffle: boolean;
  repeat: "off" | "track" | "context";
  device?: Device;
  /** `spotify:playlist:...`, `spotify:album:...`, or nothing. */
  context?: string;
  /** `ad`, `unknown`: something is on that is not a track or episode. */
  type: string;
};

const cover = (images: Image[] | undefined): { cover?: string; thumb?: string } => {
  if (!images?.length) return {};
  const byH = images.slice().sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  const mid = byH.find((i) => (i.height ?? 0) >= 200) ?? byH[byH.length - 1];
  return { cover: mid.url, thumb: byH[0].url };
};
const url = (o: any, kind: string, id: string) => o?.external_urls?.spotify ?? `https://open.spotify.com/${kind}/${id}`;

/** A track or an episode as Spotify sends it, to `Track`; null for an ad, a local file without an id, or nothing. */
export function toTrack(o: any): Track | undefined {
  if (!o || typeof o !== "object" || !o.id) return undefined;
  if (o.type === "episode") {
    return { kind: "episode", id: o.id, uri: o.uri, name: o.name, url: url(o, "episode", o.id), artist: o.show?.name ?? o.show?.publisher ?? "", album: o.show?.name ?? "", duration: o.duration_ms ?? 0, ...cover(o.images ?? o.show?.images) };
  }
  return { kind: "track", id: o.id, uri: o.uri, name: o.name, url: url(o, "track", o.id), artist: (o.artists ?? []).map((a: any) => a.name).join(", "), album: o.album?.name ?? "", duration: o.duration_ms ?? 0, explicit: !!o.explicit, ...cover(o.album?.images) };
}
export const toArtist = (o: any): Artist => ({ kind: "artist", id: o.id, uri: o.uri, name: o.name, url: url(o, "artist", o.id), genres: o.genres ?? [], followers: o.followers?.total ?? 0, ...cover(o.images) });
export const toAlbum = (o: any): Album => ({ kind: "album", id: o.id, uri: o.uri, name: o.name, url: url(o, "album", o.id), artist: (o.artists ?? []).map((a: any) => a.name).join(", "), year: String(o.release_date ?? "").slice(0, 4), tracks: o.total_tracks ?? 0, type: o.album_type ?? "album", ...cover(o.images) });
export const toPlaylist = (o: any): Playlist => ({ kind: "playlist", id: o.id, uri: o.uri, name: o.name, url: url(o, "playlist", o.id), owner: o.owner?.display_name ?? o.owner?.id ?? "", ownerId: o.owner?.id ?? "", tracks: o.tracks?.total ?? 0, description: String(o.description ?? "").replace(/<[^>]+>/g, ""), collaborative: !!o.collaborative, ...cover(o.images) });
export const toShow = (o: any): Show => ({ kind: "show", id: o.id, uri: o.uri, name: o.name, url: url(o, "show", o.id), publisher: o.publisher ?? "", ...cover(o.images) });
export const toDevice = (o: any): Device => ({ id: o.id ?? null, name: o.name, type: o.type ?? "", active: !!o.is_active, volume: o.volume_percent ?? null, restricted: !!o.is_restricted, supportsVolume: o.supports_volume !== false });

export function toPlayer(o: any, at = Date.now()): Player | undefined {
  if (!o || typeof o !== "object") return undefined;
  return {
    track: toTrack(o.item), playing: !!o.is_playing, progress: o.progress_ms ?? 0, at,
    shuffle: !!o.shuffle_state, repeat: (["off", "track", "context"].includes(o.repeat_state) ? o.repeat_state : "off"),
    device: o.device ? toDevice(o.device) : undefined, context: o.context?.uri ?? undefined, type: o.currently_playing_type ?? "unknown",
  };
}

/** The position now, in ms, from a state read earlier: it ticks while playing and stops at the end. */
export const positionOf = (p: Player, now = Date.now()): number => {
  const raw = p.playing ? p.progress + (now - p.at) : p.progress;
  return p.track ? Math.min(Math.max(0, raw), p.track.duration) : Math.max(0, raw);
};

// ---- endpoints ----------------------------------------------------------

export const me = () => api<{ id: string; display_name: string; product: string }>("GET", "/me");
/** The playback state; undefined when nothing is active (204). */
export const player = async (): Promise<Player | undefined> => toPlayer(await api("GET", "/me/player", { query: { additional_types: "track,episode" } }));
export const devices = async (): Promise<Device[]> => ((await api<{ devices: any[] }>("GET", "/me/player/devices"))?.devices ?? []).map(toDevice);
export const queue = async (): Promise<{ current?: Track; queue: Track[] }> => {
  const q = await api<{ currently_playing: any; queue: any[] }>("GET", "/me/player/queue");
  return { current: toTrack(q?.currently_playing), queue: (q?.queue ?? []).map(toTrack).filter((t): t is Track => !!t) };
};

export const play = (what?: { context?: string; uris?: string[]; offset?: { uri?: string; position?: number }; positionMs?: number }, device?: string) =>
  api("PUT", "/me/player/play", { query: { device_id: device }, body: what ? { context_uri: what.context, uris: what.uris, offset: what.offset, position_ms: what.positionMs } : undefined });
export const pause = () => api("PUT", "/me/player/pause");
export const next = () => api("POST", "/me/player/next");
export const previous = () => api("POST", "/me/player/previous");
export const seek = (ms: number) => api("PUT", "/me/player/seek", { query: { position_ms: Math.max(0, Math.round(ms)) } });
export const setVolume = (percent: number) => api("PUT", "/me/player/volume", { query: { volume_percent: Math.min(100, Math.max(0, Math.round(percent))) } });
export const setShuffle = (on: boolean) => api("PUT", "/me/player/shuffle", { query: { state: on } });
export const setRepeat = (mode: Player["repeat"]) => api("PUT", "/me/player/repeat", { query: { state: mode } });
export const transfer = (deviceId: string, playNow = true) => api("PUT", "/me/player", { body: { device_ids: [deviceId], play: playNow } });
export const enqueue = (uri: string) => api("POST", "/me/player/queue", { query: { uri } });

export type SearchResult = { tracks: Track[]; artists: Artist[]; albums: Album[]; playlists: Playlist[]; shows: Show[]; episodes: Track[] };
export const SEARCH_TYPES = "track,artist,album,playlist,show,episode";
export async function search(q: string, limit = 5): Promise<SearchResult> {
  const r = await api<any>("GET", "/search", { query: { q, type: SEARCH_TYPES, limit } });
  const items = (k: string): any[] => (r?.[k]?.items ?? []).filter(Boolean);
  return {
    tracks: items("tracks").map(toTrack).filter((t): t is Track => !!t),
    artists: items("artists").map(toArtist),
    albums: items("albums").map(toAlbum),
    playlists: items("playlists").map(toPlaylist),
    shows: items("shows").map(toShow),
    episodes: items("episodes").map((e) => toTrack({ ...e, type: "episode" })).filter((t): t is Track => !!t),
  };
}

/** Every page of a list endpoint, `max` items at most. */
async function pages<T>(path: string, query: Record<string, string | number>, max: number): Promise<T[]> {
  const out: T[] = [];
  let nextUrl: string | undefined = `${path}`;
  let first = true;
  while (nextUrl && out.length < max) {
    const r: any = first ? await api<any>("GET", nextUrl, { query: { ...query, limit: 50 } }) : await api<any>("GET", nextUrl.replace(/^.*\/v1/, ""));
    first = false;
    out.push(...((r?.items ?? []) as T[]));
    nextUrl = r?.next ?? undefined;
  }
  return out.slice(0, max);
}

export const playlists = async (max = 200): Promise<Playlist[]> => (await pages<any>("/me/playlists", {}, max)).filter(Boolean).map(toPlaylist);
/** Appends the track (or episode) to a playlist of the user's own or a collaborative one; a 403 otherwise, or with a token that predates the playlist scopes. */
export const addToPlaylist = (id: string, uri: string) => api("POST", `/playlists/${id}/tracks`, { body: { uris: [uri] } });
export const playlistTracks = async (id: string, max = 200): Promise<Track[]> =>
  (await pages<any>(`/playlists/${id}/tracks`, { fields: "items(added_at,track(id,uri,name,type,duration_ms,explicit,external_urls,artists(name),album(name,images))),next" }, max)).map((i) => toTrack(i?.track)).filter((t): t is Track => !!t);
export const liked = async (max = 100): Promise<(Track & { addedAt: string })[]> =>
  (await pages<any>("/me/tracks", {}, max)).map((i) => { const t = toTrack(i?.track); return t ? { ...t, addedAt: i.added_at } : undefined; }).filter((t): t is Track & { addedAt: string } => !!t);
export const recent = async (limit = 50): Promise<(Track & { playedAt: string })[]> =>
  ((await api<any>("GET", "/me/player/recently-played", { query: { limit } }))?.items ?? []).map((i: any) => { const t = toTrack(i?.track); return t ? { ...t, playedAt: i.played_at } : undefined; }).filter(Boolean);
export const topTracks = async (range: "short_term" | "medium_term" | "long_term" = "short_term", limit = 50): Promise<Track[]> =>
  ((await api<any>("GET", "/me/top/tracks", { query: { time_range: range, limit } }))?.items ?? []).map(toTrack).filter(Boolean);
export const topArtists = async (range: "short_term" | "medium_term" | "long_term" = "short_term", limit = 50): Promise<Artist[]> =>
  ((await api<any>("GET", "/me/top/artists", { query: { time_range: range, limit } }))?.items ?? []).map(toArtist);

/** Whether each id is in Liked Songs. */
export const contains = async (ids: string[]): Promise<boolean[]> => (ids.length ? (await api<boolean[]>("GET", "/me/tracks/contains", { query: { ids: ids.join(",") } })) ?? [] : []);
export const like = (ids: string[]) => api("PUT", "/me/tracks", { query: { ids: ids.join(",") } });
export const unlike = (ids: string[]) => api("DELETE", "/me/tracks", { query: { ids: ids.join(",") } });
