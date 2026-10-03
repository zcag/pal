// UPnP on :9197, the TV's DLNA renderer: RenderingControl for the volume
// and mute (the websocket has only volume keys, no level), AVTransport for
// what a DLNA sender plays on it. SOAP over plain http, no token. Checked
// on a 2024 QE75QN85D: GetVolume answers `<CurrentVolume>10`.
import type { Media } from "../types.ts";

export const RC = "urn:schemas-upnp-org:service:RenderingControl:1";
export const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
const PATH: Record<string, string> = { [RC]: "/upnp/control/RenderingControl1", [AVT]: "/upnp/control/AVTransport1" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The SOAP envelope of one action; `InstanceID` 0 first, as every renderer wants. */
export function envelope(service: string, action: string, args: Record<string, string | number> = {}): string {
  const body = Object.entries({ InstanceID: 0, ...args }).map(([k, v]) => `<${k}>${esc(String(v))}</${k}>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}">${body}</u:${action}></s:Body></s:Envelope>`;
}

/** The out-arguments of a response, by name (no namespaces in a renderer's answer worth keeping). */
export function fields(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const resp = /<(?:\w+:)?\w+Response[^>]*>([\s\S]*?)<\/(?:\w+:)?\w+Response>/.exec(xml)?.[1] ?? "";
  for (const m of resp.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) out[m[1]] = unesc(m[2].trim());
  return out;
}

/** The fault a renderer answers with (`errorDescription`, else the code), or undefined. */
export const fault = (xml: string) => /<errorDescription>([^<]*)/.exec(xml)?.[1] ?? /<errorCode>([^<]*)/.exec(xml)?.[1];

export async function soap(address: string, service: string, action: string, args?: Record<string, string | number>, timeoutMs = 2000, port = 9197): Promise<Record<string, string>> {
  const r = await fetch(`http://${address}:${port}${PATH[service]}`, {
    method: "POST", body: envelope(service, action, args), signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"` },
  });
  const xml = await r.text();
  if (!r.ok) throw new Error(`The TV refused ${action}: ${fault(xml) ?? r.status}`);
  return fields(xml);
}

export const getVolume = async (address: string) => Number((await soap(address, RC, "GetVolume", { Channel: "Master" })).CurrentVolume);
export const setVolume = (address: string, level: number) => soap(address, RC, "SetVolume", { Channel: "Master", DesiredVolume: Math.round(Math.min(100, Math.max(0, level))) }).then(() => {});
export const getMute = async (address: string) => (await soap(address, RC, "GetMute", { Channel: "Master" })).CurrentMute === "1";
export const setMute = (address: string, muted: boolean) => soap(address, RC, "SetMute", { Channel: "Master", DesiredMute: muted ? 1 : 0 }).then(() => {});

/** `01:02:03` → 3723 s; `NOT_IMPLEMENTED` and empty → undefined. */
export const hms = (s?: string) => { const m = /^(\d+):(\d\d):(\d\d)(?:\.\d+)?$/.exec(s ?? ""); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : undefined; };

const STATES: Record<string, Media["state"]> = { PLAYING: "playing", PAUSED_PLAYBACK: "paused", STOPPED: "stopped", TRANSITIONING: "transitioning", NO_MEDIA_PRESENT: "idle" };

/** What a DLNA sender plays on the TV, from GetTransportInfo + GetPositionInfo; undefined when nothing does. */
export function mediaOf(transport: Record<string, string>, position: Record<string, string>, at: number): Media | undefined {
  const state = STATES[transport.CurrentTransportState] ?? "idle";
  const url = position.TrackURI || undefined;
  if (state === "idle" || (state === "stopped" && !url)) return undefined;
  const title = /<dc:title>([^<]*)<\/dc:title>/.exec(position.TrackMetaData ?? "")?.[1];
  return { state, at, url, title: title ? unesc(title) : undefined, position: hms(position.RelTime), duration: hms(position.TrackDuration) };
}

export async function media(address: string, at = Date.now()): Promise<Media | undefined> {
  const [t, p] = await Promise.all([soap(address, AVT, "GetTransportInfo"), soap(address, AVT, "GetPositionInfo")]);
  return mediaOf(t, p, at);
}
