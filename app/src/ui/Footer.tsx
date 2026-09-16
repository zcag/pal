import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { keepFocus } from "./keys";
import type { Icon as IconSpec } from "./types";

export type FooterProps = {
  icon?: IconSpec;
  title?: string;
  /** A quiet status after the title ("updating…"). */
  note?: string;
  /** Primary action hint, right side: "Open ↵". */
  primary?: { title: string };
  /** Show the "Actions ⌘K" affordance. */
  actions?: boolean;
  onActions?: () => void;
  onPrimary?: () => void;
};

export function Footer({ icon, title, note, primary, actions, onActions, onPrimary }: FooterProps) {
  return (
    <div className="pal-footer" onMouseDown={keepFocus}>
      <div className="pal-footer__context">
        {icon && <Icon icon={icon} size="sm" />}
        {title && <span className="pal-footer__title">{title}</span>}
        {note && <span className="pal-footer__note" aria-live="polite">{note}</span>}
      </div>
      <div className="pal-footer__hints">
        {primary && (
          <button type="button" className="pal-footer__hint" onClick={onPrimary} tabIndex={-1}>
            {primary.title} <Kbd shortcut="enter" />
          </button>
        )}
        {actions && (
          <button type="button" className="pal-footer__hint" onClick={onActions} tabIndex={-1} aria-haspopup="dialog">
            Actions <Kbd shortcut="cmd+k" />
          </button>
        )}
      </div>
    </div>
  );
}
