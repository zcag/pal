import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type MouseEvent, type Ref, type RefObject } from "react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { graphemes, relativeDate, useNow } from "./format";
import { keepFocus } from "./keys";
import type { Accessory as AccessorySpec, Item, Match } from "./types";

/**
 * Text with matched characters wrapped in <mark>, one per run. `positions`
 * index grapheme clusters, as the core reports them: for "🇹🇷 Türkiye" the
 * flag is position 0 and "T" is 2.
 */
export function Highlight({ text, positions }: { text: string; positions?: Set<number> }) {
  if (!positions?.size) return <>{text}</>;
  const runs: { text: string; hit: boolean }[] = [];
  graphemes(text).forEach((g, i) => {
    const hit = positions.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += g;
    else runs.push({ text: g, hit });
  });
  let at = 0;
  return <>{runs.map((r) => { const k = at; at += r.text.length; return r.hit ? <mark key={k}>{r.text}</mark> : r.text; })}</>;
}

const tagNames = new Set(["grey", "blue", "green", "amber", "red", "violet", "pink", "teal"]);

/** A tag: `color` names a token palette (red, green, ...) or is any CSS colour. Other attributes land on the span. */
export function Tag({ text, color, className, style, ...rest }: { text: string; color?: string; ref?: Ref<HTMLSpanElement> } & HTMLAttributes<HTMLSpanElement>) {
  const named = color && tagNames.has(color);
  return (
    <span className={className ? `pal-tag ${className}` : "pal-tag"} data-color={named ? color : color ? "custom" : undefined} style={{ ...style, ...(color && !named ? ({ "--tag": color } as CSSProperties) : undefined) }} {...rest}>
      {text}
    </span>
  );
}

/** "3h" that keeps up with the clock; the raw value when it is not a date. */
function RelativeDate({ value }: { value: string | number | Date }) {
  const now = useNow();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span className="pal-acc">{String(value)}</span>;
  return <time className="pal-acc" dateTime={d.toISOString()} title={d.toLocaleString()}>{relativeDate(d, now)}</time>;
}

export function Accessory({ acc }: { acc: AccessorySpec }) {
  if ("tag" in acc) return <Tag text={acc.tag} color={acc.color} />;
  if ("date" in acc) return <RelativeDate value={acc.date} />;
  if ("keys" in acc) return <Kbd shortcut={acc.keys} className="pal-acc" />;
  return <span className="pal-acc">{acc.text}</span>;
}

/**
 * The order accessories give way in when a row is too narrow for its title
 * (a list beside a detail pane is 296 wide): plain text first, then dates,
 * then tags past the first, each kind from the last; the first tag and key
 * caps stay. Indices into `accs`.
 */
export function accessoryDropOrder(accs: AccessorySpec[] = []): number[] {
  const last = (pick: (a: AccessorySpec, i: number) => boolean) => accs.map((a, i) => (pick(a, i) ? i : -1)).filter((i) => i >= 0).reverse();
  const firstTag = accs.findIndex((a) => "tag" in a);
  return [...last((a) => "text" in a), ...last((a) => "date" in a), ...last((a, i) => "tag" in a && i !== firstTag)];
}

/** A title narrower than this, while ellipsized, has an accessory dropped: the larger of 96px and 40% of the row. */
const TITLE_MIN = 96, TITLE_SHARE = 0.4;

/**
 * Which accessories to hide so the title keeps a readable width. Measured,
 * not estimated: the row renders, the title's width is read, and one more
 * accessory (in `accessoryDropOrder`) goes until the title is at least
 * `min(its text, TITLE_MIN | TITLE_SHARE of the row)`. Each step is a layout
 * effect, so nothing paints mid-way. A resize, a new item or the ordinal
 * appearing starts over from the full set.
 */
function useFitAccessories(item: Item, ordinal: boolean, row: RefObject<HTMLElement | null>, title: RefObject<HTMLElement | null>) {
  const order = useMemo(() => accessoryDropOrder(item.accessories), [item.accessories]);
  const [width, setWidth] = useState(0);
  const [fit, setFit] = useState({ item, width, ordinal, dropped: 0 });
  const dropped = fit.item === item && fit.width === width && fit.ordinal === ordinal ? fit.dropped : 0;
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [row]);
  useLayoutEffect(() => {
    const t = title.current, r = row.current;
    if (!t || !r || dropped >= order.length) return;
    const need = Math.min(t.scrollWidth, Math.max(TITLE_MIN, r.clientWidth * TITLE_SHARE));
    if (t.clientWidth < need - 1) setFit({ item, width, ordinal, dropped: dropped + 1 });
  }, [item, width, ordinal, dropped, order, row, title]);
  return useMemo(() => new Set(order.slice(0, dropped)), [order, dropped]);
}

export type RowProps = {
  item: Item;
  active?: boolean;
  match?: Match;
  id?: string;
  style?: CSSProperties;
  onHover?: (e: MouseEvent) => void;
  onClick?: (e: MouseEvent) => void;
  /** 1-based, shown as the cmd+N hint on the first nine rows. */
  ordinal?: number;
  /** One of the marked rows (`selection.ts`): tinted, with a check at the end. */
  marked?: boolean;
};

/** The check a marked row or tile ends in (md-check_circle in the bundled Nerd Font). */
export const CHECK = "\u{f05e0}";

export function Row({ item, active, match, id, style, onHover, onClick, ordinal, marked }: RowProps) {
  const row = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  const showOrdinal = ordinal !== undefined && ordinal <= 9;
  const hidden = useFitAccessories(item, showOrdinal, row, title);
  return (
    <div ref={row} id={id} role="option" aria-selected={!!active} aria-checked={marked || undefined} aria-disabled={item.disabled || undefined} className="pal-row" data-active={active || undefined} data-marked={marked || undefined} data-disabled={item.disabled || undefined} data-muted={item.muted || undefined} style={style} onMouseMove={onHover} onMouseDown={keepFocus} onClick={onClick}>
      <Icon icon={item.icon} />
      <span ref={title} className="pal-row__title" data-solo={item.subtitle ? undefined : ""}><Highlight text={item.name} positions={match?.name} /></span>
      {item.subtitle && <span className="pal-row__sub"><Highlight text={item.subtitle} positions={match?.subtitle} /></span>}
      <span className="pal-row__accs">
        {item.accessories?.map((a, i) => (hidden.has(i) ? null : <Accessory key={i} acc={a} />))}
        {showOrdinal && <kbd className="pal-row__ordinal" aria-hidden>{ordinal}</kbd>}
        {marked && <span className="pal-row__check" aria-hidden>{CHECK}</span>}
      </span>
    </div>
  );
}
