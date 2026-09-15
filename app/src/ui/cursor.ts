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
