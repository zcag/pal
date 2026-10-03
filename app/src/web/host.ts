// The extension host for the web build: the same `@zcag/pal` runtime the bun
// host binds (host/src/sdk.ts), with the core's side answered in the page
// (core.ts). Extensions are the packages build-web.ts put under `ext/`, each
// imported as an ES module; their `@zcag/pal` import is the page's import map.
// The handlers are the bun host's own (`paletteMethods`, `sections`), so a
// palette answers here exactly as it does in the app.
import { checkPalettes } from "../../../sdk/src/manifest.ts";
import type { Extension, Manifest, PaletteMeta, ResolvedSettings, SettingSpec } from "../../../sdk/src/protocol.ts";
import { bind } from "../../../sdk/src/runtime.ts";
import { paletteMethods, sections, type SectionKind } from "../../../host/src/serve.ts";
import { caller, context, resolved, setRoots, subscribe, update } from "../../../host/src/settings.ts";
import { onStates } from "../../../host/src/states.ts";
import { onView, viewMethods, views } from "../../../host/src/views.ts";

export type Loaded = { name: string; manifest: Manifest; ext: Extension; metas: PaletteMeta[] };
export type CoreCall = (method: string, params: any) => unknown;

const BASE = new URL("ext/", document.baseURI);
export const loaded = new Map<string, Loaded>();
const lookup = (key: string) => { const l = loaded.get(key); if (!l) throw new Error(`no extension ${key}`); return l.ext; };
const methods = paletteMethods(lookup, (key) => loaded.get(key)?.manifest);

/** Settings the viewer changed, per extension (`""` for its own, a palette's under that palette's id), over the manifest's defaults. */
const OVERRIDES = "pal-web:settings";
type Overrides = Record<string, Record<string, Record<string, unknown>>>;
const overrides = (): Overrides => { try { return JSON.parse(localStorage.getItem(OVERRIDES) ?? "{}"); } catch { return {}; } };
const defaults = (specs: SettingSpec[] | undefined) => Object.fromEntries((specs ?? []).map((s) => [s.id, s.default ?? null]));
function settingsOf(m: Manifest): ResolvedSettings {
  const own = overrides()[m.name] ?? {};
  const palettes = Object.fromEntries(Object.entries(m.palettes ?? {}).map(([id, p]) => [id, { ...defaults(p.settings), ...own[id] }]));
  return { settings: { ...defaults(m.settings), ...own[""] }, palettes };
}
/** `settings.set` from the SDK: `null` puts a key back to its default. */
export function setSettings(p: { extension: string; palette?: string; values: Record<string, unknown> }): ResolvedSettings {
  const all = overrides();
  const ext = (all[p.extension] ??= {});
  const scope = (ext[p.palette ?? ""] ??= {});
  for (const [k, v] of Object.entries(p.values)) if (v === null) delete scope[k]; else scope[k] = v;
  try { localStorage.setItem(OVERRIDES, JSON.stringify(all)); } catch { /* private window: this visit only */ }
  const m = loaded.get(p.extension)?.manifest;
  const r = m ? settingsOf(m) : resolved(p.extension);
  update({ [p.extension]: r });
  return r;
}

/** Binds the runtime to `core`, then imports every extension the build listed; resolves with the ones that loaded. */
export async function start(core: CoreCall): Promise<Loaded[]> {
  // Stack frames carry the module's URL from `//host/` on: the extension is the directory under `ext/`.
  setRoots([BASE.href.replace(/^[a-z]+:/, "")]);
  bind({ call: async (method, params) => core(method, params) as never, caller, resolved, subscribe, update: (extension, s) => update({ [extension]: s }), views, onView, onStates, instance: (extension) => ({ key: extension, name: extension, isDefault: true }) });
  const names: string[] = await fetch(new URL("index.json", BASE)).then((r) => r.json());
  await Promise.all(names.map(async (name) => {
    try {
      const manifest: Manifest = await fetch(new URL(`${name}/pal.json`, BASE)).then((r) => r.json());
      update({ [name]: settingsOf(manifest) });
      const mod = await context.run({ extension: name }, () => import(/* @vite-ignore */ new URL(`${name}/index.js`, BASE).href));
      const ext = mod.default as Extension;
      if (!ext?.palettes) throw new Error("default export has no palettes");
      loaded.set(name, { name, manifest, ext, metas: checkPalettes(manifest, ext).metas });
    } catch (e) {
      console.error(`[web host] ${name} failed to load:`, e);
    }
  }));
  // Load order is the build's order, not the order the imports finished in.
  const order = new Map(names.map((n, i) => [n, i]));
  return [...loaded.values()].sort((a, b) => order.get(a.name)! - order.get(b.name)!);
}

/** One host request, as the app's `host_request` sends it to the bun host. */
export function request(method: string, params: any): unknown {
  if (method in methods) return methods[method](params ?? {});
  if (method in viewMethods) return viewMethods[method](params);
  if (["inline", "fallback", "fallback/late", "suggest"].includes(method)) {
    return sections([...loaded].map(([k, l]) => [k, l.ext] as [string, Extension]), (k) => loaded.get(k)?.manifest, method as SectionKind, params?.query, 1500);
  }
  throw new Error(`host: no method ${method} on the web`);
}
