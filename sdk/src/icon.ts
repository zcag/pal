// Icon tiles and tinted glyphs: the two icon forms that carry a colour.
//
// A tile is what an extension shows as itself, at the root, in the crumb,
// in the settings window and on the store: a rounded square in one of
// twelve brand colours (`TILE_COLORS`, the `--pal-brand-*` tokens, light
// and dark variants) with a white mark, either one Nerd Font glyph or a
// small SVG the extension draws. A tinted glyph is a row's mark in a
// colour: a state (an open pull request in green, a merged one in violet)
// or the extension's own colour. A row with no colour of its own inherits
// its palette's tile colour in the UI, so a plain glyph is never grey next
// to a tile.
//
// `protocol.ts` still spells `Icon`, `PaletteBase.icon` and
// `Manifest.icon` without these (another pass owns that file); the
// helpers here return what those fields take so an extension type-checks
// today and nothing moves when the contract admits the objects.
import type { Icon, OwnIcon, TileColorName } from "./protocol.ts";

/** The brand palette: `--pal-brand-<name>` in app/src/ui/tokens.css, each with a light and a dark value. */
export const TILE_COLORS = ["red", "orange", "amber", "green", "teal", "cyan", "blue", "indigo", "violet", "pink", "slate", "ink"] as const satisfies readonly TileColorName[];
export type TileColor = TileColorName;

/** A tile's mark: one Nerd Font glyph (a private-use codepoint), or an SVG path set (`<path d>` data, drawn in a 16 by 16 box, filled white). */
export type TileMark = { glyph: string; svg?: undefined } | { svg: string; glyph?: undefined };
export type Tile = TileMark & { bg: TileColor };
export type TileIcon = { tile: Tile };
/** A glyph in a colour: a brand name, or a hex colour of the extension's own. */
export type TintedIcon = { glyph: string; color: TileColor | `#${string}` };

/** An SVG mark is `d` path data only, not markup, and short: it is inlined per row. */
export const MAX_TILE_SVG = 400;

const PRIVATE_USE = /^[\p{Co}]$/u;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** Path data: moves, lines, curves, arcs and closes with numbers, nothing that could be markup. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;

/** The tile icon for an extension or a palette: `tile("ink", "")` or `tile("green", { svg: "M2 2h5v5H2z" })`. */
export function tile(bg: TileColor, mark: string | { svg: string }): OwnIcon {
  const m: TileMark = typeof mark === "string" ? { glyph: mark } : { svg: mark.svg };
  return { tile: { ...m, bg } };
}

/** A glyph in a colour, for a row: `tinted("", "green")`. */
export function tinted(glyph: string, color: TileColor | `#${string}`): Icon {
  return { glyph, color } as unknown as Icon;
}

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
    if (!TILE_COLORS.includes(t.bg as TileColor)) return `${where}: tile bg "${String(t.bg)}" is not one of ${TILE_COLORS.join(", ")}`;
    const hasGlyph = t.glyph !== undefined, hasSvg = t.svg !== undefined;
    if (hasGlyph === hasSvg) return `${where}: a tile has a glyph or an svg, not ${hasGlyph ? "both" : "neither"}`;
    if (hasGlyph && !(typeof t.glyph === "string" && PRIVATE_USE.test(t.glyph))) return `${where}: tile glyph must be one Nerd Font codepoint`;
    if (hasSvg) {
      if (typeof t.svg !== "string" || !t.svg.trim()) return `${where}: tile svg is empty`;
      if (t.svg.length > MAX_TILE_SVG) return `${where}: tile svg is ${t.svg.length} bytes, at most ${MAX_TILE_SVG}`;
      if (!PATH_DATA.test(t.svg)) return `${where}: tile svg must be path data (the d attribute), not markup`;
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
