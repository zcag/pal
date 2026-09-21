import { useCallback, useState } from "react";

/**
 * A cursor over `count` rows, owned by whoever owns the data. The stored
 * index may go stale as data changes; reads clamp, so it is always valid.
 */
export function useCursor(count: number, initial = 0) {
  const [raw, setRaw] = useState(initial);
  const last = Math.max(count - 1, 0);
  const cursor = Math.min(raw, last);
  const set = useCallback((i: number) => setRaw(Math.max(0, i)), []);
  const move = useCallback((delta: number) => setRaw((c) => Math.max(0, Math.min(Math.min(c, last) + delta, last))), [last]);
  const reset = useCallback(() => setRaw(0), []);
  return { cursor, set, move, reset, last };
}

export type Cursor = ReturnType<typeof useCursor>;

/**
 * Where the switcher's cursor goes when the rows change under it (a relist,
 * a filter typed): the row it was on (`id`) where that still is, else
 * `fallback` clamped (the same index after a relist, row 0 after typing).
 * With no row yet followed (the hold just began) it is row 2, or the only
 * row: "row 2 is where I just was".
 */
export function followCursor(rows: { item: { id: string } }[], id: string | undefined, fallback: number): number {
  if (!rows.length) return 0;
  if (id === undefined) return Math.min(1, rows.length - 1);
  const i = rows.findIndex((r) => r.item.id === id);
  return i >= 0 ? i : Math.max(0, Math.min(fallback, rows.length - 1));
}
