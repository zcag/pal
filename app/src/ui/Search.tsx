import type { ChangeEvent, RefObject } from "react";
import { Icon } from "./Icon";
import { keepFocus } from "./keys";
import type { Filter, Icon as IconSpec } from "./types";

export type SearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Shown when a level is pushed: a back chevron and the level's title; without `onBack` (a bottom level with nothing under it) the title alone. */
  back?: { title: string; icon?: IconSpec; onBack?: () => void };
  filter?: Filter;
  /** The listbox (or grid) this input drives, for aria-controls / aria-activedescendant. */
  listId?: string;
  activeId?: string;
  /** What `listId` is; a Grid says "grid". */
  popup?: "listbox" | "grid";
  loading?: boolean;
  /** A level with nothing to search (a detail-only view): the input stays for focus, but takes no text and shows no caret. */
  readOnly?: boolean;
  /** A level with no input at all (a view level): this title stands where the input would, as a navigation title. */
  title?: string;
};

export function Search({ value, onChange, placeholder = "Search…", inputRef, back, filter, listId, activeId, popup = "listbox", loading, readOnly, title }: SearchProps) {
  return (
    <div className="pal-search" data-loading={loading || undefined} data-readonly={readOnly || undefined} aria-busy={loading || undefined}>
      {back && (back.onBack ? (
        <button type="button" className="pal-search__back" onClick={back.onBack} onMouseDown={keepFocus} aria-label={`Back from ${back.title}`} tabIndex={-1}>
          <span className="pal-search__chevron" aria-hidden>‹</span>
          {back.icon && <Icon icon={back.icon} size="sm" />}
          <span className="pal-search__crumb">{back.title}</span>
        </button>
      ) : (
        <span className="pal-search__back" data-static="" role="heading" aria-level={1}>
          {back.icon && <Icon icon={back.icon} size="sm" />}
          <span className="pal-search__crumb">{back.title}</span>
        </span>
      ))}
      {title !== undefined ? <span className="pal-search__title" role="heading" aria-level={1}>{title}</span> : <input
        ref={inputRef}
        className="pal-search__input"
        type="text"
        role="combobox"
        aria-expanded={!!listId}
        aria-haspopup={popup}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />}
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
