// The OpenWA HTTP API (github.com/openwa; the owner's runs on archer at
// http://wp.lan, Swagger at /api/docs): one client for the palettes and
// the bar item. `x-api-key` from the `api_key` setting, the session's
// UUID resolved once from its name (`GET /api/sessions`) and kept in
// memory and in storage, every call typed here. A 401 names the key, a
// 404 on the session path drops the cached UUID and resolves again once,
// a 409 is the session not being ready (the chat list answers 409 while
// it waits for a QR scan), a 429 is remembered for `Retry-After` and
// refused locally until then. Sends, replies, reactions and mark-read are
// the four writes; index.ts gates the first three behind `send`.
import { settings, storage } from "@zcag/pal";

export type Conf = { base_url?: string; api_key?: string; session?: string; send?: boolean; unread_only_bar?: boolean; dm_urgent?: boolean; open?: "auto" | "app" | "web" };
export const conf = (): Conf => settings.get<Conf>();

export const DEFAULT_URL = "http://wp.lan";
export const base = (): string => (conf().base_url?.trim() || DEFAULT_URL).replace(/\/+$/, "");
export const sessionName = (): string => conf().session?.trim() || "main";

const HTTP_MS = 15_000;
/** Contacts come 1000 a page; the live list is the whole store (5.4k on the owner's). */
export const PAGE = 1000;
/** The batch profile-picture route takes 50 ids at most. */
export const PICTURE_BATCH = 50;
const DEFAULT_BACKOFF_MS = 60_000;

export const log = (msg: string) => console.error(`[whatsapp] ${msg}`);

/** No API key set: nothing can be asked. */
export class NoKey extends Error { constructor() { super("No API key set"); } }
/** OpenWA could not be reached at `url` (refused, timed out, no such host). */
export class Unreachable extends Error { constructor(readonly url: string, detail: string) { super(`OpenWA is unreachable at ${url}: ${detail}`); } }
/** OpenWA refused: `status` and its message. `auth` for a 401 or 403 (the key). */
export class ApiError extends Error { constructor(readonly status: number, message: string, readonly auth = false) { super(message); } }
/** No session of that name, or one that is not `ready` (its `status` says what it is doing instead). */
export class SessionError extends Error { constructor(readonly name: string, readonly status: string | undefined) { super(status ? `WhatsApp session "${name}" is ${status.replace(/_/g, " ")}` : `No WhatsApp session named "${name}"`); } }
/** Too many calls; every request until `until` is refused here. */
export class RateLimited extends Error { constructor(readonly until: Date) { super(`OpenWA rate limit reached, retry at ${until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`); } }

// ---- wire shapes -----------------------------------------------------------------------

export type Session = { id: string; name: string; status: "created" | "initializing" | "qr_ready" | "authenticating" | "ready" | "disconnected" | "failed"; phone?: string | null; pushName?: string | null };
/** `GET /chats`: a bare list, `lastMessage` a plain string (or absent for media and the like), `timestamp` in seconds. */
export type ChatSummary = { id: string; name: string; isGroup: boolean; kind: "individual" | "group" | "channel" | "status" | "broadcast" | "unknown"; unreadCount: number; timestamp: number; lastMessage?: string | null };
/** `GET /messages/{chatId}/history`, live from WhatsApp: oldest first, `fromMe`, a group's sender in `author`, no names and no quotes. */
export type LiveMessage = { id: string; from: string; to: string; chatId: string; body: string; type: string; timestamp: number; fromMe: boolean; isGroup?: boolean; author?: string };
/** `GET /messages?chatId=`, the archive: newest first, `direction` rather than `fromMe`, the sender's saved name in `chatName`, a quoted reply under `metadata`. */
export type DbMessage = { id: string; waMessageId?: string; chatId: string; chatName?: string; author?: string | null; from: string; to: string; body: string; type: string; direction: "incoming" | "outgoing"; timestamp: number; metadata?: { quotedMessage?: { id?: string; body?: string }; media?: { mimetype?: string; filename?: string } } | null; status?: string };
export type Contact = { id: string; name?: string; pushName?: string; number?: string; isMyContact: boolean; isBlocked?: boolean };
/** `GET /search`: the archive's full-text hits, `snippet` with `<mark>` around the match, `timestamp` in seconds. */
export type SearchHit = { messageId: string; waMessageId?: string; sessionId: string; chatId: string; body: string; snippet: string; timestamp: number; type: string; direction: "incoming" | "outgoing"; from: string; score?: number };
export type SearchResult = { hits: SearchHit[]; total: number; tookMs?: number; provider?: string };

// ---- requests ----------------------------------------------------------------------------

let limitedUntil = 0;

type Params = Record<string, string | number | boolean | undefined>;

function url(path: string, params?: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return `${base()}/api${path}${s ? `?${s}` : ""}`;
}

