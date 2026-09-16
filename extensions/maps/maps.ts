// Maps as data: the query grammar (`go: coffee`, `home > work`,
// `istanbul to ankara`), the saved places setting, and the urls Google
// Maps and Apple Maps open without any key. Pure, so the tests need no
// host.

export type App = "google" | "apple";
export type Mode = "driving" | "transit" | "walking" | "cycling";
export const MODES: { id: Mode; title: string }[] = [
  { id: "driving", title: "Driving" },
  { id: "transit", title: "Transit" },
  { id: "walking", title: "Walking" },
  { id: "cycling", title: "Cycling" },
];

/** `maps:`, `map:` or `go:` before a query, at the root and inside. */
const PREFIX = /^\s*(?:maps?|go)\s*:\s*/i;
/** `A > B`, `A -> B`: a route with both ends. */
const ARROW = /^(.*?)\s*(?:->|>|→)\s*(.+)$/;
/** `A to B` too, but only when an end is home, work, here or a saved place: "things to do in Moda" is a search. */
const TO = /^(.+?)\s+to\s+(.+)$/i;
const KNOWN_ENDS = ["home", "work", "here", "me", "current", "current location"];

export type Query = { text: string; from?: string; to?: string; prefixed: boolean };

/** What was typed, the prefix stripped, a route split into its ends; `names` are the saved places, which make `to` a route. */
export function parse(query: string, names: string[] = []): Query {
  const prefixed = PREFIX.test(query);
  const text = query.replace(PREFIX, "").trim();
  const known = new Set([...KNOWN_ENDS, ...names.map((n) => n.toLowerCase())]);
  const arrow = ARROW.exec(text);
  const m = arrow ?? TO.exec(text);
  if (!m) return { text, prefixed };
  const from = m[1].trim(), to = m[2].trim();
  if (from && to && (arrow || known.has(from.toLowerCase()) || known.has(to.toLowerCase()))) return { text, from, to, prefixed };
  return { text, prefixed };
}

/** The root's inline `match`: a prefix with text after it. */
export const matches = (query: string): boolean => PREFIX.test(query) && parse(query).text.length > 0;

export type Place = { name: string; address: string };

/** The `places` setting: `Name = address` per line; a line without `=` is both. */
export function parsePlaces(lines: string[] | undefined): Place[] {
  return (lines ?? []).map((l) => {
    const i = l.indexOf("=");
    const name = (i >= 0 ? l.slice(0, i) : l).trim(), address = (i >= 0 ? l.slice(i + 1) : l).trim();
    return { name: name || address, address: address || name };
  }).filter((p) => p.address);
}

/** `home`, `work`, `here` as typed in a route end resolve to the settings' addresses or the current location (`undefined`). */
export function resolveEnd(end: string, s: { home?: string; work?: string }): string | undefined {
  const e = end.trim().toLowerCase();
  if (e === "here" || e === "me" || e === "current" || e === "current location") return undefined;
  if (e === "home" && s.home?.trim()) return s.home.trim();
  if (e === "work" && s.work?.trim()) return s.work.trim();
  return end.trim();
}

const enc = encodeURIComponent;
const APPLE_MODE: Record<Mode, string> = { driving: "d", transit: "r", walking: "w", cycling: "c" };
const GOOGLE_MODE: Record<Mode, string> = { driving: "driving", transit: "transit", walking: "walking", cycling: "bicycling" };

/** A place search; `placeId` pins a Places API prediction to its place on Google. */
export function searchUrl(query: string, app: App, placeId?: string): string {
  if (app === "apple") return `maps://?q=${enc(query)}`;
  return `https://www.google.com/maps/search/?api=1&query=${enc(query)}${placeId ? `&query_place_id=${enc(placeId)}` : ""}`;
}

/** Directions; `origin` absent is the current location on both apps. */
export function directionsUrl(destination: string, origin: string | undefined, mode: Mode, app: App): string {
  if (app === "apple") return `maps://?daddr=${enc(destination)}${origin ? `&saddr=${enc(origin)}` : ""}&dirflg=${APPLE_MODE[mode]}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${enc(destination)}${origin ? `&origin=${enc(origin)}` : ""}&travelmode=${GOOGLE_MODE[mode]}`;
}

/** The same url on the web, for Copy link: Apple's `maps://` is only good on a Mac, so the copy is the Google one. */
export const webUrl = (url: string): string => (url.startsWith("maps://") ? url.replace(/^maps:\/\/\?/, "https://maps.apple.com/?") : url);

export const APP_NAME: Record<App, string> = { google: "Google Maps", apple: "Apple Maps" };
