import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { Icon as IconSpec } from "./types";

export type SettingsListItem = {
  id: string;
  icon?: IconSpec;
  title: string;
  /** Under the title: a count, a version. */
  sub?: string;
  /** Right edge: tags, a dot. */
  accessory?: ReactNode;
  /** Greyed: not loaded, disabled. */
  dim?: boolean;
  /** `data-anchor` for the settings search to scroll to and light. */
  anchor?: string;
  /** Draw a rule under this row: what follows is a different kind of thing. */
  divider?: boolean;
};

/**
 * The narrow list on the left of a two-pane page (extensions on Palettes
 * and Extensions): icon, title, a line under it. One row is selected; the
 * arrows, Home and End move it, and focus follows the selection so Tab
 * leaves the list from the selected row.
 */
export function SettingsList({ items, selected, onSelect, label }: { items: SettingsListItem[]; selected?: string; onSelect: (id: string) => void; label: string }) {
  const list = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((x) => x.id === selected);
    let next: number | undefined;
    if (e.key === "ArrowDown") next = Math.min(i + 1, items.length - 1);
    else if (e.key === "ArrowUp") next = Math.max(i - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === undefined || !items[next]) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(items[next].id);
    list.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(items[next].id)}"]`)?.focus();
  };
  return (
    <div className="pal-settings-list" role="listbox" aria-label={label} ref={list} onKeyDown={onKey}>
      {items.map((it, i) => (
        <div
          key={it.id}
          role="option"
          aria-selected={it.id === selected}
          data-item={it.id}
          data-anchor={it.anchor}
          data-active={it.id === selected || undefined}
          data-dim={it.dim || undefined}
          data-divider={it.divider || undefined}
          tabIndex={it.id === selected || (!selected && i === 0) ? 0 : -1}
          className="pal-settings-list__row"
          onClick={() => onSelect(it.id)}
          onFocus={(e) => { if (e.target === e.currentTarget) onSelect(it.id); }}
        >
          <Icon icon={it.icon} />
          <span className="pal-settings-list__text">
            <span className="pal-settings-list__title">{it.title}</span>
            {it.sub && <span className="pal-settings-list__sub">{it.sub}</span>}
          </span>
          {it.accessory && <span className="pal-settings-list__acc">{it.accessory}</span>}
        </div>
      ))}
    </div>
  );
}
