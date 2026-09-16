import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "./Icon";
import { CHECK, Highlight } from "./Row";
import { keepFocus, useCmdHeld } from "./keys";
import { domId, flatten, useGridColumns, useHover, useMetrics, observeRect, ensureVisible } from "./virtual";
import { clickWithModifier, type Hit, type ListHandle } from "./List";
import type { Item } from "./types";

export type GridProps = {
  id: string;
  hits: Hit[];
  cursor: number;
  onCursor: (index: number) => void;
  onPick?: (index: number) => void;
  /** Whether the tile is marked (`selection.ts`). */
  marked?: (item: Item) => boolean;
  /** A cmd+click (ctrl on Linux): mark or unmark the tile instead of picking it. */
  onToggle?: (index: number) => void;
  columns?: number;
  /** Tile width / height. */
  aspect?: number;
  label?: string;
};

/**
 * Tiles in rows of as many columns as the width takes (`columns` is the
 * most; beside a detail pane the list is narrower), virtualised by row, same
 * cursor semantics as List. Row heights follow the tile's aspect and the
 * caption line, so the rows measure themselves and the estimate only has to
 * be close; a change of column count renews the item keys, which drops the
 * virtualiser's size cache so every row measures again.
 */
export const Grid = forwardRef<ListHandle, GridProps>(function Grid({ id, hits, cursor, onCursor, onPick, marked, onToggle, columns = 6, aspect = 1, label }, ref) {
  const scroller = useRef<HTMLDivElement>(null);
  const metrics = useMetrics(scroller);
  const cols = useGridColumns(scroller, metrics, columns);
  const { rows, rowOf } = useMemo(() => flatten(hits.map((h) => h.item), cols), [hits, cols]);
  const cmdHeld = useCmdHeld();
  const { hover, hovered } = useHover(cursor, onCursor);

  const estimateRow = () => {
    const w = scroller.current?.clientWidth;
    return w ? Math.round((w - metrics.inset * 2 - metrics.gap * (cols - 1)) / cols / aspect) + metrics.header : metrics.row * 2;
  };
  const getItemKey = useCallback((i: number) => (rows[i].kind === "header" ? `h${i}` : i), [rows, metrics, cols, aspect]);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    getItemKey,
    observeElementRect: observeRect,
    estimateSize: (i) => (rows[i].kind === "header" ? metrics.header : estimateRow()),
    overscan: 3,
    paddingStart: metrics.pad,
    paddingEnd: metrics.pad,
    scrollPaddingStart: metrics.pad,
    scrollPaddingEnd: metrics.pad,
  });

  useImperativeHandle(ref, () => ({
    columns: () => cols,
    pageSize: () => {
      const rowH = virt.getVirtualItems().find((v) => rows[v.index].kind === "items")?.size ?? estimateRow();
      return Math.max(1, Math.floor((scroller.current?.clientHeight ?? 0) / rowH) - 1) * cols;
    },
  }), [cols, rows, virt]);

  useLayoutEffect(() => {
    if (hovered()) return;
    const row = rowOf[cursor];
    if (row === undefined) return;
    virt.scrollToIndex(row, { align: "auto" });
    if (rows[row - 1]?.kind === "header") virt.scrollToIndex(row - 1, { align: "auto" });
    // The virtualiser's rect can be stale (a footer that appeared, a hidden spell): the DOM has the last word.
    requestAnimationFrame(() => ensureVisible(scroller.current, [domId(id, cursor)]));
  }, [cursor, rows, rowOf, virt, hovered, id]);

  return (
    <div ref={scroller} className="pal-grid" role="grid" id={id} aria-label={label} aria-activedescendant={hits.length ? domId(id, cursor) : undefined} style={{ "--cols": cols } as CSSProperties}>
      <div className="pal-list__inner" style={{ height: virt.getTotalSize() }}>
        {virt.getVirtualItems().map((v) => {
          const row = rows[v.index];
          const style = { transform: `translateY(${v.start}px)` };
          if (row.kind === "header") {
            return (
              <div key={v.key} className="pal-section" role="row" style={style}>
                <span className="pal-section__title" role="rowheader" aria-colspan={cols}>{row.title}</span>
                <span className="pal-section__count" aria-hidden>{row.count}</span>
              </div>
            );
          }
          return (
            <div key={v.key} ref={virt.measureElement} data-index={v.index} className="pal-grid__row" role="row" style={style}>
              {row.items.map((item, k) => {
                const i = row.index + k;
                const isMarked = marked?.(item);
                return (
                  <div key={i} id={domId(id, i)} role="gridcell" aria-selected={i === cursor} aria-checked={isMarked || undefined} className="pal-tile" data-active={i === cursor || undefined} data-marked={isMarked || undefined} onMouseMove={hover(i)} onMouseDown={keepFocus} onClick={(e) => (onToggle && clickWithModifier(e) ? onToggle(i) : onPick?.(i))}>
                    <div className="pal-tile__box" style={{ aspectRatio: aspect }}>
                      <Icon icon={item.icon} size="lg" />
                      {cmdHeld && i < 9 && <kbd className="pal-row__ordinal pal-tile__ordinal" aria-hidden>{i + 1}</kbd>}
                      {isMarked && <span className="pal-tile__check" aria-hidden>{CHECK}</span>}
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
