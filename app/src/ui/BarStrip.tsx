/**
 * A bar item as each target draws it, on the band the gallery's shots and
 * the Settings > Bar preview share. Nothing here decides what an item
 * looks like: `bar-model.ts` says what the real renderers draw
 * (`describeMenubar`, `describeSketchy`; held to them by
 * `__tests__/bar-parity.test.ts`) and this file only lays that out on a
 * band (docs/design/screenshots.md, "Parity").
 *
 * Menu bar: 24 pt tall, 13 pt system text, 22 px between items, Apple's own
 * items (battery, Wi-Fi, Control Center, the clock) at the right and pal's
 * to their left. pal's item is its image (the glyph, a glyph run or the
 * prerendered text, the dot, the progress fill; the bar's ink when a
 * template, else its own) then the title in the bar's text colour.
 * sketchybar: a flat 26 px bar with San Francisco 14 labels and the icon
 * font at 15, pal's items one sketchybar item each (a segment and the count
 * are items of their own), drawn from their properties.
 */
import type { CSSProperties, ReactNode } from "react";
import { clipText, cssOf, describeMenubar, describeSketchy, hasGlyph, labelSize, shapeItem, type MenubarDescribed } from "./bar-model";

export { clipText, shapeItem };

export type BarColor = "grey" | "blue" | "green" | "amber" | "red" | "violet" | "pink" | "teal" | "text" | "muted" | "accent" | "destructive";
export type BarSegment = { id: string; icon?: string; text?: string; color?: BarColor | string };
/** The strip's part of an extension's `BarItem` (sdk `protocol.ts`), in its wire spelling: what `bar-model.ts` reads. */
export type BarStripItem = {
  hidden?: boolean; icon?: string | { image: string; template?: boolean } | { app: string }; title?: string; segments?: BarSegment[]; badge?: number | "dot";
  color?: BarColor | string | null; urgent?: boolean; stale?: boolean; progress?: number; tooltip?: string;
  /** sketchybar only: a band behind the item (`sketchybar.rs`, 22 pt, rounded), the ink by contrast unless `color` names one. */
  background?: string;
  icon_size?: number; label_size?: number; icon_width?: number;
};
export type BarStripTarget = "menubar" | "sketchybar";
export type BarStripTheme = "dark" | "light";

/** `pal_core::config::BarLook`, resolved: the target's defaults with the item's keys on top. */
export type BarLook = {
  dim: number;
  opacity: number;
  size: number;
  iconSize: number;
  textSize: number;
  spacing: number;
  showIcon: boolean;
  icon?: string;
  showTitle: boolean;
  color?: string;
  urgentColor: string;
  badgeColor?: string;
  badgeStyle: "count" | "dot" | "none";
  width: number;
  font: "system" | "mono";
  maxChars: number;
};

export const defaultLook: BarLook = { dim: 50, opacity: 100, size: 0, iconSize: 0, textSize: 0, spacing: 4, showIcon: true, showTitle: true, urgentColor: "destructive", badgeStyle: "count", width: 0, font: "system", maxChars: 32 };


export const MENUBAR_H = 24, SKETCHYBAR_H = 26;

/**
 * Text with each Nerd glyph in the symbols font: the gallery's stand-in for
 * the renderers' own glyph drawing (`glyph::strip` takes each from the
 * symbols font; sketchybar's icon font is a Nerd Font).
 */
function Runs({ text, className, style, mono }: { text: string; className?: string; style?: CSSProperties; mono?: boolean }) {
  const out: ReactNode[] = [];
  let plain = "", sym = "";
  const flush = () => {
    // sketchybar's icon font is a monospaced Nerd Font: the progress rule's box drawing is a cell a character there.
    if (plain) out.push(<span key={out.length} className={mono ? "g-sb__mono" : undefined}>{plain}</span>);
    if (sym) out.push(<span key={out.length} data-symbol>{sym}</span>);
    plain = sym = "";
  };
  for (const ch of text) {
    if (hasGlyph(ch) || (sym && /\s/.test(ch))) { if (plain) flush(); sym += ch; } else { if (sym) flush(); plain += ch; }
  }
  flush();
  return <span className={className} style={style}>{out}</span>;
}

// ---- menu bar -----------------------------------------------------------------

