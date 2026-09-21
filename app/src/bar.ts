/**
 * Bar items on the popover page (`BarPage.tsx`): the wire shapes the shell
 * sends on `pal://bar` (bar/popover.rs) and the menu level built from a
 * `nodes` menu. Mirrors `BarItem`, `BarMenu`, `BarMenuNode` in
 * sdk/src/protocol.ts.
 */
import { iconOf, type Effect } from "./items";
import type { Action, Icon, Item, ViewSpec } from "./ui/types";

export type BarMenuNode =
  | { type: "item"; id: string; title: string; subtitle?: string; icon?: unknown; shortcut?: string; checked?: boolean; disabled?: boolean; style?: "destructive"; action?: string }
  | { type: "section"; title?: string; children: BarMenuNode[] }
  | { type: "submenu"; title: string; icon?: unknown; children: BarMenuNode[] }
  | { type: "separator" };

export type BarMenu = BarMenuNode[] | { palette: string; extension?: string; args?: unknown } | { view: ViewSpec };

export type BarItemWire = { hidden?: boolean; icon?: unknown; title?: string; badge?: number | "dot"; color?: string; urgent?: boolean; stale?: boolean; tooltip?: string; menu?: BarMenu | null };

/** `pal://bar`: the item to show on one level, a peek made key, or the popover going. The sidebar's window gets the same shape with `sidebar: true` and its palette as the menu (sidebar.rs). */
export type BarPayload =
  | { key: string; title: string; engaged: boolean; urgent: boolean; tooltip?: string; menu: BarMenu | null; item: BarItemWire; effect?: Effect; sidebar?: boolean }
  | { engage: true }
  | { hide: true };

export type BarShow = Extract<BarPayload, { key: string }>;

/** The shell's action id on a submenu row: the Launcher pushes the children. */
export const SUBMENU = "pal:submenu";

/** A menu level's rows: `nodes` flattened, a section's title on its children, a submenu as a row whose children wait in `submenus`. Separators are the renderer's and draw nothing. */
export function menuRows(key: string, nodes: BarMenuNode[]): { rows: Item[]; submenus: Record<string, BarMenuNode[]> } {
  const rows: Item[] = [];
  const submenus: Record<string, BarMenuNode[]> = {};
  let n = 0;
  const walk = (list: BarMenuNode[], section?: string) => {
    for (const node of list) {
      if (node.type === "section") { walk(node.children, node.title ?? section); continue; }
      if (node.type === "separator") continue;
      const icon: Icon | undefined = iconOf(node.icon, node.title);
      if (node.type === "submenu") {
        const id = `submenu:${n++}`;
        submenus[id] = node.children;
        rows.push({ id, name: node.title, icon, palette: key, section, accessories: [{ text: "›" }], actions: [{ id: SUBMENU, title: `Open ${node.title}` }] });
        continue;
      }
      const action: Action = { id: node.action ?? node.id, title: node.title, shortcut: node.shortcut, style: node.style };
      rows.push({
        id: node.id,
        name: node.title,
        subtitle: node.subtitle,
        icon,
        palette: key,
        section,
        accessories: [...(node.checked ? [{ text: "✓" }] : []), ...(node.shortcut ? [{ keys: node.shortcut }] : [])],
        actions: [action],
        disabled: node.disabled,
      });
    }
  };
  walk(nodes);
  return { rows, submenus };
}

/** Whether the menu is a node list (a menu level), a palette, or a view. */
export const menuKind = (m: BarMenu | null | undefined): "nodes" | "palette" | "view" | "none" =>
  Array.isArray(m) ? "nodes" : m && typeof m === "object" && "palette" in m ? "palette" : m && typeof m === "object" && "view" in m ? "view" : "none";
