// The host's side of controls (docs/design/controls.md): the core's
// `controls/changed` handed to the SDK's `controls.onChange` (like
// states.ts), and its `controls/run` request routed to the provider's
// handler inside the async context that tells the SDK which extension runs
// it, so `settings.get()` in a handler needs no argument. Publishing and
// asking are plain `core/controls.*` calls through the bridge.
import { CONTROL_NAMES, type ControlRun, type ControlsChanged, type Extension } from "../../sdk/src/protocol.ts";
import { context } from "./settings.ts";

type Listener = (changed: ControlsChanged) => void;
const listeners = new Set<Listener>();

export function onControls(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The core's `controls/changed` (or the main thread's relay into a worker): every listener hears it; one throwing is logged, not the others' problem. */
export function update(changed: ControlsChanged) {
  for (const cb of listeners) {
    try { cb(changed); } catch (e) { console.error(`[host] controls listener threw: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

/** `controls/run`: the op on `lookup(extension).controls`; null whatever the handler answers. */
export function controlsMethods(lookup: (name: string) => Extension): Record<string, (params: any) => unknown> {
  return {
    "controls/run": async (p: ControlRun) => {
      const key = String(p?.extension);
      if (!CONTROL_NAMES.includes(p?.control)) throw new Error(`no control ${String(p?.control)}`);
      const fn = (lookup(key).controls?.[p.control] as Record<string, ((...a: unknown[]) => unknown) | undefined> | undefined)?.[String(p.op)];
      if (typeof fn !== "function") throw new Error(`${key} has no ${p.control} ${String(p.op)}`);
      await context.run({ extension: key }, () => fn(...(Array.isArray(p.args) ? p.args : [])));
      return null;
    },
  };
}
