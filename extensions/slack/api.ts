// Slack transport: who we are (a session per workspace) and one call.
//
// Two ways in (`auth` setting): `app` takes the desktop app's own session
// (`auth.ts`: the `xoxc-` token and the `d` cookie, extracted once, kept
// in memory, extracted again when Slack answers `invalid_auth`), which is
// what lets `client.counts` answer every unread in one request; `token` is
// a user token (`xoxp-`) from a Slack app of your own, sent as a bearer,
// which sees the same inbox minus what only the client API gives (threads,
// the mention count per channel: `data.ts` says what stands in). Every
// call is a form POST to `https://<domain>.slack.com/api/<method>` (the
// cookie is scoped to the workspace's host; `slack.com` for a token);
// `PAL_SLACK_API` replaces the host for the tests. A 429 is remembered for
// its `Retry-After` and every call until then fails at once (`RateLimited`),
// so a refresh never piles requests onto a limit.
import { clock, settings } from "@zcag/pal";
import { extract, NotSignedIn, type Creds, type Team } from "./auth.ts";

export const EXTENSION = "slack";
export const REQUEST_MS = 10_000;
/** `[extensions.slack]`, defaults in pal.json. */
export type Settings = { auth: "app" | "token"; token: string; workspace: string; statuses: string[]; presence: boolean };
export const conf = () => settings.get<Settings>(EXTENSION);
export const log = (...a: unknown[]) => console.error("[slack]", ...a);

export { NotSignedIn };
export class ApiError extends Error {
  constructor(public readonly code: string, method: string) { super(`${method}: ${code}`); }
  get auth() { return this.code === "invalid_auth" || this.code === "not_authed" || this.code === "token_revoked" || this.code === "account_inactive"; }
}
export class RateLimited extends Error {
  constructor(public readonly until: Date) { super(`Slack rate limit, retry at ${clock(until)}`); }
}

/** One workspace as the calls see it: the app's team, or the token's. */
export type Session = Team & { mode: "app" | "token"; d?: string };

const host = (s: Session) => process.env.PAL_SLACK_API || (s.mode === "app" ? `https://${s.domain}.slack.com` : "https://slack.com");

let creds: Creds | undefined;
let extracting: Promise<Creds> | undefined;
let tokenSession: Session | undefined;
let limitedUntil = 0;
settings.onChange(() => { creds = undefined; tokenSession = undefined; }, EXTENSION);

/** The app's sessions, extracted once (`force` after a rejection); in memory only, never on disk. */
async function appSessions(force = false): Promise<Session[]> {
  if (!creds || force) {
    extracting ??= extract().finally(() => { extracting = undefined; });
    creds = await extracting;
  }
  const { teams, d } = creds;
  return Object.values(teams).map((t) => ({ ...t, mode: "app" as const, d }));
}

/** The token's one workspace, from `auth.test` (team id, user id, the domain the deep links need). */
async function tokenSessions(): Promise<Session[]> {
  const token = (process.env.PAL_SLACK_TOKEN || conf().token || "").trim();
  if (!token) throw new NotSignedIn("Slack token is not set; add a user token (xoxp-...) under Settings › Extensions › Slack, or set auth to app");
  if (tokenSession && tokenSession.token === token) return [tokenSession];
  const probe: Session = { mode: "token", token, id: "", name: "", domain: "", user: "" };
  const r = await call<{ team_id: string; user_id: string; team: string; url: string }>(probe, "auth.test");
  tokenSession = { ...probe, id: r.team_id, user: r.user_id, name: r.team, domain: new URL(r.url).hostname.replace(/\.slack\.com$/, "") };
  return [tokenSession];
}

/** The workspaces to ask, per the `workspace` setting (a team id or domain; empty means every signed-in one). */
export async function sessions(force = false): Promise<Session[]> {
  const all = conf().auth === "token" ? await tokenSessions() : await appSessions(force);
  const want = (conf().workspace || "").trim().toLowerCase();
  if (!want) return all;
  const picked = all.filter((s) => s.id.toLowerCase() === want || s.domain.toLowerCase() === want);
  if (!picked.length) throw new NotSignedIn(`No signed-in workspace named "${want}"; signed in: ${all.map((s) => s.domain).join(", ")}`);
  return picked;
}

/** The first workspace, for what is per user rather than per conversation (status, presence, DND). */
export const primary = async () => (await sessions())[0];

async function post<T>(s: Session, method: string, params: Record<string, string | number | boolean | undefined>, ms: number): Promise<T & { ok: boolean; error?: string }> {
  if (Date.now() < limitedUntil) throw new RateLimited(new Date(limitedUntil));
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  // The app's token rides in the body with the `d` cookie beside it (sent as stored: it is percent-encoded already, quoting it again is `invalid_auth`); a user token is a bearer.
  if (s.mode === "app") { body.set("token", s.token); headers.cookie = `d=${s.d}`; } else headers.authorization = `Bearer ${s.token}`;
  const res = await fetch(`${host(s)}/api/${method}`, { method: "POST", headers, body, signal: AbortSignal.timeout(ms) });
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after")) || 30;
    limitedUntil = Date.now() + after * 1000;
    throw new RateLimited(new Date(limitedUntil));
  }
  if (!res.ok) throw new ApiError(`http ${res.status}`, method);
  return (await res.json()) as T & { ok: boolean; error?: string };
}

/**
 * One Slack call. `invalid_auth` on an app session means the app signed in
 * again since the extraction: the session is extracted afresh and the call
 * retried once; a second refusal is the error, so a dead session never
 * loops on the keychain. `ms` is the request's timeout (`REQUEST_MS`
 * unless a caller can afford less, as a presence lookup can).
 */
export async function call<T = Record<string, unknown>>(s: Session, method: string, params: Record<string, string | number | boolean | undefined> = {}, ms = REQUEST_MS): Promise<T> {
  let r = await post<T>(s, method, params, ms);
  if (!r.ok && s.mode === "app" && new ApiError(r.error ?? "", method).auth) {
    const fresh = (await appSessions(true)).find((x) => x.id === s.id);
    if (fresh) { Object.assign(s, fresh); r = await post<T>(s, method, params, ms); }
  }
  if (!r.ok) throw new ApiError(r.error ?? "unknown_error", method);
  return r;
}

/** Every page of a cursor-paginated list, `limit` per page, at most `pages`. */
export async function paged<T>(s: Session, method: string, params: Record<string, string | number | boolean | undefined>, key: string, pages = 5, limit = 200): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < pages; i++) {
    const r = await call<Record<string, unknown> & { response_metadata?: { next_cursor?: string } }>(s, method, { ...params, limit, cursor });
    out.push(...((r[key] as T[]) ?? []));
    cursor = r.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

/** For the tests: forget the sessions and the limit. */
export const reset = () => { creds = undefined; tokenSession = undefined; limitedUntil = 0; };
