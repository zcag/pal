/**
 * What the two real bar renderers draw for an item, as data: the menu bar
 * (`app/src-tauri/src/bar/menubar.rs` `describe`) and sketchybar
 * (`sketchybar.rs` `props`). `BarStrip.tsx` draws the gallery's strips and
 * the Settings > Bar preview from these and nothing else, and
 * `__tests__/bar-parity.test.ts` holds them to the renderers' own output
 * (`bar-parity.json`, written by `app/src-tauri/src/bar/parity.rs`), so a
 * screenshot or a preview cannot show something the bar does not do
 * (docs/design/screenshots.md, "Parity"). Each function names the Rust it
 * follows; change them together.
 */
import type { BarLook, BarStripItem } from "./BarStrip";

// ---- colours: `bar/colors.rs` ---------------------------------------------------

export const COLOR_NAMES = ["grey", "blue", "green", "amber", "red", "violet", "pink", "teal", "text", "muted", "accent", "destructive"] as const;
const LIGHT = [0x55565f, 0x2457b0, 0x1b6b40, 0x874c00, 0xb02925, 0x5b39c2, 0xa0286a, 0x0b6664, 0x1a1a1f, 0x5c5d66, 0x4f46d6, 0xc02b27];
const DARK = [0xa3a4ae, 0x7fb0ff, 0x5ccb8e, 0xf0b25a, 0xff8a82, 0xb39dff, 0xf08cc0, 0x5fcfcb, 0xececf0, 0xa3a4ae, 0x9f97ff, 0xff6e66];

/** `0xAARRGGBB`, `0xRRGGBB` (opaque), `#RRGGBB`, `RRGGBB` (`colors::parse`). */
function parseHex(s: string): number | undefined {
  const t = s.trim();
  const hex = t.startsWith("0x") || t.startsWith("0X") ? t.slice(2) : t.startsWith("#") ? t.slice(1) : t;
  if (!/^[0-9a-f]+$/i.test(hex)) return undefined;
  const v = parseInt(hex, 16);
  return hex.length === 8 ? v >>> 0 : hex.length === 6 ? (0xff000000 | v) >>> 0 : undefined;
}

/** `colors::at`: `c` with its alpha scaled to `percent`. */
export const at = (c: number, percent: number) => (((Math.round((c >>> 24) * Math.min(100, percent) / 100) << 24) | (c & 0xffffff)) >>> 0);
/** `colors::spell`: sketchybar's `0xAARRGGBB`. */
export const spell = (c: number) => `0x${c.toString(16).padStart(8, "0")}`;
/** `0xAARRGGBB` as CSS. */
export const css = (c: number) => `rgba(${(c >>> 16) & 255}, ${(c >>> 8) & 255}, ${c & 255}, ${Math.round(((c >>> 24) / 255) * 1000) / 1000})`;
/** A sketchybar `0xAARRGGBB` string as CSS. */
export const cssOf = (s: string | undefined) => (s ? css(parseHex(s) ?? 0) : undefined);

