// The host's side of synced storage (docs/design/accounts.md): the core's
// `storage/changed` notification, sent when sync changed a stored value of
// an extension's, handed to the SDK's `storage.onChange` through the runtime
// (sdk.ts, worker.ts), and forwarded to the extension's open view levels
// as `{ pal: "storage", key, value }`, which the app hands to a game
// surface's page for the kit's `pal.storage.onChange` (a tree level has no
// page and drops it). Reads and writes need nothing here: they are
// plain `core/storage.*` calls through the bridge.
import type { StorageChanged, ViewPost } from "../../sdk/src/protocol.ts";
import { runtime } from "../../sdk/src/runtime.ts";
import { context } from "./settings.ts";
import { views } from "./views.ts";

type Listener = (key: string, value: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

export function onStorage(extension: string, cb: Listener): () => void {
  let set = listeners.get(extension);
  if (!set) listeners.set(extension, (set = new Set()));
  set.add(cb);
  return () => listeners.get(extension)?.delete(cb);
}

/** The extension is gone (removed, or reloaded: its listeners belong to the old module). */
export function forget(extension: string) {
  listeners.delete(extension);
}

/** `storage/changed`: a notification, nothing answers it. A listener runs in the extension's context; one throwing is logged, not the others' problem. */
export const storageMethods: Record<string, (params: any) => void> = {
  "storage/changed": (p: StorageChanged) => {
    if (!p || typeof p.extension !== "string" || typeof p.key !== "string") throw new Error("storage/changed: no extension and key");
    const { extension, key } = p;
    const value = p.value ?? null;
    context.run({ extension }, () => {
      for (const cb of listeners.get(extension) ?? []) {
        try { cb(key, value); } catch (e) { console.error(`[host] storage listener of ${extension} threw: ${e instanceof Error ? e.message : String(e)}`); }
      }
    });
    for (const palette of new Set(views(extension).flatMap((v) => (v.palette ? [v.palette] : [])))) {
      runtime().call("view.post", { extension, palette, msg: { pal: "storage", key, value } } satisfies ViewPost)
        .catch((e) => console.error(`[host] storage change to the surface of ${extension}/${palette} failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  },
};
