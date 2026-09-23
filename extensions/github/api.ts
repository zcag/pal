// GitHub transport: who we are (the token), one REST call, one GraphQL
// call, and a cache that remembers a REST resource's ETag so a re-list
// costs a 304 (free against the rate limit) instead of a body.
//
// Auth, in order: `PAL_GITHUB_TOKEN` (the tests), the `token` setting
// (arrives resolved from the keychain), `gh auth token` when the gh CLI is
// on PATH. Nothing found is `AuthError`, which the palettes turn into one
// hint row. `PAL_GITHUB_API` replaces `https://api.github.com` (the tests
// point it at a local server serving fixtures).
import { errorMessage, run, settings, storage } from "@zcag/pal";

export const EXTENSION = "github";
export const API = (process.env.PAL_GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
/** Every request, REST or GraphQL, is abandoned after this. */
export const REQUEST_MS = 10_000;
const GH_MS = 5000;
/** How long a `gh auth token` answer is trusted before asking again; a failure is retried sooner. */
const TOKEN_MS = 5 * 60_000, TOKEN_FAIL_MS = 30_000;

export const log = (...a: unknown[]) => console.error("[github]", ...a);

/** `[extensions.github]`, defaults in pal.json. */
export type Settings = { token: string; default_org: string; repos_root: string; clone_protocol: "ssh" | "https"; merged_days: number; merge_method: "merge" | "squash" | "rebase" };
export const conf = () => settings.get<Settings>(EXTENSION);

export class AuthError extends Error {
  constructor(public readonly ghPresent: boolean) { super(ghPresent ? "gh is not logged in" : "no GitHub token"); }
}
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly resetAt?: Date) { super(message); }
  get rateLimited() { return this.resetAt !== undefined; }
}

// ---- auth ---------------------------------------------------------------

export const hasGh = () => !!Bun.which("gh");

let cachedToken: { value?: string; at: number } | undefined;
settings.onChange(() => { cachedToken = undefined; }, EXTENSION);

async function ghToken(): Promise<string | undefined> {
  if (!hasGh()) return;
  try { return (await run(["gh", "auth", "token"], { ms: GH_MS })).trim() || undefined; } catch (e) { log("gh auth token:", errorMessage(e)); }
}

/** The token to send, or `AuthError`. */
export async function token(): Promise<string> {
  const env = process.env.PAL_GITHUB_TOKEN;
  if (env) return env;
  const own = conf().token?.trim();
  if (own) return own;
  const now = Date.now();
  if (cachedToken && now - cachedToken.at < (cachedToken.value ? TOKEN_MS : TOKEN_FAIL_MS)) {
    if (cachedToken.value) return cachedToken.value;
    throw new AuthError(hasGh());
  }
  const value = await ghToken();
  cachedToken = { value, at: now };
  if (!value) throw new AuthError(hasGh());
  return value;
}

// ---- requests -----------------------------------------------------------

export type Rest<T> = { status: number; data: T; etag?: string };

/** The rate limit as the last response reported it; the palettes show a hint while it is exhausted. */
export let rateLimit: { remaining: number; resetAt: Date } | undefined;
const noteLimit = (h: Headers) => {
  const rem = h.get("x-ratelimit-remaining"), reset = h.get("x-ratelimit-reset");
  if (rem !== null && reset !== null) rateLimit = { remaining: Number(rem), resetAt: new Date(Number(reset) * 1000) };
};

