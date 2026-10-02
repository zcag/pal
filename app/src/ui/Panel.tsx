import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Presence } from "./presence";

export type PanelProps = {
  search: ReactNode;
  footer?: ReactNode;
  /** Side pane, shown next to the body. */
  aside?: ReactNode;
  /** Overlays: action panel, toast. Positioned against the panel. */
  overlay?: ReactNode;
  /** The level is a list or an empty state, which may take only the height it needs (`useFit`); a view, a form, a grid or a detail pane keep the frame's. */
  fits?: boolean;
  /** The window takes the fitted height instead of the page (the app: `panel_fit`, so the native blur and shadow follow); `null` asks for the full height back. Without it (the gallery) the panel sizes itself inside its frame. */
  onFit?: (height: number | null) => void;
  /** The level's colour (its extension's tile: a brand token or a `#rrggbb`), as `--pal-place` on the panel for a design that tints a place by it (ui.css `--pal-place-*`); none at the root. */
  place?: string;
  children: ReactNode;
};

/** The frame: search row, body (with optional side pane), footer, overlays. `data-footer` lets the scrim stop above the footer. The side pane stays through its exit (fades as the list widens). */
export function Panel({ search, footer, aside, overlay, fits, onFit, place, children }: PanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  useFit(panel, !!fits && !aside, onFit);
  return (
    <div ref={panel} className="pal-panel" data-footer={footer ? "" : undefined} data-place={place ? "" : undefined} style={place ? ({ "--pal-place": place } as CSSProperties) : undefined}>
      <div className="pal-panel__search">{search}</div>
      <div className="pal-panel__body" data-split={aside ? "" : undefined}>
        <div className="pal-panel__main">{children}</div>
        <Presence show={!!aside} dur="slow" className="pal-panel__aside">{aside}</Presence>
      </div>
      {footer && <div className="pal-panel__footer">{footer}</div>}
      {overlay}
    </div>
  );
}

/**
 * A design that sets `--pal-panel-fit: on` (designs/*.css) has the panel
 * take the height its rows need, up to the frame's, so three results are a
 * short panel; `data-fit` carries the transition (ui.css). The height is
 * the panel's chrome (search row, footer, borders) plus the list's content
 * (`.pal-list__inner`, the virtualiser's total) or the empty state's own,
 * re-measured whenever one of those changes size. The panel itself is not
 * observed: its height is what is set. With `onFit` the window is what is
 * sized (the panel fills it), each new height sent once.
 */
function useFit(panel: React.RefObject<HTMLDivElement | null>, fits: boolean, onFit?: (height: number | null) => void) {
  const sent = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const send = (h: number | null) => { if (onFit && sent.current !== h) { sent.current = h; onFit(h); } };
    const off = () => { delete el.dataset.fit; el.style.height = ""; send(null); };
    if (!fits) return off();
    const main = el.querySelector<HTMLElement>(":scope > .pal-panel__body > .pal-panel__main");
    if (!main) return;
    const measure = () => {
      // Read each time: the design can change under a mounted panel (`data-design` on <html>).
      if (getComputedStyle(el).getPropertyValue("--pal-panel-fit").trim() !== "on") return off();
      const content = natural(main);
      if (content === undefined) return;
      const h = Math.ceil(el.offsetHeight - main.offsetHeight + content);
      // The window follows (the shell caps it at the full height); the panel keeps filling it.
      if (onFit) return send(h);
      const frame = el.parentElement?.clientHeight ?? 0;
      if (!frame) return;
      const fitted = Math.min(frame, h);
      if (el.style.height !== `${fitted}px`) el.style.height = `${fitted}px`;
      el.dataset.fit = "";
    };
    const ro = new ResizeObserver(measure);
    const watch = () => {
      ro.disconnect();
      for (const n of [el.querySelector(".pal-panel__search"), el.querySelector(".pal-panel__footer"), main.querySelector(".pal-list__inner"), main.querySelector(".pal-empty")]) if (n) ro.observe(n);
    };
    watch();
    measure();
    // The level's content swaps (a list for an empty state, the footer coming and going with the cursor row), or the design changes: watch the new nodes, measure again.
    const mo = new MutationObserver(() => { watch(); measure(); });
    mo.observe(el, { childList: true, subtree: true });
    const mod = new MutationObserver(measure);
    mod.observe(document.documentElement, { attributes: true, attributeFilter: ["data-design", "data-density"] });
    return () => { ro.disconnect(); mo.disconnect(); mod.disconnect(); off(); };
  }, [panel, fits, onFit]);
}

/** The height the level's content asks for: a list's rows (its inner box is the virtualiser's total), an empty state's own lines with its padding. */
function natural(main: HTMLElement): number | undefined {
  const inner = main.querySelector<HTMLElement>(".pal-list__inner");
  if (inner) return inner.offsetHeight;
  const empty = main.querySelector<HTMLElement>(".pal-empty");
  if (!empty || !empty.firstElementChild) return undefined;
  const kids = [...empty.children] as HTMLElement[];
  const top = kids[0].getBoundingClientRect().top, bottom = kids[kids.length - 1].getBoundingClientRect().bottom;
  const pad = parseFloat(getComputedStyle(empty).paddingTop) + parseFloat(getComputedStyle(empty).paddingBottom);
  return bottom - top + pad;
}
