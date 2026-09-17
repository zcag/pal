// Spotify sign-in: the authorization code flow with PKCE (no client
// secret), a loopback listener for the one-time callback, and the tokens
// kept between runs. The user's own app (developer.spotify.com, README)
// gives the `client_id` setting; the redirect it registers is
// `http://127.0.0.1:<redirect_port>/callback`, which `signIn` serves with
// `Bun.serve` for as long as one sign-in is pending. The refresh token
// lives in the extension's storage (`auth`): the SDK has no `settings.set`
// to write a `keychain:` reference through the secret setting, so the
// storage file (`<data dir>/pal/storage/spotify.json`, user-only) holds it
// as plain JSON; Sign out removes it. `PAL_SPOTIFY_ACCOUNTS` points the
// tests at a mock of accounts.spotify.com.
import { bar, effects, settings, storage } from "@zcag/pal";

export const EXTENSION = "spotify";
export const ITEM = "playing";
export const ACCOUNTS = (process.env.PAL_SPOTIFY_ACCOUNTS || "https://accounts.spotify.com").replace(/\/+$/, "");
/** What the palettes need: playback (read and control), the library, playlists, history and top items. */
export const SCOPES = [
  "user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing",
  "user-library-read", "user-library-modify",
  "playlist-read-private", "playlist-read-collaborative", "playlist-modify-public", "playlist-modify-private",
  "user-read-recently-played", "user-top-read",
];
/** How long the loopback listener waits for the browser to come back. */
export const SIGN_IN_MS = 5 * 60_000;
/** The access token is renewed this long before Spotify would refuse it. */
const EARLY_MS = 60_000;
const TOKEN_MS = 10_000;
const STORAGE_KEY = "auth";

export const log = (...a: unknown[]) => console.error("[spotify]", ...a);

/** `[extensions.spotify]`, defaults in pal.json. */
export type Settings = { client_id: string; redirect_port: number; bar_lyrics: boolean; pinned: string[] };
export const conf = () => settings.get<Settings>(EXTENSION);

/** Nobody is signed in: no client id yet, or no tokens (never signed in, signed out, or Spotify revoked the refresh token). */
export class NotSignedIn extends Error {
  constructor(public readonly reason: "client_id" | "signed_out") { super(reason === "client_id" ? "no Spotify client id" : "not signed in to Spotify"); }
}

export type Tokens = { access: string; refresh: string; expiresAt: number; scope: string };

// ---- PKCE ---------------------------------------------------------------

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** RFC 7636: 43..128 unreserved characters; 64 random bytes as base64url are 86. */
export const verifier = (): string => b64url(crypto.getRandomValues(new Uint8Array(64)));
/** `BASE64URL(SHA256(verifier))`, the S256 method. */
export const challenge = (v: string): string => b64url(new Uint8Array(new Bun.CryptoHasher("sha256").update(v).digest()));
export const randomState = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
export const redirectUri = (port: number) => `http://127.0.0.1:${port}/callback`;

/** The page the "Sign in" row opens. */
export function authorizeUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string; scopes?: string[] }): string {
  const q = new URLSearchParams({
    client_id: o.clientId, response_type: "code", redirect_uri: o.redirectUri, state: o.state,
    scope: (o.scopes ?? SCOPES).join(" "), code_challenge_method: "S256", code_challenge: o.challenge,
  });
  return `${ACCOUNTS}/authorize?${q}`;
}

// ---- tokens -------------------------------------------------------------

let tokens: Tokens | undefined | null;
let refreshing: Promise<Tokens> | undefined;

/** The tokens on file, once per run; `null` remembers there are none. */
export async function loadTokens(): Promise<Tokens | undefined> {
  if (tokens === undefined) tokens = (await storage.get<Tokens>(STORAGE_KEY, EXTENSION).catch(() => null)) ?? null;
  return tokens ?? undefined;
}

async function saveTokens(t: Tokens | null) {
  tokens = t;
  await storage.set(STORAGE_KEY, t, EXTENSION).catch((e) => log(`tokens not stored: ${e instanceof Error ? e.message : e}`));
}

/** Forgets the tokens (Sign out). Spotify has no revoke endpoint for PKCE apps; the user removes the app under spotify.com/account/apps. */
export const signOut = () => saveTokens(null);

export const signedIn = async () => !!(await loadTokens());

type TokenReply = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; error?: string; error_description?: string };

async function tokenRequest(form: Record<string, string>, previous?: Tokens): Promise<Tokens> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(TOKEN_MS),
  });
  const j = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || !j.access_token) throw new Error(j.error_description || j.error || `${res.status} ${res.statusText}`);
  // Spotify rotates the refresh token on a PKCE refresh; a reply without one keeps the old.
  return { access: j.access_token, refresh: j.refresh_token ?? previous?.refresh ?? "", expiresAt: Date.now() + j.expires_in * 1000, scope: j.scope ?? previous?.scope ?? "" };
}

