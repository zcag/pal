import { useCallback, useState } from "react";

export type Level<V> = { view: V; query: string };

/** A stack of views, each with its own search text. */
export function useNavStack<V>(root: V) {
  const [stack, setStack] = useState<Level<V>[]>([{ view: root, query: "" }]);
  const top = stack[stack.length - 1];
  const push = useCallback((view: V) => setStack((s) => [...s, { view, query: "" }]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  /** The top level's view swapped for another, its query kept (a view level's next tree). */
  const replace = useCallback((view: V) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], view }]), []);
  const reset = useCallback(() => setStack((s) => [{ view: s[0].view, query: "" }]), []);
  /** A new bottom level, the stack dropped (the bar popover opening on an item). */
  const restart = useCallback((view: V) => setStack([{ view, query: "" }]), []);
  /** The bottom level swapped in place, the rest of the stack and every query kept (the item rendered again). */
  const replaceRoot = useCallback((view: V) => setStack((s) => [{ ...s[0], view }, ...s.slice(1)]), []);
  const setQuery = useCallback(
    (query: string) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], query }]),
    [],
  );
  return { stack, top, view: top.view, query: top.query, depth: stack.length, push, pop, replace, reset, restart, replaceRoot, setQuery };
}

export type NavStack<V> = ReturnType<typeof useNavStack<V>>;
