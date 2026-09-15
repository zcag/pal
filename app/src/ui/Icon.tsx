import { useState, type ReactNode } from "react";
import { appIconUrl, faviconUrl } from "./icons";
import type { Icon as IconSpec } from "./types";

const APP_PX = 24;
const FAVICON_PX = 16;

/** Fixed-size icon box: emoji, a font glyph (optionally tinted), or an image. */
export function Icon({ icon, size = "md" }: { icon?: IconSpec; size?: "sm" | "md" | "lg" }) {
  if (!icon) return <span className="pal-icon" data-size={size} aria-hidden />;
  if (icon.kind === "image") {
    return (
      <span className="pal-icon" data-size={size}>
        <img className="pal-icon__img" data-mask={icon.mask} src={icon.src} alt="" draggable={false} />
      </span>
    );
  }
  if (icon.kind === "app") return <Served size={size} kind="app" src={(s) => appIconUrl(icon.path, s)} px={APP_PX} fallback={<Icon icon={{ kind: "glyph", value: icon.letter }} size={size} />} />;
  if (icon.kind === "favicon") return <Served size={size} kind="favicon" src={(s) => faviconUrl(icon.url, s)} px={FAVICON_PX} fallback={<Globe size={size} />} />;
  return (
    <span className="pal-icon" data-size={size} data-kind={icon.kind} style={icon.kind === "glyph" && icon.color ? { color: icon.color } : undefined} aria-hidden>
      {icon.value}
    </span>
  );
}

/** An `icon://` image at `px` (double for 2x screens); `fallback` once it 404s. */
function Served({ size, kind, src, px, fallback }: { size: "sm" | "md" | "lg"; kind: string; src: (px: number) => string; px: number; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <span className="pal-icon" data-size={size}>
      <img className="pal-icon__img" data-kind={kind} src={src(px)} srcSet={`${src(px)} 1x, ${src(px * 2)} 2x`} alt="" draggable={false} onError={() => setFailed(true)} />
    </span>
  );
}

/** The brief's globe: a missing favicon. */
function Globe({ size }: { size: "sm" | "md" | "lg" }) {
  return (
    <span className="pal-icon" data-size={size} aria-hidden>
      <svg className="pal-icon__globe" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2c-2 2.2-2 9.8 0 12" /></svg>
    </span>
  );
}
