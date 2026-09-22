// Immich as data: one client over its REST API (`x-api-key`), the assets,
// albums, people and memories normalised to what the rows need, and the
// pure helpers around them (the place line, the exposure line, the wall
// clock a photo was taken at, the `since:` / `in:` / file-name grammar of
// a query, the file a download is named). Pure but for the fetches, so
// the tests run the parsers on canned replies and the palettes against a
// mock (`url` is the setting itself; nothing else to point elsewhere).
// Written against v3.1 (probed 2026-09-22) and the v3.2 OpenAPI spec:
// `visibility` is sent on every search, since v3 lists archived and
// hidden assets when it is left out.
import { errorMessage } from "@zcag/pal";

export type Client = { url: string; key: string; /** The address links open at (`web_url`), the API's when unset: an API reached over a tailnet, a site with a public name. */ web: string };

/** Immich's `AssetResponseDto`, the fields the rows read; `exifInfo` when the search asked `withExif`. */
type RawExif = { make?: string | null; model?: string | null; lensModel?: string | null; fNumber?: number | null; focalLength?: number | null; iso?: number | null; exposureTime?: string | null; fileSizeInByte?: number | null; exifImageWidth?: number | null; exifImageHeight?: number | null; city?: string | null; state?: string | null; country?: string | null; latitude?: number | null; longitude?: number | null; description?: string | null; dateTimeOriginal?: string | null; timeZone?: string | null };
type RawPerson = { id?: string; name?: string; isFavorite?: boolean; isHidden?: boolean; birthDate?: string | null };
type RawAsset = { id?: string; type?: string; originalFileName?: string; originalMimeType?: string; localDateTime?: string; fileCreatedAt?: string; duration?: number | string | null; isFavorite?: boolean; isArchived?: boolean; visibility?: string; width?: number | null; height?: number | null; exifInfo?: RawExif | null; people?: RawPerson[]; tags?: { name?: string }[]; thumbhash?: string | null };
type RawAlbum = { id?: string; albumName?: string; description?: string; assetCount?: number; shared?: boolean; hasSharedLink?: boolean; albumThumbnailAssetId?: string | null; startDate?: string | null; endDate?: string | null; lastModifiedAssetTimestamp?: string | null; updatedAt?: string; albumUsers?: { role?: string; user?: { id?: string; name?: string } }[] };
type RawMemory = { id?: string; type?: string; data?: { year?: number }; memoryAt?: string; assets?: RawAsset[] };
type SearchReply = { assets?: { items?: RawAsset[]; nextPage?: string | null; nextCursor?: string | null } };

export type Asset = {
  id: string;
  kind: "image" | "video";
  /** `originalFileName`. */
  file: string;
  mime: string;
  /** The wall clock where the photo was taken (Immich's `localDateTime`), as unix ms read with the UTC getters. */
  taken: number;
  /** Seconds, a video. */
  duration?: number;
  favorite: boolean;
  archived: boolean;
  width?: number;
  height?: number;
  bytes?: number;
  /** "Serdivan, Sakarya, Türkiye": city, state and country, whichever are set. */
  place?: string;
  city?: string;
  country?: string;
  /** "Apple iPhone 13 mini". */
  camera?: string;
  lens?: string;
  /** "ƒ/1.6 · 1/100 s · ISO 100 · 5.1 mm". */
  exposure?: string;
  lat?: number;
  lon?: number;
  description?: string;
  /** The named people on it (unnamed faces are counted in `faces`). */
  people: string[];
  faces: number;
  tags: string[];
};

export type Album = { id: string; name: string; description: string; count: number; shared: boolean; /** The cover's asset id. */ cover?: string; /** Unix ms of the first and last photo. */ start?: number; end?: number; /** Unix ms the album last changed. */ modified: number; owned: boolean };
export type Person = { id: string; name: string; favorite: boolean; hidden: boolean; birthDate?: string };
export type Memory = { id: string; year: number; /** The day it recalls, unix ms. */ at: number; assets: Asset[] };
export type Stats = { images?: number; videos?: number; /** Bytes on disk, when the key may read the server's statistics. */ usage?: number };

