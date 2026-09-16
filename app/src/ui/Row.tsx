import type { CSSProperties, HTMLAttributes, MouseEvent } from "react";
import { Icon } from "./Icon";
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
export function Tag({ text, color, className, style, ...rest }: { text: string; color?: string } & HTMLAttributes<HTMLSpanElement>) {
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
  return <span className="pal-acc">{acc.text}</span>;
}

export type RowProps = {
  item: Item;
  active?: boolean;
  match?: Match;
  id?: string;
  style?: CSSProperties;
  onHover?: (e: MouseEvent) => void;
  onClick?: () => void;
  /** 1-based, shown as the cmd+N hint on the first nine rows. */
  ordinal?: number;
};

export function Row({ item, active, match, id, style, onHover, onClick, ordinal }: RowProps) {
  return (
    <div id={id} role="option" aria-selected={!!active} className="pal-row" data-active={active || undefined} style={style} onMouseMove={onHover} onMouseDown={keepFocus} onClick={onClick}>
      <Icon icon={item.icon} />
      <span className="pal-row__title" data-solo={item.subtitle ? undefined : ""}><Highlight text={item.name} positions={match?.name} /></span>
      {item.subtitle && <span className="pal-row__sub"><Highlight text={item.subtitle} positions={match?.subtitle} /></span>}
      <span className="pal-row__accs">
        {item.accessories?.map((a, i) => <Accessory key={i} acc={a} />)}
        {ordinal !== undefined && ordinal <= 9 && <kbd className="pal-row__ordinal" aria-hidden>{ordinal}</kbd>}
      </span>
    </div>
  );
}
