// tela transport: the instance (`base_url`), who we are (the personal access
// token, a bearer), one REST call, and one MCP tool call for what REST has
// no shape for (`research`, the answer-oriented retrieval). Errors arrive
// typed so the palettes can turn each into a hint row naming the fix.
//
// `PAL_TELA_URL` and `PAL_TELA_TOKEN` replace the two settings (the tests
// point them at a local mock). The MCP endpoint is `<base>/api/mcp`, the
// Streamable HTTP transport tela's own `tela-mcp` package proxies to: a
// session is opened once (`initialize`, `notifications/initialized`), kept
// for the process, and opened again when the server forgets it.
import { errorMessage, settings, slug as slugOf } from "@zcag/pal";

export const EXTENSION = "tela";
/** Every request is abandoned after this; research (embedding + retrieval) gets longer. */
export const REQUEST_MS = 10_000, RESEARCH_MS = 45_000;
const PROTOCOL = "2025-06-18";

export const log = (...a: unknown[]) => console.error("[tela]", ...a);

/** `[extensions.tela]`, defaults in pal.json. */
export type Settings = { base_url: string; token: string; default_space: string; research: boolean; bar_show?: "auto" | "always" };
export const conf = () => settings.get<Settings>(EXTENSION);

/** The instance origin, no trailing slash; empty when unset. */
export const baseUrl = () => (process.env.PAL_TELA_URL || conf().base_url || "").trim().replace(/\/+$/, "");
const token = () => (process.env.PAL_TELA_TOKEN || conf().token || "").trim();
export const researchOn = () => conf().research !== false;

/** Nothing to sign in with: `which` says what is missing. */
export class AuthError extends Error {
  constructor(public readonly which: "url" | "token") { super(which === "url" ? "no tela address" : "no tela token"); }
}
/** The instance answered with an error envelope `{ error, code, status }` (or a bare status). */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
  get unauthorized() { return this.status === 401; }
  get forbidden() { return this.status === 403; }
  get notFound() { return this.status === 404; }
  /** 503 `rag_disabled` / `llm_disabled`: the instance has no embedder or model. */
  get unconfigured() { return this.status === 503; }
}

const credentials = () => {
  if (!baseUrl()) throw new AuthError("url");
  const t = token();
  if (!t) throw new AuthError("token");
  return t;
};

/** A page's address on the instance: `/spaces/<space>/pages/<id>/<slug>`, the slug as tela derives it. */
export const slug = (title: string) => slugOf(title).slice(0, 80);
export const pageUrl = (space: number, id: number, title = "") => `${baseUrl()}/spaces/${space}/pages/${id}${slug(title) ? `/${slug(title)}` : ""}`;
export const spaceUrl = (space: number) => `${baseUrl()}/spaces/${space}`;
export const searchUrl = (q: string) => `${baseUrl()}/search?q=${encodeURIComponent(q)}`;
export const askUrl = (q: string, space?: number) => `${baseUrl()}/ask?q=${encodeURIComponent(q)}${space ? `&space=${space}` : ""}`;
export const keysUrl = () => `${baseUrl()}/settings?tab=api-keys`;
export const notesUrl = () => `${baseUrl()}/n`;

async function failure(res: Response): Promise<never> {
  let code = "http", message = `${res.status} ${res.statusText}`.trim();
  try {
    const j = await res.json() as { error?: string; code?: string; message?: string };
    if (j?.code) code = j.code;
    if (j?.error || j?.message) message = String(j.error ?? j.message);
  } catch {}
  throw new ApiError(res.status, code, message);
}

