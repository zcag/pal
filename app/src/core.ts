/**
 * The Launcher's data callbacks against the core, shared by the panel
 * (`App.tsx`) and the bar popover (`BarPage.tsx`): the sources list kept
 * current on `pal://index`, the search over the index or the host, an
 * item's lazy detail, a view palette's tree, and the pick. `hide` is the
 * command that hides the window the Launcher lives in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mergeDetail, sourceKey, staysOpen, toItem, toLiveHits, toView, type Ctx, type Effect, type SourceInfo, type WireHit, type WireItem } from "./items";
import type { Hit } from "./ui";
import type { Detail, Item, ViewSpec } from "./ui/types";

import { LIMIT } from "./Launcher";

export const mark = (name: string, t: number) => invoke("mark", { name, t });

/** `sources()` from the core, refreshed on every `pal://index`. */
export function useSources() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    const refresh = () => invoke<SourceInfo[]>("sources").then(setSources);
    refresh();
    const un = listen("pal://index", () => refresh().then(bump));
    return () => {
      un.then((f) => f());
    };
  }, [bump]);
  return { sources, version, bump };
}

export function useCore(hide: () => void) {
  const { sources, version, bump } = useSources();
  const infos = useRef(new Map<string, SourceInfo>());
  infos.current = new Map(sources.map((s) => [sourceKey(s), s]));
  // What the last search was scoped to: which palette is showing.
  const showing = useRef<SourceInfo | undefined>(undefined);

  // An input palette answers from the host, so does a level a `push` opened
  // (its args go with the list); everything else from the index, whose
  // bucket the core first swaps to the palette's chosen filter.
  const search = useCallback(async (q: string, scope?: SourceInfo, ctx?: Ctx): Promise<Hit[]> => {
    showing.current = scope;
    const source = scope && { extension: scope.extension, palette: scope.palette };
    if (source && (scope.input || ctx?.args !== undefined)) {
      const r = await invoke<{ items: WireItem[] }>("host_request", { method: "list", params: { ...source, query: q, filter: ctx?.filter, args: ctx?.args } });
      return toLiveHits(source, r.items, scope);
    }
    if (source && scope.filters?.length && ctx?.filter) await invoke("filter", { source, filter: ctx.filter });
    const wire = await invoke<WireHit[]>("query", { q, limit: LIMIT, sources: source && [source] });
    return wire.map((h) => {
      const info = infos.current.get(sourceKey(h.source));
      return { item: toItem(h, info ?? { title: h.source.palette }), match: { name: new Set(h.name_positions) } };
    });
  }, []);

  // The rest of a lazy item's detail; the host keeps the answer until the palette lists again.
  const detail = useCallback(async (item: Item, ctx?: Ctx): Promise<Detail> => {
    const t0 = performance.now();
    const r = await invoke<unknown>("detail", { source: item.source, id: item.id, args: ctx?.args });
    mark(`detail ${item.id} ms`, performance.now() - t0);
    return mergeDetail(item.detail, r);
  }, []);

  // The tree a view palette opens with; the level's filter and args go along as with a list.
  const view = useCallback(async (scope: SourceInfo, ctx?: Ctx): Promise<ViewSpec> => {
    const t0 = performance.now();
    const r = await invoke<ViewSpec>("host_request", { method: "view", params: { extension: scope.extension, palette: scope.palette, filter: ctx?.filter, args: ctx?.args } });
    mark(`view ${sourceKey(scope)} ms`, performance.now() - t0);
    return toView(r);
  }, []);

  // The core ran the envelope's copy/open; whether the window stays is decided here, the toast is the Launcher's.
  const pick = useCallback(async (item: Item, query: string, action?: string, ctx?: Ctx) => {
    const t0 = performance.now();
    const r = await invoke<Effect>("pick", { req: { source: item.source, id: item.id, action, query, args: ctx?.args, values: ctx?.values } });
    mark(`pick ${item.id}${action ? ` (${action})` : ""} ms`, performance.now() - t0);
    if (!staysOpen(r)) hide();
    bump(); // the pick changed frecency; the next list has it
    return r;
  }, [hide, bump]);

  // Past any ttl; the core flags the targets stale (the footer says "updating") and each landing bumps the index.
  const refresh = useCallback((scope?: SourceInfo) => invoke("index_refresh", { source: scope && { extension: scope.extension, palette: scope.palette } }), []);

  return { sources, version, bump, showing, search, detail, view, pick, refresh };
}
