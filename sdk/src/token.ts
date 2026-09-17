// A bearer token a shell command prints (calendar's and gmail's accounts):
// pal never sees a refresh token or a client secret, only the short-lived
// access token on the command's stdout, kept until its expiry. `gcloud
// auth print-access-token`, a broker behind ssh, a keychain lookup:
// anything that prints a token, or the JSON an OAuth endpoint answers
// (`access_token`, `expires_in`).
import { exec } from "./exec.ts";

/** How long a bare token (no `expires_in`) is trusted; Google's last 60 min. */
export const BARE_TOKEN_TTL = 30 * 60_000;
/** Refetch this long before the expiry the command stated. */
export const EXPIRY_MARGIN = 60_000;
/** The command is killed after this. */
export const TOKEN_CMD_MS = 20_000;

export type Token = { token: string; until: number };

/** The token a command's output carries and when it stops being good: JSON with `access_token` (`expires_in` seconds, or `expiry`/`expires_at`), else the first non-empty line. */
export function parseToken(out: string, now = Date.now()): Token | undefined {
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

/** The command did not print a token: `stderr` is what it printed instead, `code` how it exited. */
export class TokenError extends Error {
  constructor(message: string, readonly stderr = "", readonly code = 0) { super(message); }
}

/** Runs the command through `sh -c` and reads the token off its stdout; a `TokenError` names the exit code or the missing token, with stderr's last line. */
export async function mintToken(command: string, now = Date.now()): Promise<Token> {
  const { out, err, code } = await exec(["sh", "-c", command], { ms: TOKEN_CMD_MS, env: process.env });
  const last = err.trim().split("\n").filter(Boolean).pop() ?? "";
  if (code !== 0) throw new TokenError(`Token command exited ${code}${last ? `: ${last}` : ""}`, err.trim(), code);
  const t = parseToken(out, now);
  if (!t) throw new TokenError(`Token command printed no token${last ? `: ${last}` : ""}`, err.trim());
  return t;
}
