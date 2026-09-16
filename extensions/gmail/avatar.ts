// A sender's mark on the row: the Gravatar for the address when there is
// one (a HEAD with `d=404`, the answer remembered per address for the
// process), else the initial on a tile tinted from the address. Both are
// `{ image }` icons: the webview loads the https url, the tile is a data
// url it draws from. `PAL_GMAIL_AVATARS` replaces the Gravatar host (the
// tests point it at a local server); an empty value turns the probe off.
import { createHash } from "node:crypto";

const GRAVATAR = process.env.PAL_GMAIL_AVATARS === undefined ? "https://www.gravatar.com/avatar" : process.env.PAL_GMAIL_AVATARS.replace(/\/+$/, "");
const PROBE_MS = 4000;
/** The tile colours behind an initial, one per address by hash. */
const TINTS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#14b8a6", "#ef4444", "#6366f1"];

export const gravatarUrl = (email: string, px = 64): string => `${GRAVATAR}/${createHash("md5").update(email.trim().toLowerCase()).digest("hex")}?s=${px}&d=404`;

/** The initial on a tinted tile, as a data url. */
export function initialIcon(name: string, seed = name): { image: string } {
  const letter = ([...name.trim()][0] ?? "?").toUpperCase();
  const tint = TINTS[[...seed].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${tint}"/><text x="32" y="42" font-family="system-ui" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">${letter.replace(/[<>&]/g, "")}</text></svg>`;
  return { image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}

const probes = new Map<string, Promise<boolean>>();

/** Whether the address has a Gravatar; one HEAD per address per process, a failed probe counting as none. */
export function hasGravatar(email: string): Promise<boolean> {
  if (!GRAVATAR || !email) return Promise.resolve(false);
  const key = email.trim().toLowerCase();
  let p = probes.get(key);
  if (!p) {
    p = fetch(gravatarUrl(key), { method: "HEAD", signal: AbortSignal.timeout(PROBE_MS) }).then((r) => r.ok, () => false);
    probes.set(key, p);
  }
  return p;
}

/** The row's icon for a sender. */
export async function avatar(email: string, name: string): Promise<{ image: string }> {
  return (await hasGravatar(email)) ? { image: gravatarUrl(email) } : initialIcon(name || email, email || name);
}

/** Forget the probes (tests). */
export const forgetAvatars = () => probes.clear();
