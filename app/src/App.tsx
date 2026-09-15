import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Launcher, LIMIT, type LauncherHandle } from "./Launcher";
import { sourceKey, staysOpen, toItem, toLiveHits, type Effect, type SourceInfo, type WireHit, type WireItem } from "./items";
import type { Hit } from "./ui";
import type { Item } from "./ui/types";

const mark = (name: string, t: number) => invoke("mark", { name, t });

/** `sources()` from the core, refreshed on every `pal://index`. */
function useSources() {
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

export default function App() {
  const { sources, version, bump } = useSources();
  const launcher = useRef<LauncherHandle>(null);
  const titles = useRef(new Map<string, string>());
  titles.current = new Map(sources.map((s) => [sourceKey(s), s.title]));

  // An input palette answers from the host, everything else from the index.
  const search = useCallback(async (q: string, scope?: SourceInfo): Promise<Hit[]> => {
    if (scope?.input) {
      const source = { extension: scope.extension, palette: scope.palette };
      const r = await invoke<{ items: WireItem[] }>("host_request", { method: "list", params: { ...source, query: q } });
      return toLiveHits(source, r.items, scope.title);
    }
    const wire = await invoke<WireHit[]>("query", { q, limit: LIMIT, sources: scope && [{ extension: scope.extension, palette: scope.palette }] });
    return wire.map((h) => ({ item: toItem(h, titles.current.get(sourceKey(h.source)) ?? h.source.palette), match: { name: new Set(h.name_positions) } }));
  }, []);

  // hotkey -> painted panel
  useEffect(() => {
    const un = listen<{ t0: number }>("pal://shown", (e) => {
      launcher.current?.reset();
      requestAnimationFrame(() => mark("hotkey->paint ms", Date.now() - e.payload.t0));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // The core ran the envelope's copy/open; whether the window stays is decided here, the toast is the Launcher's.
  const pick = async (item: Item, query: string, action?: string) => {
    const t0 = performance.now();
    const r = await invoke<Effect>("pick", { source: item.source, id: item.id, action, query });
    mark(`pick ${item.id}${action ? ` (${action})` : ""} ms`, performance.now() - t0);
    if (!staysOpen(r)) invoke("hide");
    bump(); // the pick changed frecency; the next list has it
    return r;
  };

  return <Launcher ref={launcher} sources={sources} search={search} version={version} mark={mark} onHide={() => invoke("hide")} onPick={pick} />;
}
