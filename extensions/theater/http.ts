// One client for the whole stack. Every service is a settings group
// (`<id>_url` plus a key, or a user and password) and a `Service` row
// here says how it signs its requests: an `X-Api-Key` header (the arrs,
// Prowlarr, Jellyseerr, Bazarr), Jellyfin's `X-Emby-Token`, an `apikey`
// query (SABnzbd, NZBHydra2), a bearer key or a cookie login
// (qBittorrent), a Subsonic salted token (Navidrome), a JSON login that
// answers a JWT (Audiobookshelf, Kavita), or nothing (Shelfmark,
// Filebrowser, Homepage). `api()` is one request with a timeout and typed
// errors; `cached()` is a small in-memory cache with one fetch in flight
// per key. `PAL_THEATER_<ID>_<FIELD>` replaces a setting (the tests point
// every service at one mock server).
import { createHash } from "node:crypto";
import { errorMessage, settings, type TagColor, type TileColor } from "@zcag/pal";

/** A row tag as the modules state one: the text and a tag-palette colour. */
export type Tag = { text: string; color: TagColor };

export const EXTENSION = "theater";
export const REQUEST_MS = 8000, HEALTH_MS = 3500;
export const log = (...a: unknown[]) => console.error("[theater]", ...a);

export type ServiceId = "jellyfin" | "seerr" | "radarr" | "sonarr" | "lidarr" | "prowlarr" | "hydra" | "bazarr" | "sab" | "qbit" | "navidrome" | "abs" | "kavita" | "shelfmark" | "filebrowser" | "homepage";
type Auth = "key" | "emby" | "query" | "qbit" | "subsonic" | "login" | "none";

/** md- glyphs from the bundled Nerd Font, one per service and the few the rows share. */
export const GLYPH = {
  jellyfin: "\u{f0fce}", seerr: "\u{f02fb}", radarr: "\u{f07de}", sonarr: "\u{f0502}", lidarr: "\u{f0333}", prowlarr: "\u{f0437}", hydra: "\u{f070f}", bazarr: "\u{f0a16}",
  sab: "\u{f01da}", qbit: "\u{f0347}", navidrome: "\u{f075a}", abs: "\u{f02cb}", kavita: "\u{f05da}", shelfmark: "\u{f0e84}", filebrowser: "\u{f024b}", homepage: "\u{f056e}",
  play: "\u{f040a}", pause: "\u{f03e4}", check: "\u{f012c}", alert: "\u{f05d6}", star: "\u{f04ce}", starOff: "\u{f04d2}", heart: "\u{f02d1}", heartOff: "\u{f02d5}", calendar: "\u{f00ed}",
  history: "\u{f02da}", plus: "\u{f0415}", sync: "\u{f04e6}", web: "\u{f059f}", speed: "\u{f04c5}", cast: "\u{f0118}", eye: "\u{f0208}", person: "\u{f0004}", album: "\u{f0025}", song: "\u{f0387}", queue: "\u{f0997}", key: "\u{f030b}",
} as const;

export type Service = { id: ServiceId; title: string; color: TileColor; auth: Auth; keywords: string[]; /** The palette cmd+Enter on the Theater row opens; none for a link-only service. */ palette?: string; /** The palettes ⌘K lists as drill-ins, `[key, title]`. */ drill: [string, string][] };

