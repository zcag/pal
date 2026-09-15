import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Fzf, type FzfResultItem } from "fzf";

type Item = {
  id: string;
  name: string;
  subtitle?: string;
  icon?: string;
  keywords?: string[];
  palette: string;
};

const ROW = 40;
const LIMIT = 200;

const mark = (name: string, t: number) => invoke("mark", { name, t });

/** Streams `cmd`'s stdout lines in as items. */
function useFeed(cmd: string) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const t0 = performance.now();
    const acc: Item[] = [];
    const un = listen<string[]>("pal://feed", (e) => {
      for (const l of e.payload) acc.push(JSON.parse(l));
      setItems([...acc]);
    });
    const done = listen("pal://feed-done", () => mark(`feed ${acc.length} rows, ms`, performance.now() - t0));
    invoke("feed", { cmd });
    return () => {
      un.then((f) => f());
      done.then((f) => f());
    };
  }, [cmd]);
  return items;
}

function Highlight({ text, positions }: { text: string; positions: Set<number> }) {
  if (positions.size === 0) return <>{text}</>;
  return (
    <>
      {[...text].map((ch, i) =>
        positions.has(i) ? <mark key={i}>{ch}</mark> : ch,
      )}
    </>
  );
}

export default function App() {
  const items = useFeed("cat fixtures/all.jsonl");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const keyAt = useRef(0);

  const fzf = useMemo(
    () => new Fzf(items, { selector: (i) => [i.name, i.subtitle, ...(i.keywords ?? [])].filter(Boolean).join(" "), limit: LIMIT }),
    [items],
  );
  const results: FzfResultItem<Item>[] = useMemo(
    () => (query ? fzf.find(query) : items.slice(0, LIMIT).map((item) => ({ item, positions: new Set<number>(), start: 0, end: 0, score: 0 }))),
    [fzf, items, query],
  );

  const virt = useVirtualizer({ count: results.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 8 });

  // keystroke -> painted list
  useLayoutEffect(() => {
    if (!keyAt.current) return;
    const t = keyAt.current;
    keyAt.current = 0;
    requestAnimationFrame(() => mark(`key->paint "${query}" (${results.length}) ms`, performance.now() - t));
  }, [query, results.length]);

  // hotkey -> painted panel
  useEffect(() => {
    const un = listen<{ t0: number }>("pal://shown", (e) => {
      setQuery("");
      setCursor(0);
      input.current?.focus();
      requestAnimationFrame(() => mark("hotkey->paint ms", Date.now() - e.payload.t0));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    setCursor(0);
  }, [query]);
  useEffect(() => {
    virt.scrollToIndex(cursor);
  }, [cursor, virt]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Escape") { invoke("hide"); }
    else if (e.key === "Enter") { mark(`pick ${results[cursor]?.item.id}`, Date.now()); invoke("hide"); }
  };

  return (
    <div className="panel" onKeyDown={onKey}>
      <input
        ref={input}
        className="search"
        autoFocus
        placeholder="Search…"
        value={query}
        onChange={(e) => { keyAt.current = performance.now(); setQuery(e.target.value); }}
        spellCheck={false}
      />
      <div className="list" ref={scroller}>
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const { item, positions } = results[v.index];
            return (
              <div
                key={item.palette + item.id}
                className={"row" + (v.index === cursor ? " active" : "")}
                style={{ transform: `translateY(${v.start}px)` }}
                onMouseMove={() => setCursor(v.index)}
              >
                <span className="icon">{item.icon ?? ""}</span>
                <span className="name"><Highlight text={item.name} positions={positions} /></span>
                {item.subtitle && <span className="sub">{item.subtitle}</span>}
                <span className="acc">{item.palette}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="foot">
        <span>{results.length}{results.length === LIMIT ? "+" : ""} of {items.length}</span>
        <span>↵ Open</span>
      </div>
    </div>
  );
}
