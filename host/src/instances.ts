// Instances of a `multi` extension (docs/design/instances.md): what the
// core's `core/instances.get` answer becomes once its defaults are filled
// (`resolveInstances`), the rewrites that make code naming itself by
// manifest name land on its own instance (`rewriteEffect`, `rewriteCall`),
// and `WorkerInstance`, the main thread's handle on one instance running
// in a Bun `Worker` (worker.ts): request/reply over `postMessage`, the
// worker's `core/*` calls relayed through this thread's bridge, `stop`
// with a grace period before `terminate()`.
import { TILE_COLORS, type TileColor } from "../../sdk/src/icon.ts";
import { tooLate } from "./bridge.ts";
import type { InstanceMeta } from "../../sdk/src/manifest.ts";
import type { BarMeta, InstanceInfo, Manifest, PaletteMeta, ResolvedSettings, StateValue } from "../../sdk/src/protocol.ts";

/** The extension's name behind an instance key: `gmail` for `gmail@work` and for `gmail`. */
export const nameOf = (key: string): string => key.split("@")[0];
/** The suffix of a non-default key, or undefined for a bare name. */
const suffixOf = (key: string): string | undefined => (key.includes("@") ? key.slice(key.indexOf("@") + 1) : undefined);
/** `<name>@<suffix>`, the suffix `[a-z0-9][a-z0-9_-]{0,31}` and never `default` (pal_core::config::instance::is_key). */
const isKey = (key: string): boolean => /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9_-]{0,31}$/.test(key) && suffixOf(key) !== "default";

/** One instance, resolved: what `extension/loaded` announces and the SDK's `instance()` answers, plus the tile's mark. */
export type Instance = InstanceInfo & { tint?: TileColor; badge?: string; enabled: boolean };

/** One entry of a `core/instances.get` answer: the config's values, unset ones absent or null. */
type Spec = { key?: unknown; title?: unknown; tint?: unknown; badge?: unknown; enabled?: unknown };

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** "work" is "Work", "flat_2" is "Flat_2": the suffix with its first letter up. */
const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A brand colour picked from the suffix (a stable hash), never the extension's own, so a new instance's tile reads as a different one. */
export function tintOf(suffix: string, own?: TileColor): TileColor {
  const choices = TILE_COLORS.filter((c) => c !== own);
  let h = 5381;
  for (const ch of suffix) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return choices[h % choices.length];
}

/**
 * The instances of `name` from the core's answer (`[{ key, title, tint,
 * badge, enabled }]`), the default first and always present (prepended
 * when the answer lacks it, or when there is no answer: a non-`multi`
 * extension, a harness without the route), a key of another name or one
 * that is not well formed dropped. Defaults: the title is the suffix
 * capitalised (the default instance stays untitled until named), the tint
 * is hashed from the suffix skipping `own` (the extension's tile colour),
 * the badge is the title's first letter; the default instance carries no
 * tint or badge, its tile is the extension's own. A tint that is not a
 * brand colour falls to the hash.
 */
export function resolveInstances(name: string, answer: unknown, own?: TileColor): Instance[] {
  const specs = (Array.isArray(answer) ? answer : []).filter((s): s is Spec => !!s && typeof s === "object" && typeof (s as Spec).key === "string");
  if (!specs.some((s) => s.key === name)) specs.unshift({ key: name });
  const out: Instance[] = [];
  for (const s of specs) {
    const key = s.key as string;
    if (key !== name && !(isKey(key) && nameOf(key) === name)) continue;
    if (out.some((i) => i.key === key)) continue;
    const enabled = s.enabled !== false;
    const suffix = suffixOf(key);
    if (suffix === undefined) {
      out.push({ key, name, isDefault: true, enabled, ...(str(s.title) && { title: str(s.title) }) });
      continue;
    }
    const title = str(s.title) ?? capitalised(suffix);
    const tint = TILE_COLORS.includes(s.tint as TileColor) ? (s.tint as TileColor) : tintOf(suffix, own);
    const badge = [...(str(s.badge) ?? "")].slice(0, 2).join("") || [...title][0].toUpperCase();
    out.push({ key, name, title, isDefault: false, enabled, tint, badge });
  }
  // The default first, whatever order the answer came in.
  out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return out;
}

/** What `checkPalettes` needs of an instance: its title, whether it is alone (`{instance}` stripped, nothing appended) and, for a non-default one, its mark. */
export const instanceMeta = (inst: Instance, alone: boolean): InstanceMeta => ({ title: inst.title, alone, ...(!inst.isDefault && { tint: inst.tint, badge: inst.badge }) });

/** The `instance` an `extension/loaded` carries. */
export const loadedInstance = (inst: Instance) => ({ key: inst.key, ...(inst.title && { title: inst.title }), ...(!inst.isDefault && { tint: inst.tint, badge: inst.badge }), isDefault: inst.isDefault });

/** What `instance()` (api.ts) and `BarCtx.instance` carry. */
export const instanceInfo = (inst: Instance): InstanceInfo => ({ key: inst.key, name: inst.name, ...(inst.title && { title: inst.title }), isDefault: inst.isDefault });

/**
 * An effect from inside an instance with its `push` spelled by key: code
 * that names itself by manifest name (`push: { extension: "gmail", ... }`)
 * or not at all lands on the instance it runs in, not on the default.
 * Another extension's name is left as written. A bar item's
 * `menu: { palette, extension? }` the same (`rewriteBarItem`).
 */
export function rewriteEffect<T>(r: T, key: string): T {
  const push = (r as { push?: { extension?: unknown } } | undefined)?.push;
  if (push && typeof push === "object" && (push.extension === undefined || push.extension === nameOf(key))) push.extension = key;
  return r;
}

