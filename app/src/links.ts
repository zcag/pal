/**
 * The `pal://` link for what is on screen (docs/design/links.md, "How the
 * app generates links"): the "Copy deep link" shell action calls `linkFor`
 * with the level and the item under the cursor. The page writes `pal://`;
 * the core swaps in the bundle's scheme when it differs (deeplink.rs
 * `link_copy`). Pure, so the vitest covers every shape.
 */
import type { Level } from "./Launcher";
import { PALETTES, WELCOME } from "./items";
import type { Item } from "./ui/types";

export const SCHEME = "pal";
/** The synthetic source of pal's own rows (`commands::source` in commands.rs): a row's link is `commands/<id>`. */
export const COMMANDS = "pal/commands";

const enc = (s: string) => encodeURIComponent(s);
/** `k=v&k=v` from pairs, the empty ones dropped; empty for none. */
const query = (pairs: [string, string | undefined][]) => {
  const q = pairs.filter((p): p is [string, string] => !!p[1]).map(([k, v]) => `${enc(k)}=${enc(v)}`);
  return q.length ? `?${q.join("&")}` : "";
};
/** `ext/palette` as two encoded path parts. */
const paletteOf = (key: string) => key.split("/").map(enc).join("/");
const argsOf = (args: unknown) => (args === undefined || args === null ? undefined : JSON.stringify(args));

/**
 * The link for `item` at `level` (the item under the cursor, none when
 * nothing matched), with the query typed there. `undefined` where nothing
 * is addressable (a welcome tip, the root with no item, a menu level's
 * submenu row).
 */
export function linkFor(level: Level, item: Item | undefined, queryText = ""): string | undefined {
  const base = `${SCHEME}://`;
  if (level.kind === "form") {
    const from = level.from;
    if (!from.palette || from.palette === PALETTES || from.palette === WELCOME) return;
    return `${base}form/${paletteOf(from.palette)}/${enc(from.id)}${query([["action", level.action], ["args", argsOf(level.args)]])}`;
  }
  if (level.kind === "menu") {
    if (!item || item.id.startsWith("pal:")) return;
    return `${base}bar/${paletteOf(level.key)}${query([["action", item.id]])}`;
  }
  if (item) {
    if (item.palette === WELCOME) return;
    if (item.palette === PALETTES) return `${base}open/${paletteOf(item.id)}`;
    if (item.palette === COMMANDS) return `${base}commands/${enc(item.id)}`;
    if (!item.palette) return;
    const args = level.kind === "palette" || level.kind === "view" ? level.args : undefined;
    return `${base}run/${paletteOf(item.palette)}/${enc(item.id)}${query([["args", argsOf(args)]])}`;
  }
  if (level.kind === "palette" || level.kind === "view") {
    // A drill-in (args) has no open link: its rows are the parent's business.
    if (level.palette === PALETTES || level.palette === WELCOME || !level.palette.includes("/") || level.args !== undefined) return;
    return `${base}open/${paletteOf(level.palette)}${query([["q", queryText || undefined]])}`;
  }
  return;
}
