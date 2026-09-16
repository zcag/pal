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
  const setQuery = useCallback(
    (query: string) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], query }]),
    [],
  );
  return { stack, top, view: top.view, query: top.query, depth: stack.length, push, pop, replace, reset, setQuery };
}

export type NavStack<V> = ReturnType<typeof useNavStack<V>>;
