import type { MouseEvent } from "react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { keepFocus } from "./keys";
import type { Icon as IconSpec, Shortcut } from "./types";

export type FooterProps = {
  icon?: IconSpec;
  title?: string;
  /** A quiet status after the title ("updating…"). */
  note?: string;
  /** Marked rows: "3 selected" as a badge after the title. */
  count?: number;
  /** Primary action hint, right side: "Open ↵"; `shortcut` when Enter is not the key (a form's textarea: ⌘↵). */
  primary?: { title: string; shortcut?: Shortcut };
  /** Show the "Actions ⌘K" affordance. */
  actions?: boolean;
  onActions?: () => void;
  onPrimary?: () => void;
};

export function Footer({ icon, title, note, count, primary, actions, onActions, onPrimary }: FooterProps) {
  return (
    <div className="pal-footer" onMouseDown={keepFocus}>
      <div className="pal-footer__context">
        {icon && <Icon icon={icon} size="sm" />}
        {title && <span className="pal-footer__title">{title}</span>}
        {!!count && <span className="pal-footer__count" aria-live="polite">{count} selected</span>}
        {note && <span className="pal-footer__note" aria-live="polite">{note}</span>}
      </div>
      <Hints primary={primary} actions={actions} onActions={onActions} onPrimary={onPrimary} />
    </div>
  );
}

export type HintsProps = Pick<FooterProps, "primary" | "actions" | "onActions" | "onPrimary">;

/**
 * "Open ↵" and "Actions ⌘K": the footer's right side, and the cursor row's
 * when a design puts the keys there (`--pal-row-hints`, Row `hints`). A click
 * stops at the hint, so on a row it runs the hint, not the row's pick too.
 */
export function Hints({ primary, actions, onActions, onPrimary }: HintsProps) {
  const run = (f?: () => void) => (e: MouseEvent) => { e.stopPropagation(); f?.(); };
  return (
    <div className="pal-footer__hints">
      {primary && (
        <button type="button" className="pal-footer__hint" onClick={run(onPrimary)} tabIndex={-1}>
          <span className="pal-footer__hint-title">{primary.title}</span> <Kbd shortcut={primary.shortcut ?? "enter"} />
        </button>
      )}
      {actions && (
        <button type="button" className="pal-footer__hint" onClick={run(onActions)} tabIndex={-1} aria-haspopup="dialog">
          Actions <Kbd shortcut="cmd+k" />
        </button>
      )}
    </div>
  );
}
