// The palette side of serving one loaded extension: `list`, `pick`,
// `view`, `detail`, `link` and the root sections (inline, fallback,
// suggest), each run inside the async context that tells the SDK which
// extension (instance key) and palette is asking. Shaped like bar.ts's
// `barMethods`: a table of handlers over a `lookup`, so host.ts serves
// its inline extensions and worker.ts the one instance it holds through
// the same code. An effect that leaves here has its `push` (and a bar
// menu's `palette`) spelled with the instance key (instances.ts).
import { checkLinkEffect, checkLinkParams, inlineMatches, isViewPalette as isView } from "../../sdk/src/manifest.ts";
import type { Ctx, Extension, FormValues, Item, Manifest, Palette } from "../../sdk/src/protocol.ts";
import { checkEffect, checkView } from "../../sdk/src/view.ts";
import { tooLate } from "./bridge.ts";
import { rewriteEffect } from "./instances.ts";
import { context } from "./settings.ts";

/** The loaded extension (instance) behind a key, or a throw with the reason it is not there: its load error, or that there is none. */
export type Lookup = (key: string) => Extension;
/** The manifest behind a key (the extension's, whichever instance), or undefined. */
export type Manifests = (key: string) => Manifest | undefined;

/** Rows one palette may put in the root's inline section; the palette's own level lists everything. */
const INLINE_MAX = 5;

export const log = (...a: unknown[]) => console.error("[host]", ...a);

