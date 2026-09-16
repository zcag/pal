// The Gmail API v1 for one account: the token a shell command prints
// (the calendar extension's pattern: the command owns the secret, pal
// keeps the access token in memory until its stated expiry, mints again
// once on a 401), then the handful of calls the palettes need. Every
// listing is `messages.list` with `maxResults` 50 and `messages.get` with
// `format=metadata` for the rows (the four headers a row shows); `full`
// only for the one message the pane or a reply opens. A 429 (or a 403
// naming the quota) is remembered and every call until `Retry-After`
// refused locally. `PAL_GMAIL_API` replaces the API host (the tests).
import { settings } from "@zcag/pal";
import type { Message, Part } from "./mail.ts";

export type Conf = { token_command?: string; address?: string; labels?: string[]; send?: boolean; signature?: string };
export const conf = (): Conf => settings.get<Conf>();

export const API = (process.env.PAL_GMAIL_API || "https://gmail.googleapis.com/gmail/v1").replace(/\/+$/, "");
export const MAX_RESULTS = 50;
/** The headers a row needs; the pane fetches the message whole. */
export const ROW_HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "Reply-To", "References", "List-Unsubscribe"];
/** How long a bare token (no `expires_in`) is trusted; Google's last 60 min. */
const BARE_TOKEN_TTL = 30 * 60_000;
const EXPIRY_MARGIN = 60_000;
const TOKEN_CMD_MS = 20_000;
const HTTP_MS = 15_000;
/** How many `messages.get` run at once. */
const CONCURRENCY = 8;
/** A 429 without a Retry-After is refused for this long. */
const DEFAULT_BACKOFF_MS = 60_000;

export const log = (msg: string) => console.error(`gmail: ${msg}`);

/** The token command is empty, or ran and failed: the account cannot be read. `stderr` is what it printed. */
export class TokenError extends Error {
  constructor(message: string, readonly stderr = "") { super(message); }
}
/** Gmail refused: `status` and Google's message. `auth` for a 401 that a fresh token did not cure. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly auth = false) { super(message); }
}
/** The quota is spent until `until`. */
export class RateLimited extends Error {
  constructor(readonly until: Date) { super(`Gmail rate limit reached, retry at ${until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`); }
}

// ---- tokens ------------------------------------------------------------------------

/** The token a command's output carries and when it stops being good: JSON with `access_token` (`expires_in` seconds, or `expiry`/`expires_at`), else the first non-empty line. */
export function parseToken(out: string, now = Date.now()): { token: string; until: number } | undefined {
  const s = out.trim();
  if (!s) return;
  if (s.startsWith("{")) {
    let j: Record<string, unknown>;
    try { j = JSON.parse(s); } catch { return; }
    const token = typeof j.access_token === "string" ? j.access_token : typeof j.token === "string" ? j.token : undefined;
    if (!token) return;
    const secs = typeof j.expires_in === "number" ? j.expires_in : typeof j.expires_in === "string" ? Number(j.expires_in) : NaN;
    const at = typeof j.expiry === "string" ? Date.parse(j.expiry) : typeof j.expires_at === "number" ? j.expires_at * (j.expires_at < 1e12 ? 1000 : 1) : NaN;
    const until = Number.isFinite(secs) ? now + secs * 1000 : Number.isFinite(at) ? at : now + BARE_TOKEN_TTL;
    return { token, until: until - EXPIRY_MARGIN };
  }
  const line = s.split("\n").map((l) => l.trim()).find(Boolean);
  return line ? { token: line, until: now + BARE_TOKEN_TTL - EXPIRY_MARGIN } : undefined;
}

let cached: { command: string; token: string; until: number } | undefined;
let minting: Promise<string> | undefined;

/** The account's token: the cache while it is good and the command unchanged, else one run of the command shared by everyone waiting. */
export function token(fresh = false): Promise<string> {
  const command = (conf().token_command ?? "").trim();
  if (!command) return Promise.reject(new TokenError("No token command set for this account"));
  if (cached && cached.command === command && !fresh && Date.now() < cached.until) return Promise.resolve(cached.token);
  if (minting) return minting;
  minting = mint(command).finally(() => { minting = undefined; });
  return minting;
}

