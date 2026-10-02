import type { CSSProperties } from "react";
import { Icon } from "./Icon";
import { keepFocus } from "./keys";
import type { Icon as IconSpec } from "./types";

/** One card of the glance strip (`glance.rs` `Card`), with its extension's colour and icon resolved by the Launcher. */
export type GlanceCard = { key: string; label: string; title?: string; count?: number; tooltip?: string; urgent?: boolean; place?: string; icon?: IconSpec };

/** What a card says large: the item's count when it has one (a title beside a badge is often only a label, an account's name), else its title, else its tooltip's first line; and the line under it. */
export function glanceText(c: Pick<GlanceCard, "title" | "count" | "tooltip">): { value: string; sub?: string } {
  const tip = c.tooltip?.split("\n")[0]?.trim() || undefined;
  const value = (c.count !== undefined ? String(c.count) : c.title || tip) || "";
  return { value, sub: tip && tip !== value ? tip : undefined };
}

/**
 * The glance strip (`general.glance`): the chosen bar items' current state
 * as cards over the empty root, each in its extension's colour; a click or
 * ⌥1–⌥4 opens the item as its click on the bar does. Drawn only where the
 * design shows it (`--pal-glance`, ui.css).
 */
export function GlanceStrip({ cards, onOpen }: { cards: GlanceCard[]; onOpen: (key: string) => void }) {
  return (
    <div className="pal-glance" role="toolbar" aria-label="At a glance" onMouseDown={keepFocus}>
      {cards.map((c, i) => {
        const { value, sub } = glanceText(c);
        return (
          <button key={c.key} type="button" tabIndex={-1} className="pal-glance__card" data-urgent={c.urgent || undefined} style={c.place ? ({ "--g": c.place } as CSSProperties) : undefined} onClick={() => onOpen(c.key)} title={c.tooltip}>
            <span className="pal-glance__label">{c.icon && <Icon icon={c.icon} size="sm" />}<span className="pal-glance__name">{c.label}</span><kbd className="pal-glance__key">⌥{i + 1}</kbd></span>
            <span className="pal-glance__value">{value}</span>
            {sub && <span className="pal-glance__sub">{sub}</span>}
          </button>
        );
      })}
    </div>
  );
}
