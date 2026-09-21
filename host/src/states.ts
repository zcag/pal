// The host's side of states (docs/design/states.md): the core's
// `states/changed` notification handed to the SDK's `state.onChange`
// through the runtime (sdk.ts, worker.ts). Reads and publishes need
// nothing here: they are plain `core/states.*` calls through the bridge.
import type { StateValue } from "../../sdk/src/protocol.ts";

type Listener = (changed: Record<string, StateValue>) => void;
const listeners = new Set<Listener>();

export function onStates(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The core's `states/changed` (or the main thread's relay of it into a worker): every listener hears the changed values; one throwing is logged, not the others' problem. */
export function update(changed: Record<string, StateValue>) {
  for (const cb of listeners) {
    try { cb(changed); } catch (e) { console.error(`[host] state listener threw: ${e instanceof Error ? e.message : String(e)}`); }
  }
}
