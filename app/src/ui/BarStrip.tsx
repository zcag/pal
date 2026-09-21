/**
 * A bar item as each target draws it (docs/design/bar.md, "Mapping"), on
 * a band the gallery's shots and the Settings > Bar preview share. The
 * band is drawn from the bar's geometry, not captured. Menu bar: 24 pt
 * tall, 13 pt system text, template glyphs in the text colour, 22 px
 * between items, Apple's own items (battery, Wi-Fi, Control Center, the
 * clock) at the right and pal's to their left; the glyph is the
 * renderer's prerendered 18 pt image (`bar/menubar.rs`): badge and
 * progress drawn into it, tinted only when `color` or `urgent` says so.
 * sketchybar: the owner's flat 26 px Catppuccin Frappe bar
 * (`~/.config/sketchybar/{theme,colors}.sh`), San Francisco 14 for
 * labels, the icon font at 15, icon padding 8/4 and label padding 4/8,
 * no pills at rest; the `urgent` tint is the one box drawn.
 *
 * The look (`[bar.menubar]` / `[bar.sketchybar]` with the item's
 * overrides, `BarLook`) is applied the way the renderers apply it:
 * `shapeItem` drops the icon or the text, puts the look's own `icon` in,
 * maps the badge and tints; `dim` is a muted item's opacity, `opacity`
 * the whole item's, `size` the glyph and text size (`icon_size` /
 * `text_size` each alone), `spacing` the gaps, `width` a fixed item
 * width, `font` the text face, `max_chars` the cut, `badge_color` the
 * badge's colour (the item's when unset).
 */
import type { CSSProperties, ReactNode } from "react";

export type BarColor = "grey" | "blue" | "green" | "amber" | "red" | "violet" | "pink" | "teal" | "text" | "muted" | "accent" | "destructive";
export type BarSegment = { id: string; icon?: string; text?: string; color?: BarColor | string };
export type BarStripItem = {
  hidden?: boolean; icon?: string; title?: string; segments?: BarSegment[]; badge?: number | "dot";
  color?: BarColor | string | null; urgent?: boolean; stale?: boolean; progress?: number; tooltip?: string;
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

/** `Draw::icon_size` / `label_size`: the split size, else `size`. */
export const iconSizeOf = (look: BarLook) => look.iconSize || look.size;
export const textSizeOf = (look: BarLook) => look.textSize || look.size;

export const MENUBAR_H = 24, SKETCHYBAR_H = 26;

/** `menubar::clip`: `s` cut to `max` characters with an ellipsis, on a word edge when one is near. */
export function clipText(s: string, max: number): string {
  const chars = [...s];
  if (chars.length <= max) return s;
  const cut = Math.max(0, max - 1);
  let keep = chars.slice(0, cut).join("");
  const midWord = chars[cut] !== " ";
  const space = keep.lastIndexOf(" ");
  if (midWord && space >= 0 && space >= (keep.length * 2) / 3) keep = keep.slice(0, space);
  return `${keep.trimEnd()}…`;
}

/** `BarItem::shaped`: the item with the look applied, hidden when nothing is left to draw. */
export function shapeItem(item: BarStripItem, look: BarLook): BarStripItem {
  const out: BarStripItem = { ...item };
  if (look.icon?.trim()) out.icon = look.icon.trim();
  if (!look.showIcon) delete out.icon;
  if (!look.showTitle) { delete out.title; out.segments = []; }
  if (look.badgeStyle === "none") delete out.badge;
  else if (look.badgeStyle === "dot" && typeof out.badge === "number") out.badge = "dot";
  if (look.color && out.color !== "muted") out.color = look.color;
  if (!out.icon && !out.title && !(out.segments?.length) && out.badge === undefined) out.hidden = true;
  return out;
}

const isMuted = (item: BarStripItem) => !item.urgent && (item.stale || item.color === "muted");
const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c) || /^0x[0-9a-f]{8}$/i.test(c);
const hexOf = (c: string) => (c.startsWith("0x") ? `#${c.slice(4)}` : c);
/** `#rrggbb` at `alpha`. */
const withAlpha = (hex: string, alpha: number) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : hex;
};

