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
  /** Every level's view mapped through `f` (the queries kept): a level anywhere in the stack patched in place (the bottom one for the bar item rendered again, a view level a push lands on), or left as it is when `f` answers it back. */
  const patch = useCallback((f: (view: V, depth: number) => V) => setStack((s) => { const next = s.map((l, i) => { const view = f(l.view, i + 1); return view === l.view ? l : { ...l, view }; }); return next.some((l, i) => l !== s[i]) ? next : s; }), []);
  const setQuery = useCallback(
    (query: string) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], query }]),
    [],
  );
  return { stack, top, view: top.view, query: top.query, depth: stack.length, push, pop, replace, reset, restart, patch, setQuery };
}

export type NavStack<V> = ReturnType<typeof useNavStack<V>>;
