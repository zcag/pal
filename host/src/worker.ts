// One instance of a `multi` extension, in its own Bun Worker
// (docs/design/instances.md): a mini host. It binds the SDK here, in this
// worker's own global, so `settings.get()`, `storage`, `bar.update` and
// `push` mean this instance without the code learning a thing: `caller`
// answers the instance key (from the async context inside a request, the
// key itself at import time), every `core/*` call is posted to the main
// thread, which relays it over the one stdio bridge and posts the reply
// back. The worker has its own module registry, so a submodule's
// module-level cache (a token, a client) is this instance's alone.
//
// Messages from host.ts (`WorkerInstance`, instances.ts): `{ id, init }`
// once, then `{ id, req: { method, params } }` for the core's requests
// (list, pick, view, detail, link, the sections, bar/*, view/*), `{
// settings }` on a settings change, `{ stop }` before terminate. Out: `{
// res: { id, result | error } }`, `{ call: { id, method, params, timeout }
// }` for the SDK's bridge calls (answered by `{ reply }`), `{ stopped }`.
import { checkLinks, checkPalettes } from "../../sdk/src/manifest.ts";
import type { Extension, InstanceInfo, ResolvedSettings } from "../../sdk/src/protocol.ts";
import { bind, type Caller } from "../../sdk/src/runtime.ts";
import { barMetas, barMethods } from "./bar.ts";
import { instanceInfo, instanceMeta, rewriteCall, type WorkerInit } from "./instances.ts";
import { describe, log, paletteMethods, sections, timeout } from "./serve.ts";
import { context, resolved, subscribe, update } from "./settings.ts";
import { onView, viewMethods, views } from "./views.ts";

declare const self: Worker;

// stdout is the protocol (the main thread's): an extension's console.log
// from here would land between the frames just the same.
console.log = console.info = console.debug = console.error;

let key = "";
let name = "";
let info: InstanceInfo | undefined;
let ext: Extension | undefined;
let error: string | undefined;
let rootTimeout = 1500;
let methods: Record<string, (params: any) => unknown> = {};

// ---- the SDK's runtime, bound to this instance --------------------------

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
const pending = new Map<number, Pending>();
let seq = 1;

/** One `core/<method>` request: posted to the main thread, resolved by its `{ reply }`; the bridge's own timeout there bounds it. */
function call<T = unknown>(method: string, params?: unknown, opts?: { timeout?: number }): Promise<T> {
  const id = seq++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    self.postMessage({ call: { id, method, params: rewriteCall(method, params, key), timeout: opts?.timeout } });
  });
}

/**
 * Which extension is asking: the one named, with the manifest name
 * meaning this instance (code that says `settings.get("gmail")` inside
 * `gmail@work` means itself); else the request's context; else this
 * instance, since nothing else runs here (at import time the context does
 * not reach the module, and the stack walk of settings.ts would answer
 * the directory name, not the key).
 */
const caller = (extension?: string): Caller => (extension && extension !== name ? { extension } : (context.getStore() ?? { extension: key }));

const instance = (): InstanceInfo => {
  if (!info) throw new Error("instance(): not initialised");
  return info;
};

bind({ call, caller, resolved, subscribe, update: (extension, s) => update({ [extension]: s }), instance, views, onView });

// ---- messages -----------------------------------------------------------

const lookup = (k: string): Extension => {
  if (k !== key) throw new Error(`no extension ${k} in the worker of ${key}`);
  if (!ext) throw new Error(error ?? `no extension ${key}`);
  return ext;
};

async function init(id: number, i: WorkerInit) {
  const t0 = performance.now();
  key = i.inst.key;
  name = i.inst.name;
  info = instanceInfo(i.inst);
  rootTimeout = i.rootTimeout;
  // The values before the code runs, so `settings.get()` at top level has them.
  update({ [key]: i.settings });
  try {
    const mod = await timeout(context.run({ extension: key }, () => import(`${i.entry}?t=${Date.now()}`)), i.loadTimeout, `import of ${key}`);
    const loaded = mod.default as Extension;
    if (!loaded?.palettes) throw new Error("default export has no palettes");
    ext = loaded;
    const manifestOf = () => i.manifest;
    methods = { ...paletteMethods(lookup, manifestOf), ...barMethods(lookup, () => info), ...viewMethods };
    for (const kind of ["inline", "fallback", "suggest"] as const) methods[kind] = (p) => sections([[key, loaded]], manifestOf, kind, p?.query, rootTimeout);
    // The manifest against the code, with the instance's title and mark on every meta.
    const check = checkPalettes(i.manifest, loaded, instanceMeta(i.inst, i.alone));
    check.warnings.push(...checkLinks(i.manifest, loaded));
    self.postMessage({ res: { id, result: { palettes: check.metas, bar: barMetas(loaded, i.manifest), warnings: check.warnings, ms: performance.now() - t0 } } });
  } catch (e) {
    error = describe(e);
    self.postMessage({ res: { id, error } });
  }
}

async function serve(id: number, method: string, params: unknown) {
  try {
    const fn = methods[method];
    if (!fn) throw new Error(`unknown method ${method}`);
    self.postMessage({ res: { id, result: await fn(params) } });
  } catch (e) {
    self.postMessage({ res: { id, error: e instanceof Error ? e.message : String(e) } });
  }
}

/** The module's `dispose` before the worker is terminated: its intervals and watchers would otherwise run to the end. */
async function stop() {
  const d = ext?.dispose;
  ext = undefined;
  if (d) {
    try { await context.run({ extension: key }, () => Promise.resolve(d())); } catch (e) { log(`dispose ${key} failed: ${describe(e)}`); }
  }
  self.postMessage({ stopped: true });
}

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m?.reply && typeof m.reply.id === "number") {
    const p = pending.get(m.reply.id);
    if (!p) return;
    pending.delete(m.reply.id);
    if (m.reply.error !== undefined) p.reject(new Error(String(m.reply.error)));
    else p.resolve(m.reply.result);
  } else if (m?.init) {
    init(m.id, m.init as WorkerInit);
  } else if (m?.req) {
    serve(m.id, String(m.req.method), m.req.params);
  } else if (m?.settings) {
    update({ [key]: m.settings as ResolvedSettings });
  } else if (m?.stop) {
    stop();
  }
};
