import type { CSSProperties, MouseEvent } from "react";
import { Icon } from "./Icon";
import { keepFocus } from "./keys";
import type { Icon as IconSpec } from "./types";

/** One card of the glance strip (`glance.rs` `Card`), with its extension's colour and icon resolved by the Launcher. */
export type GlanceCard = { key: string; label: string; title?: string; count?: number; tooltip?: string; urgent?: boolean; place?: string; icon?: IconSpec; progress?: number; lines?: { text: string; action?: string }[] };

/** What a card says large: the item's count when it has one (a title beside a badge is often only a label, an account's name), else its title, else its tooltip's first line; and the line under it. */
export function glanceText(c: Pick<GlanceCard, "title" | "count" | "tooltip">): { value: string; sub?: string } {
  const tip = c.tooltip?.split("\n")[0]?.trim() || undefined;
  const value = (c.count !== undefined ? String(c.count) : c.title || tip) || "";
  return { value, sub: tip && tip !== value ? tip : undefined };
}

/**
 * The glance strip (`general.glance`): the chosen bar items' current state
 * as cards over the empty root, each in its extension's colour; a click or
 * ⌥1–⌥4 opens the item as its click on the bar does. An item's picture
 * (an image icon: a cover) sits beside the text, its `progress` runs along
 * the foot, and its own lines (`glance.lines`, "also: …") open what they
 * name. Drawn only where the design shows it (`--pal-glance`, ui.css).
 */
export function GlanceStrip({ cards, onOpen }: { cards: GlanceCard[]; onOpen: (key: string, line?: number) => void }) {
  return (
    <div className="pal-glance" role="toolbar" aria-label="At a glance" onMouseDown={keepFocus}>
      {cards.map((c, i) => {
        const { value, sub } = glanceText(c);
        const cover = c.icon?.kind === "image" ? c.icon : undefined;
        const line = (n: number) => (e: MouseEvent) => { e.stopPropagation(); onOpen(c.key, n); };
        return (
          <button key={c.key} type="button" tabIndex={-1} className="pal-glance__card" data-urgent={c.urgent || undefined} data-cover={cover ? "" : undefined} style={c.place ? ({ "--g": c.place } as CSSProperties) : undefined} onClick={() => onOpen(c.key)} title={c.tooltip}>
            <span className="pal-glance__label">{c.icon && !cover && <Icon icon={c.icon} size="sm" />}<span className="pal-glance__name">{c.label}</span><kbd className="pal-glance__key">⌥{i + 1}</kbd></span>
            <span className="pal-glance__main">
              {cover && <img className="pal-glance__cover" src={cover.src} alt="" draggable={false} />}
              <span className="pal-glance__text">
                <span className="pal-glance__value">{value}</span>
                {sub && <span className="pal-glance__sub">{sub}</span>}
              </span>
            </span>
            {c.lines?.map((l, n) => (
              <span key={n} className="pal-glance__line" data-action={l.action ? "" : undefined} onClick={l.action ? line(n) : undefined}>{l.text}</span>
            ))}
            {c.progress !== undefined && <span className="pal-glance__progress" aria-hidden><span style={{ width: `${Math.round(Math.min(1, Math.max(0, c.progress)) * 100)}%` }} /></span>}
          </button>
        );
      })}
    </div>
  );
}