/** `colors::ink_on`: black or white ink for text on `c`, by WCAG luminance. */
export function inkOn(c: number): number {
  const lin = (v: number) => { const x = (v & 0xff) / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const l = 0.2126 * lin(c >>> 16) + 0.7152 * lin(c >>> 8) + 0.0722 * lin(c);
  return l > 0.179 ? 0xff1a1a1f : 0xffffffff;
}

/** `colors::Palette::new(dark, {})`: pal's own tokens, no config overrides. */
export class Palette {
  private map: Map<string, number>;
  constructor(dark: boolean) {
    const base = dark ? DARK : LIGHT;
    this.map = new Map(COLOR_NAMES.map((n, i) => [n, (0xff000000 | base[i]) >>> 0]));
  }
  argb(name: string) { return this.map.get(name); }
  resolve(spec: string) { return this.argb(spec) ?? parseHex(spec); }
  /** `rgb_of` as `#rrggbb`. */
  rgb(spec: string): string | undefined { const c = this.resolve(spec); return c === undefined ? undefined : `#${(c & 0xffffff).toString(16).padStart(6, "0")}`; }
  muted(dim: number) { return at(this.argb("muted") ?? 0xffa3a4ae, dim); }
}

// ---- the item: `bar/mod.rs` -------------------------------------------------------

/** The bundled Symbols Nerd Font's cmap (`glyph::has_glyph`), as code point ranges; everything else is text. */
const GLYPH_RANGES: [number, number][] = [[0x23fb, 0x23fe], [0x2630, 0x2630], [0x2665, 0x2665], [0x26a1, 0x26a1], [0x276c, 0x2771], [0x2b58, 0x2b58], [0xe000, 0xe00a], [0xe0a0, 0xe0a3], [0xe0b0, 0xe0c8], [0xe0ca, 0xe0ca], [0xe0cc, 0xe0d2], [0xe0d4, 0xe0d4], [0xe0d6, 0xe0d7], [0xe200, 0xe2a9], [0xe300, 0xe3e3], [0xe5fa, 0xe6bb], [0xe700, 0xe958], [0xea60, 0xea88], [0xea8a, 0xea8c], [0xea8f, 0xeac7], [0xeac9, 0xeac9], [0xeacc, 0xeb09], [0xeb0b, 0xeb4e], [0xeb50, 0xec5e], [0xec60, 0xec84], [0xed00, 0xefcf], [0xf000, 0xf385], [0xf400, 0xf533], [0xf0001, 0xf1af0]];
export const hasGlyph = (ch: string) => { const c = ch.codePointAt(0)!; return GLYPH_RANGES.some(([a, b]) => c >= a && c <= b); };

export type IconKind = { kind: "glyph"; glyph: string } | { kind: "text"; text: string } | { kind: "image"; template: boolean };

/** `bar::icon_kind`. */
export function iconKind(v: BarStripItem["icon"]): IconKind | undefined {
  if (typeof v === "string") {
    const s = v.trim(), chars = [...s];
    if (!chars.length) return undefined;
    return chars.length === 1 && hasGlyph(chars[0]) ? { kind: "glyph", glyph: chars[0] } : { kind: "text", text: s };
  }
  if (v && typeof v === "object" && ("image" in v || "app" in v)) return { kind: "image", template: (v as { template?: boolean }).template === true };
  return undefined;
}

/** `bar::look_icon`: a look's icon naming a picture is an image. */
function lookIcon(s: string): BarStripItem["icon"] {
  const t = s.trim();
  return t.startsWith("/") || t.startsWith("~/") || t.startsWith("data:image/") || t.startsWith("icon://") ? { image: t } : t;
}

/** `BarItem::shaped`: the item with the look applied, hidden when nothing is left to draw. */
export function shapeItem(item: BarStripItem, look: BarLook): BarStripItem {
  const out: BarStripItem = { ...item };
  // A blank custom icon is no custom icon: the extension's stays.
  if (look.icon?.trim()) out.icon = lookIcon(look.icon);
  if (!look.showIcon) delete out.icon;
  if (!look.showTitle) { delete out.title; out.segments = []; }
  if (look.badgeStyle === "none") delete out.badge;
  else if (look.badgeStyle === "dot" && typeof out.badge === "number") out.badge = "dot";
  if (look.color && out.color !== "muted") out.color = look.color;
  if (out.icon === undefined && !out.title && !(out.segments?.length) && out.badge === undefined) out.hidden = true;
  return out;
}

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

const muted = (item: BarStripItem) => !item.urgent && (!!item.stale || item.color === "muted");
const count = (item: BarStripItem) => (typeof item.badge === "number" ? item.badge : undefined);
/** `Draw::tint`. */
const tint = (item: BarStripItem, look: BarLook) => (item.urgent ? look.urgentColor : muted(item) ? "muted" : item.color ?? undefined);
/** `Draw::badge_tint`. */
const badgeTint = (item: BarStripItem, look: BarLook) => (item.stale && !item.urgent ? "muted" : look.badgeColor ?? tint(item, look));
/** `Draw::icon_size` / `label_size`: the item's own, else the look's split size, else its `size`. */
export const iconSize = (item: BarStripItem, look: BarLook) => item.icon_size ?? (look.iconSize > 0 ? look.iconSize : look.size);
export const labelSize = (item: BarStripItem, look: BarLook) => item.label_size ?? (look.textSize > 0 ? look.textSize : look.size);

// ---- the menu bar: `bar/menubar.rs` -------------------------------------------------

export type MenubarDescribed = {
  icon: "glyph" | "run" | "text" | "image" | "none";
  glyph: string | null;
  image_text: string | null;
  title: string;
  template: boolean;
  ink: string | null;
  badge_ink: string | null;
  dot: boolean;
  progress: number | null;
  alpha: number;
  opacity: number;
  size: number;
};

/** `glyph_run`: an icon of several Nerd glyphs, drawn into the image. */
function glyphRun(k: IconKind | undefined): string | undefined {
  if (k?.kind !== "text") return undefined;
  const cs = [...k.text];
  return cs.some(hasGlyph) && cs.every((c) => /\s/.test(c) || hasGlyph(c)) ? k.text : undefined;
}

/** `runs`: the clipped title, then each segment as `glyph text`, two spaces apart. */
function runs(item: BarStripItem, look: BarLook): string {
  const parts: string[] = [];
  if (item.title) parts.push(clipText(item.title, look.maxChars));
  for (const s of item.segments ?? []) { const r = `${s.icon ?? ""} ${s.text ?? ""}`.trim(); if (r) parts.push(r); }
  return parts.join("  ");
}

/** `menubar::describe` over an already shaped item. */
export function describeMenubar(item: BarStripItem, look: BarLook, dark: boolean): MenubarDescribed {
  const pal = new Palette(dark);
  const k = iconKind(item.icon);
  const run = glyphRun(k);
  const ink = (spec: string | undefined) => (!spec || spec === "text" || spec === "muted" ? null : pal.rgb(spec) ?? null);
  const color = ink(tint(item, look)), badge = ink(badgeTint(item, look));
  const text = runs(item, look);
  const prerendered = (!!run || [...text].some(hasGlyph) || look.font === "mono" || iconSize(item, look) > 0 || labelSize(item, look) > 0 || look.width > 0 || look.opacity < 100 || !!look.badgeColor) && k?.kind !== "image";
  const badgeText = count(item) !== undefined ? ` ·${count(item)}` : "";
  const titleParts: string[] = [];
  if (k?.kind === "text" && !run) titleParts.push(k.text);
  if (!prerendered) titleParts.push(`${text}${badgeText}`.trim());
  return {
    icon: run ? "run" : k?.kind ?? "none",
    glyph: run ?? (k?.kind === "glyph" ? k.glyph : null),
    image_text: prerendered ? `${text}${text ? badgeText : badgeText.trimStart()}` : null,
    title: titleParts.join("  ").trim(),
    template: k?.kind === "image" ? k.template : color === null && badge === null,
    ink: color,
    badge_ink: badge,
    dot: item.badge === "dot",
    progress: typeof item.progress === "number" ? Math.round(item.progress * 1000) / 1000 : null,
    alpha: muted(item) ? look.dim : 100,
    opacity: look.opacity,
    size: iconSize(item, look),
  };
}

// ---- sketchybar: `bar/sketchybar.rs` --------------------------------------------------

/** One sketchybar item's properties, the picture's part (`parity.rs` `SKETCHY_KEYS`). */
export type SketchyProps = Record<string, string>;

/** `sketchybar::rule`: eight cells of heavy and light box drawing. */
export const rule = (p: number) => { const n = Math.round(Math.min(1, Math.max(0, p)) * 8); return "━".repeat(n) + "─".repeat(8 - n); };

const num = (n: number) => String(n);

/** `sketchybar::props` over an already shaped item: the main item, then a segment each, then the count. */
export function describeSketchy(item: BarStripItem, look: BarLook, dark: boolean): SketchyProps[] {
  const pal = new Palette(dark);
  const text = pal.argb("text") ?? 0;
  const color = (spec: string | undefined) => spell(at(spec === "muted" ? pal.muted(look.dim) : spec ? pal.resolve(spec) ?? text : text, look.opacity));
  const bg = item.background ? pal.resolve(item.background) : undefined;
  const t = tint(item, look);
  const itemColor = bg !== undefined && (!t || t === "text") ? spell(at(inkOn(bg), look.opacity)) : color(t);
  const k = iconKind(item.icon);
  let icon = k?.kind === "glyph" ? k.glyph : k?.kind === "text" ? k.text : "";
  if (typeof item.progress === "number") icon = `${rule(item.progress)} ${icon}`.trimEnd();
  const p: SketchyProps = { drawing: item.hidden ? "off" : "on" };
  if (k?.kind === "image") { p.icon = ""; p["icon.drawing"] = "on"; } else { p.icon = icon; p["icon.drawing"] = icon ? "on" : "off"; }
  p["icon.color"] = item.badge === "dot" ? color(badgeTint(item, look)) : itemColor;
  const title = clipText(item.title ?? "", look.maxChars);
  p.label = title;
  p["label.drawing"] = title ? "on" : "off";
  p["label.color"] = itemColor;
  p["label.max_chars"] = num(look.maxChars);
  p["background.drawing"] = item.background ? "on" : "off";
  if (item.background) p["background.color"] = spell(bg ?? text);
  p["background.height"] = item.background ? "22" : "0";
  p["background.corner_radius"] = item.background ? "6" : "0";
  const sp = num(look.spacing);
  const trailing = !(item.segments?.length) && count(item) === undefined;
  p["icon.padding_left"] = "8";
  p["icon.padding_right"] = !title && trailing ? "8" : sp;
  p["label.padding_left"] = "0";
  p["label.padding_right"] = trailing ? "8" : "2";
  const is = iconSize(item, look), ls = labelSize(item, look);
  if (is > 0) p["icon.font.size"] = num(is);
  if (ls > 0) p["label.font.size"] = num(ls);
  if (item.icon_width !== undefined) p["icon.width"] = num(item.icon_width);
  if (look.font === "mono") p["label.font.family"] = "Menlo";
  if (look.width > 0 && title) p["label.width"] = num(look.width);
  const out = [p];
  const extras = (item.segments ?? []).map((s) => ({ icon: s.icon ?? "", text: s.text ?? "", col: item.stale && !item.urgent ? color("muted") : color(s.color ?? t) }));
  if (count(item) !== undefined) extras.push({ icon: "", text: String(count(item)), col: color(badgeTint(item, look)) });
  extras.forEach((x, i) => {
    const e: SketchyProps = {
      drawing: item.hidden ? "off" : "on", icon: x.icon, "icon.drawing": x.icon ? "on" : "off", "icon.color": x.col, "icon.padding_left": sp, "icon.padding_right": "2",
      label: x.text, "label.drawing": x.text ? "on" : "off", "label.color": x.col, "label.padding_left": x.icon ? "0" : sp, "label.padding_right": i === extras.length - 1 ? "8" : "2",
    };
    if (is > 0) e["icon.font.size"] = num(is);
    if (ls > 0) e["label.font.size"] = num(ls);
    if (look.font === "mono") e["label.font.family"] = "Menlo";
    out.push(e);
  });
  return out;
}
