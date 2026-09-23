// odak transport: the server (`url`), the API key (a bearer), one REST
// call, and one in-memory cache the palettes and the bar item share.
// Errors arrive typed so a listing can turn each into a hint row naming
// the fix: no address, no key, a refused key, a server that does not
// answer. `PAL_ODAK_URL` and `PAL_ODAK_KEY` replace the two settings (the
// tests point them at a local mock).
import { errorMessage, settings } from "@zcag/pal";

export const EXTENSION = "odak";
/** Every request is abandoned after this: the server is on the LAN or a tailnet, and a todo list is small. */
export const REQUEST_MS = 8_000;

export const log = (...a: unknown[]) => console.error("[odak]", ...a);

/** `[extensions.odak]`, defaults in pal.json. */
export type Settings = { url: string; api_key: string; default_section: string };
export const conf = () => settings.get<Settings>(EXTENSION);

/** The server's origin, no trailing slash; empty when unset. */
export const baseUrl = () => (process.env.PAL_ODAK_URL || conf().url || "").trim().replace(/\/+$/, "");
const key = () => (process.env.PAL_ODAK_KEY || conf().api_key || "").trim();
/** The section a new todo lands in unless the line says: the setting, else odak's own default. */
export const defaultSection = () => (conf().default_section || "").trim() || "Inbox";

/** Nothing to sign in with: `which` says what is missing. */
export class AuthError extends Error {
  constructor(public readonly which: "url" | "key") { super(which === "url" ? "no odak address" : "no odak API key"); }
}
/** The server answered with an error (`{ error }`, or a bare status); status 0 is a server that did not answer at all. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
  get unauthorized() { return this.status === 401; }
  get notFound() { return this.status === 404; }
  get unreachable() { return this.status === 0; }
}

const credentials = () => {
  if (!baseUrl()) throw new AuthError("url");
  const k = key();
  if (!k) throw new AuthError("key");
  return k;
};

/** The web UI (the server serves it at `/`). */
export const webUrl = () => baseUrl();

/** One REST call, `<base>/<path>`; JSON in, JSON out (`undefined` for an empty body). */
export async function rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const k = credentials();
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/${path.replace(/^\/+/, "")}`, {
      method,
      headers: { authorization: `Bearer ${k}`, accept: "application/json", "user-agent": "pal-odak", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
  } catch (e) {
    throw new ApiError(0, `${baseUrl()} did not answer (${errorMessage(e)})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text.trim() || `${res.status} ${res.statusText}`.trim();
    try { const j = JSON.parse(text) as { error?: string }; if (j?.error) message = j.error; } catch {}
    throw new ApiError(res.status, message);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---- cache --------------------------------------------------------------
// In memory: the whole list is one request and a few kilobytes, so a
// restart costs one call and `storage` (a 256 KB file written on every
// change) has no place here. One entry per key with its age; one fetch in
// flight; a write patches the entry in place (`patch`) so the relist
// after it reads the new state at once, and starts a fetch behind it so
// the ids odak recomputes on an edit land before the next show.

type Entry<T> = { at: number; data: T };
const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** The value under `key` while younger than `ttlMs` (unless `refresh`), else `load()`; a loader that fails leaves a stale value standing (logged) when there is one, so an outage keeps the rows. */
export async function cached<T>(key: string, ttlMs: number, refresh: boolean, load: () => Promise<T>): Promise<T> {
  credentials();
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
      if (have && !(e instanceof AuthError) && !(e instanceof ApiError && e.unauthorized)) { log(`${key}: ${errorMessage(e)}; showing cached rows`); return have.data; }
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** Rewrites a cached value in place (a write's local effect); nothing when the key is not cached. */
export function patch<T>(key: string, fn: (data: T) => T): void {
  const have = mem.get(key) as Entry<T> | undefined;
  if (have) mem.set(key, { at: have.at, data: fn(have.data) });
}
/** The cached value whatever its age, or undefined: for a reader that must never fetch (the root's Now section). */
export const peek = <T>(key: string): T | undefined => (mem.get(key) as Entry<T> | undefined)?.data;
/** Drops keys so the next `cached` loads. */
export const forget = (...keys: string[]) => { for (const k of keys) mem.delete(k); };
export const forgetAll = () => mem.clear();
settings.onChange(forgetAll, EXTENSION);
