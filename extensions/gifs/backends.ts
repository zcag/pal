// GIF backends as data: Tenor v2 (the default, a free Google Cloud key)
// and Giphy, each answering one normalised `Gif` per result. Pure but
// for the fetch, so the tests run the parsers on canned replies and the
// palette against a mock (`PAL_GIFS_TENOR` / `PAL_GIFS_GIPHY` point the
// hosts elsewhere).

export type Backend = "tenor" | "giphy";
export type Gif = {
  /** `<backend>:<id>`, stable: what the favourites are keyed by. */
  id: string;
  backend: Backend;
  title: string;
  /** The page on tenor.com / giphy.com. */
  page: string;
  /** The full GIF (what Enter downloads and cmd+Enter copies). */
  gif: string;
  /** A small animated preview for the grid (Tenor's nanogif, Giphy's fixed_height_small). */
  preview: string;
  width: number;
  height: number;
  /** Bytes of the full GIF when the backend says. */
  size?: number;
};

export const TENOR = process.env.PAL_GIFS_TENOR ?? "https://tenor.googleapis.com";
export const GIPHY = process.env.PAL_GIFS_GIPHY ?? "https://api.giphy.com";
export const FETCH_MS = 6000;
/** Rows per listing: four rows of six in the grid. */
export const LIMIT = 24;

/** `content_filter`: Tenor's `contentfilter` and Giphy's `rating` mean roughly the same four steps. */
export type Filter = "off" | "low" | "medium" | "high";
const GIPHY_RATING: Record<Filter, string> = { off: "r", low: "pg-13", medium: "pg", high: "g" };

export class GifError extends Error {
  constructor(message: string, readonly hint: string) { super(message); }
}

const str = (v: unknown, or = "") => (typeof v === "string" ? v : or);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

// ---- Tenor ----------------------------------------------------------------------

type TenorMedia = { url?: string; dims?: number[]; size?: number };
type TenorResult = { id?: string; title?: string; content_description?: string; itemurl?: string; url?: string; media_formats?: Record<string, TenorMedia> };

/** One Tenor result: the `gif` format is the file, `nanogif` (else `tinygif`) the preview; a result without a gif url is dropped. */
export function parseTenor(reply: unknown): Gif[] {
  const results = (reply as { results?: TenorResult[] })?.results;
  if (!Array.isArray(results)) return [];
  const out: Gif[] = [];
  for (const r of results) {
    const f = r.media_formats ?? {};
    const gif = f.gif?.url;
    const preview = f.nanogif?.url ?? f.tinygif?.url ?? gif;
    if (!r.id || !gif || !preview) continue;
    const [w, h] = f.gif?.dims ?? [];
    out.push({ id: `tenor:${r.id}`, backend: "tenor", title: str(r.content_description) || str(r.title) || "GIF", page: str(r.itemurl) || str(r.url), gif, preview, width: w ?? 0, height: h ?? 0, size: num(f.gif?.size) });
  }
  return out;
}

async function tenor(path: string, params: Record<string, string>, key: string, filter: Filter): Promise<Gif[]> {
  if (!key) throw new GifError("no tenor key", "Set `tenor_api_key` under Settings › Extensions › GIFs (a free key: console.cloud.google.com, enable the Tenor API)");
  const q = new URLSearchParams({ key, client_key: "pal", limit: String(LIMIT), media_filter: "gif,nanogif,tinygif", contentfilter: filter, ...params });
  const res = await fetch(`${TENOR}/v2/${path}?${q}`, { signal: AbortSignal.timeout(FETCH_MS) });
  if (res.status === 400 || res.status === 403) throw new GifError(`tenor ${res.status}`, "Tenor refused the key: check `tenor_api_key` and that the Tenor API is enabled on its project");
  if (res.status === 429) throw new GifError("tenor 429", "Tenor's rate limit: try again in a moment");
  if (!res.ok) throw new GifError(`tenor ${res.status}`, `Tenor answered ${res.status}`);
  return parseTenor(await res.json());
}

// ---- Giphy ----------------------------------------------------------------------

type GiphyImage = { url?: string; width?: string; height?: string; size?: string };
type GiphyResult = { id?: string; title?: string; url?: string; images?: Record<string, GiphyImage> };

/** One Giphy result: `original` is the file, `fixed_height_small` (100 px tall, animated) the preview. */
export function parseGiphy(reply: unknown): Gif[] {
  const data = (reply as { data?: GiphyResult[] })?.data;
  if (!Array.isArray(data)) return [];
  const out: Gif[] = [];
  for (const r of data) {
    const i = r.images ?? {};
    const gif = i.original?.url;
    const preview = i.fixed_height_small?.url ?? i.preview_gif?.url ?? gif;
    if (!r.id || !gif || !preview) continue;
    out.push({ id: `giphy:${r.id}`, backend: "giphy", title: str(r.title).replace(/\s*GIF$/i, "") || "GIF", page: str(r.url), gif, preview, width: num(i.original?.width) ?? 0, height: num(i.original?.height) ?? 0, size: num(i.original?.size) });
  }
  return out;
}

async function giphy(path: string, params: Record<string, string>, key: string, filter: Filter): Promise<Gif[]> {
  if (!key) throw new GifError("no giphy key", "Set `giphy_api_key` under Settings › Extensions › GIFs (a free key: developers.giphy.com, Create an App)");
  const q = new URLSearchParams({ api_key: key, limit: String(LIMIT), rating: GIPHY_RATING[filter], ...params });
  const res = await fetch(`${GIPHY}/v1/gifs/${path}?${q}`, { signal: AbortSignal.timeout(FETCH_MS) });
  if (res.status === 401 || res.status === 403) throw new GifError(`giphy ${res.status}`, "Giphy refused the key: check `giphy_api_key`");
  if (res.status === 429) throw new GifError("giphy 429", "Giphy's rate limit: try again in a moment");
  if (!res.ok) throw new GifError(`giphy ${res.status}`, `Giphy answered ${res.status}`);
  return parseGiphy(await res.json());
}

// ---- one door --------------------------------------------------------------------

/** A search, or the backend's trending list for an empty query. */
export function search(backend: Backend, query: string, key: string, filter: Filter): Promise<Gif[]> {
  const q = query.trim();
  if (backend === "giphy") return q ? giphy("search", { q }, key, filter) : giphy("trending", {}, key, filter);
  return q ? tenor("search", { q }, key, filter) : tenor("featured", {}, key, filter);
}

/** A file name the OS is happy with, from the title: a paste into a chat or a Save shows it. */
export const fileName = (g: Gif) => `${(g.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "gif").slice(0, 60)}.gif`;

/** By the magic bytes, since a backend may hand a webp or a png under a .gif name. */
export const mimeOf = (b: Buffer): string => (b.subarray(0, 4).toString("latin1") === "GIF8" ? "image/gif" : b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG" ? "image/png" : b.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp" : "image/jpeg");

export const BACKEND_NAME: Record<Backend, string> = { tenor: "Tenor", giphy: "Giphy" };
