import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "./Icon";
import { Highlight } from "./Row";
import { useCmdHeld } from "./keys";
import { domId, flatten, useMetrics } from "./virtual";
import type { Hit, ListHandle } from "./List";

export type GridProps = {
  id: string;
  hits: Hit[];
  cursor: number;
  onCursor: (index: number) => void;
  onPick?: (index: number) => void;
  columns?: number;
  /** Tile width / height. */
  aspect?: number;
  label?: string;
};

/** Tiles in rows of `columns`, virtualised by row, same cursor semantics as List. */
export const Grid = forwardRef<ListHandle, GridProps>(function Grid({ id, hits, cursor, onCursor, onPick, columns = 6, aspect = 1, label }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const metrics = useMetrics(scroller);
  const [tileH, setTileH] = useState(96);
  const { rows, rowOf } = useMemo(() => flatten(hits.map((h) => h.item), columns), [hits, columns]);
  const cmdHeld = useCmdHeld();
  const mouse = useRef({ x: 0, y: 0, hovered: false });

  // Tile height follows the width: (inner width - gaps) / columns / aspect, plus the label line.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - metrics.pad * 2 - metrics.pad * (columns - 1);
      setTileH(Math.round(w / columns / aspect) + metrics.header);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns, aspect, metrics]);

  const getItemKey = useCallback((i: number) => (rows[i].kind === "header" ? `h${i}` : i), [rows, metrics, tileH]);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    getItemKey,
    estimateSize: (i) => (rows[i].kind === "header" ? metrics.header : tileH + metrics.pad),
    overscan: 3,
    paddingStart: metrics.pad,
    paddingEnd: metrics.pad,
    scrollPaddingStart: metrics.pad,
    scrollPaddingEnd: metrics.pad,
  });

  useImperativeHandle(ref, () => ({
    pageSize: () => Math.max(1, Math.floor((scroller.current?.clientHeight ?? 0) / (tileH + metrics.pad)) - 1) * columns,
  }), [columns, tileH, metrics.pad]);

  useLayoutEffect(() => {
    if (mouse.current.hovered) { mouse.current.hovered = false; return; }
    const row = rowOf[cursor];
    if (row === undefined) return;
    virt.scrollToIndex(row, { align: "auto" });
    if (rows[row - 1]?.kind === "header") virt.scrollToIndex(row - 1, { align: "auto" });
  }, [cursor, rows, rowOf, virt]);

  const hover = (index: number) => (e: MouseEvent) => {
    const m = mouse.current;
    if (e.clientX === m.x && e.clientY === m.y) return;
    m.x = e.clientX; m.y = e.clientY;
    if (index !== cursor) { m.hovered = true; onCursor(index); }
  };

  return (
    <div ref={scroller} className="pal-grid" role="listbox" id={id} aria-label={label} aria-activedescendant={hits.length ? domId(id, cursor) : undefined} style={{ "--cols": columns } as CSSProperties}>
      <div className="pal-list__inner" style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map((v) => {
          const row = rows[v.index];
          const style = { transform: `translateY(${v.start}px)` };
          if (row.kind === "header") {
            return (
              <div key={v.key} className="pal-section" role="presentation" style={style}>
                <span className="pal-section__title">{row.title}</span>
                <span className="pal-section__count">{row.count}</span>
              </div>
            );
          }
          return (
            <div key={v.key} className="pal-grid__row" role="presentation" style={style}>
              {row.items.map((item, k) => {
                const i = row.index + k;
                return (
                  <div key={i} id={domId(id, i)} role="option" aria-selected={i === cursor} className="pal-tile" data-active={i === cursor || undefined} onMouseMove={hover(i)} onClick={() => onPick?.(i)}>
                    <div className="pal-tile__box" style={{ aspectRatio: aspect }}>
                      <Icon icon={item.icon} size="lg" />
                      {cmdHeld && i < 9 && <kbd className="pal-row__ordinal pal-tile__ordinal">{i + 1}</kbd>}
                    </div>
                    <span className="pal-tile__label"><Highlight text={item.name} positions={hits[i].match?.name} /></span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
