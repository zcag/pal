// Icon tiles and tinted glyphs: the two icon forms that carry a colour.
//
// A tile is what an extension shows as itself, at the root, in the crumb,
// in the settings window and on the store: a rounded square in one of
// twelve brand colours (`TILE_COLORS`, the `--pal-brand-*` tokens, light
// and dark variants) with a white mark, either one Nerd Font glyph or a
// small SVG the extension draws. An extension that is a product (GitHub,
// Spotify) wears that product's logo instead: the Simple Icons path
// (`box` 24) on the brand's own `#rrggbb`, the mark in `fg` where white
// would not read on it (docs/extensions.md, "Icons"). A tinted glyph is a
// row's mark in a colour: a state (an open pull request in green, a merged
// one in violet) or the extension's own colour. A row with no colour of its
// own inherits its palette's tile colour in the UI (the nearest brand colour
// to a logo's), so a plain glyph is never grey next to a tile.
import type { OwnIcon, TileColorName, TileIcon, TintedIcon } from "./protocol.ts";

/** The brand palette: `--pal-brand-<name>` in app/src/ui/tokens.css, each with a light and a dark value. */
export const TILE_COLORS = ["red", "orange", "amber", "green", "teal", "cyan", "blue", "indigo", "violet", "pink", "slate", "ink"] as const satisfies readonly TileColorName[];
export type TileColor = TileColorName;

/** A tile's mark: one Nerd Font glyph (a private-use codepoint), or an SVG path set (`<path d>` data, drawn in a `box` by `box` square, 16 by default, filled white or `fg`). */
export type TileMark = { glyph: string; svg?: undefined } | { svg: string; glyph?: undefined };
/** `badge`: one or two characters drawn in the tile's corner, an instance's mark ("W" for Work). */
export type Tile = TileIcon["tile"];
export type { TileIcon, TintedIcon };

/** An SVG mark is `d` path data only, not markup, and short: it is inlined per row. A product logo is the longest (Grafana's, 3706 bytes). */
export const MAX_TILE_SVG = 5000;
/** The largest viewBox side a `box` may name (Simple Icons draw in 24). */
export const MAX_TILE_BOX = 64;
/** A badge is one or two characters (code points): more would not fit the corner. */
export const MAX_BADGE = 2;

const PRIVATE_USE = /^[\p{Co}]$/u;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A tile's own colours are opaque and spelled out: `#rrggbb`. */
const HEX6 = /^#[0-9a-f]{6}$/i;
/** Path data: moves, lines, curves, arcs and closes with numbers, nothing that could be markup. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;

/**
 * The tile icon for an extension or a palette: `tile("ink", "")`,
 * `tile("green", { svg: "M2 2h5v5H2z" })`, or a product's logo on its own
 * colour, `tile("#1ED760", { svg: SPOTIFY, box: 24, fg: "#000000" })`.
 */
export function tile(bg: TileColor | `#${string}`, mark: string | { svg: string; box?: number; fg?: `#${string}` }): OwnIcon {
  if (typeof mark === "string") return { tile: { glyph: mark, bg } };
  const { svg, box, fg } = mark;
  return { tile: { svg, bg, ...(box !== undefined && { box }), ...(fg && { fg }) } };
}

/**
 * `icon` as an instance wears it: a tile takes `tint` as its colour (when
 * given, and with it the white mark a brand colour carries) and `badge` in
 * its corner; any other icon form comes back as it is, since only a tile
 * has a corner. What the host does to a `multi` extension's tile for a
 * non-default instance.
 */
export function badged<I>(icon: I, mark: { tint?: TileColor; badge?: string }): I | TileIcon {
  if (!isTileIcon(icon)) return icon;
  const { badge, tint } = mark;
  const { fg, ...rest } = icon.tile;
  return { tile: { ...rest, ...(tint ? { bg: tint } : fg && { fg }), ...(badge && { badge }) } as TileIcon["tile"] };
}

/** The brand colour a tile names, or undefined for one in a colour of its own (a product's hex). */
export const tileBrand = (icon: unknown): TileColor | undefined => (isTileIcon(icon) && TILE_COLORS.includes(icon.tile.bg as TileColor) ? (icon.tile.bg as TileColor) : undefined);