export const FETCH_MS = 20_000;
/** A CLIP query after the ML container restarted loads the text model first, which alone takes past 20 s. */
export const SEARCH_MS = 45_000;
export const ORIGINAL_MS = 120_000;
/** Assets per page: four rows of six in the grid. */
export const PAGE = 24;

export class ImmichError extends Error {
  constructor(message: string, readonly hint: string, readonly status?: number) { super(message); }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const ms = (iso: unknown): number | undefined => { const t = typeof iso === "string" ? Date.parse(iso) : NaN; return Number.isNaN(t) ? undefined : t; };

// ---- shapes -----------------------------------------------------------------------------

/** `exposureTime` is "1/100" or "0.5"; the line reads as a camera's display. */
export function exposureOf(e: RawExif): string | undefined {
  const bits = [e.fNumber ? `ƒ/${e.fNumber}` : "", e.exposureTime ? `${e.exposureTime} s` : "", e.iso ? `ISO ${e.iso}` : "", e.focalLength ? `${e.focalLength} mm` : ""].filter(Boolean);
  return bits.length ? bits.join(" · ") : undefined;
}

/** City, state, country, once each and in that order, whichever the geocoder set. */
export function placeOf(e: RawExif | null | undefined): string | undefined {
  if (!e) return;
  const parts: string[] = [];
  for (const p of [e.city, e.state, e.country]) if (p && !parts.includes(p)) parts.push(p);
  return parts.length ? parts.join(", ") : undefined;
}

/** v3 sends a video's duration as milliseconds; v2 sent "00:00:31.689". Whole seconds either way, none under one (a clip whose metadata failed reads 65 ms). */
export function durationOf(d: number | string | null | undefined): number | undefined {
  let s: number;
  if (typeof d === "number") s = d / 1000;
  else {
    const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(d ?? "");
    if (!m) return;
    s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return s >= 1 ? Math.round(s) : undefined;
}

export function parseAsset(r: RawAsset): Asset | undefined {
  if (!r.id) return;
  const e = r.exifInfo ?? undefined;
  const people = (r.people ?? []).filter((p) => p && !p.isHidden);
  const camera = [e?.make, e?.model].filter(Boolean).join(" ").trim();
  return {
    id: r.id,
    kind: r.type === "VIDEO" ? "video" : "image",
    file: r.originalFileName ?? r.id,
    mime: r.originalMimeType ?? "",
    taken: ms(r.localDateTime) ?? ms(r.fileCreatedAt) ?? 0,
    duration: durationOf(r.duration),
    favorite: !!r.isFavorite,
    archived: r.visibility === "archive" || !!r.isArchived,
    width: num(e?.exifImageWidth) ?? num(r.width),
    height: num(e?.exifImageHeight) ?? num(r.height),
    bytes: num(e?.fileSizeInByte),
    place: placeOf(e),
    city: str(e?.city),
    country: str(e?.country),
    camera: camera || undefined,
    lens: str(e?.lensModel),
    exposure: e ? exposureOf(e) : undefined,
    lat: num(e?.latitude),
    lon: num(e?.longitude),
    description: str(e?.description?.trim()),
    people: people.map((p) => p.name?.trim() ?? "").filter(Boolean),
    faces: people.length,
    tags: (r.tags ?? []).map((t) => t.name ?? "").filter(Boolean),
  };
}

export const parseAssets = (list: unknown): Asset[] => (Array.isArray(list) ? (list as RawAsset[]).flatMap((r) => parseAsset(r) ?? []) : []);

export function parseAlbum(r: RawAlbum, me?: string): Album | undefined {
  if (!r.id || typeof r.albumName !== "string") return;
  const owner = (r.albumUsers ?? []).find((u) => u.role === "owner")?.user?.id;
  return {
    id: r.id, name: r.albumName || "Untitled album", description: r.description?.trim() ?? "", count: num(r.assetCount) ?? 0,
    shared: !!r.shared || !!r.hasSharedLink, cover: r.albumThumbnailAssetId ?? undefined,
    start: ms(r.startDate), end: ms(r.endDate), modified: ms(r.lastModifiedAssetTimestamp) ?? ms(r.updatedAt) ?? 0,
    owned: !me || !owner || owner === me,
  };
}

export const parseAlbums = (list: unknown, me?: string): Album[] => (Array.isArray(list) ? (list as RawAlbum[]).flatMap((r) => parseAlbum(r, me) ?? []) : []);

export const parsePeople = (reply: unknown): Person[] => {
  const list = (reply as { people?: RawPerson[] })?.people;
  return Array.isArray(list) ? list.flatMap((p) => (p.id ? [{ id: p.id, name: p.name?.trim() ?? "", favorite: !!p.isFavorite, hidden: !!p.isHidden, birthDate: p.birthDate ?? undefined }] : [])) : [];
};

export const parseMemories = (reply: unknown): Memory[] =>
  Array.isArray(reply) ? (reply as RawMemory[]).flatMap((m) => (m.id && m.data?.year ? [{ id: m.id, year: m.data.year, at: ms(m.memoryAt) ?? 0, assets: parseAssets(m.assets) }] : [])) : [];

// ---- the query ----------------------------------------------------------------------------

/**
 * What a typed query asks for: `text` for CLIP, or a `file` name when the
 * words look like one (`DSC00500`, `IMG-20260418-WA0021.jpg`, a `.heic`),
 * with `since:2025` / `since:2025-03-10` / `--since 2025` (`takenAfter`),
 * `before:2024` (`takenBefore`, exclusive), `in:2023` (that year),
 * `in:Ataşehir` (the city as Immich stores it), `type:video` / `type:photo`
 * and `is:favourite` / `is:archived` (what the dropdown does, as words, so
 * a link can say it) lifted out of the words.
 */
export type Query = { text: string; file?: string; since?: string; before?: string; city?: string; type?: "IMAGE" | "VIDEO"; favorite?: true; archived?: true };

/** `2025` is Jan 1st, `2025-03` the 1st of March, a full date itself; anything else is not a date. */
export function isoFloor(s: string): string | undefined {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s.trim());
  if (!m) return;
  const mo = Number(m[2] ?? 1), d = Number(m[3] ?? 1);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00.000Z`;
}

/** The floor of the next year, month or day after `s`, for a `before:` that reads as "up to and including". */
export function isoCeiling(s: string): string | undefined {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s.trim());
  if (!m || !isoFloor(s)) return;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1)));
  if (!m[2]) d.setUTCFullYear(d.getUTCFullYear() + 1);
  else if (!m[3]) d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** A camera's or a phone's naming, or an extension: what a name search finds and CLIP would not. */
export const looksLikeFile = (s: string): boolean =>
  /\.(jpe?g|heic|heif|png|gif|webp|dng|arw|cr[23]|nef|raf|orf|rw2|tiff?|mp4|mov|m4v|avi|mkv|3gp)$/i.test(s) || /^(img|dsc|dscf|pxl|vid|mov|mvimg|dji|gopr|p\d|screenshot)[-_ ]?\d/i.test(s) || /^\d{8}[-_]\d{4,}/.test(s) || /^[a-z]{2,5}\d{3,}$/i.test(s);

export function parseQuery(raw: string): Query {
  const q: Query = { text: "" };
  const words: string[] = [];
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const flag = /^--?(since|before|until|in|year|type)$/i.exec(t);
    const kv = /^(since|after|before|until|in|year|city|type|is):(.+)$/i.exec(t);
    const key = (flag?.[1] ?? kv?.[1])?.toLowerCase();
    const value = kv?.[2] ?? (flag ? tokens[++i] : undefined);
    if (!key || value === undefined) { words.push(t); continue; }
    const v = value.toLowerCase();
    if (key === "since" || key === "after") { const f = isoFloor(value); if (f) q.since = f; else words.push(t); }
    else if (key === "before" || key === "until") { const c = isoFloor(value); if (c) q.before = c; else words.push(t); }
    else if (key === "in" || key === "year" || key === "city") {
      const f = isoFloor(value), c = isoCeiling(value);
      if (f && c && key !== "city") { q.since = f; q.before = c; }
      else q.city = value;
    } else if (key === "type" || key === "is") {
      if (/^(video|videos|movie)$/.test(v)) q.type = "VIDEO";
      else if (/^(photo|photos|image|images|picture)$/.test(v)) q.type = "IMAGE";
      else if (/^(fav|favou?rite|favou?rites|favou?rited)$/.test(v)) q.favorite = true;
      else if (/^(archived|archive)$/.test(v)) q.archived = true;
      else words.push(t);
    }
  }
  const text = words.join(" ");
  if (text && looksLikeFile(text)) q.file = text;
  else q.text = text;
  return q;
}

// ---- wall clock -------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3 May 2022", read with the UTC getters: `Asset.taken` is the local wall clock at the place, not an instant here. */
export const takenDay = (t: number): string => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/** "22:13", the same clock. */
export const takenClock = (t: number): string => { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
/** "2022-05-03", for a download's name and a memory's day. */
export const takenIso = (t: number): string => new Date(t).toISOString().slice(0, 10);
/** "0:31" or "1:02:03". */
export const clip = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** `2022-05-03_2024-11-23.jpg`: the day first so a camera's DSC0xxxx names never collide across shoots; `ext` swaps the extension (a preview is a JPEG whatever the original). */
export function downloadName(a: Asset, ext?: string): string {
  const stem = a.file.replace(/\.[^.]*$/, "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || a.id.slice(0, 8);
  const own = /\.[^.]+$/.exec(a.file)?.[0] ?? "";
  return `${takenIso(a.taken)}_${stem}${ext ? `.${ext}` : own}`;
}

// ---- links ------------------------------------------------------------------------------------

export const photoUrl = (c: Client, id: string) => `${c.web}/photos/${id}`;
export const albumUrl = (c: Client, id: string) => `${c.web}/albums/${id}`;
export const personUrl = (c: Client, id: string) => `${c.web}/people/${id}`;
export const memoryUrl = (c: Client) => `${c.web}/memory`;
export const libraryUrl = (c: Client) => `${c.web}/photos`;
export const mapUrl = (a: Asset) => (a.lat !== undefined && a.lon !== undefined ? `https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lon}` : undefined);

// ---- the client ------------------------------------------------------------------------------

/** The settings as a client, or undefined while `url` or `api_key` is empty; a trailing slash or `/api` on the url is dropped, the web address falls back to it. */
export function clientOf(s: { url?: string; api_key?: string; web_url?: string }): Client | undefined {
  const url = (s.url ?? "").trim().replace(/\/+$/, "").replace(/\/api$/, "");
  const key = (s.api_key ?? "").trim();
  if (!url || !key) return;
  const web = (s.web_url ?? "").trim().replace(/\/+$/, "") || url;
  return { url, key, web };
}

/** Immich's 403 names the permission the key lacks ("Missing required permission: asset.update"). */
export const permissionOf = (message: string): string | undefined => /permission:?\s+([a-zA-Z.]+)/.exec(message)?.[1];

async function request(c: Client, method: string, path: string, body?: unknown, ms = FETCH_MS): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${c.url}/api${path}`, { method, headers: { "x-api-key": c.key, accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  } catch (e) {
    const timeout = (e as Error)?.name === "TimeoutError";
    throw new ImmichError(`${method} ${path}: ${errorMessage(e)}`, timeout ? `Immich did not answer within ${ms / 1000} s (${c.url})` : `Immich did not answer at ${c.url}: check \`url\` and the network`);
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  const message = (() => { try { return String((JSON.parse(text) as { message?: unknown })?.message ?? text); } catch { return text; } })();
  if (res.status === 401) throw new ImmichError(`${path} 401`, "Immich refused the key: check `api_key` under Settings › Extensions › Immich", 401);
  if (res.status === 403) { const p = permissionOf(message); throw new ImmichError(`${path} 403 ${message}`, p ? `The key lacks the \`${p}\` permission: make one with it under Account Settings › API Keys` : `Immich refused: ${message}`, 403); }
  if (res.status === 404) throw new ImmichError(`${path} 404`, `Not on Immich any more (${message || "404"})`, 404);
  throw new ImmichError(`${path} ${res.status} ${message}`, `Immich answered ${res.status}${message ? `: ${message}` : ""}`, res.status);
}

const json = async <T>(c: Client, method: string, path: string, body?: unknown, ms?: number): Promise<T> => (await request(c, method, path, body, ms)).json() as Promise<T>;

/** What a listing is scoped to: an album, a person, a filter of the dropdown (the query's own `type:` / `is:` words on top); every search sends `visibility` (the header). */
export type Scope = { album?: string; person?: string; type?: "IMAGE" | "VIDEO"; favorite?: true; archived?: true };

function searchBody(q: Query, scope: Scope, page: number): Record<string, unknown> {
  const type = q.type ?? scope.type, favorite = q.favorite ?? scope.favorite, archived = q.archived ?? scope.archived;
  return {
    size: PAGE, page, withExif: true, visibility: archived ? "archive" : "timeline",
    ...(type && { type }), ...(favorite && { isFavorite: true }),
    ...(scope.album && { albumIds: [scope.album] }), ...(scope.person && { personIds: [scope.person] }),
    ...(q.since && { takenAfter: q.since }), ...(q.before && { takenBefore: q.before }), ...(q.city && { city: q.city }),
  };
}

/** One page of assets: CLIP (`/search/smart`) for words, `/search/metadata` for a file name or no words at all (newest first); `more` when a page follows. */
export async function search(c: Client, q: Query, scope: Scope = {}, page = 1): Promise<{ assets: Asset[]; more: boolean }> {
  const smart = !!q.text && !q.file;
  const body = smart ? { ...searchBody(q, scope, page), query: q.text } : { ...searchBody(q, scope, page), order: "desc", ...(q.file && { originalFileName: q.file }) };
  const r = await json<SearchReply>(c, "POST", smart ? "/search/smart" : "/search/metadata", body, smart ? SEARCH_MS : FETCH_MS);
  return { assets: parseAssets(r.assets?.items), more: !!(r.assets?.nextPage || r.assets?.nextCursor) };
}

/** One asset with its EXIF, people and tags (`/assets/{id}`). */
export const asset = async (c: Client, id: string): Promise<Asset> => { const a = parseAsset(await json<RawAsset>(c, "GET", `/assets/${id}`)); if (!a) throw new ImmichError("asset: no id", "Immich answered without the asset"); return a; };

/** Every album the key sees, the ones changed last first; `me` (the key's user, when known) marks the owned ones. */
export const albums = async (c: Client, me?: string): Promise<Album[]> => parseAlbums(await json(c, "GET", "/albums"), me).sort((a, b) => b.modified - a.modified);
/** The albums one asset is in. */
export const albumsOf = async (c: Client, id: string): Promise<Album[]> => parseAlbums(await json(c, "GET", `/albums?assetId=${id}`));
/** Put assets in an album; the ids that were already there are not errors. */
export async function addToAlbum(c: Client, album: string, ids: string[]): Promise<{ added: number; there: number; failed: string[] }> {
  const r = await json<{ id?: string; success?: boolean; error?: string }[]>(c, "PUT", `/albums/${album}/assets`, { ids });
  const out = { added: 0, there: 0, failed: [] as string[] };
  for (const x of Array.isArray(r) ? r : []) { if (x.success) out.added++; else if (x.error === "duplicate") out.there++; else out.failed.push(x.error ?? "unknown"); }
  return out;
}
/** A new album holding `ids`; its id. */
export const createAlbum = async (c: Client, name: string, ids: string[]): Promise<Album> => { const a = parseAlbum(await json<RawAlbum>(c, "POST", "/albums", { albumName: name, assetIds: ids })); if (!a) throw new ImmichError("album: no id", "Immich answered without the album"); return a; };

/** The visible people, favourites and named ones first (`/people` pages by 1000; the named are a few hundred at most). */
export async function people(c: Client): Promise<Person[]> {
  const out: Person[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await json<{ people?: unknown; hasNextPage?: boolean }>(c, "GET", `/people?withHidden=false&size=1000&page=${page}`);
    out.push(...parsePeople(r));
    if (!r.hasNextPage) break;
  }
  return out.sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(!!b.name) - Number(!!a.name) || a.name.localeCompare(b.name));
}

/** On this day: the memories Immich shows for `day` (`YYYY-MM-DD`), the nearest year first. */
export const memories = async (c: Client, day: string): Promise<Memory[]> => parseMemories(await json(c, "GET", `/memories?for=${day}`)).sort((a, b) => b.year - a.year);

/** The favourite flag on several assets (`PUT /assets`, one call). */
export const setFavorite = (c: Client, ids: string[], on: boolean): Promise<void> => request(c, "PUT", "/assets", { ids, isFavorite: on }).then(() => {});

/** The counts and the bytes on disk, from the two statistics endpoints; each one the key may not read (a 403) is left out, so a read-only key still gets what it can. */
export async function stats(c: Client): Promise<Stats> {
  const out: Stats = {};
  const skip = (e: unknown) => { if (e instanceof ImmichError && e.status === 403) return undefined; throw e; };
  const a = await json<{ images?: number; videos?: number }>(c, "GET", "/assets/statistics").catch(skip);
  if (a) { out.images = num(a.images); out.videos = num(a.videos); }
  const s = await json<{ usage?: number; photos?: number; videos?: number }>(c, "GET", "/server/statistics").catch(skip);
  if (s) { out.usage = num(s.usage); out.images ??= num(s.photos); out.videos ??= num(s.videos); }
  return out;
}

/** The key's own user, for marking the albums it owns; undefined when the key may not read it (`user.read`). */
export const me = (c: Client): Promise<string | undefined> => json<{ id?: string }>(c, "GET", "/users/me").then((u) => u.id, () => undefined);

// ---- pictures --------------------------------------------------------------------------------

export type Picture = { bytes: Buffer; type: string };
const picture = async (res: Response): Promise<Picture> => ({ bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type")?.split(";")[0] || "application/octet-stream" });

/** The grid's tile: Immich's `thumbnail` rendition (WebP, ~10 KB). */
export const thumbnail = (c: Client, id: string): Promise<Picture> => request(c, "GET", `/assets/${id}/thumbnail?size=thumbnail`).then(picture);
/** The pane's and the clipboard's picture: the `preview` rendition (a JPEG, 1440 px on the long side, what the web viewer shows). */
export const preview = (c: Client, id: string): Promise<Picture> => request(c, "GET", `/assets/${id}/thumbnail?size=preview`).then(picture);
/** A person's face crop (a JPEG). */
export const face = (c: Client, id: string): Promise<Picture> => request(c, "GET", `/people/${id}/thumbnail`).then(picture);
/** The file as uploaded (an ARW, a HEIC, a video), with the name Immich gives it. */
export async function original(c: Client, id: string): Promise<Picture & { name?: string }> {
  const res = await request(c, "GET", `/assets/${id}/original`, undefined, ORIGINAL_MS);
  const cd = res.headers.get("content-disposition") ?? "";
  const name = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? /filename="?([^";]+)"?/.exec(cd)?.[1];
  return { ...(await picture(res)), name: name ? decodeURIComponent(name) : undefined };
}

/** The version, as a reachability probe that needs no permission. */
export const version = (c: Client): Promise<string> => json<{ major?: number; minor?: number; patch?: number }>(c, "GET", "/server/version").then((v) => `${v.major ?? 0}.${v.minor ?? 0}.${v.patch ?? 0}`);
