// A `View` (protocol.ts) checked before it leaves the host, so the UI only
// ever sees a tree it can draw (a `Form` and a `BarItem` likewise): a node
// count and depth it can lay out in one frame, action ids that cannot
// shadow the shell's, image sources it may load. A node of an unknown type
// is left in (the UI skips it, so an older app still draws the rest); a
// tree over the limits is an error the extension sees, since a silently
// trimmed board would mislead. The host runs these on every answer; an
// extension's own tests can run them too (`checkView(render(state))`).
import type { BarItem, BarMenu, BarMenuNode, Form, View, ViewNode } from "./protocol.ts";

/** Nodes in one tree: a board is tens, a table hundreds; past this the UI would spend the frame on layout. */
export const MAX_NODES = 2000;
/** Nesting: every level is a flex box; deeper than this is a bug, not a layout. */
export const MAX_DEPTH = 24;
/** The shell's own action ids (`pal:settings`, ...): an extension's must not collide. */
export const SHELL_PREFIX = "pal:";
/** What an `image` node may load: the app's icon scheme, or a picture the extension made itself. */
export const IMAGE_SRC = /^(icon:\/\/|data:image\/)/;

const TAG_COLORS = new Set(["grey", "blue", "green", "amber", "red", "violet", "pink", "teal"]);
const TILE_COLORS = new Set([...TAG_COLORS, "neutral", "accent"]);
const TILE_FILLS = new Set(["solid", "soft", "outline"]);
const SURFACES = new Set(["sunken", "elevated"]);
const ENTERS = new Set(["fade", "slide-up", "slide-down", "slide-left", "slide-right", "flip", "pop"]);
const EXITS = new Set(["fade", "none"]);
const ALIGNS = new Set(["start", "center", "end"]);

