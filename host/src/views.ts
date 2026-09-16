// The host's side of live views (docs/extensions.md, "Live views"): the
// core's `view/shown` and `view/hidden` notifications, kept as the table
// of open view levels per extension and handed to the SDK's
// `view.onShown`/`view.onHidden`/`view.open()` through the runtime
// (sdk.ts). A push (`view.update`) needs nothing here: it is a plain
// `core/view.update` call through the bridge, checked and coalesced in
// the SDK. A listener runs inside the async context naming the extension
// and the palette, so `view.update(tree)` in there needs no `{ palette }`.
import type { ViewShown } from "../../sdk/src/protocol.ts";
import { context } from "./settings.ts";

type Listener = (ev: ViewShown, shown: boolean) => void;
const open = new Map<string, ViewShown[]>();
const listeners = new Map<string, Set<Listener>>();

const same = (a: ViewShown, b: ViewShown) => a.palette === b.palette && a.bar === b.bar && a.id === b.id && !!a.compact === !!b.compact;

/** `view.open()`: the extension's levels open now, newest last. */
export const views = (extension: string): ViewShown[] => open.get(extension) ?? [];

export function onView(extension: string, cb: Listener): () => void {
  if (!listeners.has(extension)) listeners.set(extension, new Set());
  listeners.get(extension)!.add(cb);
  return () => listeners.get(extension)?.delete(cb);
}

/** The extension is gone (removed, or reloaded: its listeners belong to the old module): its table and listeners go with it. */
export function forget(extension: string) {
  open.delete(extension);
  listeners.delete(extension);
}

/** The core's notification as a `ViewShown`, or nothing for a malformed one. */
function parse(p: any): ViewShown | undefined {
  if (!p || typeof p.extension !== "string" || typeof p.id !== "string") return;
  if (typeof p.palette !== "string" && typeof p.bar !== "string") return;
  return { extension: p.extension, ...(typeof p.palette === "string" && { palette: p.palette }), ...(typeof p.bar === "string" && { bar: p.bar }), id: p.id, ...(p.compact === true && { compact: true as const }) };
}

function fire(ev: ViewShown, shown: boolean) {
  const cbs = listeners.get(ev.extension);
  if (!cbs?.size) return;
  context.run({ extension: ev.extension, ...(ev.palette && { palette: ev.palette }) }, () => {
    for (const cb of cbs) {
      try { cb(ev, shown); } catch (e) { console.error(`[host] view listener of ${ev.extension} threw: ${e instanceof Error ? e.message : String(e)}`); }
    }
  });
}

/** `view/shown` and `view/hidden`: notifications, nothing answers them; a repeated shown or an unknown hidden is ignored. */
export const viewMethods: Record<string, (params: any) => void> = {
  "view/shown": (p) => {
    const ev = parse(p);
    if (!ev) throw new Error("view/shown: no extension, palette/bar and id");
    const list = open.get(ev.extension) ?? [];
    if (list.some((x) => same(x, ev))) return;
    open.set(ev.extension, [...list, ev]);
    fire(ev, true);
  },
  "view/hidden": (p) => {
    const ev = parse(p);
    if (!ev) throw new Error("view/hidden: no extension, palette/bar and id");
    const list = open.get(ev.extension) ?? [];
    const was = list.find((x) => same(x, ev));
    if (!was) return;
    open.set(ev.extension, list.filter((x) => x !== was));
    fire(was, false);
  },
};
