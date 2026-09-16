// A `View` (protocol.ts) checked before it leaves the host, so the UI only
// ever sees a tree it can draw: a node count and depth it can lay out in
// one frame, action ids that cannot shadow the shell's, image sources it
// may load. A node of an unknown type is left in (the UI skips it, so an
// older app still draws the rest); a tree over the limits is an error the
// extension sees, since a silently trimmed board would mislead.
import type { View, ViewNode } from "./protocol.ts";

/** Nodes in one tree: a board is tens, a table hundreds; past this the UI would spend the frame on layout. */
export const MAX_NODES = 2000;
/** Nesting: every level is a flex box; deeper than this is a bug, not a layout. */
export const MAX_DEPTH = 24;
/** The shell's own action ids (`pal:settings`, ...): an extension's must not collide. */
export const SHELL_PREFIX = "pal:";
/** What an `image` node may load: the app's icon scheme, or a picture the extension made itself. */
export const IMAGE_SRC = /^(icon:\/\/|data:image\/)/;

/** Throws with the place and the reason; returns the view untouched. */
export function checkView(v: unknown, where = "view"): View {
  if (!v || typeof v !== "object") throw new Error(`${where}: not an object`);
  const view = v as View;
  if (!view.tree || typeof view.tree !== "object") throw new Error(`${where}: no tree`);
  if (!Array.isArray(view.actions)) throw new Error(`${where}: actions must be an array`);
  const ids = new Set<string>();
  for (const a of view.actions) {
    if (!a || typeof a.id !== "string" || !a.id) throw new Error(`${where}: an action has no id`);
    if (a.id.startsWith(SHELL_PREFIX)) throw new Error(`${where}: action id "${a.id}" is the shell's (${SHELL_PREFIX} is reserved)`);
    if (ids.has(a.id)) throw new Error(`${where}: action id "${a.id}" twice`);
    ids.add(a.id);
  }
  if (view.keys !== undefined && view.keys !== "actions") throw new Error(`${where}: keys must be "actions"`);
  let count = 0;
  const walk = (n: ViewNode, depth: number, path: string) => {
    if (!n || typeof n !== "object" || typeof (n as { type?: unknown }).type !== "string") throw new Error(`${where}: ${path} is not a node`);
    if (++count > MAX_NODES) throw new Error(`${where}: more than ${MAX_NODES} nodes`);
    if (depth > MAX_DEPTH) throw new Error(`${where}: ${path} is nested deeper than ${MAX_DEPTH}`);
    if (n.type === "image" && !IMAGE_SRC.test(n.src)) throw new Error(`${where}: ${path} image src must be icon:// or data:image/`);
    if (n.type === "stack") {
      if (!Array.isArray(n.children)) throw new Error(`${where}: ${path} stack has no children`);
      const keys = new Set<string>();
      n.children.forEach((c, i) => {
        const k = (c as { key?: unknown })?.key;
        if (typeof k === "string") {
          if (keys.has(k)) throw new Error(`${where}: ${path} has two children keyed "${k}"`);
          keys.add(k);
        }
        walk(c, depth + 1, `${path}/${k ?? i}`);
      });
    }
  };
  walk(view.tree, 0, "tree");
  return view;
}
