import { useEffect, useRef, useState, type ReactNode } from "react";

type Dur = "fast" | "base" | "slow" | "hud-out";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ms = (v: string) => (v.trim().endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000) || 0;

/**
 * Keeps `children` mounted through their exit. When `show` turns false the
 * wrapper gets `data-exiting` (the exit rules in ui.css key on it) and `inert`,
 * and the last children stay rendered until the exit's transitionend or
 * animationend, or `--pal-dur-<dur>` plus a margin when no event comes. Under
 * reduced motion they leave at once. Without `className` the wrapper is
 * box-less (display: contents), so an absolutely positioned overlay keeps its
 * containing block.
 */
export function Presence({ show, dur = "fast", className, children }: { show: boolean; dur?: Dur; className?: string; children: ReactNode }) {
  const node = useRef<HTMLDivElement>(null);
  const last = useRef(children);
  if (show) last.current = children;
  const [state, setState] = useState({ show, exiting: false });
  // Derived from the flip, in render, so the closing frame already carries data-exiting.
  if (state.show !== show) setState({ show, exiting: !show && !reduced() });
  const { exiting } = state;

  useEffect(() => {
    if (!exiting) return;
    const el = node.current;
    const done = () => setState((s) => (s.exiting ? { ...s, exiting: false } : s));
    // The wrapper's own transition, or a direct child's when the wrapper is box-less; a nested hover ending must not cut the exit short.
    const onEnd = (e: Event) => { if (e.target === el || (e.target as Element).parentElement === el) done(); };
    const id = setTimeout(done, (el ? ms(getComputedStyle(el).getPropertyValue(`--pal-dur-${dur}`)) : 0) + 50);
    el?.addEventListener("transitionend", onEnd);
    el?.addEventListener("animationend", onEnd);
    return () => { clearTimeout(id); el?.removeEventListener("transitionend", onEnd); el?.removeEventListener("animationend", onEnd); };
  }, [exiting, dur]);

  if (!show && !exiting) return null;
  return (
    <div ref={node} className={className} style={className ? undefined : { display: "contents" }} data-exiting={exiting || undefined} inert={exiting || undefined}>
      {show ? children : last.current}
    </div>
  );
}
