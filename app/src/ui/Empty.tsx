import { Icon } from "./Icon";
import type { Icon as IconSpec } from "./types";

export function Empty({ icon, title, hint }: { icon?: IconSpec; title: string; hint?: string }) {
  return (
    <div className="pal-empty" role="status">
      {icon && <Icon icon={icon} size="lg" />}
      <div className="pal-empty__title">{title}</div>
      {hint && <div className="pal-empty__hint">{hint}</div>}
    </div>
  );
}
