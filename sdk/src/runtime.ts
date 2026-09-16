// How the SDK reaches the host it runs inside. `api.ts` never imports the
// host: the host binds its bridge and settings table here at startup
// (`bind`), and every API call takes them from `runtime()`. The slot is a
// process-wide global keyed by a registered symbol, not a module variable,
// so a second copy of this package (an extension that `bun add`ed it, next
// to the copy the host links) still finds the host's binding: the calls
// are the wire's method names, which is what stays compatible, not the
// module instance.
import type { ResolvedSettings } from "./protocol.ts";

/** Which extension (and palette) a call comes from, as the host resolves it. */
export type Caller = { extension: string; palette?: string };

/** What a host provides. Not for extensions: the host's side of `api.ts`. */
export type Runtime = {
  /** One `core/<method>` request over the bridge, resolved with its result; `timeout` in ms replaces the bridge's own (5 s) for a call that waits on the user. */
  call<T = unknown>(method: string, params?: unknown, opts?: { timeout?: number }): Promise<T>;
  /** The calling extension: the one given, else the one the host knows from context or the stack; throws when neither. */
  caller(extension?: string): Caller;
  /** The extension's resolved settings, as the core last sent them. */
  resolved(extension: string): ResolvedSettings;
  /** Called with the new values on every change; returns the unsubscribe. */
  subscribe(extension: string, cb: (s: ResolvedSettings) => void): () => void;
};

const KEY = Symbol.for("@zcag/pal/runtime");
type Slot = { [KEY]?: Runtime };

/** The host calls this once, before it imports any extension. */
export const bind = (r: Runtime): void => { (globalThis as Slot)[KEY] = r; };

/** The bound host; throws when there is none (the module is imported outside the pal extension host). */
export function runtime(): Runtime {
  const r = (globalThis as Slot)[KEY];
  if (!r) throw new Error("@zcag/pal: not running inside the pal extension host");
  return r;
}
