// Resolved settings per extension, as the core sends them (`settings/changed`,
// see protocol.ts), and how `api.ts` knows which extension is asking. Its own
// module so `api.ts` and `host.ts` share one table without importing each
// other (same reason as bridge.ts).
//
// Which extension is asking: the host runs every `list`/`pick` inside an
// async context naming the extension and palette, so a call from there needs
// no argument. At module top level (import time) that context does not reach
// the module (Bun does not propagate it through a dynamic import), so the
// caller's file is read off the stack instead, which works for synchronous
// calls. Anywhere else (a callback after an await, outside list/pick) pass
// the extension's name.
import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import type { ResolvedSettings } from "./protocol.ts";

export type Context = { extension: string; palette?: string };

export const context = new AsyncLocalStorage<Context>();

const table = new Map<string, ResolvedSettings>();
const listeners = new Map<string, Set<(s: ResolvedSettings) => void>>();
let roots: string[] = [];

/** The extension roots, for reading the caller off the stack; resolved, since stack frames carry real paths. */
export const setRoots = (r: string[]) => { roots = r.map((x) => real(x).replace(/\/+$/, "") + "/"); };
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

/** `<root>/<name>/...` frames on the stack name the extension. */
function fromStack(): string | undefined {
  for (const line of (new Error().stack ?? "").split("\n")) {
    const path = line.match(/\(?([^\s()]+?)(?:\?t=\d+)?:\d+:\d+\)?$/)?.[1];
    if (!path) continue;
    const root = roots.find((r) => path.startsWith(r));
    if (root) return path.slice(root.length).split("/")[0];
  }
}

export function caller(extension?: string): Context {
  if (extension) return { extension };
  const ctx = context.getStore();
  if (ctx) return ctx;
  const ext = fromStack();
  if (!ext) throw new Error("settings: cannot tell which extension is asking; pass its name");
  return { extension: ext };
}

/** The core's `settings/changed`: replaces each named extension's values and tells its listeners. */
export function update(extensions: Record<string, ResolvedSettings>) {
  for (const [name, s] of Object.entries(extensions)) {
    table.set(name, s);
    listeners.get(name)?.forEach((cb) => cb(s));
  }
}

export const resolved = (extension: string): ResolvedSettings => table.get(extension) ?? { settings: {}, palettes: {} };

export function subscribe(extension: string, cb: (s: ResolvedSettings) => void): () => void {
  if (!listeners.has(extension)) listeners.set(extension, new Set());
  listeners.get(extension)!.add(cb);
  return () => listeners.get(extension)?.delete(cb);
}
