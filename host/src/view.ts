// A `View` (protocol.ts) checked before it leaves the host, so the UI only
// ever sees a tree it can draw (and a `Form`, at the end, likewise): a node count and depth it can lay out in
// one frame, action ids that cannot shadow the shell's, image sources it
// may load. A node of an unknown type is left in (the UI skips it, so an
// older app still draws the rest); a tree over the limits is an error the
// extension sees, since a silently trimmed board would mislead.
import type { Form, View, ViewNode } from "./protocol.ts";

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

/** Field kinds the UI draws; anything else is refused, since an undrawn field would submit nothing. */
const FIELD_KINDS = new Set(["text", "textarea", "password", "select", "checkbox"]);

/**
 * A `Form` (protocol.ts) checked like a view: fields the UI can draw with
 * unique ids, a submit id that is not the shell's, `errors` keyed by
 * field. Throws with the place and the reason; returns the form untouched.
 */
export function checkForm(f: unknown, where = "form"): Form {
  if (!f || typeof f !== "object") throw new Error(`${where}: not an object`);
  const form = f as Form;
  if (typeof form.title !== "string") throw new Error(`${where}: no title`);
  if (!Array.isArray(form.fields) || form.fields.length === 0) throw new Error(`${where}: no fields`);
  const ids = new Set<string>();
  form.fields.forEach((x, i) => {
    if (!x || typeof x.id !== "string" || !x.id) throw new Error(`${where}: field ${i} has no id`);
    if (!FIELD_KINDS.has(x.kind)) throw new Error(`${where}: field "${x.id}" has an unknown kind "${x.kind}"`);
    if (x.kind === "select" && !Array.isArray(x.options)) throw new Error(`${where}: field "${x.id}" needs options`);
    if (ids.has(x.id)) throw new Error(`${where}: field id "${x.id}" twice`);
    ids.add(x.id);
  });
  if (!form.submit || typeof form.submit.id !== "string" || !form.submit.id) throw new Error(`${where}: submit has no id`);
  if (form.submit.id.startsWith(SHELL_PREFIX)) throw new Error(`${where}: submit id "${form.submit.id}" is the shell's (${SHELL_PREFIX} is reserved)`);
  if (form.errors !== undefined) {
    if (!form.errors || typeof form.errors !== "object") throw new Error(`${where}: errors must be an object`);
    for (const k of Object.keys(form.errors)) if (!ids.has(k)) throw new Error(`${where}: an error for "${k}", which is no field`);
  }
  return form;
}
