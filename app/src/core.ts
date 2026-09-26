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
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FALLBACK, NOW, mergeDetail, sourceKey, staysOpen, toItem, toLiveHits, toView, type Ctx, type Effect, type Source, type SourceInfo, type WireHit, type WireItem } from "./items";
import type { Hit } from "./ui";
import { MOUNT_EVENT } from "./ui/View";
import type { Detail, Item, ViewSpec } from "./ui/types";

import { LIMIT, type DialogInfo, type LauncherHandle, type Prefs, type SurfaceBridge, type ViewOpen, type ViewUpdate } from "./Launcher";

export const mark = (name: string, t: number) => invoke("mark", { name, t });

/** `[general]` as the core loaded it (`settings_general`); the keys the panel reads. */
type General = { alias_space?: boolean; backspace_back?: boolean; fallbacks_always?: boolean; search_history?: boolean; now?: string[]; compact?: boolean };
const toPrefs = (g: General | undefined): Prefs => ({ aliasSpace: g?.alias_space !== false, backspaceBack: g?.backspace_back !== false, fallbacksAlways: g?.fallbacks_always === true, searchHistory: g?.search_history !== false, now: Array.isArray(g?.now) ? g.now.map(String) : [], compact: g?.compact === true });

/** What the Launcher reads of `[general]`, current across config reloads (`pal://config`). */
export function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState<Prefs>(() => toPrefs(undefined));
  useEffect(() => {
    invoke<General>("settings_general").then((g) => setPrefs(toPrefs(g))).catch(() => {});
    const un = listen<{ config?: { general?: General } }>("pal://config", (e) => setPrefs(toPrefs(e.payload.config?.general)));
    return () => {
      un.then((f) => f());
    };
  }, []);
  return prefs;
}

/** One palette's rows for a root section, as the host's `inline`/`fallback`/`suggest` answer them. */
type Section = { extension: string; palette: string; items: WireItem[] };

/**
 * Live views, both halves, for the panel and the popover alike: a push
 * for the level on top (`pal://view`, views.rs) lands in the Launcher in
 * place, a trigger (`pal://trigger`) re-asks a view whose palette lists
 * it, and the callback returned reports the view on top to the shell
 * (`view_open`), which tells the extension and routes the pushes.
 */
export function useLiveViews(launcher: { current: LauncherHandle | null }): (open: ViewOpen | null) => void {
  useEffect(() => {
    // Sent to this window by label (views.rs `emit_to`); a listener on the default target (`Any`) would hear every window's, so it names its own.
    const un = listen<ViewUpdate & { trace?: boolean }>("pal://view", (e) => {
      // `PAL_VIEW_TRACE` in the shell's env: the update's cost in DOM terms, in the log. A kept key never mounts again, so the mounted count is the new keys only.
      const trace = e.payload.trace ? traceMounts() : undefined;
      launcher.current?.update(e.payload);
      if (trace) requestAnimationFrame(() => requestAnimationFrame(() => { const { mounted, stop } = trace; stop(); mark(`view update ${e.payload.palette ?? e.payload.bar}: ${mounted().length} keyed mounted (${mounted().join(",") || "none"}), ${document.querySelectorAll(".pal-view [class*=pal-view__]").length} nodes in DOM`, performance.now()); }));
    }, { target: getCurrentWindow().label });
    const unTrigger = listen<{ name: string }>("pal://trigger", (e) => launcher.current?.trigger(e.payload.name));
    return () => {
      un.then((f) => f());
      unTrigger.then((f) => f());
    };
  }, [launcher]);
  return useCallback((open: ViewOpen | null) => { invoke("view_open", { open }).catch(() => {}); }, []);
}

/** The `ext://` scheme's base (surface.rs), derived as `icon://`'s is (ui/icons.ts): `ext://localhost/` on macOS and Linux, `http://ext.localhost/` on Windows. */
const extBase: string = (() => {
  try {
    return window.__TAURI_INTERNALS__?.convertFileSrc?.("", "ext") ?? "ext://localhost/";
  } catch {
    return "ext://localhost/";
  }
})();

/**
 * A game surface's page and calls (docs/design/game-surface.md): the page
 * at `ext://<extension>/<src>` (an instance's is its extension's folder),
 * a call as the host's `surface` request for the level, `send` resolving
 * with the palette's reply alone.
 */
export const surface: SurfaceBridge = {
  url: (extension, src) => {
    const name = extension.split("@")[0];
    return extBase.startsWith("ext:") ? `ext://${name}/${src}` : `${extBase}${name}/${src}`;
  },
  call: (level, method, data) => invoke<unknown>("host_request", { method: "surface", params: { ...level, call: method, data } }).then((r) => (method === "send" ? (r as { reply?: unknown } | null)?.reply : r)),
};

