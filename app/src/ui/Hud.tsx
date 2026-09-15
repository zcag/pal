import { Icon } from "./Icon";
import type { Icon as IconSpec } from "./types";

/** Brief centred confirmation ("Copied"), for after the panel hides. */
export function Hud({ text, icon }: { text: string; icon?: IconSpec }) {
  return (
    <div className="pal-hud" role="status" aria-live="polite">
      {icon && <Icon icon={icon} size="sm" />}
      <span>{text}</span>
    </div>
  );
}