/** The item's `menu` and its `empty.menu` (what `show = "always"` opens) alike. */
export function rewriteBarItem<T>(item: T, key: string): T {
  type Menu = { palette?: unknown; extension?: unknown };
  const i = item as { menu?: Menu; empty?: { menu?: Menu } } | undefined;
  for (const menu of [i?.menu, i?.empty?.menu]) {
    if (menu && typeof menu === "object" && !Array.isArray(menu) && typeof menu.palette === "string" && (menu.extension === undefined || menu.extension === nameOf(key))) menu.extension = key;
  }
  return item;
}

/** A `core/*` call leaving an instance: `effects.run`'s push and `bar.update`'s menu rewritten like an answered effect; anything else untouched. */
export function rewriteCall(method: string, params: unknown, key: string): unknown {
  if (!params || typeof params !== "object") return params;
  if (method === "effects.run") rewriteEffect((params as { effect?: unknown }).effect, key);
  if (method === "bar.update") rewriteBarItem((params as { item?: unknown }).item, key);
  return params;
}

// ---- the main thread's side of worker.ts ----------------------------------

/** What worker.ts answers once the entry is imported and checked. */
type WorkerLoaded = { palettes: PaletteMeta[]; bar: BarMeta[]; warnings: string[]; ms: number };

/** `{ init }` to the worker: everything it needs to bind the SDK and import the entry. */
export type WorkerInit = { inst: Instance; alone: boolean; entry: string; manifest: Manifest; settings: ResolvedSettings; loadTimeout: number; rootTimeout: number };

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> };

/** How long `stop` waits for the worker's `dispose` before `terminate()`. */
const STOP_GRACE_MS = 1000;

/**
 * One instance in its own Bun `Worker`: its own global (so its own SDK
 * binding, whose `caller` knows the key), its own module registry (so
 * the submodules' caches are its own). `request` posts a `{ req }` and
 * resolves on the `{ res }`; the worker's `{ call }`s (its `core/*`
 * requests) go through `core`, this thread's bridge, and come back as
 * `{ reply }`. `stop` asks for `dispose` and terminates after
 * `STOP_GRACE_MS` either way; a hung worker (its event loop blocked) just
 * gets terminated, its pending requests rejected.
 */
export class WorkerInstance {
  readonly key: string;
  readonly name: string;
  loaded?: WorkerLoaded;
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private seq = 1;
  private gone?: string;
  private onStopped?: () => void;

  constructor(readonly inst: Instance, private core: (method: string, params: unknown, opts?: { timeout?: number }) => Promise<unknown>, private log: (line: string) => void) {
    this.key = inst.key;
    this.name = inst.name;
    this.worker = new Worker(new URL("./worker.ts", import.meta.url).href);
    this.worker.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
    this.worker.onerror = (ev: ErrorEvent) => { this.log(`worker ${this.key}: ${ev.message ?? String(ev)}`); };
  }

  /** Posts `{ init }` and resolves with what the worker loaded, or rejects with its load error (the worker is then dead weight: `stop` it). */
  start(init: Omit<WorkerInit, "inst">, ms: number): Promise<WorkerLoaded> {
    return this.ask({ init: { ...init, inst: this.inst } }, ms).then((r) => (this.loaded = r as WorkerLoaded));
  }

  /** One of the core's requests (`list`, `pick`, `bar/render`, `view/shown`, ...) answered by the worker; `ms` bounds the wait when given. */
  request(method: string, params: unknown, ms?: number): Promise<unknown> {
    return this.ask({ req: { method, params } }, ms);
  }

  /** `settings/changed` for this key. */
  settings(s: ResolvedSettings) {
    if (!this.gone) this.worker.postMessage({ settings: s });
  }

  /** `states/changed`, relayed to the worker's own listeners. */
  states(changed: Record<string, StateValue>) {
    if (!this.gone) this.worker.postMessage({ states: changed });
  }

  /** `dispose` in the worker (up to `grace` ms), then `terminate()`; every pending request is rejected. */
  async stop(grace = STOP_GRACE_MS): Promise<void> {
    if (this.gone) return;
    const stopped = new Promise<void>((res) => { this.onStopped = res; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.worker.postMessage({ stop: true });
    await Promise.race([stopped, new Promise<void>((res) => { timer = setTimeout(res, grace); })]);
    clearTimeout(timer);
    this.end(`${this.key} stopped`);
  }

  /** The worker is gone for good: pending requests fail with `why`, the thread is terminated. */
  private end(why: string) {
    if (this.gone) return;
    this.gone = why;
    this.worker.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
    this.pending.clear();
  }

  private ask(msg: Record<string, unknown>, ms?: number): Promise<unknown> {
    if (this.gone) return Promise.reject(new Error(this.gone));
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = ms ? setTimeout(() => { this.pending.delete(id); reject(tooLate(`${this.key}: ${Object.keys(msg)[0]}`, ms)); }, ms) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, ...msg });
    });
  }

  private onMessage(m: any) {
    if (m?.res && typeof m.res.id === "number") {
      const p = this.pending.get(m.res.id);
      if (!p) return;
      this.pending.delete(m.res.id);
      clearTimeout(p.timer);
      if (m.res.error !== undefined) p.reject(new Error(String(m.res.error)));
      else p.resolve(m.res.result);
    } else if (m?.call && typeof m.call.id === "number") {
      const { id, method, params, timeout } = m.call as { id: number; method: string; params: unknown; timeout?: number };
      this.core(method, params, timeout ? { timeout } : undefined).then(
        (result) => { if (!this.gone) this.worker.postMessage({ reply: { id, result } }); },
        (e) => { if (!this.gone) this.worker.postMessage({ reply: { id, error: e instanceof Error ? e.message : String(e) } }); },
      );
    } else if (m?.stopped) {
      this.onStopped?.();
    }
  }
}