/** Counts the keyed view nodes that mount from now until `stop` (`MOUNT_EVENT`, View.tsx). */
function traceMounts(): { mounted: () => string[]; stop: () => void } {
  const keys: string[] = [];
  const on = (ev: Event) => keys.push(String((ev as CustomEvent).detail));
  document.addEventListener(MOUNT_EVENT, on);
  return { mounted: () => keys, stop: () => document.removeEventListener(MOUNT_EVENT, on) };
}

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
    return wire.map(toHit);
  }, []);
  const toHit = (h: WireHit): Hit => {
    const info = infos.current.get(sourceKey(h.source));
    return { item: toItem(h, info ?? { title: h.source.palette }), match: { name: new Set(h.name_positions) } };
  };
  /** A host section's rows as hits under `group` (the palette's title when none is given). */
  const sectionHits = (sections: Section[], group?: (s: SourceInfo | undefined, item: WireItem) => string): Hit[] =>
    sections.flatMap((s) => {
      const source: Source = { extension: s.extension, palette: s.palette };
      const info = infos.current.get(sourceKey(source));
      return toLiveHits(source, s.items, info ?? { title: s.palette }).map((h) => ({ ...h, item: { ...h.item, group: group ? group(info, h.item as WireItem) : info?.title ?? s.palette } }));
    });

  // The root's inline section: the palettes whose `match` accepts the query list it (host `inline`); each section is titled by its palette.
  const inline = useCallback(async (q: string): Promise<Hit[]> => {
    if (!q.trim() || ![...infos.current.values()].some((s) => s.inline)) return [];
    const t0 = performance.now();
    const r = await invoke<Section[]>("host_request", { method: "inline", params: { query: q } });
    mark(`inline "${q}" (${r.reduce((n, s) => n + s.items.length, 0)}) ms`, performance.now() - t0);
    return sectionHits(r);
  }, []);

  // The fallback rows that come after the section painted (host `fallback/late`, the palettes' `lateFallback`): the Launcher asks once the section shows and places them.
  const lateFallback = useCallback(async (q: string): Promise<Hit[]> => {
    if (!q.trim()) return [];
    const t0 = performance.now();
    const r = await invoke<Section[]>("host_request", { method: "fallback/late", params: { query: q } });
    mark(`late fallback "${q}" (${r.reduce((n, s) => n + s.items.length, 0)}) ms`, performance.now() - t0);
    return sectionHits(r);
  }, []);

  // The root's fallback rows for a query the index has nothing for (fallback.rs): the core orders them and names the section.
  const fallback = useCallback(async (q: string): Promise<Hit[]> => {
    if (!q.trim()) return [];
    const wire = await invoke<WireHit[]>("fallback", { q });
    return wire.map((h) => (sourceKey(h.source) === FALLBACK ? { item: toItem(h, { title: "Fallback" }) } : toHit(h)));
  }, []);

  // The empty root's "Now" rows: every palette's `suggest()` (host `suggest`), the sections ordered by `general.now`, a row's own `section` naming its section ("Clipboard") else "Now".
  const suggest = useCallback(async (now: string[]): Promise<Hit[]> => {
    if (![...infos.current.values()].some((s) => s.suggest)) return [];
    const t0 = performance.now();
    const r = await invoke<Section[]>("host_request", { method: "suggest" });
    mark(`suggest (${r.reduce((n, s) => n + s.items.length, 0)}) ms`, performance.now() - t0);
    const id = (s: Section) => (s.extension === s.palette ? s.extension : `${s.extension}-${s.palette}`);
    const rank = (s: Section) => { const i = now.indexOf(id(s)); return i < 0 ? now.length : i; };
    const ordered = r.map((s, i) => [s, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
    return sectionHits(ordered, (_info, item) => (typeof item.section === "string" && item.section ? item.section : NOW));
  }, []);

  // The last root queries that led to a pick, newest first (`general.search_history`).
  const history = useCallback(() => invoke<string[]>("search_history"), []);
  // The open or save panel in front (`pal_core::dialog`, one read per show): the root's Dialog hint.
  const dialog = useCallback(() => invoke<DialogInfo | null>("dialog_detect"), []);
  // "Reset ranking for this item": the row's frecency forgotten; whether there was any.
  const forget = useCallback((item: Item) => (item.source ? invoke<boolean>("frecency_forget", { source: item.source, id: item.id }) : Promise.resolve(false)), []);

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
    const r = await invoke<Effect>("pick", { req: { source: item.source, id: item.id, action, query, args: ctx?.args, values: ctx?.values, ids: ctx?.ids } });
    mark(`pick ${item.id}${action ? ` (${action})` : ""}${ctx?.ids ? ` x${ctx.ids.length}` : ""} ms`, performance.now() - t0);
    if (!staysOpen(r)) hide();
    bump(); // the pick changed frecency; the next list has it
    return r;
  }, [hide, bump]);

  // Past any ttl; the core flags the targets stale (the footer says "updating") and each landing bumps the index.
  const refresh = useCallback((scope?: SourceInfo) => invoke("index_refresh", { source: scope && { extension: scope.extension, palette: scope.palette } }), []);

  return { sources, version, bump, showing, search, inline, fallback, lateFallback, suggest, history, dialog, forget, detail, view, pick, refresh };
}
