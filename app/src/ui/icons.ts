/**
 * URLs for the app's `icon://` scheme, which serves size-normalised PNGs of
 * an application's artwork or a site's favicon (app/src-tauri/src/icon.rs).
 * The scheme's base differs per platform (`icon://localhost/` on macOS and
 * Linux, `http://icon.localhost/` on Windows); Tauri's own `convertFileSrc`
 * knows which, so the base is taken from it when the page runs in Tauri.
 * Outside Tauri (the gallery in a plain browser) the requests just fail
 * and the icon falls back.
 */
const base: string = (() => {
  const i = window.__TAURI_INTERNALS__;
  try {
    return i?.convertFileSrc?.("", "icon") ?? "icon://localhost/";
  } catch {
    return "icon://localhost/";
  }
})();

export const appIconUrl = (path: string, size: number) => `${base}app?path=${encodeURIComponent(path)}&size=${size}`;
export const faviconUrl = (url: string, size: number) => `${base}favicon?url=${encodeURIComponent(url)}&size=${size}`;
/** One of an installed extension's store screenshots, as is (`<root>/<ext>/screenshots/<file>`). */
export const screenshotUrl = (ext: string, file: string) => `${base}shot?ext=${encodeURIComponent(ext)}&file=${encodeURIComponent(file)}&size=0`;

/**
 * One private-use codepoint (U+E000-F8FF, U+F0000-FFFFD): a Nerd Font glyph,
 * drawn from the bundled symbols font (fonts.css). Anything longer, or with a
 * variation selector, is text or emoji.
 */
export const isSymbol = (s: string) => /^[\p{Co}]$/u.test(s);

/** The brand palette an icon tile or a tinted glyph names: `--pal-brand-<name>` in tokens.css, the same list as `TILE_COLORS` in sdk/src/icon.ts. */
export const BRAND = ["red", "orange", "amber", "green", "teal", "cyan", "blue", "indigo", "violet", "pink", "slate", "ink"] as const;
export const isBrand = (s: unknown): s is (typeof BRAND)[number] => typeof s === "string" && (BRAND as readonly string[]).includes(s);

/** The light values of the brand colours (the fallbacks in icons.css), what `nearestBrand` measures a hex against. */
const BRAND_HEX: Record<(typeof BRAND)[number], string> = { red: "#e5484d", orange: "#ec6a2c", amber: "#d98c0a", green: "#2e9e5f", teal: "#139c8f", cyan: "#0e8fbe", blue: "#2f74e0", indigo: "#5854d6", violet: "#8a4fd0", pink: "#d23f9c", slate: "#5f6b7c", ink: "#24292f" };

/** Hue in degrees, saturation and lightness in 0..1 of `#rrggbb`. */
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}

/**
 * The brand colour closest to a product's own `#rrggbb` (a logo tile's
 * `bg`): the nearest hue among the ten chromatic ones, or `ink` / `slate`
 * for a grey (a dark one or not). What a logo tile's rows are tinted in,
 * since a brand colour has a dark-panel variant and a product's hex does not.
 */
export function nearestBrand(hex: string): (typeof BRAND)[number] {
  const [h, s, l] = hsl(hex);
  if (s < 0.15 || l < 0.12) return l < 0.3 ? "ink" : "slate";
  const dist = (b: (typeof BRAND)[number]) => { const d = Math.abs(hsl(BRAND_HEX[b])[0] - h); return Math.min(d, 360 - d); };
  return BRAND.filter((b) => b !== "slate" && b !== "ink").reduce((best, b) => (dist(b) < dist(best) ? b : best));
}