/** Every service in the order the Theater palette lists them. */
export const SERVICES: Service[] = [
  { id: "jellyfin", title: "Jellyfin", color: "violet", auth: "emby", keywords: ["media", "movies", "tv", "watch"], palette: "jellyfin", drill: [["jellyfin", "Continue Watching and Latest"], ["jellyfin-search", "Search Jellyfin"], ["jellyfin-playing", "Now Playing"]] },
  { id: "seerr", title: "Jellyseerr", color: "indigo", auth: "key", keywords: ["requests", "overseerr"], palette: "seerr-requests", drill: [["seerr-requests", "Requests"], ["seerr-request", "Request a title"]] },
  { id: "radarr", title: "Radarr", color: "amber", auth: "key", keywords: ["movies"], palette: "radarr", drill: [["radarr", "Queue and calendar"], ["radarr-add", "Add a movie"], ["radarr-wanted", "Wanted movies"], ["radarr-history", "History"]] },
  { id: "sonarr", title: "Sonarr", color: "cyan", auth: "key", keywords: ["tv", "series"], palette: "sonarr", drill: [["sonarr", "Queue and calendar"], ["sonarr-add", "Add a series"], ["sonarr-wanted", "Wanted episodes"], ["sonarr-history", "History"]] },
  { id: "lidarr", title: "Lidarr", color: "green", auth: "key", keywords: ["music"], palette: "lidarr", drill: [["lidarr", "Queue and calendar"], ["lidarr-add", "Add an artist"], ["lidarr-wanted", "Wanted albums"], ["lidarr-history", "History"]] },
  { id: "prowlarr", title: "Prowlarr", color: "orange", auth: "key", keywords: ["indexers", "trackers"], palette: "prowlarr", drill: [["prowlarr", "Indexers"], ["prowlarr-search", "Search indexers"]] },
  { id: "hydra", title: "NZBHydra2", color: "slate", auth: "query", keywords: ["usenet", "nzb", "nzbhydra"], palette: "hydra-search", drill: [["hydra-search", "Search NZBHydra2"]] },
  { id: "bazarr", title: "Bazarr", color: "pink", auth: "key", keywords: ["subtitles", "subs"], palette: "bazarr", drill: [["bazarr", "Subtitles"]] },
  { id: "sab", title: "SABnzbd", color: "amber", auth: "query", keywords: ["usenet", "downloads", "sabnzbd"], palette: "downloads", drill: [["downloads", "Downloads"], ["downloads-history", "Download history"]] },
  { id: "qbit", title: "qBittorrent", color: "blue", auth: "qbit", keywords: ["torrents", "downloads", "qbittorrent"], palette: "downloads", drill: [["downloads", "Downloads"], ["downloads-history", "Download history"]] },
  { id: "navidrome", title: "Navidrome", color: "blue", auth: "subsonic", keywords: ["music", "subsonic"], palette: "navidrome", drill: [["navidrome", "Now playing and recent"], ["navidrome-search", "Search Navidrome"]] },
  { id: "abs", title: "Audiobookshelf", color: "orange", auth: "login", keywords: ["audiobooks", "podcasts"], palette: "abs", drill: [["abs", "Continue listening"], ["abs-search", "Search Audiobookshelf"]] },
  { id: "kavita", title: "Kavita", color: "teal", auth: "login", keywords: ["ebooks", "read", "comics"], palette: "kavita", drill: [["kavita", "Continue reading"], ["kavita-search", "Search Kavita"]] },
  { id: "shelfmark", title: "Shelfmark", color: "teal", auth: "none", keywords: ["books", "getbooks", "request"], palette: "shelfmark", drill: [["shelfmark", "Request a book"]] },
  { id: "filebrowser", title: "Filebrowser", color: "slate", auth: "none", keywords: ["files"], drill: [] },
  { id: "homepage", title: "Homepage", color: "slate", auth: "none", keywords: ["dashboard"], drill: [] },
];
export const service = (id: ServiceId): Service => SERVICES.find((s) => s.id === id)!;

type Conf = { url: string; key: string; user: string; password: string };
const envKey = (id: string, field: string) => `PAL_THEATER_${id.toUpperCase()}_${field.toUpperCase()}`;
const setting = (id: ServiceId, field: keyof Conf): string => {
  const env = process.env[envKey(id, field)];
  if (env !== undefined) return env.trim();
  const all = settings.get<Record<string, unknown>>(EXTENSION);
  const v = all[`${id}_${field}`];
  return typeof v === "string" ? v.trim() : "";
};
/** The service's settings, env first, the url without a trailing slash. */
export const conf = (id: ServiceId): Conf => ({ url: setting(id, "url").replace(/\/+$/, ""), key: setting(id, "key"), user: setting(id, "user"), password: setting(id, "password") });
/** Jellyfin's user setting (its own field, not part of the auth). */
export const jellyfinUser = () => process.env.PAL_THEATER_JELLYFIN_USER?.trim() ?? String(settings.get<Record<string, unknown>>(EXTENSION).jellyfin_user ?? "").trim();

/** A setting the service cannot work without: `which` names it. */
export class SetupError extends Error {
  constructor(public readonly service: ServiceId, public readonly which: "url" | "key" | "login") {
    super(`${SERVICES.find((s) => s.id === service)!.title}: ${which === "url" ? "no URL set" : which === "key" ? "no API key set" : "no user and password set"}`);
  }
}
/** The service answered with an error status. */
export class ApiError extends Error {
  constructor(public readonly service: ServiceId, public readonly status: number, message: string) { super(message); }
  get unauthorized() { return this.status === 401 || this.status === 403; }
}

/** What is missing for the service, or undefined when it is set up. */
export function needsSetup(id: ServiceId): SetupError | undefined {
  const s = service(id), c = conf(id);
  if (!c.url) return new SetupError(id, "url");
  if ((s.auth === "key" || s.auth === "emby" || s.auth === "query") && !c.key) return new SetupError(id, "key");
  if (s.auth === "qbit" && !c.key && !(c.user && c.password)) return new SetupError(id, "login");
  if ((s.auth === "subsonic" || s.auth === "login") && !(c.user && c.password)) return new SetupError(id, "login");
}
export const configured = (id: ServiceId) => !needsSetup(id);
/** The settings row the fix lives on, for a hint's Enter. */
export const settingsLink = (id: ServiceId, which: "url" | "key" | "login") => `pal://settings/extensions?anchor=extensions:${EXTENSION}:${id}_${which === "login" ? "user" : which}`;

