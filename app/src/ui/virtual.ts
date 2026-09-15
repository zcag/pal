/** Shared bits of the virtualised List and Grid. */
import { useLayoutEffect, useState, type RefObject } from "react";
import type { Item } from "./types";

export type FlatRow<T> =
  | { kind: "header"; title: string; count: number }
  | { kind: "items"; items: T[]; index: number };

/**
 * Rows for consecutive runs of `section`; items are never reordered, so a
 * cursor over `items` stays an index into `items`. `per` items share a row
 * (1 for a list, the column count for a grid). Returns each item's row too.
 */
export function flatten<T extends { section?: string }>(items: T[], per = 1) {
  const rows: FlatRow<T>[] = [];
  const rowOf: number[] = new Array(items.length);
  let i = 0;
  while (i < items.length) {
    const section = items[i].section;
    let end = i;
    while (end < items.length && items[end].section === section) end++;
    if (section) rows.push({ kind: "header", title: section, count: end - i });
    for (let start = i; start < end; start += per) {
      const chunk = items.slice(start, Math.min(start + per, end));
      for (let k = 0; k < chunk.length; k++) rowOf[start + k] = rows.length;
      rows.push({ kind: "items", items: chunk, index: start });
    }
    i = end;
  }
  return { rows, rowOf };
}

export type Metrics = { row: number; header: number; pad: number };

const px = (el: Element, name: string, fallback: number) =>
  parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;

/** Row sizes from the tokens, read off the scroller so the virtualiser and the CSS agree. */
export function useMetrics(scroller: RefObject<HTMLElement | null>): Metrics {
  const [m, setM] = useState<Metrics>({ row: 40, header: 28, pad: 8 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) setM({ row: px(el, "--pal-row-h", 40), header: px(el, "--pal-section-h", 28), pad: px(el, "--pal-space-2", 8) });
  }, [scroller]);
  return m;
}

/** Sort a hit list so sections are contiguous, in order of first appearance. */
export function groupBySection<T extends { item: Item }>(hits: T[]): T[] {
  const order = new Map<string | undefined, number>();
  for (const h of hits) if (!order.has(h.item.section)) order.set(h.item.section, order.size);
  return hits.map((h, i) => [h, i] as const).sort((a, b) => order.get(a[0].item.section)! - order.get(b[0].item.section)! || a[1] - b[1]).map(([h]) => h);
}

export const domId = (listId: string, index: number) => `${listId}-${index}`;