/** Apple's items at the right of every bar, as neutral template glyphs. */
const Battery = () => (
  <svg className="g-mb__glyph" width="25" height="12" viewBox="0 0 25 12" aria-hidden>
    <rect x="0.5" y="0.5" width="21" height="11" rx="2.5" fill="none" stroke="currentColor" strokeOpacity="0.45" />
    <rect x="2" y="2" width="15" height="8" rx="1.2" fill="currentColor" />
    <path d="M23 4.2v3.6a2 2 0 0 0 1-1.8 2 2 0 0 0-1-1.8z" fill="currentColor" fillOpacity="0.45" />
  </svg>
);
const Wifi = () => (
  <svg className="g-mb__glyph" width="16" height="12" viewBox="0 0 16 12" aria-hidden>
    <path d="M0.6 3.6a11 11 0 0 1 14.8 0l-1.35 1.4a9 9 0 0 0-12.1 0z" fill="currentColor" />
    <path d="M3.3 6.4a7.2 7.2 0 0 1 9.4 0l-1.35 1.4a5.2 5.2 0 0 0-6.7 0z" fill="currentColor" />
    <path d="M6 9.2a3.4 3.4 0 0 1 4 0L8 11.4z" fill="currentColor" />
  </svg>
);
const ControlCenter = () => (
  <svg className="g-mb__glyph" width="17" height="15" viewBox="0 0 17 15" aria-hidden>
    <rect x="0.5" y="0.5" width="16" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <circle cx="13.5" cy="3.5" r="2" fill="currentColor" />
    <rect x="0.5" y="8.5" width="16" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <circle cx="3.5" cy="11.5" r="2" fill="currentColor" />
  </svg>
);

/** The status item's image: the glyph (or run) and the prerendered text in the ink, the count in the badge's, the dot, the progress fill. */
function MenubarImage({ d, item, textPx }: { d: MenubarDescribed; item: BarStripItem; textPx?: number }) {
  const ink = d.template || !d.ink ? "var(--g-mb-fg)" : d.ink;
  const alpha = d.alpha < 100 ? d.alpha / 100 : undefined;
  const src = typeof item.icon === "object" && item.icon && "image" in item.icon ? item.icon.image : typeof item.icon === "object" && item.icon && "app" in item.icon ? `icon://localhost/app?path=${encodeURIComponent(item.icon.app)}&size=36` : undefined;
  const count = typeof item.badge === "number" ? ` ·${item.badge}` : "";
  const text = d.image_text ?? "";
  const [words, tail] = count && text.endsWith(count.trimStart()) ? [text.slice(0, text.length - count.trimStart().length), text.slice(text.length - count.trimStart().length)] : [text, ""];
  return (
    <span className="g-mb__image" data-progress={d.progress !== null || undefined} style={{ color: ink }}>
      {d.icon === "image" && src && <img className="g-mb__picture" src={src} alt="" />}
      {d.glyph && <Runs text={d.glyph} className="g-mb__icon" style={{ opacity: alpha, fontSize: d.size > 0 ? d.size : undefined }} />}
      {text && <Runs text={words} className="g-mb__itext" style={{ opacity: alpha, fontSize: textPx }} />}
      {tail && <span className="g-mb__itext" style={{ color: d.badge_ink ?? undefined, fontSize: textPx }}>{tail}</span>}
      {d.dot && <span className="g-mb__dot" style={{ background: d.badge_ink ?? ink }} />}
      {d.progress !== null && <span className="g-mb__progress"><span style={{ width: `${Math.round(Math.min(1, Math.max(0, d.progress)) * 100)}%` }} /></span>}
    </span>
  );
}

/** One `NSStatusItem`: the image `ImageLeft` of the title (`menubar::describe`). */
export function MenubarItem({ item, look = defaultLook, dark, anchor }: { item: BarStripItem; look?: BarLook; dark: boolean; anchor?: (el: HTMLElement | null) => void }) {
  const d = describeMenubar(item, look, dark);
  const image = d.icon === "glyph" || d.icon === "run" || d.icon === "image" || d.image_text !== null;
  const style: CSSProperties = { opacity: d.opacity < 100 ? d.opacity / 100 : undefined, fontFamily: look.font === "mono" && d.image_text !== null ? "var(--pal-font-mono, ui-monospace, monospace)" : undefined };
  if (look.width > 0 && d.image_text) { style.width = look.width; style.overflow = "hidden"; }
  return (
    <span ref={anchor} className="g-mb__item g-mb__pal" title={item.tooltip} style={style}>
      {image && <MenubarImage d={d} item={item} textPx={labelSize(item, look) > 0 ? labelSize(item, look) : undefined} />}
      {d.title && <Runs text={d.title} className="g-mb__title" />}
    </span>
  );
}

export function MenuBar({ items, look, dark, anchor, bare }: { items: BarStripItem[]; look?: BarLook; dark: boolean; anchor?: (el: HTMLElement | null) => void; bare?: boolean }) {
  return (
    <div className="g-mb" style={{ height: MENUBAR_H }}>
      <div className="g-mb__items">
        {items.map((it, i) => <MenubarItem key={i} item={it} look={look} dark={dark} anchor={i === 0 ? anchor : undefined} />)}
        {!bare && <span className="g-mb__item"><Battery /></span>}
        {!bare && <span className="g-mb__item"><Wifi /></span>}
        <span className="g-mb__item"><ControlCenter /></span>
        <span className="g-mb__item g-mb__clock">Tue 16 Sep<span className="g-mb__time">14:32</span></span>
      </div>
    </div>
  );
}