// ---- sessions: what a login answered ------------------------------------------------

const tokens = new Map<ServiceId, { token: string; extra?: string }>();
/** Kavita's user API key and Audiobookshelf's JWT are the picture urls' auth too. */
export const tokenOf = (id: ServiceId) => tokens.get(id);
export const forgetTokens = () => tokens.clear();

async function login(id: ServiceId): Promise<{ token: string; extra?: string }> {
  const c = conf(id);
  if (id === "qbit") {
    const res = await fetch(`${c.url}/api/v2/auth/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", referer: c.url, origin: c.url }, body: new URLSearchParams({ username: c.user, password: c.password }), signal: AbortSignal.timeout(REQUEST_MS) });
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (!res.ok || !cookie || (await res.text()).trim() !== "Ok.") throw new ApiError(id, res.status === 200 ? 401 : res.status, "qBittorrent refused the user or password");
    return { token: cookie };
  }
  const path = id === "abs" ? "/login" : "/api/Account/login";
  const res = await fetch(`${c.url}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ username: c.user, password: c.password }), signal: AbortSignal.timeout(REQUEST_MS) });
  if (!res.ok) throw new ApiError(id, res.status, res.status === 401 || res.status === 400 ? `${service(id).title} refused the user or password` : `${res.status} ${res.statusText}`);
  const j = await res.json() as { user?: { token?: string }; token?: string; apiKey?: string };
  const token = id === "abs" ? j.user?.token : j.token;
  if (!token) throw new ApiError(id, 500, `${service(id).title} answered no token`);
  return { token, extra: j.apiKey };
}

const logins = new Map<ServiceId, Promise<{ token: string; extra?: string }>>();
async function session(id: ServiceId) {
  const have = tokens.get(id);
  if (have) return have;
  const p = logins.get(id) ?? login(id).then((t) => { tokens.set(id, t); return t; }).finally(() => logins.delete(id));
  logins.set(id, p);
  return p;
}

/** Subsonic's salted token: `t = md5(password + salt)`, the password never on the wire. */
export function subsonicAuth(user: string, password: string, salt = Math.random().toString(36).slice(2, 10)): Record<string, string> {
  return { u: user, t: createHash("md5").update(password + salt).digest("hex"), s: salt, v: "1.16.1", c: "pal", f: "json" };
}

// ---- requests ------------------------------------------------------------------

export type Opts = { method?: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown; form?: Record<string, string>; timeout?: number; /** The body as text, not JSON (an empty answer is ""). */ text?: boolean; headers?: Record<string, string> };

/** `${url}/${path}` with the query, the service's auth folded into the headers or the query. */
async function prepare(id: ServiceId, path: string, o: Opts): Promise<{ url: string; headers: Record<string, string> }> {
  const s = service(id), c = conf(id);
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) q[k] = String(v);
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "pal-theater", ...o.headers };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.form) headers["content-type"] = "application/x-www-form-urlencoded";
  switch (s.auth) {
    case "key": headers["x-api-key"] = c.key; break;
    case "emby": headers["x-emby-token"] = c.key; break;
    case "query": q.apikey = c.key; if (id === "sab") q.output = "json"; else q.o = "json"; break;
    case "qbit": if (c.key) headers.authorization = `Bearer ${c.key}`; else headers.cookie = (await session(id)).token; headers.referer = c.url; break;
    case "subsonic": Object.assign(q, subsonicAuth(c.user, c.password)); break;
    case "login": headers.authorization = `Bearer ${(await session(id)).token}`; break;
  }
  const qs = new URLSearchParams(q).toString();
  return { url: `${c.url}${path.startsWith("/") ? "" : "/"}${path}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`, headers };
}

async function failure(id: ServiceId, res: Response): Promise<never> {
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const t = await res.text();
    const j = JSON.parse(t) as { message?: string; error?: string; detail?: string; title?: string; errors?: { errorMessage?: string }[] };
    message = j.message ?? j.error ?? j.detail ?? j.title ?? j.errors?.[0]?.errorMessage ?? (t.length < 120 ? t : message);
  } catch {}
  if (res.status === 401 || res.status === 403) message = `${service(id).title} rejected the key`;
  throw new ApiError(id, res.status, message);
}

/**
 * One request to a service; JSON out (an empty body is `undefined`). A
 * missing setting throws `SetupError` before any request; a 401 on a
 * login-backed service drops the session and tries once more; Subsonic's
 * envelope is unwrapped and its `failed` status thrown.
 */