/** The code from the callback for tokens. */
export const exchange = (code: string, codeVerifier: string, uri: string, clientId: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: uri, client_id: clientId, code_verifier: codeVerifier });

/**
 * A fresh access token, renewed early and once at a time; `force` renews
 * whatever the clock says (a 401). A refresh Spotify refuses
 * (`invalid_grant`: revoked, or the app was deleted) signs out.
 */
export async function accessToken(force = false): Promise<string> {
  const clientId = conf().client_id?.trim();
  if (!clientId) throw new NotSignedIn("client_id");
  const t = await loadTokens();
  if (!t) throw new NotSignedIn("signed_out");
  if (!force && Date.now() < t.expiresAt - EARLY_MS) return t.access;
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: clientId }, t)
    .then(async (next) => { await saveTokens(next); return next; })
    .catch(async (e) => {
      if (/invalid_grant|revoked/i.test(String(e?.message))) { await saveTokens(null); throw new NotSignedIn("signed_out"); }
      throw e;
    })
    .finally(() => { refreshing = undefined; });
  return (await refreshing).access;
}

// ---- the loopback listener ----------------------------------------------

type Pending = { state: string; verifier: string; uri: string; clientId: string; timer: ReturnType<typeof setTimeout> };
let server: ReturnType<typeof Bun.serve> | undefined;
let pending: Pending | undefined;

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #1a1a1f; background: #f6f6f8; display: grid; place-items: center; height: 100vh; margin: 0"><div style="text-align: center; padding: 32px"><h1 style="font-size: 20px; margin: 0 0 8px">${title}</h1><p style="margin: 0; color: #5f6b7c">${body}</p></div>`;

/** How long after answering the browser the listener goes away: the reply has to leave first. */
const LINGER_MS = 250;

/** Stops the listener and closes its connections (the reply left LINGER_MS ago; on bun 1.3 a graceful stop kept a keep-alive connection answering); a pending sign-in is dropped (its timer cleared). */
export function stopListener() {
  if (pending) clearTimeout(pending.timer);
  pending = undefined;
  server?.stop(true);
  server = undefined;
}

/**
 * Starts one sign-in: a fresh verifier and state, the listener on
 * `127.0.0.1:<port>` (started if not up; a port in use is the error), and
 * the authorize url to open. The callback is answered in the browser and
 * finished here: the code exchanged, the tokens stored, the HUD told, the
 * bar item rendered again. A second call replaces the pending one.
 * `onDone` (tests) sees the outcome.
 */
export async function signIn(clientId: string, port: number, onDone?: (e?: Error) => void): Promise<string> {
  if (pending) clearTimeout(pending.timer);
  const v = verifier(), state = randomState(), uri = redirectUri(port);
  const finish = async (e?: Error) => {
    stopListener();
    if (e) log(`sign-in failed: ${e.message}`);
    onDone?.(e);
    try { await effects.run({ hud: e ? `Spotify sign-in failed: ${e.message}` : "Signed in to Spotify" }); } catch {}
    if (!e) bar.refresh(ITEM, EXTENSION).catch(() => {});
  };
  // The browser gets its page before the listener goes: a stop while the reply is in flight would cut it off.
  const later = (e?: Error) => {
    if (pending) clearTimeout(pending.timer);
    pending = undefined;
    setTimeout(() => finish(e), LINGER_MS);
  };
  server ??= Bun.serve({
    hostname: "127.0.0.1", port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") return new Response("not found", { status: 404 });
      const p = pending;
      if (!p) return new Response(page("Nothing pending", "Start the sign-in from pal again."), { status: 410, headers: { "content-type": "text/html" } });
      if (url.searchParams.get("state") !== p.state) return new Response(page("Sign-in mismatch", "This link is not the one pal opened. Start again from pal."), { status: 400, headers: { "content-type": "text/html" } });
      const denied = url.searchParams.get("error"), code = url.searchParams.get("code");
      if (denied || !code) {
        later(new Error(denied ?? "no code"));
        return new Response(page("Not signed in", `Spotify said: ${denied ?? "no code"}. You can close this tab.`), { headers: { "content-type": "text/html" } });
      }
      try {
        await saveTokens(await exchange(code, p.verifier, p.uri, p.clientId));
      } catch (e) {
        later(e instanceof Error ? e : new Error(String(e)));
        return new Response(page("Not signed in", `The code exchange failed: ${e instanceof Error ? e.message : e}`), { status: 502, headers: { "content-type": "text/html" } });
      }
      later();
      return new Response(page("Signed in to Spotify", "pal has what it needs. You can close this tab."), { headers: { "content-type": "text/html" } });
    },
  });
  pending = { state, verifier: v, uri, clientId, timer: setTimeout(() => finish(new Error("timed out")), SIGN_IN_MS) };
  return authorizeUrl({ clientId, redirectUri: uri, challenge: challenge(v), state });
}

/** The listener's port while a sign-in is pending (tests). */
export const listening = () => (pending ? server?.port : undefined);
