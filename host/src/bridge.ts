// The host's side of the reverse RPC: `call` writes a `core/...` request on
// stdout and resolves when the core's reply comes back on stdin (host.ts
// hands replies to `resolve`). Its own module so the SDK (through sdk.ts)
// and `host.ts` share one pending table without importing each other.
import type { Request, Response } from "../../sdk/src/protocol.ts";

/** A hung core handler must not hang the extension that asked. */
const TIMEOUT_MS = 5000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<number, Pending>();
let seq = 1;

export function call<T = unknown>(method: string, params?: unknown): Promise<T> {
  const id = seq++;
  const req: Request = { id, method: `core/${method}`, params };
  return new Promise<T>((res, rej) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`core timed out on ${method}`));
    }, TIMEOUT_MS);
    pending.set(id, { resolve: res as (v: unknown) => void, reject: rej, timer });
    try {
      process.stdout.write(JSON.stringify(req) + "\n");
    } catch (e) {
      // The core is gone (EPIPE): fail now rather than after the timeout.
      pending.delete(id);
      clearTimeout(timer);
      rej(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** A reply from the core; false when the id is not ours (timed out, or unknown). */
export function resolve(msg: Response): boolean {
  const p = pending.get(msg.id);
  if (!p) return false;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.error !== undefined) p.reject(new Error(msg.error));
  else p.resolve(msg.result);
  return true;
}