/** One call: the key on it, the answer as JSON (null for an empty body), the failures typed. */
export async function request<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Params, body?: unknown): Promise<T> {
  if (Date.now() < limitedUntil) throw new RateLimited(new Date(limitedUntil));
  const key = conf().api_key?.trim();
  if (!key) throw new NoKey();
  const target = url(path, params);
  let r: Response;
  try {
    r = await fetch(target, {
      method,
      headers: { "x-api-key": key, accept: "application/json", ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_MS),
    });
  } catch (e) {
    const detail = e instanceof Error ? (e.name === "TimeoutError" ? `no answer in ${HTTP_MS / 1000} s` : e.message.replace(/^fetch failed:?\s*/i, "") || e.name) : String(e);
    throw new Unreachable(base(), detail);
  }
  if (r.status === 204 || r.headers.get("content-length") === "0") return null as T;
  const text = await r.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!r.ok) {
    const j = (json ?? {}) as { message?: string | string[]; error?: string };
    const msg = Array.isArray(j.message) ? j.message.join("; ") : j.message || j.error || `${r.status} ${r.statusText}`;
    if (r.status === 429) {
      const after = Number(r.headers.get("retry-after"));
      limitedUntil = Date.now() + (Number.isFinite(after) && after > 0 ? after * 1000 : DEFAULT_BACKOFF_MS);
      throw new RateLimited(new Date(limitedUntil));
    }
    throw new ApiError(r.status, msg, r.status === 401 || r.status === 403);
  }
  return json as T;
}

// ---- the session ---------------------------------------------------------------------------

let resolved: { name: string; id: string } | undefined;

export const sessions = () => request<Session[]>("GET", "/sessions", { limit: PAGE });

/**
 * The UUID of the session named in the settings (a UUID typed there is
 * taken as is): memory, then storage (`session:<name>`, so a restart
 * costs no call), then `GET /api/sessions`. A name no session has is a
 * `SessionError`.
 */
export async function sessionId(fresh = false): Promise<string> {
  const name = sessionName();
  if (!fresh && resolved?.name === name) return resolved.id;
  if (!fresh) {
    const kept = await storage.get<string>(`session:${name}`, "whatsapp").catch(() => null);
    if (kept) { resolved = { name, id: kept }; return kept; }
  }
  const all = await sessions();
  const s = all.find((x) => x.name === name) ?? all.find((x) => x.id === name);
  if (!s) throw new SessionError(name, undefined);
  resolved = { name, id: s.id };
  await storage.set(`session:${name}`, s.id, "whatsapp").catch(() => {});
  return s.id;
}

/** The session's record, for its status when a call says it is not ready. */
export const session = async (): Promise<Session | undefined> => {
  const id = await sessionId();
  return (await sessions()).find((s) => s.id === id);
};

/**
 * A call under `/sessions/<id>/...`: a 404 on it means the UUID is stale
 * (the session was recreated), so it is resolved again once; a 409 is
 * the session not being ready, answered as a `SessionError` naming its
 * status.
 */
export async function inSession<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Params, body?: unknown): Promise<T> {
  let id = await sessionId();
  for (let attempt = 0; ; attempt++) {
    try {
      return await request<T>(method, `/sessions/${encodeURIComponent(id)}${path}`, params, body);
    } catch (e) {
      // A stale UUID (the session was recreated): "Session with id '...' not found", as against a chat's or a contact's 404.
      if (e instanceof ApiError && e.status === 404 && attempt === 0 && /^session\b/i.test(e.message)) { id = await sessionId(true); continue; }
      if (e instanceof ApiError && e.status === 409) {
        const s = await session().catch(() => undefined);
        throw new SessionError(sessionName(), s?.status ?? "not ready");
      }
      throw e;
    }
  }
}

// ---- the calls -------------------------------------------------------------------------------

export const chats = () => inSession<ChatSummary[]>("GET", "/chats", { limit: PAGE });
/** The newest `limit` messages of a chat, live from WhatsApp, oldest first. */
export const history = (chatId: string, limit: number) => inSession<LiveMessage[]>("GET", `/messages/${encodeURIComponent(chatId)}/history`, { limit });
/** The archive's rows for a chat, newest first (capped at 100 by the server whatever `limit` says). */
export const archived = async (chatId: string, limit: number): Promise<DbMessage[]> => (await inSession<{ messages?: DbMessage[] }>("GET", "/messages", { chatId, limit })).messages ?? [];
export const contactsPage = (offset: number) => inSession<Contact[]>("GET", "/contacts", { limit: PAGE, offset });
export const contact = (id: string) => inSession<Contact>("GET", `/contacts/${encodeURIComponent(id)}`);
/** The phone behind a `@lid` id (the only route from a LID to a number). */
export const resolvePhone = async (id: string): Promise<string> => (await inSession<{ contactId: string; phone: string | null }>("GET", `/contacts/${encodeURIComponent(id)}/phone`)).phone ?? "";
/** Profile picture urls for up to `PICTURE_BATCH` ids, null for none. */
export const pictures = async (ids: string[]): Promise<Record<string, string | null>> => (await inSession<{ pictures: Record<string, string | null> }>("GET", "/contacts/profile-pictures", { ids: ids.join(",") })).pictures ?? {};
export const search = async (q: string, limit: number): Promise<SearchResult> => request<SearchResult>("GET", "/search", { q, limit, sessionId: await sessionId() });

export const markChatRead = (chatId: string) => inSession<unknown>("POST", "/chats/read", undefined, { chatId });
export const markChatUnread = (chatId: string) => inSession<unknown>("POST", "/chats/unread", undefined, { chatId });
export const sendText = (chatId: string, text: string) => inSession<{ messageId: string; timestamp: number }>("POST", "/messages/send-text", undefined, { chatId, text });
export const reply = (chatId: string, quotedMessageId: string, text: string) => inSession<{ messageId: string; timestamp: number }>("POST", "/messages/reply", undefined, { chatId, quotedMessageId, text });
export const react = (chatId: string, messageId: string, emoji: string) => inSession<unknown>("POST", "/messages/react", undefined, { chatId, messageId, emoji });

/** Forget the rate limit and the resolved session (settings changed, tests). */
export const reset = () => { limitedUntil = 0; resolved = undefined; };
