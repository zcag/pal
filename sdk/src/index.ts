// `@zcag/pal`: what an extension imports. The capability objects and
// helpers from api.ts, the contract's types from protocol.ts, the view,
// form and bar item checkers, the icon table, the tile and tint helpers,
// and the helpers the bundled extensions share (rows.ts, text.ts, exec.ts,
// token.ts, png.ts, image.ts; `terminal`, `files`, `md`, `colors` and
// `tabs` as namespaces). `runtime.ts` is the host's side and is not
// re-exported here (`@zcag/pal/runtime`).
import type { ExtensionFor, ManifestLike } from "./manifest.ts";
import type { Extension } from "./protocol.ts";

export * from "./api.ts";
export type * from "./protocol.ts";
export { checkBarItem, checkEffect, checkForm, checkView, shortcutsOf, HEX_COLOR, IMAGE_SRC, MAX_BAR_MENU_NODES, MAX_BAR_SEGMENTS, MAX_BAR_SUBMENU_DEPTH, MAX_BAR_TITLE, MAX_DEPTH, MAX_NODES, SHELL_PREFIX } from "./view.ts";
export { checkLinkEffect, checkLinkParams, checkLinks, checkPalettes, instanceTitle, stripInstance, isViewPalette, kindOf, LINK_EFFECT_REFUSED, LINK_PARAM_TYPES, PALETTE_KINDS, paletteMeta, VIEW_TRIGGERS } from "./manifest.ts";
export type { ExtensionFor, ManifestLike, PaletteCheck, PaletteFor, PaletteKeys } from "./manifest.ts";
export { xdg, XDG_ICONS } from "./icons.ts";
export { expand, formatDate, hasPlaceholders, isoDate, isoTime, offsetDate, FORMAT_TOKENS, PLACEHOLDERS } from "./placeholders.ts";
export type { Sources as PlaceholderSources } from "./placeholders.ts";
export { badged, checkIcon, isTileIcon, isTintedIcon, tile, tinted, MAX_BADGE, MAX_TILE_SVG, TILE_COLORS } from "./icon.ts";
export type { Tile, TileColor, TileIcon, TileMark, TintedIcon } from "./icon.ts";
export { column, failed, HINT_GLYPH, hint, keycap, keyHint, POPOVER_W, row, text, toast } from "./rows.ts";
export { bytes, errorMessage, mdEscape, oneLine, slug, truncate } from "./text.ts";
export { EXEC_MS, exec, run } from "./exec.ts";
export type { Exec, ExecOptions } from "./exec.ts";
export { BARE_TOKEN_TTL, EXPIRY_MARGIN, mintToken, parseToken, TOKEN_CMD_MS, TokenError } from "./token.ts";
export type { Token } from "./token.ts";
export { pngSize } from "./png.ts";
export { clock, dayName, dayNameYear, isoDay, now, when } from "./clock.ts";
export { forgetImages, IMAGE_MISS_TTL, IMAGE_MS, imageData, MAX_IMAGE } from "./image.ts";
export * as terminal from "./terminal.ts";
export * as files from "./files.ts";
export * as md from "./md.ts";
export * as colors from "./color.ts";
export * as tabs from "./tabs.ts";

/**
 * Type-checks an extension's default export where it is written, keeping
 * the literal types of the palettes and bar items: `export default
 * defineExtension({ palettes: { ... }, bar: { ... } })`. The same as
 * `satisfies Extension`, as a name an editor can complete.
 *
 * With the manifest first, `defineExtension(manifest, { palettes: { ... } })`,
 * the palettes are checked against what `pal.json` declares
 * (`ExtensionFor`, manifest.ts): a declared key left out or an undeclared
 * one written is a type error, and a `kind` the type pins down (an inline
 * manifest; a JSON import widens it to `string`) demands the matching
 * shape. Import it as `import manifest from "./pal.json" with { type:
 * "json" }`. Either way it does nothing at runtime: the host runs
 * `checkPalettes` on every load.
 */
export function defineExtension<T extends Extension>(extension: T): T;
export function defineExtension<const M extends ManifestLike>(manifest: M, extension: ExtensionFor<M>): ExtensionFor<M>;
export function defineExtension(a: Extension | ManifestLike, b?: Extension): Extension {
  return b ?? (a as Extension);
}
