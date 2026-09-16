// `@zcag/pal`: what an extension imports. The capability objects and
// helpers from api.ts, the contract's types from protocol.ts, the view,
// form and bar item checkers, the icon table, the tile and tint helpers. `runtime.ts` is the host's side and is not
// re-exported here (`@zcag/pal/runtime`).
import type { ExtensionFor, ManifestLike } from "./manifest.ts";
import type { Extension } from "./protocol.ts";

export * from "./api.ts";
export type * from "./protocol.ts";
export { checkBarItem, checkEffect, checkForm, checkView, shortcutsOf, HEX_COLOR, IMAGE_SRC, MAX_BAR_MENU_NODES, MAX_BAR_SEGMENTS, MAX_BAR_SUBMENU_DEPTH, MAX_BAR_TITLE, MAX_DEPTH, MAX_NODES, SHELL_PREFIX } from "./view.ts";
export { checkLinkEffect, checkLinkParams, checkLinks, checkPalettes, isViewPalette, kindOf, LINK_EFFECT_REFUSED, LINK_PARAM_TYPES, PALETTE_KINDS, paletteMeta } from "./manifest.ts";
export type { ExtensionFor, ManifestLike, PaletteCheck, PaletteFor, PaletteKeys } from "./manifest.ts";
export { xdg, XDG_ICONS } from "./icons.ts";
export { checkIcon, isTileIcon, isTintedIcon, tile, tinted, MAX_TILE_SVG, TILE_COLORS } from "./icon.ts";
export type { Tile, TileColor, TileIcon, TileMark, TintedIcon } from "./icon.ts";

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