// ---- sketchybar ---------------------------------------------------------------

/** A sketchybar of its own look: the bar and its neighbours (volume, battery, clock); pal's items take their colours from pal's palette, as the renderer does. */
const SKETCHY = { dark: { base: "#303446", text: "#c6d0f5" }, light: { base: "#faf4ed", text: "#575279" } } as const;

const px = (v: string | undefined) => (v === undefined ? undefined : Number(v));

/** pal's sketchybar items for one bar item, from their properties (`sketchybar::props`): the main item, then its segments and its count. */
export function SketchyItem({ item, look = defaultLook, dark, anchor }: { item: BarStripItem; look?: BarLook; dark: boolean; anchor?: (el: HTMLElement | null) => void }) {
  const props = describeSketchy(item, look, dark);
  const main = props[0];
  const band: CSSProperties = main["background.drawing"] === "on" ? { background: cssOf(main["background.color"]), borderRadius: px(main["background.corner_radius"]), height: px(main["background.height"]) } : {};
  return (
    <span ref={anchor} className="g-sb__group" style={band}>
      {props.map((p, i) => p.drawing === "off" ? null : (
        <span key={i} className="g-sb__item">
          {p["icon.drawing"] === "on" && (
            <Runs text={p.icon} mono className="g-sb__icon" style={{ color: cssOf(p["icon.color"]), fontSize: px(p["icon.font.size"]), paddingLeft: px(p["icon.padding_left"]), paddingRight: px(p["icon.padding_right"]), width: px(p["icon.width"]) }} />
          )}
          {p["label.drawing"] === "on" && (
            <span className="g-sb__label" style={{ color: cssOf(p["label.color"]), fontSize: px(p["label.font.size"]), fontFamily: p["label.font.family"] ? "Menlo, ui-monospace, monospace" : undefined, paddingLeft: px(p["label.padding_left"]), paddingRight: px(p["label.padding_right"]), width: px(p["label.width"]), overflow: p["label.width"] ? "hidden" : undefined }}>
              {p.label}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

export function Sketchybar({ items, look, dark, anchor, bare }: { items: BarStripItem[]; look?: BarLook; dark: boolean; anchor?: (el: HTMLElement | null) => void; bare?: boolean }) {
  const bar = SKETCHY[dark ? "dark" : "light"];
  return (
    <div className="g-sb" style={{ height: SKETCHYBAR_H, background: bar.base, color: bar.text }}>
      <div className="g-sb__items">
        {items.map((it, i) => <SketchyItem key={i} item={it} look={look} dark={dark} anchor={i === 0 ? anchor : undefined} />)}
        {!bare && <span className="g-sb__item"><Runs text={"\u{f057e}"} className="g-sb__icon g-sb__icon--opt" style={{ paddingRight: 8 }} /></span>}
        <span className="g-sb__item"><Runs text={"\u{f0081}"} className="g-sb__icon" /><span className="g-sb__label">82%</span></span>
        <span className="g-sb__item"><span className="g-sb__label">Tue Sep 16 14:32</span></span>
      </div>
    </div>
  );
}

// ---- the strip ------------------------------------------------------------------

export type BarStripProps = {
  items: BarStripItem[];
  target: BarStripTarget;
  theme: BarStripTheme;
  /** The item's look, applied through `shapeItem`; the defaults when absent. */
  look?: BarLook;
  /** The strip's size: 720 by 60 for a shot; the band alone plus a sliver of desktop for a preview. */
  width?: number | string;
  height?: number;
  /** Fewer of Apple's / the bar's own items, for a narrow preview. */
  bare?: boolean;
  anchor?: (el: HTMLElement | null) => void;
  children?: ReactNode;
};

/** The band at the top over the desktop; `children` go over the strip (a popover, a HUD). */
export function BarStrip({ items, target, theme, look = defaultLook, width = 720, height, bare, anchor, children }: BarStripProps) {
  const shaped = items.map((it) => shapeItem(it, look)).filter((it) => !it.hidden);
  const bandH = target === "menubar" ? MENUBAR_H : SKETCHYBAR_H;
  const dark = theme === "dark";
  return (
    <div className="g-bar" data-theme={theme} data-target={target} style={{ width, height: height ?? bandH + 36 }}>
      {target === "menubar" ? <MenuBar items={shaped} look={look} dark={dark} anchor={anchor} bare={bare} /> : <Sketchybar items={shaped} look={look} dark={dark} anchor={anchor} bare={bare} />}
      {children}
    </div>
  );
}
