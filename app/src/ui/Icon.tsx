import type { Icon as IconSpec } from "./types";

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
  return (
    <span className="pal-icon" data-size={size} data-kind={icon.kind} style={icon.kind === "glyph" && icon.color ? { color: icon.color } : undefined} aria-hidden>
      {icon.value}
    </span>
  );
}
