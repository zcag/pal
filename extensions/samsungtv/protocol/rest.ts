// The TV's REST api on :8001 (plain http; :8002 serves the same over TLS):
// `/api/v2/` describes the TV, `/api/v2/applications/<id>` answers one
// app's state (404 when it is not installed) and launches (POST) or closes
// (DELETE) it. Read-only probes need no token. Checked on a 2024
// QE75QN85D: YouTube `111299001912` answers `{ running, visible }`,
// an id that is not installed 404s on both ports.
import type { AppState, Found, Power } from "../types.ts";

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };
/** `75&quot; Neo QLED` → `75" Neo QLED`: the TV escapes its own name in JSON. */
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));

export const base = (address: string, port = 8001) => `http://${address.includes(":") && !address.startsWith("[") ? `[${address}]` : address}:${port}/api/v2`;

/** `/api/v2/` as `Found`; undefined for an answer that is not a Tizen TV's. */
export function parseInfo(address: string, j: any): Found | undefined {
  const d = j?.device;
  if (!d || typeof d !== "object") return undefined;
  // A TV that answers without saying is on: only network standby says otherwise.
  const power: Power = d.PowerState === "standby" ? "standby" : "on";
  const id = String(d.duid ?? d.id ?? j.id ?? "");
  if (!id) return undefined;
  return {
    // The address it was asked at, not its own `ip`: that is what answered.
    id, address, power,
    name: decodeEntities(String(d.name ?? j.name ?? "Samsung TV")),
    model: String(d.modelName ?? d.model ?? ""),
    mac: typeof d.wifiMac === "string" && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(d.wifiMac) ? d.wifiMac.toUpperCase() : undefined,
    tokenAuth: d.TokenAuthSupport === "true" || d.TokenAuthSupport === true,
    frame: d.FrameTVSupport === "true" || undefined,
  };
}

/** One TV's description, or undefined when nothing (or no TV) answers in `timeoutMs`. */
export async function info(address: string, timeoutMs = 2000, port = 8001): Promise<Found | undefined> {
  try {
    const r = await fetch(`${base(address, port)}/`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? parseInfo(address, await r.json()) : undefined;
  } catch { return undefined; }
}

/** One app's state; undefined when the TV does not have it (404) or does not answer. */
export async function appState(address: string, id: string, timeoutMs = 2000, port = 8001): Promise<AppState | undefined> {
  try {
    const r = await fetch(`${base(address, port)}/applications/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return undefined;
    const j: any = await r.json();
    return { id: String(j.id ?? id), name: decodeEntities(String(j.name ?? id)), running: !!j.running, visible: !!j.visible };
  } catch { return undefined; }
}

/** Launch (POST) or close (DELETE) an app over REST: the fallback when the websocket's `ed.apps.launch` is not there. */
export async function appRequest(address: string, id: string, method: "POST" | "DELETE", timeoutMs = 3000, port = 8001): Promise<void> {
  const r = await fetch(`${base(address, port)}/applications/${encodeURIComponent(id)}`, { method, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(r.status === 404 ? `The TV has no app ${id}` : `The TV answered ${r.status} to ${method === "POST" ? "opening" : "closing"} ${id}`);
}

/**
 * Apps current TVs have under these ids (samsungtvws's and Home
 * Assistant's lists, the ids moved over the years so some have two),
 * checked over REST when `ed.installedApp.get` answers nothing: a 404 is
 * an app this TV does not have.
 */
export const CATALOG: { id: string; name: string }[] = [
  { id: "111299001912", name: "YouTube" },
  { id: "3201907018807", name: "Netflix" }, { id: "11101200001", name: "Netflix" },
  { id: "3201910019365", name: "Prime Video" }, { id: "3201512006785", name: "Prime Video" },
  { id: "3201901017640", name: "Disney+" },
  { id: "3201807016597", name: "Apple TV" },
  { id: "3201606009684", name: "Spotify" },
  { id: "3202301029760", name: "Max" }, { id: "3201601007230", name: "HBO Max" },
  { id: "3201512006963", name: "Plex" },
  { id: "3202203026841", name: "Twitch" },
  { id: "3201707014489", name: "Samsung TV Plus" },
  { id: "3201710015037", name: "Gallery" },
  { id: "org.tizen.browser", name: "Internet" }, { id: "3202010022079", name: "Internet" },
];
