import type { CSSProperties, MouseEvent } from "react";
import { Icon } from "./Icon";
import { relativeDate } from "./format";
import type { Accessory as AccessorySpec, Item, Match } from "./types";

/** Text with matched characters wrapped in <mark>, one per run. */
export function Highlight({ text, positions }: { text: string; positions?: Set<number> }) {
  if (!positions?.size) return <>{text}</>;
  const chars = [...text];
  const out: (string | { s: string; k: number })[] = [];
  let run = "", hit = false;
  chars.forEach((ch, i) => {
    const h = positions.has(i);
    if (h !== hit && run) { out.push(hit ? { s: run, k: i } : run); run = ""; }
    hit = h;
    run += ch;
  });
  if (run) out.push(hit ? { s: run, k: chars.length } : run);
  return <>{out.map((p) => (typeof p === "string" ? p : <mark key={p.k}>{p.s}</mark>))}</>;
}

const tagNames = new Set(["grey", "blue", "green", "amber", "red", "violet", "pink", "teal"]);

/** A tag: `color` names a token palette (red, green, ...) or is any CSS colour. */
export function Tag({ text, color }: { text: string; color?: string }) {
  const named = color && tagNames.has(color);
  return (
    <span className="pal-tag" data-color={named ? color : color ? "custom" : undefined} style={color && !named ? ({ "--tag": color } as CSSProperties) : undefined}>
      {text}
    </span>
  );
}

export function Accessory({ acc }: { acc: AccessorySpec }) {
  if ("tag" in acc) return <Tag text={acc.tag} color={acc.color} />;
  if ("date" in acc) {
    const d = new Date(acc.date);
    return <time className="pal-acc" dateTime={d.toISOString()} title={d.toLocaleString()}>{relativeDate(d)}</time>;
  }
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
    <div id={id} role="option" aria-selected={!!active} className="pal-row" data-active={active || undefined} style={style} onMouseMove={onHover} onClick={onClick}>
      <Icon icon={item.icon} />
      <span className="pal-row__title"><Highlight text={item.name} positions={match?.name} /></span>
      {item.subtitle && <span className="pal-row__sub"><Highlight text={item.subtitle} positions={match?.subtitle} /></span>}
      <span className="pal-row__accs">
        {item.accessories?.map((a, i) => <Accessory key={i} acc={a} />)}
        {ordinal !== undefined && ordinal <= 9 && <kbd className="pal-row__ordinal">{ordinal}</kbd>}
      </span>
    </div>
  );
}