async function request(path: string, init: RequestInit & { etag?: string }): Promise<Response> {
  const t = await token();
  const headers: Record<string, string> = {
    authorization: `Bearer ${t}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "pal-github",
    ...(init.etag ? { "if-none-match": init.etag } : {}),
    ...(init.body ? { "content-type": "application/json" } : {}),
  };
  const res = await fetch(path.startsWith("http") ? path : API + path, { ...init, headers, signal: AbortSignal.timeout(REQUEST_MS) });
  noteLimit(res.headers);
  if (res.status === 304 || res.ok) return res;
  let message = `${res.status} ${res.statusText}`;
  try { const j = await res.json() as { message?: string }; if (j?.message) message = j.message; } catch {}
  const limited = (res.status === 403 || res.status === 429) && (rateLimit?.remaining === 0 || /rate limit/i.test(message));
  throw new ApiError(res.status, message, limited ? rateLimit?.resetAt ?? new Date(Date.now() + 60_000) : undefined);
}

/** One REST call. A 304 (sent `etag`, nothing changed) answers `{ status: 304, data: undefined }`. */
export async function rest<T = unknown>(method: string, path: string, opts: { body?: unknown; etag?: string } = {}): Promise<Rest<T>> {
  const res = await request(path, { method, etag: opts.etag, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const etag = res.headers.get("etag") ?? undefined;
  if (res.status === 304 || res.status === 204 || res.status === 205) return { status: res.status, data: undefined as T, etag };
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T, etag };
}

/** One GraphQL call; `errors` in the reply is a throw. `name` is the operation name (the tests dispatch on it). */
export async function gql<T = unknown>(name: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await request("/graphql", { method: "POST", body: JSON.stringify({ query, variables, operationName: name }) });
  const j = await res.json() as { data?: T; errors?: { message: string; type?: string }[] };
  if (j.errors?.length) {
    const limited = j.errors.some((e) => e.type === "RATE_LIMITED");
    throw new ApiError(200, j.errors.map((e) => e.message).join("; "), limited ? new Date(Date.now() + 60_000) : undefined);
  }
  const rl = (j.data as { rateLimit?: { remaining: number; resetAt: string } } | undefined)?.rateLimit;
  if (rl) rateLimit = { remaining: rl.remaining, resetAt: new Date(rl.resetAt) };
  return j.data as T;
}

// ---- cache --------------------------------------------------------------
// One entry per resource: when it was fetched, the ETag the server gave (REST
// only), and the rows already normalised (never a raw body: the extension's
// storage file is capped at 256 KB). Memory first, the storage file behind
// it, so a host restart still has the ETag and yesterday's rows to fall
// back on when GitHub is unreachable.

export type Entry<T> = { at: number; etag?: string; data: T };
/** What a loader answers: fresh rows with the ETag to remember, or `unchanged` (a 304). */
export type Loaded<T> = { data: T; etag?: string } | "unchanged";

const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function entry<T>(key: string): Promise<Entry<T> | undefined> {
  const m = mem.get(key) as Entry<T> | undefined;
  if (m) return m;
  const s = await storage.get<Entry<T>>(`cache:${key}`, EXTENSION).catch(() => null);
  if (s) mem.set(key, s);
  return s ?? undefined;
}

async function remember<T>(key: string, e: Entry<T>) {
  mem.set(key, e);
  try { await storage.set(`cache:${key}`, e, EXTENSION); } catch (err) { log(`cache ${key} not stored: ${errorMessage(err)}`); }
}

/**
 * The rows under `key`: the cached ones while younger than `ttlMs` (unless
 * `refresh`), else `load(etag)` asked for fresh ones. A loader that
 * answers `unchanged` keeps the rows and renews their age; one that throws
 * leaves stale rows standing (logged) when there are any. No token at all
 * is `AuthError` before anything else.
 */
export async function cached<T>(key: string, ttlMs: number, refresh: boolean, load: (etag?: string) => Promise<Loaded<T>>): Promise<T> {
  // Signed out means signed out: yesterday's rows are for an outage, not for a missing login.
  await token();
  const have = await entry<T>(key);
  if (have && !refresh && Date.now() - have.at < ttlMs) return have.data;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => {
    try {
      const r = await load(have?.etag);
      if (r === "unchanged" && !have) throw new Error(`${key}: 304 without a cached copy`);
      const next: Entry<T> = r === "unchanged" ? { ...have!, at: Date.now() } : { at: Date.now(), etag: r.etag, data: r.data };
      await remember(key, next);
      return next.data;
    } catch (e) {
      if (have && !(e instanceof AuthError)) { log(`${key}: ${errorMessage(e)}; showing cached rows`); return have.data; }
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** Drops the memory copy and the file so the next `cached` fetches (a mutation changed what the server would answer); resolves once the file is gone, for a caller that lists again at once. */
export const forget = (...keys: string[]): Promise<void> => { for (const k of keys) mem.delete(k); return Promise.all(keys.map((k) => storage.remove(`cache:${k}`, EXTENSION).catch(() => {}))).then(() => undefined); };

/** A REST list as a `cached` loader: sends the ETag, answers `unchanged` on a 304, else the rows through `map`. */
export const restLoader = <R, T>(path: string, map: (raw: R) => T) => async (etag?: string): Promise<Loaded<T>> => {
  const r = await rest<R>("GET", path, { etag });
  return r.status === 304 ? "unchanged" : { data: map(r.data), etag: r.etag };
};
