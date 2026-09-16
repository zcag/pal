/** Shared bits of the virtualised List and Grid. */
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { observeElementRect, type Virtualizer } from "@tanstack/react-virtual";
import type { Item } from "./types";

/** Dispatched on `window` by the app when the panel has just been shown (App.tsx). */
export const SHOWN_EVENT = "pal:shown";

/**
 * The virtualiser's scroll rect, kept true across a hidden spell. The
 * default observer reads the rect once and then trusts ResizeObserver, and
 * WebKit holds those callbacks while the panel is hidden (it is kept alive
 * at alpha 0 between shows), so a list that changed while hidden could keep
 * a stale or zero rect and render no rows although the footer counted hits.
 * Re-read on every show and when the document becomes visible again.
 */
export const observeRect: (instance: Virtualizer<HTMLDivElement, Element>, cb: (rect: { width: number; height: number }) => void) => void | (() => void) = (instance, cb) => {
  const stop = observeElementRect(instance, cb);
  const again = () => {
    const el = instance.scrollElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    cb({ width: Math.round(r.width), height: Math.round(r.height) });
  };
  window.addEventListener(SHOWN_EVENT, again);
  document.addEventListener("visibilitychange", again);
  return () => {
    stop?.();
    window.removeEventListener(SHOWN_EVENT, again);
    document.removeEventListener("visibilitychange", again);
  };
};

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

export type Metrics = { row: number; header: number; pad: number; gap: number; inset: number; tile: number };

const px = (el: Element, name: string, fallback: number) =>
  parseFloat(getComputedStyle(el).getPropertyValue(name)) || fallback;

const defaultMetrics: Metrics = { row: 40, header: 28, pad: 8, gap: 8, inset: 8, tile: 56 };

/** Row sizes from the tokens, read off the scroller so the virtualiser and the CSS agree. */
export function useMetrics(scroller: RefObject<HTMLElement | null>): Metrics {
  const [m, setM] = useState<Metrics>(defaultMetrics);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) setM({ row: px(el, "--pal-row-h", 40), header: px(el, "--pal-section-h", 28), pad: px(el, "--pal-space-2", 8), gap: px(el, "--pal-grid-gap", 8), inset: px(el, "--pal-list-inset", 8), tile: px(el, "--pal-grid-tile", 56) });
  }, [scroller]);
  return m;
}

/**
 * Grid columns for a scroller `width` px wide: as many cells of at least the
 * tile's width (plus the gap between) as fit inside the list insets, at most
 * `max` (what the extension asked for), never under 2.
 */
export function gridColumns(width: number, { tile, gap, inset }: Pick<Metrics, "tile" | "gap" | "inset">, max: number): number {
  return Math.max(2, Math.min(max, Math.floor((width - inset * 2 + gap) / (tile + gap))));
}

/** The live column count of a grid scroller, following its width; `max` until the first measurement. */
export function useGridColumns(scroller: RefObject<HTMLElement | null>, metrics: Metrics, max: number): number {
  const [cols, setCols] = useState(max);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setCols(gridColumns(el.clientWidth, metrics, max));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scroller, metrics, max]);
  return cols;
}

/**
 * Hover moves the cursor only when the pointer really moves, as in Raycast:
 * `mousemove` also fires with the pointer still when the list scrolls under
 * it, and when the browser re-syncs hover after a keyboard scroll, and those
 * must not fight the arrow keys. `hovered()` answers once, right after a
 * hover set the cursor, so the scroll-into-view effect can sit that one out.
 */
export function useHover(cursor: number, onCursor: (index: number) => void) {
  const m = useRef({ x: NaN, y: NaN, by: -1 });
  const hover = (index: number) => (e: MouseEvent) => {
    const s = m.current;
    if (e.clientX === s.x && e.clientY === s.y) return;
    s.x = e.clientX; s.y = e.clientY;
    if (index !== cursor) { s.by = index; onCursor(index); }
  };
  const hovered = useCallback(() => { const hit = m.current.by === cursor; m.current.by = -1; return hit; }, [cursor]);
  return { hover, hovered };
}

/** Sort a hit list so sections are contiguous, in order of first appearance. */
export function groupBySection<T extends { item: Item }>(hits: T[]): T[] {
  const order = new Map<string | undefined, number>();
  for (const h of hits) if (!order.has(h.item.section)) order.set(h.item.section, order.size);
  return hits.map((h, i) => [h, i] as const).sort((a, b) => order.get(a[0].item.section)! - order.get(b[0].item.section)! || a[1] - b[1]).map(([h]) => h);
}

export const domId = (listId: string, index: number) => `${listId}-${index}`;

/**
 * After the virtualiser scrolled the cursor's row into view, check the DOM:
 * the virtualiser trusts its last rect of the scroller, and a rect read
 * while the footer was absent or the panel hidden leaves the last rows
 * under the footer. A row (or its header) whose box crosses the scroller's
 * edge is nudged in by the difference.
 */
export function ensureVisible(scroller: HTMLElement | null, ids: string[]) {
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom;
    else if (r.top < box.top) scroller.scrollTop -= box.top - r.top;
  }
}