/** A glyph in a colour, for a row: `tinted("", "green")`. */
export const tinted = (glyph: string, color: TileColor | `#${string}`): TintedIcon => ({ glyph, color });

export const isTileIcon = (icon: unknown): icon is TileIcon => !!icon && typeof icon === "object" && "tile" in icon && !!(icon as TileIcon).tile && typeof (icon as TileIcon).tile === "object";
export const isTintedIcon = (icon: unknown): icon is TintedIcon => !!icon && typeof icon === "object" && typeof (icon as TintedIcon).glyph === "string" && "color" in icon;

/**
 * What is wrong with an icon, as one line, or undefined when nothing is.
 * Accepts every form: a string (glyph, emoji, hex), `{ app }`, `{ image }`,
 * `{ tile }` and `{ glyph, color }`. `checkPalettes` runs it over the
 * manifest's and every palette's icon; `where` names the field.
 */
export function checkIcon(icon: unknown, where: string): string | undefined {
  if (icon === undefined) return undefined;
  if (typeof icon === "string") return icon.trim() ? undefined : `${where}: icon is empty`;
  if (!icon || typeof icon !== "object") return `${where}: icon must be a string, { app }, { image }, { tile } or { glyph, color }`;
  const o = icon as Record<string, unknown>;
  if (isTileIcon(o)) {
    const t = o.tile as Record<string, unknown>;
    if (!(TILE_COLORS.includes(t.bg as TileColor) || (typeof t.bg === "string" && HEX6.test(t.bg)))) return `${where}: tile bg "${String(t.bg)}" is not one of ${TILE_COLORS.join(", ")} or a #rrggbb colour`;
    if (t.fg !== undefined && !(typeof t.fg === "string" && HEX6.test(t.fg))) return `${where}: tile fg "${String(t.fg)}" is not a #rrggbb colour`;
    if (t.box !== undefined && !(typeof t.box === "number" && t.box > 0 && t.box <= MAX_TILE_BOX)) return `${where}: tile box must be a number above 0 and at most ${MAX_TILE_BOX}, not ${JSON.stringify(t.box)}`;
    const hasGlyph = t.glyph !== undefined, hasSvg = t.svg !== undefined;
    if (hasGlyph === hasSvg) return `${where}: a tile has a glyph or an svg, not ${hasGlyph ? "both" : "neither"}`;
    if (hasGlyph && !(typeof t.glyph === "string" && PRIVATE_USE.test(t.glyph))) return `${where}: tile glyph must be one Nerd Font codepoint`;
    if (hasSvg) {
      if (typeof t.svg !== "string" || !t.svg.trim()) return `${where}: tile svg is empty`;
      if (t.svg.length > MAX_TILE_SVG) return `${where}: tile svg is ${t.svg.length} bytes, at most ${MAX_TILE_SVG}`;
      if (!PATH_DATA.test(t.svg)) return `${where}: tile svg must be path data (the d attribute), not markup`;
    } else if (t.box !== undefined) return `${where}: tile box sizes an svg mark; a glyph has none`;
    if (t.badge !== undefined) {
      const n = typeof t.badge === "string" ? [...t.badge.trim()].length : 0;
      if (n < 1 || n > MAX_BADGE) return `${where}: tile badge must be one or two characters, not ${JSON.stringify(t.badge)}`;
    }
    return undefined;
  }
  if (isTintedIcon(o)) {
    if (!o.glyph.trim()) return `${where}: glyph is empty`;
    const c = o.color;
    if (!(typeof c === "string" && (TILE_COLORS.includes(c as TileColor) || HEX.test(c)))) return `${where}: color "${String(c)}" is not a brand name (${TILE_COLORS.join(", ")}) or a hex colour`;
    return undefined;
  }
  if (typeof o.app === "string") return o.app ? undefined : `${where}: app path is empty`;
  if (typeof o.image === "string") return o.image ? undefined : `${where}: image src is empty`;
  return `${where}: icon must be a string, { app }, { image }, { tile } or { glyph, color }`;
}
