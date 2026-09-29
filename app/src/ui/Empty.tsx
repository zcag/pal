import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { Icon as IconSpec } from "./types";

/** `hint` is what to try; `note` a second, quieter line (a hint about the setup rather than the query); `action` a button under the hint (the level's Enter, for the pointer). */
export function Empty({ icon, title, hint, note, action }: { icon?: IconSpec; title: string; hint?: string; note?: string; action?: ReactNode }) {
  return (
    <div className="pal-empty" role="status">
      {icon && <Icon icon={icon} size="lg" />}
      <div className="pal-empty__title">{title}</div>
      {hint && <div className="pal-empty__hint">{hint}</div>}
      {action && <div className="pal-empty__action">{action}</div>}
      {note && <div className="pal-empty__hint pal-empty__note">{note}</div>}
    </div>
  );
}
