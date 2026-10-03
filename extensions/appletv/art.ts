// Pictures the extension draws itself, as SVG data urls an `image` node
// and a row's `{ image }` both take: an app's tile (Apple's own apps from
// marks.ts, any other app as its initial on a colour picked from its
// name, until the App Store's icon arrives), and the cover stand-in while
// nothing better is known. Pure: the fixture and the tests draw the same.
import { APPLE_APPS, SAMPLE_MARKS } from "./marks.ts";

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`)}`;

/** Black or white, whichever reads on `bg` (`#rrggbb`). */
export function inkOn(bg: string): string {
  const n = parseInt(bg.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#000000" : "#ffffff";
}

/** A mark (a path in a 24 box) centred on a rounded square of `bg`, the way tvOS draws an app: the mark at 62 %. */
export function markTile(path: string, bg: string, fg = inkOn(bg)): string {
  return svg(`<rect width="24" height="24" rx="5.4" fill="${bg}"/><g transform="translate(4.56 4.56) scale(0.62)" fill="${fg}"><path d="${path}"/></g>`);
}

/** Calm, saturated colours an app's initial sits on, picked by a hash of its name so the same app keeps its colour. */
const LETTER_BGS = ["#3A6FD8", "#7A4FD6", "#C2417A", "#D9632B", "#2E9E6A", "#1E8FA6", "#B8862A", "#5A5F73"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function letterTile(name: string): string {
  const bg = LETTER_BGS[hash(name) % LETTER_BGS.length];
  const ch = ([...name.trim()][0] ?? "?").toUpperCase().replace(/[<&>"]/g, "");
  return svg(`<rect width="24" height="24" rx="5.4" fill="${bg}"/><text x="12" y="16.6" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="13" font-weight="600" fill="#ffffff">${ch}</text>`);
}

/** Apple's own app, drawn from its mark, or undefined for anything else. */
export function appleApp(bundleId: string): string | undefined {
  const a = APPLE_APPS[bundleId];
  return a ? markTile(a[1], a[2]) : undefined;
}

/** The store screenshots' invented apps: a generic mark on a colour, offline. */
export function sampleApp(bundleId: string): string | undefined {
  const m = SAMPLE_MARKS[bundleId];
  return m ? markTile(m[0], m[1]) : undefined;
}

/** What an app shows before (or without) its App Store icon: Apple's mark, else its initial. */
export const placeholderArt = (bundleId: string, name: string): string => appleApp(bundleId) ?? letterTile(name);

const svgWide = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 24">${body}</svg>`)}`;

/**
 * A 5:3 tile, the shape of a tvOS app icon, for an app without its tvOS
 * picture: Apple's mark (or the sample's) centred on its colour, the
 * square icon centred on a dark tile, else the initial on its colour.
 */
export function wideArt(bundleId: string, name: string, square?: string): string {
  const mark = APPLE_APPS[bundleId] ? { path: APPLE_APPS[bundleId][1], bg: APPLE_APPS[bundleId][2] } : SAMPLE_MARKS[bundleId] ? { path: SAMPLE_MARKS[bundleId][0], bg: SAMPLE_MARKS[bundleId][1] } : undefined;
  if (mark) return svgWide(`<rect width="40" height="24" rx="3" fill="${mark.bg}"/><g transform="translate(12.8 4.8) scale(0.6)" fill="${inkOn(mark.bg)}"><path d="${mark.path}"/></g>`);
  if (square) return svgWide(`<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a42"/><stop offset="1" stop-color="#1c1c21"/></linearGradient><clipPath id="c"><rect x="13" y="5" width="14" height="14" rx="3.2"/></clipPath></defs><rect width="40" height="24" rx="3" fill="url(#g)"/><image href="${square}" xlink:href="${square}" x="13" y="5" width="14" height="14" clip-path="url(#c)"/>`);
  const bg = LETTER_BGS[hash(name) % LETTER_BGS.length];
  const ch = ([...name.trim()][0] ?? "?").toUpperCase().replace(/[<&>"]/g, "");
  return svgWide(`<rect width="40" height="24" rx="3" fill="${bg}"/><text x="20" y="16.4" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif" font-size="12" font-weight="600" fill="#ffffff">${ch}</text>`);
}