async function mint(command: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", command], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: process.env });
  const kill = setTimeout(() => proc.kill(), TOKEN_CMD_MS);
  let out: string, err: string, code: number;
  try {
    [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    code = await proc.exited;
  } finally { clearTimeout(kill); }
  const last = err.trim().split("\n").filter(Boolean).pop() ?? "";
  if (code !== 0) throw new TokenError(`Token command exited ${code}${last ? `: ${last}` : ""}`, err.trim());
  const t = parseToken(out);
  if (!t) throw new TokenError(`Token command printed no token${last ? `: ${last}` : ""}`, err.trim());
  cached = { command, ...t };
  return t.token;
}

export const forgetToken = () => { cached = undefined; };

// ---- requests ----------------------------------------------------------------------------

let limitedUntil = 0;

type Params = Record<string, string | string[] | undefined>;

function url(path: string, params?: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) q.append(k, x);
    else q.set(k, v);
  }
  const s = q.toString();
  return `${API}/users/me${path}${s ? `?${s}` : ""}`;
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Params, body?: unknown): Promise<T> {
  if (Date.now() < limitedUntil) throw new RateLimited(new Date(limitedUntil));
  let tok = await token();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url(path, params), {
      method,
      headers: { authorization: `Bearer ${tok}`, accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_MS),
    });
    if (r.status === 401 && attempt === 0) { tok = await token(true); continue; }
    if (r.status === 204) return null as T;
    if (!r.ok) {
      let msg = `${r.status}`, reason = "";
      try {
        const j = (await r.json()) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };
        if (j.error?.message) msg = j.error.message;
        reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? "";
      } catch { /* the status is the message */ }
      if (r.status === 429 || (r.status === 403 && /rateLimit|quota|RESOURCE_EXHAUSTED/i.test(`${reason} ${msg}`))) {
        const after = Number(r.headers.get("retry-after"));
        limitedUntil = Date.now() + (Number.isFinite(after) && after > 0 ? after * 1000 : DEFAULT_BACKOFF_MS);
        throw new RateLimited(new Date(limitedUntil));
      }
      throw new ApiError(r.status, msg, r.status === 401 || r.status === 403);
    }
    return (await r.json()) as T;
  }
}

/** `f` over `items`, at most `CONCURRENCY` at a time, in order. */
export async function pool<A, B>(items: A[], f: (a: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length);
  let next = 0;
  const run = async () => { for (let i = next++; i < items.length; i = next++) out[i] = await f(items[i]); };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return out;
}

// ---- the calls -----------------------------------------------------------------------------

export type Profile = { emailAddress: string; messagesTotal?: number; threadsTotal?: number; historyId?: string };
export type Label = { id: string; name: string; type?: "system" | "user"; messagesUnread?: number; threadsUnread?: number; messagesTotal?: number; labelListVisibility?: string; messageListVisibility?: string };
export type Ref = { id: string; threadId: string };
export type Draft = { id: string; message: Message };

export const profile = () => request<Profile>("GET", "/profile");

export const labelList = async (): Promise<Label[]> => (await request<{ labels?: Label[] }>("GET", "/labels")).labels ?? [];
export const labelGet = (id: string) => request<Label>("GET", `/labels/${encodeURIComponent(id)}`);

/** `messages.list`: the newest `max` ids matching `q` and every label in `labelIds`. */
export async function list(opts: { q?: string; labelIds?: string[]; max?: number }): Promise<Ref[]> {
  const r = await request<{ messages?: Ref[]; resultSizeEstimate?: number }>("GET", "/messages", { q: opts.q, labelIds: opts.labelIds, maxResults: String(opts.max ?? MAX_RESULTS) });
  return r.messages ?? [];
}

/** One message with its headers only. */
export const metadata = (id: string) => request<Message>("GET", `/messages/${encodeURIComponent(id)}`, { format: "metadata", metadataHeaders: ROW_HEADERS });
/** One message whole: the body parts and the attachments. */
export const full = (id: string) => request<Message>("GET", `/messages/${encodeURIComponent(id)}`, { format: "full" });

/** `messages.batchModify`: labels on and off over up to 1000 ids. */
export const modify = (ids: string[], add: string[] = [], remove: string[] = []) => request<null>("POST", "/messages/batchModify", undefined, { ids, ...(add.length && { addLabelIds: add }), ...(remove.length && { removeLabelIds: remove }) });

/** `messages.send` with the RFC 822 text as base64url; `threadId` keeps a reply in its thread. */
export const send = (raw: string, threadId?: string) => request<Message>("POST", "/messages/send", undefined, { raw, ...(threadId && { threadId }) });

export const draftList = async (): Promise<{ id: string; message: Ref }[]> => (await request<{ drafts?: { id: string; message: Ref }[] }>("GET", "/drafts", { maxResults: String(MAX_RESULTS) })).drafts ?? [];
export const draftGet = (id: string) => request<Draft>("GET", `/drafts/${encodeURIComponent(id)}`, { format: "metadata" });
export const draftSend = (id: string) => request<Message>("POST", "/drafts/send", undefined, { id });
export const draftDelete = (id: string) => request<null>("DELETE", `/drafts/${encodeURIComponent(id)}`);

/** Forget the rate limit and the token (settings changed, tests). */
export const reset = () => { limitedUntil = 0; forgetToken(); };

export type { Message, Part };