/** A run of the strip: a Nerd glyph in the symbols font, anything else in the text font. */
function Glyph({ value, className, style }: { value: string; className?: string; style?: CSSProperties }) {
  return <span className={className} data-symbol={/^[\p{Co}]$/u.test(value) || undefined} style={style}>{value}</span>;
}

// ---- menu bar -----------------------------------------------------------------

/** A pal token for a colour spec on the menu bar (the tag palette; `text` is the bar's own colour, `muted` its 55% alpha; hex as is). */
const menubarColor = (c: string | null | undefined): string | undefined => {
  if (!c || c === "text") return undefined;
  if (c === "muted") return "var(--g-mb-muted)";
  if (isHex(c)) return hexOf(c);
  if (c === "accent" || c === "destructive") return `var(--pal-${c})`;
  return `var(--pal-tag-${c})`;
};

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

/** The renderer's 18 pt image: the glyph, the badge in its corner (in `badge` colour, else the ink's), the progress fill along its bottom. */
function MenubarImage({ item, tint, badge: badgeColor, size, dim }: { item: BarStripItem; tint?: string; badge?: string; size: number; dim?: number }) {
  const badge = item.badge;
  const mark: CSSProperties = { background: badgeColor ?? "currentColor" };
  return (
    <span className="g-mb__image" data-progress={typeof item.progress === "number" || undefined} style={{ color: tint, opacity: dim }}>
      {item.icon && <Glyph value={item.icon} className="g-mb__icon" style={size ? { fontSize: Math.min(18, size + 2) } : undefined} />}
      {badge === "dot" && <span className="g-mb__dot" style={mark} />}
      {typeof badge === "number" && <span className="g-mb__count" style={mark}>{badge > 99 ? "99+" : badge}</span>}
      {typeof item.progress === "number" && (
        <span className="g-mb__progress"><span style={{ width: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%` }} /></span>
      )}
    </span>
  );
}

/** The text beside the image (`menubar::body`): the title, the segments two spaces apart, the count as ` ·n` when there is no image to carry it. */
function menubarRuns(item: BarStripItem, look: BarLook): ReactNode[] {
  const runs: ReactNode[] = [];
  const parts: string[] = [];
  if (item.title) parts.push(item.title);
  for (const s of item.segments ?? []) parts.push([s.icon, s.text].filter(Boolean).join(" "));
  let text = parts.filter(Boolean).join("  ");
  if (typeof item.badge === "number" && !item.icon) text += ` ·${item.badge}`;
  text = clipText(text.trim(), look.maxChars);
  if (!text) return runs;
  // Each Nerd glyph inside the text takes the symbols font.
  let plain = "";
  for (const ch of text) {
    if (/^[\p{Co}]$/u.test(ch)) {
      if (plain) runs.push(<span key={runs.length}>{plain}</span>);
      plain = "";
      runs.push(<Glyph key={runs.length} value={ch} className="g-mb__seg-icon" />);
    } else plain += ch;
  }
  if (plain) runs.push(<span key={runs.length}>{plain}</span>);
  return runs;
}

/** One `NSStatusItem`: the image, `ImageLeft` of the title; the title in the one text colour unless the look prerenders it. */
export function MenubarItem({ item, look = defaultLook, anchor }: { item: BarStripItem; look?: BarLook; anchor?: (el: HTMLElement | null) => void }) {
  const tint = item.urgent ? menubarColor(look.urgentColor) ?? "var(--pal-destructive)" : menubarColor(item.color);
  // `Draw::badge_tint`: the look's badge colour, else the tint; stale mutes it with the rest.
  const badge = item.stale && !item.urgent ? undefined : look.badgeColor ? menubarColor(look.badgeColor) : tint;
  const runs = menubarRuns(item, look);
  const prerendered = look.font === "mono" || iconSizeOf(look) > 0 || textSizeOf(look) > 0 || look.width > 0 || look.opacity < 100 || !!look.badgeColor;
  const style: CSSProperties = { gap: look.spacing === 4 ? undefined : look.spacing + 1 };
  if (look.width > 0) { style.width = look.width; style.overflow = "hidden"; }
  // A muted item is the template image at `dim`; the title text keeps the bar's colour unless it is in the image too. `opacity` is the whole item's, prerendered.
  const dim = isMuted(item) ? look.dim / 100 : undefined;
  if (dim !== undefined && prerendered) style.opacity = dim;
  if (look.opacity < 100) style.opacity = (dim !== undefined && prerendered ? dim : 1) * look.opacity / 100;
  const text: CSSProperties = {};
  if (tint && prerendered) text.color = tint;
  if (textSizeOf(look) > 0) text.fontSize = textSizeOf(look);
  if (look.font === "mono") text.fontFamily = "var(--pal-font-mono, ui-monospace, monospace)";
  return (
    <span ref={anchor} className="g-mb__item g-mb__pal" data-muted={dim !== undefined || undefined} title={item.tooltip} style={style}>
      {item.icon && <MenubarImage item={item} tint={tint} badge={badge} size={iconSizeOf(look)} dim={prerendered ? undefined : dim} />}
      {runs.length > 0 && <span className="g-mb__title" style={text}>{runs}</span>}
    </span>
  );
}

export function MenuBar({ items, look, anchor, bare }: { items: BarStripItem[]; look?: BarLook; anchor?: (el: HTMLElement | null) => void; bare?: boolean }) {
  return (
    <div className="g-mb" style={{ height: MENUBAR_H }}>
      <div className="g-mb__items">
        {items.map((it, i) => <MenubarItem key={i} item={it} look={look} anchor={i === 0 ? anchor : undefined} />)}
        {!bare && <span className="g-mb__item"><Battery /></span>}
        {!bare && <span className="g-mb__item"><Wifi /></span>}
        <span className="g-mb__item"><ControlCenter /></span>
        <span className="g-mb__item g-mb__clock">Tue 16 Sep<span className="g-mb__time">14:32</span></span>
      </div>
    </div>
  );
}

// ---- sketchybar ---------------------------------------------------------------

/** The owner's two sketchybar palettes (colors.sh), the roles pal's `BarColor` lands on. */
const SKETCHY = {
  dark: { base: "#303446", text: "#c6d0f5", dim: "#7c8299", dimmer: "#535766", urgentBg: "#4f3352",
    map: { grey: "#7c8299", blue: "#8caaee", green: "#a6d189", amber: "#ef9f76", red: "#e78284", violet: "#ca9ee6", pink: "#f4b8e4", teal: "#81c8be", text: "#c6d0f5", muted: "#7c8299", accent: "#8caaee", destructive: "#e78284" } },
  light: { base: "#faf4ed", text: "#575279", dim: "#797593", dimmer: "#9893a5", urgentBg: "#f0dde2",
    map: { grey: "#797593", blue: "#286983", green: "#286983", amber: "#d7827e", red: "#b4637a", violet: "#907aa9", pink: "#b4637a", teal: "#56949f", text: "#575279", muted: "#797593", accent: "#286983", destructive: "#b4637a" } },
} as const;

/** The owner's timer rule: eight cells of heavy and light box drawing, the heavy ones the elapsed share. */
const rule = (p: number) => { const n = Math.round(Math.min(1, Math.max(0, p)) * 8); return "━".repeat(n) + "─".repeat(8 - n); };

/** One sketchybar item (or, with segments, a bracket of them): `icon` then `label`, the owner's paddings, colours from the map. */
export function SketchyItem({ item, theme, look = defaultLook, anchor }: { item: BarStripItem; theme: BarStripTheme; look?: BarLook; anchor?: (el: HTMLElement | null) => void }) {
  const pal = SKETCHY[theme];
  const spec = (c: string | null | undefined, fallback: string) => (c ? (isHex(c) ? hexOf(c) : (pal.map as Record<string, string>)[c] ?? fallback) : fallback);
  const muted = withAlpha(pal.map.muted, look.dim / 100);
  const colorOf = (c: string | null | undefined, fallback: string) => (item.stale ? muted : c === "muted" ? muted : spec(c, fallback));
  const itemColor = item.urgent ? spec(look.urgentColor, pal.map.destructive) : colorOf(item.color, pal.text);
  // `Draw::badge_tint`: the look's badge colour, else the item's; stale mutes it with the rest.
  const badgeColor = item.stale && !item.urgent ? muted : look.badgeColor ? spec(look.badgeColor, itemColor) : itemColor;
  const iconColor = item.badge === "dot" ? badgeColor : itemColor;
  const title = item.title ? clipText(item.title, look.maxChars) : "";
  const label = [title, typeof item.badge === "number" ? <span key="b" style={{ color: badgeColor }}>{title ? " " : ""}{item.badge}</span> : null].filter(Boolean);
  const hasLabel = label.length > 0;
  const font: CSSProperties = {};
  if (textSizeOf(look) > 0) font.fontSize = textSizeOf(look);
  if (look.font === "mono") font.fontFamily = "Menlo, ui-monospace, monospace";
  const iconFont = iconSizeOf(look) > 0 ? iconSizeOf(look) + 1 : undefined;
  const labelStyle: CSSProperties = { color: itemColor, ...font };
  if (look.width > 0 && title) { labelStyle.minWidth = look.width; labelStyle.maxWidth = look.width; labelStyle.overflow = "hidden"; }
  const sp = look.spacing;
  // `opacity` is every colour's alpha on sketchybar; the strip fades the group as one.
  const group: CSSProperties = { ...(item.urgent ? { background: pal.urgentBg } : {}), ...(look.opacity < 100 ? { opacity: look.opacity / 100 } : {}) };
  return (
    <span ref={anchor} className="g-sb__group" data-urgent={item.urgent || undefined} style={group}>
      <span className="g-sb__item">
        {typeof item.progress === "number" && <span className="g-sb__rule" style={{ color: iconColor }}>{rule(item.progress)}</span>}
        {item.icon && <Glyph value={item.icon} className="g-sb__icon" style={{ color: iconColor, paddingRight: hasLabel || item.segments?.length ? sp : 8, fontSize: iconFont }} />}
        {hasLabel && <span className="g-sb__label" style={labelStyle}>{label}</span>}
      </span>
      {item.segments?.map((s) => (
        <span key={s.id} className="g-sb__item">
          {s.icon && <Glyph value={s.icon} className="g-sb__icon" style={{ color: colorOf(s.color ?? item.color, pal.text), paddingLeft: sp, paddingRight: s.text ? 2 : 8, fontSize: iconFont }} />}
          {s.text && <span className="g-sb__label" style={{ color: colorOf(s.color ?? item.color, pal.text), paddingLeft: s.icon ? 0 : sp, ...font }}>{s.text}</span>}
        </span>
      ))}
    </span>
  );
}

export function Sketchybar({ items, theme, look, anchor, bare }: { items: BarStripItem[]; theme: BarStripTheme; look?: BarLook; anchor?: (el: HTMLElement | null) => void; bare?: boolean }) {
  const pal = SKETCHY[theme];
  return (
    <div className="g-sb" style={{ height: SKETCHYBAR_H, background: pal.base, color: pal.text }}>
      <div className="g-sb__items">
        {items.map((it, i) => <SketchyItem key={i} item={it} theme={theme} look={look} anchor={i === 0 ? anchor : undefined} />)}
        {!bare && <span className="g-sb__item"><Glyph value={"\u{f057e}"} className="g-sb__icon g-sb__icon--opt" style={{ paddingRight: 8 }} /></span>}
        <span className="g-sb__item"><Glyph value={"\u{f0081}"} className="g-sb__icon" /><span className="g-sb__label">82%</span></span>
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
  /** Applied through `shapeItem` and the band's styling; the defaults when absent. */
  look?: BarLook;
  /** The strip's size: 720 by 60 for a shot; the band alone plus a sliver of desktop for a preview. */
  width?: number | string;
  height?: number;
  /** Fewer of Apple's / the owner's own items, for a narrow preview. */
  bare?: boolean;
  anchor?: (el: HTMLElement | null) => void;
  children?: ReactNode;
};

/** The band at the top over the desktop; `children` go over the strip (a popover, a HUD). */
export function BarStrip({ items, target, theme, look = defaultLook, width = 720, height, bare, anchor, children }: BarStripProps) {
  const shaped = items.map((it) => shapeItem(it, look)).filter((it) => !it.hidden);
  const bandH = target === "menubar" ? MENUBAR_H : SKETCHYBAR_H;
  return (
    <div className="g-bar" data-theme={theme} data-target={target} style={{ width, height: height ?? bandH + 36 }}>
      {target === "menubar" ? <MenuBar items={shaped} look={look} anchor={anchor} bare={bare} /> : <Sketchybar items={shaped} theme={theme} look={look} anchor={anchor} bare={bare} />}
      {children}
    </div>
  );
}
