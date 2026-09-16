// The host's side of bar items (docs/design/bar.md): what `hello` and
// `extension/loaded` say about an extension's items, and the core's
// `bar/*` requests routed to the extension's `BarSource` inside the async
// context that tells the SDK which extension is asking (so `settings.get()`
// in `render` needs no argument). Every answer is checked before it goes
// out, as a view is: an item through `checkBarItem`, an Effect through
// `checkEffect`. Pushes (`bar.update`/`bar.refresh`) need nothing here:
// they are plain `core/*` calls through the bridge, checked in the SDK.
import type { BarCtx, BarMeta, BarSource, Extension, InstanceInfo, Manifest } from "../../sdk/src/protocol.ts";
import { checkBarItem, checkEffect } from "../../sdk/src/view.ts";
import { rewriteBarItem, rewriteEffect } from "./instances.ts";
import { context } from "./settings.ts";

/**
 * The manifest's `bar` entries merged with the code's keys: a manifest
 * entry without a `BarSource` is reported with `source: false` (the core
 * lists it as an error row and never asks for it), a source the manifest
 * does not mention gets its id as the title. Nothing for an extension
 * whose code failed to load, like `palettes`.
 */
export function barMetas(ext: Extension | undefined, manifest: Manifest): BarMeta[] {
  const declared = manifest.bar ?? {};
  const sources = ext?.bar ?? {};
  const ids = [...new Set([...Object.keys(declared), ...Object.keys(sources)])];
  return ids.map((id) => ({ ...(declared[id] ?? { title: id }), id, source: typeof sources[id]?.render === "function" }));
}

/** The core's `ctx` as the extension sees it; a request without one gets `reason` (a first render, a popover opening); `instance` rides in for a `multi` extension. */
const ctxOf = (p: any, instance: InstanceInfo | undefined, reason: BarCtx["reason"] = "load"): BarCtx => ({ ...(p?.ctx && typeof p.ctx === "object" && typeof p.ctx.reason === "string" ? p.ctx : { reason }), ...(instance && { instance }) });

/**
 * `bar/render`, `bar/action`, `bar/open`, `bar/shown`; `lookup` throws the
 * load error for an extension that is not there. `instanceOf` names the
 * instance a key runs as (a `multi` extension; undefined otherwise), put
 * on every ctx. An answered item's `menu` and an effect's `push` leave
 * spelled with the instance key (instances.ts).
 */
export function barMethods(lookup: (name: string) => Extension, instanceOf: (key: string) => InstanceInfo | undefined = () => undefined): Record<string, (params: any) => unknown> {
  const key = (p: any) => `${p?.extension}/${p?.id}`;
  const source = (p: any): BarSource => {
    const s = lookup(String(p?.extension)).bar?.[p?.id];
    if (!s || typeof s.render !== "function") throw new Error(`no bar item ${key(p)}`);
    return s;
  };
  const run = <T>(p: any, f: () => T): T => context.run({ extension: String(p?.extension) }, f);
  const ctx = (p: any, reason?: BarCtx["reason"]) => ctxOf(p, instanceOf(String(p?.extension)), reason);
  return {
    "bar/render": async (p) => rewriteBarItem(checkBarItem(await run(p, () => source(p).render(ctx(p))), `${key(p)}: render`), String(p?.extension)),
    // `{}` when the item has no handler or answers nothing: the popover stays as it is.
    "bar/action": async (p) => rewriteEffect(checkEffect((await run(p, () => source(p).onAction?.(String(p?.action ?? ""), ctx(p)))) ?? {}, `${key(p)}: action ${p?.action ?? ""}`), String(p?.extension)),
    "bar/open": async (p) => rewriteEffect(checkEffect((await run(p, () => source(p).onOpen?.(ctx(p)))) ?? {}, `${key(p)}: open`), String(p?.extension)),
    // A notification: nothing answers it, a throw is a log line (host.ts).
    "bar/shown": async (p) => { await run(p, () => source(p).onShown?.(ctx(p, "open"))); },
  };
}
