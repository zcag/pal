import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Launcher, type LauncherHandle } from "./Launcher";
import { toItem, type Raw } from "./fixtures";
import type { Item } from "./ui/types";

const mark = (name: string, t: number) => invoke("mark", { name, t });

/** Streams `cmd`'s stdout lines in as items. */
function useFeed(cmd: string) {
  const [items, setItems] = useState<Item[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t0 = performance.now();
    const acc: Item[] = [];
    const un = listen<string[]>("pal://feed", (e) => {
      for (const l of e.payload) acc.push(toItem(JSON.parse(l) as Raw));
      setItems([...acc]);
    });
    const fin = listen("pal://feed-done", () => {
      setDone(true);
      mark(`feed ${acc.length} rows, ms`, performance.now() - t0);
    });
    invoke("feed", { cmd });
    return () => {
      un.then((f) => f());
      fin.then((f) => f());
    };
  }, [cmd]);
  return { items, loading: !done };
}

export default function App() {
  const { items, loading } = useFeed("cat fixtures/all.jsonl");
  const launcher = useRef<LauncherHandle>(null);

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

  return (
    <Launcher
      ref={launcher}
      items={items}
      loading={loading}
      mark={mark}
      onHide={() => invoke("hide")}
      onPick={(item) => {
        mark(`pick ${item.id}`, Date.now());
        invoke("hide");
      }}
    />
  );
}