/** `p` rejected after `ms`, so a hung extension never holds an answer. */
export function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, rej) => { t = setTimeout(() => rej(tooLate(what, ms)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

// Bun raises BuildMessage (one) or AggregateError of them (many) for a file
// that fails to compile; neither prints its position by itself.
export function describe(e: unknown): string {
  const errs = e instanceof AggregateError ? e.errors : [e];
  return errs
    .map((x: any) => (x?.position ? `${x.position.file}:${x.position.line}: ${x.message}` : x?.message ?? String(x)))
    .join("; ");
}

/** A palette request's params as the core sends them (index.rs): JSON off the wire, so every field is read as it may not be. */
type Params = { extension?: string; palette?: string; id?: string; action?: string; query?: string; route?: string; params?: unknown; filter?: string; args?: unknown; refresh?: boolean; values?: FormValues | null; inline?: boolean; ids?: unknown[] };

const paletteKey = (p: Params) => `${p.extension}/${p.palette}`;
// The core sends `args: null` and `values: null` for a level without them: absent, as far as the extension is told.
const ctxOf = (p: Params): Ctx | undefined =>
  p.filter !== undefined || p.args != null || p.refresh || p.values != null || p.inline || Array.isArray(p.ids)
    ? { filter: p.filter, ...(p.args != null && { args: p.args }), ...(p.refresh && { refresh: true }), ...(p.values != null && { values: p.values }), ...(p.inline && { inline: true }), ...(Array.isArray(p.ids) && { ids: p.ids.map(String) }) }
    : undefined;

/** Runs `f` knowing which palette it serves, so `settings.get()` in there needs no argument. */
const inContext = <T>(p: Params, f: () => T): T => context.run({ extension: String(p.extension), palette: String(p.palette) }, f);

/**
 * `detail(id)` answers, per palette, keyed by item id and the ctx that listed
 * it; a `list` of that palette drops them (the items may be new), a reload of
 * the extension too (`forgetDetails`).
 */
const details = new Map<string, Map<string, Promise<unknown>>>();
export const forgetDetails = (key: string) => { for (const k of details.keys()) if (k.startsWith(`${key}/`)) details.delete(k); };

/** `list`, `pick`, `view`, `detail`, `link`, routed to the extension `params.extension` names through `lookup`. */
export function paletteMethods(lookup: Lookup, manifestOf: Manifests): Record<string, (params: Params) => unknown> {
  const palette = (p: Params) => {
    const pal = lookup(String(p.extension)).palettes[String(p.palette)];
    if (!pal) throw new Error(`no palette ${paletteKey(p)}`);
    return pal;
  };
  const fix = <T>(r: T, p: Params): T => rewriteEffect(r, String(p.extension));
  return {
    list: async (p) => {
      details.delete(paletteKey(p));
      const pal = palette(p);
      if (isView(pal)) throw new Error(`${paletteKey(p)}: a view palette has no list`);
      const items = await inContext(p, () => pal.list(p.query, ctxOf(p)));
      if (!Array.isArray(items)) throw new Error(`${paletteKey(p)}: list returned ${items === null ? "null" : typeof items}, not an array`);
      return { items };
    },
    // An effect carrying a view is checked like a `view` answer: the UI draws it the same way. A form likewise.
    pick: async (p) => fix(checkEffect((await inContext(p, () => palette(p).pick(String(p.id), p.action, ctxOf(p)))) ?? {}, `${paletteKey(p)}: pick ${p.action ?? ""}`), p),
    // The tree a view palette opens with; `filter`/`args` reach it as ctx like a list.
    view: async (p) => {
      const pal = palette(p);
      if (!isView(pal)) throw new Error(`${paletteKey(p)}: not a view palette`);
      return checkView(await inContext(p, () => pal.view(ctxOf(p))), `${paletteKey(p)}: view`);
    },
    // `{}` when the palette has no `detail` or answers nothing: the UI keeps the inline one.
    detail: (p) => {
      const pal = palette(p);
      if (!pal.detail) return {};
      const key = paletteKey(p);
      const cache = details.get(key) ?? new Map<string, Promise<unknown>>();
      details.set(key, cache);
      const k = `${JSON.stringify(ctxOf(p)?.args ?? null)}\0${p.id}`;
      let r = cache.get(k);
      if (!r) {
        r = Promise.resolve(inContext(p, () => pal.detail!(String(p.id), ctxOf(p)))).then((d) => d ?? {});
        cache.set(k, r);
        r.catch(() => cache.delete(k));
      }
      return r;
    },
    // `pal://<extension>/<route>?params` (deeplink.rs): the manifest's `links.<route>` gates it and types its params, the code's `link` answers; an effect is checked like a pick's, minus what needs a level.
    link: async (p) => {
      const key = String(p.extension), route = String(p.route);
      const ext = lookup(key);
      const spec = manifestOf(key)?.links?.[route];
      if (!spec || typeof spec !== "object") throw new Error(`no route ${key}/${route}`);
      if (typeof ext.link !== "function") throw new Error(`${key}: no link handler for ${route}`);
      const params = checkLinkParams(spec, p.params && typeof p.params === "object" ? p.params as Record<string, unknown> : {}, `${key}/${route}`);
      const r = await context.run({ extension: key }, () => ext.link!(route, params));
      return fix(checkEffect(checkLinkEffect(r ?? {}, `${key}/${route}`), `${key}/${route}: link`), p);
    },
  };
}

/** One root section's answer from one palette: `{ extension, palette, items }`, or nothing when it had none, failed or was too slow (logged). */
export type Section = { extension: string; palette: string; items: Item[] };
/** The three root sections an extension answers in code (`inline`, `fallback`, `suggest` requests). */
export type SectionKind = "inline" | "fallback" | "suggest";

/** What one palette answers for a section kind, or nothing when it does not take part. */
function sectionOf(kind: SectionKind, pal: Palette, m: Manifest | undefined, palette: string, q: string): (() => Item[] | Promise<Item[]>) | undefined {
  switch (kind) {
    // The root's inline section for `query`: every inline palette whose `match` accepts it lists it (`ctx.inline`), its first rows.
    case "inline": return !isView(pal) && inlineMatches(pal, m?.palettes?.[palette], q) ? () => pal.list(q, { inline: true }) : undefined;
    // The root's fallback rows from the palettes that answer them in code (`fallback(query)`); the "Ask" rows are the core's.
    case "fallback": return typeof pal.fallback === "function" ? () => (pal.fallback as (q: string) => Item[] | Promise<Item[]>)(q) : undefined;
    // The empty root's "Now" section: every palette's `suggest()`.
    case "suggest": return typeof pal.suggest === "function" ? () => pal.suggest!() : undefined;
  }
}

/**
 * The root's sections that come from the extensions rather than the
 * index: every loaded palette that takes part (inline for a matching
 * query, fallback for a function fallback, suggest for the empty root) is
 * asked at once, each within `ms`; a palette that fails or is late is a
 * log line and left out, so one slow extension never holds the root.
 * Palettes come in load order; the core and the UI order the sections.
 */
export async function sections(exts: Iterable<[string, Extension]>, manifestOf: Manifests, kind: SectionKind, query: unknown, ms: number): Promise<Section[]> {
  const q = String(query ?? "");
  const max = kind === "inline" ? INLINE_MAX : Infinity;
  const asks: Promise<Section | undefined>[] = [];
  for (const [key, ext] of exts) {
    for (const [palette, p] of Object.entries(ext.palettes ?? {})) {
      const f = sectionOf(kind, p, manifestOf(key), palette, q);
      if (!f) continue;
      const params = { extension: key, palette };
      asks.push(
        // A throw before the first await (a sync hook) is a rejection like any other, not the whole answer's.
        timeout(Promise.resolve().then(() => inContext(params, f)), ms, `${kind} of ${key}/${palette}`).then(
          (items) => (Array.isArray(items) && items.length ? { extension: key, palette, items: items.slice(0, max) } : undefined),
          (e) => { log(`${kind} ${key}/${palette} failed: ${describe(e)}`); return undefined; },
        ),
      );
    }
  }
  return (await Promise.all(asks)).filter((s): s is Section => s !== undefined);
}
