import type { ChangeEvent, RefObject } from "react";
import { Icon } from "./Icon";
import type { Filter, Icon as IconSpec } from "./types";

export type SearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Shown when a level is pushed: a back chevron and the level's title. */
  back?: { title: string; icon?: IconSpec; onBack: () => void };
  filter?: Filter;
  /** The listbox this input drives, for aria-controls / aria-activedescendant. */
  listId?: string;
  activeId?: string;
  loading?: boolean;
};

export function Search({ value, onChange, placeholder = "Search…", inputRef, back, filter, listId, activeId, loading }: SearchProps) {
  return (
    <div className="pal-search" data-loading={loading || undefined}>
      {back && (
        <button type="button" className="pal-search__back" onClick={back.onBack} aria-label={`Back from ${back.title}`} tabIndex={-1}>
          <span className="pal-search__chevron" aria-hidden>‹</span>
          {back.icon && <Icon icon={back.icon} size="sm" />}
          <span className="pal-search__crumb">{back.title}</span>
        </button>
      )}
      <input
        ref={inputRef}
        className="pal-search__input"
        type="text"
        role="combobox"
        aria-expanded={!!listId}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      {filter && (
        <label className="pal-search__filter">
          <select value={filter.value} onChange={(e) => filter.onChange(e.target.value)} aria-label="Filter" tabIndex={-1}>
            {filter.options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <span className="pal-search__chevron" aria-hidden>⌄</span>
        </label>
      )}
    </div>
  );
}
