import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Row } from "./Row";
import { useCmdHeld } from "./keys";
import { domId, flatten, useHover, useMetrics, observeRect } from "./virtual";
import type { Item, Match } from "./types";

export type Hit = { item: Item; match?: Match };

/** What the key handler asks a list: rows per page, and tiles per row (1 for a list; a grid's follows its width). */
export type ListHandle = { pageSize(): number; columns(): number };

export type ListProps = {
  id: string;
  hits: Hit[];
  cursor: number;
  onCursor: (index: number) => void;
  onPick?: (index: number) => void;
  label?: string;
};

/**
 * Virtualised list with section headers. Items are shown in the order given;
 * a `section` change starts a new header (see `groupBySection`). Headers
 * scroll with the rows, as in Raycast: a sticky one would sit over the
 * cursor row whenever the cursor is the first in its section.
 */
export const List = forwardRef<ListHandle, ListProps>(function List({ id, hits, cursor, onCursor, onPick, label }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const metrics = useMetrics(scroller);
  const { rows, rowOf } = useMemo(() => flatten(hits.map((h) => h.item)), [hits]);
  const cmdHeld = useCmdHeld();
  const { hover, hovered } = useHover(cursor, onCursor);

  // The virtualiser caches sizes per key function: a new one when rows or sizes change drops the cache.
  const getItemKey = useCallback((i: number) => (rows[i].kind === "header" ? `h${i}` : i), [rows, metrics]);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    getItemKey,
    observeElementRect: observeRect,
    estimateSize: (i) => (rows[i].kind === "header" ? metrics.header : metrics.row),
    overscan: 10,
    paddingStart: metrics.pad,
    paddingEnd: metrics.pad,
    scrollPaddingStart: metrics.pad,
    scrollPaddingEnd: metrics.pad,
  });

  useImperativeHandle(ref, () => ({ columns: () => 1, pageSize: () => Math.max(1, Math.floor((scroller.current?.clientHeight ?? 0) / metrics.row) - 1) }), [metrics.row]);

  // Keep the cursor in view when it moves or the rows change; `align: auto` is a no-op while it is already visible. A hover never scrolls.
  useLayoutEffect(() => {
    if (hovered()) return;
    const row = rowOf[cursor];
    if (row === undefined) return;
    virt.scrollToIndex(row, { align: "auto" });
    if (rows[row - 1]?.kind === "header") virt.scrollToIndex(row - 1, { align: "auto" });
  }, [cursor, rows, rowOf, virt, hovered]);

  return (
    <div ref={scroller} className="pal-list" role="listbox" id={id} aria-label={label} aria-activedescendant={hits.length ? domId(id, cursor) : undefined}>
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
          const i = row.index;
          return (
            <Row
              key={v.key}
              id={domId(id, i)}
              item={row.items[0]}
              match={hits[i].match}
              active={i === cursor}
              style={style}
              ordinal={cmdHeld ? i + 1 : undefined}
              onHover={hover(i)}
              onClick={() => onPick?.(i)}
            />
          );
        })}
      </div>
    </div>
  );
});
