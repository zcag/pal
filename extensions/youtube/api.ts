// YouTube as data: the Data API v3 with a key, or an Invidious instance
// without one, each answering the same `Video` and `Channel` shapes, plus
// the formatting the rows use. Pure but for the fetches; the tests run
// the parsers on canned replies and the palette against a mock
// (`PAL_YOUTUBE_API` points the Data API host elsewhere; the Invidious
// host is the setting itself).
import { errorMessage } from "@zcag/pal";

export type Video = {
  id: string;
  title: string;
  channel: string;
  channelId: string;
  /** Seconds; 0 for a live stream or when unknown. */
  seconds: number;
  views?: number;
  /** Unix ms. */
  published?: number;
  live?: boolean;
};
export type Channel = { id: string; title: string; avatar?: string; subscribers?: number; description?: string };

const DATA_API = process.env.PAL_YOUTUBE_API ?? "https://www.googleapis.com/youtube/v3";
const FETCH_MS = 6000;
export const LIMIT = 25;

export class YouTubeError extends Error {
  constructor(message: string, readonly hint: string) { super(message); }
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const channelUrl = (id: string) => `https://www.youtube.com/channel/${id}`;
/** The thumbnail from YouTube's image host: the same for either backend, and it needs no key. `default` is 120 by 90, `mqdefault` 320 by 180. */
export const thumbUrl = (id: string, size: "default" | "mqdefault" | "hqdefault" = "default") => `https://i.ytimg.com/vi/${id}/${size}.jpg`;

/** `PT1H2M3S` to seconds; `P0D` (a live stream) is 0. */
export function isoSeconds(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export const duration = (s: number): string => (s <= 0 ? "live" : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
export const count = (n: number | undefined, what: string): string => (n === undefined ? "" : `${n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K` : String(n)} ${what}`);
export const age = (t: number | undefined, now = Date.now()): string => {
  if (!t) return "";
  const d = Math.max(0, now - t) / 1000;
  const [n, unit] = d < 3600 ? [Math.floor(d / 60), "minute"] : d < 86400 ? [Math.floor(d / 3600), "hour"] : d < 86400 * 30 ? [Math.floor(d / 86400), "day"] : d < 86400 * 365 ? [Math.floor(d / (86400 * 30)), "month"] : [Math.floor(d / (86400 * 365)), "year"];
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
};

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

// ---- Data API v3 ---------------------------------------------------------------------

type ApiSearchItem = { id?: { videoId?: string; channelId?: string }; snippet?: { title?: string; channelTitle?: string; channelId?: string; publishedAt?: string; liveBroadcastContent?: string; description?: string; thumbnails?: Record<string, { url?: string }> } };
type ApiVideo = { id?: string; snippet?: ApiSearchItem["snippet"]; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } };

/** A `videos.list` item (search hits are looked up here for the duration and the views). */
export function parseApiVideos(reply: unknown): Video[] {
  const items = (reply as { items?: ApiVideo[] })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((v) => {
    if (!v.id || !v.snippet?.title) return [];
    const live = v.snippet.liveBroadcastContent === "live";
    return [{ id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle ?? "", channelId: v.snippet.channelId ?? "", seconds: live ? 0 : isoSeconds(v.contentDetails?.duration), views: num(v.statistics?.viewCount), published: v.snippet.publishedAt ? Date.parse(v.snippet.publishedAt) : undefined, live }];
  });
}

export function parseApiChannels(reply: unknown): Channel[] {
  const items = (reply as { items?: ApiSearchItem[] })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((c) => (c.id?.channelId && c.snippet?.title ? [{ id: c.id.channelId, title: c.snippet.title, avatar: c.snippet.thumbnails?.default?.url, description: c.snippet.description }] : []));
}

async function api<T>(path: string, params: Record<string, string>, key: string): Promise<T> {
  const res = await fetch(`${DATA_API}/${path}?${new URLSearchParams({ ...params, key })}`, { signal: AbortSignal.timeout(FETCH_MS) });
  if (res.status === 400 || res.status === 403) {
    const reason = ((await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } })?.error?.errors?.[0]?.reason ?? "";
    throw new YouTubeError(`api ${res.status} ${reason}`, reason === "quotaExceeded" ? "The Data API's daily quota is used up (10,000 units; a search is 100): tomorrow, or set `invidious_url`" : "YouTube refused the key: check `api_key` and that YouTube Data API v3 is enabled on its project");
  }
  if (!res.ok) throw new YouTubeError(`api ${res.status}`, `YouTube answered ${res.status}`);
  return (await res.json()) as T;
}

/** Search (100 quota units), then the hits' durations and views in one `videos.list` (1 unit). */
async function apiSearch(q: string, key: string, channelId?: string): Promise<Video[]> {
  const found = await api<{ items?: ApiSearchItem[] }>("search", { part: "snippet", type: "video", maxResults: String(LIMIT), ...(q ? { q } : {}), ...(channelId ? { channelId, order: "date" } : {}) }, key);
  const ids = (found.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
  if (!ids.length) return [];
  return parseApiVideos(await api("videos", { part: "snippet,contentDetails,statistics", id: ids.join(",") }, key));
}

const apiTrending = async (key: string, region: string): Promise<Video[]> => parseApiVideos(await api("videos", { part: "snippet,contentDetails,statistics", chart: "mostPopular", maxResults: String(LIMIT), ...(region ? { regionCode: region } : {}) }, key));
const apiChannels = async (q: string, key: string): Promise<Channel[]> => parseApiChannels(await api("search", { part: "snippet", type: "channel", maxResults: String(LIMIT), q }, key));

// ---- Invidious ------------------------------------------------------------------------

type InvVideo = { type?: string; videoId?: string; title?: string; author?: string; authorId?: string; lengthSeconds?: number; viewCount?: number; published?: number; liveNow?: boolean };
type InvChannel = { type?: string; authorId?: string; author?: string; authorThumbnails?: { url?: string; width?: number }[]; subCount?: number; description?: string };

/** Videos out of a search, trending or channel reply (channel rows in a mixed search are skipped). */
export function parseInvVideos(reply: unknown): Video[] {
  const list = Array.isArray(reply) ? reply : (reply as { videos?: unknown[] })?.videos;
  if (!Array.isArray(list)) return [];
  return (list as InvVideo[]).flatMap((v) => (v.videoId && v.title && (v.type ?? "video") === "video" ? [{ id: v.videoId, title: v.title, channel: v.author ?? "", channelId: v.authorId ?? "", seconds: v.liveNow ? 0 : v.lengthSeconds ?? 0, views: num(v.viewCount), published: v.published ? v.published * 1000 : undefined, live: !!v.liveNow }] : []));
}

/** An instance may hand a protocol-relative avatar url (`//yt3.ggpht.com/...`), which the webview would take as its own. */
const absolute = (url?: string) => (url?.startsWith("//") ? `https:${url}` : url);

export function parseInvChannels(reply: unknown): Channel[] {
  if (!Array.isArray(reply)) return [];
  return (reply as InvChannel[]).flatMap((c) => (c.type === "channel" && c.authorId && c.author ? [{ id: c.authorId, title: c.author, avatar: absolute(c.authorThumbnails?.find((t) => (t.width ?? 0) >= 76)?.url ?? c.authorThumbnails?.at(-1)?.url), subscribers: num(c.subCount), description: c.description }] : []));
}

async function inv<T>(base: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams(params).toString();
  let res: Response;
  try { res = await fetch(`${base.replace(/\/+$/, "")}/api/v1/${path}${q ? `?${q}` : ""}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_MS) }); }
  catch (e) { throw new YouTubeError(`invidious ${errorMessage(e)}`, (e as Error)?.name === "TimeoutError" ? `${new URL(base).host} did not answer within ${FETCH_MS / 1000} s` : `Could not reach ${base}: ${errorMessage(e)}`); }
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new YouTubeError(`invidious ${res.status}`, `${new URL(base).host} does not serve the API (${res.status}${res.ok ? ", not JSON" : ""}): most public instances turned it off; run one, or set api_key`);
  return (await res.json()) as T;
}

// ---- one door ---------------------------------------------------------------------------

export type Source = { kind: "api"; key: string; region: string } | { kind: "invidious"; url: string; region: string };

export function search(src: Source, q: string): Promise<Video[]> {
  if (src.kind === "api") return q ? apiSearch(q, src.key) : apiTrending(src.key, src.region);
  return q ? inv(src.url, "search", { q, type: "video" }).then(parseInvVideos) : inv(src.url, "trending", src.region ? { region: src.region } : {}).then(parseInvVideos);
}

export function channelVideos(src: Source, channelId: string): Promise<Video[]> {
  if (src.kind === "api") return apiSearch("", src.key, channelId);
  return inv(src.url, `channels/${encodeURIComponent(channelId)}/videos`).then(parseInvVideos);
}

export function channels(src: Source, q: string): Promise<Channel[]> {
  if (src.kind === "api") return apiChannels(q, src.key);
  return inv(src.url, "search", { q, type: "channel" }).then(parseInvChannels);
}