/** One REST call, `<base>/api/<path>`; JSON in, JSON out (`undefined` for an empty body). */
export async function rest<T = unknown>(method: string, path: string, body?: unknown, opts: { timeout?: number } = {}): Promise<T> {
  const t = credentials();
  const res = await fetch(`${baseUrl()}/api/${path.replace(/^\/+/, "")}`, {
    method,
    headers: { authorization: `Bearer ${t}`, accept: "application/json", "user-agent": "pal-tela", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeout ?? REQUEST_MS),
  });
  if (!res.ok) return failure(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Where a redirecting GET points (a deck's cover), or undefined when it does not redirect or fails. */
export async function redirectOf(path: string): Promise<string | undefined> {
  const t = credentials();
  const res = await fetch(`${baseUrl()}/api/${path.replace(/^\/+/, "")}`, { headers: { authorization: `Bearer ${t}` }, redirect: "manual", signal: AbortSignal.timeout(REQUEST_MS) });
  const loc = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !loc) return undefined;
  return loc.startsWith("http") ? loc : `${baseUrl()}${loc.startsWith("/") ? "" : "/"}${loc}`;
}

// ---- MCP ----------------------------------------------------------------

let session: string | undefined;
let rpcSeq = 0;
let opening: Promise<string> | undefined;

/** The JSON-RPC message out of a Streamable HTTP answer: plain JSON, or the last `data:` line of an event stream. */
export function parseRpc(contentType: string | null, text: string): { result?: unknown; error?: { code: number; message: string } } {
  if (!/text\/event-stream/.test(contentType ?? "")) return text ? JSON.parse(text) : {};
  const datas = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  const withId = datas.map((d) => { try { return JSON.parse(d); } catch { return undefined; } }).filter((m) => m && typeof m === "object" && ("result" in m || "error" in m));
  return withId.at(-1) ?? {};
}

async function rpc(method: string, params: unknown, id: number | undefined, sid: string | undefined, timeout: number): Promise<{ res: Response; msg: ReturnType<typeof parseRpc> }> {
  const t = credentials();
  const res = await fetch(`${baseUrl()}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${t}`, accept: "application/json, text/event-stream", "content-type": "application/json", "user-agent": "pal-tela", "mcp-protocol-version": PROTOCOL,
      ...(sid ? { "mcp-session-id": sid } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 401 || res.status === 403) return failure(res);
  const text = await res.text();
  return { res, msg: res.ok ? parseRpc(res.headers.get("content-type"), text) : {} };
}

async function open(): Promise<string> {
  const { res, msg } = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "pal-tela", version: "0.1.0" } }, ++rpcSeq, undefined, REQUEST_MS);
  const sid = res.headers.get("mcp-session-id");
  if (!res.ok || !sid) throw new ApiError(res.status, "mcp", msg.error?.message ?? `MCP initialize answered ${res.status}`);
  await rpc("notifications/initialized", {}, undefined, sid, REQUEST_MS).catch(() => {});
  session = sid;
  return sid;
}

const sessionId = () => session ?? (opening ??= open().finally(() => { opening = undefined; }));

/** One MCP `tools/call`; the tool's `structuredContent`. A session the server no longer knows is opened again once. */
export async function tool<T = unknown>(name: string, args: Record<string, unknown>, timeout = REQUEST_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const sid = await sessionId();
    const { res, msg } = await rpc("tools/call", { name, arguments: args }, ++rpcSeq, sid, timeout);
    const lost = res.status === 404 || res.status === 400 || (msg.error && /session/i.test(msg.error.message));
    if (lost && attempt === 0) { session = undefined; continue; }
    if (!res.ok) throw new ApiError(res.status, "mcp", msg.error?.message ?? `MCP answered ${res.status}`);
    if (msg.error) throw new ApiError(500, "mcp", msg.error.message);
    const r = msg.result as { isError?: boolean; structuredContent?: T; content?: { type: string; text?: string }[] } | undefined;
    if (!r) throw new ApiError(500, "mcp", "empty MCP answer");
    if (r.isError) {
      const text = r.content?.find((c) => c.type === "text")?.text ?? "";
      let code = "tool_error", status = 500, message = text || `${name} failed`;
      try { const j = JSON.parse(text) as { error?: string; code?: string; status?: number }; if (j.code) code = j.code; if (j.status) status = j.status; if (j.error) message = j.error; } catch {}
      throw new ApiError(status, code, message);
    }
    if (r.structuredContent !== undefined) return r.structuredContent;
    const text = r.content?.find((c) => c.type === "text")?.text;
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** Settings changed: the session is the token's, so a new token means a new session. */
settings.onChange(() => { session = undefined; }, EXTENSION);
/** For the tests: drop the session so the next call opens one. */
export const resetSession = () => { session = undefined; };

// ---- cache --------------------------------------------------------------
// In memory only: the rows carry page bodies (a space tree is the whole
// space), which is far past the storage file's cap, and a restart costs one
// request per palette. One entry per key with its age; one fetch in flight.

type Entry<T> = { at: number; data: T };
const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** The value under `key` while younger than `ttlMs` (unless `refresh`), else `load()`; a loader that throws leaves a stale value standing (logged) when there is one. */
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

/** Drops keys (a prefix matches every key under it) so the next `cached` loads. */
export const forget = (...prefixes: string[]) => { for (const k of [...mem.keys()]) if (prefixes.some((p) => k === p || k.startsWith(p + ":"))) mem.delete(k); };
export const forgetAll = () => mem.clear();
settings.onChange(forgetAll, EXTENSION);
