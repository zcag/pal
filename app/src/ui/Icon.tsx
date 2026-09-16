import { useState, type CSSProperties, type ReactNode } from "react";
import { appIconUrl, faviconUrl, isSymbol } from "./icons";
import type { Icon as IconSpec } from "./types";

const APP_PX = 24;
const FAVICON_PX = 16;

type Size = "sm" | "md" | "lg";

/**
 * Fixed-size icon box: emoji, a font glyph (optionally tinted), an icon
 * tile, or an image. Every kind reserves the same box, so a row without an
 * icon keeps the text edge and an image that has not loaded yet leaves a
 * blank, never a fallback. Images are decorative (`alt=""`); the row's
 * text names the item.
 */
export function Icon({ icon, size = "md" }: { icon?: IconSpec; size?: Size }) {
  if (!icon) return <span className="pal-icon" data-size={size} aria-hidden />;
  if (icon.kind === "image") {
    return (
      <span className="pal-icon" data-size={size} aria-hidden>
        <Img key={icon.src} src={icon.src} mask={icon.mask} />
      </span>
    );
  }
  if (icon.kind === "app") return <Served size={size} kind="app" src={(s) => appIconUrl(icon.path, s)} px={APP_PX} fallback={<Icon icon={{ kind: "glyph", value: icon.letter }} size={size} />} />;
  if (icon.kind === "favicon") return <Served size={size} kind="favicon" src={(s) => faviconUrl(icon.url, s)} px={FAVICON_PX} fallback={<Globe size={size} tint={icon.tint} />} />;
  if (icon.kind === "tile") return <Tile size={size} bg={icon.bg} glyph={icon.glyph} svg={icon.svg} badge={icon.badge} />;
  // A Nerd Font codepoint is a glyph whatever the caller said: the emoji font has nothing for it.
  const kind = icon.kind === "emoji" && isSymbol(icon.value) ? "glyph" : icon.kind;
  const style: CSSProperties | undefined = icon.kind === "glyph" && icon.color ? { color: icon.color } : undefined;
  return (
    <span className="pal-icon" data-size={size} data-kind={kind} data-brand={icon.kind === "glyph" && !icon.color ? icon.tint : undefined} style={style} aria-hidden>
      {icon.value}
    </span>
  );
}

/**
 * An icon tile (icons.css): a rounded square in a brand colour, the mark
 * white. The glyph is drawn from the symbols font at about two thirds of
 * the side; an SVG mark is path data in a 16 by 16 box, filled
 * `currentColor`, at the same share of the side. A `badge` (an
 * instance's letter) sits in the bottom-right corner as a small pill in
 * the panel's colours, over the tile's edge, so the mark stays whole.
 */
function Tile({ size, bg, glyph, svg, badge }: { size: Size; bg: string; glyph?: string; svg?: string; badge?: string }) {
  return (
    <span className="pal-icon" data-size={size} data-kind="tile" data-brand={bg} data-badged={badge ? "" : undefined} aria-hidden>
      {svg ? <svg className="pal-icon__mark" viewBox="0 0 16 16"><path d={svg} /></svg> : <span className="pal-icon__glyph">{glyph}</span>}
      {badge ? <span className="pal-icon__badge">{badge}</span> : null}
    </span>
  );
}

type ImgProps = { src: string; srcSet?: string; kind?: string; mask?: string; onError?: () => void };

/** Keyed on `src` by callers: a reused <img> keeps showing its old picture until the new one decodes. */
const Img = ({ src, srcSet, kind, mask, onError }: ImgProps) => (
  <img className="pal-icon__img" data-kind={kind} data-mask={mask} src={src} srcSet={srcSet} alt="" decoding="async" draggable={false} onError={onError} />
);

/** An `icon://` image at `px` (double for 2x screens); `fallback` once it 404s. */
function Served({ size, kind, src, px, fallback }: { size: Size; kind: string; src: (px: number) => string; px: number; fallback: ReactNode }) {
  const url = src(px);
  // Remembered per URL, not per mount: the virtualiser reuses this component for other items.
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === url) return <>{fallback}</>;
  return (
    <span className="pal-icon" data-size={size} aria-hidden>
      <Img key={url} src={url} srcSet={`${url} 1x, ${src(px * 2)} 2x`} kind={kind} onError={() => setFailed(url)} />
    </span>
  );
}

/** The brief's globe: a missing favicon, in the palette's colour when the row has one. */
function Globe({ size, tint }: { size: Size; tint?: string }) {
  return (
    <span className="pal-icon" data-size={size} data-brand={tint} aria-hidden>
      <svg className="pal-icon__globe" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2c-2 2.2-2 9.8 0 12" /></svg>
    </span>
  );
}
