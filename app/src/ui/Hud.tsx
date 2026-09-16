import { Icon } from "./Icon";
import type { Icon as IconSpec } from "./types";

/** Particles of a `celebrate` burst: enough to read as confetti in a 480 by 72 window, few enough to cost nothing. */
const PARTICLES = 24;

/** Brief centred confirmation ("Copied"), for after the panel hides. `celebrate` (`pal://confetti`) bursts CSS particles from behind the capsule. */
export function Hud({ text, icon, celebrate }: { text: string; icon?: IconSpec; celebrate?: boolean }) {
  return (
    <div className="pal-hud" role="status" data-celebrate={celebrate || undefined}>
      {celebrate && (
        <div className="pal-hud__confetti" aria-hidden>
          {Array.from({ length: PARTICLES }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}
        </div>
      )}
      {icon && <Icon icon={icon} size="sm" />}
      <span>{text}</span>
    </div>
  );
}
