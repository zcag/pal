import type { ReactNode } from "react";
import { Presence } from "./presence";

export type PanelProps = {
  search: ReactNode;
  footer?: ReactNode;
  /** Side pane, shown next to the body. */
  aside?: ReactNode;
  /** Overlays: action panel, toast. Positioned against the panel. */
  overlay?: ReactNode;
  children: ReactNode;
};

/** The frame: search row, body (with optional side pane), footer, overlays. `data-footer` lets the scrim stop above the footer. The side pane stays through its exit (fades as the list widens). */
export function Panel({ search, footer, aside, overlay, children }: PanelProps) {
  return (
    <div className="pal-panel" data-footer={footer ? "" : undefined}>
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
