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