export async function api<T = unknown>(id: ServiceId, path: string, o: Opts = {}): Promise<T> {
  const missing = needsSetup(id);
  if (missing) throw missing;
  for (let attempt = 0; ; attempt++) {
    const { url, headers } = await prepare(id, path, o);
    const res = await fetch(url, { method: o.method ?? (o.body !== undefined || o.form ? "POST" : "GET"), headers, body: o.body !== undefined ? JSON.stringify(o.body) : o.form ? new URLSearchParams(o.form) : undefined, signal: AbortSignal.timeout(o.timeout ?? REQUEST_MS) });
    const relogin = (res.status === 401 || res.status === 403) && (service(id).auth === "login" || (service(id).auth === "qbit" && !conf(id).key));
    if (relogin && attempt === 0 && tokens.has(id)) { tokens.delete(id); continue; }
    if (!res.ok) return failure(id, res);
    const text = await res.text();
    if (o.text) return text as T;
    const j = text ? JSON.parse(text) : undefined;
    if (service(id).auth === "subsonic") {
      const r = (j as { "subsonic-response": { status: string; error?: { message: string; code: number } } })["subsonic-response"];
      if (r.status !== "ok") throw new ApiError(id, r.error?.code === 40 ? 401 : 500, r.error?.message ?? "Subsonic error");
      return r as T;
    }
    return j as T;
  }
}

/** A picture's url with the service's auth in the query (what a row's icon or the pane loads; the API key rides only on services whose images need it). */
export async function imageUrl(id: ServiceId, path: string, query: Record<string, string | number> = {}): Promise<string> {
  const c = conf(id), s = service(id);
  const q = new URLSearchParams(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])));
  if (s.auth === "subsonic") for (const [k, v] of Object.entries(subsonicAuth(c.user, c.password))) if (k !== "f") q.set(k, v);
  if (id === "abs") q.set("token", (await session(id)).token);
  if (id === "kavita") q.set("apiKey", (await session(id)).extra ?? "");
  return `${c.url}${path}?${q}`;
}

// ---- cache -------------------------------------------------------------------

type Entry<T> = { at: number; data: T };
const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** The value under `key` while younger than `ttlMs` (unless `refresh`), else `load()`; one fetch in flight per key; a loader that throws leaves a stale value standing (logged) unless the failure is a refused key. */
export async function cached<T>(key: string, ttlMs: number, refresh: boolean, load: () => Promise<T>): Promise<T> {
  const have = mem.get(key) as Entry<T> | undefined;
  if (have && !refresh && Date.now() - have.at < ttlMs) return have.data;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => {
    try {
      const data = await load();
      mem.set(key, { at: Date.now(), data });
      return data;
    } catch (e) {
      if (have && !(e instanceof SetupError) && !(e instanceof ApiError && e.unauthorized)) { log(`${key}: ${errorMessage(e)}; showing cached rows`); return have.data; }
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** Drops keys (a prefix matches every key under it). */
export const forget = (...prefixes: string[]) => { for (const k of [...mem.keys()]) if (prefixes.some((p) => k === p || k.startsWith(p + ":"))) mem.delete(k); };
export const forgetAll = () => { mem.clear(); tokens.clear(); };
settings.onChange(forgetAll, EXTENSION);

// ---- shared formatting --------------------------------------------------------------

/** `1.2 MB/s`, `340 KB/s`, `0 B/s`. */
export const speed = (bytesPerSec: number) => bytesPerSec >= 1e6 ? `${(bytesPerSec / 1e6).toFixed(1)} MB/s` : bytesPerSec >= 1e3 ? `${Math.round(bytesPerSec / 1e3)} KB/s` : `${Math.round(bytesPerSec)} B/s`;
/** `3 min`, `1 h 20 min`, `2 d 3 h`; `""` for nothing left. */
export const eta = (seconds: number) => !Number.isFinite(seconds) || seconds <= 0 ? "" : seconds < 60 ? `${Math.round(seconds)} s` : seconds < 3600 ? `${Math.round(seconds / 60)} min` : seconds < 86400 ? `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min` : `${Math.floor(seconds / 86400)} d ${Math.round((seconds % 86400) / 3600)} h`;
/** `1:23:45` or `0:05:00` (an arr `timeleft`, a SAB `timeleft`) as seconds. */
export const parseClock = (s: string | undefined) => { if (!s) return 0; const p = s.split(".")[0]!.split(":").map(Number); return p.length === 3 ? p[0]! * 3600 + p[1]! * 60 + p[2]! : p.length === 2 ? p[0]! * 60 + p[1]! : 0; };
/** `42%` off 0..1. */
export const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
/** Ticks (Jellyfin's 100 ns) as `1 h 42 min` / `48 min`. */
export const runtime = (ticks?: number) => { if (!ticks) return ""; const m = Math.round(ticks / 600_000_000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
