// Pictures the extension draws itself, as data urls an `image` node and a
// row's `{ image }` both take: an app's tile until (or without) the TV's
// own icon (its initial on a colour picked from its name), the TV's icon
// bytes as a data url, and the invented apps of the store screenshots and
// the tests (`SAMPLE_MARKS`, a generic mark on a colour, never a real
// app's logo). Pure: the fixture and the tests draw the same.

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}`;

/** Black or white, whichever reads on `bg` (`#rrggbb`). */
export function inkOn(bg: string): string {
  const n = parseInt(bg.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#000000" : "#ffffff";
}

/** A mark (a path in a 24 box) centred on a rounded square of `bg`, the way Smart Hub draws an app: the mark at 58 %. */
export function markTile(path: string, bg: string, fg = inkOn(bg)): string {
  return svg(`<rect width="24" height="24" rx="5" fill="${bg}"/><g transform="translate(5.04 5.04) scale(0.58)" fill="${fg}"><path d="${path}"/></g>`);
}

/** Calm, saturated colours an app's initial sits on, picked by a hash of its name so the same app keeps its colour. */
const LETTER_BGS = ["#3A6FD8", "#7A4FD6", "#C2417A", "#D9632B", "#2E9E6A", "#1E8FA6", "#B8862A", "#5A5F73"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The colour a well-known app's tile is, so its initial reads as that app before (or without) the TV's own icon: a colour, never a drawn logo. */
const APP_BGS: Record<string, string> = {
  YouTube: "#FF0033", Netflix: "#E50914", "Prime Video": "#00A8E1", "Disney+": "#0E2A8B", Spotify: "#1DB954", "Apple TV": "#000000",
  Max: "#002BE7", "HBO Max": "#5822B4", Plex: "#E5A00D", Twitch: "#9146FF", "Samsung TV Plus": "#1428A0", Internet: "#4B5563", Gallery: "#7A4FD6",
};

export function letterTile(name: string): string {
  const bg = APP_BGS[name] ?? LETTER_BGS[hash(name) % LETTER_BGS.length];
  const ch = ([...name.trim()][0] ?? "?").toUpperCase().replace(/[<&>"]/g, "");
  return svg(`<rect width="24" height="24" rx="5" fill="${bg}"/><text x="12" y="16.6" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="13" font-weight="600" fill="#ffffff">${ch}</text>`);
}

/** The TV's icon bytes as a data url: PNG or JPEG by their magic, anything else nothing. */
export function iconData(b: Uint8Array | null | undefined): string | undefined {
  if (!b?.length) return undefined;
  const type = b[0] === 0x89 && b[1] === 0x50 ? "png" : b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : undefined;
  return type ? `data:image/${type};base64,${Buffer.from(b).toString("base64")}` : undefined;
}

/** The invented apps of the store screenshots and the tests: a generic mark (Material Design, Apache 2.0) on a colour, offline. */
export const SAMPLE_MARKS: Record<string, [string, string]> = {
  "3201900000001": ["m20.84 2.18l-3.93.78l2.74 3.54l1.97-.4zm-6.87 1.36L12 3.93l2.75 3.53l1.96-.39zm-4.9.96l-1.97.41l2.75 3.53l1.96-.39zm-4.91 1l-.98.19a2 2 0 0 0-1.57 2.35L2 10l4.9-.97zM2 10v10a2 2 0 0 0 2 2h16c1.11 0 2-.89 2-2V10z", "#E5484D"],
  "3201900000002": ["M19 3H5c-1.11 0-2 .89-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5a2 2 0 0 0-2-2m-9 13V8l5 4", "#3E63DD"],
  "3201900000003": ["M16 9V7h-4v5.5c-.42-.31-.93-.5-1.5-.5A2.5 2.5 0 0 0 8 14.5a2.5 2.5 0 0 0 2.5 2.5a2.5 2.5 0 0 0 2.5-2.5V9zm-4-7a10 10 0 0 1 10 10a10 10 0 0 1-10 10A10 10 0 0 1 2 12A10 10 0 0 1 12 2", "#12A594"],
  "3201900000004": ["M18 9h-2V7h2m0 6h-2v-2h2m0 6h-2v-2h2M8 9H6V7h2m0 6H6v-2h2m0 6H6v-2h2M18 3v2h-2V3H8v2H6V3H4v18h2v-2h2v2h8v-2h2v2h2V3z", "#D6409F"],
  "3201900000005": ["M7 6h10a6 6 0 0 1 6 6a6 6 0 0 1-6 6c-1.78 0-3.37-.77-4.47-2h-1.06c-1.1 1.23-2.69 2-4.47 2a6 6 0 0 1-6-6a6 6 0 0 1 6-6M6 9v2H4v2h2v2h2v-2h2v-2H8V9zm9.5 3a1.5 1.5 0 0 0-1.5 1.5a1.5 1.5 0 0 0 1.5 1.5a1.5 1.5 0 0 0 1.5-1.5a1.5 1.5 0 0 0-1.5-1.5m3-3a1.5 1.5 0 0 0-1.5 1.5a1.5 1.5 0 0 0 1.5 1.5a1.5 1.5 0 0 0 1.5-1.5A1.5 1.5 0 0 0 18.5 9", "#F76B15"],
  "3201900000006": ["M14.19 14.19L6 18l3.81-8.19L18 6m-6-4A10 10 0 0 0 2 12a10 10 0 0 0 10 10a10 10 0 0 0 10-10A10 10 0 0 0 12 2m0 8.9a1.1 1.1 0 0 0-1.1 1.1a1.1 1.1 0 0 0 1.1 1.1a1.1 1.1 0 0 0 1.1-1.1a1.1 1.1 0 0 0-1.1-1.1", "#0090FF"],
  "3201900000007": ["M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66l.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8", "#30A46C"],
  "3201900000008": ["m17.75 4.09l-2.53 1.94l.91 3.06l-2.63-1.81l-2.63 1.81l.91-3.06l-2.53-1.94L12.44 4l1.06-3l1.06 3zm3.5 6.91l-1.64 1.25l.59 1.98l-1.7-1.17l-1.7 1.17l.59-1.98L15.75 11l2.06-.05L18.5 9l.69 1.95zm-2.28 4.95c.83-.08 1.72 1.1 1.19 1.85c-.32.45-.66.87-1.08 1.27C15.17 23 8.84 23 4.94 19.07c-3.91-3.9-3.91-10.24 0-14.14c.4-.4.82-.76 1.27-1.08c.75-.53 1.93.36 1.85 1.19c-.27 2.86.69 5.83 2.89 8.02a9.96 9.96 0 0 0 8.02 2.89m-1.64 2.02a12.08 12.08 0 0 1-7.8-3.47c-2.17-2.19-3.33-5-3.49-7.82c-2.81 3.14-2.7 7.96.31 10.98c3.02 3.01 7.84 3.12 10.98.31", "#5B5BD6"],
};

/** A store-shot app's tile, or undefined for anything else. */
export function sampleApp(id: string): string | undefined {
  const m = SAMPLE_MARKS[id];
  return m ? markTile(m[0], m[1]) : undefined;
}