const isPx = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
/** `Action.shortcut` as a list: one string, an array of them, or none. */
export const shortcutsOf = (a: { shortcut?: string | string[] }): string[] => (a.shortcut === undefined ? [] : Array.isArray(a.shortcut) ? a.shortcut : [a.shortcut]);

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
    if (a.shortcut !== undefined && (!shortcutsOf(a).length || !shortcutsOf(a).every((k) => typeof k === "string" && k))) throw new Error(`${where}: action "${a.id}" shortcut must be a key or a list of keys`);
    if (a.hidden !== undefined && a.hidden !== true) throw new Error(`${where}: action "${a.id}" hidden must be true`);
    if (a.hidden && !shortcutsOf(a).length) throw new Error(`${where}: action "${a.id}" is hidden and has no shortcut, so nothing could run it`);
  }
  if (view.keys !== undefined && view.keys !== "actions") throw new Error(`${where}: keys must be "actions"`);
  let count = 0;
  const moving = new Set<string>();
  const walk = (n: ViewNode, depth: number, path: string) => {
    if (!n || typeof n !== "object" || typeof (n as { type?: unknown }).type !== "string") throw new Error(`${where}: ${path} is not a node`);
    if (++count > MAX_NODES) throw new Error(`${where}: more than ${MAX_NODES} nodes`);
    if (depth > MAX_DEPTH) throw new Error(`${where}: ${path} is nested deeper than ${MAX_DEPTH}`);
    const t = n.transition;
    if (t !== undefined) {
      if (!t || typeof t !== "object") throw new Error(`${where}: ${path} transition must be an object`);
      if (t.enter !== undefined && !ENTERS.has(t.enter)) throw new Error(`${where}: ${path} has an unknown enter "${t.enter}"`);
      if (t.exit !== undefined && !EXITS.has(t.exit)) throw new Error(`${where}: ${path} has an unknown exit "${t.exit}"`);
      if (t.delay !== undefined && !isPx(t.delay)) throw new Error(`${where}: ${path} delay must be a number of steps`);
      if (t.move !== undefined && t.move !== true) throw new Error(`${where}: ${path} move must be true`);
      if (t.move) {
        if (typeof n.key !== "string") throw new Error(`${where}: ${path} moves but has no key`);
        if (moving.has(n.key)) throw new Error(`${where}: ${path} moves but its key "${n.key}" is used elsewhere in the tree (a move key must be unique in the whole tree)`);
        moving.add(n.key);
      }
    }
    if (n.type === "image" && !IMAGE_SRC.test(n.src)) throw new Error(`${where}: ${path} image src must be icon:// or data:image/`);
    if (n.type === "tile") {
      if (!isPx(n.width) || !isPx(n.height)) throw new Error(`${where}: ${path} tile needs width and height in px`);
      if (n.color !== undefined && !TILE_COLORS.has(n.color)) throw new Error(`${where}: ${path} tile has an unknown color "${n.color}"`);
      if (n.fill !== undefined && !TILE_FILLS.has(n.fill)) throw new Error(`${where}: ${path} tile has an unknown fill "${n.fill}"`);
    }
    if (n.type === "text") {
      if (n.width !== undefined && !isPx(n.width)) throw new Error(`${where}: ${path} text width must be px`);
      if (n.minWidth !== undefined && !isPx(n.minWidth)) throw new Error(`${where}: ${path} text minWidth must be px`);
      if (n.align !== undefined && !ALIGNS.has(n.align)) throw new Error(`${where}: ${path} text has an unknown align "${n.align}"`);
    }
    if (n.type === "progress" && n.color !== undefined && !TAG_COLORS.has(n.color)) throw new Error(`${where}: ${path} progress has an unknown color "${n.color}"`);
    if (n.type === "stack") {
      if (!Array.isArray(n.children)) throw new Error(`${where}: ${path} stack has no children`);
      if (n.surface !== undefined && !SURFACES.has(n.surface)) throw new Error(`${where}: ${path} stack has an unknown surface "${n.surface}"`);
      if (n.radius !== undefined && typeof n.radius !== "boolean") throw new Error(`${where}: ${path} stack radius must be a boolean`);
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

/** An `Effect` answered by `pick`, `onAction` or `onOpen`: a `view` or `form` in it is checked like a direct answer, since the UI draws it the same way. Returns the effect untouched. */
export function checkEffect<T>(r: T, where: string): T {
  if (r && typeof r === "object") {
    const e = r as { view?: unknown; form?: unknown };
    if (e.view !== undefined) checkView(e.view, `${where} view`);
    if (e.form !== undefined) checkForm(e.form, `${where} form`);
  }
  return r;
}

// ---- bar items --------------------------------------------------------------

/** `BarItem.title` at most this long: the menu bar has no truncation of its own. */
export const MAX_BAR_TITLE = 64;
/** Segments on one item: the prs strip has five. */
export const MAX_BAR_SEGMENTS = 8;
/** Nodes in one item's menu, submenus included: a screenful of commands. */
export const MAX_BAR_MENU_NODES = 64;
/** Submenus inside submenus: deeper is a palette's job. */
export const MAX_BAR_SUBMENU_DEPTH = 3;

const BAR_COLORS = new Set(["grey", "blue", "green", "amber", "red", "violet", "pink", "teal", "text", "muted", "accent", "destructive"]);
const BAR_NODE_TYPES = new Set(["item", "section", "submenu", "separator"]);

/**
 * A `BarItem` (protocol.ts) checked before it leaves the host, on every
 * `render` answer and every `bar.update`: the title, segment and menu
 * limits above, action ids that cannot shadow the shell's, a `{ view }`
 * menu through `checkView`. Throws with the place and the reason; returns
 * the item untouched.
 */
export function checkBarItem(v: unknown, where = "bar"): BarItem {
  if (!v || typeof v !== "object") throw new Error(`${where}: not an object`);
  const item = v as BarItem;
  if (item.title !== undefined && typeof item.title !== "string") throw new Error(`${where}: title must be a string`);
  if (item.title && item.title.length > MAX_BAR_TITLE) throw new Error(`${where}: title longer than ${MAX_BAR_TITLE} chars`);
  if (item.badge !== undefined && item.badge !== "dot" && !(typeof item.badge === "number" && Number.isFinite(item.badge))) throw new Error(`${where}: badge must be a number or "dot"`);
  if (item.color !== undefined && !BAR_COLORS.has(item.color)) throw new Error(`${where}: unknown color "${item.color}"`);
  if (item.progress !== undefined && !(typeof item.progress === "number" && item.progress >= 0 && item.progress <= 1)) throw new Error(`${where}: progress must be 0..1`);
  if (item.refresh !== undefined && !(typeof item.refresh === "number" && item.refresh > 0)) throw new Error(`${where}: refresh must be seconds > 0`);
  if (item.segments !== undefined) {
    if (!Array.isArray(item.segments)) throw new Error(`${where}: segments must be an array`);
    if (item.segments.length > MAX_BAR_SEGMENTS) throw new Error(`${where}: more than ${MAX_BAR_SEGMENTS} segments`);
    const ids = new Set<string>();
    for (const s of item.segments) {
      if (!s || typeof s.id !== "string" || !s.id) throw new Error(`${where}: a segment has no id`);
      if (ids.has(s.id)) throw new Error(`${where}: segment id "${s.id}" twice`);
      ids.add(s.id);
      if (s.color !== undefined && !BAR_COLORS.has(s.color)) throw new Error(`${where}: segment "${s.id}" has an unknown color "${s.color}"`);
    }
  }
  if (item.menu !== undefined) checkBarMenu(item.menu, where);
  return item;
}

function checkBarMenu(m: BarMenu, where: string) {
  if (Array.isArray(m)) {
    let count = 0;
    const ids = new Set<string>();
    const walk = (nodes: BarMenuNode[], depth: number, path: string) => {
      if (!Array.isArray(nodes)) throw new Error(`${where}: ${path} children must be an array`);
      nodes.forEach((n, i) => {
        const p = `${path}/${i}`;
        if (!n || typeof n !== "object" || !BAR_NODE_TYPES.has(n.type)) throw new Error(`${where}: ${p} is not a menu node`);
        if (++count > MAX_BAR_MENU_NODES) throw new Error(`${where}: more than ${MAX_BAR_MENU_NODES} menu nodes`);
        if (n.type === "item") {
          if (typeof n.id !== "string" || !n.id) throw new Error(`${where}: ${p} has no id`);
          if (typeof n.title !== "string") throw new Error(`${where}: ${p} has no title`);
          if (ids.has(n.id)) throw new Error(`${where}: menu id "${n.id}" twice`);
          ids.add(n.id);
          const action = n.action ?? n.id;
          if (action.startsWith(SHELL_PREFIX)) throw new Error(`${where}: action id "${action}" is the shell's (${SHELL_PREFIX} is reserved)`);
        } else if (n.type === "section") {
          walk(n.children, depth, p);
        } else if (n.type === "submenu") {
          if (typeof n.title !== "string") throw new Error(`${where}: ${p} submenu has no title`);
          if (depth + 1 > MAX_BAR_SUBMENU_DEPTH) throw new Error(`${where}: ${p} submenus nested deeper than ${MAX_BAR_SUBMENU_DEPTH}`);
          walk(n.children, depth + 1, p);
        }
      });
    };
    walk(m, 0, "menu");
    return;
  }
  if (!m || typeof m !== "object") throw new Error(`${where}: menu must be nodes, { palette } or { view }`);
  if ("palette" in m) {
    if (typeof m.palette !== "string" || !m.palette) throw new Error(`${where}: menu palette must be a name`);
    if (m.extension !== undefined && typeof m.extension !== "string") throw new Error(`${where}: menu extension must be a name`);
    return;
  }
  if ("view" in m) { checkView(m.view, `${where} menu view`); return; }
  throw new Error(`${where}: menu must be nodes, { palette } or { view }`);
}
