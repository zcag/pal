// `@zcag/pal`: what an extension imports. The capability objects and
// helpers from api.ts, the contract's types from protocol.ts, the view,
// form and bar item checkers, the icon table. `runtime.ts` is the host's side and is not
// re-exported here (`@zcag/pal/runtime`).
import type { Extension } from "./protocol.ts";

export * from "./api.ts";
export type * from "./protocol.ts";
export { checkBarItem, checkEffect, checkForm, checkView, IMAGE_SRC, MAX_BAR_MENU_NODES, MAX_BAR_SEGMENTS, MAX_BAR_SUBMENU_DEPTH, MAX_BAR_TITLE, MAX_DEPTH, MAX_NODES, SHELL_PREFIX } from "./view.ts";
export { xdg, XDG_ICONS } from "./icons.ts";

/**
 * Type-checks an extension's default export where it is written, keeping
 * the literal types of the palettes and bar items: `export default
 * defineExtension({ palettes: { ... }, bar: { ... } })`. The same as `satisfies Extension`, as a name an
 * editor can complete; it does nothing at runtime.
 */
export const defineExtension = <T extends Extension>(extension: T): T => extension;
